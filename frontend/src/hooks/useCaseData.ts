"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { API_BASE, deleteRecommendationFeedback, putRecommendationFeedback } from "@/lib/api";
import { profileToFilters } from "@/lib/clientFilters";
import { filtersToSearchParams } from "@/lib/filters";
import { useActiveClient } from "@/contexts/ActiveClientContext";
import { isPointInPolygon } from "@/lib/geo";
import type { WalkabilityPreferences } from "@/lib/walkabilityPreferences";
import {
  getDefaultPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
} from "@/lib/walkabilityPreferences";
import type { LocationProjectPoint } from "@/components/ClientLocationMap";
import type {
  ClientSummary,
  ClientProfile,
  RecommendationItem,
  RecommendationFeedbackType,
  RecommendationDislikeReason,
  RecommendationFunnel,
  MarketFitAnalysis,
  AreaMarketAnalysis,
  NoteItem,
  WizardExtras,
} from "@/lib/caseTypes";
import { buildStructuredWizard } from "@/lib/wizardTransform";
import {
  createClientModeStateFromProfile,
  updateWorkingFilter as applyWorkingFilterUpdate,
  resetWorkingFilters as resetWorkingFiltersLocal,
  type ClientModeState,
  type WorkingFilters,
  type WorkingFilterKey,
} from "@/lib/clientMode";

export function useCaseData() {
  const params = useParams();
  const router = useRouter();
  const clientId = Number(params?.id);
  const { activate, activeClient } = useActiveClient();

  const [client, setClient] = useState<ClientSummary | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [selectedLayouts, setSelectedLayouts] = useState<string[]>([]);
  const [recs, setRecs] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeProgress, setRecomputeProgress] = useState<{ total: number; done: number; status?: string } | null>(null);
  const recomputeProgressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recsFunnel, setRecsFunnel] = useState<RecommendationFunnel | null>(null);
  const [profileSavedMessage, setProfileSavedMessage] = useState<string | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const isFirstLoad = useRef(true);

  const [walkPrefsOpen, setWalkPrefsOpen] = useState(false);
  const [walkPrefs, setWalkPrefs] = useState<WalkabilityPreferences>(() => getDefaultPreferences());

  const [hydrated, setHydrated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [marketFit, setMarketFit] = useState<MarketFitAnalysis | null>(null);
  const [areaMarket, setAreaMarket] = useState<AreaMarketAnalysis | null>(null);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [newNoteType, setNewNoteType] = useState<"internal" | "meeting" | "call">("internal");
  const [notesSaving, setNotesSaving] = useState(false);
  const [feedbackSavingId, setFeedbackSavingId] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Client Mode (Phase 1 foundation). Initialized from the profile on load
  // and kept in local state; PUT/reset calls persist to the backend.
  const [clientModeState, setClientModeState] = useState<ClientModeState | null>(null);
  const [clientModeSaving, setClientModeSaving] = useState(false);

  const [wizardExtras, setWizardExtras] = useState<WizardExtras>({});
  const nextStepGuard = useRef(false);
  const [locationPolygons, setLocationPolygons] = useState<{ lat: number; lng: number }[][]>([]);
  const [activeAreaIndex, setActiveAreaIndex] = useState<number>(0);
  const [locationProjects, setLocationProjects] = useState<LocationProjectPoint[]>([]);

  const projectsInsidePolygon = useMemo(() => {
    if (!locationProjects.length) return 0;
    return locationProjects.filter(
      (p) =>
        p.gps_latitude != null &&
        p.gps_longitude != null &&
        locationPolygons.some(
          (poly) =>
            poly.length >= 3 &&
            isPointInPolygon(p.gps_latitude!, p.gps_longitude!, poly)
        )
    ).length;
  }, [locationPolygons, locationProjects]);

  useEffect(() => {
    const stored = loadWalkPrefs();
    setWalkPrefs(stored);
  }, []);

  // Restore last recompute funnel from sessionStorage for cross-page navigation
  // (e.g. recompute on /brief → navigate to /recommendations). The storage key
  // is scoped per client id so switching clients doesn't leak stale data.
  useEffect(() => {
    if (typeof window === "undefined" || !clientId) return;
    try {
      const raw = sessionStorage.getItem(`reamar_funnel_${clientId}`);
      if (raw) setRecsFunnel(JSON.parse(raw) as RecommendationFunnel);
    } catch {
      // ignore malformed cache
    }
  }, [clientId]);

  // Lazily initialize client-mode state from the profile the first time it
  // becomes available, so UIs that consume `clientModeState` immediately get
  // a snapshot without waiting for the /client-mode endpoint to settle.
  useEffect(() => {
    if (!profile) return;
    setClientModeState((prev) =>
      prev ?? createClientModeStateFromProfile(profile),
    );
  }, [profile]);

  useEffect(() => {
    setHydrated(true);
    if (typeof window !== "undefined") {
      const t = window.localStorage.getItem("broker_token");
      setToken(t);
    }
  }, []);

  // Keep selectedLayouts in sync with profile.layouts when profile changes.
  useEffect(() => {
    const values = (profile?.layouts?.values as string[] | undefined) ?? [];
    setSelectedLayouts(values);
    const existingWizard: WizardExtras | undefined =
      (profile?.filter_json && (profile.filter_json as any).wizard) || undefined;
    if (existingWizard) {
      setWizardExtras(existingWizard);
    }
    // Hydrate walkPrefs from backend profile — takes precedence over localStorage.
    // Without this, any auto-save after load would overwrite saved preferences with
    // the stale localStorage value.
    if (profile?.walkability_preferences_json) {
      setWalkPrefs(profile.walkability_preferences_json as WalkabilityPreferences);
    }
    // hydrate polygon / multipolygon from polygon_geojson
    if (profile?.polygon_geojson) {
      try {
        const geo = JSON.parse(profile.polygon_geojson) as any;
        let polys: { lat: number; lng: number }[][] = [];
        if (geo?.type === "Polygon") {
          const ring = (geo.coordinates?.[0] ?? []) as any[];
          const pts = ring
            .map((c) => ({
              lng: typeof c[0] === "number" ? c[0] : null,
              lat: typeof c[1] === "number" ? c[1] : null,
            }))
            .filter((p) => p.lat != null && p.lng != null) as { lat: number; lng: number }[];
          if (pts.length) polys = [pts];
        } else if (geo?.type === "MultiPolygon") {
          polys =
            (geo.coordinates as any[][][])?.map((poly) => {
              const ring = poly?.[0] ?? [];
              return ring
                .map((c: any) => ({
                  lng: typeof c[0] === "number" ? c[0] : null,
                  lat: typeof c[1] === "number" ? c[1] : null,
                }))
                .filter((p) => p.lat != null && p.lng != null) as { lat: number; lng: number }[];
            }) ?? [];
          polys = polys.filter((p) => p.length > 0);
        }
        setLocationPolygons(polys);
        setActiveAreaIndex(0);
      } catch {
        setLocationPolygons([]);
      }
    } else {
      setLocationPolygons([]);
      setActiveAreaIndex(0);
    }
    // hydrate commute points from commute_points_json if present
    const cp = profile?.commute_points_json as any;
    if (cp) {
      const list = Array.isArray(cp) ? cp : cp.points || [];
      if (Array.isArray(list) && list.length) {
        setWizardExtras((prev) => ({
          ...prev,
          commute: {
            points: list.map((p: any, idx: number) => ({
              id: String(p.id ?? `${idx}`),
              label: String(p.label ?? ""),
              lat: typeof p.lat === "number" ? p.lat : null,
              lng: typeof p.lng === "number" ? p.lng : null,
              mode: (p.mode as "drive" | "transit" | "park_and_ride") ?? "drive",
              max_minutes:
                typeof p.max_minutes === "number" ? p.max_minutes : null,
              priority:
                (p.priority as "must_have" | "prefer" | "ignore") ?? "ignore",
              tolerance_minutes:
                typeof p.tolerance_minutes === "number"
                  ? p.tolerance_minutes
                  : null,
              address: typeof p.address === "string" ? p.address : null,
              place_id: typeof p.place_id === "string" ? p.place_id : null,
              arrival_time: typeof p.arrival_time === "string" ? p.arrival_time : null,
            })),
          },
        }));
      }
    }
  }, [profile]);

  // Mark first load as done once loading completes so auto-save doesn't fire on initial hydration
  useEffect(() => {
    if (!loading && hydrated) {
      const t = setTimeout(() => { isFirstLoad.current = false; }, 200);
      return () => clearTimeout(t);
    }
  }, [loading, hydrated]);

  const LAYOUT_OPTIONS = useMemo(
    () => [
      { value: "1kk", label: "1kk" },
      { value: "2kk", label: "2kk" },
      { value: "3kk", label: "3kk" },
      { value: "4kk", label: "4kk" },
      { value: "5+kk", label: "5+kk" },
      { value: "1+1", label: "1+1" },
      { value: "2+1", label: "2+1" },
      { value: "3+1", label: "3+1" },
      { value: "studio", label: "Studio" },
    ],
    []
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!clientId) {
      setLoading(false);
      setError("Klient neexistuje.");
      return;
    }
    if (!token) {
      setError("Nejste přihlášen – prosím přejděte na /login.");
      setLoading(false);
      return;
    }
    setLoading(true);

    const controller = new AbortController();
    const authHeaders = { Authorization: `Bearer ${token}` };
    const fetchOptionalJson = async <T,>(url: string, fallback: T): Promise<T> => {
      try {
        const response = await fetch(url, { headers: authHeaders, signal: controller.signal });
        if (!response.ok) return fallback;
        return (await response.json()) as T;
      } catch {
        return fallback;
      }
    };

    fetch(`${API_BASE}/clients/${clientId}`, {
      headers: authHeaders,
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then(async (clientJson) => {
        if (controller.signal.aborted) return;
        setClient(clientJson as ClientSummary);

        const [
          profileJson,
          recsJson,
          notesJson,
        ] = await Promise.all([
          fetchOptionalJson<ClientProfile | null>(`${API_BASE}/clients/${clientId}/profile`, null),
          fetchOptionalJson<RecommendationItem[]>(`${API_BASE}/clients/${clientId}/recommendations`, []),
          fetchOptionalJson<NoteItem[]>(`${API_BASE}/clients/${clientId}/notes`, []),
        ]);

        if (controller.signal.aborted) return;
        setProfile((profileJson || null) as ClientProfile | null);
        setRecs((recsJson || []) as RecommendationItem[]);

        // Kick off client-mode state fetch; fall back to profile-derived snapshot.
        fetchOptionalJson<ClientModeState | null>(
          `${API_BASE}/clients/${clientId}/client-mode`,
          null,
        )
          .then((cm) => {
            if (controller.signal.aborted) return;
            if (cm && typeof cm === "object") {
              setClientModeState((prev) => (prev?.modifiedKeys?.length ? prev : cm));
            } else {
              setClientModeState(
                createClientModeStateFromProfile(profileJson as ClientProfile | null),
              );
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setClientModeState(
                createClientModeStateFromProfile(profileJson as ClientProfile | null),
              );
            }
          });

        // Analytics are heavy (full-dataset scan). Fire separately so they do
        // not block the initial render — pages already null-guard both values.
        fetchOptionalJson<MarketFitAnalysis | null>(`${API_BASE}/clients/${clientId}/market-fit-analysis`, null)
          .then((mf) => { if (!controller.signal.aborted) setMarketFit(mf); });
        fetchOptionalJson<AreaMarketAnalysis | null>(`${API_BASE}/clients/${clientId}/area-market-analysis`, null)
          .then((am) => { if (!controller.signal.aborted) setAreaMarket(am); });
        setNotes((notesJson || []) as NoteItem[]);

        // Projects list (map pins on brief/Step 3) — only used in brief, not on first paint.
        // Fire separately so it does not block initial render.
        fetchOptionalJson<{ items?: LocationProjectPoint[] } | null>(
          `${API_BASE}/projects?availability=available&availability=reserved&limit=2000&sort_by=avg_price_per_m2_czk&sort_dir=asc`,
          null
        ).then((projectsOverviewJson) => {
          if (controller.signal.aborted) return;
          const items = (projectsOverviewJson?.items ?? []) as any[];
          const withGps: LocationProjectPoint[] = items
            .filter(
              (p) =>
                typeof p.gps_latitude === "number" &&
                typeof p.gps_longitude === "number" &&
                Number.isFinite(p.gps_latitude) &&
                Number.isFinite(p.gps_longitude)
            )
            .map((p) => ({
              id: p.id as number,
              project: (p.project as string) ?? null,
              municipality: (p.municipality as string) ?? null,
              city: (p.city as string) ?? null,
              gps_latitude: p.gps_latitude as number,
              gps_longitude: p.gps_longitude as number,
              avg_price_per_m2_czk:
                typeof p.avg_price_per_m2_czk === "number" ? (p.avg_price_per_m2_czk as number) : null,
            }));
          setLocationProjects(withGps);
        });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Chyba");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => { controller.abort(); };
  }, [clientId, token, hydrated]);

  const buildProfileBody = useCallback((): ClientProfile => {
    // Auto-derive method flags from actual data — broker doesn't toggle these manually
    const hasPolygon = locationPolygons.some((p) => p.length >= 3);
    const hasCommutePoints = (wizardExtras.commute?.points?.length ?? 0) > 0;
    const derivedExtras: typeof wizardExtras = {
      ...wizardExtras,
      location: {
        ...(wizardExtras.location ?? {}),
        method_polygon: hasPolygon,
        method_commute: hasCommutePoints,
      },
    };
    return ({
    ...(profile ?? {}),
    layouts: selectedLayouts.length ? { values: selectedLayouts } : null,
    walkability_preferences_json: walkPrefs,
    filter_json: {
      ...(profile?.filter_json ?? {}),
      wizard: derivedExtras,
      structured_wizard: buildStructuredWizard(derivedExtras, profile, selectedLayouts),
    },
    polygon_geojson:
      locationPolygons.length === 0 || locationPolygons[0].length < 3
        ? null
        : locationPolygons.length === 1
        ? JSON.stringify({
            type: "Polygon",
            coordinates: [locationPolygons[0].map((p) => [p.lng, p.lat])],
          })
        : JSON.stringify({
            type: "MultiPolygon",
            coordinates: locationPolygons.map((poly) => [
              poly.map((p) => [p.lng, p.lat]),
            ]),
          }),
    commute_points_json: {
      points:
        wizardExtras.commute?.points?.map((p) => ({
          id: p.id,
          label: p.label,
          lat: p.lat,
          lng: p.lng,
          mode: p.mode,
          max_minutes: p.max_minutes,
          priority: p.priority,
          tolerance_minutes: p.tolerance_minutes,
          address: p.address,
          place_id: p.place_id,
          arrival_time: p.arrival_time,
        })) ?? [],
    },
  });}, [profile, selectedLayouts, walkPrefs, wizardExtras, locationPolygons]);

  const handleSaveProfile = async () => {
    if (!token || !clientId) return;
    setProfileSaving(true);
    setProfileSavedMessage(null);
    try {
      const body = buildProfileBody();
      const res = await fetch(`${API_BASE}/clients/${clientId}/profile`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ClientProfile;
      setProfile(json);
      setProfileDirty(false);
      setProfileSavedMessage("Profil uložen, přepočítávám doporučení…");
      fetch(`${API_BASE}/clients/${clientId}/recommendations/recompute`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(() =>
          fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        )
        .then((r) => (r.ok ? r.json() : []))
        .then((json) => {
          setRecs(json as RecommendationItem[]);
          setProfileSavedMessage("Profil uložen, doporučení přepočítána");
        })
        .catch(() => setProfileSavedMessage("Profil uložen (přepočet selhal)"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při ukládání profilu");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSilentSave = async () => {
    if (!token || !clientId) return;
    try {
      const body = buildProfileBody();
      const res = await fetch(`${API_BASE}/clients/${clientId}/profile`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setProfileDirty(false);
      }
    } catch {
      console.warn("[wizard] save failed, continuing navigation");
    }
  };

  const handleExplicitSave = async () => {
    if (!token || !clientId) return;
    setProfileSaving(true);
    try {
      const body = buildProfileBody();
      const res = await fetch(`${API_BASE}/clients/${clientId}/profile`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setProfileDirty(false);
      setProfileSavedMessage("Uloženo");
      setTimeout(() => setProfileSavedMessage(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při ukládání");
    } finally {
      setProfileSaving(false);
    }
  };

  // Mark profile as dirty when user edits wizard/layout/walk/polygon state.
  // Resets after explicit save or recompute.
  useEffect(() => {
    if (isFirstLoad.current) return;
    setProfileDirty(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardExtras, selectedLayouts, walkPrefs, locationPolygons]);

  // Auto-persist working filters: fires 1 s after the broker changes any filter,
  // so changes survive a refresh even without an explicit recompute.
  useEffect(() => {
    if (isFirstLoad.current) return;
    if (!token || !clientId || !hydrated || !clientModeState) return;
    const t = setTimeout(() => {
      fetch(`${API_BASE}/clients/${clientId}/client-mode/working-filters`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          workingFilters: clientModeState.workingFilters,
          modifiedKeys: clientModeState.modifiedKeys,
        }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientModeState]);

  const handleRecompute = async () => {
    if (!token || !clientId) return;
    setRecomputing(true);
    setRecomputeProgress(null);
    // Spusť polling progressu každé 1.5s
    recomputeProgressInterval.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/clients/${clientId}/recommendations/recompute/progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const data = await r.json() as { total: number; done: number; status: string };
          if (data.total > 0) setRecomputeProgress({ total: data.total, done: data.done, status: data.status });
        }
      } catch { /* ignore */ }
    }, 500);
    try {
      // Step 0: Persist the current profile so the backend sees the latest
      // wizard state (polygon, area_min, walkability, etc.) even if the 1.5 s
      // auto-save debounce hasn't fired yet.
      try {
        const body = buildProfileBody();
        const profileRes = await fetch(`${API_BASE}/clients/${clientId}/profile`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (profileRes.ok) {
          const json = (await profileRes.json()) as ClientProfile;
          setProfile(json);
        }
      } catch {
        // Best-effort — backend will use whatever is already in DB
      }

      // Step 1: Persist working filters if client-mode is active
      if (clientModeState) {
        try {
          const putRes = await fetch(
            `${API_BASE}/clients/${clientId}/client-mode/working-filters`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                workingFilters: clientModeState.workingFilters,
                modifiedKeys: clientModeState.modifiedKeys,
              }),
            },
          );
          if (putRes.ok) {
            const updated = (await putRes.json()) as ClientModeState;
            setClientModeState(updated);
          }
        } catch {
          // Ignore — backend will use whatever is already in DB
        }
      }

      // Step 2: Trigger recompute
      const res = await fetch(`${API_BASE}/clients/${clientId}/recommendations/recompute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());

      // Step 3: Parse funnel from recompute response (must happen before body is consumed)
      const recomputePayload = await res.json().catch(() => null);
      const funnel = (recomputePayload?.funnel ?? null) as RecommendationFunnel | null;
      setRecsFunnel(funnel);
      if (typeof window !== "undefined") {
        try {
          if (funnel) {
            sessionStorage.setItem(`reamar_funnel_${clientId}`, JSON.stringify(funnel));
          } else {
            sessionStorage.removeItem(`reamar_funnel_${clientId}`);
          }
        } catch {
          // ignore quota errors
        }
      }

      // Step 4: Refresh recs + marketFit in parallel
      const [recsJson, marketFitJson] = await Promise.all([
        fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetch(`${API_BASE}/clients/${clientId}/market-fit-analysis`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setRecs(recsJson as RecommendationItem[]);
      setMarketFit(marketFitJson as MarketFitAnalysis | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při přepočtu doporučení");
    } finally {
      if (recomputeProgressInterval.current) {
        clearInterval(recomputeProgressInterval.current);
        recomputeProgressInterval.current = null;
      }
      setRecomputing(false);
      setRecomputeProgress(null);
    }
  };

  const handlePin = async (recId: number, currentlyPinned: boolean) => {
    if (!token || !clientId) return;
    setRecs((prev) =>
      prev.map((r) => (r.rec_id === recId ? { ...r, pinned_by_broker: !currentlyPinned } : r))
    );
    const method = currentlyPinned ? "DELETE" : "PATCH";
    try {
      const res = await fetch(
        `${API_BASE}/clients/${clientId}/recommendations/${recId}/pin`,
        { method, headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setRecs((prev) =>
        prev.map((r) => (r.rec_id === recId ? { ...r, pinned_by_broker: currentlyPinned } : r))
      );
    }
  };

  const handleRecommendationFeedback = useCallback(
    async (
      recId: number,
      feedbackType: RecommendationFeedbackType,
      options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }
    ) => {
      if (!token || !clientId) return;
      setFeedbackSavingId(recId);
      try {
        const feedback = await putRecommendationFeedback({
          token,
          clientId,
          recId,
          feedbackType,
          dislikeReason: options?.dislikeReason ?? null,
          note: options?.note ?? null,
        });
        setRecs((prev) => prev.map((r) => (r.rec_id === recId ? { ...r, feedback } : r)));
        setFeedbackMessage(
          feedbackType === "liked"
            ? "Uloženo mezi oblíbené"
            : feedbackType === "saved"
            ? "Uloženo na později"
            : "Díky, příště budeme vybírat lépe"
        );
      } finally {
        setFeedbackSavingId(null);
      }
    },
    [token, clientId]
  );

  const clearRecommendationFeedback = useCallback(
    async (recId: number) => {
      if (!token || !clientId) return;
      setFeedbackSavingId(recId);
      try {
        await deleteRecommendationFeedback({ token, clientId, recId });
        setRecs((prev) => prev.map((r) => (r.rec_id === recId ? { ...r, feedback: null } : r)));
        setFeedbackMessage("Názor jsme změnili");
      } finally {
        setFeedbackSavingId(null);
      }
    },
    [token, clientId]
  );

  const handleActivate = useCallback(() => {
    if (!client || !profile) return;
    const derivedFilters = profileToFilters(profile);
    activate({
      clientId: client.id,
      clientName: client.name,
      derivedFilters,
      polygonGeoJson: profile.polygon_geojson ?? null,
    });
    const qs = filtersToSearchParams(derivedFilters).toString();
    router.push(`/explorer/units${qs ? `?${qs}` : ""}`);
  }, [client, profile, activate, router]);

  const handleNextStep = async (wizardStep: number, totalSteps: number, setWizardStep: (fn: (s: number) => number) => void) => {
    if (nextStepGuard.current) return;
    nextStepGuard.current = true;
    try {
      await handleSilentSave();
      setWizardStep((s: number) => (s < totalSteps ? s + 1 : s));
      if (token && clientId) {
        fetch(`${API_BASE}/clients/${clientId}/recommendations/recompute`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(() =>
            fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          )
          .then((r) => (r.ok ? r.json() : []))
          .then((json) => setRecs(json as RecommendationItem[]))
          .catch(() => {});
      }
    } finally {
      nextStepGuard.current = false;
    }
  };

  const handleAddNote = async () => {
    if (!token || !clientId || !newNoteBody.trim()) return;
    setNotesSaving(true);
    try {
      const r = await fetch(
        `${API_BASE}/clients/${clientId}/notes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            note_type: newNoteType,
            body: newNoteBody.trim(),
          }),
        }
      );
      if (r.ok) {
        const created = (await r.json()) as NoteItem;
        setNotes((prev) => [created, ...prev]);
        setNewNoteBody("");
      }
    } finally {
      setNotesSaving(false);
    }
  };

  // ─── Client Mode actions ──────────────────────────────────────────────────

  const loadClientModeState = useCallback(async () => {
    if (!token || !clientId) return null;
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/client-mode`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as ClientModeState;
      setClientModeState(json);
      return json;
    } catch {
      return null;
    }
  }, [token, clientId]);

  const updateWorkingFilter = useCallback(
    <K extends WorkingFilterKey>(key: K, value: WorkingFilters[K]) => {
      setClientModeState((prev) => {
        const base = prev ?? createClientModeStateFromProfile(profile);
        return applyWorkingFilterUpdate(base, key, value);
      });
    },
    [profile],
  );

  const saveWorkingFilters = useCallback(async () => {
    if (!token || !clientId || !clientModeState) return null;
    setClientModeSaving(true);
    try {
      const res = await fetch(
        `${API_BASE}/clients/${clientId}/client-mode/working-filters`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workingFilters: clientModeState.workingFilters,
            modifiedKeys: clientModeState.modifiedKeys,
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ClientModeState;
      setClientModeState(json);
      return json;
    } catch {
      return null;
    } finally {
      setClientModeSaving(false);
    }
  }, [token, clientId, clientModeState]);

  const resetWorkingFiltersAction = useCallback(async () => {
    if (!token || !clientId) {
      setClientModeState((prev) =>
        prev ? resetWorkingFiltersLocal(prev) : prev,
      );
      return null;
    }
    setClientModeSaving(true);
    try {
      const res = await fetch(
        `${API_BASE}/clients/${clientId}/client-mode/working-filters/reset`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        setClientModeState((prev) =>
          prev ? resetWorkingFiltersLocal(prev) : prev,
        );
        return null;
      }
      const json = (await res.json()) as ClientModeState;
      setClientModeState(json);
      return json;
    } finally {
      setClientModeSaving(false);
    }
  }, [token, clientId]);

  const handleDeleteNote = async (noteId: number) => {
    if (!token) return;
    const r = await fetch(
      `${API_BASE}/clients/${clientId}/notes/${noteId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (r.ok) {
      setNotes((prev) => prev.filter((x) => x.id !== noteId));
    }
  };

  return {
    // IDs
    clientId,
    router,
    // Data
    client,
    profile, setProfile,
    selectedLayouts, setSelectedLayouts,
    recs, setRecs,
    recsFunnel,
    loading,
    error,
    profileSaving,
    recomputing,
    recomputeProgress,
    profileSavedMessage,
    profileDirty,
    walkPrefsOpen, setWalkPrefsOpen,
    walkPrefs, setWalkPrefs,
    hydrated,
    token,
    marketFit,
    areaMarket,
    notes, setNotes,
    notesOpen, setNotesOpen,
    newNoteBody, setNewNoteBody,
    newNoteType, setNewNoteType,
    notesSaving,
    wizardExtras, setWizardExtras,
    locationPolygons, setLocationPolygons,
    activeAreaIndex, setActiveAreaIndex,
    locationProjects,
    projectsInsidePolygon,
    LAYOUT_OPTIONS,
    // Context
    activeClient,
    activate,
    // Actions
    buildProfileBody,
    handleSaveProfile,
    handleSilentSave,
    handleExplicitSave,
    handleRecompute,
    handlePin,
    handleRecommendationFeedback,
    clearRecommendationFeedback,
    feedbackSavingId,
    feedbackMessage,
    handleActivate,
    handleNextStep,
    handleAddNote,
    handleDeleteNote,
    saveWalkPrefs,
    // Client Mode (Phase 1 foundation)
    clientModeState,
    clientModeSaving,
    loadClientModeState,
    updateWorkingFilter,
    saveWorkingFilters,
    resetWorkingFilters: resetWorkingFiltersAction,
  };
}

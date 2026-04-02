"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { API_BASE } from "@/lib/api";
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
  MarketFitAnalysis,
  AreaMarketAnalysis,
  NoteItem,
  WizardExtras,
} from "@/lib/caseTypes";

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
  const [profileSavedMessage, setProfileSavedMessage] = useState<string | null>(null);

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
              mode: (p.mode as "drive" | "transit") ?? "drive",
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
            })),
          },
        }));
      }
    }
  }, [profile]);

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
    Promise.all([
      fetch(`${API_BASE}/clients/${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText)))),
      fetch(`${API_BASE}/clients/${clientId}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/clients/${clientId}/market-fit-analysis`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${clientId}/area-market-analysis`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `${API_BASE}/projects?availability=available&availability=reserved&limit=2000&sort_by=avg_price_per_m2_czk&sort_dir=asc`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/clients/${clientId}/notes`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(
        ([
          clientJson,
          profileJson,
          recsJson,
          marketFitJson,
          areaMarketJson,
          projectsOverviewJson,
          notesJson,
        ]) => {
        setClient(clientJson as ClientSummary);
        setProfile((profileJson || null) as ClientProfile | null);
        setRecs((recsJson || []) as RecommendationItem[]);
        setMarketFit((marketFitJson || null) as MarketFitAnalysis | null);
        setAreaMarket((areaMarketJson || null) as AreaMarketAnalysis | null);
        setNotes((notesJson || []) as NoteItem[]);
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
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [clientId, token, hydrated]);

  const buildProfileBody = useCallback((): ClientProfile => ({
    ...(profile ?? {}),
    layouts: selectedLayouts.length ? { values: selectedLayouts } : null,
    walkability_preferences_json: walkPrefs,
    filter_json: {
      ...(profile?.filter_json ?? {}),
      wizard: wizardExtras,
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
        })) ?? [],
    },
  }), [profile, selectedLayouts, walkPrefs, wizardExtras, locationPolygons]);

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
        const json = (await res.json()) as ClientProfile;
        setProfile(json);
      }
    } catch {
      console.warn("[wizard] auto-save failed, continuing navigation");
    }
  };

  const handleRecompute = async () => {
    if (!token || !clientId) return;
    setRecomputing(true);
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/recommendations/recompute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      await fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((json) => setRecs(json as RecommendationItem[]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při přepočtu doporučení");
    } finally {
      setRecomputing(false);
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
    loading,
    error,
    profileSaving,
    recomputing,
    profileSavedMessage,
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
    handleRecompute,
    handlePin,
    handleActivate,
    handleNextStep,
    handleAddNote,
    handleDeleteNote,
    saveWalkPrefs,
  };
}

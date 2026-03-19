"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import { API_BASE } from "@/lib/api";
import { profileToFilters } from "@/lib/clientFilters";
import { filtersToSearchParams } from "@/lib/filters";
import { useActiveClient } from "@/contexts/ActiveClientContext";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import type { WalkabilityPreferences } from "@/lib/walkabilityPreferences";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import { WalkabilityPreferencesGroup } from "@/components/WalkabilityPreferencesGroup";
import { ClientLocationMap, type LocationProjectPoint } from "@/components/ClientLocationMap";
import {
  InfoBox,
  ReamarButton,
  ReamarCard,
  ReamarSubtleCard,
  StatCard,
  reamarInputClass,
  reamarLabelClass,
  reamarSelectClass,
} from "@/components/ui/reamar-ui";
import { WizardSteps } from "@/components/ui/WizardSteps";
import {
  DEFAULT_PREFERENCES,
  getDefaultPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
} from "@/lib/walkabilityPreferences";
import { parseFiltersFromSearchParams, type CurrentFilters } from "@/lib/filters";
import { isPointInPolygon } from "@/lib/geo";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

type ClientSummary = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  broker_id: number;
  created_at: string;
  updated_at: string;
  recommendations_count: number;
  notes?: string | null;
};

type ClientProfile = {
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  layouts?: { values?: string[] } | null;
  property_type?: string | null;
  purchase_purpose?: string | null;
  walkability_preferences_json?: WalkabilityPreferences | null;
  filter_json?: any | null;
  polygon_geojson?: string | null;
  commute_points_json?: Record<string, unknown> | null;
};

type RecommendationItem = {
  rec_id: number;
  pinned_by_broker: boolean;
  unit_external_id: string | null;
  project_id: number | null;
  project_name?: string | null;
  layout?: string | null;
  layout_label?: string | null;
  floor_area_m2?: number | null;
  price_czk?: number | null;
  price_per_m2_czk?: number | null;
  floor?: number | null;
  score: number;
  budget_fit: number;
  walkability_fit: number;
  location_fit: number;
  layout_fit: number;
  area_fit: number;
  outdoor_fit: number;
  reason?: Record<string, unknown> | null;
};

type MarketFitBlocker = {
  key: string;
  label: string;
  blocked_count: number;
  blocked_percentage: number;
};

type RelaxationSuggestion = {
  label: string;
  matching_units_count: number;
  delta_vs_current: number;
};

type MarketFitAnalysis = {
  client_id: number;
  matching_units_count: number;
  available_units_count: number;
  top_blockers: MarketFitBlocker[];
  relaxation_suggestions: RelaxationSuggestion[];
};

type AreaMarketAnalysis = {
  client_id: number;
  projects_count: number;
  active_units_count: number;
  matching_units_count: number;
  avg_price_czk: number | null;
  avg_price_per_m2_czk: number | null;
  min_price_czk: number | null;
  max_price_czk: number | null;
  avg_floor_area_m2: number | null;
  layout_distribution: Record<string, number>;
  budget_fit_units_count: number;
  area_fit_units_count: number;
};

function scoreLabel(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: "Výborné", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= 60) return { label: "Dobré",   cls: "bg-blue-100 text-blue-800" };
  if (score >= 40) return { label: "OK",      cls: "bg-amber-100 text-amber-800" };
  return                    { label: "Slabé",  cls: "bg-slate-100 text-slate-600" };
}

function FitDot({ value, title }: { value: number; title: string }) {
  const color =
    value >= 70 ? "bg-emerald-400" : value >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <span title={`${title}: ${Math.round(value)}`} className={`inline-block h-2 w-2 rounded-full ${color}`} />
  );
}

/** Segmented 3-way toggle for Neřeším / Preferuji / Musí být preference fields. */
function PrefToggle({
  value,
  onChange,
  preferLabel = "Preferuji",
  mustLabel = "Musí být",
}: {
  value: string;
  onChange: (v: string) => void;
  preferLabel?: string;
  mustLabel?: string;
}) {
  const opts = [
    { v: "ignore", label: "Neřeším",   activeClass: "bg-white text-slate-700 shadow-sm" },
    { v: "prefer", label: preferLabel, activeClass: "bg-violet-100 text-violet-900 shadow-sm" },
    { v: "must",   label: mustLabel,   activeClass: "bg-slate-900 text-white shadow-sm" },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100/60 p-0.5">
      {opts.map(({ v, label, activeClass }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
            value === v ? activeClass : "text-slate-400 hover:text-slate-600"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = Number(params?.id);
  const { activate, activeClient } = useActiveClient();

  const TOTAL_WIZARD_STEPS = 7;

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
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [marketFit, setMarketFit] = useState<MarketFitAnalysis | null>(null);
  const [areaMarket, setAreaMarket] = useState<AreaMarketAnalysis | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // ── Notes ──
  type NoteItem = {
    id: number;
    client_id: number;
    broker_id: number;
    note_type: string;
    body: string;
    created_at: string;
  };
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [newNoteType, setNewNoteType] = useState<"internal" | "meeting" | "call">("internal");
  const [notesSaving, setNotesSaving] = useState(false);

  type Priority = "must" | "prefer" | "ignore";

  type WizardExtras = {
    location?: {
      walkability?: Priority;
      noise_sensitivity?: Priority;
      project_size?: "small" | "medium" | "large" | "ignore";
      urban_vs_quiet?: "quiet" | "urban" | "ignore";
      method_polygon?: boolean;
      method_commute?: boolean;
      method_admin?: boolean;
      administrative_area?: string | null;
      administrative_region?: string | null;
    };
    budget?: {
      ideal_price?: number | null;
      max_price?: number | null;
      tolerate_plus_10?: boolean;
      ideal_area?: number | null;
      min_area?: number | null;
      tolerate_minus_10?: boolean;
      payment_schedule?: "upfront" | "during_construction" | "on_completion" | "ignore";
    };
    standards?: {
      rekuperace?: Priority;
      floor_heating?: Priority;
      external_blinds?: Priority;
      air_conditioning?: Priority;
      cellar?: Priority;
      parking?: Priority;
    };
    outdoor?: {
      balcony?: Priority;
      terrace?: Priority;
      garden?: Priority;
      anything_ok?: Priority;
      min_outdoor_area_m2?: number | null;
      preferred_floor?: "ground" | "low" | "middle" | "high" | "ignore";
      ground_floor_sensitive?: Priority;
      orientation?: {
        south?: Priority;
        west?: Priority;
        east?: Priority;
        north?: Priority;
      };
    };
    noise?: {
      quiet_area?: Priority;
      main_road?: Priority;
      tram?: Priority;
      railway?: Priority;
      airport?: Priority;
    };
    house_amenities?: {
      parking?: Priority;
      cellar?: Priority;
      bike_room?: Priority;
      stroller_room?: Priority;
      fitness?: Priority;
      shared_garden?: Priority;
      concierge?: Priority;
    };
    character?: {
      project_size?: "small" | "medium" | "large" | "ignore";
      calm_vs_city?: "calm" | "city" | "ignore";
      privacy_vs_services?: "privacy" | "services" | "ignore";
    };
    renovation_preference?: "any" | "prefer_new" | "only_new" | "prefer_renovation" | "only_renovation";
    commute?: {
      points?: {
        id: string;
        label: string;
        lat: number | null;
        lng: number | null;
        mode: "drive" | "transit";
        max_minutes: number | null;
        priority: "must_have" | "prefer" | "ignore";
        tolerance_minutes?: number | null;
        address?: string | null;
        place_id?: string | null;
      }[];
    };
  };

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

  const buildProfileBody = (): ClientProfile => ({
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
  });

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
      // Auto-recompute after save
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

  const handleNext = async () => {
    if (nextStepGuard.current) return;
    nextStepGuard.current = true;
    try {
      await handleSilentSave();
      setWizardStep((s) => (s < TOTAL_WIZARD_STEPS ? s + 1 : s));
      // Auto-recompute in background after navigating
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
    // Optimistic update
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
      // Revert on error
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
    router.push(`/units${qs ? `?${qs}` : ""}`);
  }, [client, profile, activate, router]);

  const mustHaveSummary: string[] = [];
  const preferSummary: string[] = [];

  const standardLabels: Record<string, string> = {
    rekuperace: "Rekuperace",
    floor_heating: "Podlahové vytápění",
    external_blinds: "Předokenní žaluzie",
    air_conditioning: "Klimatizace",
    cellar: "Sklep",
    parking: "Parkování",
  };

  if (wizardExtras.standards) {
    Object.entries(wizardExtras.standards).forEach(([key, value]) => {
      const label = standardLabels[key] ?? key;
      if (value === "must") {
        mustHaveSummary.push(`${label}: musí být`);
      } else if (value === "prefer") {
        preferSummary.push(`${label}: preferuji`);
      }
    });
  }

  const outdoorLabels: Record<string, string> = {
    balcony: "Balkon",
    terrace: "Terasa",
    garden: "Zahrada",
  };

  if (wizardExtras.outdoor) {
    Object.entries(outdoorLabels).forEach(([key, label]) => {
      const value = (wizardExtras.outdoor as any)[key] as Priority | undefined;
      if (value === "must") {
        mustHaveSummary.push(`${label}: musí být`);
      } else if (value === "prefer") {
        preferSummary.push(`${label}: preferuji`);
      }
    });

    if (wizardExtras.outdoor.min_outdoor_area_m2 != null) {
      preferSummary.push(
        `Minimální venkovní plocha: ${wizardExtras.outdoor.min_outdoor_area_m2} m²`
      );
    }

    if (wizardExtras.outdoor.preferred_floor && wizardExtras.outdoor.preferred_floor !== "ignore") {
      const floorMap: Record<string, string> = {
        ground: "Přízemí",
        low: "Nižší patra",
        middle: "Střední patra",
        high: "Vyšší patra",
      };
      const label = floorMap[wizardExtras.outdoor.preferred_floor];
      if (label) {
        preferSummary.push(`Preferované patro: ${label}`);
      }
    }

    if (wizardExtras.outdoor.ground_floor_sensitive === "must") {
      mustHaveSummary.push("Vadí přízemí: musí se vyhnout přízemí");
    } else if (wizardExtras.outdoor.ground_floor_sensitive === "prefer") {
      preferSummary.push("Vadí přízemí: preferuje vyšší patro");
    }

    if (wizardExtras.outdoor.orientation) {
      const orientationLabels: Record<string, string> = {
        south: "Jih",
        west: "Západ",
        east: "Východ",
        north: "Sever",
      };
      Object.entries(orientationLabels).forEach(([key, label]) => {
        const value = (wizardExtras.outdoor!.orientation as any)[key] as Priority | undefined;
        if (value === "must") {
          mustHaveSummary.push(`Orientace ${label}: musí být`);
        } else if (value === "prefer") {
          preferSummary.push(`Orientace ${label}: preferuji`);
        }
      });
    }
  }

  const noiseLabels: Record<string, string> = {
    quiet_area: "Klidná lokalita",
    main_road: "Hlavní silnice",
    tram: "Tramvaj",
    railway: "Železnice",
    airport: "Letiště",
  };

  if (wizardExtras.noise) {
    Object.entries(noiseLabels).forEach(([key, label]) => {
      const value = (wizardExtras.noise as any)[key] as Priority | undefined;
      if (value === "must") {
        mustHaveSummary.push(`${label}: musí se vyhnout`);
      } else if (value === "prefer") {
        preferSummary.push(`${label}: citlivý/á`);
      }
    });
  }

  const houseAmenityLabels: Record<string, string> = {
    parking: "Parkování",
    cellar: "Sklep",
    bike_room: "Kolárna",
    stroller_room: "Kočárkárna",
    fitness: "Fitness v projektu",
    shared_garden: "Společná zahrada / vnitroblok",
    concierge: "Recepce / concierge",
  };

  if (wizardExtras.house_amenities) {
    Object.entries(houseAmenityLabels).forEach(([key, label]) => {
      const value = (wizardExtras.house_amenities as any)[key] as Priority | undefined;
      if (value === "must") {
        mustHaveSummary.push(`${label}: musí být`);
      } else if (value === "prefer") {
        preferSummary.push(`${label}: preferuji`);
      }
    });
  }

  if (wizardExtras.character) {
    const { project_size, calm_vs_city, privacy_vs_services } = wizardExtras.character;
    if (project_size && project_size !== "ignore") {
      const sizeLabels: Record<string, string> = { small: "Menší projekt", medium: "Střední projekt", large: "Větší projekt" };
      preferSummary.push(`Velikost projektu: ${sizeLabels[project_size] ?? project_size}`);
    }
    if (calm_vs_city && calm_vs_city !== "ignore") {
      preferSummary.push(calm_vs_city === "calm" ? "Charakter: spíše klid" : "Charakter: spíše městský život");
    }
    if (privacy_vs_services && privacy_vs_services !== "ignore") {
      preferSummary.push(privacy_vs_services === "privacy" ? "Okolí: více soukromí" : "Okolí: více služeb v okolí");
    }
  }

  if (wizardExtras.budget?.payment_schedule && wizardExtras.budget.payment_schedule !== "ignore") {
    const paymentLabels: Record<string, string> = {
      upfront: "Vyšší část při podpisu",
      during_construction: "Více během výstavby",
      on_completion: "Co nejvíce až po dokončení",
    };
    const label = paymentLabels[wizardExtras.budget.payment_schedule];
    if (label) {
      preferSummary.push(`Financování: ${label}`);
    }
  }

  if (!hydrated) {
    // Stejný výstup pro SSR i první klientský render – vyhneme se hydration mismatch.
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">
          Načítání…
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">
          Nejste přihlášen. Přejděte na{" "}
          <Link href="/login" className="text-slate-900 underline">
            /login
          </Link>
          .
        </div>
      </div>
    );
  }

  const stepMeta: Record<
    number,
    {
      title: string;
    }
  > = {
    1: {
      title: "Lokalita – zvolený přístup",
    },
    2: {
      title: "Lokalita – konkrétní oblasti",
    },
    3: {
      title: "Dispozice a typ bydlení",
    },
    4: {
      title: "Rozpočet a parametry",
    },
    5: {
      title: "Standardy a technologie",
    },
    6: {
      title: "Charakter projektu a okolí",
    },
    7: {
      title: "Shrnutí profilu",
    },
  };

  const currentStepMeta =
    stepMeta[wizardStep] ??
    stepMeta[1];

  return (
    <div className="flex min-h-screen flex-col bg-slate-900/5">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10">
        {loading ? (
          <p className="text-sm text-slate-600">Načítání…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : !client ? (
          <p className="text-sm text-slate-600">Klient nenalezen.</p>
        ) : (
          <>
            <WizardSteps
              currentStep={wizardStep}
              setCurrentStep={setWizardStep}
              totalSteps={TOTAL_WIZARD_STEPS}
            />

            <div className="space-y-5">
              <section className="w-full">
                <ReamarCard className="px-6 py-5 md:px-10 md:py-6">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <nav className="text-[11px] text-slate-500">
                        <Link href="/clients" className="hover:underline">
                          Klienti
                        </Link>{" "}
                        / <span className="text-slate-700">{client.name}</span>
                      </nav>
                      <h2 className="text-lg font-semibold text-slate-900">{client.name}</h2>
                      {profileSavedMessage && (
                        <p className="text-xs text-emerald-600">{profileSavedMessage}</p>
                      )}
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 md:flex">
                      {activeClient?.clientId === client.id ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Aktivní klient
                        </span>
                      ) : (
                        <ReamarButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleActivate}
                          disabled={!profile}
                          title="Aktivovat klientský mód"
                        >
                          Aktivovat klienta
                        </ReamarButton>
                      )}
                      <ReamarButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/clients/${clientId}/present`)}
                      >
                        Schůzka →
                      </ReamarButton>
                      <ReamarButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`/clients/${clientId}/report`, "_blank")}
                      >
                        PDF
                      </ReamarButton>
                      <ReamarButton
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleRecompute}
                        disabled={recomputing}
                      >
                        {recomputing ? "Přepočítávám…" : "Přepočítat"}
                      </ReamarButton>
                    </div>
                  </div>
                  <h3 className="mb-2 text-base font-semibold text-slate-900">
                    {currentStepMeta.title}
                  </h3>

                  <div className="space-y-8 text-sm transition-opacity duration-200">
                  {wizardStep === 1 && (
                    <div className="space-y-6">
                      <div className="grid gap-4 md:grid-cols-3">
                        {[
                          {
                            key: "method_polygon",
                            title: "Polygon na mapě",
                            desc: "Vymezíte přesnou oblast, kde klient opravdu chce bydlet.",
                          },
                          {
                            key: "method_commute",
                            title: "Dojíždění do práce / školy",
                            desc: "Lokalitu odvodíme podle dojezdových časů na klíčová místa.",
                          },
                          {
                            key: "method_admin",
                            title: "Obvod / okres / kraj",
                            desc: "Pracujete s administrativními celky a známými názvy oblastí.",
                          },
                        ].map(({ key, title, desc }) => {
                          const checked = (wizardExtras.location as any)?.[key] ?? false;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  location: {
                                    ...(prev.location ?? {}),
                                    [key]: !checked,
                                  },
                                }))
                              }
                              className={`flex h-full min-h-[148px] flex-col items-start rounded-3xl border px-5 py-4 text-left transition-colors ${
                                checked
                                  ? "border-indigo-400 bg-white ring-2 ring-indigo-300/40 shadow-sm"
                                  : "border-slate-200/90 bg-slate-50/90 hover:border-slate-300 hover:bg-white"
                              }`}
                            >
                              <div className="mb-1 flex w-full items-center justify-between gap-2">
                                <span
                                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                                    checked
                                      ? "border-indigo-500 bg-indigo-500 text-white"
                                      : "border-slate-300 bg-white text-slate-500"
                                  }`}
                                >
                                  {checked ? "✓" : ""}
                                </span>
                                <span className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-70">
                                  Metoda lokality
                                </span>
                              </div>
                              <div className="space-y-0.5">
                                <p
                                  className={`text-sm font-semibold ${
                                    checked ? "text-indigo-800" : "text-slate-900"
                                  }`}
                                >
                                  {title}
                                </p>
                                <p
                                  className={`text-xs ${
                                    checked ? "text-indigo-600/80" : "text-slate-600"
                                  }`}
                                >
                                  {desc}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Můžete kombinovat více metod najednou. Například polygon pro preferované čtvrti
                        a zároveň dojíždění do školy.
                      </p>
                    </div>
                  )}

                  {wizardStep === 2 && (
                    <div className="space-y-6">
                      <h4 className="text-lg font-semibold text-slate-900">Lokalita v mapě</h4>
                      <div className="grid gap-3 rounded-2xl bg-slate-50/70 p-3 text-[11px] text-slate-700 md:grid-cols-3">
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">Zvolené metody lokality</p>
                          <ul className="list-disc pl-4">
                            {(wizardExtras.location?.method_polygon ?? true) && (
                              <li>Polygon v mapě</li>
                            )}
                            {wizardExtras.location?.method_commute && <li>Dojíždění na klíčová místa</li>}
                            {wizardExtras.location?.method_admin && <li>Obvody / okresy / kraje</li>}
                          </ul>
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">Trh v oblasti</p>
                          {areaMarket ? (
                            <>
                              <p>
                                {areaMarket.projects_count} projektů · {areaMarket.active_units_count} aktivních jednotek
                              </p>
                              <p>
                                {areaMarket.matching_units_count} jednotek odpovídá aktuálnímu profilu klienta
                              </p>
                            </>
                          ) : (
                            <p className="text-slate-500">
                              Po uložení profilu a zakreslení oblasti se zobrazí přehled trhu.
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">Jak mapu používat na schůzce</p>
                          <p>
                            Ptejte se, které oblasti jsou „určitě ano“, které „spíše ne“ a kam se klient rozhodně nechce
                            stěhovat. Polygon vždy odpovídá zóně, kde by se makléř měl aktivně dívat po projektech.
                          </p>
                        </div>
                      </div>
                      {(wizardExtras.location?.method_polygon ?? true) && (
                        <ReamarSubtleCard className="space-y-3 p-3">
                          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Polygon na mapě
                          </h5>
                          <p className="text-xs text-slate-600">
                            Klikáním do mapy zakreslíte oblasti, kde si klient dokáže bydlení reálně
                            představit. Můžete vytvořit i více oblastí.
                          </p>
                          <ClientLocationMap
                            areas={locationPolygons}
                            activeAreaIndex={activeAreaIndex}
                            projects={locationProjects}
                            onChange={(next) => {
                              setLocationPolygons(next);
                              if (activeAreaIndex >= next.length) {
                                setActiveAreaIndex(Math.max(0, next.length - 1));
                              }
                            }}
                            onActiveAreaChange={setActiveAreaIndex}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <ReamarButton
                                type="button"
                                variant="subtle"
                                size="sm"
                                onClick={() => {
                                  setLocationPolygons((prev) => {
                                    const next = [...prev, []];
                                    setActiveAreaIndex(next.length - 1);
                                    return next;
                                  });
                                }}
                              >
                                Přidat oblast
                              </ReamarButton>
                              {locationPolygons.length > 0 && (
                                <ReamarButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setLocationPolygons((prev) => {
                                      if (!prev.length) return prev;
                                      const next = prev.filter((_, idx) => idx !== activeAreaIndex);
                                      if (!next.length) {
                                        setActiveAreaIndex(0);
                                        return [];
                                      }
                                      const clamped = Math.min(activeAreaIndex, next.length - 1);
                                      setActiveAreaIndex(clamped);
                                      return next;
                                    });
                                  }}
                                >
                                  Odebrat oblast
                                </ReamarButton>
                              )}
                              {locationPolygons.some((p) => p.length > 0) && (
                                <ReamarButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setLocationPolygons([]);
                                    setActiveAreaIndex(0);
                                  }}
                                >
                                  Smazat vše
                                </ReamarButton>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {locationPolygons.some((p) => p.length >= 3) && (
                                <span className="text-[11px] text-slate-500">
                                  {projectsInsidePolygon}{" "}
                                  {projectsInsidePolygon === 1
                                    ? "projekt"
                                    : projectsInsidePolygon >= 2 && projectsInsidePolygon <= 4
                                    ? "projekty"
                                    : "projektů"}{" "}
                                  uvnitř oblasti
                                </span>
                              )}
                            {locationPolygons.length > 1 && (
                              <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                                <span>Aktivní oblast:</span>
                                {locationPolygons.map((_, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setActiveAreaIndex(idx)}
                                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                                      idx === activeAreaIndex
                                        ? "bg-slate-900 text-white"
                                        : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {idx + 1}
                                  </button>
                                ))}
                              </div>
                            )}
                            </div>
                          </div>
                        </ReamarSubtleCard>
                      )}

                      {wizardExtras.location?.method_admin && (
                        <ReamarSubtleCard className="space-y-3 p-3">
                          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Obvod / okres / kraj
                          </h5>
                          <p className="text-xs text-slate-600">
                            Pokud klient přemýšlí v pojmech &quot;Praha 6&quot;, &quot;okres Beroun&quot;
                            nebo &quot;Středočeský kraj&quot;, zapište je sem.
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className={reamarLabelClass}>
                                Preferované obvody / okresy
                              </label>
                              <input
                                type="text"
                                value={wizardExtras.location?.administrative_area ?? ""}
                                onChange={(e) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    location: {
                                      ...(prev.location ?? {}),
                                      administrative_area: e.target.value || null,
                                    },
                                  }))
                                }
                                className={cn("mt-1 text-xs", reamarInputClass)}
                                placeholder="Např. Praha 6, Praha-západ, okres Beroun"
                              />
                            </div>
                            <div>
                              <label className={reamarLabelClass}>
                                Region / kraj
                              </label>
                              <input
                                type="text"
                                value={wizardExtras.location?.administrative_region ?? ""}
                                onChange={(e) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    location: {
                                      ...(prev.location ?? {}),
                                      administrative_region: e.target.value || null,
                                    },
                                  }))
                                }
                                className={cn("mt-1 text-xs", reamarInputClass)}
                                placeholder="Např. Praha, Středočeský kraj"
                              />
                            </div>
                          </div>
                        </ReamarSubtleCard>
                      )}

                      {wizardExtras.location?.method_commute && (
                        <ReamarSubtleCard className="space-y-2 border-dashed p-3">
                          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Dojíždění do práce / školy
                          </h5>
                          <p className="text-xs text-slate-600">
                            V dalším kroku dotazníku máte detailní sekci pro zadání klíčových míst a
                            maximálního času dojíždění. Zde stačí potvrdit, že dojíždění je pro klienta
                            relevantní vstup.
                          </p>
                        </ReamarSubtleCard>
                      )}

                      {/* ── Walkability preferences (inline) ── */}
                      <div className="space-y-4 rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="text-xs font-semibold text-slate-900">
                            Walkability – dostupnost v okolí
                          </h5>
                          <div className="flex gap-1">
                            {[
                              {
                                label: "Rodina",
                                prefs: {
                                  ...DEFAULT_PREFERENCES,
                                  playground: "high" as const,
                                  kindergarten: "high" as const,
                                  primary_school: "high" as const,
                                  park: "high" as const,
                                  supermarket: "high" as const,
                                  restaurant: "ignore" as const,
                                  cafe: "ignore" as const,
                                  fitness: "ignore" as const,
                                },
                              },
                              {
                                label: "Městský život",
                                prefs: {
                                  ...DEFAULT_PREFERENCES,
                                  restaurant: "high" as const,
                                  cafe: "high" as const,
                                  metro: "high" as const,
                                  tram: "high" as const,
                                  bus: "high" as const,
                                  supermarket: "high" as const,
                                  playground: "ignore" as const,
                                  kindergarten: "ignore" as const,
                                  primary_school: "ignore" as const,
                                },
                              },
                              {
                                label: "Klid a zeleň",
                                prefs: {
                                  ...DEFAULT_PREFERENCES,
                                  park: "high" as const,
                                  metro: "ignore" as const,
                                  tram: "ignore" as const,
                                  restaurant: "ignore" as const,
                                  cafe: "ignore" as const,
                                  fitness: "ignore" as const,
                                },
                              },
                            ].map(({ label, prefs }) => (
                              <button
                                key={label}
                                type="button"
                                onClick={() => setWalkPrefs(prefs)}
                                className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 hover:border-slate-500 hover:text-slate-900"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <WalkabilityPreferencesGroup
                          title="Služby a příroda"
                          items={[
                            { key: "supermarket", label: "Supermarket" },
                            { key: "pharmacy", label: "Lékárna" },
                            { key: "park", label: "Park" },
                            { key: "restaurant", label: "Restaurace" },
                            { key: "cafe", label: "Kavárna" },
                            { key: "fitness", label: "Fitness" },
                          ]}
                          prefs={walkPrefs}
                          onChange={setWalkPrefs}
                        />
                        <WalkabilityPreferencesGroup
                          title="Vzdělávání a rodina"
                          items={[
                            { key: "playground", label: "Hřiště" },
                            { key: "kindergarten", label: "Školka" },
                            { key: "primary_school", label: "ZŠ" },
                          ]}
                          prefs={walkPrefs}
                          onChange={setWalkPrefs}
                        />
                        <WalkabilityPreferencesGroup
                          title="Doprava"
                          items={[
                            { key: "metro", label: "Metro" },
                            { key: "tram", label: "Tramvaj" },
                            { key: "bus", label: "Bus" },
                          ]}
                          prefs={walkPrefs}
                          onChange={setWalkPrefs}
                        />
                      </div>
                    </div>
                  )}

                  {wizardStep === 4 && (
                    <div className="space-y-6">
                      <h4 className="text-sm font-semibold text-slate-900">
                        Rozpočet a velikost bytu
                      </h4>
                      <div>
                        <label className={reamarLabelClass}>
                          Ideální cena (Kč)
                        </label>
                        <input
                          type="number"
                          value={wizardExtras.budget?.ideal_price ?? ""}
                          onChange={(e) =>
                            setWizardExtras((prev) => ({
                              ...prev,
                              budget: {
                                ...(prev.budget ?? {}),
                                ideal_price: e.target.value ? Number(e.target.value) : null,
                              },
                            }))
                          }
                          className={cn("mt-1", reamarInputClass)}
                          placeholder="Např. 8 500 000"
                        />
                        {wizardExtras.budget?.ideal_price != null && (
                          <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(wizardExtras.budget.ideal_price)}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={reamarLabelClass}>
                            Maximální cena (Kč)
                          </label>
                          <input
                            type="number"
                            value={profile?.budget_max ?? ""}
                            onChange={(e) =>
                              setProfile((prev) => ({
                                ...(prev ?? {}),
                                budget_max: e.target.value ? Number(e.target.value) : null,
                              }))
                            }
                            className={cn("mt-1", reamarInputClass)}
                            placeholder="Absolutní strop"
                          />
                          {profile?.budget_max != null && (
                            <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(profile.budget_max)}</p>
                          )}
                        </div>
                        <div>
                          <label className={reamarLabelClass}>
                            Tolerance +10 %
                          </label>
                          <select
                            value={
                              wizardExtras.budget?.tolerate_plus_10 === true
                                ? "yes"
                                : wizardExtras.budget?.tolerate_plus_10 === false
                                ? "no"
                                : "ignore"
                            }
                            onChange={(e) =>
                              setWizardExtras((prev) => ({
                                ...prev,
                                budget: {
                                  ...(prev.budget ?? {}),
                                  tolerate_plus_10:
                                    e.target.value === "ignore"
                                      ? undefined
                                      : e.target.value === "yes",
                                },
                              }))
                            }
                            className={cn("mt-1", reamarSelectClass)}
                          >
                            <option value="ignore">Neřeším</option>
                            <option value="yes">Klient toleruje +10 %</option>
                            <option value="no">Netoleruje navýšení</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className={reamarLabelClass}>
                          Preferovaný platební kalendář
                        </label>
                        <select
                          value={wizardExtras.budget?.payment_schedule ?? "ignore"}
                          onChange={(e) =>
                            setWizardExtras((prev) => ({
                              ...prev,
                              budget: {
                                ...(prev.budget ?? {}),
                                payment_schedule: e.target.value as
                                  | "upfront"
                                  | "during_construction"
                                  | "on_completion"
                                  | "ignore",
                              },
                            }))
                          }
                          className={cn("mt-1", reamarSelectClass)}
                        >
                          <option value="ignore">Neřeším</option>
                          <option value="upfront">Vyšší část při podpisu</option>
                          <option value="during_construction">Více během výstavby</option>
                          <option value="on_completion">Co nejvíce až po dokončení</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {wizardStep === 3 && (
                    <div className="space-y-6">
                      {/* ── Typ a dispozice ── */}
                      <div className="space-y-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ a dispozice</p>
                        <div>
                          <label className={reamarLabelClass}>Dispozice (více možností)</label>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {LAYOUT_OPTIONS.map((opt) => {
                              const checked = selectedLayouts.includes(opt.value);
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() =>
                                    setSelectedLayouts((prev) =>
                                      checked
                                        ? prev.filter((v) => v !== opt.value)
                                        : Array.from(new Set([...prev, opt.value]))
                                    )
                                  }
                                  className={cn(
                                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                    checked
                                      ? "border-slate-900 bg-slate-900 text-white"
                                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                                  )}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={reamarLabelClass}>Typ nemovitosti</label>
                            <select
                              value={profile?.property_type ?? "any"}
                              onChange={(e) =>
                                setProfile((prev) => ({
                                  ...(prev ?? {}),
                                  property_type: e.target.value,
                                }))
                              }
                              className={cn("mt-1", reamarSelectClass)}
                            >
                              <option value="any">Neřeším</option>
                              <option value="apartment">Byt</option>
                              <option value="house">Dům</option>
                            </select>
                          </div>
                          <div>
                            <label className={reamarLabelClass}>Účel nákupu</label>
                            <select
                              value={profile?.purchase_purpose ?? "own_use"}
                              onChange={(e) =>
                                setProfile((prev) => ({
                                  ...(prev ?? {}),
                                  purchase_purpose: e.target.value,
                                }))
                              }
                              className={cn("mt-1", reamarSelectClass)}
                            >
                              <option value="own_use">Vlastní bydlení</option>
                              <option value="investment">Investice</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* ── Novostavba / rekonstrukce ── */}
                      <div className="space-y-2">
                        <label className={reamarLabelClass}>Novostavba vs. rekonstrukce</label>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              { value: "any",               label: "Neřeším" },
                              { value: "prefer_new",        label: "Spíše novostavba" },
                              { value: "only_new",          label: "Jen novostavba" },
                              { value: "prefer_renovation", label: "Spíše rekonstrukce" },
                              { value: "only_renovation",   label: "Jen rekonstrukce" },
                            ] as const
                          ).map(({ value, label }) => {
                            const active = (wizardExtras.renovation_preference ?? "any") === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    renovation_preference: value,
                                  }))
                                }
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                  active
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                                )}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── Plocha ── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Plocha</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={reamarLabelClass}>Minimální (m²)</label>
                            <input
                              type="number"
                              value={profile?.area_min ?? ""}
                              onChange={(e) =>
                                setProfile((prev) => ({
                                  ...(prev ?? {}),
                                  area_min: e.target.value ? Number(e.target.value) : null,
                                }))
                              }
                              className={cn("mt-1", reamarInputClass)}
                              placeholder="Absolutní minimum"
                            />
                            {profile?.area_min != null && (
                              <p className="mt-1 text-xs text-slate-500">{formatAreaM2(profile.area_min)}</p>
                            )}
                          </div>
                          <div>
                            <label className={reamarLabelClass}>Maximální (m²)</label>
                            <input
                              type="number"
                              value={profile?.area_max ?? ""}
                              onChange={(e) =>
                                setProfile((prev) => ({
                                  ...(prev ?? {}),
                                  area_max: e.target.value ? Number(e.target.value) : null,
                                }))
                              }
                              className={cn("mt-1", reamarInputClass)}
                              placeholder="Horní limit"
                            />
                            {profile?.area_max != null && (
                              <p className="mt-1 text-xs text-slate-500">{formatAreaM2(profile.area_max)}</p>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className={reamarLabelClass}>Ideální plocha (m²)</label>
                          <input
                            type="number"
                            value={wizardExtras.budget?.ideal_area ?? ""}
                            onChange={(e) =>
                              setWizardExtras((prev) => ({
                                ...prev,
                                budget: {
                                  ...(prev.budget ?? {}),
                                  ideal_area: e.target.value ? Number(e.target.value) : null,
                                },
                              }))
                            }
                            className={cn("mt-1", reamarInputClass)}
                            placeholder="Např. 75"
                          />
                          {wizardExtras.budget?.ideal_area != null && (
                            <p className="mt-1 text-xs text-slate-500">{formatAreaM2(wizardExtras.budget.ideal_area)}</p>
                          )}
                        </div>
                      </div>

                      {/* ── Venkovní prostor ── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Venkovní prostor</p>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          {[
                            ["balcony", "Balkon"],
                            ["terrace", "Terasa"],
                            ["garden", "Zahrada"],
                          ].map(([key, label]) => (
                            <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <span className="text-sm text-slate-700">{label}</span>
                              <PrefToggle
                                value={(wizardExtras.outdoor as any)?.[key] ?? "ignore"}
                                onChange={(v) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    outdoor: { ...(prev.outdoor ?? {}), [key]: v as Priority },
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={reamarLabelClass}>Min. venkovní plocha (m²)</label>
                            <input
                              type="number"
                              value={wizardExtras.outdoor?.min_outdoor_area_m2 ?? ""}
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  outdoor: {
                                    ...(prev.outdoor ?? {}),
                                    min_outdoor_area_m2: e.target.value ? Number(e.target.value) : null,
                                  },
                                }))
                              }
                              className={cn("mt-1", reamarInputClass)}
                              placeholder="Např. 10"
                            />
                          </div>
                        </div>
                      </div>

                      {/* ── Patro a orientace ── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Patro a orientace</p>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-slate-700">Vadí přízemí</span>
                            <PrefToggle
                              value={wizardExtras.outdoor?.ground_floor_sensitive ?? "ignore"}
                              onChange={(v) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  outdoor: { ...(prev.outdoor ?? {}), ground_floor_sensitive: v as Priority },
                                }))
                              }
                              preferLabel="Spíše vadí"
                              mustLabel="Musí se vyhnout"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-slate-700">Preferované patro</span>
                            <select
                              value={wizardExtras.outdoor?.preferred_floor ?? "ignore"}
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  outdoor: {
                                    ...(prev.outdoor ?? {}),
                                    preferred_floor: e.target.value as "ground" | "low" | "middle" | "high" | "ignore",
                                  },
                                }))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                            >
                              <option value="ignore">Neřeším</option>
                              <option value="ground">Přízemí</option>
                              <option value="low">Nižší patra (1–3)</option>
                              <option value="middle">Střední patra (4–7)</option>
                              <option value="high">Vyšší patra (8+)</option>
                            </select>
                          </div>
                        </div>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          {[
                            ["south", "Orientace na jih"],
                            ["west", "Orientace na západ"],
                            ["east", "Orientace na východ"],
                            ["north", "Orientace na sever"],
                          ].map(([key, label]) => (
                            <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <span className="text-sm text-slate-700">{label}</span>
                              <PrefToggle
                                value={(wizardExtras.outdoor?.orientation as any)?.[key] ?? "ignore"}
                                onChange={(v) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    outdoor: {
                                      ...(prev.outdoor ?? {}),
                                      orientation: { ...(prev.outdoor?.orientation ?? {}), [key]: v as Priority },
                                    },
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === 5 && (
                    <div className="space-y-4">
                      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                        {[
                          { key: "rekuperace",     label: "Rekuperace",           desc: "Řízené větrání s rekuperací tepla – komfort vzduchu bez průvanu." },
                          { key: "floor_heating",  label: "Podlahové vytápění",   desc: "Rovnoměrné teplo od podlahy, příjemné zejména v zimě." },
                          { key: "external_blinds",label: "Předokenní žaluzie",   desc: "Efektivní stínění a ochrana soukromí bez závislosti na klimatizaci." },
                          { key: "air_conditioning",label: "Klimatizace",         desc: "Možnost chlazení v létě – klíčové pro orientaci na jih nebo západ." },
                        ].map(({ key, label, desc }) => (
                          <div key={key} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-slate-900">{label}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">{desc}</p>
                              </div>
                              <PrefToggle
                                value={(wizardExtras.standards as any)?.[key] ?? "ignore"}
                                onChange={(v) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    standards: { ...(prev.standards ?? {}), [key]: v as Priority },
                                  }))
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {wizardStep === 6 && (
                    <div className="space-y-6">
                      {/* ── Charakter projektu ── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Charakter projektu</p>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-slate-700">Velikost projektu</span>
                            <select
                              value={wizardExtras.character?.project_size ?? "ignore"}
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  character: { ...(prev.character ?? {}), project_size: e.target.value as "small" | "medium" | "large" | "ignore" },
                                }))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                            >
                              <option value="ignore">Neřeším</option>
                              <option value="small">Menší projekt</option>
                              <option value="medium">Střední projekt</option>
                              <option value="large">Větší projekt</option>
                            </select>
                          </div>
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-slate-700">Klid vs. městský život</span>
                            <select
                              value={wizardExtras.character?.calm_vs_city ?? "ignore"}
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  character: { ...(prev.character ?? {}), calm_vs_city: e.target.value as "calm" | "city" | "ignore" },
                                }))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                            >
                              <option value="ignore">Neřeším</option>
                              <option value="calm">Spíše klid</option>
                              <option value="city">Spíše městský život</option>
                            </select>
                          </div>
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-slate-700">Soukromí vs. služby v okolí</span>
                            <select
                              value={wizardExtras.character?.privacy_vs_services ?? "ignore"}
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  character: { ...(prev.character ?? {}), privacy_vs_services: e.target.value as "privacy" | "services" | "ignore" },
                                }))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                            >
                              <option value="ignore">Neřeším</option>
                              <option value="privacy">Více soukromí</option>
                              <option value="services">Více služeb v okolí</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* ── Hlučnost lokality ── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Hlučnost lokality</p>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          {[
                            ["quiet_area", "Klidná lokalita"],
                            ["main_road", "Hlavní silnice v okolí"],
                            ["tram", "Tramvajové tratě v okolí"],
                            ["railway", "Železnice v okolí"],
                            ["airport", "Blízkost letiště"],
                          ].map(([key, label]) => (
                            <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <span className="text-sm text-slate-700">{label}</span>
                              <PrefToggle
                                value={(wizardExtras.noise as any)?.[key] ?? "ignore"}
                                onChange={(v) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    noise: { ...(prev.noise ?? {}), [key]: v as Priority },
                                  }))
                                }
                                preferLabel="Citlivý/á"
                                mustLabel="Musí se vyhnout"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Zázemí domu ── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Zázemí domu</p>
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          {[
                            ["parking", "Parkování"],
                            ["cellar", "Sklep"],
                            ["bike_room", "Kolárna"],
                            ["stroller_room", "Kočárkárna"],
                            ["fitness", "Fitness v projektu"],
                            ["shared_garden", "Společná zahrada / vnitroblok"],
                            ["concierge", "Recepce / concierge"],
                          ].map(([key, label]) => (
                            <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <span className="text-sm text-slate-700">{label}</span>
                              <PrefToggle
                                value={(wizardExtras.house_amenities as any)?.[key] ?? "ignore"}
                                onChange={(v) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    house_amenities: { ...(prev.house_amenities ?? {}), [key]: v as Priority },
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === 7 && (
                    <div className="space-y-5">
                      {/* ── Key numbers ── */}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {profile?.budget_max != null && (
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Max. cena</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{formatCurrencyCzk(profile.budget_max)}</p>
                          </div>
                        )}
                        {(profile?.area_min != null || profile?.area_max != null) && (
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Plocha</p>
                            <p className="mt-1 text-base font-bold text-slate-900">
                              {profile?.area_min != null ? `${profile.area_min}` : "—"}&thinsp;–&thinsp;{profile?.area_max != null ? `${profile.area_max} m²` : "bez max."}
                            </p>
                          </div>
                        )}
                        {selectedLayouts.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Dispozice</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{selectedLayouts.join(", ")}</p>
                          </div>
                        )}
                        {recs.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Doporučení</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{recs.length} jednotek</p>
                          </div>
                        )}
                      </div>

                      {/* ── Must-have ── */}
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Musí být</p>
                        {mustHaveSummary.length === 0 ? (
                          <p className="text-xs text-emerald-600/60">Žádné pevné podmínky – doporučení nebudou tvrdě filtrovaná.</p>
                        ) : (
                          <ul className="space-y-1">
                            {mustHaveSummary.map((item, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-xs text-emerald-900">
                                <span className="mt-px shrink-0 text-emerald-500">✓</span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* ── Preferences ── */}
                      <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-violet-700">Preferované</p>
                        {preferSummary.length === 0 ? (
                          <p className="text-xs text-violet-600/60">Žádné preference – doporučení se řídí jen rozpočtem a lokalitou.</p>
                        ) : (
                          <ul className="space-y-1">
                            {preferSummary.map((item, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-xs text-violet-900">
                                <span className="mt-px shrink-0 text-violet-400">·</span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* ── Recompute CTA ── */}
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">Přepočítat doporučení</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Vygeneruje nové pořadí na základě aktuálního profilu.
                          </p>
                        </div>
                        <ReamarButton
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={handleRecompute}
                          disabled={recomputing}
                        >
                          {recomputing ? "Přepočítávám…" : "Přepočítat →"}
                        </ReamarButton>
                      </div>
                    </div>
                  )}
                  </div>

                  <div className="mt-8 flex items-center justify-between gap-3">
                    <ReamarButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                      disabled={wizardStep === 1}
                    >
                      Zpět
                    </ReamarButton>
                    <div className="flex gap-2">
                      <ReamarButton
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleSaveProfile}
                        disabled={profileSaving}
                      >
                        {profileSaving ? "Ukládám…" : "Uložit profil"}
                      </ReamarButton>
                      {wizardStep < TOTAL_WIZARD_STEPS && (
                        <ReamarButton
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleNext}
                        >
                          Další
                        </ReamarButton>
                      )}
                    </div>
                  </div>
                </ReamarCard>
              </section>

              <section className="w-full space-y-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg bg-white px-6 py-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-slate-300"
                  onClick={() => setShowAnalytics((prev) => !prev)}
                >
                  <span className="text-sm font-semibold text-slate-800">
                    Analytika a podklady
                  </span>
                  <span className="text-xs text-slate-400">
                    {showAnalytics ? "▲ Skrýt" : "▼ Zobrazit"}
                  </span>
                </button>

                {showAnalytics && (
                  <div className="grid gap-4 md:grid-cols-3">
                  <ReamarSubtleCard className="col-span-1 p-4">
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Trh v hledané oblasti
                      </h3>
                      <p className="mt-1 text-[11px] text-slate-600">
                        Přehled projektů a jednotek v zakreslené oblasti.
                      </p>
                    </div>
                    {locationPolygons.length === 0 || locationPolygons[0].length < 3 ? (
                      <p className="text-[11px] text-slate-500">
                        Pro zobrazení trhu vyberte oblast v kroku &quot;Lokalita a prostředí&quot; a
                        uložte profil klienta.
                      </p>
                    ) : !areaMarket ? (
                      <p className="text-[11px] text-slate-500">
                        Načítám data o trhu v hledané oblasti…
                      </p>
                    ) : areaMarket.projects_count === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        V aktuálně zvolené oblasti nejsou žádné aktivní projekty s dostupnými jednotkami.
                      </p>
                    ) : (
                      <div className="space-y-2 text-[11px] text-slate-700">
                        <StatCard
                          label="Projekty v oblasti"
                          value={areaMarket.projects_count}
                          sublabel="s aktivními jednotkami"
                          className="mb-2"
                        />
                        <p>
                          <span className="font-semibold text-slate-900">
                            {areaMarket.active_units_count}
                          </span>{" "}
                          aktivních jednotek, z toho{" "}
                          <span className="font-semibold text-slate-900">
                            {areaMarket.matching_units_count}
                          </span>{" "}
                          odpovídá profilu klienta.
                        </p>
                        <p className="mt-1 font-semibold text-slate-900">Ceny v oblasti</p>
                        <p>
                          Průměrná cena:{" "}
                          {areaMarket.avg_price_czk != null
                            ? `${areaMarket.avg_price_czk.toLocaleString("cs-CZ")} Kč`
                            : "—"}
                        </p>
                        <p>
                          Průměrná cena/m²:{" "}
                          {areaMarket.avg_price_per_m2_czk != null
                            ? `${areaMarket.avg_price_per_m2_czk.toLocaleString("cs-CZ")} Kč/m²`
                            : "—"}
                        </p>
                        <p>
                          Rozptyl cen:{" "}
                          {areaMarket.min_price_czk != null
                            ? `${areaMarket.min_price_czk.toLocaleString("cs-CZ")} Kč`
                            : "—"}{" "}
                          –{" "}
                          {areaMarket.max_price_czk != null
                            ? `${areaMarket.max_price_czk.toLocaleString("cs-CZ")} Kč`
                            : "—"}
                        </p>
                      </div>
                    )}
                  </ReamarSubtleCard>

                  <ReamarSubtleCard className="col-span-1 p-4">
                    <div className="mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Analýza nabídky
                      </h3>
                      <p className="mt-1 text-[11px] text-slate-600">
                        Jak současná nabídka odpovídá profilu klienta a kde jsou hlavní blokery.
                      </p>
                    </div>
                    {!marketFit ? (
                      <p className="text-[11px] text-slate-500">
                        Analýza zatím není k dispozici nebo klient nemá kompletní profil.
                      </p>
                    ) : (
                      <div className="space-y-3 text-[11px] text-slate-700">
                        <p>
                          Aktuálně odpovídá profilu{" "}
                          <span className="font-semibold text-slate-900">
                            {marketFit.matching_units_count}
                          </span>{" "}
                          jednotek z{" "}
                          <span className="font-semibold text-slate-900">
                            {marketFit.available_units_count}
                          </span>{" "}
                          dostupných.
                        </p>
                        <div>
                          <p className="text-[11px] font-semibold text-slate-900">
                            Hlavní blokující faktory
                          </p>
                          <ul className="mt-1 space-y-1">
                            {marketFit.top_blockers.length === 0 ? (
                              <li>Žádný výrazný blokující faktor – profil je spíše široký.</li>
                            ) : (
                              marketFit.top_blockers.slice(0, 3).map((b) => (
                                <li key={b.key}>
                                  <span className="font-semibold">{b.label}:</span>{" "}
                                  {Math.round(b.blocked_percentage * 100)} % jednotek vypadá kvůli
                                  tomuto nastavení.
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold text-slate-900">
                            Jak odemknout více jednotek
                          </p>
                          {marketFit.relaxation_suggestions.length === 0 ? (
                            <p className="mt-1">
                              Změny profilu by aktuálně nepřinesly významné zvýšení počtu jednotek.
                            </p>
                          ) : (
                            <ul className="mt-1 space-y-1">
                              {marketFit.relaxation_suggestions.slice(0, 5).map((s) => (
                                <li key={s.label} className="flex items-center justify-between gap-2">
                                  <span>{s.label}</span>
                                  <span className="text-[10px] font-semibold text-slate-900">
                                    {s.delta_vs_current >= 0 ? "+" : ""}
                                    {s.delta_vs_current} jednotek
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </ReamarSubtleCard>

                  <ReamarSubtleCard className="col-span-1 p-4 md:col-span-1">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Doporučené jednotky
                      </h3>
                      <span className="text-[11px] text-slate-500">{recs.length} jednotek</span>
                    </div>
                    {recs.length === 0 ? (
                      <p className="text-[11px] text-slate-600">
                        Zatím žádná doporučení. Klikněte na &quot;Přepočítat doporučení&quot;.
                      </p>
                    ) : (
                      <div className="max-h-[480px] overflow-y-auto overflow-hidden rounded-lg border border-slate-200/70">
                        <table className="min-w-full divide-y divide-slate-100 text-[11px]">
                          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm">
                            <tr>
                              <th className="w-6 px-2 py-1.5" title="Uložit do výběru" />
                              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Jednotka</th>
                              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Projekt</th>
                              <th className="px-2 py-1.5 text-right font-semibold text-slate-700">Cena</th>
                              <th className="px-2 py-1.5 text-center font-semibold text-slate-700" title="Shoda: rozpočet · poloha · walkabilita · dispozice · plocha">Shoda</th>
                              <th className="px-2 py-1.5 text-right font-semibold text-slate-700">Skóre</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {recs.map((r) => {
                              const sl = scoreLabel(Math.round(r.score));
                              const href = r.unit_external_id
                                ? `/units/${encodeURIComponent(r.unit_external_id)}`
                                : null;
                              return (
                                <tr
                                  key={r.rec_id}
                                  className={cn(
                                    "hover:bg-slate-50",
                                    href ? "cursor-pointer" : "",
                                    r.pinned_by_broker ? "bg-amber-50/60" : ""
                                  )}
                                  onClick={() => href && router.push(href)}
                                >
                                  <td
                                    className="px-2 py-2 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      title={r.pinned_by_broker ? "Odebrat z výběru" : "Přidat do výběru"}
                                      onClick={() => handlePin(r.rec_id, r.pinned_by_broker)}
                                      className={cn(
                                        "text-base leading-none transition-colors",
                                        r.pinned_by_broker
                                          ? "text-amber-500 hover:text-amber-700"
                                          : "text-slate-300 hover:text-amber-400"
                                      )}
                                    >
                                      {r.pinned_by_broker ? "★" : "☆"}
                                    </button>
                                  </td>
                                  <td className="px-2 py-2 font-medium text-slate-900">
                                    <div>{r.unit_external_id ?? "—"}</div>
                                    {r.layout_label && (
                                      <div className="text-[10px] text-slate-500">{r.layout_label}{r.floor_area_m2 != null ? ` · ${Math.round(r.floor_area_m2)} m²` : ""}</div>
                                    )}
                                  </td>
                                  <td className="px-2 py-2 text-slate-700">{r.project_name ?? r.project_id ?? "—"}</td>
                                  <td className="px-2 py-2 text-right font-medium text-slate-900">
                                    {r.price_czk != null ? formatCurrencyCzk(r.price_czk) : "—"}
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="flex items-center justify-center gap-1">
                                      <FitDot value={r.budget_fit} title="Rozpočet" />
                                      <FitDot value={r.location_fit} title="Poloha" />
                                      <FitDot value={r.walkability_fit} title="Walkabilita" />
                                      <FitDot value={r.layout_fit} title="Dispozice" />
                                      <FitDot value={r.area_fit} title="Plocha" />
                                      <FitDot value={r.outdoor_fit} title="Venkovní plocha" />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="font-semibold text-slate-900">{Math.round(r.score)}</span>
                                      <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none", sl.cls)}>{sl.label}</span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </ReamarSubtleCard>
                  </div>
                )}
              </section>

              {/* ── Poznámky ke klientovi ──────────────────────────── */}
              <section className="w-full">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg bg-white px-6 py-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-slate-300"
                  onClick={() => setNotesOpen((v) => !v)}
                >
                  <span className="text-sm font-semibold text-slate-800">
                    Poznámky ({notes.length})
                  </span>
                  <span className="text-xs text-slate-400">
                    {notesOpen ? "▲ Skrýt" : "▼ Zobrazit"}
                  </span>
                </button>

                {notesOpen && (
                  <div className="mt-3 space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    {/* New note form */}
                    <div className="flex items-start gap-3">
                      <textarea
                        className={cn(reamarInputClass, "min-h-[72px] flex-1 resize-y")}
                        placeholder="Napište poznámku…"
                        value={newNoteBody}
                        onChange={(e) => setNewNoteBody(e.target.value)}
                      />
                      <div className="flex shrink-0 flex-col gap-2">
                        <select
                          className={cn(reamarSelectClass, "w-28")}
                          value={newNoteType}
                          onChange={(e) =>
                            setNewNoteType(
                              e.target.value as "internal" | "meeting" | "call"
                            )
                          }
                        >
                          <option value="internal">Interní</option>
                          <option value="meeting">Schůzka</option>
                          <option value="call">Telefon</option>
                        </select>
                        <ReamarButton
                          type="button"
                          size="sm"
                          disabled={!newNoteBody.trim() || notesSaving}
                          onClick={async () => {
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
                          }}
                        >
                          Přidat
                        </ReamarButton>
                      </div>
                    </div>

                    {/* Notes list */}

                    {notes.length === 0 ? (
                      <p className="text-xs text-slate-400">Žádné poznámky.</p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {notes.map((n) => (
                          <div
                            key={n.id}
                            className="flex items-start justify-between gap-4 py-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                    n.note_type === "meeting"
                                      ? "bg-blue-100 text-blue-700"
                                      : n.note_type === "call"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-slate-100 text-slate-600"
                                  )}
                                >
                                  {n.note_type === "meeting"
                                    ? "Schůzka"
                                    : n.note_type === "call"
                                      ? "Telefon"
                                      : "Interní"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(n.created_at).toLocaleString("cs-CZ")}
                                </span>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                                {n.body}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="shrink-0 text-xs text-slate-400 hover:text-rose-600"
                              title="Smazat poznámku"
                              onClick={async () => {
                                if (!token) return;
                                const r = await fetch(
                                  `${API_BASE}/clients/${clientId}/notes/${n.id}`,
                                  {
                                    method: "DELETE",
                                    headers: {
                                      Authorization: `Bearer ${token}`,
                                    },
                                  }
                                );
                                if (r.ok) {
                                  setNotes((prev) =>
                                    prev.filter((x) => x.id !== n.id)
                                  );
                                }
                              }}
                            >
                              Smazat
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <WalkabilityPreferencesDrawer
        open={walkPrefsOpen}
        value={walkPrefs}
        onChange={setWalkPrefs}
        onClose={() => setWalkPrefsOpen(false)}
        onApply={() => {
          saveWalkPrefs(walkPrefs);
          setWalkPrefsOpen(false);
        }}
        onReset={() => {
          const def = getDefaultPreferences();
          setWalkPrefs(def);
          saveWalkPrefs(def);
        }}
      />
    </div>
  );
}


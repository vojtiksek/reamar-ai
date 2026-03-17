"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { API_BASE } from "@/lib/api";
import type { WalkabilityPreferences } from "@/lib/walkabilityPreferences";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import { ClientLocationMap, type LocationProjectPoint } from "@/components/ClientLocationMap";
import {
  InfoBox,
  ReamarButton,
  ReamarCard,
  ReamarSubtleCard,
  StatCard,
  WizardStepHeader,
  reamarInputClass,
  reamarLabelClass,
  reamarSelectClass,
} from "@/components/ui/reamar-ui";
import {
  getDefaultPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
} from "@/lib/walkabilityPreferences";

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

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = Number(params?.id);

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
  const [locationPolygons, setLocationPolygons] = useState<{ lat: number; lng: number }[][]>([]);
  const [activeAreaIndex, setActiveAreaIndex] = useState<number>(0);
  const [locationProjects, setLocationProjects] = useState<LocationProjectPoint[]>([]);

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
      fetch(`${API_BASE}/projects/overview?limit=300&sort_by=avg_price_per_m2_czk&sort_dir=asc`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(
        ([
          clientJson,
          profileJson,
          recsJson,
          marketFitJson,
          areaMarketJson,
          projectsOverviewJson,
        ]) => {
        setClient(clientJson as ClientSummary);
        setProfile((profileJson || null) as ClientProfile | null);
        setRecs((recsJson || []) as RecommendationItem[]);
        setMarketFit((marketFitJson || null) as MarketFitAnalysis | null);
        setAreaMarket((areaMarketJson || null) as AreaMarketAnalysis | null);
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
              project: (p.project_name as string) ?? null,
              municipality: (p.municipality as string) ?? null,
              city: (p.city as string) ?? null,
              gps_latitude: p.gps_latitude as number,
              gps_longitude: p.gps_longitude as number,
            }));
          setLocationProjects(withGps);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [clientId, token, hydrated]);

  const handleSaveProfile = async () => {
    if (!token || !clientId) return;
    setProfileSaving(true);
    setProfileSavedMessage(null);
    try {
      const body: ClientProfile = {
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
                coordinates: [
                  locationPolygons[0].map((p) => [p.lng, p.lat]),
                ],
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
      };
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
      setProfileSavedMessage("Profil uložen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při ukládání profilu");
    } finally {
      setProfileSaving(false);
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
    anything_ok: "Je to jedno",
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
        mustHaveSummary.push(`${label}: musí být / musí se vyhnout`);
      } else if (value === "prefer") {
        preferSummary.push(`${label}: preferuji`);
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

  return (
    <div className="flex min-h-screen flex-col bg-slate-900/5">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        {loading ? (
          <p className="text-sm text-slate-600">Načítání…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : !client ? (
          <p className="text-sm text-slate-600">Klient nenalezen.</p>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div className="space-y-1">
                <nav className="text-xs text-slate-500">
                  <Link href="/clients" className="hover:underline">
                    Klienti
                  </Link>{" "}
                  / <span className="text-slate-700">{client.name}</span>
                </nav>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{client.name}</h2>
                  <p className="text-xs text-slate-600">
                    Stav: <span className="font-medium">{client.status}</span>
                  </p>
                  {profileSavedMessage && (
                    <p className="mt-1 text-xs text-emerald-600">{profileSavedMessage}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ReamarButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/clients")}
                >
                  Zpět na klienty
                </ReamarButton>
                <ReamarButton
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleRecompute}
                  disabled={recomputing}
                >
                  {recomputing ? "Přepočítávám…" : "Přepočítat doporučení"}
                </ReamarButton>
              </div>
            </div>

            <div className="space-y-10">
              <section className="mx-auto w-full max-w-4xl">
                <ReamarCard className="px-6 py-6 md:px-10 md:py-8">
                  <WizardStepHeader
                    eyebrow="Klientský intake"
                    title="Strukturovaný rozhovor pro pochopení profilu klienta"
                    description="Rozhovor je navržený pro živé broker–klient setkání. Každý krok má jeden hlavní úkol, vše ostatní je jen jemná podpora."
                    step={wizardStep}
                    totalSteps={TOTAL_WIZARD_STEPS}
                  />

                  <div className="space-y-6 text-sm transition-opacity duration-200">
                  {wizardStep === 1 && (
                    <div className="space-y-4">
                      <h4 className="text-lg font-semibold text-slate-900">
                        Jak chcete vybírat lokalitu?
                      </h4>
                      <p className="text-xs text-slate-600">
                        Společně si vybereme jeden nebo více způsobů, jak o lokalitě přemýšlet. Můžete
                        kombinovat mapu, dojíždění i administrativní oblasti.
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
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
                              className={`flex h-full flex-col items-start rounded-2xl border px-4 py-3 text-left transition-colors ${
                                checked
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-slate-50 hover:border-slate-300"
                              }`}
                            >
                              <div className="mb-1 flex w-full items-center justify-between gap-2">
                                <span
                                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                                    checked
                                      ? "border-white bg-white/10 text-slate-900"
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
                                    checked ? "text-white" : "text-slate-900"
                                  }`}
                                >
                                  {title}
                                </p>
                                <p
                                  className={`text-xs ${
                                    checked ? "text-slate-100/80" : "text-slate-600"
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
                    <div className="space-y-4">
                      <h4 className="text-lg font-semibold text-slate-900">Lokalita a prostředí</h4>
                      <p className="text-xs text-slate-600">
                        Podle zvolených metod z předchozího kroku společně upřesníte, kde dává bydlení
                        největší smysl.
                      </p>
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
                          <div className="flex items-center justify-between gap-2">
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
                              Přidat další oblast
                            </ReamarButton>
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

                      <ReamarButton
                        type="button"
                        variant="subtle"
                        size="sm"
                        className="w-full"
                        onClick={() => setWalkPrefsOpen(true)}
                      >
                        Nastavit preference walkability a okolí
                      </ReamarButton>
                    </div>
                  )}

                  {wizardStep === 4 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-900">
                        Rozpočet a velikost bytu
                      </h4>
                      <p className="text-xs text-slate-600">
                        Nejdřív si s klientem ujasněte ideální představu a až poté maximální limity.
                      </p>
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
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={reamarLabelClass}>
                            Ideální plocha (m²)
                          </label>
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
                        </div>
                        <div>
                          <label className={reamarLabelClass}>
                            Minimální plocha (m²)
                          </label>
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
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-900">
                        Dispozice a základní parametry
                      </h4>
                      <p className="text-xs text-slate-600">
                        Zaměřte se na to, jak klient skutečně bude byt používat.
                      </p>
                      <div>
                        <label className={reamarLabelClass}>
                          Dispozice (více možností)
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          {LAYOUT_OPTIONS.map((opt) => {
                            const checked = selectedLayouts.includes(opt.value);
                            return (
                              <label key={opt.value} className="inline-flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  className="h-3 w-3 rounded border-slate-300"
                                  checked={checked}
                                  onChange={(e) => {
                                    setSelectedLayouts((prev) => {
                                      if (e.target.checked) {
                                        return Array.from(new Set([...prev, opt.value]));
                                      }
                                      return prev.filter((v) => v !== opt.value);
                                    });
                                  }}
                                />
                                <span className="text-slate-700">{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={reamarLabelClass}>
                            Typ nemovitosti
                          </label>
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
                          <label className={reamarLabelClass}>
                            Účel nákupu
                          </label>
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
                      <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3">
                        <h5 className="text-xs font-semibold text-slate-900">Venkovní prostor</h5>
                        <div className="space-y-2 text-xs">
                          {[
                            ["balcony", "Balkon"],
                            ["terrace", "Terasa"],
                            ["garden", "Zahrada"],
                            ["anything_ok", "Je to jedno"],
                          ].map(([key, label]) => (
                            <div key={key} className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-700">{label}</span>
                                <select
                                  value={
                                    (wizardExtras.outdoor as any)?.[key] ??
                                    ("ignore" as Priority | "ignore")
                                  }
                                  onChange={(e) =>
                                    setWizardExtras((prev) => ({
                                      ...prev,
                                      outdoor: {
                                        ...(prev.outdoor ?? {}),
                                        [key]: e.target.value as Priority,
                                      },
                                    }))
                                  }
                                  className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
                                >
                                  <option value="ignore">Neřeším</option>
                                  <option value="prefer">Preferuji</option>
                                  <option value="must">Musí být</option>
                                </select>
                              </div>
                              {key !== "anything_ok" && (
                                <details className="group rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                                  <summary className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-slate-700">
                                    <span>Více o venkovním prostoru</span>
                                    <span className="text-[10px] text-slate-500 group-open:hidden">
                                      rozbalit
                                    </span>
                                    <span className="text-[10px] text-slate-500 hidden group-open:inline">
                                      skrýt
                                    </span>
                                  </summary>
                                  <div className="mt-2 space-y-1 text-[11px] text-slate-700">
                                    <p className="font-semibold">Výhody</p>
                                    <p>
                                      Krátký popis výhod konkrétního typu venkovního prostoru – více
                                      světla, soukromí, možnost trávit čas venku.
                                    </p>
                                    <p className="mt-1 font-semibold">Nevýhody</p>
                                    <p>
                                      Shrnutí limitů, jako je hluk z ulice, údržba nebo menší využitelnost
                                      v zimě.
                                    </p>
                                    <p className="mt-1 font-semibold">Kdy to dává smysl</p>
                                    <p>
                                      Situace, kdy je daný typ venkovního prostoru pro klienta zásadní
                                      (např. děti, práce z domova, domácí mazlíčci).
                                    </p>
                                    <p className="mt-1 text-[10px] text-slate-500">
                                      Má X % projektů · Má Y % jednotek
                                    </p>
                                  </div>
                                </details>
                              )}
                            </div>
                          ))}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-slate-600">
                                Minimální venkovní plocha (m²)
                              </label>
                              <input
                                type="number"
                                value={wizardExtras.outdoor?.min_outdoor_area_m2 ?? ""}
                                onChange={(e) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    outdoor: {
                                      ...(prev.outdoor ?? {}),
                                      min_outdoor_area_m2: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                    },
                                  }))
                                }
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                                placeholder="Např. 10"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600">
                                Preferované patro
                              </label>
                              <select
                                value={wizardExtras.outdoor?.preferred_floor ?? "ignore"}
                                onChange={(e) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    outdoor: {
                                      ...(prev.outdoor ?? {}),
                                      preferred_floor: e.target.value as
                                        | "ground"
                                        | "low"
                                        | "middle"
                                        | "high"
                                        | "ignore",
                                    },
                                  }))
                                }
                                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                              >
                                <option value="ignore">Neřeším</option>
                                <option value="ground">Přízemí</option>
                                <option value="low">Nižší patra</option>
                                <option value="middle">Střední patra</option>
                                <option value="high">Vyšší patra</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-700">Vadí přízemí</span>
                            <select
                              value={
                                wizardExtras.outdoor?.ground_floor_sensitive ??
                                ("ignore" as Priority | "ignore")
                              }
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  outdoor: {
                                    ...(prev.outdoor ?? {}),
                                    ground_floor_sensitive: e.target.value as Priority,
                                  },
                                }))
                              }
                              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="ignore">Neřeším</option>
                              <option value="prefer">Spíše vadí</option>
                              <option value="must">Musí se vyhnout</option>
                            </select>
                          </div>
                          <div className="mt-2 space-y-1">
                            <p className="text-[11px] font-medium text-slate-700">
                              Preferovaná orientace
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                ["south", "Jih"],
                                ["west", "Západ"],
                                ["east", "Východ"],
                                ["north", "Sever"],
                              ].map(([key, label]) => (
                                <div
                                  key={key}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="text-slate-700">{label}</span>
                                  <select
                                    value={
                                      (wizardExtras.outdoor?.orientation as any)?.[key] ??
                                      ("ignore" as Priority | "ignore")
                                    }
                                    onChange={(e) =>
                                      setWizardExtras((prev) => ({
                                        ...prev,
                                        outdoor: {
                                          ...(prev.outdoor ?? {}),
                                          orientation: {
                                            ...(prev.outdoor?.orientation ?? {}),
                                            [key]: e.target.value as Priority,
                                          },
                                        },
                                      }))
                                    }
                                    className="w-28 rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                                  >
                                    <option value="ignore">Neřeším</option>
                                    <option value="prefer">Preferuji</option>
                                    <option value="must">Musí být</option>
                                  </select>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === 6 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-900">
                        Standardy a technologie
                      </h4>
                      <p className="text-xs text-slate-600">
                        U každé položky se zeptejte, zda je to podmínka, výhoda, nebo to klient
                        neřeší.
                      </p>
                      {[
                        ["rekuperace", "Rekuperace"],
                        ["floor_heating", "Podlahové vytápění"],
                        ["external_blinds", "Předokenní žaluzie"],
                        ["air_conditioning", "Klimatizace"],
                        ["cellar", "Sklep"],
                        ["parking", "Parkování"],
                      ].map(([key, label]) => (
                        <div key={key} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-700">{label}</span>
                            <select
                              value={
                                (wizardExtras.standards as any)?.[key] ??
                                ("ignore" as Priority | "ignore")
                              }
                              onChange={(e) =>
                                setWizardExtras((prev) => ({
                                  ...prev,
                                  standards: {
                                    ...(prev.standards ?? {}),
                                    [key]: e.target.value as Priority,
                                  },
                                }))
                              }
                              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="ignore">Neřeším</option>
                              <option value="prefer">Preferuji</option>
                              <option value="must">Musí být</option>
                            </select>
                          </div>
                          <details className="group rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                            <summary className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-slate-700">
                              <span>Více o vlastnosti</span>
                              <span className="text-[10px] text-slate-500 group-open:hidden">
                                rozbalit
                              </span>
                              <span className="text-[10px] text-slate-500 hidden group-open:inline">
                                skrýt
                              </span>
                            </summary>
                            <div className="mt-2 space-y-1 text-[11px] text-slate-700">
                              <p className="font-semibold">Výhody</p>
                              <p>
                                Krátký popis výhod této vlastnosti v kontextu komfortu, energetiky a
                                dlouhodobé hodnoty.
                              </p>
                              <p className="mt-1 font-semibold">Nevýhody</p>
                              <p>
                                Stručné shrnutí možných kompromisů – například vyšší pořizovací cena,
                                náročnější údržba nebo omezená dostupnost.
                              </p>
                              <p className="mt-1 font-semibold">Kdy to dává smysl</p>
                              <p>
                                Typické situace, kdy je tato vlastnost pro klienta klíčová, a kdy je
                                spíše nice-to-have.
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                Má X % projektů · Má Y % jednotek
                              </p>
                            </div>
                          </details>
                        </div>
                      ))}
                      <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3">
                        <h5 className="text-xs font-semibold text-slate-900">Financování</h5>
                        <div className="space-y-2 text-xs">
                          <p className="text-[11px] text-slate-600">
                            Jaký platební kalendář je klientovi nejbližší?
                          </p>
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
                            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                          >
                            <option value="ignore">Neřeším</option>
                            <option value="upfront">Vyšší část při podpisu</option>
                            <option value="during_construction">Více během výstavby</option>
                            <option value="on_completion">Co nejvíce až po dokončení</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === 7 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-900">
                        Charakter projektu a okolí
                      </h4>
                      <p className="text-xs text-slate-600">
                        Pomozte klientovi pojmenovat, jaký typ projektu a okolí je pro něj přirozený.
                      </p>
                      <div>
                        <label className={reamarLabelClass}>
                          Velikost projektu
                        </label>
                        <select
                          value={wizardExtras.character?.project_size ?? "ignore"}
                          onChange={(e) =>
                            setWizardExtras((prev) => ({
                              ...prev,
                              character: {
                                ...(prev.character ?? {}),
                                project_size: e.target.value as
                                  | "small"
                                  | "medium"
                                  | "large"
                                  | "ignore",
                              },
                            }))
                          }
                          className={cn("mt-1", reamarSelectClass)}
                        >
                          <option value="ignore">Neřeším</option>
                          <option value="small">Menší projekt</option>
                          <option value="medium">Střední projekt</option>
                          <option value="large">Větší projekt</option>
                        </select>
                      </div>
                      <div>
                        <label className={reamarLabelClass}>
                          Klid vs. městský život
                        </label>
                        <select
                          value={wizardExtras.character?.calm_vs_city ?? "ignore"}
                          onChange={(e) =>
                            setWizardExtras((prev) => ({
                              ...prev,
                              character: {
                                ...(prev.character ?? {}),
                                calm_vs_city: e.target.value as "calm" | "city" | "ignore",
                              },
                            }))
                          }
                          className={cn("mt-1", reamarSelectClass)}
                        >
                          <option value="ignore">Neřeším</option>
                          <option value="calm">Spíše klid</option>
                          <option value="city">Spíše městský život</option>
                        </select>
                      </div>
                      <div>
                        <label className={reamarLabelClass}>
                          Soukromí vs. služby v okolí
                        </label>
                        <select
                          value={wizardExtras.character?.privacy_vs_services ?? "ignore"}
                          onChange={(e) =>
                            setWizardExtras((prev) => ({
                              ...prev,
                              character: {
                                ...(prev.character ?? {}),
                                privacy_vs_services: e.target.value as
                                  | "privacy"
                                  | "services"
                                  | "ignore",
                              },
                            }))
                          }
                          className={cn("mt-1", reamarSelectClass)}
                        >
                          <option value="ignore">Neřeším</option>
                          <option value="privacy">Více soukromí</option>
                          <option value="services">Více služeb v okolí</option>
                        </select>
                      </div>
                      <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3">
                        <h5 className="text-xs font-semibold text-slate-900">
                          Klid a hlučnost lokality
                        </h5>
                        <div className="space-y-2 text-xs">
                          <p className="text-[11px] text-slate-600">
                            Jaké typy hluku jsou pro klienta citlivé a které naopak nevadí?
                          </p>
                          {[
                            ["quiet_area", "Klidná lokalita"],
                            ["main_road", "Hlavní silnice"],
                            ["tram", "Tramvaj"],
                            ["railway", "Železnice"],
                            ["airport", "Letiště"],
                          ].map(([key, label]) => (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-slate-700">{label}</span>
                              <select
                                value={
                                  (wizardExtras.noise as any)?.[key] ??
                                  ("ignore" as Priority | "ignore")
                                }
                                onChange={(e) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    noise: {
                                      ...(prev.noise ?? {}),
                                      [key]: e.target.value as Priority,
                                    },
                                  }))
                                }
                                className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value="ignore">Neřeším</option>
                                <option value="prefer">Preferuji</option>
                                <option value="must">Musí být / Musí se vyhnout</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                        <h5 className="text-xs font-semibold text-slate-900">
                          Zázemí domu a praktické potřeby
                        </h5>
                        <div className="space-y-2 text-xs">
                          <p className="text-[11px] text-slate-600">
                            Jaké prvky zázemí domu jsou pro klienta nutné, které jsou výhodou a co
                            nehraje roli?
                          </p>
                          {[
                            ["parking", "Parkování"],
                            ["cellar", "Sklep"],
                            ["bike_room", "Kolárna"],
                            ["stroller_room", "Kočárkárna"],
                            ["fitness", "Fitness v projektu"],
                            ["shared_garden", "Společná zahrada / vnitroblok"],
                            ["concierge", "Recepce / concierge"],
                          ].map(([key, label]) => (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-slate-700">{label}</span>
                              <select
                                value={
                                  (wizardExtras.house_amenities as any)?.[key] ??
                                  ("ignore" as Priority | "ignore")
                                }
                                onChange={(e) =>
                                  setWizardExtras((prev) => ({
                                    ...prev,
                                    house_amenities: {
                                      ...(prev.house_amenities ?? {}),
                                      [key]: e.target.value as Priority,
                                    },
                                  }))
                                }
                                className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value="ignore">Neřeším</option>
                                <option value="prefer">Preferuji</option>
                                <option value="must">Musí být</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {wizardStep === TOTAL_WIZARD_STEPS && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-slate-900">Shrnutí profilu</h4>
                      <p className="text-xs text-slate-600">
                        Rychlý přehled toho, co je pro klienta nutné, preferované a co nehraje roli.
                      </p>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <p className="mb-1 font-semibold text-slate-800">Must-have</p>
                        <ul className="list-disc pl-4 text-slate-700">
                          {mustHaveSummary.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                          {selectedLayouts.length > 0 && (
                            <li>Dispozice: {selectedLayouts.join(", ")}</li>
                          )}
                        </ul>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <p className="mb-1 font-semibold text-slate-800">Preference</p>
                        <ul className="list-disc pl-4 text-slate-700">
                          {preferSummary.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <p className="mb-1 font-semibold text-slate-800">Nehraje roli</p>
                        <p className="text-slate-700">
                          Všechny ostatní vlastnosti, které jsou nastavené jako &quot;neřeším&quot;.
                        </p>
                      </div>
                    </div>
                  )}
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-2">
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
                          onClick={() =>
                          setWizardStep((s) =>
                            s < TOTAL_WIZARD_STEPS ? s + 1 : s
                          )
                        }
                        >
                          Další
                        </ReamarButton>
                      )}
                    </div>
                  </div>
                </ReamarCard>
              </section>

              <section className="mx-auto w-full max-w-6xl space-y-4 pb-8">
                <InfoBox tone="neutral" title="Podklady pro práci po rozhovoru" className="text-[11px]">
                  <p>
                    Tato analytika je sekundární během klientského intake – slouží hlavně pro přípravu
                    a práci po rozhovoru. Během vedení dotazníku držte fokus na horním wizardu.
                  </p>
                </InfoBox>

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
                        Market fit analysis
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
                      <div className="overflow-hidden rounded-lg border border-slate-200/70">
                        <table className="min-w-full divide-y divide-slate-100 text-[11px]">
                          <thead className="bg-slate-50/90">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                                Jednotka
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                                Projekt
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold text-slate-700">
                                Cena
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold text-slate-700">
                                Skóre
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {recs.slice(0, 6).map((r) => (
                              <tr
                                key={`${r.unit_external_id}-${r.project_id}`}
                                className="hover:bg-slate-50"
                              >
                                <td className="px-2 py-1.5 text-slate-900">
                                  {r.unit_external_id ?? "—"}
                                </td>
                                <td className="px-2 py-1.5 text-slate-700">
                                  {r.project_name ?? r.project_id ?? "—"}
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-900 font-medium">
                                  {r.price_czk != null
                                    ? `${r.price_czk.toLocaleString("cs-CZ")} Kč`
                                    : "—"}
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-900">
                                  {Math.round(r.score)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </ReamarSubtleCard>
                </div>
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


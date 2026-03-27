"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE } from "@/lib/api";
import type { FiltersResponse } from "@/lib/filters";
import { flattenFilterSpecsByKey } from "@/lib/filters";
import {
  formatCurrencyCzk,
  formatMinutes,
  formatPercent,
  formatValue as formatValueLib,
} from "@/lib/format";
import {
  type WalkabilityPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
  resetPreferences as resetWalkPrefs,
  isPersonalizedActive,
  getNonDefaultChips,
} from "@/lib/walkabilityPreferences";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";

const ProjectDetailMap = dynamic(
  () => import("@/app/units/[external_id]/UnitDetailMap"),
  { ssr: false }
);

const WalkabilityPoiModalMap = dynamic(
  () => import("@/app/projects/[id]/WalkabilityPoiModalMap"),
  { ssr: false }
);

/** Překlad hodnot standardů (z API) do češtiny pro zobrazení ve výběrech. */
const STANDARD_LABELS_CZ: Record<string, Record<string, string>> = {
  overall_quality: {
    standard: "Standard",
    medium: "Střední",
    high: "Vysoká",
    low: "Nízká",
    premium: "Prémiová",
  },
  windows: {
    pvc: "PVC",
    wood: "Dřevo",
    aluminum: "Hliník",
    plastic: "Plast",
  },
  partition_walls: {
    brick: "Cihla",
    drywall: "Sádrokarton",
    none: "Bez příček",
  },
  heating: {
    underfloor: "Podlahové",
    gas: "Plyn",
    electric: "Elektřina",
    district: "Dálkové",
    "central heating": "Ústřední",
  },
  category: {
    house: "Dům",
    flat: "Byt",
    apartment: "Byt",
  },
  floors: {
    vinyl: "Vinyl",
    pvc: "PVC",
    wood: "Dřevo",
    laminate: "Laminát",
    tile: "Dlažba",
    carpet: "Koberec",
    parquet: "Parkety",
    linoleum: "Linoleum",
  },
};

function standardLabelToCzech(field: string, value: string): string {
  if (!value || value === "") return "—";
  const map = STANDARD_LABELS_CZ[field];
  if (map) {
    const lower = value.toLowerCase().trim();
    const translated = map[lower] ?? map[value];
    if (translated) return translated;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatBoolOrDash(value: unknown): string {
  const raw = value as any;
  const s = String(raw ?? "").trim().toLowerCase();
  if (raw === true || s === "true" || s === "1" || s === "ano") return "Ano";
  if (raw === false || s === "false" || s === "0" || s === "ne") return "Ne";
  return "—";
}

type ProjectDetail = Record<string, unknown>;

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type UnitInProject = {
  external_id: string;
  unit_name: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  exterior_area_m2?: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  available: boolean;
  availability_status?: string | null;
  project?: { name?: string };
};

type UnitsSortKey =
  | "unit_name"
  | "layout"
  | "floor_area_m2"
  | "exterior_area_m2"
  | "price_czk"
  | "price_per_m2_czk"
  | "availability_status";

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-sky-500";
  if (score >= 40) return "bg-amber-400";
  return "bg-rose-500";
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${scoreBarColor(pct)}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function availabilityStatusLabel(status: string | null | undefined, available: boolean): string {
  if (status != null && status !== "") {
    const s = String(status).toLowerCase();
    if (s === "available" || s === "volné") return "Volné";
    if (s === "reserved" || s === "rezervované") return "Rezervované";
    if (s === "sold" || s === "prodané") return "Prodané";
    if (s === "unseen") return "Unseen";
    return status;
  }
  return available ? "Volné" : "—";
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params?.id as string | undefined;

  const debugMode = searchParams?.get("debug") === "1";

  const [projectState, setProjectState] = useState<FetchState<ProjectDetail>>({
    data: null,
    loading: true,
    error: null,
  });
  const [unitsState, setUnitsState] = useState<FetchState<UnitInProject[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [filtersState, setFiltersState] = useState<FetchState<FiltersResponse>>({
    data: null,
    loading: false,
    error: null,
  });
  const [editMode, setEditMode] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [recomputingLocation, setRecomputingLocation] = useState(false);
  const [adminJobState, setAdminJobState] = useState<{ loading: boolean; message: string | null }>({ loading: false, message: null });
  const [poiModal, setPoiModal] = useState<{
    open: boolean;
    category: string;
    categoryLabel: string;
    items: Array<{ name: string | null; category: string; distance_m: number | null; lat: number | null; lon: number | null }>;
    loading: boolean;
    view: "list" | "map";
  }>({ open: false, category: "", categoryLabel: "", items: [], loading: false, view: "list" });

  const [overviewPoi, setOverviewPoi] = useState<{
    project: { lat: number; lon: number };
    categories: Record<
      string,
      Array<{ name: string | null; distance_m: number | null; lat: number | null; lon: number | null }>
    >;
  } | null>(null);
  const [unitsSortBy, setUnitsSortBy] = useState<UnitsSortKey>("unit_name");
  const [unitsSortDir, setUnitsSortDir] = useState<"asc" | "desc">("asc");

  const [walkPrefsOpen, setWalkPrefsOpen] = useState(false);
  const [walkPrefs, setWalkPrefs] = useState<WalkabilityPreferences>(() => loadWalkPrefs());
  const [personalizedModeEnabled, setPersonalizedModeEnabled] = useState<boolean>(() =>
    isPersonalizedActive(loadWalkPrefs())
  );
  const [personalizedWalk, setPersonalizedWalk] = useState<{
    score: number | null;
    label: string | null;
    daily_needs: number | null;
    transport: number | null;
    leisure: number | null;
    family: number | null;
  } | null>(null);

  const filterSpecsByKey = useMemo(
    () => (filtersState.data?.groups ? flattenFilterSpecsByKey(filtersState.data.groups) : new Map()),
    [filtersState.data]
  );

  useEffect(() => {
    if (!projectId) return;

    setProjectState({ data: null, loading: true, error: null });
    fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((projectJson) => {
        setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Chyba";
        setProjectState({ data: null, loading: false, error: msg });
      });
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !personalizedModeEnabled || !projectState.data) {
      setPersonalizedWalk(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/projects/${encodeURIComponent(projectId)}/walkability/personalized-score`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(walkPrefs),
          }
        );
        if (!res.ok) return;
        const json = await res.json();
        setPersonalizedWalk({
          score: json.score ?? null,
          label: json.label ?? null,
          daily_needs: json.daily_needs_score ?? null,
          transport: json.transport_score ?? null,
          leisure: json.leisure_score ?? null,
          family: json.family_score ?? null,
        });
      } catch {
        // silent fallback
      }
    })();
    return () => controller.abort();
  }, [projectId, personalizedModeEnabled, walkPrefs, projectState.data]);

  const handleRecomputeLocationMetrics = useCallback(async () => {
    if (!projectId) return;
    setRecomputingLocation(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/location-metrics/recompute`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const projectJson = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`).then((r) => r.json());
      setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
    } catch (e) {
      setProjectState((prev) => ({ ...prev, error: e instanceof Error ? e.message : "Chyba" }));
    } finally {
      setRecomputingLocation(false);
    }
  }, [projectId]);

  const handleAdminRecomputeAll = useCallback(async () => {
    setAdminJobState({ loading: true, message: null });
    try {
      const res = await fetch(`${API_BASE}/admin/location-metrics/recompute-all`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAdminJobState({ loading: false, message: `Přepočítáno: ${data.processed}/${data.total} projektů (${data.elapsed_seconds}s).` });
    } catch (e) {
      setAdminJobState({ loading: false, message: e instanceof Error ? e.message : "Chyba" });
    }
  }, []);

  const handleAdminRefreshAndRecompute = useCallback(async () => {
    setAdminJobState({ loading: true, message: null });
    try {
      const res = await fetch(`${API_BASE}/admin/location-sources/refresh-and-recompute`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const recompute = data.recompute as { processed?: number; total?: number; elapsed_seconds?: number } | null;
      const msg = recompute
        ? `Refresh dokončen. Přepočítáno: ${recompute.processed}/${recompute.total} projektů (${recompute.elapsed_seconds}s).`
        : "Spuštěno.";
      setAdminJobState({ loading: false, message: msg });
    } catch (e) {
      setAdminJobState({ loading: false, message: e instanceof Error ? e.message : "Chyba" });
    }
  }, []);

  const handleAdminWalkabilityRefreshAndRecompute = useCallback(async () => {
    setAdminJobState({ loading: true, message: null });
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);
      const res = await fetch(`${API_BASE}/admin/walkability-sources/refresh-and-recompute`, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const body = await res.text();
      if (!res.ok) {
        setAdminJobState({ loading: false, message: "Nepodařilo se obnovit walkability data" });
        return;
      }
      const data = JSON.parse(body) as Record<string, unknown>;
      const recompute = data.recompute as { processed?: number; total?: number } | null;
      setAdminJobState({ loading: false, message: null });
      alert(
        `Walkability data obnovena.\nProjekty přepočítány: ${recompute?.processed ?? 0}/${recompute?.total ?? 0}`
      );
      if (projectId) {
        const projectJson = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`).then((r) => r.json());
        setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
      }
    } catch (e) {
      setAdminJobState({ loading: false, message: "Nepodařilo se obnovit walkability data" });
      if (projectId) {
        const projectJson = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`).then((r) => r.json());
        setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
      }
    }
  }, [projectId]);

  const handleAdminDownloadOsmAndRecompute = useCallback(async () => {
    setAdminJobState({ loading: true, message: null });
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const res = await fetch(`${API_BASE}/admin/location-sources/download-osm-and-recompute`, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const body = await res.text();
      if (!res.ok) {
        let detail = body;
        try {
          const j = JSON.parse(body) as { detail?: string };
          if (j.detail) detail = j.detail;
        } catch {
          // keep body
        }
        throw new Error(detail);
      }
      const data = JSON.parse(body) as Record<string, unknown>;
      const osm = data.osm as Record<string, number> | undefined;
      const recompute = data.recompute as { processed?: number; total?: number; elapsed_seconds?: number } | null;
      const osmParts = osm
        ? `Staženo: silnice ${osm.primary_roads ?? 0}, tramvaje ${osm.tram_tracks ?? 0}, železnice ${osm.railway ?? 0}, letiště ${osm.airports ?? 0}. `
        : "";
      const recPart = recompute
        ? `Přepočítáno: ${recompute.processed}/${recompute.total} projektů (${recompute.elapsed_seconds}s).`
        : "Hotovo.";
      setAdminJobState({ loading: false, message: osmParts + recPart });
      if (projectId) {
        const projectJson = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`).then((r) => r.json());
        setProjectState({ data: projectJson as ProjectDetail, loading: false, error: null });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chyba";
      const isNetwork = /load failed|failed to fetch|network error|aborted/i.test(msg);
      setAdminJobState({
        loading: false,
        message: isNetwork
          ? "Požadavek selhal (timeout nebo síť). Stahování OSM trvá 1–2 minuty – zkuste to znovu."
          : msg,
      });
    }
  }, [projectId]);

  const openPoiModal = useCallback(
    async (category: string, categoryLabel: string) => {
      setPoiModal({ open: true, category, categoryLabel, items: [], loading: true, view: "list" });
      if (!projectId) {
        setPoiModal((prev) => ({ ...prev, loading: false }));
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/projects/${encodeURIComponent(projectId)}/walkability-poi?category=${encodeURIComponent(category)}&limit=50`
        );
        const data = (await res.json()) as { items?: Array<{ name: string | null; category: string; distance_m: number | null; lat: number | null; lon: number | null }> };
        setPoiModal((prev) => ({ ...prev, items: data.items ?? [], loading: false }));
      } catch {
        setPoiModal((prev) => ({ ...prev, items: [], loading: false }));
      }
    },
    [projectId]
  );

  const closePoiModal = useCallback(() => {
    setPoiModal((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setOverviewPoi(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      categories:
        "supermarkets,pharmacies,parks,restaurants,tram_stops,bus_stops,metro_stations",
      per_category: "2",
    });
    fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/walkability-poi-overview?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then(
        (data: {
          project?: { lat: number; lon: number } | null;
          categories?: Record<
            string,
            Array<{ name: string | null; distance_m: number | null; lat: number | null; lon: number | null }>
          >;
        }) => {
          if (cancelled) return;
          if (data.project && data.categories) {
            setOverviewPoi({
              project: data.project,
              categories: data.categories,
            });
          } else {
            setOverviewPoi(null);
          }
        }
      )
      .catch(() => {
        if (!cancelled) setOverviewPoi(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setFiltersState((prev) => ({ ...prev, loading: true }));
    fetch(`${API_BASE}/filters`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: FiltersResponse) => {
        setFiltersState({ data, loading: false, error: null });
      })
      .catch(() => {
        setFiltersState({ data: null, loading: false, error: null });
      });
  }, []);

  // Načíst jednotky v projektu (podle názvu projektu)
  useEffect(() => {
    const projectName = projectState.data && (
      (projectState.data["project"] as string | undefined) ??
      (projectState.data["name"] as string | undefined)
    );
    if (!projectName || projectState.loading) {
      setUnitsState({ data: null, loading: false, error: null });
      return;
    }
    setUnitsState({ data: null, loading: true, error: null });
    const params = new URLSearchParams();
    params.set("project", projectName);
    params.set("limit", "500");
    fetch(`${API_BASE}/units?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: { items?: UnitInProject[] }) => {
        const items = json?.items ?? [];
        setUnitsState({ data: items, loading: false, error: null });
      })
      .catch((e) => {
        setUnitsState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : "Chyba načítání jednotek",
        });
      });
  }, [projectState.data, projectState.loading]);

  const project = projectState.data;

  // Name can come from catalog key "project" (alias for name) or "name"
  const name =
    (project && ((project["project"] as string | undefined) ?? (project["name"] as string | undefined))) || "";
  const developer = (project && (project["developer"] as string | undefined)) ?? "—";
  const address = (project && (project["address"] as string | undefined)) ?? "—";
  const projectGpsLat =
    project != null ? ((project["gps_latitude"] as number | null | undefined) ?? null) : null;
  const projectGpsLng =
    project != null ? ((project["gps_longitude"] as number | null | undefined) ?? null) : null;

  const EDITABLE_PREHLED = ["project_url"] as const;
  const EDITABLE_FINANCOVANI = [
    "payment_contract",
    "payment_construction",
    "payment_occupancy",
    "min_parking_indoor_price_czk",
    "min_parking_outdoor_price_czk",
  ] as const;
  const EDITABLE_STANDARDY = [
    "renovation",
    "overall_quality",
    "windows",
    "partition_walls",
    "heating",
    "category",
    "floors",
    "air_conditioning",
    "cooling_ceilings",
    "exterior_blinds",
    "smart_home",
    "ceiling_height",
    "recuperation",
    "cooling",
  ] as const;
  const EDITABLE_AMENITIES = [
    "concierge",
    "reception",
    "bike_room",
    "stroller_room",
    "fitness",
    "courtyard_garden",
  ] as const;
  const EDITABLE_OSTATNI = ["amenities"] as const;

  const fillDraftFromProject = useCallback((p: ProjectDetail) => {
    const draft: Record<string, unknown> = {};
    for (const key of EDITABLE_PREHLED) {
      const v = p[key];
      draft[key] = v != null && v !== "" ? String(v) : "";
    }
    for (const key of EDITABLE_FINANCOVANI) {
      const v = p[key];
      if (key.startsWith("payment_")) {
        const num = typeof v === "number" ? v : Number(v);
        draft[key] = Number.isNaN(num) ? "" : (num > 1 ? num : num * 100);
      } else {
        draft[key] = v != null && v !== "" ? (typeof v === "number" ? v : Math.round(Number(v)) || "") : "";
      }
    }
    for (const key of EDITABLE_STANDARDY) {
      const v = p[key];
      if (
        key === "renovation" ||
        key === "air_conditioning" ||
        key === "cooling_ceilings" ||
        key === "exterior_blinds" ||
        key === "smart_home" ||
        key === "recuperation" ||
        key === "cooling"
      ) {
        if (v === null || v === undefined || v === "") {
          draft[key] = "";
        } else {
          const isTrue =
            v === true ||
            v === "true" ||
            v === "1" ||
            String(v).toLowerCase() === "ano";
          draft[key] = isTrue ? "true" : "false";
        }
      } else {
        draft[key] = v != null && v !== "" ? String(v) : "";
      }
    }
    for (const key of EDITABLE_AMENITIES) {
      const v = p[key];
      if (v === null || v === undefined || v === "") {
        draft[key] = "";
      } else {
        const isTrue =
          v === true ||
          v === "true" ||
          v === "1" ||
          String(v).toLowerCase() === "ano";
        draft[key] = isTrue ? "true" : "false";
      }
    }
    for (const key of EDITABLE_OSTATNI) {
      const v = p[key];
      draft[key] = v != null && v !== "" ? String(v) : "";
    }
    return draft;
  }, []);

  const handleStartEdit = useCallback(() => {
    if (!project) return;
    setDraftValues(fillDraftFromProject(project));
    setEditMode(true);
  }, [project, fillDraftFromProject]);

  const handleCancel = useCallback(() => {
    setEditMode(false);
    setDraftValues({});
  }, []);

  const handleChangeDraft = useCallback((key: string, value: unknown) => {
    setDraftValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!project || !projectId) return;
    setSaving(true);
    const allEditable = [
      ...EDITABLE_PREHLED,
      ...EDITABLE_FINANCOVANI,
      ...EDITABLE_STANDARDY,
      ...EDITABLE_AMENITIES,
      ...EDITABLE_OSTATNI,
    ];
    const changes: { key: string; value: string }[] = [];
    for (const key of allEditable) {
      const draftVal = draftValues[key];
      const currentVal = project[key];
      let isChanged = false;
      let payload = "";

      if (key.startsWith("payment_")) {
        const draftNum = Number(draftVal);
        const draftFraction = Number.isNaN(draftNum) ? null : draftNum > 1 ? draftNum / 100 : draftNum;
        const currentFraction = typeof currentVal === "number" ? currentVal : currentVal != null ? Number(currentVal) : null;
        if (draftFraction != null && draftFraction >= 0 && draftFraction <= 1) {
          const same = currentFraction != null && Math.abs(draftFraction - currentFraction) < 1e-6;
          if (!same) {
            isChanged = true;
            payload = String(Math.round(draftFraction * 10000) / 10000);
          }
        } else if (draftVal === "" && currentVal != null) {
          isChanged = true;
          payload = "";
        }
      } else if (key === "min_parking_indoor_price_czk" || key === "min_parking_outdoor_price_czk") {
        const n = draftVal === "" ? null : Math.round(Number(draftVal));
        const cur = currentVal != null ? Math.round(Number(currentVal)) : null;
        if (String(n ?? "") !== String(cur ?? "")) {
          isChanged = true;
          payload = n != null && !Number.isNaN(n) ? String(n) : "";
        }
      } else if (
        key === "renovation" ||
        key === "air_conditioning" ||
        key === "cooling_ceilings" ||
        key === "exterior_blinds" ||
        key === "smart_home"
      ) {
        const v = draftVal;
        // Tři stavy v UI: "—" (""), "true", "false"
        if (v === "" || v === null || v === undefined) {
          // Uživatel zvolil "—" → smažeme případný override na backendu.
          isChanged = true;
          payload = "";
        } else {
          const draftBool = v === true || v === "true" || v === "1";
          const curBool = currentVal === true || currentVal === "true" || currentVal === "1";
          if (draftBool !== curBool) {
            isChanged = true;
            payload = draftBool ? "true" : "false";
          }
        }
      } else {
        const draftStr = draftVal == null ? "" : String(draftVal).trim();
        const currentStr = currentVal == null ? "" : String(currentVal).trim();
        if (draftStr !== currentStr) {
          isChanged = true;
          payload = draftStr;
        }
      }

      if (isChanged) {
        changes.push({ key, value: payload });
      }
    }
    try {
      let updated = { ...project };
      for (const { key, value } of changes) {
        const res = await fetch(
          `${API_BASE}/projects/${encodeURIComponent(projectId)}/overrides/${encodeURIComponent(key)}`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) }
        );
        if (!res.ok) throw new Error(await res.text());
        updated = (await res.json()) as ProjectDetail;
      }
      setProjectState((prev) => ({ ...prev, data: updated }));
      setEditMode(false);
      setDraftValues({});
    } catch (e) {
      setProjectState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : "Chyba při ukládání",
      }));
    } finally {
      setSaving(false);
    }
  }, [project, projectId, draftValues]);

  const draft = (key: string) => (editMode && key in draftValues ? draftValues[key] : undefined);
  const displayOrDraft = (key: string, fallback: unknown) =>
    draft(key) !== undefined ? draft(key) : fallback;

  const statusPriority = (u: UnitInProject): number => {
    if (u.available) return 1;
    const s = String(u.availability_status ?? "").toLowerCase();
    if (s === "reserved" || s === "rezervované") return 2;
    if (s === "sold" || s === "prodané") return 3;
    return 4;
  };

  const sortedUnits = useMemo(() => {
    const list = unitsState.data ?? [];
    const dir = unitsSortDir === "asc" ? 1 : -1;
    const key = unitsSortBy;
    const cmp = (a: UnitInProject, b: UnitInProject): number => {
      const ap = statusPriority(a);
      const bp = statusPriority(b);
      if (ap !== bp) return ap - bp;
      const aVal = key === "unit_name" ? (a.unit_name ?? a.external_id) ?? "" : (a as Record<string, unknown>)[key];
      const bVal = key === "unit_name" ? (b.unit_name ?? b.external_id) ?? "" : (b as Record<string, unknown>)[key];
      const aNum = typeof aVal === "number" ? aVal : Number(aVal);
      const bNum = typeof bVal === "number" ? bVal : Number(bVal);
      if (key !== "unit_name" && key !== "layout" && key !== "availability_status" && !Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return (aNum - bNum) * dir;
      }
      const aStr = String(aVal ?? "").toLowerCase();
      const bStr = String(bVal ?? "").toLowerCase();
      return aStr.localeCompare(bStr, "cs") * dir;
    };
    return [...list].sort(cmp);
  }, [unitsState.data, unitsSortBy, unitsSortDir]);

  const handleUnitsSort = useCallback((key: UnitsSortKey) => {
    setUnitsSortBy((prev) => {
      if (prev === key) setUnitsSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else setUnitsSortDir("asc");
      return key;
    });
  }, []);

  // -- Collapsible state (must be before early returns) --
  const [showTechData, setShowTechData] = useState(false);
  const [unitsFilter, setUnitsFilter] = useState<"all" | "available" | "reserved" | "sold">("all");

  // Filter units (must be before early returns - Rules of Hooks)
  const filteredUnits = useMemo(() => {
    if (unitsFilter === "all") return sortedUnits;
    return sortedUnits.filter((u) => {
      const s = String(u.availability_status ?? "").toLowerCase();
      if (unitsFilter === "available") return s === "available" || s === "volné" || (u.available && !s);
      if (unitsFilter === "reserved") return s === "reserved" || s === "rezervované";
      if (unitsFilter === "sold") return s === "sold" || s === "prodané";
      return true;
    });
  }, [sortedUnits, unitsFilter]);

  // -- Loading --
  if (projectState.loading) {
    return (
      <div className="min-h-screen animate-pulse">
        <div className="mx-auto max-w-6xl space-y-6 p-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-16 rounded-full bg-slate-200" />
            <div className="h-7 w-64 rounded bg-slate-200" />
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 space-y-4">
            <div className="h-8 w-48 rounded bg-slate-200" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-20 rounded bg-slate-200" />
                  <div className="h-6 w-24 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-200 h-64" />
            <div className="rounded-2xl border border-slate-200/80 bg-slate-200 h-64" />
          </div>
        </div>
      </div>
    );
  }

  if (projectState.error) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-6xl space-y-4 p-4 pt-6">
          <button type="button" onClick={() => router.back()}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ← Zpět
          </button>
          <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
            {projectState.error}
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-6xl space-y-4 p-4 pt-6">
          <button type="button" onClick={() => router.back()}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ← Zpět
          </button>
          <p className="text-slate-600">Projekt nenalezen.</p>
        </div>
      </div>
    );
  }

  // -- Null/false helpers --
  const isNullish = (v: unknown): boolean => v === null || v === undefined || v === "" || v === "—";
  const isFalseValue = (v: unknown): boolean => {
    if (v === false) return true;
    const s = String(v ?? "").toLowerCase().trim();
    return s === "false" || s === "0" || s === "ne";
  };
  const hasValue = (key: string) => {
    const v = project[key];
    return !isNullish(v);
  };

  // Project URL
  const projectUrl = project["project_url"] as string | undefined;

  // Availability ratio
  const availRatio = project["available_units"] != null && project["total_units"] != null && Number(project["total_units"]) > 0
    ? Math.round((Number(project["available_units"]) / Number(project["total_units"])) * 100)
    : null;

  // -- Editable field render helper for bool select --
  const renderBoolEditField = (key: string, label: string) => {
    const val = project[key];
    if (!editMode && isNullish(val)) return null;
    return (
      <div key={key}>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {editMode ? (
          <select
            className="mt-0.5 w-full max-w-[10rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            value={(() => {
              const v = displayOrDraft(key, project[key]);
              if (v === "true" || v === true) return "true";
              if (v === "false" || v === false) return "false";
              return "";
            })()}
            onChange={(e) => handleChangeDraft(key, e.target.value)}>
            <option value="">—</option>
            <option value="true">Ano</option>
            <option value="false">Ne</option>
          </select>
        ) : (
          <p className="mt-0.5 font-medium text-slate-900">{formatBoolOrDash(val)}</p>
        )}
      </div>
    );
  };

  const renderEnumEditField = (key: string, label: string, mapKey?: string) => {
    const val = project[key];
    if (!editMode && isNullish(val)) return null;
    return (
      <div key={key}>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {editMode ? (
          <select
            className="mt-0.5 w-full max-w-xs rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            value={(displayOrDraft(key, project[key]) as string) ?? ""}
            onChange={(e) => handleChangeDraft(key, e.target.value)}>
            <option value="">—</option>
            {(filterSpecsByKey.get(key)?.options as string[] | undefined)?.map((opt) => (
              <option key={opt} value={opt}>{standardLabelToCzech(mapKey ?? key, String(opt))}</option>
            ))}
          </select>
        ) : (
          <p className="mt-0.5 font-medium text-slate-900">{standardLabelToCzech(mapKey ?? key, String(val ?? ""))}</p>
        )}
      </div>
    );
  };

  // -- Standards that have values --
  const STANDARDS_FIELDS = [
    { key: "renovation", label: "Rekonstrukce", type: "bool" },
    { key: "overall_quality", label: "Kvalita", type: "enum" },
    { key: "windows", label: "Okna", type: "enum" },
    { key: "partition_walls", label: "Příčky", type: "enum" },
    { key: "heating", label: "Topení", type: "enum" },
    { key: "category", label: "Kategorie", type: "enum" },
    { key: "floors", label: "Podlaha", type: "enum" },
    { key: "air_conditioning", label: "Klimatizace", type: "bool" },
    { key: "cooling_ceilings", label: "Chlazení stropem", type: "bool" },
    { key: "exterior_blinds", label: "Žaluzie", type: "blinds" },
    { key: "smart_home", label: "Smart home", type: "bool" },
    { key: "ceiling_height", label: "Výška stropů", type: "text" },
    { key: "recuperation", label: "Rekuperace", type: "bool" },
    { key: "cooling", label: "Chlazení podlahou", type: "bool" },
  ] as const;

  const filledStandards = STANDARDS_FIELDS.filter((f) => hasValue(f.key) && !isFalseValue(project[f.key]));
  const falseStandards = STANDARDS_FIELDS.filter((f) => isFalseValue(project[f.key]));

  const AMENITY_FIELDS = [
    { key: "concierge", label: "Concierge" },
    { key: "reception", label: "Recepce" },
    { key: "bike_room", label: "Kolárna" },
    { key: "stroller_room", label: "Kočárkárna" },
    { key: "fitness", label: "Fitness" },
    { key: "courtyard_garden", label: "Vnitroblok / zahrada" },
  ] as const;

  const filledAmenities = AMENITY_FIELDS.filter((f) => hasValue(f.key) && !isFalseValue(project[f.key]));
  const falseAmenities = AMENITY_FIELDS.filter((f) => isFalseValue(project[f.key]));

  // Financing has data?
  const hasFinancingData = editMode || ["payment_contract","payment_construction","payment_occupancy","min_parking_indoor_price_czk","min_parking_outdoor_price_czk"]
    .some((k) => hasValue(k));

  // Location fields
  const LOCATION_ADMIN = [
    { key: "municipality", label: "Obec" },
    { key: "city", label: "Město" },
    { key: "district", label: "Okres" },
    { key: "cadastral_area_iga", label: "Katastrální území" },
    { key: "administrative_district_iga", label: "Obvod Prahy" },
    { key: "region_iga", label: "Kraj" },
  ] as const;

  const LOCATION_TECH = [
    { key: "noise_day_db", label: "Denní hluk", suffix: " dB" },
    { key: "noise_night_db", label: "Noční hluk", suffix: " dB" },
    { key: "noise_label", label: "Hluk (klasifikace)" },
    { key: "distance_to_primary_road_m", label: "Vzdálenost od hlavní silnice", distance: true },
    { key: "distance_to_tram_tracks_m", label: "Vzdálenost od tramvajových kolejí", distance: true },
    { key: "distance_to_railway_m", label: "Vzdálenost od železnice", distance: true },
    { key: "distance_to_airport_m", label: "Vzdálenost od letiště", distance: true },
    { key: "micro_location_score", label: "Mikro-lokalita skóre", round: true },
    { key: "micro_location_label", label: "Mikro-lokalita hodnocení" },
  ] as const;

  const formatDistance = (v: unknown) => {
    if (v == null) return "—";
    const m = Number(v);
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
  };

  // -- RENDER --
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-6xl space-y-6 p-4 pt-6">

        {/* HERO BLOCK */}
        <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <button type="button" onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              ← Zpět
            </button>
            <div className="flex items-center gap-2">
              {!editMode ? (
                <button type="button" onClick={handleStartEdit} disabled={saving}
                  className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                  Editovat
                </button>
              ) : (
                <>
                  <button type="button" onClick={handleSave} disabled={saving}
                    className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    {saving ? "Ukládám…" : "Uložit"}
                  </button>
                  <button type="button" onClick={handleCancel} disabled={saving}
                    className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors">
                    Zrušit
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 mb-1">
                {developer !== "—" ? developer : "Developer neuveden"}
                {address !== "—" && <span className="text-slate-400"> · {address}</span>}
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{name || "Projekt"}</h1>
            </div>
            {availRatio != null && (
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${availRatio > 50 ? "bg-emerald-500" : availRatio > 20 ? "bg-amber-500" : "bg-rose-500"}`} />
                <span className="text-xs font-medium text-slate-600">
                  {String(project["available_units"])} / {String(project["total_units"])} dostupných ({availRatio}%)
                </span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Min. cena</p>
              <p className="text-xl font-bold text-slate-900">{formatCurrencyCzk((project["min_price_czk"] as number | null) ?? null)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Max. cena</p>
              <p className="text-xl font-bold text-slate-900">{formatCurrencyCzk((project["max_price_czk"] as number | null) ?? null)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Ø cena/m²</p>
              <p className="text-xl font-bold text-slate-900">{formatCurrencyCzk((project["avg_price_per_m2_czk"] as number | null) ?? null)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Ø plocha</p>
              <p className="text-xl font-bold text-slate-900">
                {project["avg_floor_area_m2"] != null ? `${Math.round(Number(project["avg_floor_area_m2"]))} m²` : "—"}
              </p>
            </div>
          </div>
          {/* Project URL and key dates */}
          <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100 items-center">
            {editMode ? (
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs font-medium text-slate-500 mb-1">Odkaz projektu</p>
                <input type="url"
                  className="w-full max-w-md rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("project_url", project["project_url"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("project_url", e.target.value)}
                  placeholder="https://…" />
              </div>
            ) : projectUrl ? (
              <a href={projectUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 no-underline transition hover:bg-slate-100 hover:border-slate-300">
                ↗ {projectUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
              </a>
            ) : null}
            {hasValue("max_days_on_market") && (
              <span className="text-xs text-slate-500">{String(project["max_days_on_market"])} dní na trhu</span>
            )}
            {hasValue("project_first_seen") && (
              <span className="text-xs text-slate-500">Od: {project["project_first_seen"] as string}</span>
            )}
          </div>
        </section>

        {/* MAP + WALKABILITY side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {projectGpsLat != null && projectGpsLng != null && (
            <section className="rounded-2xl border border-slate-200/70 bg-white/80 shadow-[0_14px_30px_rgba(15,23,42,0.06)] overflow-hidden">
              <div className="px-5 pt-4 pb-2">
                <h2 className="text-sm font-semibold tracking-wide text-slate-500">
                  <span className="uppercase">Poloha</span>: <span className="font-medium normal-case text-slate-900">{address || name || "—"}</span>
                </h2>
              </div>
              <ProjectDetailMap lat={projectGpsLat} lng={projectGpsLng} label={name || undefined} poiOverview={overviewPoi ?? undefined} />
            </section>
          )}

          {/* Walkability */}
          <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Walkability</h2>
              <div className="flex items-center gap-2">
                <button type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  onClick={() => setWalkPrefsOpen(true)}>
                  Preference lokality
                </button>
                {personalizedModeEnabled && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Dle preferencí</span>
                    {getNonDefaultChips(walkPrefs).slice(0, 3).map((chip) => (
                      <span key={chip} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{chip}</span>
                    ))}
                    <button type="button" className="ml-1 text-[11px] text-slate-500 hover:text-slate-700 underline decoration-dotted"
                      onClick={() => setPersonalizedModeEnabled(false)}>Vypnout</button>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Walkability skóre</p>
                <p className="mt-0.5 text-2xl font-bold text-slate-900">
                  {personalizedWalk?.score != null ? (() => {
                    const main = Math.round(personalizedWalk.score as number);
                    const baseRaw = project["walkability_score"] as number | string | null | undefined;
                    const base = typeof baseRaw === "number" ? baseRaw : baseRaw != null ? Number(baseRaw) : null;
                    const delta = base != null && !Number.isNaN(base) ? main - Math.round(base) : null;
                    return (
                      <span className="inline-flex items-baseline gap-1">
                        <span>{main}</span>
                        {delta != null && delta !== 0 && <span className={`text-xs ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>{delta > 0 ? `+${delta}` : delta}</span>}
                        <span className="text-[11px] text-slate-500">dle preferencí</span>
                      </span>
                    );
                  })() : project["walkability_score"] != null ? String(Math.round(Number(project["walkability_score"]))) : "—"}
                </p>
                <ScoreBar score={personalizedWalk?.score != null ? Math.round(personalizedWalk.score as number) : project["walkability_score"] != null ? Math.round(Number(project["walkability_score"])) : null} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Hodnocení</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {personalizedWalk?.label ? `${personalizedWalk.label}` : ((project["walkability_label"] as string | null) ?? "—")}
                </p>
              </div>
              {[
                { key: "daily_needs", pKey: "walkability_daily_needs_score", label: "Denní potřeby" },
                { key: "transport", pKey: "walkability_transport_score", label: "Doprava" },
                { key: "leisure", pKey: "walkability_leisure_score", label: "Volný čas" },
                { key: "family", pKey: "walkability_family_score", label: "Rodina" },
              ].map(({ key, pKey, label }) => (
                <div key={key}>
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-0.5 font-medium text-slate-900">
                    {(personalizedWalk as Record<string, unknown> | null)?.[key] != null
                      ? String(Math.round((personalizedWalk as Record<string, unknown>)[key] as number))
                      : project[pKey] != null ? String(project[pKey]) : "—"}
                  </p>
                  <ScoreBar score={(personalizedWalk as Record<string, unknown> | null)?.[key] != null ? Math.round((personalizedWalk as Record<string, unknown>)[key] as number) : project[pKey] != null ? Number(project[pKey]) : null} />
                </div>
              ))}
            </div>
            {/* POI distances */}
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {[
                { cat: "supermarkets", label: "Supermarket", dist: "distance_to_supermarket_m", count: "count_supermarket_500m" },
                { cat: "pharmacies", label: "Lékárna", dist: "distance_to_pharmacy_m", count: "count_pharmacy_500m" },
                { cat: "tram_stops", label: "Tram zastávka", dist: ["walking_distance_to_tram_stop_m","distance_to_tram_stop_m"] },
                { cat: "bus_stops", label: "Bus zastávka", dist: ["walking_distance_to_bus_stop_m","distance_to_bus_stop_m"] },
                { cat: "metro_stations", label: "Metro", dist: ["walking_distance_to_metro_station_m","distance_to_metro_station_m"] },
                { cat: "parks", label: "Park", dist: "distance_to_park_m", count: "count_park_500m" },
                { cat: "restaurants", label: "Restaurace", dist: "distance_to_restaurant_m", count: "count_restaurant_500m" },
                { cat: "cafes", label: "Kavárny", dist: "distance_to_cafe_m", count: "count_cafe_500m" },
                { cat: "fitness", label: "Fitness", dist: "distance_to_fitness_m", count: "count_fitness_500m" },
                { cat: "playgrounds", label: "Hřiště", dist: "distance_to_playground_m", count: "count_playground_500m" },
                { cat: "kindergartens", label: "Školka", dist: "distance_to_kindergarten_m", count: "count_kindergarten_500m" },
                { cat: "primary_schools", label: "Základní škola", dist: "distance_to_primary_school_m", count: "count_primary_school_500m" },
              ].map(({ cat, label: catLabel, dist, count }) => {
                const distKey = Array.isArray(dist) ? dist.find((k) => project[k] != null) : dist;
                const distVal = distKey ? project[distKey as string] : null;
                const countVal = count ? project[count as string] : null;
                return (
                  <div key={cat} role="button" tabIndex={0}
                    onClick={() => openPoiModal(cat, catLabel)}
                    onKeyDown={(e) => e.key === "Enter" && openPoiModal(cat, catLabel)}
                    className="cursor-pointer rounded-lg border border-transparent px-2 py-1.5 transition hover:border-slate-200 hover:bg-slate-50 hover:shadow-sm">
                    <p className="text-xs font-medium text-slate-500">{catLabel}</p>
                    <p className="mt-0.5 font-medium text-slate-900">
                      {distVal != null ? formatDistance(distVal) : "—"}
                      {countVal != null && Number(countVal) > 0 && (
                        <span className="ml-1 text-slate-500">({String(countVal)} v 500 m)</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* UNITS TABLE */}
        <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Jednotky v projektu {unitsState.data ? `(${unitsState.data.length})` : ""}
            </h2>
            <div className="flex gap-1">
              {(["all", "available", "reserved", "sold"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setUnitsFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    unitsFilter === f
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}>
                  {f === "all" ? "Vše" : f === "available" ? "Volné" : f === "reserved" ? "Rezervované" : "Prodané"}
                </button>
              ))}
            </div>
          </div>
          {unitsState.loading ? (
            <p className="text-sm text-slate-600">Načítání jednotek…</p>
          ) : unitsState.error ? (
            <p className="text-sm text-red-600">{unitsState.error}</p>
          ) : !unitsState.data || unitsState.data.length === 0 ? (
            <p className="text-sm text-slate-600">Žádné jednotky.</p>
          ) : filteredUnits.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Žádné jednotky v kategorii &quot;{unitsFilter === "available" ? "volné" : unitsFilter === "reserved" ? "rezervované" : "prodané"}&quot;.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    {([
                      ["unit_name", "Jednotka", "text-left"],
                      ["layout", "Dispozice", "text-left"],
                      ["floor_area_m2", "Plocha", "text-right"],
                      ["exterior_area_m2", "Venek", "text-right"],
                      ["price_czk", "Cena", "text-right"],
                      ["price_per_m2_czk", "Cena/m²", "text-right"],
                      ["availability_status", "Stav", "text-left"],
                    ] as [UnitsSortKey, string, string][]).map(([key, label, align]) => (
                      <th key={key} className={`px-4 py-2 ${align}`}>
                        <button type="button" onClick={() => handleUnitsSort(key)}
                          className={`flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 ${align === "text-right" ? "ml-auto" : ""}`}>
                          {label}{unitsSortBy === key && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredUnits.map((u) => {
                    const layoutStr = u.layout != null && /^layout_(\d+)(?:_(\d+))?$/i.test(String(u.layout))
                      ? String(u.layout).replace(/^layout_(\d+)(?:_(\d+))?$/i, (_, a, b) => b ? `${a},${b} kk` : `${a} kk`)
                      : u.layout ?? "—";
                    const isSold = (() => {
                      const s = String(u.availability_status ?? "").toLowerCase();
                      return s === "sold" || s === "prodané" || (!u.available && s !== "reserved" && s !== "rezervované");
                    })();
                    return (
                      <tr key={u.external_id} className={`hover:bg-slate-50 transition-colors ${isSold ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2">
                          <Link href={`/units/${encodeURIComponent(u.external_id)}`}
                            className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
                            {u.unit_name ?? u.external_id}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-slate-900">{layoutStr}</td>
                        <td className="px-4 py-2 text-right text-slate-900">{u.floor_area_m2 != null ? `${u.floor_area_m2.toFixed(1)} m²` : "—"}</td>
                        <td className="px-4 py-2 text-right text-slate-900">{u.exterior_area_m2 != null ? `${u.exterior_area_m2.toFixed(1)} m²` : "—"}</td>
                        <td className="px-4 py-2 text-right text-slate-900">{u.price_czk != null ? formatCurrencyCzk(u.price_czk) : "—"}</td>
                        <td className="px-4 py-2 text-right text-slate-900">{u.price_per_m2_czk != null ? formatCurrencyCzk(u.price_per_m2_czk) : "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            u.available ? "bg-emerald-100 text-emerald-700" :
                            String(u.availability_status ?? "").toLowerCase() === "reserved" || String(u.availability_status ?? "").toLowerCase() === "rezervované" ? "bg-amber-100 text-amber-700" :
                            "bg-rose-100 text-rose-700"
                          }`}>
                            {availabilityStatusLabel(u.availability_status, u.available)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* FINANCING (only if data) */}
        {hasFinancingData && (
          <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Financování a parkování</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { key: "payment_contract", label: "Platba po SOSBK (%)" },
                { key: "payment_construction", label: "Platba při výstavbě (%)" },
                { key: "payment_occupancy", label: "Platba po dokončení (%)" },
              ].map(({ key, label }) => {
                const val = project[key];
                if (!editMode && isNullish(val)) return null;
                return (
                  <div key={key}>
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    {editMode ? (
                      <input type="number" min={0} max={100} step={1}
                        className="mt-0.5 w-full max-w-[8rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={draft(key) !== undefined ? String(draft(key)) : (project[key] as number) != null ? ((project[key] as number) > 1 ? (project[key] as number) : (project[key] as number) * 100) : ""}
                        onChange={(e) => { const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value))); handleChangeDraft(key, v); }} />
                    ) : (
                      <p className="mt-0.5 font-medium text-slate-900">{formatPercent((val as number | null) ?? null, undefined, true)}</p>
                    )}
                  </div>
                );
              })}
              {[
                { key: "min_parking_indoor_price_czk", altKey: "max_parking_indoor_price_czk", label: "Cena garáže (Kč)" },
                { key: "min_parking_outdoor_price_czk", altKey: "max_parking_outdoor_price_czk", label: "Cena stání (Kč)" },
              ].map(({ key, altKey, label }) => {
                const val = (project[key] ?? project[altKey]) as number | null;
                if (!editMode && isNullish(val)) return null;
                return (
                  <div key={key}>
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    {editMode ? (
                      <input type="number" min={0} step={1}
                        className="mt-0.5 w-full max-w-[10rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={(displayOrDraft(key, val ?? "") as string) || ""}
                        onChange={(e) => { const v = e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value))); handleChangeDraft(key, v); }} />
                    ) : (
                      <p className="mt-0.5 font-medium text-slate-900">{formatCurrencyCzk(val)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* STANDARDS (only filled) */}
        {(filledStandards.length > 0 || editMode) && (
          <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Standardy</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(editMode ? STANDARDS_FIELDS : filledStandards).map((f) => {
                if (f.type === "bool") return renderBoolEditField(f.key, f.label);
                if (f.type === "enum") return renderEnumEditField(f.key, f.label);
                if (f.key === "exterior_blinds") {
                  const val = project[f.key];
                  if (!editMode && isNullish(val)) return null;
                  return (
                    <div key={f.key}>
                      <p className="text-xs font-medium text-slate-500">{f.label}</p>
                      {editMode ? (
                        <select className="mt-0.5 w-full max-w-[10rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                          value={(() => { const v = displayOrDraft(f.key, val); if (v == null || v === "") return ""; const s = String(v).toLowerCase(); if (s === "true" || s === "1" || s === "ano") return "true"; if (s === "false" || s === "0" || s === "ne") return "false"; if (s === "preparation" || s === "priprava" || s === "příprava") return "preparation"; return ""; })()}
                          onChange={(e) => handleChangeDraft(f.key, e.target.value)}>
                          <option value="">—</option>
                          <option value="true">Ano</option>
                          <option value="false">Ne</option>
                          <option value="preparation">Příprava</option>
                        </select>
                      ) : (
                        <p className="mt-0.5 font-medium text-slate-900">{(() => { const s = String(val ?? "").toLowerCase(); if (s === "true" || s === "1" || s === "ano") return "Ano"; if (s === "false" || s === "0" || s === "ne") return "Ne"; if (s === "preparation" || s === "priprava" || s === "příprava") return "Příprava"; return "—"; })()}</p>
                      )}
                    </div>
                  );
                }
                // text fields (ceiling_height)
                const val = project[f.key];
                if (!editMode && isNullish(val)) return null;
                return (
                  <div key={f.key}>
                    <p className="text-xs font-medium text-slate-500">{f.label}</p>
                    {editMode ? (
                      <input type="text" className="mt-0.5 w-full max-w-xs rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={(displayOrDraft(f.key, val) as string) ?? ""} onChange={(e) => handleChangeDraft(f.key, e.target.value)} placeholder="např. 2,9 m" />
                    ) : (
                      <p className="mt-0.5 font-medium text-slate-900">{val != null && val !== "" ? String(val) : "—"}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {!editMode && falseStandards.length > 0 && (
              <details className="mt-3 group">
                <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
                  <span className="group-open:hidden">Zobrazit vlastnosti s hodnotou Ne ({falseStandards.length})</span>
                  <span className="hidden group-open:inline">Skrýt</span>
                </summary>
                <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  {falseStandards.map((f) => (
                    <div key={f.key}>
                      <p className="text-xs font-medium text-slate-500">{f.label}</p>
                      <p className="mt-0.5 font-medium text-slate-900">{formatBoolOrDash(project[f.key])}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {/* AMENITIES (only filled) */}
        {(filledAmenities.length > 0 || editMode) && (
          <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Amenities</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(editMode ? AMENITY_FIELDS : filledAmenities).map((f) => renderBoolEditField(f.key, f.label))}
            </div>
            {!editMode && falseAmenities.length > 0 && (
              <details className="mt-3 group">
                <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
                  <span className="group-open:hidden">Zobrazit s hodnotou Ne ({falseAmenities.length})</span>
                  <span className="hidden group-open:inline">Skrýt</span>
                </summary>
                <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  {falseAmenities.map((f) => (
                    <div key={f.key}><p className="text-xs font-medium text-slate-500">{f.label}</p><p className="mt-0.5 font-medium text-slate-900">{formatBoolOrDash(project[f.key])}</p></div>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {/* OSTATNI (amenities text) */}
        {(editMode || hasValue("amenities")) && (
          <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Zajímavosti</h2>
            {editMode ? (
              <textarea className="w-full max-w-2xl rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" rows={4}
                value={(displayOrDraft("amenities", project["amenities"]) as string) ?? ""} onChange={(e) => handleChangeDraft("amenities", e.target.value)} />
            ) : (
              <p className="font-medium text-slate-900 whitespace-pre-wrap">{(project["amenities"] as string) ?? "—"}</p>
            )}
          </section>
        )}

        {/* LOCATION + TECH DATA (collapsible) */}
        <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Lokalita a technická data</h2>
            <button type="button" onClick={() => setShowTechData((v) => !v)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              {showTechData ? "Skrýt" : "Zobrazit"}
            </button>
          </div>
          {/* Always show transport times */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-3">
            {hasValue("ride_to_center_min") && (
              <div><p className="text-xs font-medium text-slate-500">Autem do centra</p><p className="mt-0.5 font-medium text-slate-900">{formatMinutes((project["ride_to_center_min"] ?? project["ride_to_center"]) as number | null)}</p></div>
            )}
            {hasValue("public_transport_to_center_min") && (
              <div><p className="text-xs font-medium text-slate-500">MHD do centra</p><p className="mt-0.5 font-medium text-slate-900">{formatMinutes((project["public_transport_to_center_min"] ?? project["public_transport_to_center"]) as number | null)}</p></div>
            )}
          </div>
          {showTechData && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {LOCATION_ADMIN.filter((f) => hasValue(f.key)).map((f) => (
                  <div key={f.key}><p className="text-xs font-medium text-slate-500">{f.label}</p><p className="mt-0.5 font-medium text-slate-900">{(project[f.key] as string) ?? "—"}</p></div>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {LOCATION_TECH.filter((f) => hasValue(f.key)).map((f) => (
                  <div key={f.key}>
                    <p className="text-xs font-medium text-slate-500">{f.label}</p>
                    <p className="mt-0.5 font-medium text-slate-900">
                      {"distance" in f && f.distance ? formatDistance(project[f.key]) :
                       "round" in f && f.round ? (project[f.key] != null ? String(Math.round(Number(project[f.key]))) : "—") :
                       "suffix" in f && f.suffix ? (project[f.key] != null ? `${project[f.key]}${f.suffix}` : "—") :
                       (project[f.key] as string | null) ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
              <button type="button" onClick={handleRecomputeLocationMetrics} disabled={recomputingLocation}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                {recomputingLocation ? "Přepočítávám…" : "Přepočítat hluk a mikro-lokalitu"}
              </button>
            </div>
          )}
        </section>

        {/* DEV / ADMIN */}
        {debugMode && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-800">Dev / Admin</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleAdminRecomputeAll} disabled={adminJobState.loading}
                className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                {adminJobState.loading ? "…" : "Přepočítat všechny projekty"}
              </button>
              <button type="button" onClick={handleAdminRefreshAndRecompute} disabled={adminJobState.loading}
                className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                {adminJobState.loading ? "…" : "Obnovit zdrojová data + přepočítat vše"}
              </button>
              <button type="button" onClick={handleAdminDownloadOsmAndRecompute} disabled={adminJobState.loading}
                className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                {adminJobState.loading ? "Stahování OSM… (1–2 min)" : "Stáhnout OSM infrastrukturu + přepočítat projekty"}
              </button>
              <button type="button" onClick={handleAdminWalkabilityRefreshAndRecompute} disabled={adminJobState.loading}
                className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                {adminJobState.loading ? "…" : "Obnovit walkability POI + přepočítat"}
              </button>
            </div>
            {adminJobState.message != null && <p className="mt-2 text-sm text-amber-900">{adminJobState.message}</p>}
          </section>
        )}

        {/* POI MODAL */}
        {poiModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closePoiModal} role="dialog" aria-modal="true" aria-label="Seznam POI">
            <div className="max-h-[90vh] w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{poiModal.categoryLabel}</h3>
                  <p className="text-[11px] text-slate-500">do 500 m{!poiModal.loading && poiModal.items.length > 0 ? ` · ${poiModal.items.length} míst` : ""}</p>
                </div>
                <button type="button" onClick={closePoiModal} className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" aria-label="Zavřít">×</button>
              </div>
              <div className="flex border-b border-slate-100">
                <button type="button" onClick={() => setPoiModal((p) => ({ ...p, view: "list" }))}
                  className={`flex-1 px-3 py-2 text-sm font-medium ${poiModal.view === "list" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>Seznam</button>
                <button type="button" onClick={() => setPoiModal((p) => ({ ...p, view: "map" }))}
                  className={`flex-1 px-3 py-2 text-sm font-medium ${poiModal.view === "map" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>Mapa</button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
                {poiModal.loading ? (
                  <p className="text-sm text-slate-500">Načítám…</p>
                ) : poiModal.view === "map" ? (
                  (() => {
                    const lat = projectState.data?.["gps_latitude"];
                    const lon = projectState.data?.["gps_longitude"];
                    if (lat == null || lon == null || typeof lat !== "number" || typeof lon !== "number") return <p className="text-sm text-slate-500">Pro zobrazení mapy jsou potřeba souřadnice projektu.</p>;
                    if (poiModal.items.length === 0) return <p className="text-sm text-slate-500">Žádné záznamy k zobrazení na mapě.</p>;
                    return <WalkabilityPoiModalMap projectLat={lat} projectLon={lon} items={poiModal.items} highlightIndices={[0, 1]} />;
                  })()
                ) : poiModal.items.length === 0 ? (
                  <p className="text-sm text-slate-500">Žádné záznamy</p>
                ) : (
                  <ul className="space-y-2">
                    {poiModal.items.map((item, idx) => (
                      <li key={idx} className={`rounded-xl border px-3 py-2 text-sm ${idx === 0 ? "border-emerald-300 bg-emerald-50/70" : idx === 1 ? "border-sky-300 bg-sky-50/70" : "border-slate-100 bg-slate-50/50"}`}>
                        <p className="flex items-center justify-between font-medium text-slate-900">
                          <span>{item.name ?? "—"}</span>
                          {idx === 0 && <span className="ml-2 inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">1. nejbližší</span>}
                          {idx === 1 && <span className="ml-2 inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">2. nejbližší</span>}
                        </p>
                        <p className="mt-0.5 text-slate-600">{item.distance_m != null ? (item.distance_m >= 1000 ? `${(item.distance_m / 1000).toFixed(1)} km` : `${Math.round(item.distance_m)} m`) : "—"}</p>
                        {item.lat != null && item.lon != null && (
                          <a href={`https://mapy.cz/zakladni?source=coor&id=${item.lon}&id=${item.lat}&x=${item.lon}&y=${item.lat}&z=17`} target="_blank" rel="noopener noreferrer"
                            className="mt-1 inline-block text-xs text-blue-600 hover:underline">Zobrazit na mapě</a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <WalkabilityPreferencesDrawer
          open={walkPrefsOpen} value={walkPrefs} onChange={setWalkPrefs}
          onClose={() => setWalkPrefsOpen(false)}
          onReset={() => { const def = resetWalkPrefs(); setWalkPrefs(def); }}
          onApply={() => { saveWalkPrefs(walkPrefs); setPersonalizedModeEnabled(true); setWalkPrefsOpen(false); }}
        />
      </div>
    </div>
  );
}

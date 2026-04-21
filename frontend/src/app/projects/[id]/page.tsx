"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE } from "@/lib/api";
import { usePoiOverview } from "@/hooks/usePoiOverview";
import type { FiltersResponse } from "@/lib/filters";
import { flattenFilterSpecsByKey } from "@/lib/filters";
import {
  formatCurrencyCzk,
  formatMinutes,
  formatPercent,
} from "@/lib/format";
import {
  type WalkabilityPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
  resetPreferences as resetWalkPrefs,
  isPersonalizedActive,

} from "@/lib/walkabilityPreferences";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import { StandardsChips, type ChipEntry } from "@/components/v2/StandardsChips";
import { WalkabilityCard } from "@/components/v2/WalkabilityCard";
import { HeroMap } from "@/components/v2/HeroMap";

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
    "aluminum-wood": "Hliník / dřevo",
    "aluminium-wood": "Hliník / dřevo",
    "aluminum-pvc": "Hliník / PVC",
    "aluminium-pvc": "Hliník / PVC",
  },
  partition_walls: {
    brick: "Cihla",
    drywall: "Sádrokarton",
    sdk: "Sádrokarton",
    concrete: "Beton",
    beton: "Beton",
    none: "Bez příček",
  },
  heating: {
    underfloor: "Podlahové",
    radiators: "Radiátory",
    ceiling: "Stropní",
    central: "Centrální",
    conventional: "Konvenční",
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
    hardwood: "Dřevěná podlaha",
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
  const raw = String(value).trim();
  if (map) {
    const lower = raw.toLowerCase();
    const translated = map[lower] ?? map[raw];
    if (translated) return translated;

    if (raw.includes(",")) {
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const pLower = part.toLowerCase();
          return map[pLower] ?? map[part] ?? (part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
        });
      if (parts.length > 0) return parts.join(", ");
    }
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
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

  const { poiOverview: overviewPoi } = usePoiOverview(
    projectId != null ? Number(projectId) : null,
    "supermarkets,pharmacies,parks,restaurants,tram_stops,bus_stops,metro_stations",
  );
  const [unitsSortBy, setUnitsSortBy] = useState<UnitsSortKey>("unit_name");
  const [unitsSortDir, setUnitsSortDir] = useState<"asc" | "desc">("asc");

  const [mapModalOpen, setMapModalOpen] = useState(false);
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
        key === "smart_home"
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
    { key: "floors", label: "Podlahový materiál", type: "enum" },
    { key: "air_conditioning", label: "Klimatizace", type: "bool" },
    { key: "cooling_ceilings", label: "Chlazení stropem", type: "bool" },
    { key: "exterior_blinds", label: "Žaluzie", type: "blinds" },
    { key: "smart_home", label: "Smart home", type: "bool" },
    { key: "ceiling_height", label: "Výška stropů", type: "text" },
    { key: "recuperation", label: "Rekuperace", type: "enum" },
    { key: "cooling", label: "Chlazení podlahou", type: "enum" },
  ] as const;

  const filledStandards = STANDARDS_FIELDS.filter((f) => hasValue(f.key) && !isFalseValue(project[f.key]));
  const falseStandards = STANDARDS_FIELDS.filter((f) => isFalseValue(project[f.key]));

  // Normalized ChipEntry arrays for StandardsChips component
  const standardChips: ChipEntry[] = filledStandards.map((f) => {
    if (f.type === "bool") return { key: f.key, label: f.label, variant: "yes" };
    if (f.key === "exterior_blinds") {
      const s = String(project[f.key] ?? "").toLowerCase();
      const lbl = s === "true" || s === "1" || s === "ano" ? "Ano" : s === "preparation" || s === "příprava" ? "Příprava" : String(project[f.key]);
      return { key: f.key, label: f.label, variant: "val", value: lbl };
    }
    return { key: f.key, label: f.label, variant: "val", value: standardLabelToCzech(f.key, String(project[f.key] ?? "")) };
  });
  const standardFalseChips: ChipEntry[] = falseStandards.map((f) => ({ key: f.key, label: f.label, variant: "no" }));

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

  // Normalized ChipEntry arrays for amenities
  const amenityChips: ChipEntry[] = filledAmenities.map((f) => ({ key: f.key, label: f.label, variant: "yes" }));
  const amenityFalseChips: ChipEntry[] = falseAmenities.map((f) => ({ key: f.key, label: f.label, variant: "no" }));

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
    <div className="space-y-4">

      {/* HERO — flex row: left content + right full-height map */}
      <div className="rv2-card flex overflow-hidden">

        {/* Left: content column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="rv2-section-head">
            <button type="button" onClick={() => router.back()}
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: "var(--r-text-secondary)" }}>
              ← Zpět
            </button>
            <div className="flex items-center gap-2">
              {!editMode ? (
                <button type="button" onClick={handleStartEdit} disabled={saving}
                  className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors"
                  style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-primary)", background: "var(--r-surface-1)" }}>
                  Editovat
                </button>
              ) : (
                <>
                  <button type="button" onClick={handleSave} disabled={saving}
                    className="rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--r-text-primary)" }}>
                    {saving ? "Ukládám…" : "Uložit"}
                  </button>
                  <button type="button" onClick={handleCancel} disabled={saving}
                    className="rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-secondary)" }}>
                    Zrušit
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="rv2-section-body">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: "var(--r-text-tertiary)" }}>
              {developer !== "—" ? developer : "Developer neuveden"}
              {address !== "—" && <span> · {address}</span>}
              {hasValue("construction_completion") && <span> · Dokončení {project["construction_completion"] as string}</span>}
            </p>
            <h1 className="text-2xl font-bold tracking-tight mb-4" style={{ color: "var(--r-text-primary)" }}>{name || "Projekt"}</h1>

            <div className="rv2-kpi-grid mb-4">
              <div className="rv2-kpi">
                <span className="rv2-kpi-label">Min. cena</span>
                <span className="rv2-kpi-value" style={{ fontSize: "var(--r-font-20)" }}>{formatCurrencyCzk((project["min_price_czk"] as number | null) ?? null)}</span>
              </div>
              <div className="rv2-kpi">
                <span className="rv2-kpi-label">Max. cena</span>
                <span className="rv2-kpi-value" style={{ fontSize: "var(--r-font-20)" }}>{formatCurrencyCzk((project["max_price_czk"] as number | null) ?? null)}</span>
              </div>
              <div className="rv2-kpi">
                <span className="rv2-kpi-label">Ø cena / m²</span>
                <span className="rv2-kpi-value" style={{ fontSize: "var(--r-font-20)" }}>{formatCurrencyCzk((project["avg_price_per_m2_czk"] as number | null) ?? null)}</span>
              </div>
              <div className="rv2-kpi">
                <span className="rv2-kpi-label">Dostupných</span>
                <span className="rv2-kpi-value" style={{ fontSize: "var(--r-font-20)" }}>
                  {project["available_units"] != null ? String(project["available_units"]) : "—"}
                  {project["total_units"] != null && (
                    <span className="rv2-kpi-hint"> / {String(project["total_units"])}</span>
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-3 border-t items-center" style={{ borderColor: "var(--r-border-subtle)" }}>
              {editMode ? (
                <div className="flex-1 min-w-[200px]">
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--r-text-secondary)" }}>URL projektu</p>
                  <input type="url"
                    className="w-full max-w-md rounded-lg border px-2 py-1.5 text-sm outline-none"
                    style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-primary)" }}
                    value={(displayOrDraft("project_url", project["project_url"]) as string) ?? ""}
                    onChange={(e) => handleChangeDraft("project_url", e.target.value)}
                    placeholder="https://…" />
                </div>
              ) : projectUrl ? (
                <a href={projectUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium no-underline transition hover:opacity-80"
                  style={{ borderColor: "var(--r-border-default)", background: "var(--r-surface-2)", color: "var(--r-text-secondary)" }}>
                  ↗ {projectUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                </a>
              ) : null}
              {hasValue("max_days_on_market") && (
                <span className="text-xs" style={{ color: "var(--r-text-tertiary)" }}>{String(project["max_days_on_market"])} dní na trhu</span>
              )}
              {hasValue("project_first_seen") && (
                <span className="text-xs" style={{ color: "var(--r-text-tertiary)" }}>Od: {project["project_first_seen"] as string}</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: full-height 1:1 map */}
        {projectGpsLat != null && projectGpsLng != null && (
          <div className="relative self-stretch shrink-0 overflow-hidden border-l"
            style={{ aspectRatio: "1 / 1", borderColor: "var(--r-border-default)", minHeight: 260 }}>
            <HeroMap lat={projectGpsLat} lng={projectGpsLng} zoomControl={true} />
            <button
              type="button"
              onClick={() => setMapModalOpen(true)}
              className="absolute top-2 right-2 flex items-center justify-center rounded-full shadow-md transition-opacity hover:opacity-90 cursor-pointer"
              style={{ width: 32, height: 32, zIndex: 1001, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(4px)" }}
              aria-label="Zvětšit mapu"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* 2-COLUMN BODY */}
      <div className="rv2-detail-2col">

        {/* === LEFT COLUMN === */}
        <div className="min-w-0 space-y-4">

          {/* UNITS */}
          <div className="rv2-card">
            <div className="rv2-section-head">
              <h2 className="rv2-section-title">
                Jednotky{unitsState.data ? ` (${unitsState.data.length})` : ""}
              </h2>
              <div className="flex gap-1">
                {(["all", "available", "reserved", "sold"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setUnitsFilter(f)}
                    className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                    style={unitsFilter === f
                      ? { background: "var(--r-text-primary)", color: "#fff" }
                      : { border: "1px solid var(--r-border-default)", background: "var(--r-surface-1)", color: "var(--r-text-secondary)" }}>
                    {f === "all" ? "Vše" : f === "available" ? "Volné" : f === "reserved" ? "Rezerv." : "Prodané"}
                  </button>
                ))}
              </div>
            </div>
            {unitsState.loading ? (
              <p className="rv2-empty">Načítání jednotek…</p>
            ) : unitsState.error ? (
              <p className="px-4 py-6 text-sm text-rose-600">{unitsState.error}</p>
            ) : !unitsState.data || unitsState.data.length === 0 ? (
              <p className="rv2-empty">Žádné jednotky.</p>
            ) : filteredUnits.length === 0 ? (
              <p className="rv2-empty italic">Žádné v kategorii „{unitsFilter === "available" ? "volné" : unitsFilter === "reserved" ? "rezervované" : "prodané"}".</p>
            ) : (
              <div className="rv2-card-scroll">
                <table className="rv2-table">
                  <thead>
                    <tr>
                      {([
                        ["unit_name", "Jednotka", false],
                        ["layout", "Dispozice", false],
                        ["floor_area_m2", "Plocha", true],
                        ["exterior_area_m2", "Ext.", true],
                        ["price_czk", "Cena", true],
                        ["price_per_m2_czk", "Cena/m²", true],
                        ["availability_status", "Stav", false],
                      ] as [UnitsSortKey, string, boolean][]).map(([key, label, alignRight]) => (
                        <th key={key} style={alignRight ? { textAlign: "right" } : undefined}>
                          <button type="button" onClick={() => handleUnitsSort(key)}
                            className="font-semibold hover:opacity-70 transition-opacity"
                            style={{ textAlign: "inherit" }}>
                            {label}{unitsSortBy === key && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnits.map((u) => {
                      const layoutStr = u.layout != null && /^layout_(\d+)(?:_(\d+))?$/i.test(String(u.layout))
                        ? String(u.layout).replace(/^layout_(\d+)(?:_(\d+))?$/i, (_, a, b) => b ? `${a},${b} kk` : `${a} kk`)
                        : u.layout ?? "—";
                      const statusStr = String(u.availability_status ?? "").toLowerCase();
                      const isSold = statusStr === "sold" || statusStr === "prodané" || (!u.available && statusStr !== "reserved" && statusStr !== "rezervované");
                      const statusCls = u.available ? "bg-emerald-100 text-emerald-700"
                        : statusStr === "reserved" || statusStr === "rezervované" ? "bg-amber-100 text-amber-700"
                        : "bg-rose-100 text-rose-700";
                      return (
                        <tr key={u.external_id} style={isSold ? { opacity: 0.45 } : undefined}>
                          <td>
                            <Link href={`/units/${encodeURIComponent(u.external_id)}`}
                              className="font-medium underline decoration-slate-300 underline-offset-2 hover:decoration-current"
                              style={{ color: "var(--r-text-primary)" }}>
                              {u.unit_name ?? u.external_id}
                            </Link>
                          </td>
                          <td>{layoutStr}</td>
                          <td style={{ textAlign: "right" }}>{u.floor_area_m2 != null ? `${u.floor_area_m2.toFixed(1)} m²` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{u.exterior_area_m2 != null ? `${u.exterior_area_m2.toFixed(1)} m²` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{u.price_czk != null ? formatCurrencyCzk(u.price_czk) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{u.price_per_m2_czk != null ? formatCurrencyCzk(u.price_per_m2_czk) : "—"}</td>
                          <td>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusCls}`}>
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
          </div>

          {/* STANDARDS */}
          {(filledStandards.length > 0 || editMode) && (
            <div className="rv2-card">
              <div className="rv2-section-head">
                <h2 className="rv2-section-title">Standardy</h2>
              </div>
              <div className="rv2-section-body">
                {editMode ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {STANDARDS_FIELDS.map((f) => {
                      if (f.type === "bool") return renderBoolEditField(f.key, f.label);
                      if (f.type === "enum") return renderEnumEditField(f.key, f.label);
                      if (f.key === "exterior_blinds") {
                        const val = project[f.key];
                        return (
                          <div key={f.key}>
                            <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{f.label}</p>
                            <select className="mt-0.5 w-full max-w-[10rem] rounded-lg border px-2 py-1.5 text-sm outline-none"
                              style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-primary)" }}
                              value={(() => { const v = displayOrDraft(f.key, val); if (v == null || v === "") return ""; const s = String(v).toLowerCase(); if (s === "true" || s === "1" || s === "ano") return "true"; if (s === "false" || s === "0" || s === "ne") return "false"; if (s === "preparation" || s === "priprava" || s === "příprava") return "preparation"; return ""; })()}
                              onChange={(e) => handleChangeDraft(f.key, e.target.value)}>
                              <option value="">—</option>
                              <option value="true">Ano</option>
                              <option value="false">Ne</option>
                              <option value="preparation">Příprava</option>
                            </select>
                          </div>
                        );
                      }
                      const val = project[f.key];
                      if (isNullish(val)) return null;
                      return (
                        <div key={f.key}>
                          <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{f.label}</p>
                          <input type="text" className="mt-0.5 w-full max-w-xs rounded-lg border px-2 py-1.5 text-sm outline-none"
                            style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-primary)" }}
                            value={(displayOrDraft(f.key, val) as string) ?? ""} onChange={(e) => handleChangeDraft(f.key, e.target.value)} placeholder="např. 2,9 m" />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <StandardsChips items={standardChips} falseItems={standardFalseChips} />
                )}
              </div>
            </div>
          )}

          {/* AMENITIES */}
          {(filledAmenities.length > 0 || editMode) && (
            <div className="rv2-card">
              <div className="rv2-section-head">
                <h2 className="rv2-section-title">Vybavenost</h2>
              </div>
              <div className="rv2-section-body">
                {editMode ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {AMENITY_FIELDS.map((f) => renderBoolEditField(f.key, f.label))}
                  </div>
                ) : (
                  <StandardsChips items={amenityChips} falseItems={amenityFalseChips} />
                )}
              </div>
            </div>
          )}

          {/* ZAJÍMAVOSTI */}
          {(editMode || hasValue("amenities")) && (
            <div className="rv2-card">
              <div className="rv2-section-head">
                <h2 className="rv2-section-title">Zajímavosti</h2>
              </div>
              <div className="rv2-section-body">
                {editMode ? (
                  <textarea className="w-full max-w-2xl rounded-lg border px-2 py-1.5 text-sm outline-none" rows={4}
                    style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-primary)" }}
                    value={(displayOrDraft("amenities", project["amenities"]) as string) ?? ""} onChange={(e) => handleChangeDraft("amenities", e.target.value)} />
                ) : (
                  <p className="text-sm font-medium whitespace-pre-wrap" style={{ color: "var(--r-text-primary)" }}>{(project["amenities"] as string) ?? "—"}</p>
                )}
              </div>
            </div>
          )}

          {/* FINANCING */}
          {hasFinancingData && (
            <div className="rv2-card">
              <div className="rv2-section-head">
                <h2 className="rv2-section-title">Financování a parkování</h2>
              </div>
              <div className="rv2-section-body">
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
                        <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{label}</p>
                        {editMode ? (
                          <input type="number" min={0} max={100} step={1}
                            className="mt-0.5 w-full max-w-[8rem] rounded-lg border px-2 py-1.5 text-sm outline-none"
                            style={{ borderColor: "var(--r-border-default)" }}
                            value={draft(key) !== undefined ? String(draft(key)) : (project[key] as number) != null ? ((project[key] as number) > 1 ? (project[key] as number) : (project[key] as number) * 100) : ""}
                            onChange={(e) => { const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value))); handleChangeDraft(key, v); }} />
                        ) : (
                          <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{formatPercent((val as number | null) ?? null, undefined, true)}</p>
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
                        <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{label}</p>
                        {editMode ? (
                          <input type="number" min={0} step={1}
                            className="mt-0.5 w-full max-w-[10rem] rounded-lg border px-2 py-1.5 text-sm outline-none"
                            style={{ borderColor: "var(--r-border-default)" }}
                            value={(displayOrDraft(key, val ?? "") as string) || ""}
                            onChange={(e) => { const v = e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value))); handleChangeDraft(key, v); }} />
                        ) : (
                          <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{formatCurrencyCzk(val)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* LOCATION + TECH DATA */}
          <div className="rv2-card">
            <div className="rv2-section-head">
              <h2 className="rv2-section-title">Lokalita a tech. data</h2>
              <button type="button" onClick={() => setShowTechData((v) => !v)}
                className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-secondary)", background: "var(--r-surface-1)" }}>
                {showTechData ? "Skrýt" : "Zobrazit vše"}
              </button>
            </div>
            <div className="rv2-section-body">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {hasValue("ride_to_center_min") && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>Autem do centra</p>
                    <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{formatMinutes((project["ride_to_center_min"] ?? project["ride_to_center"]) as number | null)}</p>
                  </div>
                )}
                {hasValue("public_transport_to_center_min") && (
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>MHD do centra</p>
                    <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{formatMinutes((project["public_transport_to_center_min"] ?? project["public_transport_to_center"]) as number | null)}</p>
                  </div>
                )}
              </div>
              {showTechData && (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {LOCATION_ADMIN.filter((f) => hasValue(f.key)).map((f) => (
                      <div key={f.key}>
                        <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{f.label}</p>
                        <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>{(project[f.key] as string) ?? "—"}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {LOCATION_TECH.filter((f) => hasValue(f.key)).map((f) => (
                      <div key={f.key}>
                        <p className="text-xs font-medium" style={{ color: "var(--r-text-secondary)" }}>{f.label}</p>
                        <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--r-text-primary)" }}>
                          {"distance" in f && f.distance ? formatDistance(project[f.key]) :
                           "round" in f && f.round ? (project[f.key] != null ? String(Math.round(Number(project[f.key]))) : "—") :
                           "suffix" in f && f.suffix ? (project[f.key] != null ? `${project[f.key]}${f.suffix}` : "—") :
                           (project[f.key] as string | null) ?? "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={handleRecomputeLocationMetrics} disabled={recomputingLocation}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors"
                    style={{ borderColor: "var(--r-border-default)", color: "var(--r-text-secondary)", background: "var(--r-surface-1)" }}>
                    {recomputingLocation ? "Přepočítávám…" : "Přepočítat hluk a mikro-lokalitu"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* DEV/ADMIN */}
          {debugMode && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-800">Dev / Admin</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleAdminRecomputeAll} disabled={adminJobState.loading}
                  className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  {adminJobState.loading ? "…" : "Přepočítat všechny projekty"}
                </button>
                <button type="button" onClick={handleAdminRefreshAndRecompute} disabled={adminJobState.loading}
                  className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  {adminJobState.loading ? "…" : "Obnovit zdrojová data + přepočítat"}
                </button>
                <button type="button" onClick={handleAdminDownloadOsmAndRecompute} disabled={adminJobState.loading}
                  className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  {adminJobState.loading ? "Stahování OSM…" : "Stáhnout OSM + přepočítat"}
                </button>
                <button type="button" onClick={handleAdminWalkabilityRefreshAndRecompute} disabled={adminJobState.loading}
                  className="rounded-full border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  {adminJobState.loading ? "…" : "Obnovit walkability + přepočítat"}
                </button>
              </div>
              {adminJobState.message != null && <p className="mt-2 text-xs text-amber-900">{adminJobState.message}</p>}
            </section>
          )}
        </div>

        {/* === RIGHT SIDEBAR === */}
        <aside className="rv2-detail-sidebar">


          <WalkabilityCard
            project={project}
            personalizedWalk={personalizedWalk}
            personalizedModeEnabled={personalizedModeEnabled}
            onSetPersonalizedModeEnabled={setPersonalizedModeEnabled}
            onPreferencesOpen={() => setWalkPrefsOpen(true)}
            onPoiClick={(cat, label) => openPoiModal(cat, label)}
          />
        </aside>
      </div>

      {/* MAP MODAL */}
      {mapModalOpen && projectGpsLat != null && projectGpsLng != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setMapModalOpen(false)} role="dialog" aria-modal="true" aria-label="Mapa projektu">
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden shadow-2xl bg-white"
            style={{ maxWidth: "min(896px, 90vh)" }}
            onClick={(e) => e.stopPropagation()}>
            <HeroMap lat={projectGpsLat} lng={projectGpsLng} zoomControl={true} attributionControl={true} />
            <button type="button" onClick={() => setMapModalOpen(false)}
              className="absolute top-3 right-3 flex items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-90 cursor-pointer"
              style={{ width: 32, height: 32, zIndex: 1001, background: "rgba(255,255,255,0.95)" }}
              aria-label="Zavřít mapu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
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
  );
}

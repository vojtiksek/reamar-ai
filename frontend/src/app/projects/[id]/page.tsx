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

  if (projectState.loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-6xl p-4">
          <p className="text-slate-600">Načítání…</p>
        </div>
      </div>
    );
  }

  if (projectState.error) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Zpět
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {projectState.error}
          </div>
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Zpět
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4">
          <p className="text-slate-600">Projekt nenalezen.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Zpět
            </button>
            <h1 className="text-lg font-semibold text-slate-900">{name || "Projekt"}</h1>
          </div>
          <div className="flex items-center gap-2">
            {!editMode ? (
              <button
                type="button"
                onClick={handleStartEdit}
                disabled={saving}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Editovat
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? "Ukládám…" : "Uložit"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Zrušit
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4">
        {/* Řádek: Přehled + Mapa vedle sebe */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Přehled
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Název</p>
                <p className="mt-0.5 font-medium text-slate-900">{name || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Developer</p>
                <p className="mt-0.5 font-medium text-slate-900">{developer}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Odkaz projektu</p>
                {editMode ? (
                  <input
                    type="url"
                    className="mt-0.5 w-full max-w-md rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    value={(displayOrDraft("project_url", project["project_url"]) as string) ?? ""}
                    onChange={(e) => handleChangeDraft("project_url", e.target.value)}
                    placeholder="https://…"
                  />
                ) : (project["project_url"] as string | undefined) ? (
                  <p className="mt-0.5 font-medium text-slate-900">
                    <a
                      href={project["project_url"] as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600"
                    >
                      {(project["project_url"] as string).replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                    </a>
                  </p>
                ) : (
                  <p className="mt-0.5 font-medium text-slate-900">—</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Dní na trhu (max)</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["max_days_on_market"] != null ? `${project["max_days_on_market"]} dní` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">První výskyt</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["project_first_seen"] as string | undefined) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Poslední výskyt</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["project_last_seen"] as string | undefined) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Datum prodeje</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {(project["sold_date"] as string | undefined) ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Počet jednotek</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["total_units"] != null ? String(project["total_units"]) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Dostupných jednotek</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["available_units"] != null ? String(project["available_units"]) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Podíl dostupných</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["availability_ratio"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Min cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["min_price_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Max cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["max_price_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Průměrná cena</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["avg_price_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Průměrná cena/m²</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    (project["avg_price_per_m2_czk"] as number | null | undefined) ?? null
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Průměrná plocha m²</p>
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["avg_floor_area_m2"] != null
                    ? `${Math.round(Number(project["avg_floor_area_m2"])).toLocaleString("cs-CZ")} m²`
                    : "—"}
                </p>
              </div>
            </div>
          </section>

          {projectGpsLat != null && projectGpsLng != null && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold tracking-wide text-slate-500">
                <span className="uppercase">Poloha</span>:{" "}
                <span className="font-medium normal-case text-slate-900">
                  {address || name || "—"}
                </span>
              </h2>
              <ProjectDetailMap
                lat={projectGpsLat}
                lng={projectGpsLng}
                label={name || undefined}
                poiOverview={overviewPoi ?? undefined}
              />
            </section>
          )}
        </div>

        {/* Financování a parkování – celá šířka */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Financování a parkování
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Platba po SOSBK (%)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    draft("payment_contract") !== undefined
                      ? String(draft("payment_contract"))
                      : (project["payment_contract"] as number) != null
                        ? ((project["payment_contract"] as number) > 1
                          ? (project["payment_contract"] as number)
                          : (project["payment_contract"] as number) * 100)
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value)));
                    handleChangeDraft("payment_contract", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["payment_contract"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Platba při výstavbě (%)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    draft("payment_construction") !== undefined
                      ? String(draft("payment_construction"))
                      : (project["payment_construction"] as number) != null
                        ? ((project["payment_construction"] as number) > 1
                          ? (project["payment_construction"] as number)
                          : (project["payment_construction"] as number) * 100)
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value)));
                    handleChangeDraft("payment_construction", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["payment_construction"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Platba po dokončení (%)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    draft("payment_occupancy") !== undefined
                      ? String(draft("payment_occupancy"))
                      : (project["payment_occupancy"] as number) != null
                        ? ((project["payment_occupancy"] as number) > 1
                          ? (project["payment_occupancy"] as number)
                          : (project["payment_occupancy"] as number) * 100)
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.min(100, Math.max(0, Number(e.target.value)));
                    handleChangeDraft("payment_occupancy", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatPercent(
                    (project["payment_occupancy"] as number | null | undefined) ?? null,
                    undefined,
                    true
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Cena garáže (Kč)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    (displayOrDraft(
                      "min_parking_indoor_price_czk",
                      (project["min_parking_indoor_price_czk"] ?? project["max_parking_indoor_price_czk"]) ?? ""
                    ) as string) || ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value)));
                    handleChangeDraft("min_parking_indoor_price_czk", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    ((project["min_parking_indoor_price_czk"] as number | null | undefined) ??
                      (project["max_parking_indoor_price_czk"] as number | null | undefined)) ?? null
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Cena stání (Kč)</p>
              {editMode ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={
                    (displayOrDraft(
                      "min_parking_outdoor_price_czk",
                      (project["min_parking_outdoor_price_czk"] ?? project["max_parking_outdoor_price_czk"]) ?? ""
                    ) as string) || ""
                  }
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value)));
                    handleChangeDraft("min_parking_outdoor_price_czk", v);
                  }}
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatCurrencyCzk(
                    ((project["min_parking_outdoor_price_czk"] as number | null | undefined) ??
                      (project["max_parking_outdoor_price_czk"] as number | null | undefined)) ?? null
                  )}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Standardy – všechna pole upravitelná, enum z filtrů */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Standardy
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Rekonstrukce</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("renovation", project["renovation"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("renovation", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["renovation"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kvalita</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("overall_quality", project["overall_quality"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("overall_quality", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("overall_quality")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{standardLabelToCzech("overall_quality", String(opt))}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {standardLabelToCzech("overall_quality", (project["overall_quality"] as string) ?? "")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Okna</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("windows", project["windows"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("windows", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("windows")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{standardLabelToCzech("windows", String(opt))}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {standardLabelToCzech("windows", (project["windows"] as string) ?? "")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Příčky</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("partition_walls", project["partition_walls"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("partition_walls", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("partition_walls")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{standardLabelToCzech("partition_walls", String(opt))}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {standardLabelToCzech("partition_walls", (project["partition_walls"] as string) ?? "")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Topení</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("heating", project["heating"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("heating", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("heating")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{standardLabelToCzech("heating", String(opt))}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {standardLabelToCzech("heating", (project["heating"] as string) ?? "")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kategorie</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("category", project["category"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("category", e.target.value)}
                >
                  <option value="">—</option>
                  {(filterSpecsByKey.get("category")?.options as string[] | undefined)?.map((opt) => (
                    <option key={opt} value={opt}>{standardLabelToCzech("category", String(opt))}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {standardLabelToCzech("category", (project["category"] as string) ?? "")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Podlaha</p>
              {editMode ? (
                (() => {
                  const floorsOpts = filterSpecsByKey.get("floors")?.options as string[] | undefined;
                  if (floorsOpts?.length) {
                    return (
                      <select
                        className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        value={(displayOrDraft("floors", project["floors"]) as string) ?? ""}
                        onChange={(e) => handleChangeDraft("floors", e.target.value)}
                      >
                        <option value="">—</option>
                        {floorsOpts.map((opt) => (
                          <option key={String(opt)} value={String(opt)}>{standardLabelToCzech("floors", String(opt))}</option>
                        ))}
                      </select>
                    );
                  }
                  return (
                    <input
                      type="text"
                      className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      value={(displayOrDraft("floors", project["floors"]) as string) ?? ""}
                      onChange={(e) => handleChangeDraft("floors", e.target.value)}
                    />
                  );
                })()
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["floors"] != null && project["floors"] !== "" ? standardLabelToCzech("floors", String(project["floors"])) : "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Klimatizace</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("air_conditioning", project["air_conditioning"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("air_conditioning", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["air_conditioning"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Chlazení stropem</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("cooling_ceilings", project["cooling_ceilings"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("cooling_ceilings", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["cooling_ceilings"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Žaluzie</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("exterior_blinds", project["exterior_blinds"]);
                    if (v == null || v === "") return "";
                    const s = String(v).toLowerCase();
                    if (s === "true" || s === "1" || s === "ano") return "true";
                    if (s === "false" || s === "0" || s === "ne") return "false";
                    if (s === "preparation" || s === "priprava" || s === "příprava") return "preparation";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("exterior_blinds", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                  <option value="preparation">Příprava</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {(() => {
                    const v = project["exterior_blinds"];
                    if (v == null || v === "") return "—";
                    const s = String(v).toLowerCase();
                    if (s === "true" || s === "1" || s === "ano") return "Ano";
                    if (s === "false" || s === "0" || s === "ne") return "Ne";
                    if (s === "preparation" || s === "priprava" || s === "příprava") return "Příprava";
                    return "—";
                  })()}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Smart home</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("smart_home", project["smart_home"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("smart_home", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["smart_home"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Výška stropů</p>
              {editMode ? (
                <input
                  type="text"
                  className="mt-0.5 w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(displayOrDraft("ceiling_height", project["ceiling_height"]) as string) ?? ""}
                  onChange={(e) => handleChangeDraft("ceiling_height", e.target.value)}
                  placeholder="např. 2,9 m"
                />
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {project["ceiling_height"] != null && project["ceiling_height"] !== ""
                    ? (project["ceiling_height"] as string)
                    : "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Rekuperace</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("recuperation", project["recuperation"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("recuperation", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["recuperation"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Chlazení podlahou</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("cooling", project["cooling"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("cooling", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["cooling"])}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Amenities – nová sekce, jen pro detail projektu */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Amenities
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Concierge</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("concierge", project["concierge"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("concierge", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["concierge"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Recepce</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("reception", project["reception"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("reception", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["reception"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kolárna</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("bike_room", project["bike_room"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("bike_room", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["bike_room"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kočárkárna</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("stroller_room", project["stroller_room"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("stroller_room", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["stroller_room"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Fitness</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("fitness", project["fitness"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("fitness", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["fitness"])}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Vnitroblok / zahrada</p>
              {editMode ? (
                <select
                  className="mt-0.5 w-full max-w-[10rem] rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={(() => {
                    const v = displayOrDraft("courtyard_garden", project["courtyard_garden"]);
                    if (v === "true" || v === true) return "true";
                    if (v === "false" || v === false) return "false";
                    return "";
                  })()}
                  onChange={(e) => handleChangeDraft("courtyard_garden", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Ano</option>
                  <option value="false">Ne</option>
                </select>
              ) : (
                <p className="mt-0.5 font-medium text-slate-900">
                  {formatBoolOrDash(project["courtyard_garden"])}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Lokalita */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Lokalita
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Autem do centra</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatMinutes(
                  (project["ride_to_center_min"] as number | null | undefined) ??
                    (project["ride_to_center"] as number | null | undefined) ??
                    null
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">MHD do centra</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {formatMinutes(
                  (project["public_transport_to_center_min"] as number | null | undefined) ??
                    (project["public_transport_to_center"] as number | null | undefined) ??
                    null
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Obec</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["municipality"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Město</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["city"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Okres</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["district"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Katastrální území</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["cadastral_area_iga"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Obvod Prahy</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["administrative_district_iga"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Kraj</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["region_iga"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Denní hluk</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["noise_day_db"] != null
                  ? `${project["noise_day_db"] as number} dB`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Noční hluk</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["noise_night_db"] != null
                  ? `${project["noise_night_db"] as number} dB`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Hluk (klasifikace)</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["noise_label"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            {/* Mikro-lokalita */}
            <div>
              <p className="text-xs font-medium text-slate-500">Vzdálenost od hlavní silnice</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_primary_road_m"] != null
                  ? Number(project["distance_to_primary_road_m"]) >= 1000
                    ? `${(Number(project["distance_to_primary_road_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_primary_road_m"]))} m`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Vzdálenost od tramvajových kolejí</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_tram_tracks_m"] != null
                  ? Number(project["distance_to_tram_tracks_m"]) >= 1000
                    ? `${(Number(project["distance_to_tram_tracks_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_tram_tracks_m"]))} m`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Vzdálenost od železnice</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_railway_m"] != null
                  ? Number(project["distance_to_railway_m"]) >= 1000
                    ? `${(Number(project["distance_to_railway_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_railway_m"]))} m`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Vzdálenost od letiště</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_airport_m"] != null
                  ? Number(project["distance_to_airport_m"]) >= 1000
                    ? `${(Number(project["distance_to_airport_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_airport_m"]))} m`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Mikro-lokalita skóre</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["micro_location_score"] != null
                  ? String(Math.round(Number(project["micro_location_score"])))
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Mikro-lokalita hodnocení</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["micro_location_label"] as string | null | undefined) ?? "—"}
              </p>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={handleRecomputeLocationMetrics}
                disabled={recomputingLocation}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {recomputingLocation ? "Přepočítávám…" : "Přepočítat hluk a mikro-lokalitu"}
              </button>
            </div>
          </div>
        </section>

        {/* Walkability */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Walkability
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="glass-pill border border-transparent px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                onClick={() => setWalkPrefsOpen(true)}
              >
                Preference lokality
              </button>
              {personalizedModeEnabled && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    Dle preferencí klienta
                  </span>
                  {getNonDefaultChips(walkPrefs)
                    .slice(0, 3)
                    .map((chip) => (
                      <span
                        key={chip}
                        className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                      >
                        {chip}
                      </span>
                    ))}
                  <button
                    type="button"
                    className="ml-1 text-[11px] text-slate-500 hover:text-slate-700 underline decoration-dotted"
                    onClick={() => setPersonalizedModeEnabled(false)}
                  >
                    Vypnout
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Walkability skóre</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {personalizedWalk?.score != null ? (
                  (() => {
                    const main = Math.round(personalizedWalk.score as number);
                    const baseRaw = project["walkability_score"] as number | string | null | undefined;
                    const base =
                      typeof baseRaw === "number"
                        ? baseRaw
                        : baseRaw != null
                          ? Number(baseRaw)
                          : null;
                    const delta =
                      base != null && !Number.isNaN(base)
                        ? main - Math.round(base)
                        : null;
                    return (
                      <span className="inline-flex items-baseline gap-1">
                        <span>{main}</span>
                        {delta != null && delta !== 0 && (
                          <span
                            className={`text-xs ${
                              delta > 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-500">dle preferencí</span>
                      </span>
                    );
                  })()
                ) : project["walkability_score"] != null ? (
                  String(Math.round(Number(project["walkability_score"])))
                ) : (
                  "—"
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Walkability hodnocení</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {personalizedWalk?.label
                  ? `${personalizedWalk.label} (dle preferencí)`
                  : ((project["walkability_label"] as string | null | undefined) ?? "—")}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Denní potřeby</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {personalizedWalk?.daily_needs != null
                  ? String(Math.round(personalizedWalk.daily_needs))
                  : project["walkability_daily_needs_score"] != null
                    ? String(project["walkability_daily_needs_score"])
                    : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Doprava</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {personalizedWalk?.transport != null
                  ? String(Math.round(personalizedWalk.transport))
                  : project["walkability_transport_score"] != null
                    ? String(project["walkability_transport_score"])
                    : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Volný čas</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {personalizedWalk?.leisure != null
                  ? String(Math.round(personalizedWalk.leisure))
                  : project["walkability_leisure_score"] != null
                    ? String(project["walkability_leisure_score"])
                    : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Rodina</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {personalizedWalk?.family != null
                  ? String(Math.round(personalizedWalk.family))
                  : project["walkability_family_score"] != null
                    ? String(project["walkability_family_score"])
                    : "—"}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("supermarkets", "Supermarkety")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("supermarkets", "Supermarkety")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Supermarket</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_supermarket_m"] != null
                  ? Number(project["distance_to_supermarket_m"]) >= 1000
                    ? `${(Number(project["distance_to_supermarket_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_supermarket_m"]))} m`
                  : "—"}
                {project["count_supermarket_500m"] != null && Number(project["count_supermarket_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_supermarket_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("pharmacies", "Lékárny")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("pharmacies", "Lékárny")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Lékárna</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_pharmacy_m"] != null
                  ? Number(project["distance_to_pharmacy_m"]) >= 1000
                    ? `${(Number(project["distance_to_pharmacy_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_pharmacy_m"]))} m`
                  : "—"}
                {project["count_pharmacy_500m"] != null && Number(project["count_pharmacy_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_pharmacy_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("tram_stops", "Tram zastávky")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("tram_stops", "Tram zastávky")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Tram zastávka</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["walking_distance_to_tram_stop_m"] ?? project["distance_to_tram_stop_m"]) != null
                  ? (() => {
                      const m = Number(project["walking_distance_to_tram_stop_m"] ?? project["distance_to_tram_stop_m"]);
                      return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
                    })()
                  : "—"}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("bus_stops", "Bus zastávky")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("bus_stops", "Bus zastávky")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Bus zastávka</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["walking_distance_to_bus_stop_m"] ?? project["distance_to_bus_stop_m"]) != null
                  ? (() => {
                      const m = Number(project["walking_distance_to_bus_stop_m"] ?? project["distance_to_bus_stop_m"]);
                      return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
                    })()
                  : "—"}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("metro_stations", "Metro")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("metro_stations", "Metro")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Metro</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {(project["walking_distance_to_metro_station_m"] ?? project["distance_to_metro_station_m"]) != null
                  ? (() => {
                      const m = Number(project["walking_distance_to_metro_station_m"] ?? project["distance_to_metro_station_m"]);
                      return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
                    })()
                  : "—"}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("parks", "Parky")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("parks", "Parky")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Park</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_park_m"] != null
                  ? Number(project["distance_to_park_m"]) >= 1000
                    ? `${(Number(project["distance_to_park_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_park_m"]))} m`
                  : "—"}
                {project["count_park_500m"] != null && Number(project["count_park_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_park_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("restaurants", "Restaurace")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("restaurants", "Restaurace")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Restaurace</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_restaurant_m"] != null
                  ? Number(project["distance_to_restaurant_m"]) >= 1000
                    ? `${(Number(project["distance_to_restaurant_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_restaurant_m"]))} m`
                  : "—"}
                {project["count_restaurant_500m"] != null && Number(project["count_restaurant_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_restaurant_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("cafes", "Kavárny")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("cafes", "Kavárny")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Kavárny</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_cafe_m"] != null
                  ? Number(project["distance_to_cafe_m"]) >= 1000
                    ? `${(Number(project["distance_to_cafe_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_cafe_m"]))} m`
                  : "—"}
                {project["count_cafe_500m"] != null && Number(project["count_cafe_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_cafe_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("fitness", "Fitness")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("fitness", "Fitness")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Fitness</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_fitness_m"] != null
                  ? Number(project["distance_to_fitness_m"]) >= 1000
                    ? `${(Number(project["distance_to_fitness_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_fitness_m"]))} m`
                  : "—"}
                {project["count_fitness_500m"] != null && Number(project["count_fitness_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_fitness_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("playgrounds", "Hřiště")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("playgrounds", "Hřiště")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Hřiště</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_playground_m"] != null
                  ? Number(project["distance_to_playground_m"]) >= 1000
                    ? `${(Number(project["distance_to_playground_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_playground_m"]))} m`
                  : "—"}
                {project["count_playground_500m"] != null && Number(project["count_playground_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_playground_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("kindergartens", "Školky")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("kindergartens", "Školky")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Školka</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_kindergarten_m"] != null
                  ? Number(project["distance_to_kindergarten_m"]) >= 1000
                    ? `${(Number(project["distance_to_kindergarten_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_kindergarten_m"]))} m`
                  : "—"}
                {project["count_kindergarten_500m"] != null && Number(project["count_kindergarten_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_kindergarten_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => openPoiModal("primary_schools", "Základní školy")}
              onKeyDown={(e) => e.key === "Enter" && openPoiModal("primary_schools", "Základní školy")}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            >
              <p className="text-xs font-medium text-slate-500">Základní škola</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {project["distance_to_primary_school_m"] != null
                  ? Number(project["distance_to_primary_school_m"]) >= 1000
                    ? `${(Number(project["distance_to_primary_school_m"]) / 1000).toFixed(1)} km`
                    : `${Math.round(Number(project["distance_to_primary_school_m"]))} m`
                  : "—"}
                {project["count_primary_school_500m"] != null && Number(project["count_primary_school_500m"]) > 0 && (
                  <span className="ml-1 text-slate-500">({project["count_primary_school_500m"]} v 500 m)</span>
                )}
              </p>
            </div>
          </div>
        </section>

        {/* Ostatní – Zajímavosti upravitelné */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Ostatní
          </h2>
          <div>
            <p className="text-xs font-medium text-slate-500">Zajímavosti</p>
            {editMode ? (
              <textarea
                className="mt-0.5 w-full max-w-2xl rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                rows={4}
                value={(displayOrDraft("amenities", project["amenities"]) as string) ?? ""}
                onChange={(e) => handleChangeDraft("amenities", e.target.value)}
              />
            ) : (
              <p className="mt-0.5 font-medium text-slate-900 whitespace-pre-wrap">
                {(project["amenities"] as string | null | undefined) ?? "—"}
              </p>
            )}
          </div>
        </section>

        {/* Jednotky v projektu */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Jednotky v projektu
          </h2>
          {unitsState.loading ? (
            <p className="text-sm text-slate-600">Načítání jednotek…</p>
          ) : unitsState.error ? (
            <p className="text-sm text-red-600">{unitsState.error}</p>
          ) : !unitsState.data || unitsState.data.length === 0 ? (
            <p className="text-sm text-slate-600">Žádné jednotky.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("unit_name")}
                        className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Jednotka
                        {unitsSortBy === "unit_name" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("layout")}
                        className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Dispozice
                        {unitsSortBy === "layout" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("floor_area_m2")}
                        className="ml-auto flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Plocha
                        {unitsSortBy === "floor_area_m2" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("exterior_area_m2")}
                        className="ml-auto flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Venek
                        {unitsSortBy === "exterior_area_m2" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("price_czk")}
                        className="ml-auto flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Cena
                        {unitsSortBy === "price_czk" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("price_per_m2_czk")}
                        className="ml-auto flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Cena/m²
                        {unitsSortBy === "price_per_m2_czk" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <button
                        type="button"
                        onClick={() => handleUnitsSort("availability_status")}
                        className="flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
                      >
                        Stav
                        {unitsSortBy === "availability_status" && (unitsSortDir === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedUnits.map((u) => {
                    const layoutStr =
                      u.layout != null && /^layout_(\d+)(?:_(\d+))?$/i.test(String(u.layout))
                        ? String(u.layout).replace(/^layout_(\d+)(?:_(\d+))?$/i, (_, a, b) =>
                            b ? `${a},${b} kk` : `${a} kk`
                          )
                        : u.layout ?? "—";
                    return (
                      <tr key={u.external_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <Link
                            href={`/units/${encodeURIComponent(u.external_id)}`}
                            className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600"
                          >
                            {u.unit_name ?? u.external_id}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-slate-900">{layoutStr}</td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.floor_area_m2 != null ? `${u.floor_area_m2.toFixed(1)} m²` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.exterior_area_m2 != null ? `${u.exterior_area_m2.toFixed(1)} m²` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.price_czk != null ? formatCurrencyCzk(u.price_czk) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-900">
                          {u.price_per_m2_czk != null ? formatCurrencyCzk(u.price_per_m2_czk) : "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-900">
                          {availabilityStatusLabel(u.availability_status, u.available)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Dev: přepočet všech projektů a refresh zdrojových dat */}
        {debugMode && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-800">Dev / Admin</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAdminRecomputeAll}
                disabled={adminJobState.loading}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {adminJobState.loading ? "…" : "Přepočítat všechny projekty"}
              </button>
              <button
                type="button"
                onClick={handleAdminRefreshAndRecompute}
                disabled={adminJobState.loading}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {adminJobState.loading ? "…" : "Obnovit zdrojová data + přepočítat vše"}
              </button>
              <button
                type="button"
                onClick={handleAdminDownloadOsmAndRecompute}
                disabled={adminJobState.loading}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {adminJobState.loading ? "Stahování OSM… (1–2 min)" : "Stáhnout OSM infrastrukturu + přepočítat projekty"}
              </button>
              <button
                type="button"
                onClick={handleAdminWalkabilityRefreshAndRecompute}
                disabled={adminJobState.loading}
                className="glass-pill border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {adminJobState.loading ? "…" : "Obnovit walkability POI + přepočítat"}
              </button>
            </div>
            {adminJobState.message != null && (
              <p className="mt-2 text-sm text-amber-900">{adminJobState.message}</p>
            )}
          </section>
        )}

        {/* Walkability POI list modal */}
        {poiModal.open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={closePoiModal}
            role="dialog"
            aria-modal="true"
            aria-label="Seznam POI"
          >
            <div
              className="max-h-[90vh] w-full max-w-5xl rounded-xl border border-slate-200 bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">{poiModal.categoryLabel} v okolí</h3>
                <button
                  type="button"
                  onClick={closePoiModal}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Zavřít"
                >
                  ×
                </button>
              </div>
              <div className="flex border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setPoiModal((p) => ({ ...p, view: "list" }))}
                  className={`flex-1 px-3 py-2 text-sm font-medium ${poiModal.view === "list" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Seznam
                </button>
                <button
                  type="button"
                  onClick={() => setPoiModal((p) => ({ ...p, view: "map" }))}
                  className={`flex-1 px-3 py-2 text-sm font-medium ${poiModal.view === "map" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Mapa
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
                {poiModal.loading ? (
                  <p className="text-sm text-slate-500">Načítám…</p>
                ) : poiModal.view === "map" ? (
                  (() => {
                    const lat = projectState.data?.["gps_latitude"];
                    const lon = projectState.data?.["gps_longitude"];
                    if (lat == null || lon == null || typeof lat !== "number" || typeof lon !== "number") {
                      return <p className="text-sm text-slate-500">Pro zobrazení mapy jsou potřeba souřadnice projektu.</p>;
                    }
                    if (poiModal.items.length === 0) {
                      return <p className="text-sm text-slate-500">Žádné záznamy k zobrazení na mapě.</p>;
                    }
                    return (
                      <WalkabilityPoiModalMap
                        projectLat={lat}
                        projectLon={lon}
                        items={poiModal.items}
                        highlightIndices={[0, 1]}
                      />
                    );
                  })()
                ) : poiModal.items.length === 0 ? (
                  <p className="text-sm text-slate-500">Žádné záznamy</p>
                ) : (
                  <ul className="space-y-2">
                    {poiModal.items.map((item, idx) => (
                      <li
                        key={idx}
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          idx === 0
                            ? "border-emerald-300 bg-emerald-50/70"
                            : idx === 1
                              ? "border-sky-300 bg-sky-50/70"
                              : "border-slate-100 bg-slate-50/50"
                        }`}
                      >
                        <p className="flex items-center justify-between font-medium text-slate-900">
                          <span>{item.name ?? "—"}</span>
                          {idx === 0 && (
                            <span className="ml-2 inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              1. nejbližší
                            </span>
                          )}
                          {idx === 1 && (
                            <span className="ml-2 inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                              2. nejbližší
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-slate-600">
                          {item.distance_m != null
                            ? item.distance_m >= 1000
                              ? `${(item.distance_m / 1000).toFixed(1)} km`
                              : `${Math.round(item.distance_m)} m`
                            : "—"}
                        </p>
                        {item.lat != null && item.lon != null && (
                          <a
                            href={`https://mapy.cz/zakladni?source=coor&id=${item.lon}&id=${item.lat}&x=${item.lon}&y=${item.lat}&z=17`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                          >
                            Zobrazit na mapě
                          </a>
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
        open={walkPrefsOpen}
        value={walkPrefs}
        onChange={setWalkPrefs}
        onClose={() => setWalkPrefsOpen(false)}
        onReset={() => {
          const def = resetWalkPrefs();
          setWalkPrefs(def);
        }}
        onApply={() => {
          saveWalkPrefs(walkPrefs);
          setPersonalizedModeEnabled(true);
          setWalkPrefsOpen(false);
        }}
      />
      </main>
    </div>
  );
}


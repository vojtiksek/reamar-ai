"use client";

import type React from "react";

import { FiltersDrawer } from "@/components/FiltersDrawer";
import { FilterChips } from "@/components/FilterChips";
import { ClientModeBar } from "@/components/ClientModeBar";
import { useFilterGroups } from "@/hooks/useFilterGroups";
import { useFilterDrawer } from "@/hooks/useFilterDrawer";
import { SummaryBar } from "@/components/SummaryBar";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import {
  buildUnitsQuery,
  countActiveFilters,
  type CurrentFilters,
  filtersToSearchParams,
  parseFiltersFromSearchParams,
} from "@/lib/filters";
import { formatAreaM2, formatByDisplayFormat, formatCurrencyCzk, formatCurrencyPerM2, formatDate, formatLayout, formatLayoutsList, formatMinutes, formatPercent } from "@/lib/format";
import { API_BASE } from "@/lib/api";
import { decodePolygon, getPolygonBounds } from "@/lib/geo";
import {
  type WalkabilityPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
  resetPreferences as resetWalkPrefs,
  isPersonalizedActive,
  getNonDefaultChips,
  getDefaultPreferences,
} from "@/lib/walkabilityPreferences";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useActiveClient } from "@/contexts/ActiveClientContext";
import { filtersEqual, filtersToProfilePatch } from "@/lib/clientFilters";

type ProjectItem = {
  id: number;
  [key: string]: unknown;
};

type ProjectsOverviewResponse = {
  items: ProjectItem[];
  total: number;
  limit: number;
  offset: number;
};

type ProjectRecItem = {
  rec_id: number;
  pinned_by_broker: boolean;
  project_id: number | null;
  project_name?: string | null;
  score: number;
  budget_fit: number;
  walkability_fit: number;
  location_fit: number;
  layout_fit: number;
  area_fit: number;
  outdoor_fit: number;
  price_czk?: number | null;
};

type ProjectRecGroup = {
  project_id: number;
  project_name: string;
  unit_count: number;
  pinned_count: number;
  best_score: number;
  avg_score: number;
  price_min: number | null;
  avg_budget_fit: number;
  avg_walkability_fit: number;
  avg_location_fit: number;
  avg_layout_fit: number;
  avg_area_fit: number;
  avg_outdoor_fit: number;
};

type ProjectColumnDef = {
  key: string;
  label: string;
  data_type: string;
  unit?: string | null;
  kind?: "catalog" | "computed";
  accessor?: string;
  display_format?: string;
  editable?: boolean;
};

type ProjectColumnConfig = {
  key: string;
  label: string;
  visible: boolean;
};

const DEFAULT_LIMIT = 100;
const ROWS_PER_PAGE_OPTIONS = [100, 300, 500] as const;
const PROJECTS_COLUMNS_STORAGE_KEY = "projects_columns_v1";
const DEFAULT_VISIBLE_COLUMNS = 10;

/** Keys shown by default for users without saved column preferences, in display order. */
const DEFAULT_VISIBLE_KEYS: string[] = [
  "name",
  "developer",
  "total_units",
  "available_units",
  "avg_price_czk",
  "avg_price_per_m2_czk",
  "municipality",
  "ride_to_center",
  "public_transport_to_center",
  "walkability_score",
];
const DEFAULT_VISIBLE_KEYS_SET = new Set(DEFAULT_VISIBLE_KEYS);

function formatProjectValue(value: unknown, column: ProjectColumnDef): string {
  if (value == null || value === "") return "—";

  const num = Number(value);
  const isNumber = !Number.isNaN(num);

  // Rekonstrukce a žaluzie – vlastní texty podle katalogového klíče
  if (column.key === "renovation" || column.key === "exterior_blinds") {
    return formatByDisplayFormat(value, column.display_format ?? "", column.key);
  }

  // Obecné booleany: ANO/NE
  if (column.data_type === "bool" || typeof value === "boolean") {
    return formatByDisplayFormat(value, "boolean", column.key);
  }

  // Layouts list
  if (column.key === "layouts_present") {
    return formatLayoutsList(value);
  }

  // Ceny: vždy Kč, bez desetinných míst, s mezerou mezi tisíci (jako na jednotkách)
  if (column.unit === "Kč" || column.unit?.includes("Kč")) {
    return formatCurrencyCzk(isNumber ? num : null);
  }
  if (column.key.endsWith("_price_per_m2_czk") || column.key.includes("price_per_m2")) {
    return formatCurrencyPerM2(isNumber ? num : null);
  }
  if (
    column.key.endsWith("_price_czk") ||
    column.key === "min_price_czk" ||
    column.key === "avg_price_czk" ||
    column.key === "max_price_czk"
  ) {
    return formatCurrencyCzk(isNumber ? num : null);
  }
  if (column.key.includes("parking") && column.key.endsWith("_czk")) {
    return formatCurrencyCzk(isNumber ? num : null);
  }

  // Počet jednotek (celá čísla)
  if (column.key === "units_total" || column.key === "units_available" || column.key === "units_priced") {
    return isNumber ? String(Math.round(num)) : "—";
  }

  // Plocha v m² (včetně průměrné plochy): jedno desetinné místo
  if (column.unit && column.unit.includes("m²")) {
    return formatAreaM2(isNumber ? num : null);
  }
  if (column.key === "avg_floor_area_m2" || column.key.endsWith("_area_m2") || column.key.endsWith("_m2")) {
    return formatAreaM2(isNumber ? num : null);
  }

  // Duration (minutes)
  if (
    column.unit === "min" ||
    column.key.endsWith("_min") ||
    column.key.includes("ride_to_center") ||
    column.key.includes("public_transport_to_center")
  ) {
    return formatMinutes(isNumber ? num : null);
  }

  // Hluk (dB a klasifikace) a vzdálenosti – delegujeme na sdílenou lib
  if (
    column.key === "noise_day_db" ||
    column.key === "noise_night_db" ||
    column.key === "noise_label" ||
    column.key === "distance_to_primary_road_m" ||
    column.key === "distance_to_tram_tracks_m" ||
    column.key === "distance_to_railway_m" ||
    column.key === "distance_to_airport_m"
  ) {
    return formatByDisplayFormat(value, column.display_format ?? "", column.key);
  }

  // Mikro-lokalita: skóre (číslo) a hodnocení (text)
  if (column.key === "micro_location_score") {
    return isNumber ? String(Math.round(num)) : "—";
  }
  if (column.key === "micro_location_label") {
    return value != null && String(value).trim() !== "" ? String(value) : "—";
  }

  // Percent-style fields (stored as fraction 0–1): platby i min/max; u financování 0 = nevyplněno
  if (
    column.unit === "%" ||
    column.key === "availability_ratio" ||
    column.key === "available_ratio" ||
    column.key.includes("payment_contract") ||
    column.key.includes("payment_construction") ||
    column.key.includes("payment_occupancy")
  ) {
    if (column.key === "availability_ratio" || column.key === "available_ratio") {
      return formatPercent(isNumber ? num : null, 1);
    }
    const isFinancing =
      column.key.includes("payment_contract") ||
      column.key.includes("payment_construction") ||
      column.key.includes("payment_occupancy");
    return formatPercent(isNumber ? num : null, undefined, isFinancing);
  }

  // Dates
  if (column.data_type === "date") {
    return formatDate(value);
  }

  // Generic number
  if (column.data_type === "number" && isNumber) {
    return String(num);
  }

  return String(value);
}

/** Flat key for projects overview (strip "project." so it matches API row keys and sort_by). */
function getProjectColumnKey(col: ProjectColumnDef): string {
  const raw = col.accessor ?? col.key;
  return raw.startsWith("project.") ? raw.replace(/^project\./, "") : raw;
}

/** Resolve cell value from a flat overview row. Strips "project." prefix from accessor. */
function getProjectCellValue(row: ProjectItem, col: ProjectColumnDef): unknown {
  const accessor = getProjectColumnKey(col);
  return row[accessor];
}

function computeProjectsSummary(items: ProjectItem[], totalCount: number) {
  const withPpm2 = items.filter(
    (p) => p.avg_price_per_m2_czk != null && !Number.isNaN(Number(p.avg_price_per_m2_czk))
  );
  const withPrice = items.filter(
    (p) => p.avg_price_czk != null && !Number.isNaN(Number(p.avg_price_czk))
  );
  const sumPpm2 = withPpm2.reduce((a, p) => a + Number(p.avg_price_per_m2_czk), 0);
  const sumPrice = withPrice.reduce((a, p) => a + Number(p.avg_price_czk), 0);
  const availableCount = items.reduce((a, p) => a + (Number(p.units_available) ?? 0), 0);
  return {
    total: totalCount,
    averagePricePerM2: withPpm2.length ? sumPpm2 / withPpm2.length : null,
    averagePrice: withPrice.length ? sumPrice / withPrice.length : null,
    availableCount,
  };
}

function renderWalkabilityWithDelta(
  personalizedScore: number,
  defaultScore: unknown
): JSX.Element {
  const main = Math.round(personalizedScore);
  const base =
    typeof defaultScore === "number"
      ? defaultScore
      : defaultScore != null
        ? Number(defaultScore)
        : null;
  const delta = base != null && !Number.isNaN(base)
    ? main - Math.round(Number(base))
    : null;

  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{main}</span>
      {delta != null && delta !== 0 && (
        <span
          className={`text-[11px] ${
            delta > 0 ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
      <span className="text-[11px] text-slate-500">dle preferencí</span>
    </span>
  );
}

function parseProjectsSearchParams(params: URLSearchParams): {
  filters: CurrentFilters;
  limit: number;
  offset: number;
  sortBy: string;
  sortDir: string;
  polygon?: string | null;
} {
  const limitParam = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = ROWS_PER_PAGE_OPTIONS.includes(limitParam as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? limitParam
    : DEFAULT_LIMIT;
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  let sortBy = params.get("sort_by") ?? "avg_price_per_m2_czk";
  // Kanonické názvy: ride_to_center / public_transport_to_center (ne _min)
  if (sortBy === "ride_to_center_min") sortBy = "ride_to_center";
  if (sortBy === "public_transport_to_center_min") sortBy = "public_transport_to_center";
  const sortDir = (params.get("sort_dir") === "desc" ? "desc" : "asc") as "asc" | "desc";
  const filters = parseFiltersFromSearchParams(params);
  const polygon = params.get("poly");
  return { filters, limit, offset, sortBy, sortDir, polygon };
}

function toProjectsSearchParams(
  filters: CurrentFilters,
  limit: number,
  offset: number,
  sortBy: string,
  sortDir: string,
  polygon?: string | null
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("sort_by", sortBy);
  params.set("sort_dir", sortDir);
  const fp = filtersToSearchParams(filters);
  fp.forEach((v, k) => params.set(k, v));
  if (polygon && polygon.trim() !== "") {
    params.set("poly", polygon);
  }
  return params;
}

function escapeCsvCell(val: string): string {
  if (/["\r\n,]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function downloadProjectsCsv(
  items: ProjectItem[],
  visibleColumns: ProjectColumnDef[]
) {
  const header = visibleColumns.map((c) => escapeCsvCell(c.label)).join(",");
  const rows = items.map((p) => {
    return visibleColumns
      .map((col) => {
        const raw = getProjectCellValue(p, col);
        const formatted = formatProjectValue(raw, col);
        return escapeCsvCell(String(formatted ?? ""));
      })
      .join(",");
  });
  const csv = "\uFEFF" + [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `projekty-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


function scoreLabel(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: "Výborné", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= 60) return { label: "Dobré",   cls: "bg-blue-100 text-blue-800" };
  if (score >= 40) return { label: "OK",      cls: "bg-amber-100 text-amber-800" };
  return                    { label: "Slabé",  cls: "bg-slate-100 text-slate-600" };
}

function FitDot({ value, title }: { value: number; title: string }) {
  const color = value >= 70 ? "bg-emerald-400" : value >= 40 ? "bg-amber-400" : "bg-red-400";
  return <span title={`${title}: ${Math.round(value)}`} className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function ProjectsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initial = useMemo(
    () => parseProjectsSearchParams(new URLSearchParams(searchParams?.toString() ?? "")),
    []
  );

  const filterGroups = useFilterGroups("projects/filters");
  const [filters, setFilters] = useState<CurrentFilters>(initial.filters);
  const { currentFilters, drawerOpen, openDrawer, closeDrawer, onReset, onChangeFilter } = useFilterDrawer(filters);
  const { activeClient, activate } = useActiveClient();
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [columns, setColumns] = useState<ProjectColumnDef[]>([]);
  const [columnsConfig, setColumnsConfig] = useState<ProjectColumnConfig[] | null>(null);

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState<number>(initial.limit);
  const [offset, setOffset] = useState(initial.offset);
  const [sortBy, setSortBy] = useState<string>(initial.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortDir as "asc" | "desc");
  const [polygon, setPolygon] = useState<string | null>(initial.polygon ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingToClient, setSavingToClient] = useState(false);
  const [editingCell, setEditingCell] = useState<{ projectId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string | boolean>("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const [walkPrefsOpen, setWalkPrefsOpen] = useState(false);
  const [walkPrefs, setWalkPrefs] = useState<WalkabilityPreferences>(() => getDefaultPreferences());
  const [personalizedModeEnabled, setPersonalizedModeEnabled] = useState<boolean>(false);
  const [personalizedScores, setPersonalizedScores] = useState<
    Map<number, { score: number | null; label: string | null }>
  >(new Map());

  const rowClickTimeoutRef = useRef<number | null>(null);

  const syncToUrl = useCallback(
    (f: CurrentFilters, lim: number, off: number, sb: string, sd: string, poly: string | null) => {
      const p = toProjectsSearchParams(f, lim, off, sb, sd, poly ?? undefined);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname]
  );

  useEffect(() => {
    const parsed = parseProjectsSearchParams(new URLSearchParams(searchParams?.toString() ?? ""));
    setFilters(parsed.filters);
    setLimit(parsed.limit);
    setOffset(parsed.offset);
    setSortBy(parsed.sortBy);
    setSortDir(parsed.sortDir as "asc" | "desc");
    setPolygon(parsed.polygon ?? null);
  }, [searchParams]);

  // Initialize walkability preferences and mode on client (avoid SSR mismatch).
  useEffect(() => {
    const prefs = loadWalkPrefs();
    setWalkPrefs(prefs);
    setPersonalizedModeEnabled(isPersonalizedActive(prefs));
  }, []);

  // Client-side sorting override for personalized walkability.
  const sortedProjects = useMemo(() => {
    if (!personalizedModeEnabled) return projects;
    if (projects.length === 0) return projects;

    if (sortBy === "walkability_score") {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...projects].sort((a, b) => {
        const pa = personalizedScores.get(a.id as number)?.score;
        const pb = personalizedScores.get(b.id as number)?.score;
        const daRaw = (a as any).walkability_score;
        const dbRaw = (b as any).walkability_score;
        const da = typeof daRaw === "number" ? daRaw : daRaw != null ? Number(daRaw) : Number.NEGATIVE_INFINITY;
        const db = typeof dbRaw === "number" ? dbRaw : dbRaw != null ? Number(dbRaw) : Number.NEGATIVE_INFINITY;
        const va = pa != null ? pa : da;
        const vb = pb != null ? pb : db;
        return (va - vb) * dir;
      });
    }

    if (sortBy === "walkability_label") {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...projects].sort((a, b) => {
        const la =
          personalizedScores.get(a.id as number)?.label ??
          ((a as any).walkability_label as string | null | undefined) ??
          "";
        const lb =
          personalizedScores.get(b.id as number)?.label ??
          ((b as any).walkability_label as string | null | undefined) ??
          "";
        return la.localeCompare(lb, "cs") * dir;
      });
    }

    return projects;
  }, [projects, sortBy, sortDir, personalizedModeEnabled, personalizedScores]);

  const supportedFilterKeys = useMemo(
    () =>
      new Set(
        filterGroups.flatMap((g) =>
          g.filters.filter((f) => f.backend_supported).map((f) => f.key)
        )
      ),
    [filterGroups]
  );


  // Fetch column definitions
  useEffect(() => {
    fetch(`${API_BASE}/columns?view=projects`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: ProjectColumnDef[]) => {
        setColumns(Array.isArray(data) ? data : []);
      })
      .catch(() => setColumns([]));
  }, []);

  // Initialize columns config from localStorage or defaults
  useEffect(() => {
    if (columnsConfig !== null) return;
    if (!columns || columns.length === 0) return;

    // Build defaults with visible columns first (in DEFAULT_VISIBLE_KEYS order), then hidden columns.
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const visibleDefaults: ProjectColumnConfig[] = DEFAULT_VISIBLE_KEYS
      .filter((k) => byKey.has(k))
      .map((k) => ({ key: k, label: byKey.get(k)!.label, visible: true }));
    const hiddenDefaults: ProjectColumnConfig[] = columns
      .filter((c) => !DEFAULT_VISIBLE_KEYS_SET.has(c.key))
      .map((c) => ({ key: c.key, label: c.label, visible: false }));
    const defaults: ProjectColumnConfig[] = [...visibleDefaults, ...hiddenDefaults];

    if (typeof window === "undefined") {
      setColumnsConfig(defaults);
      return;
    }

    try {
      const raw = window.localStorage.getItem(PROJECTS_COLUMNS_STORAGE_KEY);
      if (!raw) {
        setColumnsConfig(defaults);
        return;
      }
      const parsed = JSON.parse(raw) as ProjectColumnConfig[];
      const byKey = new Map(parsed.map((c) => [c.key, c]));
      const merged = defaults.map((d) => {
        const existing = byKey.get(d.key);
        return existing
          ? { ...d, visible: existing.visible, label: existing.label ?? d.label }
          : d;
      });
      setColumnsConfig(merged);
    } catch {
      setColumnsConfig(defaults);
    }
  }, [columnsConfig, columns]);

  // Persist columnsConfig
  useEffect(() => {
    if (columnsConfig == null || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PROJECTS_COLUMNS_STORAGE_KEY, JSON.stringify(columnsConfig));
    } catch {
      // ignore
    }
  }, [columnsConfig]);

  const safeLimit = ROWS_PER_PAGE_OPTIONS.includes(limit as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? limit
    : DEFAULT_LIMIT;

  const allowedProjectSortKeys = useMemo(() => {
    if (!columns.length) return new Set<string>();
    return new Set(columns.map((c) => getProjectColumnKey(c)));
  }, [columns]);

  const effectiveSortBy = useMemo(() => {
    if (allowedProjectSortKeys.size > 0) {
      return allowedProjectSortKeys.has(sortBy) ? sortBy : "avg_price_per_m2_czk";
    }
    // Před načtením sloupců: posíláme jen bezpečné výchozí, aby GET /projects nevrátil 422
    return "avg_price_per_m2_czk";
  }, [allowedProjectSortKeys, sortBy]);

  // Po načtení stránky s neplatným sort_by (např. z Jednotek) opravíme URL na platný sort pro projekty
  useEffect(() => {
    if (effectiveSortBy !== sortBy) {
      setSortBy(effectiveSortBy);
      syncToUrl(filters, limit, offset, effectiveSortBy, sortDir, polygon);
    }
  }, [effectiveSortBy, sortBy, filters, limit, offset, sortDir, polygon, syncToUrl]);

  // Přepsat v URL staré sort_by (_min) na kanonické ride_to_center / public_transport_to_center
  useEffect(() => {
    const inUrl = searchParams?.get("sort_by");
    if (
      (inUrl === "ride_to_center_min" || inUrl === "public_transport_to_center_min") &&
      (sortBy === "ride_to_center" || sortBy === "public_transport_to_center")
    ) {
      syncToUrl(filters, limit, offset, sortBy, sortDir, polygon);
    }
  }, [searchParams, sortBy, sortDir, filters, limit, offset, polygon, syncToUrl]);

  // Fetch projects list (paginated, server-side sort, with filters)
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    let qs = buildUnitsQuery(
      filters,
      supportedFilterKeys,
      { limit: safeLimit, offset },
      { sort_by: effectiveSortBy, sort_dir: sortDir }
    );
    // Pokud je v URL polygon (poly), pošli jeho obdélníkový obal na backend,
    // aby se geografický filtr aplikoval globálně před limitem/offsetem.
    if (polygon && polygon.trim() !== "") {
      const points = decodePolygon(polygon);
      const bounds = getPolygonBounds(points);
      if (bounds) {
        const { minLat, maxLat, minLng, maxLng } = bounds;
        qs += `&min_latitude=${minLat}&max_latitude=${maxLat}&min_longitude=${minLng}&max_longitude=${maxLng}`;
      }
    }
    fetch(`${API_BASE}/projects?${qs}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: ProjectsOverviewResponse | ProjectItem[]) => {
        const rows: ProjectItem[] = Array.isArray(json)
          ? (json as ProjectItem[])
          : (((json as any)?.items ?? (json as any)?.itimes) as ProjectItem[] | undefined) ?? [];
        const totalValue =
          json && typeof (json as any)?.total === "number" ? (json as any).total : rows.length;
        setProjects(rows);
        setTotal(totalValue);
      })
      .catch((e) => { if (e?.name !== "AbortError") setError(e instanceof Error ? e.message : "Chyba"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters, safeLimit, offset, effectiveSortBy, sortDir, supportedFilterKeys, polygon, refetchTrigger]);

  const visibleColumns = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    if (!columnsConfig) {
      return columns.length > 0 ? columns.slice(0, DEFAULT_VISIBLE_COLUMNS) : [];
    }
    const visible = columnsConfig
      .filter((c) => c.visible)
      .map((c) => byKey.get(c.key))
      .filter((c): c is ProjectColumnDef => !!c);
    if (visible.length === 0 && columns.length > 0) return columns.slice(0, DEFAULT_VISIBLE_COLUMNS);
    return visible;
  }, [columns, columnsConfig]);

  const saveOverride = useCallback(
    async (projectId: number, fieldKey: string, value: string | boolean) => {
      setSavingOverride(true);
      try {
        const body = {
          value: typeof value === "boolean" ? String(value) : String(value),
        };
        const res = await fetch(
          `${API_BASE}/projects/${projectId}/overrides/${encodeURIComponent(fieldKey)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error("Failed to save project override", await res.text());
          return;
        }
        const updated = (await res.json()) as Record<string, unknown>;
        setProjects((prev) =>
          prev.map((row) =>
            row.id === projectId ? { ...row, ...updated } : row
          )
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to save project override", e);
      } finally {
        setSavingOverride(false);
        setEditingCell(null);
      }
    },
    []
  );

  const onApply = useCallback(() => {
    setFilters(currentFilters);
    syncToUrl(currentFilters, limit, 0, sortBy, sortDir, polygon);
    setOffset(0);
    closeDrawer();
  }, [currentFilters, limit, sortBy, sortDir, polygon, syncToUrl, closeDrawer]);

  const applyFilters = useCallback(
    (next: CurrentFilters) => {
      setFilters(next);
      setOffset(0);
      syncToUrl(next, limit, 0, sortBy, sortDir, polygon);
    },
    [limit, sortBy, sortDir, polygon, syncToUrl]
  );

  const isClientOverridden =
    activeClient != null && !filtersEqual(filters, activeClient.derivedFilters);

  const resetToClient = useCallback(() => {
    if (!activeClient) return;
    setFilters(activeClient.derivedFilters);
    setOffset(0);
    syncToUrl(activeClient.derivedFilters, limit, 0, sortBy, sortDir, polygon);
  }, [activeClient, limit, sortBy, sortDir, polygon, syncToUrl]);

  const handleSaveToClient = useCallback(async () => {
    if (!activeClient) return;
    setSavingToClient(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
      const patch = filtersToProfilePatch(filters);
      await fetch(`${API_BASE}/clients/${activeClient.clientId}/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(patch),
      }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); });
      activate({ ...activeClient, derivedFilters: { ...filters } });
      fetch(`${API_BASE}/clients/${activeClient.clientId}/recommendations/recompute`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uložení se nezdařilo");
    } finally {
      setSavingToClient(false);
    }
  }, [activeClient, filters, activate]);

  const onResetAll = useCallback(() => {
    setFilters({});
    onReset();
    syncToUrl({}, limit, 0, sortBy, sortDir, polygon);
    setOffset(0);
    closeDrawer();
  }, [limit, sortBy, sortDir, polygon, syncToUrl, closeDrawer, onReset]);

  const setPage = useCallback(
    (newOffset: number) => {
      setOffset(newOffset);
      syncToUrl(filters, limit, newOffset, sortBy, sortDir, polygon);
    },
    [filters, limit, sortBy, sortDir, polygon, syncToUrl]
  );

  const setLimitAndSort = useCallback(
    (opts: { limit?: number; sortBy?: string; sortDir?: "asc" | "desc" }) => {
      const newLimit = opts.limit ?? limit;
      const newSortBy = opts.sortBy ?? sortBy;
      const newSortDir = opts.sortDir ?? sortDir;
      if (opts.limit !== undefined) setLimit(newLimit);
      if (opts.sortBy !== undefined) setSortBy(newSortBy);
      if (opts.sortDir !== undefined) setSortDir(newSortDir);
      setOffset(0);
      syncToUrl(filters, newLimit, 0, newSortBy, newSortDir, polygon);
    },
    [filters, limit, sortBy, sortDir, polygon, syncToUrl]
  );

  const handleSortHeaderClick = useCallback(
    (key: string) => {
      if (key !== sortBy) {
        setLimitAndSort({ sortBy: key, sortDir: "asc" });
      } else {
        setLimitAndSort({ sortDir: sortDir === "asc" ? "desc" : "asc" });
      }
    },
    [sortBy, sortDir, setLimitAndSort]
  );

  const summary = computeProjectsSummary(projects, total);
  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = total === 0 ? 0 : Math.min(offset + safeLimit, total);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [recs, setRecs] = useState<ProjectRecItem[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [recomputingRecs, setRecomputingRecs] = useState(false);

  const projectRecGroups = useMemo((): ProjectRecGroup[] => {
    const map = new Map<number, ProjectRecItem[]>();
    for (const r of recs) {
      if (r.project_id == null) continue;
      const existing = map.get(r.project_id);
      if (existing) existing.push(r);
      else map.set(r.project_id, [r]);
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const groups: ProjectRecGroup[] = [];
    for (const [pid, items] of map.entries()) {
      const prices = items.map((r) => r.price_czk).filter((v): v is number => v != null);
      groups.push({
        project_id: pid,
        project_name: items[0].project_name ?? String(pid),
        unit_count: items.length,
        pinned_count: items.filter((r) => r.pinned_by_broker).length,
        best_score: Math.max(...items.map((r) => r.score)),
        avg_score: avg(items.map((r) => r.score)),
        price_min: prices.length > 0 ? Math.min(...prices) : null,
        avg_budget_fit: avg(items.map((r) => r.budget_fit)),
        avg_walkability_fit: avg(items.map((r) => r.walkability_fit)),
        avg_location_fit: avg(items.map((r) => r.location_fit)),
        avg_layout_fit: avg(items.map((r) => r.layout_fit)),
        avg_area_fit: avg(items.map((r) => r.area_fit)),
        avg_outdoor_fit: avg(items.map((r) => r.outdoor_fit)),
      });
    }
    groups.sort((a, b) => b.best_score - a.best_score);
    return groups;
  }, [recs]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, projectId: number) => {
      // Do not navigate while a cell is in edit mode
      if (editingCell) return;

      // Ignore clicks from interactive elements (links, buttons, inputs, etc.)
      const target = e.target as HTMLElement | null;
      if (target) {
        const interactive = target.closest(
          "a, button, input, select, textarea, label, [role='button'], [data-no-row-nav]"
        );
        if (interactive) return;
      }

      // Ignore modified or non-left clicks
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      // Double-click: cancel any pending navigation so inline editing can proceed
      if (e.detail > 1) {
        if (rowClickTimeoutRef.current !== null) {
          window.clearTimeout(rowClickTimeoutRef.current);
          rowClickTimeoutRef.current = null;
        }
        return;
      }

      // Schedule navigation; if this turns into a double-click, the second click will cancel it
      if (rowClickTimeoutRef.current !== null) {
        window.clearTimeout(rowClickTimeoutRef.current);
      }
      rowClickTimeoutRef.current = window.setTimeout(() => {
        rowClickTimeoutRef.current = null;
        router.push(`/projects/${projectId}`);
      }, 180);
    },
    [router, editingCell]
  );

  useEffect(
    () => () => {
      if (rowClickTimeoutRef.current !== null) {
        window.clearTimeout(rowClickTimeoutRef.current);
      }
    },
    []
  );


  const [recomputingLocationMetrics, setRecomputingLocationMetrics] = useState(false);
  const [recomputingWalkability, setRecomputingWalkability] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<"recommendations" | "manual">(
    activeClient ? "recommendations" : "manual"
  );

  // Refresh personalized scores when mode, prefs or visible projects change
  useEffect(() => {
    if (!personalizedModeEnabled || projects.length === 0) {
      setPersonalizedScores(new Map());
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/walkability/personalized-scores`, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_ids: projects.map((p) => p.id as number),
            preferences: walkPrefs,
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const map = new Map<number, { score: number | null; label: string | null }>();
        for (const it of json.items ?? []) {
          map.set(it.project_id as number, {
            score: it.score ?? null,
            label: it.label ?? null,
          });
        }
        setPersonalizedScores(map);
      } catch {
        // silent fallback to stored scores
      }
    })();
    return () => controller.abort();
  }, [personalizedModeEnabled, walkPrefs, projects]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (viewMode !== "recommendations" || !activeClient) return;
    let cancelled = false;
    setRecsLoading(true);
    setRecsError(null);
    const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    fetch(`${API_BASE}/clients/${activeClient.clientId}/recommendations`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) setRecs(Array.isArray(data) ? data : []); })
      .catch((e) => { if (!cancelled) setRecsError(e instanceof Error ? e.message : "Nepodařilo se načíst doporučení"); })
      .finally(() => { if (!cancelled) setRecsLoading(false); });
    return () => { cancelled = true; };
  }, [viewMode, activeClient?.clientId]);

  const handleRecomputeRecs = useCallback(async () => {
    if (!activeClient || recomputingRecs) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    setRecomputingRecs(true);
    setRecsError(null);
    try {
      const res = await fetch(`${API_BASE}/clients/${activeClient.clientId}/recommendations/recompute`, { method: "POST", headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRecsLoading(true);
      const r2 = await fetch(`${API_BASE}/clients/${activeClient.clientId}/recommendations`, { headers });
      if (r2.ok) setRecs(await r2.json().then((d) => (Array.isArray(d) ? d : [])));
    } catch (e) {
      setRecsError(e instanceof Error ? e.message : "Přepočet selhal");
    } finally {
      setRecomputingRecs(false);
      setRecsLoading(false);
    }
  }, [activeClient, recomputingRecs]);

  return (
    <div>
      <div className="flex flex-col gap-5 pt-4 pb-10">
        {total > 0 && <div className="flex justify-end px-1"><span className="text-sm text-slate-400">{total} záznamů</span></div>}
        {viewMode === "recommendations" && activeClient ? (
          <div className="grid w-full gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 glass-card px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Projekty s doporučením</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{projectRecGroups.length}</p>
            </div>
            <div className="min-w-0 glass-card bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-white/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Doporučených jednotek</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{recs.length}</p>
            </div>
            <div className="min-w-0 glass-card bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-white/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Ve výběru</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{recs.filter((r) => r.pinned_by_broker).length}</p>
            </div>
            <div className="min-w-0 glass-card bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-white/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Nejlepší skóre</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {projectRecGroups.length > 0 ? Math.round(projectRecGroups[0].best_score) : "—"}
              </p>
            </div>
          </div>
        ) : (
          <SummaryBar
            total={summary.total}
            averagePricePerM2={summary.averagePricePerM2}
            averagePrice={summary.averagePrice}
            availableCount={summary.availableCount}
            averageLocalDiff={null}
            totalLabel="Celkem projektů"
          />
        )}
        <div className="glass-header relative z-20 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
          {activeClient && (
            <div className="flex items-center rounded-lg border border-slate-200 bg-white/70 p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode("recommendations")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${viewMode === "recommendations" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
              >
                Doporučení
              </button>
              <button
                type="button"
                onClick={() => setViewMode("manual")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${viewMode === "manual" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
              >
                Ruční hledání
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={openDrawer}
            className="glass-pill border border-transparent px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white/90 shrink-0"
            title={
              countActiveFilters(filters) > 0
                ? `Aktivní filtry: ${countActiveFilters(filters)}`
                : undefined
            }
          >
            Filtry
            {countActiveFilters(filters) > 0 && (
              <span className={`ml-1 rounded px-1.5 text-xs font-semibold ${isClientOverridden ? "bg-amber-200 text-amber-800" : "bg-gray-200"}`}>
                {countActiveFilters(filters)}
              </span>
            )}
            {isClientOverridden && countActiveFilters(filters) === 0 && (
              <span className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-500" />
            )}
          </button>
          {isClientOverridden && (
            <button
              type="button"
              onClick={resetToClient}
              className="glass-pill border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 shrink-0"
              title="Obnovit filtry z profilu klienta"
            >
              Zpět na klienta
            </button>
          )}
          {isClientOverridden && (
            <button
              type="button"
              onClick={handleSaveToClient}
              disabled={savingToClient}
              className="glass-pill border border-amber-400 bg-amber-400 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 shrink-0 disabled:opacity-60"
              title="Uložit aktuální filtry jako nový profil klienta"
            >
              {savingToClient ? "Ukládám…" : "Uložit změny do klienta"}
            </button>
          )}
          {viewMode === "manual" && (
          <button
            type="button"
            onClick={() => setWalkPrefsOpen(true)}
            className="glass-pill border border-transparent px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white/90 shrink-0"
          >
            Preference lokality
          </button>
          )}
          {viewMode === "manual" && personalizedModeEnabled && (
            <div className="ml-2 flex flex-wrap items-center gap-1">
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
          <div className="relative ml-auto shrink-0" ref={actionsRef}>
            <button
              type="button"
              onClick={() => setActionsOpen((o) => !o)}
              className="glass-pill border border-transparent px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white/90"
            >
              Akce
            </button>
            {actionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[220px] rounded-xl border border-slate-200 bg-white/95 py-1.5 shadow-lg backdrop-blur">
                <button
                  type="button"
                  onClick={() => { setColumnsOpen(true); setActionsOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
                >
                  Sloupce
                </button>
                <button
                  type="button"
                  onClick={() => { onResetAll(); setActionsOpen(false); }}
                  disabled={loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const qs = searchParams?.toString() ?? "";
                    const url = typeof window !== "undefined" ? `${window.location.origin}${pathname}${qs ? `?${qs}` : ""}` : "";
                    if (url && navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(url).then(() => {
                        setLinkCopied(true);
                        window.setTimeout(() => setLinkCopied(false), 2000);
                      });
                    }
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
                >
                  {linkCopied ? "Zkopírováno!" : "Kopírovat odkaz"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setRecomputingLocationMetrics(true);
                    try {
                      const res = await fetch(`${API_BASE}/admin/location-metrics/recompute-all`, { method: "POST" });
                      if (!res.ok) throw new Error(await res.text());
                    } catch {
                      // optional: setError or toast
                    } finally {
                      setRecomputingLocationMetrics(false);
                      setActionsOpen(false);
                    }
                  }}
                  disabled={recomputingLocationMetrics || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {recomputingLocationMetrics ? "Přepočítávám…" : "Přepočítat mikro-lokalitu a hluk"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setRecomputingWalkability(true);
                    try {
                      const res = await fetch(`${API_BASE}/admin/walkability-sources/refresh-and-recompute`, { method: "POST" });
                      if (!res.ok) throw new Error(await res.text());
                      const data = await res.json();
                      setActionsOpen(false);
                      alert(`Walkability data obnovena.\nProjekty přepočítány: ${(data.recompute as { processed?: number; total?: number })?.processed ?? 0}/${(data.recompute as { processed?: number; total?: number })?.total ?? 0}`);
                      setRefetchTrigger((t) => t + 1);
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Nepodařilo se obnovit walkability data");
                    } finally {
                      setRecomputingWalkability(false);
                    }
                  }}
                  disabled={recomputingWalkability || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {recomputingWalkability ? "Stahování walkability…" : "Stáhnout walkability POI + přepočítat projekty"}
                </button>
              </div>
            )}
          </div>
        </div>
        <ClientModeBar isOverridden={isClientOverridden} />
        <FilterChips
          filters={filters}
          filterGroups={filterGroups}
          onRemove={applyFilters}
        />
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}

        {activeClient && viewMode === "recommendations" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <button
                type="button"
                onClick={handleRecomputeRecs}
                disabled={recomputingRecs || recsLoading}
                className="glass-pill border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white/90 shrink-0 disabled:opacity-50"
                title="Přepočítat doporučení pro tohoto klienta"
              >
                {recomputingRecs ? "Přepočítávám…" : "↺ Přepočítat doporučení"}
              </button>
            </div>
            {recsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{recsError}</div>
            )}
            {recsLoading && (
              <div className="px-2 py-6 text-center text-sm text-slate-500">Načítám doporučení…</div>
            )}
            {!recsLoading && projectRecGroups.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                Žádná doporučení. Přepočítejte doporučení nebo upravte profil klienta.
              </div>
            )}
            {!recsLoading && projectRecGroups.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Projekt</th>
                      <th className="px-3 py-2 text-right font-semibold" title="Počet doporučených jednotek">Jedn.</th>
                      <th className="px-3 py-2 text-right font-semibold" title="Jednotky ve výběru">★</th>
                      <th className="px-3 py-2 text-right font-semibold">Nejlepší skóre</th>
                      <th className="px-3 py-2 text-right font-semibold">Průměrné skóre</th>
                      <th className="px-3 py-2 text-right font-semibold">Cena od</th>
                      <th className="px-3 py-2 text-center font-semibold" title="Průměrná shoda: Rozpočet · Poloha · Walkabilita · Dispozice · Plocha · Venkovní plocha">Shoda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {projectRecGroups.map((g) => {
                      const sl = scoreLabel(Math.round(g.best_score));
                      return (
                        <tr
                          key={g.project_id}
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => router.push(`/projects/${g.project_id}`)}
                        >
                          <td className="px-3 py-2 font-medium text-slate-900">
                            <Link
                              href={`/projects/${g.project_id}`}
                              className="hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {g.project_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">{g.unit_count}</td>
                          <td className="px-3 py-2 text-right">
                            {g.pinned_count > 0 ? (
                              <span className="font-semibold text-amber-500">{g.pinned_count} ★</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-semibold text-slate-900">{Math.round(g.best_score)}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${sl.cls}`}>{sl.label}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">{Math.round(g.avg_score)}</td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {g.price_min != null ? formatCurrencyCzk(g.price_min) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <FitDot value={g.avg_budget_fit} title="Rozpočet" />
                              <FitDot value={g.avg_location_fit} title="Poloha" />
                              <FitDot value={g.avg_walkability_fit} title="Walkabilita" />
                              <FitDot value={g.avg_layout_fit} title="Dispozice" />
                              <FitDot value={g.avg_area_fit} title="Plocha" />
                              <FitDot value={g.avg_outdoor_fit} title="Venkovní plocha" />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="data-grid-wrapper" style={{ display: viewMode === "manual" ? undefined : "none" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs sm:text-sm">
                  <span className="font-medium text-gray-700">Řádků</span>
                  <select
                    value={safeLimit}
                    onChange={(e) => setLimitAndSort({ limit: Number(e.target.value) })}
                    disabled={loading}
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs sm:text-sm text-gray-900 disabled:opacity-50 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
                  >
                    {ROWS_PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-gray-600">
                  {showFrom}–{showTo} z {total}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-800">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, offset - safeLimit))}
                  disabled={offset <= 0 || loading}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Předchozí
                </button>
                <span className="text-xs sm:text-sm text-slate-700">
                  Strana {total === 0 ? 0 : Math.floor(offset / safeLimit) + 1} z{" "}
                  {total === 0 ? 0 : Math.ceil(total / safeLimit) || 1}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(offset + safeLimit)}
                  disabled={offset + safeLimit >= total || loading}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Další
                </button>
                <button
                  type="button"
                  onClick={() => downloadProjectsCsv(projects, visibleColumns)}
                  disabled={projects.length === 0 || loading}
                  title="Export aktuální stránky do CSV (UTF-8)"
                  className="ml-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Export CSV
                </button>
              </div>
            </div>
            <div className="data-grid-scroll">
              <table className="data-grid-table">
                <thead className="bg-slate-50/90">
                  <tr>
                    {visibleColumns.map((col, columnIndex) => {
                    const flatKey = getProjectColumnKey(col);
                    const isActive = flatKey === sortBy;
                    const isWalkabilityScore = flatKey === "walkability_score";
                    const isWalkabilityLabel = flatKey === "walkability_label";
                    const isStickyFirst = columnIndex === 0;
                    const alignRight =
                      col.data_type === "number" ||
                      (col.unit != null &&
                        (col.unit.includes("Kč") || col.unit.includes("m²") || col.unit === "min")) ||
                      col.key.endsWith("_min");
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSortHeaderClick(flatKey)}
                        className={`sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 cursor-pointer select-none transition-colors hover:bg-gray-100 ${
                          alignRight ? "text-right" : "text-left"
                        } ${isActive ? "bg-gray-100" : ""} ${isStickyFirst ? "left-0 z-20" : ""}`}
                      >
                        <span
                          className="inline-flex items-center gap-1"
                          title={
                            personalizedModeEnabled && (isWalkabilityScore || isWalkabilityLabel) && isActive
                              ? "Řazeno podle personalizovaného skóre (aktuální stránka)"
                              : undefined
                          }
                        >
                          {col.label}
                          {isActive && (
                            <span className="text-gray-600" aria-hidden>{sortDir === "asc" ? "▲" : "▼"}</span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && projects.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {visibleColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2">
                          <div className="h-4 rounded bg-slate-200" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : projects.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length || 1}
                      className="px-3 py-8 text-center text-sm text-slate-600"
                    >
                      Žádné projekty nevyhovují zadaným filtrům. Zkuste upravit filtry.
                    </td>
                  </tr>
                ) : (
                  sortedProjects.map((p) => (
                    <tr
                      key={p.id as number}
                      className="cursor-pointer transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-slate-50"
                      onClick={(e) => handleRowClick(e, p.id as number)}
                    >
                      {visibleColumns.map((col, columnIndex) => {
                        const raw = getProjectCellValue(p, col);
                        const alignRight =
                          col.data_type === "number" ||
                          (col.unit != null &&
                            (col.unit.includes("Kč") || col.unit.includes("m²") || col.unit === "min")) ||
                          col.key.endsWith("_min");
                        const fieldKey = getProjectColumnKey(col);
                        const isEditable = col.editable && col.kind !== "computed";
                        const isEditing =
                          editingCell != null &&
                          editingCell.projectId === (p.id as number) &&
                          editingCell.field === fieldKey;

                        // Special handling for financování/parkování: zobrazuj jen jednu hodnotu
                        // (payment_*), která se může přepočítat z min/max na backendu.
                        const renderValue = () => {
                          if (fieldKey === "payment_contract" || fieldKey === "payment_construction" || fieldKey === "payment_occupancy") {
                            const val = p[fieldKey] as number | null | undefined;
                            return formatPercent(val != null ? Number(val) : null, undefined, true);
                          }
                          if (fieldKey === "min_parking_indoor_price_czk" || fieldKey === "max_parking_indoor_price_czk") {
                            const val =
                              (p["min_parking_indoor_price_czk"] as number | null | undefined) ??
                              (p["max_parking_indoor_price_czk"] as number | null | undefined) ??
                              null;
                            return formatCurrencyCzk(val);
                          }
                          if (fieldKey === "min_parking_outdoor_price_czk" || fieldKey === "max_parking_outdoor_price_czk") {
                            const val =
                              (p["min_parking_outdoor_price_czk"] as number | null | undefined) ??
                              (p["max_parking_outdoor_price_czk"] as number | null | undefined) ??
                              null;
                            return formatCurrencyCzk(val);
                          }
                          if (fieldKey === "walkability_score" && personalizedModeEnabled) {
                            const override = personalizedScores.get(p.id as number);
                            if (override && override.score != null) {
                              return renderWalkabilityWithDelta(
                                override.score,
                                (p as any).walkability_score
                              );
                            }
                          }
                          if (fieldKey === "walkability_label" && personalizedModeEnabled) {
                            const override = personalizedScores.get(p.id as number);
                            if (override && override.label) {
                              return `${override.label} (dle preferencí)`;
                            }
                          }
                          return formatProjectValue(raw, col);
                        };

                        const isStickyFirst = columnIndex === 0;
                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-1.5 text-xs sm:text-sm text-slate-900 ${
                              alignRight ? "text-right" : "text-left"
                            } ${isEditable ? "cursor-pointer" : ""} ${isStickyFirst ? "sticky left-0 z-10 bg-white" : ""}`}
                            onDoubleClick={() => {
                              if (!isEditable || loading || savingOverride) return;
                              const projectId = p.id as number;
                              if (col.data_type === "bool") {
                                const current =
                                  typeof raw === "boolean"
                                    ? raw
                                    : String(raw ?? "").toLowerCase() === "true";
                                setEditingCell({ projectId, field: fieldKey });
                                setEditValue(current);
                              } else {
                                setEditingCell({ projectId, field: fieldKey });
                                setEditValue(raw == null ? "" : String(raw));
                              }
                            }}
                          >
                            {isEditing && col.data_type === "bool" ? (
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={
                                  typeof editValue === "boolean"
                                    ? editValue
                                    : String(editValue).toLowerCase() === "true"
                                }
                                onChange={(e) => setEditValue(e.target.checked)}
                                onBlur={() =>
                                  saveOverride(p.id as number, fieldKey, editValue)
                                }
                              />
                            ) : isEditing ? (
                              <input
                                type={col.data_type === "number" ? "number" : "text"}
                                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
                                autoFocus
                                value={
                                  typeof editValue === "boolean"
                                    ? editValue
                                      ? "true"
                                      : "false"
                                    : (editValue as string)
                                }
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() =>
                                  saveOverride(p.id as number, fieldKey, editValue)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void saveOverride(
                                      p.id as number,
                                      fieldKey,
                                      editValue
                                    );
                                  } else if (e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                              />
                            ) : (
                              renderValue()
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <FiltersDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        filterGroups={filterGroups}
        currentFilters={currentFilters}
        onChange={onChangeFilter}
        onReset={onReset}
        onApply={onApply}
      />
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
          // scores will refresh via useEffect
        }}
      />
      {columnsConfig && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            setColumnsConfig((prev) => {
              if (!prev) return prev;
              const oldIndex = prev.findIndex((c) => c.key === active.id);
              const newIndex = prev.findIndex((c) => c.key === over.id);
              if (oldIndex === -1 || newIndex === -1) return prev;
              return arrayMove(prev, oldIndex, newIndex);
            });
          }}
        >
          {columnsOpen && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/40"
                aria-hidden
                onClick={() => setColumnsOpen(false)}
              />
              <div className="fixed top-0 right-0 z-50 flex h-full w-80 flex-col rounded-l-xl border-l border-slate-200 bg-white shadow-xl">
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
                  <h2 className="text-sm font-semibold text-slate-900">Sloupce</h2>
                  <button
                    type="button"
                    onClick={() => setColumnsOpen(false)}
                    className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Zavřít"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <p className="mb-2 text-xs text-slate-500">
                    Přetáhněte řádky pro změnu pořadí, zrušte zaškrtnutí pro skrytí sloupce.
                  </p>
                  <SortableContext
                    items={columnsConfig.map((c) => c.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-1.5">
                      {columnsConfig.map((cfg) => (
                        <ProjectColumnRow
                          key={cfg.key}
                          column={cfg}
                          onToggleVisible={(visible) =>
                            setColumnsConfig((prev) =>
                              prev
                                ? prev.map((c) =>
                                    c.key === cfg.key ? { ...c, visible } : c
                                  )
                                : prev
                            )
                          }
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </div>
              </div>
            </>
          )}
        </DndContext>
      )}
    </div>
  );
}

function ProjectColumnRow({
  column,
  onToggleVisible,
}: {
  column: ProjectColumnConfig;
  onToggleVisible: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5 text-sm ${
        isDragging ? "shadow-lg ring-1 ring-slate-300" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-400 hover:text-slate-600"
          aria-label="Přesunout"
        >
          ⠿
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={column.visible}
            onChange={(e) => onToggleVisible(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-500/30"
          />
          <span className="text-slate-900">{column.label}</span>
        </label>
      </div>
    </li>
  );
}



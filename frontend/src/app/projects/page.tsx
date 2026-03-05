"use client";

import type React from "react";

import { FiltersDrawer } from "@/components/FiltersDrawer";
import { SummaryBar } from "@/components/SummaryBar";
import {
  buildUnitsQuery,
  countActiveFilters,
  type CurrentFilters,
  type FilterGroup,
  type FiltersResponse,
  filtersToSearchParams,
  flattenFilterSpecsByKey,
  parseFiltersFromSearchParams,
} from "@/lib/filters";
import { formatAreaM2, formatCurrencyCzk, formatLayout, formatMinutes, formatPercent } from "@/lib/format";
import { API_BASE } from "@/lib/api";
import { decodePolygon, getPolygonBounds } from "@/lib/geo";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function formatProjectValue(value: unknown, column: ProjectColumnDef): string {
  if (value == null || value === "") return "—";

  const num = Number(value);
  const isNumber = !Number.isNaN(num);

  // Rekonstrukce – vlastní texty
  if (column.key === "renovation") {
    const raw = String(value ?? "").toLowerCase();
    const isTrue =
      value === true ||
      ["true", "1", "yes", "ano"].includes(raw);
    return isTrue ? "rekonstrukce" : "novostavba";
  }

  // Žaluzie – ponecháme původní hodnoty z dat (preparation/true/false)
  if (column.key === "exterior_blinds") {
    const numVal = Number(value);
    if (!Number.isNaN(numVal)) {
      return numVal === 1 ? "true" : "false";
    }
    return String(value);
  }

  // Obecné booleany: ANO/NE (klimatizace, chlazení stropem, žaluzie, smart home, ...)
  if (column.data_type === "bool" || typeof value === "boolean") {
    const raw = String(value ?? "").toLowerCase();
    const isTrue =
      value === true ||
      ["true", "1", "yes", "ano"].includes(raw);
    return isTrue ? "ANO" : "NE";
  }

  // Layouts list
  if (column.key === "layouts_present") {
    if (Array.isArray(value)) {
      const parts = value.map((v) => formatLayout(typeof v === "string" ? v : String(v)));
      return parts.length ? parts.join(", ") : "—";
    }
    return String(value);
  }

  // Currency
  if (column.unit === "Kč") {
    return formatCurrencyCzk(isNumber ? num : null);
  }

  // Area
  if (column.unit && column.unit.includes("m²")) {
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

  // Percent-style fields (stored as fraction 0–1)
  if (
    column.unit === "%" ||
    column.key === "available_ratio" ||
    column.key.startsWith("payment_")
  ) {
    return formatPercent(isNumber ? num * 100 : null);
  }

  // Dates
  if (column.data_type === "date") {
    try {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString("cs-CZ");
    } catch {
      return String(value);
    }
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
  const availableCount = items.reduce((a, p) => a + (Number(p.available_units) || 0), 0);
  return {
    total: totalCount,
    averagePricePerM2: withPpm2.length ? sumPpm2 / withPpm2.length : null,
    averagePrice: withPrice.length ? sumPrice / withPrice.length : null,
    availableCount,
  };
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
  const sortBy = params.get("sort_by") ?? "avg_price_per_m2_czk";
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

export default function ProjectsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initial = useMemo(
    () => parseProjectsSearchParams(new URLSearchParams(searchParams?.toString() ?? "")),
    []
  );

  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [filters, setFilters] = useState<CurrentFilters>(initial.filters);
  const [currentFilters, setCurrentFilters] = useState<CurrentFilters>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const [editingCell, setEditingCell] = useState<{ projectId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string | boolean>("");
  const [savingOverride, setSavingOverride] = useState(false);

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

  const supportedFilterKeys = useMemo(
    () =>
      new Set(
        filterGroups.flatMap((g) =>
          g.filters.filter((f) => f.backend_supported).map((f) => f.key)
        )
      ),
    [filterGroups]
  );

  // Fetch filter metadata
  useEffect(() => {
    fetch(`${API_BASE}/projects/filters`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: FiltersResponse) => setFilterGroups(data?.groups ?? []))
      .catch(() => setFilterGroups([]));
  }, []);

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

    const defaults: ProjectColumnConfig[] = columns.map((col, idx) => ({
      key: col.key,
      label: col.label,
      // first N columns visible by default
      visible: idx < DEFAULT_VISIBLE_COLUMNS,
    }));

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
    if (allowedProjectSortKeys.size > 0 && !allowedProjectSortKeys.has(sortBy)) {
      return "avg_price_per_m2_czk";
    }
    // Před načtením sloupců: známá pole jen pro jednotky (projekty je nemají)
    const unitOnlySortKeys = new Set(["local_price_diff_1000m", "local_price_diff_2000m"]);
    if (unitOnlySortKeys.has(sortBy)) return "avg_price_per_m2_czk";
    return sortBy;
  }, [allowedProjectSortKeys, sortBy]);

  // Po načtení stránky s neplatným sort_by (např. z Jednotek) opravíme URL na platný sort pro projekty
  useEffect(() => {
    if (effectiveSortBy !== sortBy) {
      setSortBy(effectiveSortBy);
      syncToUrl(filters, limit, offset, effectiveSortBy, sortDir, polygon);
    }
  }, [effectiveSortBy, sortBy, filters, limit, offset, sortDir, polygon, syncToUrl]);

  // Fetch projects list (paginated, server-side sort, with filters)
  useEffect(() => {
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
    fetch(`${API_BASE}/projects?${qs}`)
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
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [filters, safeLimit, offset, effectiveSortBy, sortDir, supportedFilterKeys, polygon]);

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

  const openDrawer = useCallback(() => {
    setCurrentFilters({ ...filters });
    setDrawerOpen(true);
  }, [filters]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const onApply = useCallback(() => {
    setFilters(currentFilters);
    syncToUrl(currentFilters, limit, 0, sortBy, sortDir, polygon);
    setOffset(0);
    closeDrawer();
  }, [currentFilters, limit, sortBy, sortDir, polygon, syncToUrl, closeDrawer]);

  const applyFilters = useCallback(
    (next: CurrentFilters) => {
      setFilters(next);
      setCurrentFilters(next);
      setOffset(0);
      syncToUrl(next, limit, 0, sortBy, sortDir, polygon);
    },
    [limit, sortBy, sortDir, polygon, syncToUrl]
  );

  const onReset = useCallback(() => setCurrentFilters({}), []);

  const onResetAll = useCallback(() => {
    setFilters({});
    setCurrentFilters({});
    syncToUrl({}, limit, 0, sortBy, sortDir, polygon);
    setOffset(0);
    closeDrawer();
  }, [limit, sortBy, sortDir, polygon, syncToUrl, closeDrawer]);

  const onChangeFilter = useCallback(
    (key: string, value: number | number[] | string[] | boolean | undefined) => {
      setCurrentFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

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

  const aliasByKey = useMemo(() => flattenFilterSpecsByKey(filterGroups), [filterGroups]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Reamar</h1>
          <div className="flex items-center rounded-full border border-slate-200 bg-slate-100/70 p-0.5">
            <Link
              href={(() => {
                const qs = searchParams?.toString() ?? "";
                return qs ? `/units?${qs}` : "/units";
              })()}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Jednotky
            </Link>
            <Link
              href={(() => {
                const qs = searchParams?.toString() ?? "";
                return qs ? `/projects?${qs}` : "/projects";
              })()}
              className="rounded-full bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm"
            >
              Projekty
            </Link>
            <Link
              href={(() => {
                const qs = searchParams?.toString() ?? "";
                return qs ? `/projects/map?${qs}` : "/projects/map";
              })()}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
            >
              Mapa
            </Link>
          </div>
          <button
            type="button"
            onClick={openDrawer}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            title={
              countActiveFilters(filters) > 0
                ? `Aktivní filtry: ${countActiveFilters(filters)}`
                : undefined
            }
          >
            Filtry
            {countActiveFilters(filters) > 0 && (
              <span className="ml-1 rounded bg-gray-200 px-1.5 text-xs">{countActiveFilters(filters)}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setColumnsOpen(true)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Sloupce
          </button>
          <button
            type="button"
            onClick={onResetAll}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-col items-end gap-1">
          {countActiveFilters(filters) > 0 && (
            <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
              {(() => {
                type FilterBadge = { id: string; label: string; clearKeys: string[] };
                const badges: FilterBadge[] = [];
                const rangeBases = new Set<string>();
                for (const [k, v] of Object.entries(filters)) {
                  if (v === undefined) continue;
                  if (k.endsWith("_min") || k.endsWith("_max")) {
                    rangeBases.add(k.replace(/_(min|max)$/, ""));
                    continue;
                  }
                  const spec = aliasByKey.get(k);
                  const label = spec?.alias || k;
                  if (Array.isArray(v) && v.length > 0) {
                    const formattedValues = v.map((raw) => {
                      if (k === "layout") {
                        const m = /^layout_(\d+)(?:_(\d+))?$/.exec(String(raw));
                        if (m) {
                          const whole = m[1];
                          const frac = m[2];
                          return frac ? `${whole},${frac}kk` : `${whole}kk`;
                        }
                      }
                      return String(raw);
                    });
                    badges.push({
                      id: `${k}:${formattedValues.join(",")}`,
                      label: `${label}: ${formattedValues.join(", ")}`,
                      clearKeys: [k],
                    });
                  } else if (typeof v === "boolean") {
                    badges.push({
                      id: `${k}:${v ? "1" : "0"}`,
                      label: `${label}: ${v ? "Ano" : "Ne"}`,
                      clearKeys: [k],
                    });
                  } else if (typeof v === "number" && !Number.isNaN(v)) {
                    badges.push({
                      id: `${k}:${v}`,
                      label: `${label}: ${v}`,
                      clearKeys: [k],
                    });
                  }
                }
                for (const base of rangeBases) {
                  const min = filters[`${base}_min`] as number | undefined;
                  const max = filters[`${base}_max`] as number | undefined;
                  if (
                    (min === undefined || Number.isNaN(min as number)) &&
                    (max === undefined || Number.isNaN(max as number))
                  ) {
                    continue;
                  }
                  const spec = aliasByKey.get(base);
                  const label = spec?.alias || base;
                  let value = "";
                  if (min != null && !Number.isNaN(min)) {
                    value += `od ${min}`;
                  }
                  if (max != null && !Number.isNaN(max)) {
                    value += value ? ` do ${max}` : `do ${max}`;
                  }
                  badges.push({
                    id: `${base}:${value}`,
                    label: `${label}: ${value}`,
                    clearKeys: [`${base}_min`, `${base}_max`],
                  });
                }
                return badges.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      const next: CurrentFilters = { ...filters };
                      for (const ck of b.clearKeys) {
                        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                        delete (next as Record<string, unknown>)[ck];
                      }
                      applyFilters(next);
                    }}
                    className="group inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 hover:border-gray-400 hover:bg-gray-100"
                  >
                    <span>{b.label}</span>
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-300 text-[9px] text-gray-800 group-hover:bg-gray-500 group-hover:text-white">
                      ×
                    </span>
                  </button>
                ));
              })()}
            </div>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
          <SummaryBar
            total={summary.total}
            averagePricePerM2={summary.averagePricePerM2}
            averagePrice={summary.averagePrice}
            availableCount={summary.availableCount}
            averageLocalDiff={null}
            totalLabel="Celkem projektů"
          />
          <div className="data-grid-wrapper rounded-xl border border-slate-200 bg-white shadow-sm">
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
              </div>
            </div>
            <div className="data-grid-scroll">
              <table className="data-grid-table">
                <thead className="bg-slate-50/90">
                  <tr>
                    {visibleColumns.map((col, columnIndex) => {
                    const flatKey = getProjectColumnKey(col);
                    const isActive = flatKey === sortBy;
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
                        <span className="inline-flex items-center gap-1">
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
                  <tr>
                    <td
                      colSpan={visibleColumns.length || 1}
                      className="px-3 py-8 text-center text-xs sm:text-sm text-slate-600"
                    >
                      Načítání…
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length || 1}
                      className="px-3 py-8 text-center text-xs sm:text-sm text-slate-600"
                    >
                      Žádné projekty k zobrazení.
                    </td>
                  </tr>
                ) : (
                  projects.map((p) => (
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
                            return formatPercent(val != null ? Number(val) : null);
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
                          return formatProjectValue(raw, col);
                        };

                        const isStickyFirst = columnIndex === 0;
                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-1.5 text-xs sm:text-sm text-slate-900 ${
                              alignRight ? "text-right" : "text-left"
                            } ${isEditable ? "cursor-pointer" : ""} ${isStickyFirst ? "sticky left-0 z-10 bg-inherit" : ""}`}
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
      </main>
      <FiltersDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        filterGroups={filterGroups}
        currentFilters={currentFilters}
        onChange={onChangeFilter}
        onReset={onReset}
        onApply={onApply}
      />
      {columnsOpen && columnsConfig && (
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
              <div className="space-y-0.5">
                {columnsConfig.map((cfg) => (
                  <label
                    key={cfg.key}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-900 transition-colors hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={cfg.visible}
                      onChange={(e) =>
                        setColumnsConfig((prev) =>
                          prev
                            ? prev.map((c) =>
                                c.key === cfg.key ? { ...c, visible: e.target.checked } : c
                              )
                            : prev
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-500/20"
                    />
                    <span className="font-medium text-slate-800">{cfg.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


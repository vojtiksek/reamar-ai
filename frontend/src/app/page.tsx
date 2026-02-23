"use client";

import { FiltersDrawer } from "@/components/FiltersDrawer";
import { SummaryBar } from "@/components/SummaryBar";
import {
  buildUnitsQuery,
  countActiveFilters,
  type CurrentFilters,
  type FilterGroup,
  type FiltersResponse,
  flattenFilterSpecsByKey,
  filtersToSearchParams,
  parseFiltersFromSearchParams,
} from "@/lib/filters";
import { formatValue } from "@/lib/format";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:8001";

type Unit = {
  external_id: string;
  project: { name: string; municipality?: string | null; district?: string | null; [k: string]: unknown };
  unit_name: string | null;
  layout: string | null;
  floor_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  available: boolean;
  ride_to_center_min: number | null;
  public_transport_to_center_min: number | null;
  /** Flat catalog-keyed values (Unit + Project fields) from backend */
  data?: Record<string, unknown>;
};

type UnitsListResponse = {
  items: Unit[];
  total: number;
  limit: number;
  offset: number;
};

type ColumnDef = {
  key: string;
  label: string;
  entity: string;
  data_type: string;
  display_format?: string;
  sortable: boolean;
  filterable: boolean;
  accessor: string;
};

const DEFAULT_LIMIT = 100;
const ROWS_PER_PAGE_OPTIONS = [100, 300, 500] as const;
const SORT_BY_OPTIONS = [
  "price_per_m2_czk",
  "price_czk",
  "ride_to_center_min",
  "public_transport_to_center_min",
  "floor_area_m2",
  "first_seen",
  "last_seen",
] as const;
const SORT_DIR_OPTIONS = ["asc", "desc"] as const;
const DEFAULT_SORT_BY = "price_per_m2_czk";
const DEFAULT_SORT_DIR = "asc";

// Fallback static columns when /columns is unavailable
const FALLBACK_TABLE_COLUMNS: { key: string; label: string; accessor: string; align?: "left" | "right" }[] = [
  { key: "project.name", label: "Projekt", accessor: "project.name" },
  { key: "unit_name", label: "Jednotka", accessor: "unit_name" },
  { key: "layout", label: "Dispozice", accessor: "layout" },
  { key: "floor_area_m2", label: "Podlahová plocha", accessor: "floor_area_m2", align: "right" },
  { key: "price_czk", label: "Cena", accessor: "price_czk", align: "right" },
  { key: "price_per_m2_czk", label: "Cena za m²", accessor: "price_per_m2_czk", align: "right" },
  { key: "available", label: "Dostupnost", accessor: "available" },
  { key: "ride_to_center_min", label: "Autem do centra", accessor: "ride_to_center_min", align: "right" },
  { key: "public_transport_to_center_min", label: "MHD do centra", accessor: "public_transport_to_center_min", align: "right" },
];

const BACKEND_SORT_FIELDS = [
  "price_per_m2_czk",
  "price_czk",
  "ride_to_center_min",
  "public_transport_to_center_min",
  "floor_area_m2",
  "first_seen",
  "last_seen",
  "updated_at",
] as const;

type ColumnConfig = {
  key: string;
  label: string;
  visible: boolean;
};

const COLUMNS_STORAGE_KEY = "reamar_units_table_columns_v1";

/** Map column accessor/key to field_catalog column (unit.data key from backend). */
const ACCESSOR_TO_CATALOG_KEY: Record<string, string> = {
  price_czk: "price",
  price_per_m2_czk: "price_per_sm",
  floor_area_m2: "floor_area",
  ride_to_center_min: "ride_to_center",
  public_transport_to_center_min: "public_transport_to_center",
  layout: "layout",
  available: "available",
  municipality: "municipality",
  district: "district",
  "project.name": "project",
  "project.municipality": "municipality",
  "project.district": "district",
};

function getValue(unit: Unit, accessor: string, catalogKey?: string): unknown {
  const fromData =
    catalogKey && unit.data && Object.prototype.hasOwnProperty.call(unit.data, catalogKey)
      ? unit.data[catalogKey]
      : undefined;
  if (fromData !== undefined) return fromData;
  const parts = accessor.split(".");
  let v: unknown = unit;
  for (const p of parts) {
    if (v == null) return undefined;
    v = (v as Record<string, unknown>)[p];
  }
  return v;
}

function parseSearchParams(params: URLSearchParams): {
  filters: CurrentFilters;
  limit: number;
  offset: number;
  sortBy: string;
  sortDir: string;
} {
  const limitParam = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = ROWS_PER_PAGE_OPTIONS.includes(limitParam as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? limitParam
    : DEFAULT_LIMIT;
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  const sortBy = params.get("sort_by") ?? DEFAULT_SORT_BY;
  const sortDir = params.get("sort_dir") ?? DEFAULT_SORT_DIR;
  const filters = parseFiltersFromSearchParams(params);
  return {
    filters,
    limit,
    offset,
    sortBy: SORT_BY_OPTIONS.includes(sortBy as (typeof SORT_BY_OPTIONS)[number]) ? sortBy : DEFAULT_SORT_BY,
    sortDir: SORT_DIR_OPTIONS.includes(sortDir as "asc" | "desc") ? sortDir : DEFAULT_SORT_DIR,
  };
}

function toSearchParams(
  filters: CurrentFilters,
  limit: number,
  offset: number,
  sortBy: string,
  sortDir: string
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("sort_by", sortBy);
  params.set("sort_dir", sortDir);
  const fp = filtersToSearchParams(filters);
  fp.forEach((v, k) => params.set(k, v));
  return params;
}

function computeSummaryFromUnits(units: Unit[], total: number) {
  const withPrice = units.filter((u) => u.price_czk != null && !Number.isNaN(u.price_czk));
  const withPricePerM2 = units.filter((u) => u.price_per_m2_czk != null && !Number.isNaN(u.price_per_m2_czk));
  const sumPrice = withPrice.reduce((a, u) => a + (u.price_czk ?? 0), 0);
  const sumPricePerM2 = withPricePerM2.reduce((a, u) => a + (u.price_per_m2_czk ?? 0), 0);
  return {
    averagePrice: withPrice.length ? sumPrice / withPrice.length : null,
    averagePricePerM2: withPricePerM2.length ? sumPricePerM2 / withPricePerM2.length : null,
    availableCount: units.filter((u) => u.available).length,
    total,
  };
}

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [filters, setFilters] = useState<CurrentFilters>(() =>
    parseSearchParams(new URLSearchParams(searchParams?.toString() ?? "")).filters
  );
  const [limit, setLimit] = useState(() =>
    parseSearchParams(new URLSearchParams(searchParams?.toString() ?? "")).limit
  );
  const [offset, setOffset] = useState(() =>
    parseSearchParams(new URLSearchParams(searchParams?.toString() ?? "")).offset
  );
  const [sortBy, setSortBy] = useState(() =>
    parseSearchParams(new URLSearchParams(searchParams?.toString() ?? "")).sortBy
  );
  const [sortDir, setSortDir] = useState(() =>
    parseSearchParams(new URLSearchParams(searchParams?.toString() ?? "")).sortDir
  );
  const [currentFilters, setCurrentFilters] = useState<CurrentFilters>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnsConfig, setColumnsConfig] = useState<ColumnConfig[] | null>(null);
  const [serverColumns, setServerColumns] = useState<ColumnDef[] | null>(null);

  const supportedFilterKeys = useMemo(
    () => new Set(filterGroups.flatMap((g) => g.filters.filter((f) => f.backend_supported).map((f) => f.key))),
    [filterGroups]
  );
  const aliasByKey = useMemo(() => flattenFilterSpecsByKey(filterGroups), [filterGroups]);

  // Fetch dynamic column definitions for units view
  useEffect(() => {
    fetch(`${API_BASE}/columns?view=units`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: ColumnDef[]) => {
        setServerColumns(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setServerColumns([]);
      });
  }, []);

  // Initialize columns from localStorage or defaults (once server columns are known)
  useEffect(() => {
    if (columnsConfig !== null) return;
    const cols = serverColumns;
    if (!cols || cols.length === 0) return;
    const defaults: ColumnConfig[] = cols.map((col) => ({
      key: col.key,
      label: col.label,
      visible: true,
    }));
    if (typeof window === "undefined") {
      setColumnsConfig(defaults);
      return;
    }
    try {
      const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (!raw) {
        setColumnsConfig(defaults);
        return;
      }
      const parsed = JSON.parse(raw) as ColumnConfig[];
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
  }, [columnsConfig, serverColumns]);

  // Persist columnsConfig to localStorage
  useEffect(() => {
    if (columnsConfig == null || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columnsConfig));
    } catch {
      // ignore
    }
  }, [columnsConfig]);

  const syncToUrl = useCallback(
    (f: CurrentFilters, lim: number, off: number, sb: string, sd: string) => {
      const p = toSearchParams(f, lim, off, sb, sd);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname]
  );

  useEffect(() => {
    const parsed = parseSearchParams(new URLSearchParams(searchParams?.toString() ?? ""));
    setFilters(parsed.filters);
    setLimit(parsed.limit);
    setOffset(parsed.offset);
    setSortBy(parsed.sortBy);
    setSortDir(parsed.sortDir);
  }, [searchParams]);

  useEffect(() => {
    fetch(`${API_BASE}/filters`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: FiltersResponse) => {
        const groups = data?.groups ?? [];
        setFilterGroups(
          groups.map((g) => ({
            ...g,
            filters: g.filters.map((f) =>
              f.key === "availability" && f.type === "enum"
                ? {
                    ...f,
                    key: "available",
                    type: "boolean" as const,
                    alias: "Dostupné",
                    options: [true, false],
                    backend_supported: true,
                  }
                : f
            ),
          }))
        );
      })
      .catch(() => setFilterGroups([]));
  }, []);

  const safeLimit = ROWS_PER_PAGE_OPTIONS.includes(limit as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? limit
    : DEFAULT_LIMIT;
  const validSortBy = SORT_BY_OPTIONS.includes(sortBy as (typeof SORT_BY_OPTIONS)[number])
    ? sortBy
    : DEFAULT_SORT_BY;
  const validSortDir = SORT_DIR_OPTIONS.includes(sortDir as "asc" | "desc") ? sortDir : DEFAULT_SORT_DIR;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = buildUnitsQuery(
      filters,
      supportedFilterKeys,
      { limit: safeLimit, offset },
      { sort_by: validSortBy, sort_dir: validSortDir }
    );
    fetch(`${API_BASE}/units?${qs}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: UnitsListResponse) => {
        setUnits(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [filters, safeLimit, offset, validSortBy, validSortDir, supportedFilterKeys]);

  const openDrawer = useCallback(() => {
    setCurrentFilters({ ...filters });
    setDrawerOpen(true);
  }, [filters]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const onApply = useCallback(() => {
    setFilters(currentFilters);
    syncToUrl(currentFilters, limit, 0, sortBy, sortDir);
    setOffset(0);
    closeDrawer();
    if (process.env.NODE_ENV === "development") {
      const qs = buildUnitsQuery(
        currentFilters,
        supportedFilterKeys,
        { limit: safeLimit, offset: 0 },
        { sort_by: validSortBy, sort_dir: validSortDir }
      );
      // eslint-disable-next-line no-console
      console.log("GET /units fetch URL:", `${API_BASE}/units?${qs}`);
    }
  }, [
    currentFilters,
    limit,
    sortBy,
    sortDir,
    supportedFilterKeys,
    safeLimit,
    validSortBy,
    validSortDir,
    syncToUrl,
    closeDrawer,
  ]);

  const onReset = useCallback(() => setCurrentFilters({}), []);

  const onResetAll = useCallback(() => {
    setFilters({});
    setCurrentFilters({});
    syncToUrl({}, limit, 0, sortBy, sortDir);
    setOffset(0);
    closeDrawer();
  }, [limit, sortBy, sortDir, syncToUrl, closeDrawer]);

  const onChange = useCallback((key: string, value: number | number[] | string[] | boolean | undefined) => {
    setCurrentFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setPage = useCallback(
    (newOffset: number) => {
      setOffset(newOffset);
      syncToUrl(filters, limit, newOffset, sortBy, sortDir);
    },
    [filters, limit, sortBy, sortDir, syncToUrl]
  );

  const setLimitAndSort = useCallback(
    (opts: { limit?: number; sortBy?: string; sortDir?: string }) => {
      const newLimit = opts.limit ?? limit;
      const newSortBy = opts.sortBy ?? sortBy;
      const newSortDir = opts.sortDir ?? sortDir;
      if (opts.limit !== undefined) setLimit(newLimit);
      if (opts.sortBy !== undefined) setSortBy(newSortBy);
      if (opts.sortDir !== undefined) setSortDir(newSortDir);
      setOffset(0);
      syncToUrl(filters, newLimit, 0, newSortBy, newSortDir);
    },
    [filters, limit, sortBy, sortDir, syncToUrl]
  );

  const handleSortHeaderClick = useCallback(
    (nextSortBy: string) => {
      if (nextSortBy !== sortBy) {
        setLimitAndSort({ sortBy: nextSortBy, sortDir: "asc" });
      } else {
        setLimitAndSort({ sortDir: sortDir === "asc" ? "desc" : "asc" });
      }
    },
    [sortBy, sortDir, setLimitAndSort]
  );

  const summary = computeSummaryFromUnits(units, total);
  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = total === 0 ? 0 : Math.min(offset + safeLimit, total);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const visibleColumns = useMemo(() => {
    if (serverColumns && serverColumns.length > 0) {
      const byKey = new Map(serverColumns.map((c) => [c.key, c]));
      const baseConfig =
        columnsConfig ??
        serverColumns.map((c) => ({
          key: c.key,
          label: c.label,
          visible: true,
        }));
      return baseConfig
        .filter((c) => c.visible)
        .map((c) => {
          const col = byKey.get(c.key);
          if (!col) return null;
          const accessor = col.accessor || col.key;
          const dt = col.data_type;
          const align: "left" | "right" =
            dt === "number" ||
            accessor.endsWith("_czk") ||
            accessor.endsWith("_m2") ||
            accessor.endsWith("_min")
              ? "right"
              : "left";
          const withAlign: ColumnDef & { align: "left" | "right" } = {
            ...col,
            label: c.label || col.label,
            accessor,
            align,
          };
          return withAlign;
        })
        .filter(Boolean) as Array<ColumnDef & { align: "left" | "right" }>;
    }
    // Fallback to static columns when /columns is not available
    return FALLBACK_TABLE_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      entity: "unit",
      data_type: "text",
      display_format: undefined as string | undefined,
      sortable: false,
      filterable: false,
      accessor: c.accessor,
      align: c.align ?? "left",
    }));
  }, [serverColumns, columnsConfig]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">Reamar</h1>
          <div className="flex items-center rounded-lg border border-gray-300 p-0.5">
            <button type="button" className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white">
              Jednotky
            </button>
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Projekty
            </button>
          </div>
          <button
            type="button"
            onClick={openDrawer}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            title={countActiveFilters(filters) > 0 ? `Aktivní filtry: ${countActiveFilters(filters)}` : undefined}
          >
            Filtry
            {countActiveFilters(filters) > 0 && (
              <span className="ml-1 rounded bg-gray-200 px-1.5 text-xs">{countActiveFilters(filters)}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setColumnsOpen(true)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Sloupce
          </button>
          <button
            type="button"
            onClick={onResetAll}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Reset
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-500">Řádků</span>
            <select
              value={safeLimit}
              onChange={(e) => setLimitAndSort({ limit: Number(e.target.value) })}
              disabled={loading}
              className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
            >
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <span className="text-xs text-gray-500">
            {showFrom}–{showTo} z {total}
          </span>
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
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded border border-gray-200">
            <div className="sticky top-0 z-[1] flex items-center justify-end gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, offset - safeLimit))}
                disabled={offset <= 0 || loading}
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 hover:bg-gray-100"
              >
                Předchozí
              </button>
              <span className="text-sm text-gray-600">
                Strana {total === 0 ? 0 : Math.floor(offset / safeLimit) + 1} z {total === 0 ? 0 : Math.ceil(total / safeLimit) || 1}
              </span>
              <button
                type="button"
                onClick={() => setPage(offset + safeLimit)}
                disabled={offset + safeLimit >= total || loading}
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 hover:bg-gray-100"
              >
                Další
              </button>
            </div>
            <table className="min-w-full border-collapse">
              <thead className="sticky top-[45px] z-[1] bg-gray-100">
                <tr>
                  {visibleColumns.map(({ key, label, accessor, align, sortable }) => {
                    const sortByValue = BACKEND_SORT_FIELDS.find(
                      (f) => accessor === f || accessor.endsWith(`.${f}`)
                    );
                    const isSortable = sortable && !!sortByValue;
                    const isActive = sortByValue === sortBy;
                    return (
                      <th
                        key={key}
                        onClick={() => isSortable && sortByValue && handleSortHeaderClick(sortByValue)}
                        className={`border-b border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 ${
                          align === "right" ? "text-right" : "text-left"
                        } ${isSortable ? "cursor-pointer select-none hover:bg-gray-200" : ""} ${
                          isActive ? "bg-gray-200 font-semibold" : ""
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {isActive && <span className="text-gray-600">{sortDir === "asc" ? "▲" : "▼"}</span>}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {loading && units.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-sm text-gray-500">
                      Načítání…
                    </td>
                  </tr>
                ) : (
                  units.map((u) => (
                    <tr
                      key={u.external_id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/units/${encodeURIComponent(u.external_id)}`)}
                    >
                      {visibleColumns.map(({ key, accessor, align, data_type, display_format: df }) => {
                        const catalogKey = ACCESSOR_TO_CATALOG_KEY[accessor] ?? ACCESSOR_TO_CATALOG_KEY[key] ?? key;
                        const raw = getValue(u, accessor, catalogKey);
                        const formatted = formatValue(raw, {
                          display_format: df ?? data_type,
                          key,
                        });
                        const isAvailableCol = key === "available";
                        return (
                          <td
                            key={key}
                            className={`px-3 py-2 text-sm ${
                              align === "right" ? "text-right" : "text-left"
                            } ${
                              isAvailableCol
                                ? raw
                                  ? "text-green-600"
                                  : "text-red-600"
                                : ""
                            }`}
                          >
                            {formatted}
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
      </main>

      <FiltersDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        filterGroups={filterGroups}
        currentFilters={currentFilters}
        onChange={onChange}
        onReset={onReset}
        onApply={onApply}
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
              <div className="fixed right-0 top-0 z-50 flex h-full w-[360px] max-w-full flex-col bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                  <h2 className="text-sm font-semibold text-gray-900">Sloupce tabulky</h2>
                  <button
                    type="button"
                    onClick={() => setColumnsOpen(false)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Zavřít"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  <p className="mb-2 text-xs text-gray-500">
                    Přetáhněte řádky pro změnu pořadí, zrušte zaškrtnutí pro skrytí sloupce.
                  </p>
                  <SortableContext
                    items={columnsConfig.map((c) => c.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-1.5">
                      {columnsConfig.map((col) => (
                        <ColumnRow
                          key={col.key}
                          column={col}
                          onToggleVisible={(visible) =>
                            setColumnsConfig((prev) =>
                              prev
                                ? prev.map((c) =>
                                    c.key === col.key ? { ...c, visible } : c
                                  )
                                : prev
                            )
                          }
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </div>
                <div className="border-t border-gray-200 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      const cols = serverColumns;
                      const defaults: ColumnConfig[] = cols
                        ? cols.map((col) => ({
                            key: col.key,
                            label: col.label,
                            visible: true,
                          }))
                        : FALLBACK_TABLE_COLUMNS.map((c) => ({
                            key: c.key,
                            label: c.label,
                            visible: true,
                          }));
                      setColumnsConfig(defaults);
                      if (typeof window !== "undefined") {
                        window.localStorage.removeItem(COLUMNS_STORAGE_KEY);
                      }
                    }}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Reset na výchozí
                  </button>
                </div>
              </div>
            </>
          )}
        </DndContext>
      )}
    </div>
  );
}

function ColumnRow({
  column,
  onToggleVisible,
}: {
  column: ColumnConfig;
  onToggleVisible: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  });
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between rounded border border-gray-200 bg-white px-2 py-1.5 text-sm ${
        isDragging ? "shadow-lg ring-1 ring-gray-300" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-gray-400 hover:text-gray-600"
          aria-label="Přesunout"
        >
          ⠿
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={column.visible}
            onChange={(e) => onToggleVisible(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
          />
          <span className="text-gray-800">{column.label}</span>
        </label>
      </div>
    </li>
  );
}

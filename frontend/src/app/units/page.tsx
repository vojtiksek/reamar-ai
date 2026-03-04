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
import { API_BASE } from "@/lib/api";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

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
  average_price_czk?: number | null;
  average_price_per_m2_czk?: number | null;
  available_count?: number | null;
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
// Všechna pole, která umíme na backendu řadit globálně (musí sedět s ALLOWED_SORT_BY v backendu).
const SORT_BY_OPTIONS = [
  // Unit-level fields
  "price_per_m2_czk",
  "price_czk",
  "price_change",
  "original_price_czk",
  "original_price_per_m2_czk",
  "ride_to_center_min",
  "public_transport_to_center_min",
  "floor_area_m2",
  "total_area_m2",
  "exterior_area_m2",
  "balcony_area_m2",
  "terrace_area_m2",
  "garden_area_m2",
  "days_on_market",
  "first_seen",
  "last_seen",
  "updated_at",
  "layout",
  "floor",
  "floors",
  "orientation",
  "category",
  "availability_status",
  "sold_date",
  "renovation",
  "overall_quality",
  "heating",
  "air_conditioning",
  "cooling_ceilings",
  "exterior_blinds",
  "payment_contract",
  "payment_construction",
  "payment_occupancy",
  "smart_home",
  "permit_regular",
  "city",
  "municipality",
  "district",
  "cadastral_area_iga",
  "municipal_district_iga",
  "administrative_district_iga",
  "region_iga",
  "address",
  "developer",
  // Projekt (název projektu v tabulce jednotek)
  "name",
  // Project-level aggregates (ProjectAggregates injected into unit.data)
  "total_units",
  "available_units",
  "availability_ratio",
  "avg_price_czk",
  "min_price_czk",
  "max_price_czk",
  "avg_price_per_m2_czk",
  "avg_floor_area_m2",
  "min_parking_indoor_price_czk",
  "max_parking_indoor_price_czk",
  "min_parking_outdoor_price_czk",
  "max_parking_outdoor_price_czk",
  "project_first_seen",
  "project_last_seen",
  "max_days_on_market",
  "min_payment_contract",
  "max_payment_contract",
  "min_payment_construction",
  "max_payment_construction",
  "min_payment_occupancy",
  "max_payment_occupancy",
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
  // Unit-level fields
  "price_per_m2_czk",
  "price_czk",
  "price_change",
  "original_price_czk",
  "original_price_per_m2_czk",
  "ride_to_center_min",
  "public_transport_to_center_min",
  "floor_area_m2",
  "total_area_m2",
  "exterior_area_m2",
  "balcony_area_m2",
  "terrace_area_m2",
  "garden_area_m2",
  "days_on_market",
  "first_seen",
  "last_seen",
  "updated_at",
  "layout",
  "floor",
  "floors",
  "orientation",
  "category",
  "availability_status",
  "sold_date",
  "renovation",
  "overall_quality",
  "heating",
  "air_conditioning",
  "cooling_ceilings",
  "exterior_blinds",
  "payment_contract",
  "payment_construction",
  "payment_occupancy",
  "smart_home",
  "permit_regular",
  "city",
  "municipality",
  "district",
  "cadastral_area_iga",
  "municipal_district_iga",
  "administrative_district_iga",
  "region_iga",
  "address",
  "developer",
  // Projekt (název projektu v tabulce jednotek)
  "name",
  // Project-level aggregates (ProjectAggregates injected into unit.data)
  "total_units",
  "available_units",
  "availability_ratio",
  "avg_price_czk",
  "min_price_czk",
  "max_price_czk",
  "avg_price_per_m2_czk",
  "avg_floor_area_m2",
  "min_parking_indoor_price_czk",
  "max_parking_indoor_price_czk",
  "min_parking_outdoor_price_czk",
  "max_parking_outdoor_price_czk",
  "project_first_seen",
  "project_last_seen",
  "max_days_on_market",
  "min_payment_contract",
  "max_payment_contract",
  "min_payment_construction",
  "max_payment_construction",
  "min_payment_occupancy",
  "max_payment_occupancy",
] as const;

type ColumnConfig = {
  key: string;
  label: string;
  visible: boolean;
};

const COLUMNS_STORAGE_KEY = "reamar_units_table_columns_v1";

/** Map column accessor/key to field_catalog column (unit.data key from backend). */
const ACCESSOR_TO_CATALOG_KEY: Record<string, string> = {
  // Prices
  price_czk: "price",
  price_per_m2_czk: "price_per_sm",
  original_price_czk: "original_price",
  original_price_per_m2_czk: "original_price_per_sm",

  // Areas
  floor_area_m2: "floor_area",
  total_area_m2: "total_area",
  balcony_area_m2: "balcony_area",
  terrace_area_m2: "terrace_area",
  garden_area_m2: "garden_area",

  // Time / status
  days_on_market: "days_on_market",
  first_seen: "first_seen",
  last_seen: "last_seen",

  // Unit meta
  layout: "layout",
  available: "available",
  url: "unit_url",
  id: "id",

  // Location
  municipality: "municipality",
  district: "district",

  // Project-related fields on unit
  "project.name": "project",
  "project.municipality": "municipality",
  "project.district": "district",
  "project.project_url": "project_url",

  // Project aggregates cached per project
  "project.total_units": "total_units",
  "project.available_units": "available_units",
  "project.availability_ratio": "availability_ratio",
  "project.avg_price_czk": "avg_price_czk",
  "project.min_price_czk": "min_price_czk",
  "project.max_price_czk": "max_price_czk",
  "project.avg_price_per_m2_czk": "avg_price_per_m2_czk",
  "project.avg_floor_area_m2": "avg_floor_area_m2",
  // Project parking price aggregates
  "project.min_parking_indoor_price_czk": "min_parking_indoor_price_czk",
  "project.max_parking_indoor_price_czk": "max_parking_indoor_price_czk",
  "project.min_parking_outdoor_price_czk": "min_parking_outdoor_price_czk",
  "project.max_parking_outdoor_price_czk": "max_parking_outdoor_price_czk",
  // Project time/status aggregates
  "project.project_first_seen": "project_first_seen",
  "project.project_last_seen": "project_last_seen",
  "project.max_days_on_market": "max_days_on_market",
  // Project payment scheme aggregates
  "project.min_payment_contract": "min_payment_contract",
  "project.max_payment_contract": "max_payment_contract",
  "project.min_payment_construction": "min_payment_construction",
  "project.max_payment_construction": "max_payment_construction",
  "project.min_payment_occupancy": "min_payment_occupancy",
  "project.max_payment_occupancy": "max_payment_occupancy",
};

function getValue(unit: Unit, accessor: string, catalogKey?: string): unknown {
  // Special case: derive project_url from unit URL when requested in units view.
  if (catalogKey === "project_url" || accessor === "project.project_url") {
    const raw =
      ((unit as any).url as string | undefined) ??
      (unit.data?.unit_url as string | undefined);
    if (!raw) return undefined;
    const s = String(raw);
    try {
      // Try robust URL parsing first
      const u = new URL(s);
      return `${u.protocol}//${u.host}`;
    } catch {
      // Fallback for common .cz/ pattern (e.g. https://www.domanavinici.cz/projekty/...)
      const czIndex = s.indexOf(".cz/");
      if (czIndex !== -1) {
        return s.slice(0, czIndex + 3); // include ".cz"
      }
      return s;
    }
  }

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
  const [summaryOverride, setSummaryOverride] = useState<{
    total: number;
    averagePrice: number | null;
    averagePricePerM2: number | null;
    availableCount: number;
  } | null>(null);

  const [editingCell, setEditingCell] = useState<{ externalId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string | boolean>("");
  const [savingOverride, setSavingOverride] = useState(false);

  const rowClickTimeoutRef = useRef<number | null>(null);

  const supportedFilterKeys = useMemo(
    () => new Set(filterGroups.flatMap((g) => g.filters.filter((f) => f.backend_supported).map((f) => f.key))),
    [filterGroups]
  );
  const aliasByKey = useMemo(() => flattenFilterSpecsByKey(filterGroups), [filterGroups]);

  const getExternalIdForRow = useCallback((u: Unit): string | null => {
    const rawExternalId = (u as any).external_id ?? (u as any).source_unit_id ?? (u as any).id;
    if (!rawExternalId) {
      return null;
    }
    return String(rawExternalId);
  }, []);

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
        // Necháme backendový enum filter "availability" tak, jak je,
        // aby bylo možné kombinovat hodnoty (available + reserved).
        setFilterGroups(groups);
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
        setSummaryOverride({
          total: data.total ?? 0,
          averagePrice: data.average_price_czk ?? null,
          averagePricePerM2: data.average_price_per_m2_czk ?? null,
          availableCount: data.available_count ?? 0,
        });
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
    (columnKey: string, accessor: string, dataType: string) => {
      const backendField = BACKEND_SORT_FIELDS.find(
        (f) => accessor === f || accessor.endsWith(`.${f}`)
      );
      if (!backendField) {
        // Sloupec neumí globální řazení na backendu – klik ignorujeme,
        // a tím pádem nikdy neřadíme jen aktuální stránku.
        return;
      }
      if (backendField !== sortBy) {
        setLimitAndSort({ sortBy: backendField, sortDir: "asc" });
      } else {
        setLimitAndSort({ sortDir: sortDir === "asc" ? "desc" : "asc" });
      }
    },
    [sortBy, sortDir, setLimitAndSort]
  );

  const summary = summaryOverride ?? computeSummaryFromUnits(units, total);
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
      const backendSortable = new Set<string>(BACKEND_SORT_FIELDS);
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
            // Povolit klikatelné řazení jen pro sloupce, které umí backend sortovat globálně.
            sortable: backendSortable.has(accessor) || backendSortable.has(col.key),
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

  const saveOverride = useCallback(
    async (externalId: string, fieldKey: string, value: string | boolean) => {
      setSavingOverride(true);
      try {
        const body = {
          value: typeof value === "boolean" ? String(value) : String(value),
        };
        const res = await fetch(
          `${API_BASE}/units/${encodeURIComponent(externalId)}/overrides/${encodeURIComponent(fieldKey)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error("Failed to save unit override", await res.text());
          return;
        }
        const updated = (await res.json()) as any;
        setUnits((prev) =>
          prev.map((row) => {
            const rowExternalId = getExternalIdForRow(row);
            if (!rowExternalId || rowExternalId !== externalId) return row;
            return {
              ...row,
              price_czk: updated.price_czk ?? row.price_czk,
              price_per_m2_czk: updated.price_per_m2_czk ?? row.price_per_m2_czk,
              available: updated.available ?? row.available,
              floor_area_m2: updated.floor_area_m2 ?? row.floor_area_m2,
              data: updated.data ?? row.data,
              project: updated.project ?? row.project,
            };
          })
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to save unit override", e);
      } finally {
        setSavingOverride(false);
        setEditingCell(null);
      }
    },
    [getExternalIdForRow]
  );

  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, u: Unit) => {
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

      const externalId = getExternalIdForRow(u);
      if (!externalId) {
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.warn("[UnitsPage] Missing externalId for row", u);
        }
        return;
      }

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
        router.push(`/units/${encodeURIComponent(externalId)}`);
      }, 180);
    },
    [router, editingCell, getExternalIdForRow]
  );

  useEffect(
    () => () => {
      if (rowClickTimeoutRef.current !== null) {
        window.clearTimeout(rowClickTimeoutRef.current);
      }
    },
    []
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">Reamar</h1>
          <div className="flex items-center rounded-lg border border-gray-300 bg-gray-50/50 p-0.5">
            <button
              type="button"
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900"
            >
              Jednotky
            </button>
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:text-gray-900"
            >
              Projekty
            </button>
          </div>
          <button
            type="button"
            onClick={openDrawer}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
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
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Sloupce
          </button>
          <button
            type="button"
            onClick={onResetAll}
            disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reset
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="font-medium text-gray-700">Řádků</span>
            <select
              value={safeLimit}
              onChange={(e) => setLimitAndSort({ limit: Number(e.target.value) })}
              disabled={loading}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-900 disabled:opacity-50 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            >
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <span className="text-xs text-gray-600">
            {showFrom}–{showTo} z {total}
          </span>
        </div>
        {countActiveFilters(filters) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-gray-700">
            {(() => {
              const badges: string[] = [];
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
                  badges.push(`${label}: ${v.join(", ")}`);
                } else if (typeof v === "boolean") {
                  badges.push(`${label}: ${v ? "Ano" : "Ne"}`);
                } else if (typeof v === "number" && !Number.isNaN(v)) {
                  badges.push(`${label}: ${v}`);
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
                badges.push(`${label}: ${value}`);
              }
              return badges.map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5"
                >
                  {b}
                </span>
              ));
            })()}
          </div>
        )}
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
          <div className="data-grid-wrapper">
            <div className="flex items-center justify-end gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs sm:text-sm">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, offset - safeLimit))}
                disabled={offset <= 0 || loading}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs sm:text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Předchozí
              </button>
              <span className="text-xs sm:text-sm text-gray-700">
                Strana {total === 0 ? 0 : Math.floor(offset / safeLimit) + 1} z {total === 0 ? 0 : Math.ceil(total / safeLimit) || 1}
              </span>
              <button
                type="button"
                onClick={() => setPage(offset + safeLimit)}
                disabled={offset + safeLimit >= total || loading}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs sm:text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Další
              </button>
            </div>
            <div className="data-grid-scroll">
              <table className="data-grid-table">
                <thead className="bg-gray-50">
                  <tr>
                    {visibleColumns.map(
                      ({ key, label, accessor, align, sortable, data_type }, columnIndex) => {
                        const backendField = BACKEND_SORT_FIELDS.find(
                          (f) => accessor === f || accessor.endsWith(`.${f}`)
                        );
                        const isBackendSortable = !!backendField;
                        const isActive = isBackendSortable && backendField === sortBy;
                        const isStickyFirst = columnIndex === 0;
                        const canSort = isBackendSortable;
                        return (
                          <th
                            key={key}
                            onClick={canSort ? () => handleSortHeaderClick(key, accessor, data_type) : undefined}
                            className={`sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs sm:text-sm font-semibold text-gray-700 ${
                              align === "right" ? "text-right" : "text-left"
                            } ${
                              canSort ? "cursor-pointer select-none hover:bg-gray-100" : ""
                            } ${isActive ? "bg-gray-100" : ""} ${
                              isStickyFirst ? "left-0 z-20" : ""
                            }`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {label}
                              {isActive && (
                                <span className="text-gray-600">
                                  {sortDir === "asc" ? "▲" : "▼"}
                                </span>
                              )}
                            </span>
                          </th>
                        );
                      }
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {loading && units.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColumns.length}
                        className="px-3 py-8 text-center text-xs sm:text-sm text-gray-600"
                      >
                        Načítání…
                      </td>
                    </tr>
                  ) : (
                    units.map((u: Unit) => {
                      const isSold =
                        (u as any).availability_status === "sold" ||
                        (u as any).availability_status === "SOLD";
                      return (
                        <tr
                          key={u.external_id}
                          className={`cursor-pointer odd:bg-white even:bg-gray-50/60 hover:bg-gray-100 ${
                            isSold ? "bg-red-50/70" : ""
                          }`}
                          onClick={(e) => handleRowClick(e, u)}
                        >
                          {visibleColumns.map(
                          ({ key, accessor, align, data_type, display_format: df }, columnIndex) => {
                            const catalogKey = ACCESSOR_TO_CATALOG_KEY[accessor] ?? ACCESSOR_TO_CATALOG_KEY[key] ?? key;
                            const raw = getValue(u, accessor, catalogKey);
                            const formatted = formatValue(raw, {
                              display_format: df ?? data_type,
                              key,
                            });
                            const isAvailableCol = key === "available";
                            const isStickyFirst = columnIndex === 0;
                            const externalId = getExternalIdForRow(u);
                            const isEditable =
                              key === "available" || key === "price_czk" || key === "price_per_m2_czk";
                            const isEditing =
                              editingCell != null &&
                              externalId != null &&
                              editingCell.externalId === externalId &&
                              editingCell.field === key;

                            return (
                              <td
                                key={key}
                                className={`px-3 py-1.5 text-xs sm:text-sm text-gray-900 ${
                                  align === "right" ? "text-right" : "text-left"
                                } ${
                                  isAvailableCol
                                    ? raw
                                      ? "text-green-600"
                                      : "text-red-600"
                                    : ""
                                } ${isStickyFirst ? "sticky left-0 z-10 bg-white" : ""} ${
                                  isEditable ? "cursor-pointer" : ""
                                }`}
                                onDoubleClick={() => {
                                  if (!isEditable || loading || savingOverride) return;
                                  if (!externalId) return;
                                  if (data_type === "bool") {
                                    const current =
                                      typeof raw === "boolean"
                                        ? raw
                                        : String(raw ?? "").toLowerCase() === "true";
                                    setEditingCell({ externalId, field: key });
                                    setEditValue(current);
                                  } else {
                                    setEditingCell({ externalId, field: key });
                                    setEditValue(raw == null ? "" : String(raw));
                                  }
                                }}
                              >
                                {isEditing && data_type === "bool" ? (
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={
                                      typeof editValue === "boolean"
                                        ? editValue
                                        : String(editValue).toLowerCase() === "true"
                                    }
                                    onChange={(e) => setEditValue(e.target.checked)}
                                    onBlur={() => {
                                      if (!externalId) return;
                                      void saveOverride(externalId, key, editValue);
                                    }}
                                  />
                                ) : isEditing ? (
                                  <input
                                    type={data_type === "number" ? "number" : "text"}
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
                                    onBlur={() => {
                                      if (!externalId) return;
                                      void saveOverride(externalId, key, editValue);
                                    }}
                                    onKeyDown={(e) => {
                                      if (!externalId) return;
                                      if (e.key === "Enter") {
                                        void saveOverride(externalId, key, editValue);
                                      } else if (e.key === "Escape") {
                                        setEditingCell(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  formatted
                                )}
                              </td>
                            );
                          }
                        )}
                      </tr>
                    );
                  })
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

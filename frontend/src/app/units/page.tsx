"use client";

import { FiltersDrawer } from "@/components/FiltersDrawer";
import { SummaryBar } from "@/components/SummaryBar";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
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
import { formatValue, formatLayout } from "@/lib/format";
import { API_BASE } from "@/lib/api";
import { decodePolygon, getPolygonBounds } from "@/lib/geo";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  type WalkabilityPreferences,
  loadPreferences as loadWalkPrefs,
  savePreferences as saveWalkPrefs,
  resetPreferences as resetWalkPrefs,
  isPersonalizedActive,
  getNonDefaultChips,
  getDefaultPreferences,
} from "@/lib/walkabilityPreferences";

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
  pending_api_updates?: { field: string; api_value: string }[];
};

type UnitsListResponse = {
  items: Unit[];
  total: number;
  limit: number;
  offset: number;
  average_price_czk?: number | null;
  average_price_per_m2_czk?: number | null;
  available_count?: number | null;
  average_local_price_diff_1000m?: number | null;
  average_local_price_diff_2000m?: number | null;
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
  "local_price_diff_1000m",
  "local_price_diff_2000m",
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
  "noise_day_db",
  "noise_night_db",
  "noise_label",
  "distance_to_primary_road_m",
  "distance_to_tram_tracks_m",
  "distance_to_railway_m",
  "distance_to_airport_m",
  "micro_location_score",
  "micro_location_label",
  "walkability_score",
  "walkability_label",
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
  "ride_to_center",
  "public_transport_to_center",
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
  // Lokální cenová odchylka vs. trh (bez 500 m)
  "local_price_diff_1000m",
  "local_price_diff_2000m",
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
  "noise_day_db",
  "noise_night_db",
  "noise_label",
  "distance_to_primary_road_m",
  "distance_to_tram_tracks_m",
  "distance_to_railway_m",
  "distance_to_airport_m",
  "micro_location_score",
  "micro_location_label",
  "walkability_score",
  "walkability_label",
] as const;

// Sloupce, které nechceme zobrazovat v tabulce jednotek ani v nabídce „Sloupce“,
// ale data zůstávají k dispozici pro filtry a detail jednotky.
const HIDDEN_TABLE_COLUMN_KEYS = new Set<string>([
  "original_price_czk",
  "original_price_per_m2_czk",
  "administrative_district_iga",
  "project_url",
  "project.project_url",
  // Trvale skryté sloupce – nechceme je ani v nabídce „Sloupce“
  "address",
  "project.address",
  "availability_status",
  "overall_quality",
  "project.overall_quality",
  "unit_name",
  "building",
  "url",
  "unit_url",
  "id",
  "external_id",
]);

// Sloupce, které mají být pro nového uživatele výchozím způsobem skryté,
// ale v nabídce „Sloupce“ je lze znovu zapnout.
const DEFAULT_HIDDEN_COLUMN_KEYS = new Set<string>([
  // Projektové počty jednotek
  "total_units",
  "available_units",
  // Ceny stání / garáže (projektové agregáty)
  "min_parking_outdoor_price_czk", // Cena stání
  "min_parking_indoor_price_czk",  // Cena garáže
  // Změna ceny
  "price_change",
  // Podíl dostupných
  "availability_ratio",
  // Průměrná / min / max cena (projektové agregáty)
  "avg_price_czk",
  "avg_price_per_m2_czk",
  "min_price_czk",
  "max_price_czk",
  // Průměrná plocha m2 (projektový agregát)
  "avg_floor_area_m2",
  // Lokalita – město, kraj
  "city",
  "region_iga",
  // Plochy
  "total_area_m2",
  "balcony_area_m2",
  "terrace_area_m2",
  "garden_area_m2",
  // Orientace
  "orientation",
  // První / poslední výskyt, datum prodeje (projekt + jednotka)
  "project_first_seen",
  "project_last_seen",
  "first_seen",
  "last_seen",
  "sold_date",
  // Standardy – jednotkové
  "heating",
  "air_conditioning",
  "cooling_ceilings",
  "exterior_blinds",
  "smart_home",
  "windows",
  "partition_walls",
  // Jednotkové financování – v tabulce použijeme sloupec „Financování (a/b/c)“
  "payment_contract",
  "payment_construction",
  "payment_occupancy",
]);

// Pomocná funkce: vrátí true, pokud má být sloupec (podle svého katalogového klíče)
// výchozím způsobem skrytý. Bereme v úvahu jak key, tak accessor (např. "project.foo").
function isDefaultHiddenColumn(col: { key: string; accessor?: string }): boolean {
  const accessor = col.accessor ?? col.key;
  const catalogKey =
    ACCESSOR_TO_CATALOG_KEY[accessor] ??
    ACCESSOR_TO_CATALOG_KEY[col.key] ??
    accessor;
  return DEFAULT_HIDDEN_COLUMN_KEYS.has(catalogKey);
}

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
  // Hluk projektu (project-level)
  "project.noise_day_db": "noise_day_db",
  "project.noise_night_db": "noise_night_db",
  "project.noise_label": "noise_label",
  // Mikro-lokalita (project-level, v unit.data z backendu)
  "project.distance_to_primary_road_m": "distance_to_primary_road_m",
  "project.distance_to_tram_tracks_m": "distance_to_tram_tracks_m",
  "project.distance_to_railway_m": "distance_to_railway_m",
  "project.distance_to_airport_m": "distance_to_airport_m",
  "project.micro_location_score": "micro_location_score",
  "project.micro_location_label": "micro_location_label",
  distance_to_primary_road_m: "distance_to_primary_road_m",
  distance_to_tram_tracks_m: "distance_to_tram_tracks_m",
  distance_to_railway_m: "distance_to_railway_m",
  distance_to_airport_m: "distance_to_airport_m",
  micro_location_score: "micro_location_score",
  micro_location_label: "micro_location_label",
  "project.walkability_score": "walkability_score",
  "project.walkability_label": "walkability_label",
  walkability_score: "walkability_score",
  walkability_label: "walkability_label",
  // Lokální cenová odchylka (percent)
  local_price_diff_1000m: "local_price_diff_1000m",
  local_price_diff_2000m: "local_price_diff_2000m",
  // Backend data používá klíče ride_to_center / public_transport_to_center (catalog column)
  ride_to_center_min: "ride_to_center",
  public_transport_to_center_min: "public_transport_to_center",
  "project.ride_to_center": "ride_to_center",
  "project.public_transport_to_center": "public_transport_to_center",
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
  polygon?: string | null;
} {
  const limitParam = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = ROWS_PER_PAGE_OPTIONS.includes(limitParam as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? limitParam
    : DEFAULT_LIMIT;
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  let sortBy = params.get("sort_by") ?? DEFAULT_SORT_BY;
  if (sortBy === "ride_to_center") sortBy = "ride_to_center_min";
  if (sortBy === "public_transport_to_center") sortBy = "public_transport_to_center_min";
  const sortDir = params.get("sort_dir") ?? DEFAULT_SORT_DIR;
  const filters = parseFiltersFromSearchParams(params);
  const polygon = params.get("poly");
  return {
    filters,
    limit,
    offset,
    sortBy: SORT_BY_OPTIONS.includes(sortBy as (typeof SORT_BY_OPTIONS)[number]) ? sortBy : DEFAULT_SORT_BY,
    sortDir: SORT_DIR_OPTIONS.includes(sortDir as "asc" | "desc") ? sortDir : DEFAULT_SORT_DIR,
    polygon,
  };
}

function toSearchParams(
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

function downloadUnitsCsv(
  units: Unit[],
  visibleColumns: Array<{ key: string; label: string; accessor: string; data_type: string; display_format?: string }>
) {
  const header = visibleColumns.map((c) => escapeCsvCell(c.label)).join(",");
  const rows = units.map((u) => {
    return visibleColumns
      .map(({ key, accessor, data_type, display_format: df }) => {
        if (key === "financing_scheme") {
          const aRaw = getValue(u, "payment_contract", "payment_contract");
          const bRaw = getValue(u, "payment_construction", "payment_construction");
          const cRaw = getValue(u, "payment_occupancy", "payment_occupancy");
          const toPct = (v: unknown): string => {
            if (v == null || v === "") return "—";
            const n = typeof v === "number" ? v : Number(v);
            if (Number.isNaN(n)) return "—";
            // Hodnoty jsou 0–1 → zobrazíme jako celé procento
            return `${Math.round(n <= 1 ? n * 100 : n)}`;
          };
          const a = toPct(aRaw);
          const b = toPct(bRaw);
          const c = toPct(cRaw);
          const val = `${a}/${b}/${c}`;
          return escapeCsvCell(val);
        }
        if (key === "units_overview") {
          const totalRaw = getValue(u, "project.total_units", "total_units");
          const availRaw = getValue(u, "project.available_units", "available_units");
          const toInt = (v: unknown): string => {
            if (v == null || v === "") return "—";
            const n = typeof v === "number" ? v : Number(v);
            if (Number.isNaN(n)) return "—";
            return String(Math.round(n));
          };
          const total = toInt(totalRaw);
          const avail = toInt(availRaw);
          const val = `${total}/${avail}`;
          return escapeCsvCell(val);
        }
        const catalogKey = ACCESSOR_TO_CATALOG_KEY[accessor] ?? ACCESSOR_TO_CATALOG_KEY[key] ?? key;
        const raw = getValue(u, accessor, catalogKey);
        const formatted = formatValue(raw, { display_format: df ?? data_type, key });
        return escapeCsvCell(String(formatted ?? ""));
      })
      .join(",");
  });
  const csv = "\uFEFF" + [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jednotky-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
    averageLocalDiff1000: null,
    averageLocalDiff2000: null,
  };
}

const FILTER_ENUM_LABELS: Record<string, Record<string, string>> = {
  availability: {
    available: "Dostupná",
    unseen: "Neviděná",
    not_seen: "Neviděná",
    reserved: "Rezervovaná",
    sold: "Prodaná",
    unavailable: "Nedostupná",
  },
  category: {
    flat: "Byt",
    house: "Dům",
  },
};

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
  const [polygon, setPolygon] = useState<string | null>(() =>
    parseSearchParams(new URLSearchParams(searchParams?.toString() ?? "")).polygon ?? null
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
    averageLocalDiff1000: number | null;
    averageLocalDiff2000: number | null;
  } | null>(null);

  const [recomputingLocalDiffs, setRecomputingLocalDiffs] = useState(false);
  const [recomputingWalkability, setRecomputingWalkability] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [walkPrefsOpen, setWalkPrefsOpen] = useState(false);
  const [walkPrefs, setWalkPrefs] = useState<WalkabilityPreferences>(() => getDefaultPreferences());
  const [personalizedModeEnabled, setPersonalizedModeEnabled] = useState<boolean>(false);
  const [personalizedScores, setPersonalizedScores] = useState<
    Map<number, { score: number | null; label: string | null }>
  >(new Map());

  const [editingCell, setEditingCell] = useState<{ externalId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string | boolean>("");
  const [savingOverride, setSavingOverride] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(() => searchParams?.get("include_archived") === "1");
  const [showOnlyPendingApi, setShowOnlyPendingApi] = useState(() => searchParams?.get("pending_api") === "1");
  const [actionsOpen, setActionsOpen] = useState(false);

  const rowClickTimeoutRef = useRef<number | null>(null);
  /** Po kliknutí na řazení/paginaci zabráníme efektu „sync z URL“ přepsat state starou URL (router.replace je async). */
  const skipSyncSortPaginationRef = useRef(false);

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
    const defaults: ColumnConfig[] = cols
      .filter((col) => !HIDDEN_TABLE_COLUMN_KEYS.has(col.key))
      .map((col) => ({
        key: col.key,
        label: col.label,
        visible: !isDefaultHiddenColumn(col),
      }));
    // Přidáme syntetické sloupce pro jednotky.
    defaults.push(
      {
        key: "financing_scheme",
        label: "Financování",
        visible: true,
      },
      {
        key: "units_overview",
        label: "Počet jednotek",
        visible: true,
      }
    );
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
      // Pokud starší konfigurace neznala syntetické sloupce, přidáme je.
      if (!merged.some((c) => c.key === "financing_scheme")) {
        merged.push({ key: "financing_scheme", label: "Financování", visible: true });
      }
      if (!merged.some((c) => c.key === "units_overview")) {
        merged.push({ key: "units_overview", label: "Počet jednotek", visible: true });
      }
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
    (f: CurrentFilters, lim: number, off: number, sb: string, sd: string, poly: string | null) => {
      const p = toSearchParams(f, lim, off, sb, sd, poly ?? undefined);
      if (includeArchived) p.set("include_archived", "1");
      if (showOnlyPendingApi) p.set("pending_api", "1");
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, includeArchived, showOnlyPendingApi]
  );

  useEffect(() => {
    const parsed = parseSearchParams(new URLSearchParams(searchParams?.toString() ?? ""));
    setFilters(parsed.filters);
    setPolygon(parsed.polygon ?? null);
    setIncludeArchived(searchParams?.get("include_archived") === "1");
    setShowOnlyPendingApi(searchParams?.get("pending_api") === "1");
    if (skipSyncSortPaginationRef.current) {
      skipSyncSortPaginationRef.current = false;
    } else {
      setLimit(parsed.limit);
      setOffset(parsed.offset);
      setSortBy(parsed.sortBy);
      setSortDir(parsed.sortDir);
    }
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
  // Backend očekává ride_to_center / public_transport_to_center pro speciální řazení (coalesce s projektem)
  const backendSortBy =
    validSortBy === "ride_to_center_min"
      ? "ride_to_center"
      : validSortBy === "public_transport_to_center_min"
        ? "public_transport_to_center"
        : validSortBy;

  useEffect(() => {
    setLoading(true);
    setError(null);
    let qs = buildUnitsQuery(
      filters,
      supportedFilterKeys,
      { limit: safeLimit, offset },
      { sort_by: backendSortBy, sort_dir: validSortDir }
    );
    // Pokud máme v URL polygon, pošleme jeho obdélníkový obal na backend
    // jako min/max latitude/longitude, aby se filtr aplikoval globálně před paginačním limitem.
    if (polygon && polygon.trim() !== "") {
      const points = decodePolygon(polygon);
      const bounds = getPolygonBounds(points);
      if (bounds) {
        const { minLat, maxLat, minLng, maxLng } = bounds;
        qs += `&min_latitude=${minLat}&max_latitude=${maxLat}&min_longitude=${minLng}&max_longitude=${maxLng}`;
      }
    }
    if (includeArchived) {
      qs += "&include_archived=1";
    }
    fetch(`${API_BASE}/units?${qs}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: UnitsListResponse) => {
        let items = data.items ?? [];
        if (showOnlyPendingApi) {
          items = items.filter((u: Unit) => (u.pending_api_updates?.length ?? 0) > 0);
        }
        setUnits(items);
        setTotal(data.total ?? items.length);
        setSummaryOverride({
          total: data.total ?? items.length,
          averagePrice: data.average_price_czk ?? null,
          averagePricePerM2: data.average_price_per_m2_czk ?? null,
          availableCount: data.available_count ?? 0,
          averageLocalDiff1000: data.average_local_price_diff_1000m ?? null,
          averageLocalDiff2000: data.average_local_price_diff_2000m ?? null,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [filters, safeLimit, offset, backendSortBy, validSortDir, supportedFilterKeys, polygon, refetchTrigger]);

  const openDrawer = useCallback(() => {
    setCurrentFilters({ ...filters });
    setDrawerOpen(true);
  }, [filters]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const onReset = useCallback(() => setCurrentFilters({}), []);

  const onResetAll = useCallback(() => {
    skipSyncSortPaginationRef.current = true;
    setFilters({});
    setCurrentFilters({});
    syncToUrl({}, limit, 0, sortBy, sortDir, polygon);
    setOffset(0);
    closeDrawer();
  }, [limit, sortBy, sortDir, polygon, syncToUrl, closeDrawer]);

  const onChange = useCallback((key: string, value: number | number[] | string[] | boolean | undefined) => {
    setCurrentFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyFilters = useCallback(
    (next: CurrentFilters) => {
      skipSyncSortPaginationRef.current = true;
      setFilters(next);
      setOffset(0);
      syncToUrl(next, limit, 0, sortBy, sortDir, polygon);
    },
    [limit, sortBy, sortDir, polygon, syncToUrl]
  );

  const setPage = useCallback(
    (newOffset: number) => {
      skipSyncSortPaginationRef.current = true;
      setOffset(newOffset);
      syncToUrl(filters, limit, newOffset, sortBy, sortDir, polygon);
    },
    [filters, limit, sortBy, sortDir, polygon, syncToUrl]
  );

  const onApply = useCallback(() => {
    applyFilters(currentFilters);
    closeDrawer();
    if (process.env.NODE_ENV === "development") {
      const qs = buildUnitsQuery(
        currentFilters,
        supportedFilterKeys,
        { limit: safeLimit, offset: 0 },
        { sort_by: backendSortBy, sort_dir: validSortDir }
      );
      // eslint-disable-next-line no-console
      console.log("GET /units fetch URL:", `${API_BASE}/units?${qs}`);
    }
  }, [
    currentFilters,
    supportedFilterKeys,
    safeLimit,
    backendSortBy,
    validSortDir,
    applyFilters,
    closeDrawer,
  ]);

  const setLimitAndSort = useCallback(
    (opts: { limit?: number; sortBy?: string; sortDir?: string }) => {
      const newLimit = opts.limit ?? limit;
      const newSortBy = opts.sortBy ?? sortBy;
      const newSortDir = opts.sortDir ?? sortDir;
      skipSyncSortPaginationRef.current = true;
      if (opts.limit !== undefined) setLimit(newLimit);
      if (opts.sortBy !== undefined) setSortBy(newSortBy);
      if (opts.sortDir !== undefined) setSortDir(newSortDir);
      setOffset(0);
      syncToUrl(filters, newLimit, 0, newSortBy, newSortDir, polygon);
    },
    [filters, limit, sortBy, sortDir, polygon, syncToUrl]
  );

  // Mapování backend názvů na klíče v SORT_BY_OPTIONS – do stavu vždy ukládáme klíč z OPTIONS,
  // aby validSortBy nepadl na DEFAULT_SORT_BY a backendSortBy se správně zmapoval.
  const BACKEND_TO_SORT_BY_STATE: Record<string, string> = {
    ride_to_center: "ride_to_center_min",
    public_transport_to_center: "public_transport_to_center_min",
  };

  const handleSortHeaderClick = useCallback(
    (columnKey: string, accessor: string, _dataType: string) => {
      const backendField = BACKEND_SORT_FIELDS.find(
        (f) => accessor === f || accessor.endsWith(`.${f}`)
      );
      if (!backendField) {
        return;
      }
      let sortByForState: string =
        SORT_BY_OPTIONS.includes(columnKey as (typeof SORT_BY_OPTIONS)[number]) ? columnKey : backendField;
      sortByForState = BACKEND_TO_SORT_BY_STATE[sortByForState] ?? sortByForState;
      if (sortByForState !== sortBy) {
        setLimitAndSort({ sortBy: sortByForState, sortDir: "asc" });
      } else {
        setLimitAndSort({ sortDir: sortDir === "asc" ? "desc" : "asc" });
      }
    },
    [sortBy, sortDir, setLimitAndSort]
  );

  const summary = summaryOverride ?? computeSummaryFromUnits(units, total);
  // Hlavní metrika vs. trh: používáme průměr pro 1 km.
  const averageLocalDiff = summary.averageLocalDiff1000;
  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = total === 0 ? 0 : Math.min(offset + safeLimit, total);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const resolveProjectId = useCallback((u: Unit): number | null => {
    const pid =
      (u as any).project_id ??
      (u.project as any)?.id ??
      (u.data as any)?.project_id;
    if (pid == null) return null;
    const n = Number(pid);
    return Number.isNaN(n) ? null : n;
  }, []);

  const getUnitDefaultWalkabilityScore = useCallback((u: Unit): number | null => {
    const d: any = (u as any).data ?? {};
    const candidates = [
      (u as any).walkability_score,
      d.walkability_score,
      d.project_walkability_score,
    ];
    for (const c of candidates) {
      if (typeof c === "number") return c;
      if (c != null) {
        const n = Number(c);
        if (!Number.isNaN(n)) return n;
      }
    }
    return null;
  }, []);

  // Client-side sorting override for personalized walkability on current page.
  const sortedUnits = useMemo(() => {
    if (!personalizedModeEnabled) return units;
    if (units.length === 0) return units;

    const getDefaultLabel = (u: Unit): string => {
      const d: any = (u as any).data ?? {};
      const candidates = [
        (u as any).walkability_label,
        d.walkability_label,
        d.project_walkability_label,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim() !== "") return c;
      }
      return "";
    };

    if (sortBy === "walkability_score") {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...units].sort((a, b) => {
        const pa = (() => {
          const pid = resolveProjectId(a);
          return pid != null ? personalizedScores.get(pid)?.score : null;
        })();
        const pb = (() => {
          const pid = resolveProjectId(b);
          return pid != null ? personalizedScores.get(pid)?.score : null;
        })();
        const va = pa != null ? pa : getUnitDefaultWalkabilityScore(a) ?? Number.NEGATIVE_INFINITY;
        const vb = pb != null ? pb : getUnitDefaultWalkabilityScore(b) ?? Number.NEGATIVE_INFINITY;
        return (va - vb) * dir;
      });
    }

    if (sortBy === "walkability_label") {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...units].sort((a, b) => {
        const la = (() => {
          const pid = resolveProjectId(a);
          return (
            (pid != null ? personalizedScores.get(pid)?.label : null) ??
            getDefaultLabel(a)
          );
        })();
        const lb = (() => {
          const pid = resolveProjectId(b);
          return (
            (pid != null ? personalizedScores.get(pid)?.label : null) ??
            getDefaultLabel(b)
          );
        })();
        return la.localeCompare(lb, "cs") * dir;
      });
    }

    return units;
  }, [units, sortBy, sortDir, personalizedScores, resolveProjectId, getUnitDefaultWalkabilityScore]);

  const visibleColumns = useMemo(() => {
    if (serverColumns && serverColumns.length > 0) {
      const byKey = new Map(serverColumns.map((c) => [c.key, c]));
      // Syntetické sloupce: „Financování“ (a/b/c) a „Počet jednotek“ (celkem/dostupné)
      if (!byKey.has("financing_scheme")) {
        byKey.set("financing_scheme", {
          key: "financing_scheme",
          label: "Financování",
          entity: "unit",
          data_type: "text",
          display_format: "text",
          sortable: false,
          filterable: false,
          accessor: "financing_scheme",
        } as ColumnDef);
      }
      if (!byKey.has("units_overview")) {
        byKey.set("units_overview", {
          key: "units_overview",
          label: "Počet jednotek",
          entity: "project",
          data_type: "text",
          display_format: "text",
          sortable: false,
          filterable: false,
          accessor: "units_overview",
        } as ColumnDef);
      }
      const baseConfig =
        columnsConfig ??
        serverColumns.map((c) => ({
          key: c.key,
          label: c.label,
          visible: !isDefaultHiddenColumn(c),
        }));
      // Preferované pořadí viditelných sloupců (ostatní jdou za nimi ve výchozím pořadí).
      const ORDER_PREFERENCE: string[] = [
        // Projekt a developer – podporujeme staré i nové klíče
        "project.name", // Projekt (nový key)
        "project", // Projekt (původní key v columnsConfig z localStorage)
        "project.developer", // Developer (nový key)
        "developer", // Developer (původní key v columnsConfig)
        "layout", // Dispozice
        "floor_area_m2", // Plocha (jen v units přepsaná label)
        "exterior_area_m2", // Venek
        "price_czk", // Cena
        "price_per_m2_czk", // Cena m2
        "ride_to_center_min", // Autem do centra
        "public_transport_to_center_min", // MHD do centra
        "project.municipality", // Obec (municipality)
        "local_price_diff_2000m", // Odchylka 2 km
        "financing_scheme", // Financování
        "units_overview", // Počet jednotek (celkem/dostupné)
        "renovation", // Rekonstrukce
      ];
      const orderIndex = (key: string): number => {
        const idx = ORDER_PREFERENCE.indexOf(key);
        return idx === -1 ? ORDER_PREFERENCE.length : idx;
      };
      const orderedConfig = [...baseConfig].sort((a, b) => orderIndex(a.key) - orderIndex(b.key));
      const backendSortable = new Set<string>(BACKEND_SORT_FIELDS);
      let cols = orderedConfig
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
            label: (() => {
              const baseLabel = c.label || col.label;
              if (col.key === "project.total_units" || col.key === "total_units") {
                return "Celkový počet jednotek";
              }
              if (col.key === "floor_area_m2") return "Plocha";
              if (col.key === "local_price_diff_1000m") return "Odchylka 1 km";
              if (col.key === "local_price_diff_2000m") return "Odchylka 2 km";
              return baseLabel;
            })(),
            accessor,
            align,
            // Povolit klikatelné řazení jen pro sloupce, které umí backend sortovat globálně.
            sortable: backendSortable.has(accessor) || backendSortable.has(col.key),
          };
          return withAlign;
        })
        .filter(Boolean) as Array<ColumnDef & { align: "left" | "right" }>;
      return cols;
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
    (e: React.MouseEvent<Element>, u: Unit) => {
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

      // Pouze levé (0) a střední (1) tlačítko – pravé a ostatní ignorujeme
      if (e.defaultPrevented || e.shiftKey || e.altKey || (e.button !== 0 && e.button !== 1)) return;

      const externalId = getExternalIdForRow(u);
      if (!externalId) {
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.warn("[UnitsPage] Missing externalId for row", u);
        }
        return;
      }

      // Ctrl/Cmd + klik nebo střední tlačítko → otevřít detail v novém tabu
      if (e.metaKey || e.ctrlKey || e.button === 1) {
        window.open(`/units/${encodeURIComponent(externalId)}`, "_blank", "noopener,noreferrer");
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

  const [recomputingLocationMetrics, setRecomputingLocationMetrics] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Personalized scores for projects visible in current units page
  useEffect(() => {
    if (!personalizedModeEnabled || units.length === 0) {
      setPersonalizedScores(new Map());
      return;
    }
    const projectIds = Array.from(
      new Set(
        units
          .map((u) => {
            const pid =
              (u as any).project_id ??
              (u.project as any)?.id ??
              (u.data as any)?.project_id;
            return pid != null ? Number(pid) : undefined;
          })
          .filter((id): id is number => typeof id === "number" && !Number.isNaN(id)),
      ),
    );
    if (projectIds.length === 0) {
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
            project_ids: projectIds,
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
        // silent fallback
      }
    })();
    return () => controller.abort();
  }, [personalizedModeEnabled, walkPrefs, units]);

  useEffect(() => {
    if (!personalizedModeEnabled || units.length === 0) {
      setPersonalizedScores(new Map());
      return;
    }
    const projectIds = Array.from(
      new Set(
        units
          .map((u) => {
            const pid = (u.project as any)?.id ?? (u.data as any)?.project_id;
            return pid != null ? Number(pid) : undefined;
          })
          .filter((id): id is number => typeof id === "number" && !Number.isNaN(id)),
      ),
    );
    if (projectIds.length === 0) {
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
            project_ids: projectIds,
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
        // silent fallback
      }
    })();
    return () => controller.abort();
  }, [personalizedModeEnabled, walkPrefs, units]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div>
      <div className="flex flex-col gap-5 pt-4 pb-10">
        <div className="flex items-baseline justify-between gap-4 px-1">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Jednotky</h2>
          {total > 0 && <span className="text-sm text-slate-400">{total} záznamů</span>}
        </div>
        <SummaryBar
          total={summary.total}
          averagePricePerM2={summary.averagePricePerM2}
          averagePrice={summary.averagePrice}
          availableCount={summary.availableCount}
          averageLocalDiff={averageLocalDiff}
        />
        <div className="glass-header flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
          <button
            type="button"
            onClick={openDrawer}
            className="glass-pill border border-transparent px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white/90 shrink-0"
            title={countActiveFilters(filters) > 0 ? `Aktivní filtry: ${countActiveFilters(filters)}` : undefined}
          >
            Filtry
            {countActiveFilters(filters) > 0 && (
              <span className="ml-1 rounded-full bg-slate-900/80 px-2 py-[1px] text-[10px] font-semibold text-white">
                {countActiveFilters(filters)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setWalkPrefsOpen(true)}
            className="glass-pill border border-transparent px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white/90 shrink-0"
          >
            Preference lokality
          </button>
          {personalizedModeEnabled && (
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
                  onClick={() => {
                    const next = !showOnlyPendingApi;
                    setShowOnlyPendingApi(next);
                    const p = new URLSearchParams(searchParams?.toString() ?? "");
                    if (next) p.set("pending_api", "1");
                    else p.delete("pending_api");
                    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
                >
                  {showOnlyPendingApi ? "Všechny jednotky" : "Jen návrhy z API"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !includeArchived;
                    setIncludeArchived(next);
                    const p = new URLSearchParams(searchParams?.toString() ?? "");
                    if (next) p.set("include_archived", "1");
                    else p.delete("include_archived");
                    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
                >
                  {includeArchived ? "Skrýt archiv" : "Zobrazit archiv"}
                </button>
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
                      setError(null);
                    } catch (e) {
                      setError("Přepočet mikro-lokality selhal.");
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
                      setError("Nepodařilo se obnovit walkability data.");
                    } finally {
                      setRecomputingWalkability(false);
                    }
                  }}
                  disabled={recomputingWalkability || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {recomputingWalkability ? "Stahování walkability…" : "Stáhnout walkability POI + přepočítat projekty"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setRecomputingLocalDiffs(true);
                      const res = await fetch(`${API_BASE}/units/local-price-diffs/recompute`, { method: "POST" });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      const qs = buildUnitsQuery(filters, supportedFilterKeys, { limit: safeLimit, offset }, { sort_by: backendSortBy, sort_dir: validSortDir });
                      const data: UnitsListResponse = await fetch(`${API_BASE}/units?${qs}`).then((r) => r.json());
                      setUnits(data.items ?? []);
                      setTotal(data.total ?? 0);
                      setSummaryOverride({
                        total: data.total ?? 0,
                        averagePrice: data.average_price_czk ?? null,
                        averagePricePerM2: data.average_price_per_m2_czk ?? null,
                        availableCount: data.available_count ?? 0,
                        averageLocalDiff1000: data.average_local_price_diff_1000m ?? null,
                        averageLocalDiff2000: data.average_local_price_diff_2000m ?? null,
                      });
                    } catch (e) {
                      console.error("Recompute local diffs failed", e);
                      setError("Přepočet lokální ceny selhal.");
                    } finally {
                      setRecomputingLocalDiffs(false);
                      setActionsOpen(false);
                    }
                  }}
                  disabled={recomputingLocalDiffs || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {recomputingLocalDiffs ? "Přepočítávám…" : "Přepočítat"}
                </button>
              </div>
            )}
          </div>
        </div>
        {countActiveFilters(filters) > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
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
                    const str = String(raw);
                    if (k === "layout") {
                      const f = formatLayout(str);
                      return f !== "—" ? f : str;
                    }
                    return FILTER_ENUM_LABELS[k]?.[str] ?? str;
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
              const percentRangeBases = new Set(["payment_contract", "payment_construction", "payment_occupancy"]);
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
                const asPercent = percentRangeBases.has(base);
                const dispMin = min != null && !Number.isNaN(min) ? (asPercent ? min * 100 : min) : null;
                const dispMax = max != null && !Number.isNaN(max) ? (asPercent ? max * 100 : max) : null;
                const suf = asPercent ? " %" : "";
                let value = "";
                if (dispMin != null) {
                  value += `od ${dispMin}${suf}`;
                }
                if (dispMax != null) {
                  value += value ? ` do ${dispMax}${suf}` : `do ${dispMax}${suf}`;
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
                      delete (next as any)[ck];
                    }
                    applyFilters(next);
                  }}
                  className="group inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white"
                >
                  <span>{b.label}</span>
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-200 text-[9px] text-slate-600 group-hover:bg-slate-400 group-hover:text-white">
                    ×
                  </span>
                </button>
              ));
            })()}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}
        <div className="data-grid-wrapper">
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
                  onClick={() => downloadUnitsCsv(units, visibleColumns)}
                  disabled={units.length === 0 || loading}
                  title="Export aktuální stránky do CSV (UTF-8)"
                  className="ml-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs sm:text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Export CSV
                </button>
              </div>
            </div>
            {/* Mobilní karty – zobrazí se jen na malých obrazovkách */}
            <div className="block space-y-2 md:hidden">
              {!loading && units.length > 0 &&
                units.map((u: Unit) => {
                  const extId = getExternalIdForRow(u) ?? u.external_id;
                  const projectName = (u.project as { name?: string } | undefined)?.name ?? "—";
                  const price = u.price_czk != null ? formatValue(u.price_czk, { display_format: "currency", key: "price_czk" }) : "—";
                  const layoutRaw = getValue(u, "layout", "layout");
                  const layoutStr =
                    layoutRaw != null && /^layout_(\d+)(?:_(\d+))?$/i.test(String(layoutRaw))
                      ? String(layoutRaw).replace(/^layout_(\d+)(?:_(\d+))?$/i, (_m: string, a: string, b?: string) => (b ? `${a},${b} kk` : `${a} kk`))
                      : "—";
                  const area = u.floor_area_m2 != null ? `${u.floor_area_m2.toFixed(1)} m²` : "—";
                  return (
                    <div
                      key={u.external_id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleRowClick(e, u)}
                      onKeyDown={(e) => e.key === "Enter" && handleRowClick(e as unknown as React.MouseEvent, u)}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:bg-slate-50"
                    >
                      <div className="font-mono text-sm font-medium text-slate-900">{extId}</div>
                      <div className="text-xs text-slate-600">{projectName}</div>
                      <div className="mt-2 flex justify-between text-sm">
                        <span className="text-slate-700">{layoutStr}</span>
                        <span className="font-medium text-slate-900">{price}</span>
                      </div>
                      <div className="text-xs text-slate-500">{area}</div>
                    </div>
                  );
                })}
            </div>
            <div className="data-grid-scroll hidden md:block">
              <table className="data-grid-table">
                <thead className="bg-slate-50/90">
                  <tr>
                    {visibleColumns.map(
                      ({ key, label, accessor, align, sortable, data_type }, columnIndex) => {
                        const backendField = BACKEND_SORT_FIELDS.find(
                          (f) => accessor === f || accessor.endsWith(`.${f}`)
                        );
                        const isBackendSortable = !!backendField;
                        // Aktivní řazení: sortBy je buď key sloupce (např. public_transport_to_center_min) nebo backendField
                        const isActive = isBackendSortable && (sortBy === key || sortBy === backendField);
                        const isStickyFirst = columnIndex === 0;
                        const canSort = isBackendSortable;
                        return (
                          <th
                            key={key}
                            onClick={canSort ? () => handleSortHeaderClick(key, accessor, data_type) : undefined}
                            className={`sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 ${
                              align === "right" ? "text-right" : "text-left"
                            } ${
                              canSort ? "cursor-pointer select-none hover:bg-gray-100" : ""
                            } ${isActive ? "bg-gray-100" : ""} ${
                              isStickyFirst ? "left-0 z-20" : ""
                            }`}
                          >
                            <span
                              className={key === "project" || key === "project.name" ? "inline-flex max-w-[10rem] items-center gap-1 truncate" : "inline-flex items-center gap-1"}
                              title={
                                personalizedModeEnabled &&
                                (key === "walkability_score" || key === "walkability_label") &&
                                isActive
                                  ? "Řazeno podle personalizovaného skóre (aktuální stránka)"
                                  : key === "project" || key === "project.name"
                                    ? String(label)
                                    : undefined
                              }
                            >
                              <span className={key === "project" || key === "project.name" ? "truncate" : undefined}>
                                {label}
                              </span>
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
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading && units.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColumns.length}
                        className="px-3 py-8 text-center text-xs sm:text-sm text-slate-600"
                      >
                        Načítání…
                      </td>
                    </tr>
                  ) : !loading && units.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColumns.length}
                        className="px-3 py-8 text-center text-sm text-slate-600"
                      >
                        Žádné jednotky nevyhovují zadaným filtrům. Zkuste upravit filtry.
                      </td>
                    </tr>
                  ) : (
                    sortedUnits.map((u: Unit) => {
                      const statusRaw =
                        (u as any).availability_status ??
                        (u as any).availability ??
                        (u as any).data?.availability ??
                        (u as any).data?.availability_status;
                      const status =
                        typeof statusRaw === "string" ? statusRaw.trim().toLowerCase() : "";
                      const isSold = status === "sold";
                      const isReserved = status === "reserved";
                      const baseRowClass = "cursor-pointer hover:bg-slate-50";
                      const stripeClass =
                        isSold || isReserved ? "" : "odd:bg-white even:bg-gray-50/60";
                      const statusClass = "";
                      const rowStyle =
                        isSold || isReserved
                          ? {
                              backgroundColor: isSold ? "#fecaca" : "#fef3c7", // tailwind-ish: red-200 / amber-100
                            }
                          : undefined;
                      return (
                        <tr
                          key={u.external_id}
                          className={`${baseRowClass} ${stripeClass} ${statusClass}`}
                          style={rowStyle}
                          onClick={(e) => handleRowClick(e, u)}
                        >
                          {visibleColumns.map(
                          ({ key, accessor, align, data_type, display_format: df }, columnIndex) => {
                            let raw: unknown;
                            let formatted: string | number | null | undefined;
                            if (key === "financing_scheme") {
                              const aRaw = getValue(u, "payment_contract", "payment_contract");
                              const bRaw = getValue(u, "payment_construction", "payment_construction");
                              const cRaw = getValue(u, "payment_occupancy", "payment_occupancy");
                              const toPct = (v: unknown): string => {
                                if (v == null || v === "") return "—";
                                const n = typeof v === "number" ? v : Number(v);
                                if (Number.isNaN(n)) return "—";
                                return `${Math.round(n <= 1 ? n * 100 : n)}`;
                              };
                              const a = toPct(aRaw);
                              const b = toPct(bRaw);
                              const c = toPct(cRaw);
                              raw = `${a}/${b}/${c}`;
                              formatted = raw as string;
                            } else if (key === "units_overview") {
                              const totalRaw = getValue(u, "project.total_units", "total_units");
                              const availRaw = getValue(u, "project.available_units", "available_units");
                              const toInt = (v: unknown): number | null => {
                                if (v == null || v === "") return null;
                                const n = typeof v === "number" ? v : Number(v);
                                if (Number.isNaN(n)) return null;
                                return Math.round(n);
                              };
                              const total = toInt(totalRaw);
                              const avail = toInt(availRaw);
                              raw = { total, avail };
                              formatted = null;
                            } else {
                              const catalogKey = ACCESSOR_TO_CATALOG_KEY[accessor] ?? ACCESSOR_TO_CATALOG_KEY[key] ?? key;
                              raw = getValue(u, accessor, catalogKey);
                              formatted = formatValue(raw, {
                                display_format: df ?? data_type,
                                key,
                              });
                              if (key === "walkability_score" && personalizedModeEnabled) {
                                const pid = resolveProjectId(u);
                                if (pid != null) {
                                  const override = personalizedScores.get(pid);
                                  if (override && override.score != null) {
                                    const main = Math.round(override.score);
                                    const base = getUnitDefaultWalkabilityScore(u);
                                    const delta =
                                      base != null && !Number.isNaN(base)
                                        ? main - Math.round(base)
                                        : null;
                                    formatted = (
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
                                }
                              }
                              if (key === "walkability_label" && personalizedModeEnabled) {
                                const pid =
                                  ((u as any).project_id ??
                                  (u.project as any)?.id ??
                                  (u.data as any)?.project_id) as number | undefined;
                                if (pid != null) {
                                  const override = personalizedScores.get(pid);
                                  if (override && override.label) {
                                    formatted = `${override.label} (dle preferencí)`;
                                  }
                                }
                              }
                            }
                            const isAvailableCol = key === "available";
                            const isStickyFirst = columnIndex === 0;
                            const isLocalDiffCol =
                              key === "local_price_diff_1000m" ||
                              key === "local_price_diff_2000m";
                            let localDiffClass = "";
                            if (isLocalDiffCol) {
                              const n =
                                typeof raw === "number"
                                  ? raw
                                  : raw != null
                                  ? Number(raw)
                                  : Number.NaN;
                              if (!Number.isNaN(n)) {
                                const abs = Math.abs(n);
                                const sign = n > 0 ? "+" : n < 0 ? "−" : "";
                                formatted = `${sign}${abs.toFixed(1)} %`;
                                if (n > 0) localDiffClass = "text-red-600 font-semibold";
                                else if (n < 0) localDiffClass = "text-green-600 font-semibold";
                              }
                            }
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
                                } ${
                                  localDiffClass
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
                                {key === "project" || key === "project.name" ? (
                                  <span className="group relative inline-block max-w-[8rem] cursor-default">
                                    <span className="block truncate text-slate-900">
                                      {formatted ?? "—"}
                                    </span>
                                    {formatted != null && formatted !== "" && (
                                      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 w-max -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                                        {String(formatted)}
                                      </span>
                                    )}
                                  </span>
                                ) : key === "units_overview" ? (
                                  (() => {
                                    const val = raw as { total: number | null; avail: number | null } | null;
                                    const total = val?.total;
                                    const avail = val?.avail;
                                    const totalStr = total == null ? "—" : String(total);
                                    const availStr = avail == null ? "—" : String(avail);
                                    return (
                                      <span className="inline-flex items-center gap-1">
                                        <span>{totalStr}</span>
                                        <span>/</span>
                                        <span className="font-semibold text-emerald-600">{availStr}</span>
                                      </span>
                                    );
                                  })()
                                ) : isEditing && data_type === "bool" ? (
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
                                ) : isLocalDiffCol && formatted !== null && formatted !== undefined ? (
                                  <button
                                    type="button"
                                    data-no-row-nav
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const extId = getExternalIdForRow(u);
                                      if (!extId) return;
                                      let radius = 1000;
                                      if (key === "local_price_diff_2000m") radius = 2000;
                                      const url = `/units/debug-compare?external_id=${encodeURIComponent(
                                        extId
                                      )}&radius_m=${radius}`;
                                      window.open(url, "_blank", "noopener,noreferrer");
                                    }}
                                    className={`underline decoration-dotted underline-offset-2 ${localDiffClass}`}
                                  >
                                    {formatted}
                                  </button>
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

      <FiltersDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        filterGroups={filterGroups}
        currentFilters={currentFilters}
        onChange={onChange}
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
          // fetching handled by useEffect
        }}
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
          setWalkPrefsOpen(false);
          // scores refresh via effect
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
                        ? cols
                            .filter((col) => !HIDDEN_TABLE_COLUMN_KEYS.has(col.key))
                            .map((col) => ({
                              key: col.key,
                              label: col.label,
                              visible: !isDefaultHiddenColumn(col),
                            }))
                        : FALLBACK_TABLE_COLUMNS.map((c) => ({
                            key: c.key,
                            label: c.label,
                            visible: true,
                          }));
                      // Po resetu znovu přidáme syntetické sloupce,
                      // aby nezmizely z konfigurace.
                      if (!defaults.some((c) => c.key === "financing_scheme")) {
                        defaults.push({
                          key: "financing_scheme",
                          label: "Financování",
                          visible: true,
                        });
                      }
                      if (!defaults.some((c) => c.key === "units_overview")) {
                        defaults.push({
                          key: "units_overview",
                          label: "Počet jednotek",
                          visible: true,
                        });
                      }
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

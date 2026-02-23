/**
 * Types and helpers for GET /filters response and building GET /units query.
 * Filter state keys are catalog keys: for range use key_min/key_max, for enum/boolean use key.
 */

export type FilterSpec = {
  key: string;
  alias: string;
  entity: string;
  display_format: string;
  type: "range" | "enum" | "enum_search" | "boolean";
  unit: string | null;
  decimals: number | null;
  backend_supported: boolean;
  options: (string | boolean)[];
};

export type FilterGroup = { name: string; filters: FilterSpec[] };

export type FiltersResponse = { groups: FilterGroup[] };

export type CurrentFilters = Record<
  string,
  number | number[] | string[] | boolean | undefined
>;

/** Catalog key -> API param names for GET /units. Only keys that backend actually supports. */
const CATALOG_TO_UNITS_API: Record<
  string,
  { min?: string; max?: string; list?: string; bool?: string }
> = {
  price: { min: "min_price", max: "max_price" },
  price_per_sm: { min: "min_price_per_m2", max: "max_price_per_m2" },
  floor_area: { min: "min_floor_area", max: "max_floor_area" },
  layout: { list: "layout" },
  district: { list: "district" },
  municipality: { list: "municipality" },
  heating: { list: "heating" },
  windows: { list: "windows" },
  available: { bool: "available" },
  permit_regular: { bool: "permit_regular" },
  renovation: { bool: "renovation" },
  air_conditioning: { bool: "air_conditioning" },
  cooling_ceilings: { bool: "cooling_ceilings" },
  smart_home: { bool: "smart_home" },
};

/**
 * Build query params for GET /units from currentFilters.
 * Only includes params for filters that have backend_supported=true and are in CATALOG_TO_UNITS_API.
 */
export function filtersToUnitsParams(
  filters: CurrentFilters,
  supportedKeys: Set<string>
): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const key of supportedKeys) {
    const api = CATALOG_TO_UNITS_API[key];
    if (!api) continue;
    if (api.min != null) {
      const vMin = filters[`${key}_min`] as number | undefined;
      const vMax = filters[`${key}_max`] as number | undefined;
      if (vMin !== undefined && vMin !== null && !Number.isNaN(vMin)) out[api.min] = vMin;
      if (vMax !== undefined && vMax !== null && !Number.isNaN(vMax)) out[api.max!] = vMax;
    }
    if (api.list != null) {
      const v = filters[key] as string[] | undefined;
      if (Array.isArray(v) && v.length > 0) out[api.list] = v;
    }
    if (api.bool != null) {
      const v = filters[key] as boolean | undefined;
      if (v === true) out[api.bool] = "true";
      if (v === false) out[api.bool] = "false";
    }
  }
  return out;
}

export function countActiveFilters(f: CurrentFilters): number {
  const rangeBases = new Set<string>();
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (k.endsWith("_min")) rangeBases.add(k.replace(/_min$/, ""));
    else if (k.endsWith("_max")) rangeBases.add(k.replace(/_max$/, ""));
    else {
      if (typeof v === "boolean") n++;
      else if (Array.isArray(v) && v.length > 0) n++;
      else if (typeof v === "number" && !Number.isNaN(v)) n++;
    }
  }
  for (const base of rangeBases) {
    const min = f[`${base}_min`];
    const max = f[`${base}_max`];
    if ((min !== undefined && min !== null && !Number.isNaN(min)) || (max !== undefined && max !== null && !Number.isNaN(max))) n++;
  }
  return n;
}

/** Flatten groups to key -> spec for table headers and formatting */
export function flattenFilterSpecsByKey(groups: FilterGroup[]): Map<string, FilterSpec> {
  const m = new Map<string, FilterSpec>();
  for (const g of groups) {
    for (const f of g.filters) m.set(f.key, f);
  }
  return m;
}

/** API param name -> catalog key + suffix for reading URL/searchParams */
const API_TO_CATALOG: Record<string, { key: string; suffix?: string }> = {
  min_price: { key: "price", suffix: "min" },
  max_price: { key: "price", suffix: "max" },
  min_price_per_m2: { key: "price_per_sm", suffix: "min" },
  max_price_per_m2: { key: "price_per_sm", suffix: "max" },
  min_floor_area: { key: "floor_area", suffix: "min" },
  max_floor_area: { key: "floor_area", suffix: "max" },
  layout: { key: "layout" },
  district: { key: "district" },
  municipality: { key: "municipality" },
  heating: { key: "heating" },
  windows: { key: "windows" },
  available: { key: "available" },
  permit_regular: { key: "permit_regular" },
  renovation: { key: "renovation" },
  air_conditioning: { key: "air_conditioning" },
  cooling_ceilings: { key: "cooling_ceilings" },
  smart_home: { key: "smart_home" },
};

/** List-type API params (multi-select, repeated in URL) */
const API_LIST_PARAMS = new Set([
  "layout",
  "district",
  "municipality",
  "heating",
  "windows",
]);

export function parseFiltersFromSearchParams(params: URLSearchParams): CurrentFilters {
  const filters: CurrentFilters = {};
  const num = (k: string) => {
    const v = params.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const arr = (k: string) => {
    const v = params.get(k);
    if (v === null || v === "") return undefined;
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const bool = (k: string) => {
    const v = params.get(k);
    if (v === "true") return true;
    if (v === "false") return false;
    return undefined;
  };
  for (const [apiKey, { key, suffix }] of Object.entries(API_TO_CATALOG)) {
    if (suffix) {
      const v = num(apiKey);
      if (v !== undefined) filters[`${key}_${suffix}`] = v;
    } else if (API_LIST_PARAMS.has(apiKey)) {
      const v = arr(apiKey);
      if (v?.length) filters[key] = v;
    } else {
      const v = bool(apiKey);
      if (v !== undefined) filters[key] = v;
    }
  }
  return filters;
}

export function filtersToSearchParams(filters: CurrentFilters): URLSearchParams {
  const params = new URLSearchParams();
  const fp = filtersToUnitsParams(filters, new Set(Object.keys(CATALOG_TO_UNITS_API)));
  for (const [apiKey, value] of Object.entries(fp)) {
    if (Array.isArray(value) && value.length) params.set(apiKey, value.join(","));
    else if (value !== undefined && value !== null && String(value).trim() !== "") params.set(apiKey, String(value));
  }
  return params;
}

export type UnitsQueryPagination = { limit: number; offset: number };
export type UnitsQuerySorting = { sort_by: string; sort_dir: string };

/**
 * Build the query string for GET /units from filters, pagination, and sorting.
 * Uses API param names (min_price, available, district=…&district=…, etc.).
 */
export function buildUnitsQuery(
  filters: CurrentFilters,
  supportedKeys: Set<string>,
  pagination: UnitsQueryPagination,
  sorting: UnitsQuerySorting
): string {
  const params = new URLSearchParams();
  params.set("limit", String(pagination.limit));
  params.set("offset", String(Math.max(0, pagination.offset)));
  params.set("sort_by", sorting.sort_by);
  params.set("sort_dir", sorting.sort_dir);
  const fp = filtersToUnitsParams(filters, supportedKeys);
  for (const [key, value] of Object.entries(fp)) {
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

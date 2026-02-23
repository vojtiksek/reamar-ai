"use client";

import { FiltersDrawer } from "@/components/FiltersDrawer";
import { SummaryBar } from "@/components/SummaryBar";
import {
  buildUnitsQuery,
  countActiveFilters,
  type CurrentFilters,
  type FilterGroup,
  type FiltersResponse,
  filtersToSearchParams,
  parseFiltersFromSearchParams,
} from "@/lib/filters";
import { formatAreaM2, formatCurrencyCzk, formatLayout, formatMinutes, formatPercent } from "@/lib/format";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:8001";

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

  // Booleans
  if (typeof value === "boolean") return value ? "ANO" : "NE";

  const num = Number(value);
  const isNumber = !Number.isNaN(num);

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
} {
  const limitParam = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = ROWS_PER_PAGE_OPTIONS.includes(limitParam as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? limitParam
    : DEFAULT_LIMIT;
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  const sortBy = params.get("sort_by") ?? "avg_price_per_m2_czk";
  const sortDir = (params.get("sort_dir") === "desc" ? "desc" : "asc") as "asc" | "desc";
  const filters = parseFiltersFromSearchParams(params);
  return { filters, limit, offset, sortBy, sortDir };
}

function toProjectsSearchParams(
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
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortDir);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncToUrl = useCallback(
    (f: CurrentFilters, lim: number, off: number, sb: string, sd: string) => {
      const p = toProjectsSearchParams(f, lim, off, sb, sd);
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
    setSortDir(parsed.sortDir);
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

    const defaults: ProjectColumnConfig[] = columns.map((col) => ({
      key: col.key,
      label: col.label,
      // visibleByDefault: catalog or no kind = visible; computed = hidden
      visible: col.kind !== "computed",
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

  // Fetch projects list (paginated, server-side sort)
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("limit", String(safeLimit));
    params.set("offset", String(Math.max(0, offset)));
    params.set("sort_by", sortBy);
    params.set("sort_dir", sortDir);
    const qs = params.toString();
    fetch(`${API_BASE}/projects/overview?${qs}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((json: ProjectsOverviewResponse | ProjectItem[]) => {
        const rows: ProjectItem[] = Array.isArray(json)
          ? (json as ProjectItem[])
          : (((json as any)?.items ?? (json as any)?.itimes) as ProjectItem[] | undefined) ?? [];
        const totalValue =
          json && typeof (json as any)?.total === "number" ? (json as any).total : rows.length;
        setProjects(rows);
        setTotal(totalValue);
        // eslint-disable-next-line no-console
        console.log("[projects] overview rows:", rows.length, rows[0]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chyba"))
      .finally(() => setLoading(false));
  }, [safeLimit, offset, sortBy, sortDir]);

  // Temporary debug: ensure accessors match overview row keys
  useEffect(() => {
    if (projects.length > 0 || columns.length > 0) {
      // eslint-disable-next-line no-console
      console.log("[projects] first row keys:", Object.keys(projects[0] || {}));
      // eslint-disable-next-line no-console
      console.log("[projects] first col accessor:", columns[0]?.accessor ?? columns[0]?.key);
    }
  }, [projects, columns]);

  const visibleColumns = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    if (!columnsConfig) {
      return columns.length > 0 ? columns.slice(0, 8) : [];
    }
    const visible = columnsConfig
      .filter((c) => c.visible)
      .map((c) => byKey.get(c.key))
      .filter((c): c is ProjectColumnDef => !!c);
    if (visible.length === 0 && columns.length > 0) return columns.slice(0, 8);
    return visible;
  }, [columns, columnsConfig]);

  const setPage = useCallback(
    (newOffset: number) => {
      setOffset(newOffset);
    },
    []
  );

  const handleSortHeaderClick = useCallback(
    (key: string) => {
      if (key !== sortBy) {
        setSortBy(key);
        setSortDir("asc");
      } else {
        setSortDir(sortDir === "asc" ? "desc" : "asc");
      }
      setOffset(0);
    },
    [sortBy, sortDir]
  );

  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = total === 0 ? 0 : Math.min(offset + safeLimit, total);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">Reamar</h1>
          <div className="flex items-center rounded-lg border border-gray-300 p-0.5">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Jednotky
            </button>
            <button
              type="button"
              className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white"
            >
              Projekty
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-500">Řádků</span>
            <select
              value={safeLimit}
              onChange={(e) => {
                const next = Number(e.target.value);
                setLimit(next);
                setOffset(0);
              }}
              disabled={loading}
              className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
            >
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
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
                Strana {total === 0 ? 0 : Math.floor(offset / safeLimit) + 1} z{" "}
                {total === 0 ? 0 : Math.ceil(total / safeLimit) || 1}
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
                  {visibleColumns.map((col) => {
                    const flatKey = getProjectColumnKey(col);
                    const isActive = flatKey === sortBy;
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSortHeaderClick(flatKey)}
                        className={`border-b border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer select-none hover:bg-gray-200 ${
                          isActive ? "bg-gray-200 font-semibold" : ""
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {isActive && (
                            <span className="text-gray-600">{sortDir === "asc" ? "▲" : "▼"}</span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {loading && projects.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length || 1}
                      className="px-3 py-8 text-center text-sm text-gray-500"
                    >
                      Načítání…
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length || 1}
                      className="px-3 py-8 text-center text-sm text-gray-500"
                    >
                      Žádné projekty k zobrazení.
                    </td>
                  </tr>
                ) : (
                  projects.map((p) => (
                    <tr key={p.id as number} className="hover:bg-gray-50">
                      {visibleColumns.map((col) => {
                        const raw = getProjectCellValue(p, col);
                        const formatted = formatProjectValue(raw, col);
                        const alignRight =
                          col.data_type === "number" ||
                          (col.unit != null &&
                            (col.unit.includes("Kč") || col.unit.includes("m²") || col.unit === "min")) ||
                          col.key.endsWith("_min");
                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-2 text-sm ${
                              alignRight ? "text-right" : "text-left"
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
    </div>
  );
}


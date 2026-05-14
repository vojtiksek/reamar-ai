"use client";

import React from "react";

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
import {
  clearExplorerFilters,
  clearExplorerPolygon,
  loadExplorerFilters,
  loadExplorerPolygon,
  saveExplorerFilters,
  saveExplorerPolygon,
  urlHasAnyFilterParam,
} from "@/lib/explorerFilters";
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
// Bumped to v2 in 2026-05-14 when the default column set shrank — brokers
// with saved v1 columns (developer / municipality / total_units / etc.)
// otherwise kept the wide layout that caused horizontal scroll.
const PROJECTS_COLUMNS_STORAGE_KEY = "projects_columns_v2";
const DEFAULT_VISIBLE_COLUMNS = 10;

/** Keys shown by default for users without saved column preferences.
 *
 * Tight column set so the table fits on one screen — broker complained
 * about horizontal scrolling. Anything that's already in the multi-line
 * PROJEKT cell (developer, municipality, total/available units, completion
 * date, near-source + noise badges) is no longer duplicated as its own
 * column. Broker can still re-add any hidden column via the columns
 * config drawer. */
const DEFAULT_VISIBLE_KEYS: string[] = [
  "name",
  "avg_price_czk",
  "avg_price_per_m2_czk",
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
): React.JSX.Element {
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

/** Inline badges for the project name cell — mirror what /cases/X/recommendations
 * shows in ProjectGroupCard. Uses only fields that /projects already returns
 * (noise_label + distance_to_railway_m/tram_tracks_m/primary_road_m). POI
 * counts and MHD-stop distances are not currently in the projects payload —
 * if we want those here, the backend response needs to grow. */
function NoiseChip({ label }: { label?: string | null }) {
  if (!label) return null;
  const lower = label.toLowerCase();
  const cls = lower.includes("nízk")
    ? "bg-emerald-100 text-emerald-700"
    : lower.includes("vyšš") || lower.includes("vysok")
    ? "bg-rose-100 text-rose-700"
    : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>Hluk: {lower}</span>;
}

function NearSourceChips({
  railM, tramM, roadM,
}: { railM?: number | null; tramM?: number | null; roadM?: number | null }) {
  const items: { label: string; tip: string }[] = [];
  if (tramM != null && tramM <= 150) items.push({ label: "Tram", tip: `Tramvajová trať ${Math.round(tramM)} m` });
  if (railM != null && railM <= 200) items.push({ label: "Vlak", tip: `Železnice ${Math.round(railM)} m` });
  if (roadM != null && roadM <= 80) items.push({ label: "Silnice", tip: `Hlavní silnice ${Math.round(roadM)} m` });
  if (!items.length) return null;
  return (
    <>
      {items.map((it) => (
        <span
          key={it.label}
          title={it.tip}
          className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-medium text-amber-700"
        >
          {it.label}
        </span>
      ))}
    </>
  );
}

/** MHD-stop badges: render only when the project is within a sensible
 * walking distance of a stop (metro ≤600m, tram ≤300m, bus ≤200m, train
 * ≤1km). Mirrors the thresholds used in /cases/X/recommendations. */
const MHD_CONFIG = [
  { key: "metro", field: "distance_to_metro_station_m", threshold: 600, emoji: "🚇", label: "Metro" },
  { key: "tram",  field: "distance_to_tram_stop_m",     threshold: 300, emoji: "🚋", label: "Tramvaj" },
  { key: "bus",   field: "distance_to_bus_stop_m",      threshold: 200, emoji: "🚌", label: "Bus" },
  { key: "train", field: "distance_to_train_station_m", threshold: 1000, emoji: "🚆", label: "Vlak" },
] as const;

function MhdChips({ p }: { p: ProjectItem }) {
  const visible = MHD_CONFIG
    .map((cfg) => {
      const v = num(p[cfg.field]);
      return v != null && v <= cfg.threshold ? { ...cfg, distance: v } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!visible.length) return null;
  return (
    <>
      {visible.map((it) => (
        <span
          key={it.key}
          title={`${it.label} ${Math.round(it.distance)} m`}
          className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
        >
          {it.emoji} {Math.round(it.distance)} m
        </span>
      ))}
    </>
  );
}

/** POI counts within 500 m. Always renders (regardless of broker prefs) so
 * the explorer view shows what's nearby — broker can immediately judge
 * neighbourhood density. Hidden when all counts are zero/null. */
const POI_CONFIG = [
  { field: "count_supermarket_500m", emoji: "🛒", label: "Obchod" },
  { field: "count_park_500m",        emoji: "🌳", label: "Parky" },
  { field: "count_cafe_500m",        emoji: "☕", label: "Kavárny" },
  { field: "count_restaurant_500m",  emoji: "🍽️", label: "Restaurace" },
  { field: "count_kindergarten_500m", emoji: "👶", label: "Školka" },
  { field: "count_primary_school_500m", emoji: "🎓", label: "ZŠ" },
  { field: "count_fitness_500m",     emoji: "🏋️", label: "Fitness" },
  { field: "count_playground_500m",  emoji: "🛝", label: "Hřiště" },
] as const;

function PoiChips({ p }: { p: ProjectItem }) {
  const visible = POI_CONFIG
    .map((cfg) => {
      const v = num(p[cfg.field]);
      return v != null && v > 0 ? { ...cfg, count: v } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!visible.length) return null;
  return (
    <>
      {visible.slice(0, 6).map((it) => (
        <span
          key={it.field}
          title={`${it.label}: ${Math.round(it.count)} do 500 m`}
          className="rounded-full bg-teal-50 border border-teal-200 px-1 py-0.5 text-[10px] font-medium text-teal-700"
        >
          {it.emoji} {Math.round(it.count)}
        </span>
      ))}
    </>
  );
}

/** Multi-line content for the PROJEKT cell. Replaces what used to be a
 * single-line "project name" rendering — bumps density without forcing
 * horizontal scroll. Sortable column header for `name` still works,
 * because the data drives the sort, not the rendering. */
function ProjectCellContent({ p }: { p: ProjectItem }) {
  const asStr = (v: unknown): string => (v == null ? "" : String(v));
  const developer = asStr(p["developer"]);
  const municipality = asStr(p["municipality"] ?? p["district"] ?? p["cadastral_area_iga"]);
  const totalUnits = p["total_units"] ?? p["units_total"];
  const availableUnits = p["available_units"] ?? p["units_available"];
  const completion = asStr(p["completion_date"]);
  const noise = (p["noise_label"] as string | null | undefined) ?? null;
  const rail = num(p["distance_to_railway_m"]);
  const tram = num(p["distance_to_tram_tracks_m"]);
  const road = num(p["distance_to_primary_road_m"]);
  const projectName = asStr(p["project"] ?? p["name"]);
  const secondaryLine = [developer, municipality].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate font-semibold text-slate-900">{projectName || "—"}</span>
        <NoiseChip label={noise} />
        <NearSourceChips railM={rail} tramM={tram} roadM={road} />
      </div>
      {secondaryLine && (
        <div className="truncate text-[11px] text-slate-500">{secondaryLine}</div>
      )}
      {/* Transport + POI chips inline — these come from the now-extended
          /projects response. Each helper returns null when there's nothing
          worth rendering, so this stays tight on exurban projects. */}
      <div className="flex flex-wrap gap-1">
        <MhdChips p={p} />
        <PoiChips p={p} />
      </div>
      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-400">
        {totalUnits != null && (
          <span>
            {asStr(totalUnits)} jednotek
            {availableUnits != null ? ` · ${asStr(availableUnits)} dostupných` : ""}
          </span>
        )}
        {completion && <span>Dokončení: {completion}</span>}
      </div>
    </div>
  );
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

// PriceDiffBadge is local — mirrors the one in recommendations/page.tsx so
// brokers see the same colour coding (green = below market, red = above)
// across recs and explorer expansion.
function PriceDiffBadge({ pct }: { pct?: number | null }) {
  if (pct == null) return <span className="text-slate-300">—</span>;
  if (pct <= -5)
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{Math.round(pct)} %</span>;
  if (pct >= 5)
    return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">+{Math.round(pct)} %</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">±trh</span>;
}

type ExpandedUnitRow = {
  external_id: string;
  unit_name: string | null;
  layout: string | null;
  floor: number | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  availability_status: string | null;
  local_price_diff_1000m: number | null;
};

/** Content of the per-project expansion row. Replaces the old Standardy /
 * Lokalita / Amenities cards — those move to the project detail page.
 *
 * Renders a compact list of available units in this project, like the
 * inner table inside ProjectGroupCard in /cases/X/recommendations. The
 * broker can scan unit prices and layouts without leaving the explorer. */
function ExpandedProjectUnits({
  cache,
  projectUrl,
  projectId,
}: {
  cache: { state: "loading" | "error" | "ready"; units?: ExpandedUnitRow[] } | undefined;
  projectUrl: string | null;
  projectId: number;
}) {
  if (!cache || cache.state === "loading") {
    return <div className="py-4 text-center text-xs text-slate-500">Načítám jednotky…</div>;
  }
  if (cache.state === "error") {
    return <div className="py-4 text-center text-xs text-rose-600">Chyba při načítání jednotek.</div>;
  }
  const units = cache.units ?? [];
  // Group by layout, sort each group by price ASC, keep top 5 per group.
  // Broker scans "cheapest in each disposition" — much more useful than a
  // flat list of every available unit when a project has 50+.
  const TOP_PER_LAYOUT = 5;
  const groupsByLayout = new Map<string, ExpandedUnitRow[]>();
  for (const u of units) {
    const key = u.layout ?? "unknown";
    const arr = groupsByLayout.get(key) ?? [];
    arr.push(u);
    groupsByLayout.set(key, arr);
  }
  // Natural sort: 1kk → 1.5kk → 2kk → 3kk → 4kk → 5kk → unknown.
  const layoutOrder = (lay: string): number => {
    const m = /^layout_(\d+)(?:_(\d+))?$/.exec(lay);
    if (!m) return 99;
    const whole = parseInt(m[1], 10);
    const frac = m[2] ? parseInt(m[2], 10) / 10 : 0;
    return whole + frac;
  };
  const layouts = Array.from(groupsByLayout.keys()).sort((a, b) => layoutOrder(a) - layoutOrder(b));
  const groupedTop: { layout: string; rows: ExpandedUnitRow[]; totalInLayout: number }[] = layouts.map((lay) => {
    const all = groupsByLayout.get(lay) ?? [];
    const sorted = [...all].sort((a, b) => (a.price_czk ?? Infinity) - (b.price_czk ?? Infinity));
    return { layout: lay, rows: sorted.slice(0, TOP_PER_LAYOUT), totalInLayout: all.length };
  });
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Dostupné jednotky · {units.length}
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
            (top {TOP_PER_LAYOUT} nejlevnějších v každé dispozici)
          </span>
        </h4>
        <div className="flex gap-2">
          <a
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
            data-no-row-nav
            onClick={(e) => e.stopPropagation()}
          >
            Detail projektu
          </a>
          {projectUrl ? (
            <a
              href={projectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              data-no-row-nav
              onClick={(e) => e.stopPropagation()}
            >
              ↗ Web projektu
            </a>
          ) : null}
        </div>
      </div>
      {units.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-500">
          Žádné aktuálně dostupné jednotky.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-right">Plocha</th>
                <th className="px-3 py-2 text-right">Venek</th>
                <th className="px-3 py-2 text-center">Patro</th>
                <th className="px-3 py-2 text-right">Cena</th>
                <th className="px-3 py-2 text-right">Kč/m²</th>
              </tr>
            </thead>
            <tbody>
              {groupedTop.map(({ layout, rows, totalInLayout }) => {
                const hiddenInGroup = totalInLayout - rows.length;
                return (
                  <React.Fragment key={layout}>
                    <tr className="bg-slate-50/50">
                      <td colSpan={5} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {formatLayout(layout)}
                        <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                          · {totalInLayout} {totalInLayout === 1 ? "dostupná" : totalInLayout < 5 ? "dostupné" : "dostupných"}
                        </span>
                      </td>
                    </tr>
                    {rows.map((u) => (
                      <tr key={u.external_id} className="border-t border-slate-100 text-sm hover:bg-slate-50/80">
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {u.floor_area_m2 != null ? `${Math.round(u.floor_area_m2)} m²` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {u.exterior_area_m2 != null && u.exterior_area_m2 > 0 ? `${Math.round(u.exterior_area_m2)} m²` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-slate-700">{u.floor ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                          {u.price_czk != null ? formatCurrencyCzk(u.price_czk) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 text-xs">
                          {u.price_per_m2_czk != null ? `${Math.round(u.price_per_m2_czk / 1000)}k Kč` : "—"}
                        </td>
                      </tr>
                    ))}
                    {hiddenInGroup > 0 && (
                      <tr>
                        <td colSpan={5} className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
                          + {hiddenInGroup} dalších {formatLayout(layout)} v projektu
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatAvailability(status: string | null): string {
  if (!status) return "—";
  const s = status.toLowerCase();
  if (s === "available") return "Dostupná";
  if (s === "reserved") return "Rezervovaná";
  if (s === "unseen") return "Neviděná";
  if (s === "sold") return "Prodaná";
  return status;
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

  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const rowClickTimeoutRef = useRef<number | null>(null);

  // Per-project units cache. Populated lazily when the broker expands a
  // project row — we fetch the available units for that project and show a
  // compact table in the expansion, mirroring the broker's mental model
  // from /cases/X/recommendations where each project groups its own units.
  type ExpandedUnit = {
    external_id: string;
    unit_name: string | null;
    layout: string | null;
    floor: number | null;
    floor_area_m2: number | null;
    exterior_area_m2: number | null;
    price_czk: number | null;
    price_per_m2_czk: number | null;
    availability_status: string | null;
    local_price_diff_1000m: number | null;
  };
  type UnitsCache = Record<number, { state: "loading" | "error" | "ready"; units?: ExpandedUnit[] }>;
  const [projectUnitsCache, setProjectUnitsCache] = useState<UnitsCache>({});

  const fetchProjectUnits = useCallback(async (projectId: number, projectName: string) => {
    setProjectUnitsCache((prev) => ({ ...prev, [projectId]: { state: "loading" } }));
    try {
      const params = new URLSearchParams();
      params.set("project", projectName);
      // Multi-value availability filter — URLSearchParams.set replaces, so we
      // need append for repeated query params (FastAPI parses list[str] from
      // ?availability=A&availability=B). Bug fixed 2026-05-14: previously
      // .set overwrote each prior value, leaving only "reserved" → 0 results
      // for projects with no reserved units.
      for (const status of ["available", "unseen", "reserved"]) {
        params.append("availability", status);
      }
      params.set("limit", "500");
      params.set("with_count", "false");
      // Compact 'map' mode keeps the payload small but still includes
      // layout/area/price; we extract local_price_diff_1000m from `data`.
      const res = await fetch(`${API_BASE}/units?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      type RawUnit = {
        external_id: string;
        unit_name: string | null;
        layout: string | null;
        price_czk: number | null;
        price_per_m2_czk: number | null;
        floor_area_m2: number | null;
        availability_status?: string | null;
        data?: Record<string, unknown>;
      };
      const json = await res.json() as { items?: RawUnit[] };
      const units: ExpandedUnit[] = (json.items ?? []).map((u) => {
        const d = u.data ?? {};
        const num = (v: unknown): number | null =>
          typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
        return {
          external_id: u.external_id,
          unit_name: u.unit_name ?? null,
          layout: u.layout ?? null,
          floor: num(d.floor),
          floor_area_m2: u.floor_area_m2,
          exterior_area_m2: num(d.exterior_area_m2),
          price_czk: u.price_czk,
          price_per_m2_czk: u.price_per_m2_czk,
          availability_status: u.availability_status ?? (typeof d.availability_status === "string" ? d.availability_status : null),
          local_price_diff_1000m: num(d.local_price_diff_1000m),
        };
      });
      // Sort by layout then area for consistent display
      units.sort((a, b) => {
        const la = (a.layout ?? "").localeCompare(b.layout ?? "");
        if (la !== 0) return la;
        return (a.floor_area_m2 ?? 0) - (b.floor_area_m2 ?? 0);
      });
      setProjectUnitsCache((prev) => ({ ...prev, [projectId]: { state: "ready", units } }));
    } catch {
      setProjectUnitsCache((prev) => ({ ...prev, [projectId]: { state: "error" } }));
    }
  }, []);

  // Auto-fetch when a row is newly expanded (cached, so re-expanding doesn't refire).
  useEffect(() => {
    if (expandedRowId == null) return;
    const cached = projectUnitsCache[expandedRowId];
    if (cached != null) return;
    const project = sortedProjects.find((p) => (p.id as number) === expandedRowId);
    if (!project) return;
    const name = String(project["project"] ?? project["name"] ?? "");
    if (!name) return;
    void fetchProjectUnits(expandedRowId, name);
    // sortedProjects is a derived value — depending on it here is fine, the
    // effect re-runs if the expanded id changes (which is the actual signal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedRowId]);

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

  // Explorer filter persistence: jednorázová hydratace z localStorage,
  // pokud URL žádné filtry/polygon nenese. Sdílené s /explorer/units a /explorer/map.
  // `hydrated` je state (ne ref) kvůli druhému renderu, který uvolní save-effect
  // až po dokončení hydratace — jinak by save-effect z initialního renderu
  // přepsal storage výchozími hodnotami.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    const raw = new URLSearchParams(searchParams?.toString() ?? "");

    const urlHasFilter = urlHasAnyFilterParam(raw);
    const urlHasPoly = (raw.get("poly") ?? "").trim() !== "";

    const storedFilters = urlHasFilter ? null : loadExplorerFilters();
    const storedPoly = urlHasPoly ? null : loadExplorerPolygon();

    const hydrateFilters = storedFilters && Object.keys(storedFilters).length > 0 ? storedFilters : null;
    const hydratePoly = storedPoly && storedPoly.trim() !== "" ? storedPoly : null;

    if (hydrateFilters !== null || hydratePoly !== null) {
      const nextFilters = hydrateFilters ?? filters;
      const nextPoly = hydratePoly ?? polygon;
      if (hydrateFilters !== null) setFilters(nextFilters);
      if (hydratePoly !== null) setPolygon(nextPoly);
      syncToUrl(nextFilters, initial.limit, 0, initial.sortBy, initial.sortDir, nextPoly);
      setOffset(0);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ulož každou změnu filtrů/polygonu do storage až po dokončení hydratace
  // (ostatní Explorer záložky je pak načtou).
  useEffect(() => {
    if (!hydrated) return;
    saveExplorerFilters(filters);
  }, [filters, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveExplorerPolygon(polygon);
  }, [polygon, hydrated]);

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


  // Fetch column definitions + the admin-curated allow-list (configured via
  // /admin/sloupce). When the allow-list is non-empty, the picker only shows
  // those keys. Empty list = no whitelist → all catalog columns are exposed.
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/columns?view=projects`).then((res) =>
        res.ok ? (res.json() as Promise<ProjectColumnDef[]>) : Promise.reject(new Error(res.statusText))
      ),
      fetch(`${API_BASE}/admin/columns-allowed?view=projects`)
        .then((res) => (res.ok ? res.json() : Promise.resolve({ keys: [] })))
        .then((data: { keys?: string[] }) =>
          Array.isArray(data?.keys) ? data.keys : []
        )
        .catch(() => [] as string[]),
    ])
      .then(([cols, allowedKeys]) => {
        const list = Array.isArray(cols) ? cols : [];
        if (allowedKeys.length === 0) {
          setColumns(list);
          return;
        }
        const allowed = new Set(allowedKeys);
        // Always keep `name` so the projects view stays usable even if admin
        // accidentally removes it.
        allowed.add("name");
        setColumns(list.filter((c) => allowed.has(c.key)));
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

  // Fetch projects list (paginated, server-side sort, with filters).
  // - Debounce 250 ms: filtry se mění na keystroke/slider a bez debounce
  //   by každá změna vystřelila request, který blokuje main thread při parse.
  // - Data fetch jede s `with_count=false` (komentář v backendu: COUNT je
  //   nejpomalejší část /projects). Total fetchujeme PARALELNĚ druhým requestem
  //   s `with_count=true&limit=1`, takže server time = MAX(data, count) místo
  //   SUM. Tabulka se vyrenderuje jakmile dorazí data; "Strana 1 z N" se
  //   doplní když přijde count.
  useEffect(() => {
    const dataController = new AbortController();
    const countController = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      const baseQs = buildUnitsQuery(
        filters,
        supportedFilterKeys,
        { limit: safeLimit, offset },
        { sort_by: effectiveSortBy, sort_dir: sortDir }
      );
      let geoSuffix = "";
      if (polygon && polygon.trim() !== "") {
        const points = decodePolygon(polygon);
        const bounds = getPolygonBounds(points);
        if (bounds) {
          const { minLat, maxLat, minLng, maxLng } = bounds;
          geoSuffix = `&min_latitude=${minLat}&max_latitude=${maxLat}&min_longitude=${minLng}&max_longitude=${maxLng}`;
        }
      }
      const dataQs = `${baseQs}${geoSuffix}&with_count=false`;
      const countQs = buildUnitsQuery(
        filters,
        supportedFilterKeys,
        { limit: 1, offset: 0 },
        { sort_by: effectiveSortBy, sort_dir: sortDir }
      ) + geoSuffix + "&with_count=true";

      // Hlavní data fetch — render tabulky závisí jen na něm.
      fetch(`${API_BASE}/projects?${dataQs}`, { signal: dataController.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
        .then((json: ProjectsOverviewResponse | ProjectItem[]) => {
          const rows: ProjectItem[] = Array.isArray(json)
            ? (json as ProjectItem[])
            : (((json as any)?.items ?? (json as any)?.itimes) as ProjectItem[] | undefined) ?? [];
          setProjects(rows);
          // Než dojde count, ukaž alespoň počet aktuálně načtených — UI nezobrazí "?".
          setTotal((prev) => (prev > 0 ? prev : rows.length));
        })
        .catch((e) => { if (e?.name !== "AbortError") setError(e instanceof Error ? e.message : "Chyba"); })
        .finally(() => setLoading(false));

      // Paralelní count — neblokuje render, neukazuje vlastní spinner.
      fetch(`${API_BASE}/projects?${countQs}`, { signal: countController.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
        .then((json: any) => {
          if (typeof json?.total === "number") setTotal(json.total);
        })
        .catch(() => { /* count je best-effort — bez něj UI funguje dál */ });
    }, 250);
    return () => {
      clearTimeout(timer);
      dataController.abort();
      countController.abort();
    };
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
          const errText = await res.text();
          // eslint-disable-next-line no-console
          console.error("Failed to save project override", errText);
          setError(`Nepodařilo se uložit změnu: ${errText.slice(0, 100)}`);
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
        setError(`Nepodařilo se uložit změnu: ${e instanceof Error ? e.message : "Neznámá chyba"}`);
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
    clearExplorerFilters();
    clearExplorerPolygon();
    setFilters({});
    setPolygon(null);
    onReset();
    syncToUrl({}, limit, 0, sortBy, sortDir, null);
    setOffset(0);
    closeDrawer();
  }, [limit, sortBy, sortDir, syncToUrl, closeDrawer, onReset]);

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

      // Double-click: navigate to detail page
      if (e.detail > 1) {
        if (rowClickTimeoutRef.current !== null) {
          window.clearTimeout(rowClickTimeoutRef.current);
          rowClickTimeoutRef.current = null;
        }
        router.push(`/explorer/projects/${projectId}`);
        return;
      }

      // Single click: toggle expanded row
      if (rowClickTimeoutRef.current !== null) {
        window.clearTimeout(rowClickTimeoutRef.current);
      }
      rowClickTimeoutRef.current = window.setTimeout(() => {
        rowClickTimeoutRef.current = null;
        setExpandedRowId((prev) => (prev === projectId ? null : projectId));
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
  const [importingBuiltMind, setImportingBuiltMind] = useState(false);
  const [importBuiltMindResult, setImportBuiltMindResult] = useState<string | null>(null);
  const [recomputingFloors, setRecomputingFloors] = useState(false);
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
                <button
                  type="button"
                  onClick={async () => {
                    setRecomputingFloors(true);
                    setActionsOpen(false);
                    try {
                      const res = await fetch(`${API_BASE}/admin/aggregates/recompute-floors`, { method: "POST" });
                      if (!res.ok) throw new Error(await res.text());
                      const data = await res.json();
                      alert(`Odvozený počet pater přepočítán.\nProjektů: ${data.processed}, s patry: ${data.with_derived_floors} (${data.elapsed_seconds}s)`);
                      setRefetchTrigger((t) => t + 1);
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Chyba při přepočtu pater");
                    } finally {
                      setRecomputingFloors(false);
                    }
                  }}
                  disabled={recomputingFloors || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {recomputingFloors ? "Přepočítávám patra…" : "Odvodit počet pater z jednotek"}
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  onClick={async () => {
                    setImportingBuiltMind(true);
                    setImportBuiltMindResult(null);
                    setActionsOpen(false);
                    try {
                      const res = await fetch(`${API_BASE}/admin/imports/builtmind/run`, { method: "POST" });
                      const data = await res.json() as Record<string, unknown>;
                      if (!res.ok || !data["ok"]) {
                        const detail = (data as { detail?: string })["detail"] ?? JSON.stringify(data);
                        setImportBuiltMindResult(`Chyba: ${detail}`);
                      } else {
                        setImportBuiltMindResult(
                          `Import dokončen: ${data["units_created"] as number} nových, ${data["units_updated"] as number} aktualizovaných jednotek. Projekty: +${data["projects_created"] as number} nových, ${data["projects_reused"] as number} existujících. (${data["elapsed_seconds"] as number}s)`
                        );
                        setRefetchTrigger((t) => t + 1);
                      }
                    } catch (e) {
                      setImportBuiltMindResult(`Chyba: ${e instanceof Error ? e.message : "Neznámá chyba"}`);
                    } finally {
                      setImportingBuiltMind(false);
                    }
                  }}
                  disabled={importingBuiltMind || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {importingBuiltMind ? "Importuji BuiltMind…" : "Import BuiltMind"}
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
        {importingBuiltMind && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">Importuji data z BuiltMind API… (může trvat 1–2 minuty)</div>
        )}
        {importBuiltMindResult && !importingBuiltMind && (
          <div className={`rounded-xl border px-4 py-2.5 text-sm flex items-center justify-between gap-3 ${importBuiltMindResult.startsWith("Chyba") ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            <span>{importBuiltMindResult}</span>
            <button type="button" onClick={() => setImportBuiltMindResult(null)} className="shrink-0 text-xs opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
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
                          onClick={() => router.push(`/explorer/projects/${g.project_id}`)}
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
                  sortedProjects.map((p) => {
                    const isExpanded = expandedRowId === (p.id as number);
                    return (
                    <React.Fragment key={p.id as number}>
                    <tr
                      className={`cursor-pointer transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-slate-50 ${isExpanded ? "!bg-slate-100" : ""}`}
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
                          // Project name column = multi-line cell with badges
                          // and secondary info (developer / municipality /
                          // unit counts / completion). The wide cell soaks up
                          // horizontal space so the rest of the table fits on
                          // a typical screen without scrolling.
                          if (fieldKey === "name" || fieldKey === "project") {
                            return <ProjectCellContent p={p} />;
                          }
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
                        // Project name cell is multi-line + carries inline
                        // badges, so give it a generous min-width on desktop.
                        // Other cells stay compact.
                        const isProjectCell = fieldKey === "name" || fieldKey === "project";
                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-1.5 text-xs sm:text-sm text-slate-900 ${
                              alignRight ? "text-right" : "text-left"
                            } ${isEditable ? "cursor-pointer" : ""} ${isStickyFirst ? "sticky left-0 z-10 bg-white" : ""} ${isProjectCell ? "min-w-[320px] max-w-[480px]" : ""}`}
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
                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={visibleColumns.length} className="p-0">
                          {/* Sticky to viewport-left so it doesn't scroll out
                              of view as the broker scans the wide table. Fixed
                              max-width keeps the inner 5-column table compact
                              (no horizontal scroll inside the expansion). The
                              `100vw - 16rem` accounts for the ~14rem sidebar
                              plus 2rem of page padding on typical desktop. */}
                          <div className="sticky left-0 z-10 max-w-[min(1100px,calc(100vw-16rem))] overflow-hidden border-b border-slate-200 bg-slate-50/90 px-5 py-4">
                            <ExpandedProjectUnits
                              cache={projectUnitsCache[p.id as number]}
                              projectUrl={typeof p["project_url"] === "string" ? p["project_url"] : null}
                              projectId={p.id as number}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
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



"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CurrentFilters, FilterGroup, FilterSpec } from "@/lib/filters";
import { API_BASE } from "@/lib/api";
import { buildUnitsQuery } from "@/lib/filters";

type Props = {
  open: boolean;
  onClose: () => void;
  filterGroups: FilterGroup[];
  currentFilters: CurrentFilters;
  onChange: (key: string, value: number | number[] | string[] | boolean | undefined) => void;
  onReset: () => void;
  onApply: () => void;
};

function formatFilterValueLabel(spec: FilterSpec, val: string): string {
  if (spec.key === "layout") {
    const m = /^layout_(\d+)(?:_(\d+))?$/.exec(String(val));
    if (m) {
      const whole = m[1];
      const frac = m[2];
      if (frac) return `${whole},${frac}kk`;
      return `${whole}kk`;
    }
  }
  return String(val);
}

function stepFromDecimals(decimals: number | null): string {
  if (decimals == null) return "any";
  const step = Math.pow(10, -(decimals ?? 0));
  return step < 1 ? String(step) : "1";
}

/** Čeština: 1 jednotka / 2–4 jednotky / 5+ jednotek. */
function pluralizeUnits(n: number): string {
  if (n === 1) return "jednotka";
  if (n >= 2 && n <= 4) return "jednotky";
  return "jednotek";
}

/** Formát čísla s tisíc-oddělovači pro input[type=text]. */
function formatGroupedNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("cs-CZ").replace(/\s/g, " ");
}

/** Parsuje uživatelský vstup jako číslo; povoluje mezery a nezlomitelné mezery. */
function parseGroupedNumber(s: string): number | undefined {
  const cleaned = s.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return undefined;
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

/** True když chceme pro daný display_format zobrazovat tisíc-oddělovače. */
function shouldGroupDigits(displayFormat: string): boolean {
  return (
    displayFormat === "currency" ||
    displayFormat === "currency_per_m2" ||
    displayFormat === "integer"
  );
}

const PERCENT_RANGE_KEYS = new Set(["payment_contract", "payment_construction", "payment_occupancy"]);
function isPercentRangeKey(key: string): boolean {
  return PERCENT_RANGE_KEYS.has(key);
}

// Range filters that show only MAX (no min input)
const MAX_ONLY_KEYS = new Set([
  "ride_to_center",
  "public_transport_to_center",
  // Technical distances
  "distance_to_primary_road_m",
  "distance_to_tram_tracks_m",
  "distance_to_railway_m",
  "distance_to_airport_m",
  // Walkability distances
  "distance_to_supermarket_m",
  "distance_to_pharmacy_m",
  "distance_to_restaurant_m",
  "distance_to_cafe_m",
  "distance_to_park_m",
  "distance_to_fitness_m",
  "distance_to_playground_m",
  "distance_to_kindergarten_m",
  "distance_to_primary_school_m",
  "distance_to_metro_station_m",
  "distance_to_tram_stop_m",
  "distance_to_bus_stop_m",
]);

// Range filters that show only MIN (no max input)
const MIN_ONLY_KEYS = new Set([
  "exterior_area",
  "balcony_area",
  "terrace_area",
  "garden_area",
  // Walkability scores
  "walkability_score",
  "walkability_daily_needs_score",
  "walkability_transport_score",
  "walkability_leisure_score",
  "walkability_family_score",
  // Walkability counts
  "count_restaurant_500m",
  "count_cafe_500m",
  "count_park_500m",
  "count_fitness_500m",
  "count_kindergarten_500m",
  "count_primary_school_500m",
  "count_playground_500m",
]);

// Boolean filters that show only "Ano" (no "Ne" button)
const ANO_ONLY_KEYS = new Set([
  "air_conditioning",
  "cooling_ceilings",
  "smart_home",
]);

// Filters hidden from UI.
//   - backend podpora zatím nepřipojena (windows, heating, ...)
//   - walkability sub-skóre a detailní vzdálenosti (šum v UI, broker je nepoužívá)
//   - distance_to_metro/tram/bus/train_m — nyní pod sekcí „Blízko dopravy" jako toggly
//   - lokalitní duplicity (municipality/city/...) — necháváme jen „district" (Okres)
//   - venkovní prostor — necháváme jen souhrnný exterior_area
const HIDDEN_FILTER_KEYS = new Set([
  // Backend není ještě plně připojen
  "recuperation",
  "cooling",
  "windows",
  "heating",
  "partition_walls",
  // Walkability sub-skóre a labely (držíme jen walkability_score)
  "walkability_label",
  "walkability_daily_needs_score",
  "walkability_transport_score",
  "walkability_leisure_score",
  "walkability_family_score",
  // Walkability distances — primárně nehledáme
  "distance_to_supermarket_m",
  "distance_to_pharmacy_m",
  "distance_to_restaurant_m",
  "distance_to_cafe_m",
  "distance_to_park_m",
  "distance_to_fitness_m",
  "distance_to_playground_m",
  "distance_to_kindergarten_m",
  "distance_to_primary_school_m",
  // Dopravní vzdálenosti — teď toggly „Blízko X" v samostatné sekci
  "distance_to_metro_station_m",
  "distance_to_tram_stop_m",
  "distance_to_bus_stop_m",
  "distance_to_train_station_m",
  // Mikrolokalita
  "micro_location_score",
  "micro_location_label",
  "noise_label",
  // Technické vzdálenosti
  "distance_to_primary_road_m",
  "distance_to_tram_tracks_m",
  "distance_to_railway_m",
  // Lokalita — necháváme jen „district" (Okres)
  "municipality",
  "city",
  "administrative_district_iga",
  "cadastral_area_iga",
  "region_iga",
  "municipal_district_iga",
  // Kvalita
  "overall_quality",
  // Venkovní prostory — necháváme jen souhrnný exterior_area
  "balcony_area",
  "terrace_area",
  "garden_area",
]);

// Přejmenování některých specifických filtrů tak, aby UI dávalo smysl
// (district = v ČR „Okres", exterior_area = rozumnější popis venkovních prostor).
const FILTER_LABEL_OVERRIDES: Record<string, string> = {
  district: "Okres",
  exterior_area: "Venkovní prostor",
};

// Klíče pro „Blízko dopravy" toggly (každý nastaví <key>_max = 500 m).
const NEARBY_TRANSPORT_TOGGLES: { key: string; label: string }[] = [
  { key: "distance_to_metro_station_m", label: "Blízko metra" },
  { key: "distance_to_tram_stop_m", label: "Blízko tramvaje" },
  { key: "distance_to_bus_stop_m", label: "Blízko autobusu" },
  { key: "distance_to_train_station_m", label: "Blízko vlaku" },
];
const NEARBY_TRANSPORT_RADIUS_M = 500;

// Groups that should be collapsed by default
const DEFAULT_COLLAPSED_GROUPS = new Set([
  "Financování",
  "Standardy",
  "Technické",
  "Walkability",
]);

function countActiveFiltersInGroup(group: FilterGroup, currentFilters: CurrentFilters): number {
  let count = 0;
  for (const spec of group.filters) {
    if (spec.type === "range") {
      if (currentFilters[`${spec.key}_min`] != null) count++;
      if (currentFilters[`${spec.key}_max`] != null) count++;
    } else {
      const val = currentFilters[spec.key];
      if (val != null && val !== undefined) {
        if (Array.isArray(val) && val.length === 0) continue;
        count++;
      }
    }
  }
  return count;
}

export function FiltersDrawer({
  open,
  onClose,
  filterGroups,
  currentFilters,
  onChange,
  onReset,
  onApply,
}: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(DEFAULT_COLLAPSED_GROUPS)
  );

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const resetGroup = (group: FilterGroup) => {
    for (const spec of group.filters) {
      if (spec.type === "range") {
        onChange(`${spec.key}_min`, undefined);
        onChange(`${spec.key}_max`, undefined);
      } else {
        onChange(spec.key, undefined);
      }
    }
  };

  // Async preview: kolik jednotek projde aktuálními filtry.
  const supportedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const g of filterGroups) {
      for (const f of g.filters) {
        if (f.backend_supported) s.add(f.key);
      }
    }
    // „Blízko dopravy" toggly nemají vlastní spec, ale backend je podporuje.
    s.add("distance_to_metro_station_m");
    s.add("distance_to_tram_stop_m");
    s.add("distance_to_bus_stop_m");
    s.add("distance_to_train_station_m");
    return s;
  }, [filterGroups]);

  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const qs = buildUnitsQuery(
      currentFilters,
      supportedKeys,
      { limit: 1, offset: 0 },
      { sort_by: "price_per_m2_czk", sort_dir: "asc" },
    );
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPreviewLoading(true);
    const t = setTimeout(() => {
      fetch(`${API_BASE}/units?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
        .then((data: { total?: number }) => {
          if (typeof data.total === "number") setPreviewCount(data.total);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setPreviewCount(null);
        })
        .finally(() => setPreviewLoading(false));
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, currentFilters, supportedKeys]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 transition-opacity" aria-hidden onClick={onClose} />
      <div
        className="fixed top-0 right-0 z-50 flex h-[100dvh] w-full max-w-[95vw] flex-col rounded-l-2xl border-l border-slate-200 bg-white shadow-2xl sm:max-w-[900px]"
        role="dialog"
        aria-label="Filtry"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Filtry</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Zavrit"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-3">
            <NearbyTransportSection
              currentFilters={currentFilters}
              onChange={onChange}
            />
            {filterGroups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.name);
              const activeCount = countActiveFiltersInGroup(group, currentFilters);
              return (
                <section
                  key={group.name}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm overflow-hidden"
                >
                  <div className="flex w-full items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.name)}
                      className="flex flex-1 items-center gap-3 text-left hover:opacity-80 transition-opacity"
                    >
                      <svg
                        className={`h-4 w-4 text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {group.name}
                      </h3>
                      {activeCount > 0 && (
                        <span className="inline-flex items-center justify-center rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white min-w-[18px]">
                          {activeCount}
                        </span>
                      )}
                      <div className="h-px flex-1 bg-slate-200" />
                    </button>
                    {activeCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          resetGroup(group);
                        }}
                        className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label={`Vymazat filtry v sekci ${group.name}`}
                        title="Vymazat filtry v této sekci"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="px-4 pb-3 pt-1">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {group.filters.filter((spec) => !HIDDEN_FILTER_KEYS.has(spec.key)).map((spec) => {
                          const aliasOverride = FILTER_LABEL_OVERRIDES[spec.key];
                          const effSpec = aliasOverride
                            ? { ...spec, alias: aliasOverride }
                            : spec;
                          return (
                            <FilterField key={spec.key} spec={effSpec} currentFilters={currentFilters} onChange={onChange} />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onReset}
              className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 sm:py-2.5"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onApply}
              className="flex-1 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 sm:py-2.5"
            >
              {previewLoading
                ? "Použít…"
                : previewCount != null
                  ? `Zobrazit ${previewCount.toLocaleString("cs-CZ")} ${pluralizeUnits(previewCount)}`
                  : "Použít"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function NearbyTransportSection({
  currentFilters,
  onChange,
}: {
  currentFilters: CurrentFilters;
  onChange: (key: string, value: number | number[] | string[] | boolean | undefined) => void;
}) {
  const activeCount = NEARBY_TRANSPORT_TOGGLES.reduce(
    (acc, { key }) => (currentFilters[`${key}_max`] != null ? acc + 1 : acc),
    0,
  );
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm overflow-hidden">
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Blízko dopravy
        </h3>
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white min-w-[18px]">
            {activeCount}
          </span>
        )}
        <span className="text-[11px] font-normal normal-case text-slate-500">
          do {NEARBY_TRANSPORT_RADIUS_M} m
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <div className="px-4 pb-3 pt-1">
        <div className="flex flex-wrap gap-2">
          {NEARBY_TRANSPORT_TOGGLES.map(({ key, label }) => {
            const maxKey = `${key}_max`;
            const isActive = currentFilters[maxKey] != null;
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onChange(maxKey, isActive ? undefined : NEARBY_TRANSPORT_RADIUS_M)
                }
                className={`rounded-full px-3 py-2.5 text-xs sm:py-2 sm:text-sm font-medium ${
                  isActive
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FilterField({
  spec,
  currentFilters,
  onChange,
}: {
  spec: FilterSpec;
  currentFilters: CurrentFilters;
  onChange: (key: string, value: number | number[] | string[] | boolean | undefined) => void;
}) {
  const disabled = !spec.backend_supported;
  const label = spec.alias || spec.key;
  const unitLabel = spec.unit ? ` (${spec.unit})` : "";

  if (spec.type === "range") {
    const minVal = currentFilters[`${spec.key}_min`] as number | undefined;
    const maxVal = currentFilters[`${spec.key}_max`] as number | undefined;
    const isPercent = isPercentRangeKey(spec.key);
    const displayMin = minVal != null && isPercent ? minVal * 100 : minVal;
    const displayMax = maxVal != null && isPercent ? maxVal * 100 : maxVal;
    const step = isPercent ? "1" : stepFromDecimals(spec.decimals);
    const grouped = !isPercent && shouldGroupDigits(spec.display_format);

    const showMin = !MAX_ONLY_KEYS.has(spec.key);
    const showMax = !MIN_ONLY_KEYS.has(spec.key);

    const formatValue = (n: number | undefined) => {
      if (n == null || Number.isNaN(n)) return "";
      return grouped ? formatGroupedNumber(n) : String(n);
    };
    const handleChange = (
      side: "min" | "max",
      rawValue: string,
    ) => {
      const parsed =
        rawValue === ""
          ? undefined
          : grouped
            ? parseGroupedNumber(rawValue)
            : Number(rawValue);
      const value =
        parsed != null && !Number.isNaN(parsed) && isPercent ? parsed / 100 : parsed;
      onChange(
        `${spec.key}_${side}`,
        value === undefined || (typeof value === "number" && Number.isNaN(value)) ? undefined : value,
      );
    };
    const inputType = grouped ? "text" : "number";
    const inputMode = grouped ? "numeric" : undefined;

    return (
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {unitLabel && <span className="ml-1 text-[11px] normal-case text-slate-500">{unitLabel}</span>}
          {disabled && <span className="ml-1 text-[11px] text-amber-600">(nepodporovano)</span>}
        </label>
        <div className="flex gap-2">
          {showMin && (
            <input
              type={inputType}
              inputMode={inputMode}
              step={grouped ? undefined : step}
              min={!grouped && isPercent ? 0 : undefined}
              max={!grouped && isPercent ? 100 : undefined}
              value={formatValue(displayMin)}
              onChange={(e) => handleChange("min", e.target.value)}
              placeholder="Od"
              disabled={disabled}
              className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 sm:py-2"
            />
          )}
          {showMax && (
            <input
              type={inputType}
              inputMode={inputMode}
              step={grouped ? undefined : step}
              min={!grouped && isPercent ? 0 : undefined}
              max={!grouped && isPercent ? 100 : undefined}
              value={formatValue(displayMax)}
              onChange={(e) => handleChange("max", e.target.value)}
              placeholder="Do"
              disabled={disabled}
              className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 sm:py-2"
            />
          )}
        </div>
      </div>
    );
  }

  if (spec.type === "enum") {
    const selected = (currentFilters[spec.key] as string[] | undefined) ?? [];
    const selectedSet = new Set(selected.map(String));
    const options =
      spec.key === "orientation" ? (["E", "N", "S", "W"] as string[]) : ((spec.options ?? []) as string[]);
    const [enumOpen, setEnumOpen] = useState(false);
    const selectedLabels = options
      .filter((val) => selectedSet.has(val))
      .map((val) => formatFilterValueLabel(spec, val));
    const summary =
      selectedLabels.length === 0
        ? "Libovolne"
        : selectedLabels.slice(0, 3).join(", ") +
          (selectedLabels.length > 3 ? ` +${selectedLabels.length - 3}` : "");

    return (
      <div className="space-y-2">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {disabled && <span className="ml-1 text-[11px] text-amber-600">(nepodporovano)</span>}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setEnumOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2.5 text-left text-sm text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:py-2"
        >
          <span className={selectedLabels.length === 0 ? "text-slate-400" : ""}>{summary}</span>
          <span className="ml-2 text-xs text-slate-500">{enumOpen ? "\u25b2" : "\u25bc"}</span>
        </button>
        {enumOpen && (
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 p-2">
            {options.map((val) => {
              const isChecked = selectedSet.has(val);
              return (
                <li key={val} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-100/80">
                  <input
                    type="checkbox"
                    id={`${spec.key}-${val}`}
                    checked={isChecked}
                    onChange={() => {
                      const next = isChecked ? [...selectedSet].filter((x) => x !== val) : [...selectedSet, val];
                      onChange(spec.key, next);
                    }}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/20 disabled:opacity-50"
                  />
                  <label htmlFor={`${spec.key}-${val}`} className="cursor-pointer text-sm text-slate-900">
                    {formatFilterValueLabel(spec, val)}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (spec.type === "enum_search") {
    return (
      <EnumSearchField
        spec={spec}
        currentFilters={currentFilters}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (spec.type === "boolean") {
    const value = currentFilters[spec.key] as boolean | undefined;
    const anoOnly = ANO_ONLY_KEYS.has(spec.key);
    return (
      <div className="space-y-2">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {disabled && <span className="ml-1 text-[11px] text-amber-600">(nepodporovano)</span>}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (disabled) return;
              onChange(spec.key, value === true ? undefined : true);
            }}
            className={`rounded-full px-3 py-2 text-xs sm:text-sm font-medium ${
              value === true
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            Ano
          </button>
          {!anoOnly && (
            <button
              type="button"
              onClick={() => {
                if (disabled) return;
                onChange(spec.key, value === false ? undefined : false);
              }}
              className={`rounded-full px-3 py-2 text-xs sm:text-sm font-medium ${
                value === false
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              Ne
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function EnumSearchField({
  spec,
  currentFilters,
  onChange,
  disabled,
}: {
  spec: FilterSpec;
  currentFilters: CurrentFilters;
  onChange: (key: string, value: number | number[] | string[] | boolean | undefined) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const selected = (currentFilters[spec.key] as string[] | undefined) ?? [];
  const selectedSet = new Set(selected.map(String));
  const options = (spec.options ?? []) as string[];
  const isProjectFilter = spec.key === "project";

  useEffect(() => {
    if (!isProjectFilter || !search.trim() || search.trim().length < 2) {
      setSearchOptions([]);
      return;
    }
    const q = search.trim();
    const t = setTimeout(() => {
      setSearchLoading(true);
      fetch(`${API_BASE}/projects/search?q=${encodeURIComponent(q)}&limit=50`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
        .then((data: string[]) => setSearchOptions(Array.isArray(data) ? data : []))
        .catch(() => setSearchOptions([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [isProjectFilter, search]);

  const filtered = useMemo(() => {
    if (isProjectFilter && search.trim().length >= 2) {
      const fromApi = searchOptions;
      const selectedFirst = selected.filter((s) => fromApi.indexOf(s) === -1);
      return [...selectedFirst, ...fromApi];
    }
    if (isProjectFilter && !search.trim()) return [];
    if (!search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter((o) => String(o).toLowerCase().includes(q));
  }, [isProjectFilter, options, search, searchOptions, selected]);
  const label = spec.alias || spec.key;

  const removeChip = (val: string) => {
    const next = selected.filter((x) => x !== val);
    onChange(spec.key, next.length ? next : undefined);
  };

  return (
    <div className="space-y-2">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
        {disabled && <span className="ml-1 text-[11px] text-amber-600">(nepodporovano)</span>}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setSearchOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        <span className={selected.length === 0 ? "text-slate-400" : ""}>
          {selected.length === 0
            ? "Libovolne"
            : selected.length === 1
            ? formatFilterValueLabel(spec, selected[0])
            : `${selected.length} vybrane`}
        </span>
        <span className="ml-2 text-xs text-slate-500">{searchOpen ? "\u25b2" : "\u25bc"}</span>
      </button>
      {searchOpen && (
        <div className="space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !disabled) {
                e.preventDefault();
                const first = filtered[0];
                if (!first) return;
                const val = String(first);
                if (!selectedSet.has(val)) {
                  onChange(spec.key, [...selected, val]);
                }
                setSearch("");
              }
            }}
            placeholder={isProjectFilter ? "Nazev projektu (min. 2 znaky)..." : "Hledat..."}
            disabled={disabled}
            className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 sm:py-2"
            aria-label={`Vyhledat v ${label}`}
          />
          {searchLoading && (
            <p className="text-xs text-slate-500">Nacitani...</p>
          )}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2">
              {selected.map((val) => (
                <span
                  key={val}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-200 py-0.5 pl-2 pr-1 text-sm font-medium text-slate-800"
                >
                  {formatFilterValueLabel(spec, val)}
                  <button
                    type="button"
                    onClick={() => removeChip(val)}
                    disabled={disabled}
                    className="rounded-full p-0.5 text-slate-600 hover:bg-slate-300 hover:text-slate-900 disabled:opacity-50"
                    aria-label={`Odebrat ${val}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/60 p-2">
            {isProjectFilter && !search.trim() && filtered.length === 0 && (
              <li className="px-1.5 py-2 text-xs text-slate-500">
                Min. 2 znaky pro vyhledani projektu.
              </li>
            )}
            {filtered.map((val) => {
              const isChecked = selectedSet.has(val);
              return (
                <li key={val} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-100/80">
                  <input
                    type="checkbox"
                    id={`${spec.key}-${val}`}
                    checked={isChecked}
                    onChange={() => {
                      const next = isChecked ? [...selectedSet].filter((x) => x !== val) : [...selectedSet, val];
                      onChange(spec.key, next);
                    }}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/20 disabled:opacity-50"
                  />
                  <label htmlFor={`${spec.key}-${val}`} className="cursor-pointer text-sm text-slate-900">
                    {formatFilterValueLabel(spec, val)}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

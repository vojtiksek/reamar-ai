"use client";

import { useMemo } from "react";
import {
  countActiveFilters,
  flattenFilterSpecsByKey,
  type CurrentFilters,
  type FilterGroup,
} from "@/lib/filters";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";

// Shared across units and projects — enum value display labels for known filter keys.
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

const PERCENT_RANGE_BASES = new Set([
  "payment_contract",
  "payment_construction",
  "payment_occupancy",
]);

type FilterBadge = { id: string; label: string; clearKeys: string[] };

type Props = {
  filters: CurrentFilters;
  filterGroups: FilterGroup[];
  onRemove: (next: CurrentFilters) => void;
  /**
   * Optional per-key enum value formatter. Called before the shared FILTER_ENUM_LABELS lookup.
   * Return the input `raw` unchanged to fall through to the default label lookup.
   * Example use: units page passes a formatter that pretty-prints layout codes via formatLayout.
   */
  formatEnumValue?: (key: string, raw: string) => string;
};

export function FilterChips({ filters, filterGroups, onRemove, formatEnumValue }: Props) {
  const aliasByKey = useMemo(() => flattenFilterSpecsByKey(filterGroups), [filterGroups]);

  if (countActiveFilters(filters) === 0) return null;

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
        if (formatEnumValue) {
          const custom = formatEnumValue(k, str);
          if (custom !== str) return custom;
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
    const asPercent = PERCENT_RANGE_BASES.has(base);
    const displayFormat = spec?.display_format ?? "";
    const dispMin = min != null && !Number.isNaN(min) ? (asPercent ? min * 100 : min) : null;
    const dispMax = max != null && !Number.isNaN(max) ? (asPercent ? max * 100 : max) : null;
    const suf = asPercent ? " %" : "";
    const fmt = (n: number) => {
      if (asPercent) return `${Math.round(n)}${suf}`;
      if (displayFormat === "currency" || displayFormat === "currency_per_m2") return formatCurrencyCzk(n);
      if (displayFormat === "area_m2") return formatAreaM2(n);
      return `${n}${suf}`;
    };
    let value = "";
    if (dispMin != null) value += `od ${fmt(dispMin)}`;
    if (dispMax != null) value += value ? ` do ${fmt(dispMax)}` : `do ${fmt(dispMax)}`;
    badges.push({
      id: `${base}:${value}`,
      label: `${label}: ${value}`,
      clearKeys: [`${base}_min`, `${base}_max`],
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {badges.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => {
            const next: CurrentFilters = { ...filters };
            for (const ck of b.clearKeys) {
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
              delete (next as Record<string, unknown>)[ck];
            }
            onRemove(next);
          }}
          className="group inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white"
        >
          <span>{b.label}</span>
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-200 text-[9px] text-slate-600 group-hover:bg-slate-400 group-hover:text-white">
            ×
          </span>
        </button>
      ))}
    </div>
  );
}

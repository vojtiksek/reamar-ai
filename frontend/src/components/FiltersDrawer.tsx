"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { CurrentFilters, FilterGroup, FilterSpec } from "@/lib/filters";
import { API_BASE } from "@/lib/api";

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
  // Dispozice: layout_1 -> "1kk", layout_2 -> "2kk", …
  if (spec.key === "layout") {
    const m = /^layout_(\d+)(?:_(\d+))?$/.exec(String(val));
    if (m) {
      const whole = m[1];
      const frac = m[2];
      if (frac) {
        // layout_1_5 -> "1,5kk"
        return `${whole},${frac}kk`;
      }
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

/** Filtry financování: v UI zobrazujeme a zadáváme celá procenta (1, 10), v modelu máme 0–1. */
const PERCENT_RANGE_KEYS = new Set(["payment_contract", "payment_construction", "payment_occupancy"]);
function isPercentRangeKey(key: string): boolean {
  return PERCENT_RANGE_KEYS.has(key);
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
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 transition-opacity" aria-hidden onClick={onClose} />
      <div
        className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[720px] flex-col rounded-l-2xl border-l border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-label="Filtry"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Filtry</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Zavřít"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            {filterGroups.map((group) => (
              <section
                key={group.name}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 shadow-sm"
              >
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {group.name}
                  </h3>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {group.filters.map((spec) => (
                    <FilterField key={spec.key} spec={spec} currentFilters={currentFilters} onChange={onChange} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onReset}
              className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onApply}
              className="flex-1 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Použít
            </button>
          </div>
        </div>
      </div>
    </>
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
    // U financování: v modelu 0–1, v UI zobrazujeme celá procenta (1, 10)
    const displayMin =
      minVal != null && isPercent ? minVal * 100 : minVal;
    const displayMax =
      maxVal != null && isPercent ? maxVal * 100 : maxVal;
    const step = isPercent ? "1" : stepFromDecimals(spec.decimals);
    return (
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {unitLabel && <span className="ml-1 text-[11px] normal-case text-slate-500">{unitLabel}</span>}
          {disabled && <span className="ml-1 text-[11px] text-amber-600">(zatím nepodporováno)</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            step={step}
            min={isPercent ? 0 : undefined}
            max={isPercent ? 100 : undefined}
            value={displayMin ?? ""}
            onChange={(e) => {
              const raw = e.target.value === "" ? undefined : Number(e.target.value);
              const value = raw != null && isPercent ? raw / 100 : raw;
              onChange(`${spec.key}_min`, value);
            }}
            placeholder="Min"
            disabled={disabled}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <input
            type="number"
            step={step}
            min={isPercent ? 0 : undefined}
            max={isPercent ? 100 : undefined}
            value={displayMax ?? ""}
            onChange={(e) => {
              const raw = e.target.value === "" ? undefined : Number(e.target.value);
              const value = raw != null && isPercent ? raw / 100 : raw;
              onChange(`${spec.key}_max`, value);
            }}
            placeholder="Max"
            disabled={disabled}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
      </div>
    );
  }

  if (spec.type === "enum") {
    const selected = (currentFilters[spec.key] as string[] | undefined) ?? [];
    const selectedSet = new Set(selected.map(String));
    const options =
      spec.key === "orientation" ? (["E", "N", "S", "W"] as string[]) : ((spec.options ?? []) as string[]);
    const [open, setOpen] = useState(false);
    const selectedLabels = options
      .filter((val) => selectedSet.has(val))
      .map((val) => formatFilterValueLabel(spec, val));
    const summary =
      selectedLabels.length === 0
        ? "Libovolné"
        : selectedLabels.slice(0, 3).join(", ") +
          (selectedLabels.length > 3 ? ` +${selectedLabels.length - 3}` : "");

    return (
      <div className="space-y-2">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {disabled && <span className="ml-1 text-[11px] text-amber-600">(zatím nepodporováno)</span>}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <span className={selectedLabels.length === 0 ? "text-slate-400" : ""}>{summary}</span>
          <span className="ml-2 text-xs text-slate-500">{open ? "▲" : "▼"}</span>
        </button>
        {open && (
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
    return (
      <div className="space-y-2">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {disabled && <span className="ml-1 text-[11px] text-amber-600">(zatím nepodporováno)</span>}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (disabled) return;
              // Klik na "Ano" znovu vypne filtr, když už je vybraný.
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
          <button
            type="button"
            onClick={() => {
              if (disabled) return;
              // Klik na "Ne" znovu vypne filtr, když už je vybraný.
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
  const [open, setOpen] = useState(false);
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
    // U projektu při prázdném hledání neukazujeme celý seznam (až 2000 položek) – jen vybrané + hint
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
        {disabled && <span className="ml-1 text-[11px] text-amber-600">(zatím nepodporováno)</span>}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        <span className={selected.length === 0 ? "text-slate-400" : ""}>
          {selected.length === 0
            ? "Libovolné"
            : selected.length === 1
            ? formatFilterValueLabel(spec, selected[0])
            : `${selected.length} vybrané`}
        </span>
        <span className="ml-2 text-xs text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
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
            placeholder={isProjectFilter ? "Napište název projektu (min. 2 znaky)…" : "Hledat…"}
            disabled={disabled}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            aria-label={`Vyhledat v ${label}`}
          />
          {searchLoading && (
            <p className="text-xs text-slate-500">Načítání…</p>
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
                Napište min. 2 znaky pro vyhledání projektů.
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

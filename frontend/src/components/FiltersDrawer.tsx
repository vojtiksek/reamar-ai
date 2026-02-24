"use client";

import React, { useMemo, useState } from "react";
import type { CurrentFilters, FilterGroup, FilterSpec } from "@/lib/filters";

type Props = {
  open: boolean;
  onClose: () => void;
  filterGroups: FilterGroup[];
  currentFilters: CurrentFilters;
  onChange: (key: string, value: number | number[] | string[] | boolean | undefined) => void;
  onReset: () => void;
  onApply: () => void;
};

function stepFromDecimals(decimals: number | null): string {
  if (decimals == null) return "any";
  const step = Math.pow(10, -(decimals ?? 0));
  return step < 1 ? String(step) : "1";
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
        className="fixed top-0 right-0 z-50 flex h-full w-[420px] max-w-[100vw] flex-col rounded-l-xl border-l border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-label="Filtry"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Filtry</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Zavřít"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-8">
            {filterGroups.map((group) => (
              <section key={group.name}>
                <h3 className="mb-4 text-sm font-medium text-gray-700">{group.name}</h3>
                <div className="space-y-4">
                  {group.filters.map((spec) => (
                    <FilterField key={spec.key} spec={spec} currentFilters={currentFilters} onChange={onChange} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onReset}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onApply}
              className="flex-1 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900"
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
    const step = stepFromDecimals(spec.decimals);
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {label}{unitLabel}
          {disabled && <span className="ml-1 text-xs text-amber-600">(zatím nepodporováno)</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            step={step}
            value={minVal ?? ""}
            onChange={(e) => onChange(`${spec.key}_min`, e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder="Min"
            disabled={disabled}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-600 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
          <input
            type="number"
            step={step}
            value={maxVal ?? ""}
            onChange={(e) => onChange(`${spec.key}_max`, e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder="Max"
            disabled={disabled}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-600 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </div>
      </div>
    );
  }

  if (spec.type === "enum") {
    const selected = (currentFilters[spec.key] as string[] | undefined) ?? [];
    const selectedSet = new Set(selected.map(String));
    const options = (spec.options ?? []) as string[];
    return (
      <div className="space-y-2">
        <span className="block text-sm font-medium text-gray-700">
          {label}
          {disabled && <span className="ml-1 text-xs text-amber-600">(zatím nepodporováno)</span>}
        </span>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 bg-gray-50/50 p-2">
          {options.map((val) => {
            const isChecked = selectedSet.has(val);
            return (
              <li key={val} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-100/80">
                <input
                  type="checkbox"
                  id={`${spec.key}-${val}`}
                  checked={isChecked}
                  onChange={() => {
                    const next = isChecked ? [...selectedSet].filter((x) => x !== val) : [...selectedSet, val];
                    onChange(spec.key, next);
                  }}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-black/20 disabled:opacity-50"
                />
                <label htmlFor={`${spec.key}-${val}`} className="cursor-pointer text-sm text-gray-900">
                  {val}
                </label>
              </li>
            );
          })}
        </ul>
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
        <span className="block text-sm font-medium text-gray-700">
          {label}
          {disabled && <span className="ml-1 text-xs text-amber-600">(zatím nepodporováno)</span>}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => !disabled && onChange(spec.key, undefined)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${value === undefined ? "bg-black text-white hover:bg-gray-900" : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            Libovolné
          </button>
          <button
            type="button"
            onClick={() => !disabled && onChange(spec.key, true)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${value === true ? "bg-black text-white hover:bg-gray-900" : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            Ano
          </button>
          <button
            type="button"
            onClick={() => !disabled && onChange(spec.key, false)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${value === false ? "bg-black text-white hover:bg-gray-900" : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
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
  const selected = (currentFilters[spec.key] as string[] | undefined) ?? [];
  const selectedSet = new Set(selected.map(String));
  const options = (spec.options ?? []) as string[];
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter((o) => String(o).toLowerCase().includes(q));
  }, [options, search]);
  const label = spec.alias || spec.key;

  const removeChip = (val: string) => {
    const next = selected.filter((x) => x !== val);
    onChange(spec.key, next.length ? next : undefined);
  };

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-gray-700">
        {label}
        {disabled && <span className="ml-1 text-xs text-amber-600">(zatím nepodporováno)</span>}
      </span>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Hledat…"
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-600 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
        aria-label={`Vyhledat v ${label}`}
      />
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-gray-200 bg-gray-50/50 p-2">
          {selected.map((val) => (
            <span
              key={val}
              className="inline-flex items-center gap-1 rounded-full bg-gray-200 py-0.5 pl-2 pr-1 text-sm font-medium text-gray-800"
            >
              {val}
              <button
                type="button"
                onClick={() => removeChip(val)}
                disabled={disabled}
                className="rounded-full p-0.5 text-gray-600 hover:bg-gray-300 hover:text-gray-900 disabled:opacity-50"
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
      <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 bg-gray-50/50 p-2">
        {filtered.map((val) => {
          const isChecked = selectedSet.has(val);
          return (
            <li key={val} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-100/80">
              <input
                type="checkbox"
                id={`${spec.key}-${val}`}
                checked={isChecked}
                onChange={() => {
                  const next = isChecked ? [...selectedSet].filter((x) => x !== val) : [...selectedSet, val];
                  onChange(spec.key, next);
                }}
                disabled={disabled}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-black/20 disabled:opacity-50"
              />
              <label htmlFor={`${spec.key}-${val}`} className="cursor-pointer text-sm text-gray-900">
                {val}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

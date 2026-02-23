"use client";

import React from "react";

export type RangeConfig = { type: "range"; min: number | null; max: number | null };
export type SelectConfig = { type: "select"; values: string[] };
export type BooleanConfig = { type: "boolean" };
export type FilterFieldConfig = RangeConfig | SelectConfig | BooleanConfig;

export type FilterFieldValue =
  | { min?: number; max?: number }
  | string[]
  | boolean
  | undefined;

type Props = {
  fieldKey: string;
  fieldConfig: FilterFieldConfig;
  value: FilterFieldValue;
  onChange: (value: FilterFieldValue) => void;
  label?: string;
};

export function FilterField({ fieldKey, fieldConfig, value, onChange, label }: Props) {
  const lab = label ?? fieldKey.replace(/_/g, " ");

  if (fieldConfig.type === "range") {
    const v = (value ?? {}) as { min?: number; max?: number };
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">{lab}</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={v.min ?? ""}
            onChange={(e) =>
              onChange({
                ...v,
                min: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            placeholder={fieldConfig.min != null ? String(fieldConfig.min) : "Min"}
            className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <input
            type="number"
            value={v.max ?? ""}
            onChange={(e) =>
              onChange({
                ...v,
                max: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            placeholder={fieldConfig.max != null ? String(fieldConfig.max) : "Max"}
            className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>
      </div>
    );
  }

  if (fieldConfig.type === "select") {
    const selected = (value as string[] | undefined) ?? [];
    const set = new Set(selected);
    return (
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-gray-700">{lab}</span>
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-gray-200 bg-gray-50/50 p-1.5">
          {fieldConfig.values.map((opt) => (
            <li key={opt} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${fieldKey}-${opt}`}
                checked={set.has(opt)}
                onChange={() => {
                  const next = set.has(opt)
                    ? selected.filter((x) => x !== opt)
                    : [...selected, opt];
                  onChange(next.length ? next : undefined);
                }}
                className="h-3.5 w-3.5 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
              />
              <label htmlFor={`${fieldKey}-${opt}`} className="cursor-pointer text-sm text-gray-800">
                {opt}
              </label>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (fieldConfig.type === "boolean") {
    const v = value as boolean | undefined;
    return (
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-gray-700">{lab}</span>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={v === true}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
            className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
          />
          <span className="text-sm text-gray-800">Zapnuto</span>
        </label>
      </div>
    );
  }

  return null;
}

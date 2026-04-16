"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

type Item = { value: string; count: number };

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
};

/**
 * 3-level hierarchical location picker: Kraj → Obec → Čtvrť
 * Selected values feed into the same administrative_area array as AreaMultiSelect.
 */
export function AreaHierarchyPicker({ values, onChange }: Props) {
  const [districts, setDistricts] = useState<Item[]>([]);
  const [openDistrict, setOpenDistrict] = useState<string | null>(null);
  const [municipalities, setMunicipalities] = useState<Item[]>([]);
  const [openMunicipality, setOpenMunicipality] = useState<string | null>(null);
  const [neighborhoods, setNeighborhoods] = useState<Item[]>([]);

  // Load top-level districts on mount
  useEffect(() => {
    fetch(`${API_BASE}/locations/hierarchy`)
      .then((r) => r.json())
      .then(setDistricts)
      .catch(() => {});
  }, []);

  // Load municipalities when a district is opened
  useEffect(() => {
    if (!openDistrict) { setMunicipalities([]); setOpenMunicipality(null); setNeighborhoods([]); return; }
    fetch(`${API_BASE}/locations/hierarchy?district=${encodeURIComponent(openDistrict)}`)
      .then((r) => r.json())
      .then(setMunicipalities)
      .catch(() => {});
    setOpenMunicipality(null);
    setNeighborhoods([]);
  }, [openDistrict]);

  // Load neighborhoods when a municipality is opened
  useEffect(() => {
    if (!openMunicipality) { setNeighborhoods([]); return; }
    fetch(`${API_BASE}/locations/hierarchy?municipality=${encodeURIComponent(openMunicipality)}`)
      .then((r) => r.json())
      .then(setNeighborhoods)
      .catch(() => {});
  }, [openMunicipality]);

  const toggle = (val: string) => {
    if (values.includes(val)) onChange(values.filter((v) => v !== val));
    else onChange([...values, val]);
  };

  const isSelected = (val: string) => values.includes(val);

  const rowClass = (selected: boolean, depth: number) =>
    [
      "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer select-none transition-colors",
      depth === 0 ? "font-medium" : depth === 1 ? "font-normal" : "text-[13px]",
      selected ? "bg-indigo-50 text-indigo-800" : "text-slate-700 hover:bg-slate-50",
    ].join(" ");

  const chevron = (open: boolean) => (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );

  const checkbox = (selected: boolean) => (
    <span className={[
      "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold transition-colors",
      selected ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 bg-white",
    ].join(" ")}>
      {selected ? "✓" : ""}
    </span>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white text-sm">
      {/* Selected chips */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800">
              {v}
              <button type="button" onClick={() => toggle(v)} className="ml-0.5 text-indigo-400 hover:text-indigo-700">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex divide-x divide-slate-100">
        {/* Column 1: Districts */}
        <div className="min-w-0 flex-1 overflow-y-auto" style={{ maxHeight: 320 }}>
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Kraj / Okres</div>
          {districts.map((d) => (
            <div key={d.value}>
              <div
                className={rowClass(isSelected(d.value), 0)}
                onClick={() => setOpenDistrict(openDistrict === d.value ? null : d.value)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div onClick={(e) => { e.stopPropagation(); toggle(d.value); }}>
                    {checkbox(isSelected(d.value))}
                  </div>
                  <span className="truncate">{d.value}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400">{d.count}</span>
                  {chevron(openDistrict === d.value)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Column 2: Municipalities (visible when district is open) */}
        {openDistrict && (
          <div className="min-w-0 flex-1 overflow-y-auto" style={{ maxHeight: 320 }}>
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Obec / Obvod</div>
            {municipalities.map((m) => (
              <div key={m.value}>
                <div
                  className={rowClass(isSelected(m.value), 1)}
                  onClick={() => setOpenMunicipality(openMunicipality === m.value ? null : m.value)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div onClick={(e) => { e.stopPropagation(); toggle(m.value); }}>
                      {checkbox(isSelected(m.value))}
                    </div>
                    <span className="truncate">{m.value}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">{m.count}</span>
                    {chevron(openMunicipality === m.value)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Column 3: Neighborhoods (visible when municipality is open and has neighborhoods) */}
        {openMunicipality && neighborhoods.length > 0 && (
          <div className="min-w-0 flex-1 overflow-y-auto" style={{ maxHeight: 320 }}>
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Čtvrť</div>
            {neighborhoods.map((n) => (
              <div
                key={n.value}
                className={rowClass(isSelected(n.value), 2)}
                onClick={() => toggle(n.value)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {checkbox(isSelected(n.value))}
                  <span className="truncate">{n.value}</span>
                </div>
                <span className="text-[11px] text-slate-400">{n.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

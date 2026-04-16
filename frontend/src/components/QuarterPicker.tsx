"use client";

import { useMemo } from "react";
import clsx from "clsx";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

type Quarter = { label: string; value: string };

/** Convert ISO date to quarter label: "2026-03-31" → "1Q 2026" */
export function dateToQuarterLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = m[1];
  const month = parseInt(m[2], 10);
  const q = Math.ceil(month / 3);
  return `${q}Q ${year}`;
}

/** Generate quarter options from now to +5 years */
function generateQuarters(): Quarter[] {
  const now = new Date();
  const startYear = now.getFullYear();
  const startQ = Math.ceil((now.getMonth() + 1) / 3);
  const quarters: Quarter[] = [];

  for (let y = startYear; y <= startYear + 5; y++) {
    for (let q = 1; q <= 4; q++) {
      if (y === startYear && q < startQ) continue;
      // End of quarter date (what gets stored — used for "latest" / hard filter)
      const endMonth = q * 3;
      const endDay = [0, 31, 30, 31, 30][q]; // Q1=Mar31, Q2=Jun30, Q3=Sep30, Q4=Dec31
      const value = `${y}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
      quarters.push({ label: `${q}Q ${y}`, value });
    }
  }
  return quarters;
}

/** Map ISO date to the matching quarter value, or null */
function findMatchingQuarter(iso: string | null | undefined, quarters: Quarter[]): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = m[1];
  const month = parseInt(m[2], 10);
  const q = Math.ceil(month / 3);
  const endMonth = q * 3;
  const endDay = [0, 31, 30, 31, 30][q];
  const expected = `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return quarters.find((qtr) => qtr.value === expected)?.value ?? null;
}

export function QuarterPicker({
  value,
  onChange,
  className,
  placeholder = "Vyberte kvartál",
  mode = "end",
}: {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  className?: string;
  placeholder?: string;
  /** "end" stores end of quarter (for latest_move_in), "start" stores start (for earliest) */
  mode?: "end" | "start";
}) {
  const quarters = useMemo(generateQuarters, []);
  const selected = findMatchingQuarter(value, quarters);

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => {
        const val = e.target.value;
        if (!val) {
          onChange(null);
          return;
        }
        if (mode === "start") {
          // Convert end-of-quarter to start-of-quarter
          const m = val.match(/^(\d{4})-(\d{2})/);
          if (m) {
            const month = parseInt(m[2], 10);
            const startMonth = month - 2;
            onChange(`${m[1]}-${String(startMonth).padStart(2, "0")}-01`);
            return;
          }
        }
        onChange(val);
      }}
      className={cn("rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700", className)}
    >
      <option value="">{placeholder}</option>
      {quarters.map((q) => (
        <option key={q.value} value={q.value}>{q.label}</option>
      ))}
    </select>
  );
}

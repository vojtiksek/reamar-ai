"use client";

import React from "react";
import { formatCurrencyCzk } from "@/lib/format";

type Props = {
  total: number;
  averagePricePerM2: number | null;
  averagePrice: number | null;
  availableCount: number;
  averageLocalDiff: number | null;
  /** Např. "Celkem projektů" na stránce projektů; výchozí "Celkem jednotek". */
  totalLabel?: string;
};

function formatInteger(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("cs-CZ").format(Math.round(n));
}

export function SummaryBar({
  total,
  averagePricePerM2,
  averagePrice,
  availableCount,
  averageLocalDiff,
  totalLabel = "Celkem jednotek",
}: Props) {
  const diffPositive = averageLocalDiff != null && !Number.isNaN(averageLocalDiff) && averageLocalDiff > 0;
  const diffNegative = averageLocalDiff != null && !Number.isNaN(averageLocalDiff) && averageLocalDiff < 0;

  const diffCardClasses = diffPositive
    ? "from-rose-500/10 via-rose-500/5 to-rose-500/0 border-rose-400/60"
    : diffNegative
      ? "from-emerald-500/10 via-emerald-500/5 to-emerald-500/0 border-emerald-400/60"
      : "from-slate-500/5 via-slate-500/2 to-slate-500/0 border-slate-200";

  return (
    <div className="grid w-full gap-3 md:grid-cols-3 lg:grid-cols-5">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{totalLabel}</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{formatInteger(total)}</p>
      </div>
      <div className="min-w-0 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-sky-25 to-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Prům. cena za m²</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatCurrencyCzk(averagePricePerM2)}
        </p>
      </div>
      <div className="min-w-0 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-indigo-25 to-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Prům. cena</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatCurrencyCzk(averagePrice)}
        </p>
      </div>
      <div className="min-w-0 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-25 to-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Dostupných</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatInteger(availableCount)}
        </p>
      </div>
      <div
        className={`min-w-0 rounded-xl border bg-gradient-to-br px-4 py-3 shadow-sm ${diffCardClasses}`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          Prům. odchylka od trhu
        </p>
        <p
          className={`mt-1 text-lg font-semibold ${
            averageLocalDiff == null || Number.isNaN(averageLocalDiff)
              ? "text-slate-900"
              : averageLocalDiff > 0
              ? "text-rose-600"
              : averageLocalDiff < 0
              ? "text-emerald-600"
              : "text-slate-900"
          }`}
        >
          {averageLocalDiff == null || Number.isNaN(averageLocalDiff)
            ? "—"
            : `${averageLocalDiff > 0 ? "+" : ""}${averageLocalDiff.toFixed(1)} %`}
        </p>
      </div>
    </div>
  );
}

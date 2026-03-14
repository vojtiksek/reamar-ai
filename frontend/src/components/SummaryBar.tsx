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
    ? "from-rose-500/30 via-rose-500/10 to-rose-500/0 border-rose-400/60"
    : diffNegative
      ? "from-emerald-500/30 via-emerald-500/10 to-emerald-500/0 border-emerald-400/60"
      : "from-slate-500/10 via-slate-500/3 to-slate-500/0 border-slate-200";

  return (
    <div className="grid w-full gap-3 md:grid-cols-3 lg:grid-cols-5">
      <div className="min-w-0 glass-card px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{totalLabel}</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{formatInteger(total)}</p>
      </div>
      <div className="min-w-0 glass-card bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-white/90 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Prům. cena za m²</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatCurrencyCzk(averagePricePerM2)}
        </p>
      </div>
      <div className="min-w-0 glass-card bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-white/90 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Prům. cena</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatCurrencyCzk(averagePrice)}
        </p>
      </div>
      <div className="min-w-0 glass-card bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-white/90 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Dostupných</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatInteger(availableCount)}
        </p>
      </div>
      <div
        className={`min-w-0 glass-card bg-gradient-to-br px-4 py-3 ${diffCardClasses}`}
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

"use client";

import React from "react";
import { formatCurrencyCzk } from "@/lib/format";

type Props = {
  total: number;
  averagePricePerM2: number | null;
  averagePrice: number | null;
  availableCount: number;
  averageLocalDiff: number | null;
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
}: Props) {
  return (
    <div className="flex flex-wrap gap-2.5">
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-700">Celkem jednotek</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{formatInteger(total)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-700">Prům. cena za m²</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{formatCurrencyCzk(averagePricePerM2)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-700">Prům. cena</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{formatCurrencyCzk(averagePrice)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-700">Dostupných</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{formatInteger(availableCount)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-700">
          Prům. odchylka od trhu
        </p>
        <p
          className={`mt-0.5 text-base font-semibold ${
            averageLocalDiff == null
              ? "text-gray-900"
              : averageLocalDiff > 0
              ? "text-red-600"
              : averageLocalDiff < 0
              ? "text-green-600"
              : "text-gray-900"
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

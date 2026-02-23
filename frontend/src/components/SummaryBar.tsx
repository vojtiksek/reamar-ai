"use client";

import React from "react";
import { formatCurrencyCzk } from "@/lib/format";

type Props = {
  total: number;
  averagePricePerM2: number | null;
  averagePrice: number | null;
  availableCount: number;
};

function formatInteger(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("cs-CZ").format(Math.round(n));
}

export function SummaryBar({ total, averagePricePerM2, averagePrice, availableCount }: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Celkem jednotek</p>
        <p className="mt-0.5 text-xl font-semibold text-gray-900">{formatInteger(total)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Prům. cena za m²</p>
        <p className="mt-0.5 text-xl font-semibold text-gray-900">{formatCurrencyCzk(averagePricePerM2)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Prům. cena</p>
        <p className="mt-0.5 text-xl font-semibold text-gray-900">{formatCurrencyCzk(averagePrice)}</p>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Dostupných</p>
        <p className="mt-0.5 text-xl font-semibold text-gray-900">{formatInteger(availableCount)}</p>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

type PaymentScheduleProps = {
  priceCzk: number;
  /** Fraction (0–1) paid at contract signing (SOSBK) */
  paymentContract?: number | null;
  /** Fraction (0–1) paid during construction */
  paymentConstruction?: number | null;
  /** Fraction (0–1) paid at completion/occupancy */
  paymentOccupancy?: number | null;
  /** Parking price to optionally include */
  parkingPriceCzk?: number | null;
};

function fmt(n: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n: number): string {
  return `${Math.round(n * 100)} %`;
}

export function PaymentSchedule({
  priceCzk,
  paymentContract,
  paymentConstruction,
  paymentOccupancy,
  parkingPriceCzk,
}: PaymentScheduleProps) {
  const [includeParking, setIncludeParking] = useState(false);

  const totalPrice = priceCzk + (includeParking && parkingPriceCzk ? parkingPriceCzk : 0);

  const phases = useMemo(() => {
    const pc = paymentContract ?? 0;
    const pb = paymentConstruction ?? 0;
    const po = paymentOccupancy ?? 0;
    const sum = pc + pb + po;

    // If no schedule data, show a single 100% payment
    if (sum === 0) {
      return [{ label: "Celková platba", fraction: 1, amount: totalPrice }];
    }

    // Normalize if they don't add up to 1
    const factor = sum > 0 ? 1 / sum : 1;
    const items: { label: string; fraction: number; amount: number }[] = [];

    if (pc > 0) {
      const f = pc * factor;
      items.push({ label: "Po podpisu SOSBK", fraction: f, amount: Math.round(totalPrice * f) });
    }
    if (pb > 0) {
      const f = pb * factor;
      items.push({ label: "Během výstavby", fraction: f, amount: Math.round(totalPrice * f) });
    }
    if (po > 0) {
      const f = po * factor;
      items.push({ label: "Po dokončení", fraction: f, amount: Math.round(totalPrice * f) });
    }

    return items;
  }, [totalPrice, paymentContract, paymentConstruction, paymentOccupancy]);

  const hasSchedule = (paymentContract ?? 0) + (paymentConstruction ?? 0) + (paymentOccupancy ?? 0) > 0;

  if (!hasSchedule) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Harmonogram plateb
      </h4>

      {parkingPriceCzk != null && parkingPriceCzk > 0 && (
        <label className="mb-3 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={includeParking}
            onChange={(e) => setIncludeParking(e.target.checked)}
            className="rounded border-slate-300"
          />
          Včetně parkování ({fmt(parkingPriceCzk)})
        </label>
      )}

      <div className="space-y-2">
        {phases.map((p, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-32 text-xs text-slate-600">{p.label}</div>
            <div className="flex-1">
              <div className="h-5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.round(p.fraction * 100)}%` }}
                />
              </div>
            </div>
            <div className="w-16 text-right text-xs font-medium text-slate-500">
              {pct(p.fraction)}
            </div>
            <div className="w-28 text-right text-sm font-semibold text-slate-800">
              {fmt(p.amount)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end border-t border-slate-100 pt-2">
        <span className="text-xs text-slate-500">Celkem: </span>
        <span className="ml-1 text-sm font-bold text-slate-900">{fmt(totalPrice)}</span>
      </div>
    </div>
  );
}

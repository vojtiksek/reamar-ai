"use client";

import Link from "next/link";
import { useActiveClient } from "@/contexts/ActiveClientContext";
import { formatCurrencyCzk, formatAreaM2, formatLayout } from "@/lib/format";
import type { CurrentFilters } from "@/lib/filters";

/**
 * Summarise a client baseline (derivedFilters) into a compact human-readable string.
 * Skips availability (always the same default) and any field that has no value.
 */
function baselineSummary(f: CurrentFilters): string {
  const parts: string[] = [];

  // Dispozice — derivedFilters now stores DB values ("layout_3"); formatLayout converts to "3+kk".
  const layouts = f.layout as string[] | undefined;
  if (Array.isArray(layouts) && layouts.length > 0) {
    const labels = layouts.map((v) => {
      const formatted = formatLayout(v);
      return formatted !== "—" ? formatted : v;
    });
    parts.push(`Dispozice: ${labels.join(", ")}`);
  }

  // Cena
  const priceMin = f.price_min as number | undefined;
  const priceMax = f.price_max as number | undefined;
  if (priceMin != null || priceMax != null) {
    const lo = priceMin != null ? `od ${formatCurrencyCzk(priceMin)}` : "";
    const hi = priceMax != null ? `do ${formatCurrencyCzk(priceMax)}` : "";
    parts.push(`Cena: ${[lo, hi].filter(Boolean).join(" ")}`);
  }

  // Plocha
  const areaMin = f.floor_area_min as number | undefined;
  const areaMax = f.floor_area_max as number | undefined;
  if (areaMin != null || areaMax != null) {
    const lo = areaMin != null ? `od ${formatAreaM2(areaMin)}` : "";
    const hi = areaMax != null ? `do ${formatAreaM2(areaMax)}` : "";
    parts.push(`Plocha: ${[lo, hi].filter(Boolean).join(" ")}`);
  }

  // Typ nemovitosti
  const category = f.category as string[] | undefined;
  if (Array.isArray(category) && category.length > 0) {
    const labels = category.map((c) =>
      c === "flat" ? "Byt" : c === "house" ? "Dům" : c
    );
    parts.push(`Typ: ${labels.join(", ")}`);
  }

  // Standardy označené "musí být" (jdou do filtru jen pokud jsou must)
  if (f.air_conditioning === true) parts.push("Klimatizace");
  if (f.exterior_blinds === true) parts.push("Žaluzie");

  return parts.join(" · ");
}

type Props = {
  /** Pass the page-level isClientOverridden boolean from each page. */
  isOverridden?: boolean;
};

/**
 * Thin amber info strip shown on /units, /projects, and /projects/map when a client is active.
 * Shows the client name (linked to detail) and a compact summary of the profile baseline.
 * When isOverridden is true, shows a "filtr změněn" badge to signal manual override.
 */
export function ClientModeBar({ isOverridden }: Props) {
  const { activeClient } = useActiveClient();
  if (!activeClient) return null;

  const summary = baselineSummary(activeClient.derivedFilters);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200/70 bg-amber-50/80 px-3 py-1.5 text-xs text-amber-900 backdrop-blur-sm">
      <span className="shrink-0 font-semibold">
        <Link
          href={`/clients/${activeClient.clientId}`}
          className="underline decoration-amber-400/60 underline-offset-2 hover:text-amber-700 hover:decoration-amber-600"
        >
          {activeClient.clientName}
        </Link>
      </span>
      {summary && (
        <span className="min-w-0 text-amber-800/80">{summary}</span>
      )}
      {isOverridden && (
        <span className="ml-auto shrink-0 rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          filtr změněn
        </span>
      )}
    </div>
  );
}

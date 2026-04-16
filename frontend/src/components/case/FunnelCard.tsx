"use client";

import { useState } from "react";
import type { RecommendationFunnel, RecommendationFunnelStep } from "@/lib/caseTypes";

export function FunnelCard({ funnel }: { funnel: RecommendationFunnel }) {
  const [open, setOpen] = useState(false);
  const { total, steps, final } = funnel;

  const limitStep = steps.find((s: RecommendationFunnelStep) => s.key === "visible_limit");
  const filterSteps = steps.filter((s: RecommendationFunnelStep) => s.key !== "visible_limit");
  const matchingCount = final + (limitStep?.removed ?? 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
      {/* Always-visible summary row — click to expand */}
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Funnel</span>
        <span className="text-slate-500">Aktivní: <span className="tabular-nums font-semibold text-slate-900">{total}</span></span>
        <span className="text-slate-500">→ Odpovídá: <span className="tabular-nums font-bold text-slate-900">{matchingCount}</span></span>
        {limitStep && limitStep.removed > 0 && (
          <span className="text-slate-400">· zobrazeno {final} z {matchingCount}</span>
        )}
        <span className="ml-auto text-slate-400 text-[10px]">{open ? "▲" : "▾"}</span>
      </button>

      {/* Expanded: per-step breakdown */}
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs">
          {filterSteps.length === 0 ? (
            <span className="text-slate-400">Žádné hard filtry</span>
          ) : (
            filterSteps.map((step) => (
              <span key={step.key} className="text-slate-600">
                {step.label}: <span className={`tabular-nums font-medium ${step.removed > 0 ? "text-rose-600" : "text-slate-400"}`}>{step.removed > 0 ? `−${step.removed}` : "±0"}</span>
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

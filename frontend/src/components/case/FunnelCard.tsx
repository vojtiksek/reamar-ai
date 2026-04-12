"use client";

import type { RecommendationFunnel, RecommendationFunnelStep } from "@/lib/caseTypes";

/**
 * Minimal filter-funnel diagnostics card.
 *
 * Shows which hard filters dropped how many units between the total active
 * inventory and the final recommendation list. No charts, no interactions.
 * Rendered only when the parent already has a funnel payload from the most
 * recent recompute.
 *
 * The visible_limit step is intentionally separated from real filter steps:
 * it is a display cap, not a filter — those units still match the profile.
 */
export function FunnelCard({ funnel }: { funnel: RecommendationFunnel }) {
  const { total, steps, final } = funnel;

  // Separate display-cap from real filter/eligibility steps.
  const limitStep = steps.find((s: RecommendationFunnelStep) => s.key === "visible_limit");
  const filterSteps = steps.filter((s: RecommendationFunnelStep) => s.key !== "visible_limit");

  // True matching count = displayed (final) + those hidden only by the display cap.
  const matchingCount = final + (limitStep?.removed ?? 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        Proč tolik jednotek?
      </p>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-600">Celkem aktivních jednotek</span>
          <span className="tabular-nums font-semibold text-slate-900">{total}</span>
        </div>

        {/* Real filter steps — these actually remove units from the result set. */}
        {filterSteps.length === 0 ? (
          <p className="pt-1 text-xs text-slate-500">
            Žádné hard filtry — scoring řadí kompletní trh.
          </p>
        ) : (
          filterSteps.map((step) => (
            <div key={step.key} className="flex items-center justify-between text-slate-700">
              <span className="truncate">{step.label}</span>
              <span
                className={
                  "tabular-nums " +
                  (step.removed > 0 ? "text-rose-600" : "text-slate-400")
                }
              >
                {step.removed > 0 ? `−${step.removed}` : "±0"}
              </span>
            </div>
          ))
        )}

        {/* True matching result — before any display cap. */}
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Odpovídá profilu
          </span>
          <span className="tabular-nums text-base font-bold text-slate-900">
            {matchingCount}
          </span>
        </div>

        {/* Display cap — shown only when limit actually truncated results.
            Clearly separated so it is not mistaken for a filter loss. */}
        {limitStep && limitStep.removed > 0 && (
          <div className="mt-1 flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5">
            <span className="text-xs text-slate-500">
              Zobrazeno (limit)
            </span>
            <span className="tabular-nums text-xs font-semibold text-slate-700">
              {final} z {matchingCount}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

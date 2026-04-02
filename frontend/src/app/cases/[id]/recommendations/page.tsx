"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk } from "@/lib/format";
import { FitDot } from "@/components/case/ScoreUtils";
import { ReamarButton, ReamarCard } from "@/components/ui/reamar-ui";
import { API_BASE } from "@/lib/api";
import type { RecommendationItem } from "@/lib/caseTypes";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

type ScoringThresholds = {
  strong_pick_min_score: number;
  review_pick_min_score: number;
  hide_below_score: number;
  default_visible_limit: number;
  max_strong_picks: number;
  max_review_picks: number;
};

const THRESHOLD_DEFAULTS: ScoringThresholds = {
  strong_pick_min_score: 70,
  review_pick_min_score: 55,
  hide_below_score: 0,
  default_visible_limit: 50,
  max_strong_picks: 0,
  max_review_picks: 0,
};

function useThresholds(token: string | null): ScoringThresholds {
  const [thresholds, setThresholds] = useState<ScoringThresholds>(THRESHOLD_DEFAULTS);
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/scoring-thresholds`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: any) => {
        if (data?.thresholds) setThresholds({ ...THRESHOLD_DEFAULTS, ...data.thresholds });
      })
      .catch(() => {});
  }, [token]);
  return thresholds;
}

function matchLabel(score: number, t: ScoringThresholds) {
  if (score >= t.strong_pick_min_score + 15) return { label: "Sedí výborně", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= t.strong_pick_min_score) return { label: "Sedí dobře", cls: "bg-blue-100 text-blue-800" };
  if (score >= t.review_pick_min_score) return { label: "Sedí středně", cls: "bg-amber-100 text-amber-800" };
  return { label: "Slabší match", cls: "bg-slate-100 text-slate-700" };
}

function confidenceLabel(label?: string) {
  if (label === "high") return { label: "Vysoká jistota", cls: "bg-emerald-100 text-emerald-800" };
  if (label === "medium") return { label: "Střední jistota", cls: "bg-amber-100 text-amber-800" };
  if (label === "low") return { label: "Nízká jistota", cls: "bg-rose-100 text-rose-800" };
  return { label: "Bez jistoty", cls: "bg-slate-100 text-slate-700" };
}

function eligibilityHuman(status?: string) {
  if (status === "pass") return { label: "Lze doporučit", cls: "bg-emerald-100 text-emerald-800" };
  if (status === "review") return { label: "Nutno prověřit", cls: "bg-amber-100 text-amber-800" };
  return { label: "Bez verdictu", cls: "bg-slate-100 text-slate-700" };
}

function RecommendationCard({ r, onPin, onOpen, thresholds }: { r: RecommendationItem; onPin: () => void; onOpen: () => void; thresholds: ScoringThresholds }) {
  const match = matchLabel(r.score, thresholds);
  const eligibility = eligibilityHuman(r.eligibility);
  const confidence = confidenceLabel(r.confidence_label);
  const href = r.unit_external_id ? `/units/${encodeURIComponent(r.unit_external_id)}` : null;

  return (
    <ReamarCard className={cn("p-5 transition-colors hover:bg-slate-50", r.pinned_by_broker ? "border-amber-300 bg-amber-50/40" : "")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{r.project_name ?? r.unit_external_id ?? "—"}</h3>
              {r.price_czk != null && <span className="text-sm font-medium text-slate-700">{formatCurrencyCzk(r.price_czk)}</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {r.unit_external_id ?? "—"}
              {r.layout_label ? ` · ${r.layout_label}` : ""}
              {r.floor_area_m2 != null ? ` · ${Math.round(r.floor_area_m2)} m²` : ""}
              {r.floor != null ? ` · ${r.floor}. patro` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", match.cls)}>{match.label}</span>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", eligibility.cls)}>{eligibility.label}</span>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", confidence.cls)}>{confidence.label}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Proč sedí</p>
              {r.top_strengths?.length ? (
                <ul className="space-y-1 text-sm text-slate-600">
                  {r.top_strengths.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Bez explicitních silných stránek.</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Na co pozor</p>
              {r.top_compromises?.length ? (
                <ul className="space-y-1 text-sm text-slate-600">
                  {r.top_compromises.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              ) : r.eligibility_reasons?.length ? (
                <ul className="space-y-1 text-sm text-slate-600">
                  {r.eligibility_reasons.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Bez výrazného kompromisu.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>Fit breakdown:</span>
              <div className="flex items-center gap-1">
                <FitDot value={r.budget_fit} title={`Rozpočet ${Math.round(r.budget_fit)}`} />
                <FitDot value={r.location_fit} title={`Lokalita ${Math.round(r.location_fit)}`} />
                <FitDot value={r.walkability_fit} title={`Walkabilita ${Math.round(r.walkability_fit)}`} />
                <FitDot value={r.layout_fit} title={`Dispozice ${Math.round(r.layout_fit)}`} />
                <FitDot value={r.area_fit} title={`Plocha ${Math.round(r.area_fit)}`} />
                <FitDot value={r.outdoor_fit} title={`Venkovní plocha ${Math.round(r.outdoor_fit)}`} />
                <FitDot value={r.commute_fit ?? 0} title={`Dojíždění ${Math.round(r.commute_fit ?? 0)}`} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <ReamarButton variant={r.pinned_by_broker ? "primary" : "subtle"} size="sm" onClick={onPin}>
            {r.pinned_by_broker ? "Ve shortlistu" : "Přidat do shortlistu"}
          </ReamarButton>
          <ReamarButton variant="ghost" size="sm" onClick={onOpen}>Otevřít</ReamarButton>
          {href && <Link href={href} className="text-center text-xs text-slate-500 hover:underline">Detail jednotky</Link>}
        </div>
      </div>
    </ReamarCard>
  );
}

function RecommendationSection({ title, subtitle, items, onPin, onOpen, thresholds }: { title: string; subtitle: string; items: RecommendationItem[]; onPin: (item: RecommendationItem) => void; onOpen: (item: RecommendationItem) => void; thresholds: ScoringThresholds }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {items.map((r) => (
          <RecommendationCard key={r.rec_id} r={r} onPin={() => onPin(r)} onOpen={() => onOpen(r)} thresholds={thresholds} />
        ))}
      </div>
    </section>
  );
}

export default function RecommendationsPage() {
  const { client, recs, loading, error, hydrated, token, recomputing, router, handleRecompute, handlePin } = useCaseData();
  const thresholds = useThresholds(token);

  if (!hydrated) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Načítání…</div></div>;
  if (!token) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Nejste přihlášen. Přejděte na <Link href="/login" className="text-slate-900 underline">/login</Link>.</div></div>;
  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-600">Klient nenalezen.</p>;

  let strong = recs.filter((r) => r.eligibility !== "review" && r.score >= thresholds.strong_pick_min_score);
  let review = recs.filter((r) => r.eligibility === "review" || (r.eligibility !== "review" && r.score >= thresholds.review_pick_min_score && r.score < thresholds.strong_pick_min_score));
  let fallback = recs.filter((r) => r.eligibility !== "review" && r.score < thresholds.review_pick_min_score);

  // Apply max caps if configured
  if (thresholds.max_strong_picks > 0 && strong.length > thresholds.max_strong_picks) {
    review = [...strong.slice(thresholds.max_strong_picks), ...review];
    strong = strong.slice(0, thresholds.max_strong_picks);
  }
  if (thresholds.max_review_picks > 0 && review.length > thresholds.max_review_picks) {
    fallback = [...review.slice(thresholds.max_review_picks), ...fallback];
    review = review.slice(0, thresholds.max_review_picks);
  }
  const shortlistCount = recs.filter((r) => r.pinned_by_broker).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Decision feed</h2>
          <p className="text-sm text-slate-500">{recs.length} kandidátů · {strong.length} strong picks · {review.length} review · {shortlistCount} ve shortlistu</p>
        </div>
        <div className="flex gap-2">
          <ReamarButton type="button" variant="subtle" size="sm" onClick={() => router.push(`/cases/${client.id}/brief`)}>Změnit brief</ReamarButton>
          <ReamarButton type="button" variant="subtle" size="sm" onClick={() => router.push(`/explorer/units`)}>Otevřít Explorer</ReamarButton>
          <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>{recomputing ? "Přepočítávám…" : "Přepočítat"}</ReamarButton>
        </div>
      </div>

      {recs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-600">
          Zatím žádná doporučení. Vyplň Brief a klikni na „Přepočítat“.
        </div>
      ) : (
        <div className="space-y-8">
          <RecommendationSection title="Strong picks" subtitle="Nejlepší kandidáti, které lze rovnou posouvat do shortlistu." items={strong} onPin={(r) => handlePin(r.rec_id, r.pinned_by_broker)} onOpen={(r) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`)} thresholds={thresholds} />
          <RecommendationSection title="Review picks" subtitle="Silné kandidáty, ale s něčím, co je potřeba ověřit." items={review} onPin={(r) => handlePin(r.rec_id, r.pinned_by_broker)} onOpen={(r) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`)} thresholds={thresholds} />
          <RecommendationSection title="Fallback options" subtitle="Rezervní varianty pro případ, že top picks nevyjdou." items={fallback} onPin={(r) => handlePin(r.rec_id, r.pinned_by_broker)} onOpen={(r) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`)} thresholds={thresholds} />
        </div>
      )}
    </div>
  );
}

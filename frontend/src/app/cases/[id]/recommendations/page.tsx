"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk } from "@/lib/format";
import { FitDot } from "@/components/case/ScoreUtils";
import { ReamarButton, ReamarCard, reamarInputClass } from "@/components/ui/reamar-ui";
import { API_BASE } from "@/lib/api";
import type {
  RecommendationDislikeReason,
  RecommendationFeedbackType,
  RecommendationItem,
} from "@/lib/caseTypes";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

const DISLIKE_REASONS: { value: RecommendationDislikeReason; label: string }[] = [
  { value: "price", label: "Cena" },
  { value: "location", label: "Lokalita" },
  { value: "layout", label: "Dispozice" },
  { value: "small_area", label: "Malá plocha" },
  { value: "standard_or_project", label: "Standard / projekt" },
  { value: "noise_or_surroundings", label: "Hluk / okolí" },
  { value: "accessibility", label: "Dostupnost" },
  { value: "other", label: "Jiné" },
];

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
  if (score >= t.strong_pick_min_score) return { label: "Silná shoda", cls: "bg-blue-100 text-blue-800" };
  if (score >= t.review_pick_min_score) return { label: "Dobrý fit", cls: "bg-amber-100 text-amber-800" };
  return { label: "Alternativa", cls: "bg-slate-100 text-slate-700" };
}

function feedbackBadge(item: RecommendationItem) {
  const type = item.feedback?.feedback_type;
  if (type === "liked") return { label: "Líbí se", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  if (type === "saved") return { label: "Uloženo", cls: "bg-blue-50 text-blue-800 border-blue-200" };
  if (type === "disliked") return { label: "Nechci", cls: "bg-rose-50 text-rose-800 border-rose-200" };
  return null;
}

function RecommendationCard({
  r,
  thresholds,
  onOpen,
  onPin,
  onFeedback,
  onClearFeedback,
  saving,
}: {
  r: RecommendationItem;
  thresholds: ScoringThresholds;
  onOpen: () => void;
  onPin: () => void;
  onFeedback: (type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: () => void;
  saving: boolean;
}) {
  const match = matchLabel(r.score, thresholds);
  const badge = feedbackBadge(r);
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const [note, setNote] = useState(r.feedback?.note ?? "");

  return (
    <ReamarCard className={cn("overflow-hidden border-slate-200", r.feedback?.feedback_type === "liked" && "border-l-4 border-l-emerald-400", r.feedback?.feedback_type === "saved" && "border-l-4 border-l-blue-400", r.feedback?.feedback_type === "disliked" && "border-l-4 border-l-rose-300")}>
      <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{r.project_name ?? r.unit_external_id ?? "—"}</h3>
              <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", match.cls)}>{match.label}</span>
              {r.pinned_by_broker && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Ve výběru</span>}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {r.layout_label ?? "—"}
              {r.floor_area_m2 != null ? ` · ${Math.round(r.floor_area_m2)} m²` : ""}
              {r.floor != null ? ` · ${r.floor}. patro` : ""}
              {r.district ? ` · ${r.district}` : ""}
            </p>
            <p className="mt-3 text-sm text-slate-700">
              {r.top_strengths?.[0] ?? "Odpovídá zadání klienta."}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold text-slate-900">{r.price_czk != null ? formatCurrencyCzk(r.price_czk) : "—"}</p>
            <div className="mt-2 flex items-center justify-end gap-1">
              <FitDot value={r.budget_fit} title={`Rozpočet ${Math.round(r.budget_fit)}`} />
              <FitDot value={r.location_fit} title={`Lokalita ${Math.round(r.location_fit)}`} />
              <FitDot value={r.layout_fit} title={`Dispozice ${Math.round(r.layout_fit)}`} />
              <FitDot value={r.area_fit} title={`Plocha ${Math.round(r.area_fit)}`} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Proč je tady</p>
            {r.top_strengths?.length ? (
              <ul className="space-y-1 text-sm text-slate-700">
                {r.top_strengths.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Odpovídá rozpočtu a preferencím klienta.</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Na co pozor</p>
            {r.top_compromises?.length ? (
              <ul className="space-y-1 text-sm text-slate-700">
                {r.top_compromises.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
              </ul>
            ) : r.eligibility_reasons?.length ? (
              <ul className="space-y-1 text-sm text-slate-700">
                {r.eligibility_reasons.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Bez výrazného kompromisu.</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Klientský feedback</p>
            {badge ? (
              <div className="mt-2 space-y-2">
                <div className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", badge.cls)}>{badge.label}</div>
                {r.feedback?.dislike_reason && <p className="text-sm text-slate-700">Důvod: {DISLIKE_REASONS.find((x) => x.value === r.feedback?.dislike_reason)?.label ?? r.feedback.dislike_reason}</p>}
                {r.feedback?.note && <p className="text-sm text-slate-600 italic">„{r.feedback.note}“</p>}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Klient zatím nereagoval.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Akce</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ReamarButton variant={r.feedback?.feedback_type === "liked" ? "primary" : "subtle"} size="sm" onClick={() => onFeedback("liked")} disabled={saving}>Líbí se mi</ReamarButton>
              <ReamarButton variant={r.feedback?.feedback_type === "saved" ? "primary" : "subtle"} size="sm" onClick={() => onFeedback("saved")} disabled={saving}>Uložit</ReamarButton>
              <ReamarButton variant={r.feedback?.feedback_type === "disliked" ? "primary" : "subtle"} size="sm" onClick={() => setDislikeOpen((v) => !v)} disabled={saving}>Nechci</ReamarButton>
              {r.feedback && <ReamarButton variant="ghost" size="sm" onClick={onClearFeedback} disabled={saving}>Změnit názor</ReamarButton>}
            </div>
          </div>
        </div>
      </div>

      {dislikeOpen && (
        <div className="border-t border-rose-100 bg-rose-50/70 px-5 py-4">
          <p className="text-sm font-medium text-slate-900">Co klientovi nesedí?</p>
          <p className="mt-1 text-xs text-slate-600">Pomůže to zpřesnit další výběr.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DISLIKE_REASONS.map((reason) => (
              <button
                key={reason.value}
                type="button"
                className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-rose-300 hover:bg-rose-100"
                onClick={() => {
                  onFeedback("disliked", { dislikeReason: reason.value, note: reason.value === "other" ? note || null : null });
                  if (reason.value !== "other") setDislikeOpen(false);
                }}
                disabled={saving}
              >
                {reason.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={reamarInputClass} placeholder="Upřesnění (volitelné)" />
            <ReamarButton size="sm" variant="subtle" onClick={() => { onFeedback("disliked", { dislikeReason: "other", note: note || null }); setDislikeOpen(false); }} disabled={saving}>Uložit</ReamarButton>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
        <div className="text-xs text-slate-400">Shoda {Math.round(r.score)} %</div>
        <div className="flex items-center gap-2">
          <ReamarButton variant={r.pinned_by_broker ? "primary" : "subtle"} size="sm" onClick={onPin}>{r.pinned_by_broker ? "Ve výběru" : "Přidat do výběru"}</ReamarButton>
          <ReamarButton variant="ghost" size="sm" onClick={onOpen}>Otevřít</ReamarButton>
          {r.unit_external_id && <Link href={`/units/${encodeURIComponent(r.unit_external_id)}`} className="text-xs text-slate-500 hover:underline">Detail</Link>}
        </div>
      </div>
    </ReamarCard>
  );
}

function RecommendationSection({
  title,
  subtitle,
  items,
  thresholds,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  feedbackSavingId,
}: {
  title: string;
  subtitle: string;
  items: RecommendationItem[];
  thresholds: ScoringThresholds;
  onPin: (item: RecommendationItem) => void;
  onOpen: (item: RecommendationItem) => void;
  onFeedback: (item: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: (item: RecommendationItem) => void;
  feedbackSavingId: number | null;
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <div className="space-y-4">
        {items.map((r) => (
          <RecommendationCard
            key={r.rec_id}
            r={r}
            thresholds={thresholds}
            onPin={() => onPin(r)}
            onOpen={() => onOpen(r)}
            onFeedback={(type, options) => onFeedback(r, type, options)}
            onClearFeedback={() => onClearFeedback(r)}
            saving={feedbackSavingId === r.rec_id}
          />
        ))}
      </div>
    </section>
  );
}

export default function RecommendationsPage() {
  const {
    client,
    recs,
    loading,
    error,
    hydrated,
    token,
    recomputing,
    router,
    handleRecompute,
    handlePin,
    handleRecommendationFeedback,
    clearRecommendationFeedback,
    feedbackSavingId,
  } = useCaseData();
  const thresholds = useThresholds(token);

  const grouped = useMemo(() => {
    let strong = recs.filter((r) => r.eligibility !== "review" && r.score >= thresholds.strong_pick_min_score);
    let review = recs.filter((r) => r.eligibility === "review" || (r.eligibility !== "review" && r.score >= thresholds.review_pick_min_score && r.score < thresholds.strong_pick_min_score));
    let fallback = recs.filter((r) => r.eligibility !== "review" && r.score < thresholds.review_pick_min_score);
    if (thresholds.max_strong_picks > 0 && strong.length > thresholds.max_strong_picks) {
      review = [...strong.slice(thresholds.max_strong_picks), ...review];
      strong = strong.slice(0, thresholds.max_strong_picks);
    }
    if (thresholds.max_review_picks > 0 && review.length > thresholds.max_review_picks) {
      fallback = [...review.slice(thresholds.max_review_picks), ...fallback];
      review = review.slice(0, thresholds.max_review_picks);
    }
    return { strong, review, fallback };
  }, [recs, thresholds]);

  const likedCount = recs.filter((r) => r.feedback?.feedback_type === "liked").length;
  const savedCount = recs.filter((r) => r.feedback?.feedback_type === "saved").length;
  const dislikedCount = recs.filter((r) => r.feedback?.feedback_type === "disliked").length;

  if (!hydrated) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Načítání…</div></div>;
  if (!token) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Nejste přihlášen. Přejděte na <Link href="/login" className="text-slate-900 underline">/login</Link>.</div></div>;
  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-600">Klient nenalezen.</p>;

  return (
    <div className="space-y-6">
      <ReamarCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Doporučení</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Doporučení pro {client.name}</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Vybrané nabídky, které nejlépe odpovídají zadání. U každé uvidíte proč je v seznamu, na co si dát pozor a jak na ni klient reagoval.</p>
          </div>
          <div className="flex gap-2">
            <ReamarButton type="button" variant="subtle" size="sm" onClick={() => router.push(`/cases/${client.id}/brief`)}>Upravit zadání</ReamarButton>
            <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>{recomputing ? "Přepočítávám…" : "Přepočítat doporučení"}</ReamarButton>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">Celkem</p><p className="mt-1 text-2xl font-semibold text-slate-900">{recs.length}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] uppercase tracking-wide text-emerald-700">Líbí se</p><p className="mt-1 text-2xl font-semibold text-emerald-900">{likedCount}</p></div>
          <div className="rounded-xl bg-blue-50 p-3"><p className="text-[11px] uppercase tracking-wide text-blue-700">Uloženo</p><p className="mt-1 text-2xl font-semibold text-blue-900">{savedCount}</p></div>
          <div className="rounded-xl bg-rose-50 p-3"><p className="text-[11px] uppercase tracking-wide text-rose-700">Nechci</p><p className="mt-1 text-2xl font-semibold text-rose-900">{dislikedCount}</p></div>
        </div>
      </ReamarCard>

      <RecommendationSection
        title="Nejlepší shoda"
        subtitle="Nejsilnější kandidáti — vhodní do výběru pro klienta."
        items={grouped.strong}
        thresholds={thresholds}
        onPin={(r) => handlePin(r.rec_id, r.pinned_by_broker)}
        onOpen={(r) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`)}
        onFeedback={(r, type, options) => handleRecommendationFeedback(r.rec_id, type, options)}
        onClearFeedback={(r) => clearRecommendationFeedback(r.rec_id)}
        feedbackSavingId={feedbackSavingId}
      />

      <RecommendationSection
        title="K prověření"
        subtitle="Dobré varianty, ale s jedním nebo dvěma otazníky."
        items={grouped.review}
        thresholds={thresholds}
        onPin={(r) => handlePin(r.rec_id, r.pinned_by_broker)}
        onOpen={(r) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`)}
        onFeedback={(r, type, options) => handleRecommendationFeedback(r.rec_id, type, options)}
        onClearFeedback={(r) => clearRecommendationFeedback(r.rec_id)}
        feedbackSavingId={feedbackSavingId}
      />

      <RecommendationSection
        title="Alternativy"
        subtitle="Záložní varianty pro případ, že hlavní výběr nevyjde."
        items={grouped.fallback}
        thresholds={thresholds}
        onPin={(r) => handlePin(r.rec_id, r.pinned_by_broker)}
        onOpen={(r) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`)}
        onFeedback={(r, type, options) => handleRecommendationFeedback(r.rec_id, type, options)}
        onClearFeedback={(r) => clearRecommendationFeedback(r.rec_id)}
        feedbackSavingId={feedbackSavingId}
      />

      {recs.filter((r) => r.pinned_by_broker).length > 0 && (
        <ReamarCard className="p-5 text-center">
          <p className="text-sm text-slate-600">Máte <span className="font-semibold">{recs.filter((r) => r.pinned_by_broker).length}</span> {recs.filter((r) => r.pinned_by_broker).length === 1 ? "jednotku" : recs.filter((r) => r.pinned_by_broker).length < 5 ? "jednotky" : "jednotek"} ve výběru.</p>
          <ReamarButton variant="primary" size="sm" className="mt-3" onClick={() => router.push(`/cases/${client.id}/shortlist`)}>Přejít na výběr</ReamarButton>
        </ReamarCard>
      )}
    </div>
  );
}

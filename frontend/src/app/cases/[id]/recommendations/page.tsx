"use client";

import Link from "next/link";
import clsx from "clsx";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const RecommendationsMap = dynamic(() => import("./RecommendationsMap"), { ssr: false });

import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk } from "@/lib/format";
import { FitDot } from "@/components/case/ScoreUtils";
import { FunnelCard } from "@/components/case/FunnelCard";
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

function StatusBadge({ r }: { r: RecommendationItem }) {
  const pinned = r.pinned_by_broker;
  const fbType = r.feedback?.feedback_type;
  if (pinned && fbType === "liked") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">★ Ve výběru · ♥</span>;
  }
  if (pinned) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">★ Ve výběru</span>;
  }
  if (fbType === "liked") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">♥ Líbí se</span>;
  }
  if (fbType === "saved") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-800">Uloženo</span>;
  }
  if (fbType === "disliked") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-800">✕ Nechci</span>;
  }
  return <span className="text-xs text-slate-300">—</span>;
}

/* ────────────────────────────────────────────────────────── */
/*  Inline dislike panel (shared between card + table row)   */
/* ────────────────────────────────────────────────────────── */

function DislikePanel({
  onFeedback,
  onClose,
  saving,
}: {
  onFeedback: (type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [note, setNote] = useState("");
  return (
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
              if (reason.value !== "other") onClose();
            }}
            disabled={saving}
          >
            {reason.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={reamarInputClass} placeholder="Upřesnění (volitelné)" />
        <ReamarButton size="sm" variant="subtle" onClick={() => { onFeedback("disliked", { dislikeReason: "other", note: note || null }); onClose(); }} disabled={saving}>Uložit</ReamarButton>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Original card view (kept intact)                         */
/* ────────────────────────────────────────────────────────── */

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
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Feedback</p>
            {badge ? (
              <div className="mt-2 space-y-2">
                <div className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", badge.cls)}>{badge.label}</div>
                {r.feedback?.dislike_reason && <p className="text-sm text-slate-700">Důvod: {DISLIKE_REASONS.find((x) => x.value === r.feedback?.dislike_reason)?.label ?? r.feedback.dislike_reason}</p>}
                {r.feedback?.note && <p className="text-sm text-slate-600 italic">„{r.feedback.note}"</p>}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Zatím bez feedbacku.</p>
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

/* ────────────────────────────────────────────────────────── */
/*  Units table view — compact, dense, sortable              */
/* ────────────────────────────────────────────────────────── */

type SortKey = "score" | "price_czk" | "floor_area_m2" | "price_per_m2_czk" | "exterior_area_m2" | "floor";
type SortDir = "asc" | "desc";

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={cn("cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900", className)}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="ml-1">{currentDir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function UnitRow({
  r,
  thresholds,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  saving,
}: {
  r: RecommendationItem;
  thresholds: ScoringThresholds;
  onPin: () => void;
  onOpen: () => void;
  onFeedback: (type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: () => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const match = matchLabel(r.score, thresholds);
  const fbType = r.feedback?.feedback_type;

  return (
    <>
      <tr
        className={cn(
          "border-b border-slate-100 text-sm hover:bg-slate-50/80 transition-colors cursor-pointer",
          fbType === "liked" && "bg-emerald-50/40",
          fbType === "saved" && "bg-blue-50/40",
          fbType === "disliked" && "bg-rose-50/40 opacity-60",
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Score */}
        <td className="px-3 py-2.5 text-center">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold", match.cls)}>
            {Math.round(r.score)}
          </span>
        </td>
        {/* Project */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-900 truncate max-w-[200px]">{r.project_name ?? "—"}</span>
          </div>
          {r.district && <p className="text-[11px] text-slate-400">{r.district}</p>}
        </td>
        {/* Layout */}
        <td className="px-3 py-2.5 text-slate-700">{r.layout_label ?? "—"}</td>
        {/* Area */}
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.floor_area_m2 != null ? `${Math.round(r.floor_area_m2)} m²` : "—"}</td>
        {/* Ext area */}
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.exterior_area_m2 != null ? `${Math.round(r.exterior_area_m2)} m²` : "—"}</td>
        {/* Floor */}
        <td className="px-3 py-2.5 text-center tabular-nums text-slate-700">{r.floor ?? "—"}</td>
        {/* Price */}
        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">{r.price_czk != null ? formatCurrencyCzk(r.price_czk) : "—"}</td>
        {/* Price/m² */}
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 text-xs">{r.price_per_m2_czk != null ? formatCurrencyCzk(r.price_per_m2_czk) : "—"}</td>
        {/* Fit dots */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            <FitDot value={r.budget_fit} title={`Rozpočet ${Math.round(r.budget_fit)}`} />
            <FitDot value={r.location_fit} title={`Lokalita ${Math.round(r.location_fit)}`} />
            <FitDot value={r.area_fit} title={`Plocha ${Math.round(r.area_fit)}`} />
            <FitDot value={r.outdoor_fit} title={`Exteriér ${Math.round(r.outdoor_fit)}`} />
          </div>
        </td>
        {/* Status */}
        <td className="px-3 py-2.5">
          <StatusBadge r={r} />
        </td>
        {/* Quick actions — pin is primary */}
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={r.pinned_by_broker ? "Odebrat z výběru" : "Do výběru"}
              className={cn("rounded-full px-1.5 py-1 text-xs font-medium transition-colors", r.pinned_by_broker ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "text-slate-400 hover:bg-amber-50 hover:text-amber-600")}
              onClick={onPin}
            >★</button>
            <button
              type="button"
              title="Líbí se"
              className={cn("rounded-full p-1 text-xs", fbType === "liked" ? "bg-emerald-100 text-emerald-700" : "text-slate-400 hover:text-emerald-600")}
              onClick={() => onFeedback("liked")}
              disabled={saving}
            >♥</button>
            <button
              type="button"
              title="Nechci"
              className={cn("rounded-full p-1 text-xs", fbType === "disliked" ? "bg-rose-100 text-rose-700" : "text-slate-400 hover:text-rose-600")}
              onClick={() => setDislikeOpen((v) => !v)}
              disabled={saving}
            >✕</button>
          </div>
        </td>
      </tr>
      {/* Expanded detail row */}
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50/50">
          <td colSpan={11} className="px-5 py-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Proč je tady</p>
                {r.top_strengths?.length ? (
                  <ul className="space-y-0.5 text-sm text-slate-700">
                    {r.top_strengths.slice(0, 3).map((s, i) => <li key={i}>• {s}</li>)}
                  </ul>
                ) : <p className="text-sm text-slate-500">Odpovídá zadání.</p>}
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Na co pozor</p>
                {r.top_compromises?.length ? (
                  <ul className="space-y-0.5 text-sm text-slate-700">
                    {r.top_compromises.slice(0, 3).map((s, i) => <li key={i}>• {s}</li>)}
                  </ul>
                ) : <p className="text-sm text-slate-500">Bez kompromisu.</p>}
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <ReamarButton variant={fbType === "liked" ? "primary" : "subtle"} size="sm" onClick={() => onFeedback("liked")} disabled={saving}>Líbí se mi</ReamarButton>
                <ReamarButton variant={fbType === "saved" ? "primary" : "subtle"} size="sm" onClick={() => onFeedback("saved")} disabled={saving}>Uložit</ReamarButton>
                <ReamarButton variant={r.pinned_by_broker ? "primary" : "subtle"} size="sm" onClick={onPin}>{r.pinned_by_broker ? "Ve výběru" : "Do výběru"}</ReamarButton>
                {r.feedback && <ReamarButton variant="ghost" size="sm" onClick={onClearFeedback} disabled={saving}>Změnit názor</ReamarButton>}
                {r.unit_external_id && <Link href={`/units/${encodeURIComponent(r.unit_external_id)}`} className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Detail</Link>}
              </div>
            </div>
            {dislikeOpen && (
              <DislikePanel
                onFeedback={onFeedback}
                onClose={() => setDislikeOpen(false)}
                saving={saving}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function UnitsTableView({
  recs,
  thresholds,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  feedbackSavingId,
}: {
  recs: RecommendationItem[];
  thresholds: ScoringThresholds;
  onPin: (item: RecommendationItem) => void;
  onOpen: (item: RecommendationItem) => void;
  onFeedback: (item: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: (item: RecommendationItem) => void;
  feedbackSavingId: number | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const arr = [...recs];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [recs, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "score" ? "desc" : "asc");
    }
  };

  return (
    <ReamarCard className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <SortableHeader label="Shoda" sortKey="score" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[70px] text-center" />
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Projekt</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dispozice</th>
              <SortableHeader label="Plocha" sortKey="floor_area_m2" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Ext." sortKey="exterior_area_m2" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Patro" sortKey="floor" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center" />
              <SortableHeader label="Cena" sortKey="price_czk" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Kč/m²" sortKey="price_per_m2_czk" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fit</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stav</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-[90px]">Akce</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <UnitRow
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
          </tbody>
        </table>
      </div>
    </ReamarCard>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Projects grouped view                                    */
/* ────────────────────────────────────────────────────────── */

type ProjectGroup = {
  project_id: number | null;
  project_name: string;
  district: string | null;
  units: RecommendationItem[];
  best_score: number;
  avg_score: number;
  price_range: [number | null, number | null];
  area_range: [number | null, number | null];
  ext_area_range: [number | null, number | null];
  layouts: string[];
  liked_count: number;
  pinned_count: number;
  disliked_count: number;
  construction_completion: string | null;
};

function buildProjectGroups(recs: RecommendationItem[]): ProjectGroup[] {
  const map = new Map<number | null, RecommendationItem[]>();
  for (const r of recs) {
    const key = r.project_id ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const groups: ProjectGroup[] = [];
  for (const [pid, units] of map) {
    const sorted = [...units].sort((a, b) => b.score - a.score);
    const prices = units.map((u) => u.price_czk).filter((p): p is number => p != null);
    const areas = units.map((u) => u.floor_area_m2).filter((a): a is number => a != null);
    const extAreas = units.map((u) => u.exterior_area_m2).filter((a): a is number => a != null);
    const layouts = [...new Set(units.map((u) => u.layout_label).filter(Boolean))] as string[];
    groups.push({
      project_id: pid,
      project_name: sorted[0].project_name ?? sorted[0].unit_external_id ?? "Neznámý projekt",
      district: sorted[0].district ?? null,
      units: sorted,
      best_score: sorted[0].score,
      avg_score: Math.round(units.reduce((s, u) => s + u.score, 0) / units.length),
      price_range: [prices.length ? Math.min(...prices) : null, prices.length ? Math.max(...prices) : null],
      area_range: [areas.length ? Math.min(...areas) : null, areas.length ? Math.max(...areas) : null],
      ext_area_range: [extAreas.length ? Math.min(...extAreas) : null, extAreas.length ? Math.max(...extAreas) : null],
      layouts,
      liked_count: units.filter((u) => u.feedback?.feedback_type === "liked").length,
      pinned_count: units.filter((u) => u.pinned_by_broker).length,
      disliked_count: units.filter((u) => u.feedback?.feedback_type === "disliked").length,
      construction_completion: sorted[0].construction_completion ?? null,
    });
  }
  groups.sort((a, b) => b.best_score - a.best_score);
  return groups;
}

function ProjectGroupCard({
  group,
  thresholds,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  onBulkPin,
  onBulkDislike,
  onBulkClearFeedback,
  feedbackSavingId,
}: {
  group: ProjectGroup;
  thresholds: ScoringThresholds;
  onPin: (item: RecommendationItem) => void;
  onOpen: (item: RecommendationItem) => void;
  onFeedback: (item: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: (item: RecommendationItem) => void;
  onBulkPin: (units: RecommendationItem[], pin: boolean) => void;
  onBulkDislike: (units: RecommendationItem[]) => void;
  onBulkClearFeedback: (units: RecommendationItem[]) => void;
  feedbackSavingId: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDislike, setConfirmDislike] = useState(false);
  const match = matchLabel(group.best_score, thresholds);
  const allPinned = group.pinned_count === group.units.length;
  const allDisliked = group.disliked_count === group.units.length;
  const unpinnedUnits = group.units.filter((u) => !u.pinned_by_broker);
  const pinnedUnits = group.units.filter((u) => u.pinned_by_broker);
  const nonDislikedUnits = group.units.filter((u) => u.feedback?.feedback_type !== "disliked");
  const dislikedUnits = group.units.filter((u) => u.feedback?.feedback_type === "disliked");

  return (
    <ReamarCard className={cn("overflow-hidden", allDisliked && "opacity-50")}>
      {/* Project header row */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50/80 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold", match.cls)}>
            {Math.round(group.best_score)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 truncate">{group.project_name}</h3>
              {/* Project status chips */}
              {group.pinned_count > 0 && (
                <span className="shrink-0 inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  ★ {group.pinned_count}/{group.units.length}
                </span>
              )}
              {group.liked_count > 0 && <span className="shrink-0 text-[11px] text-emerald-600">♥ {group.liked_count}</span>}
              {group.disliked_count > 0 && <span className="shrink-0 text-[11px] text-rose-500">✕ {group.disliked_count}</span>}
            </div>
            <p className="text-sm text-slate-500">
              {group.district ? `${group.district} · ` : ""}
              {group.units.length} {group.units.length === 1 ? "jednotka" : group.units.length < 5 ? "jednotky" : "jednotek"}
              {group.layouts.length > 0 ? ` · ${group.layouts.join(", ")}` : ""}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
              {group.area_range[0] != null && (
                <span>{group.area_range[0] === group.area_range[1] ? `${Math.round(group.area_range[0]!)} m²` : `${Math.round(group.area_range[0]!)}–${Math.round(group.area_range[1]!)} m²`}</span>
              )}
              {group.ext_area_range[0] != null && group.ext_area_range[0]! > 0 && (
                <span>ext. {group.ext_area_range[0] === group.ext_area_range[1] ? `${Math.round(group.ext_area_range[0]!)} m²` : `${Math.round(group.ext_area_range[0]!)}–${Math.round(group.ext_area_range[1]!)} m²`}</span>
              )}
              {group.construction_completion && parseInt(group.construction_completion.slice(0, 4)) >= 2024 && (
                <span>Dokončení: {group.construction_completion}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            {group.price_range[0] != null && (
              <p className="text-sm font-medium text-slate-900">
                {group.price_range[0] === group.price_range[1]
                  ? formatCurrencyCzk(group.price_range[0]!)
                  : `${formatCurrencyCzk(group.price_range[0]!)} – ${formatCurrencyCzk(group.price_range[1]!)}`}
              </p>
            )}
            <p className="text-xs text-slate-500">Ø shoda {group.avg_score} %</p>
          </div>
          <span className={cn("text-slate-400 transition-transform", expanded && "rotate-180")}>▾</span>
        </div>
      </button>

      {/* Expanded: project actions + unit mini-table */}
      {expanded && (
        <div className="border-t border-slate-100">
          {/* Project-level actions */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/40 px-5 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mr-1">Projekt:</span>
            {allPinned ? (
              <button
                type="button"
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                onClick={(e) => { e.stopPropagation(); onBulkPin(pinnedUnits, false); }}
              >
                ★ Odebrat vše z výběru
              </button>
            ) : (
              <button
                type="button"
                className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 transition-colors"
                onClick={(e) => { e.stopPropagation(); onBulkPin(unpinnedUnits, true); }}
              >
                ★ {group.pinned_count > 0 ? `Přidat zbylých ${unpinnedUnits.length} do výběru` : "Vše do výběru"}
              </button>
            )}
            {!allDisliked && nonDislikedUnits.length > 0 && !confirmDislike && (
              <button
                type="button"
                className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                onClick={(e) => { e.stopPropagation(); setConfirmDislike(true); }}
              >
                ✕ Vyřadit projekt
              </button>
            )}
            {confirmDislike && (
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-rose-700">Vyřadit {nonDislikedUnits.length} {nonDislikedUnits.length === 1 ? "jednotku" : nonDislikedUnits.length < 5 ? "jednotky" : "jednotek"}?</span>
                <button
                  type="button"
                  className="rounded-full border border-rose-300 bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-200 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onBulkDislike(nonDislikedUnits); setConfirmDislike(false); }}
                >
                  Ano, vyřadit
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setConfirmDislike(false); }}
                >
                  Zrušit
                </button>
              </span>
            )}
            {dislikedUnits.length > 0 && (
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={(e) => { e.stopPropagation(); onBulkClearFeedback(dislikedUnits); }}
              >
                Obnovit {allDisliked ? "projekt" : `${dislikedUnits.length} vyřazených`}
              </button>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-center w-[60px]">Shoda</th>
                <th className="px-3 py-2 text-left">Dispozice</th>
                <th className="px-3 py-2 text-right">Plocha</th>
                <th className="px-3 py-2 text-right">Ext.</th>
                <th className="px-3 py-2 text-center">Patro</th>
                <th className="px-3 py-2 text-right">Cena</th>
                <th className="px-3 py-2">Stav</th>
                <th className="px-3 py-2 w-[120px]">Akce</th>
              </tr>
            </thead>
            <tbody>
              {group.units.map((r, idx) => {
                const unitMatch = matchLabel(r.score, thresholds);
                const fbType = r.feedback?.feedback_type;
                const isTop = idx === 0;
                return (
                  <tr
                    key={r.rec_id}
                    className={cn(
                      "border-t border-slate-100 text-sm hover:bg-slate-50/80",
                      fbType === "disliked" && "opacity-50",
                      isTop && "bg-blue-50/30",
                    )}
                  >
                    <td className="px-4 py-2 text-center">
                      <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold", unitMatch.cls)}>
                        {Math.round(r.score)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.layout_label ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.floor_area_m2 != null ? `${Math.round(r.floor_area_m2)} m²` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.exterior_area_m2 != null ? `${Math.round(r.exterior_area_m2)} m²` : "—"}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-slate-700">{r.floor ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{r.price_czk != null ? formatCurrencyCzk(r.price_czk) : "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge r={r} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title={r.pinned_by_broker ? "Odebrat z výběru" : "Do výběru"}
                          className={cn("rounded-full px-1.5 py-1 text-xs font-medium transition-colors", r.pinned_by_broker ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "text-slate-400 hover:bg-amber-50 hover:text-amber-600")}
                          onClick={() => onPin(r)}
                        >★</button>
                        <button
                          type="button"
                          title="Líbí se"
                          className={cn("rounded-full p-1 text-xs", fbType === "liked" ? "bg-emerald-100 text-emerald-700" : "text-slate-400 hover:text-emerald-600")}
                          onClick={() => onFeedback(r, "liked")}
                          disabled={feedbackSavingId === r.rec_id}
                        >♥</button>
                        <button
                          type="button"
                          title="Nechci"
                          className={cn("rounded-full p-1 text-xs", fbType === "disliked" ? "bg-rose-100 text-rose-700" : "text-slate-400 hover:text-rose-600")}
                          onClick={() => onFeedback(r, "disliked")}
                          disabled={feedbackSavingId === r.rec_id}
                        >✕</button>
                        {r.unit_external_id && (
                          <Link href={`/units/${encodeURIComponent(r.unit_external_id)}`} className="rounded-full p-1 text-xs text-slate-400 hover:text-slate-700" title="Detail">↗</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ReamarCard>
  );
}

function ProjectsGroupedView({
  recs,
  thresholds,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  onBulkPin,
  onBulkDislike,
  onBulkClearFeedback,
  feedbackSavingId,
}: {
  recs: RecommendationItem[];
  thresholds: ScoringThresholds;
  onPin: (item: RecommendationItem) => void;
  onOpen: (item: RecommendationItem) => void;
  onFeedback: (item: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: (item: RecommendationItem) => void;
  onBulkPin: (units: RecommendationItem[], pin: boolean) => void;
  onBulkDislike: (units: RecommendationItem[]) => void;
  onBulkClearFeedback: (units: RecommendationItem[]) => void;
  feedbackSavingId: number | null;
}) {
  const groups = useMemo(() => buildProjectGroups(recs), [recs]);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <ProjectGroupCard
          key={g.project_id ?? "unknown"}
          group={g}
          thresholds={thresholds}
          onPin={onPin}
          onOpen={onOpen}
          onFeedback={onFeedback}
          onClearFeedback={onClearFeedback}
          onBulkPin={onBulkPin}
          onBulkDislike={onBulkDislike}
          onBulkClearFeedback={onBulkClearFeedback}
          feedbackSavingId={feedbackSavingId}
        />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  View toggle                                              */
/* ────────────────────────────────────────────────────────── */

type ViewMode = "units" | "projects" | "cards" | "map";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {([
        { key: "projects" as const, label: "Projekty" },
        { key: "units" as const, label: "Jednotky" },
        { key: "map" as const, label: "Mapa" },
        { key: "cards" as const, label: "Karty" },
      ]).map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Quick filters                                            */
/* ────────────────────────────────────────────────────────── */

type QuickFilter = "all" | "pinned" | "hide_disliked" | "undecided";

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "Vše" },
  { key: "pinned", label: "★ Ve výběru" },
  { key: "hide_disliked", label: "Skrýt nechci" },
  { key: "undecided", label: "Bez rozhodnutí" },
];

function applyQuickFilter(recs: RecommendationItem[], filter: QuickFilter): RecommendationItem[] {
  switch (filter) {
    case "pinned":
      return recs.filter((r) => r.pinned_by_broker);
    case "hide_disliked":
      return recs.filter((r) => r.feedback?.feedback_type !== "disliked");
    case "undecided":
      return recs.filter((r) => !r.pinned_by_broker && !r.feedback);
    default:
      return recs;
  }
}

function QuickFilterBar({
  filter,
  onChange,
  counts,
}: {
  filter: QuickFilter;
  onChange: (f: QuickFilter) => void;
  counts: Record<QuickFilter, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {QUICK_FILTERS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            filter === key
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
          )}
          onClick={() => onChange(key)}
        >
          {label}
          <span className={cn("ml-1.5 tabular-nums", filter === key ? "text-slate-300" : "text-slate-400")}>{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Main page component                                      */
/* ────────────────────────────────────────────────────────── */

export default function RecommendationsPage() {
  const {
    client,
    recs,
    recsFunnel,
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
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "projects";
    const saved = localStorage.getItem("reamar_recs_view");
    return (["units", "projects", "cards", "map"] as ViewMode[]).includes(saved as ViewMode)
      ? (saved as ViewMode)
      : "projects";
  });
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => {
    if (typeof window === "undefined") return "hide_disliked";
    const saved = localStorage.getItem("reamar_recs_filter");
    return (["all", "pinned", "hide_disliked", "undecided"] as QuickFilter[]).includes(saved as QuickFilter)
      ? (saved as QuickFilter)
      : "hide_disliked";
  });

  const filteredRecs = useMemo(() => applyQuickFilter(recs, quickFilter), [recs, quickFilter]);

  const filterCounts = useMemo<Record<QuickFilter, number>>(() => ({
    all: recs.length,
    pinned: recs.filter((r) => r.pinned_by_broker).length,
    hide_disliked: recs.filter((r) => r.feedback?.feedback_type !== "disliked").length,
    undecided: recs.filter((r) => !r.pinned_by_broker && !r.feedback).length,
  }), [recs]);

  const grouped = useMemo(() => {
    let strong = filteredRecs.filter((r) => r.eligibility !== "review" && r.score >= thresholds.strong_pick_min_score);
    let review = filteredRecs.filter((r) => r.eligibility === "review" || (r.eligibility !== "review" && r.score >= thresholds.review_pick_min_score && r.score < thresholds.strong_pick_min_score));
    let fallback = filteredRecs.filter((r) => r.eligibility !== "review" && r.score < thresholds.review_pick_min_score);
    if (thresholds.max_strong_picks > 0 && strong.length > thresholds.max_strong_picks) {
      review = [...strong.slice(thresholds.max_strong_picks), ...review];
      strong = strong.slice(0, thresholds.max_strong_picks);
    }
    if (thresholds.max_review_picks > 0 && review.length > thresholds.max_review_picks) {
      fallback = [...review.slice(thresholds.max_review_picks), ...fallback];
      review = review.slice(0, thresholds.max_review_picks);
    }
    return { strong, review, fallback };
  }, [filteredRecs, thresholds]);

  const pinnedCount = filterCounts.pinned;
  const likedCount = recs.filter((r) => r.feedback?.feedback_type === "liked").length;
  const dislikedCount = recs.filter((r) => r.feedback?.feedback_type === "disliked").length;

  // Hidden recommendations
  type HiddenRec = { rec_id: number; unit_id: number; unit_external_id: string | null; project_id: number; project_name: string; layout: string | null; floor_area_m2: number | null; price_czk: number | null; score: number; floor: number | null };
  const [hiddenRecs, setHiddenRecs] = useState<HiddenRec[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenLoading, setHiddenLoading] = useState(false);

  const fetchHidden = async () => {
    if (!client || !token) return;
    setHiddenLoading(true);
    try {
      const res = await fetch(`${API_BASE}/clients/${client.id}/recommendations/hidden`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setHiddenRecs(await res.json());
    } finally { setHiddenLoading(false); }
  };

  const handleUnhide = async (recId: number) => {
    if (!client || !token) return;
    await fetch(`${API_BASE}/clients/${client.id}/recommendations/${recId}/hide`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setHiddenRecs((prev) => prev.filter((r) => r.rec_id !== recId));
  };

  if (!hydrated) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Načítání…</div></div>;
  if (!token) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Nejste přihlášen. Přejděte na <Link href="/login" className="text-slate-900 underline">/login</Link>.</div></div>;
  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-600">Klient nenalezen.</p>;

  const handleBulkPin = (units: RecommendationItem[], pin: boolean) => {
    for (const u of units) {
      handlePin(u.rec_id, !pin);
    }
  };

  const handleBulkDislike = (units: RecommendationItem[]) => {
    for (const u of units) {
      handleRecommendationFeedback(u.rec_id, "disliked");
    }
  };

  const handleBulkClearFeedback = (units: RecommendationItem[]) => {
    for (const u of units) {
      clearRecommendationFeedback(u.rec_id);
    }
  };

  const sharedProps = {
    thresholds,
    onPin: (r: RecommendationItem) => handlePin(r.rec_id, r.pinned_by_broker),
    onOpen: (r: RecommendationItem) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`),
    onFeedback: (r: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => handleRecommendationFeedback(r.rec_id, type, options),
    onClearFeedback: (r: RecommendationItem) => clearRecommendationFeedback(r.rec_id),
    feedbackSavingId,
  };

  return (
    <div className="space-y-6">
      <ReamarCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Doporučení</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Doporučení pro {client.name}</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Vybrané nabídky seřazené podle shody se zadáním.</p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle mode={viewMode} onChange={(m) => { setViewMode(m); localStorage.setItem("reamar_recs_view", m); }} />
            <ReamarButton type="button" variant="subtle" size="sm" onClick={() => router.push(`/cases/${client.id}/brief`)}>Upravit zadání</ReamarButton>
            <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>{recomputing ? "Přepočítávám…" : "Přepočítat doporučení"}</ReamarButton>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">Celkem</p><p className="mt-1 text-2xl font-semibold text-slate-900">{recs.length}</p></div>
          <div className="rounded-xl bg-amber-50 p-3"><p className="text-[11px] uppercase tracking-wide text-amber-700">★ Ve výběru</p><p className="mt-1 text-2xl font-semibold text-amber-900">{pinnedCount}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] uppercase tracking-wide text-emerald-700">♥ Líbí se</p><p className="mt-1 text-2xl font-semibold text-emerald-900">{likedCount}</p></div>
          <div className="rounded-xl bg-rose-50 p-3"><p className="text-[11px] uppercase tracking-wide text-rose-700">✕ Nechci</p><p className="mt-1 text-2xl font-semibold text-rose-900">{dislikedCount}</p></div>
        </div>
      </ReamarCard>

      {/* Filter funnel (Phase 7b) */}
      {recsFunnel && <FunnelCard funnel={recsFunnel} />}

      {/* Quick filters */}
      <QuickFilterBar filter={quickFilter} onChange={(f) => { setQuickFilter(f); localStorage.setItem("reamar_recs_filter", f); }} counts={filterCounts} />

      {/* Filtered count hint */}
      {quickFilter !== "all" && (
        <p className="text-xs text-slate-500">Zobrazeno {filteredRecs.length} z {recs.length} doporučení</p>
      )}

      {/* Units table view */}
      {viewMode === "units" && (
        <UnitsTableView recs={filteredRecs} {...sharedProps} />
      )}

      {/* Projects grouped view */}
      {viewMode === "projects" && (
        <ProjectsGroupedView recs={filteredRecs} {...sharedProps} onBulkPin={handleBulkPin} onBulkDislike={handleBulkDislike} onBulkClearFeedback={handleBulkClearFeedback} />
      )}

      {/* Map view */}
      {viewMode === "map" && (
        <RecommendationsMap recs={filteredRecs} />
      )}

      {/* Original cards view */}
      {viewMode === "cards" && (
        <>
          <RecommendationSection
            title="Nejlepší shoda"
            subtitle="Nejsilnější kandidáti — vhodní do výběru."
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
        </>
      )}

      {pinnedCount > 0 && (
        <ReamarCard className="border-amber-200 bg-amber-50/50 p-5 text-center">
          <p className="text-sm text-slate-700">★ <span className="font-semibold">{pinnedCount}</span> {pinnedCount === 1 ? "jednotka" : pinnedCount < 5 ? "jednotky" : "jednotek"} ve výběru</p>
          <ReamarButton variant="primary" size="sm" className="mt-3" onClick={() => router.push(`/cases/${client.id}/shortlist`)}>Přejít na výběr</ReamarButton>
        </ReamarCard>
      )}

      {/* Hidden recommendations */}
      <div className="mt-6 border-t border-slate-200 pt-4">
        <button
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          onClick={() => { setShowHidden((v) => !v); if (!showHidden && hiddenRecs.length === 0) fetchHidden(); }}
        >
          <span>{showHidden ? "▾" : "▸"}</span>
          <span>Skryté jednotky</span>
          {hiddenRecs.length > 0 && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium">{hiddenRecs.length}</span>}
        </button>
        {showHidden && (
          <div className="mt-3 space-y-2">
            {hiddenLoading && <p className="text-xs text-slate-400">Načítám…</p>}
            {!hiddenLoading && hiddenRecs.length === 0 && <p className="text-xs text-slate-400">Žádné skryté jednotky.</p>}
            {hiddenRecs.map((hr) => (
              <div key={hr.rec_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{hr.project_name}</p>
                  <p className="text-xs text-slate-500">
                    {hr.layout && <span>{hr.layout} · </span>}
                    {hr.floor_area_m2 && <span>{hr.floor_area_m2} m² · </span>}
                    {hr.price_czk && <span>{formatCurrencyCzk(hr.price_czk)} · </span>}
                    <span>Skóre: {hr.score.toFixed(0)}</span>
                  </p>
                </div>
                <button
                  className="ml-4 shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() => handleUnhide(hr.rec_id)}
                >
                  Odkrýt
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

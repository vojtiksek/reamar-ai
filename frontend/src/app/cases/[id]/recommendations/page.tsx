"use client";

import Link from "next/link";
import clsx from "clsx";
import dynamic from "next/dynamic";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  WizardExtras,
} from "@/lib/caseTypes";
import type { WorkingFilters } from "@/lib/clientMode";
import type { WalkabilityPreferences, WalkabilityPreferenceValue } from "@/lib/walkabilityPreferences";
import { DEFAULT_PREFERENCES as WALK_DEFAULTS, getNonDefaultChips, savePreferences as saveWalkPrefs } from "@/lib/walkabilityPreferences";
import { QuickEdit } from "../brief/QuickEdit";
import { UnitInspectorV2 } from "./UnitInspectorV2";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

function NoiseBadge({ label }: { label?: string | null }) {
  if (!label) return null;
  const lower = label.toLowerCase();
  const cls = lower.includes("nízký") || lower.includes("nizky")
    ? "bg-emerald-100 text-emerald-700"
    : lower.includes("vyšší") || lower.includes("vysoký")
    ? "bg-rose-100 text-rose-700"
    : "bg-slate-100 text-slate-500";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>Hluk: {lower}</span>;
}

function PriceDiffBadge({ pct }: { pct?: number | null }) {
  if (pct == null) return <span className="text-slate-300">—</span>;
  if (pct <= -5) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{Math.round(pct)} %</span>;
  if (pct >= 5) return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">+{Math.round(pct)} %</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">±trh</span>;
}

function ComparisonModal({
  units,
  commuteLabels,
  onClose,
  onRemove,
  onClear,
}: {
  units: RecommendationItem[];
  commuteLabels: string[];
  onClose: () => void;
  onRemove: (recId: number) => void;
  onClear: () => void;
}) {
  if (!units.length) return null;
  const fmt = (n: number | null | undefined, suffix = "") =>
    n == null ? "—" : `${Math.round(n).toLocaleString("cs-CZ")}${suffix}`;
  const fmtCzk = (n: number | null | undefined) =>
    n == null ? "—" : formatCurrencyCzk(n);
  const getCommuteMin = (u: RecommendationItem, label: string): number | null => {
    const details = (u.reason?.commute_details ?? []) as Array<{ label?: string; minutes?: number | null }>;
    const d = details.find((x) => x.label === label);
    return d?.minutes ?? null;
  };

  type Row = { label: string; render: (u: RecommendationItem) => React.ReactNode };
  const rows: Row[] = [
    { label: "Projekt", render: (u) => u.project_name ?? "—" },
    { label: "Dispozice", render: (u) => u.layout_label ?? u.layout ?? "—" },
    { label: "Patro", render: (u) => (u.floor == null ? "—" : `${u.floor}. p.`) },
    { label: "Plocha", render: (u) => fmt(u.floor_area_m2, " m²") },
    { label: "Exteriér", render: (u) => fmt(u.exterior_area_m2, " m²") },
    { label: "Cena", render: (u) => fmtCzk(u.price_czk) },
    { label: "Kč/m²", render: (u) => fmtCzk(u.price_per_m2_czk) },
    { label: "Odchylka od trhu", render: (u) => (u.price_diff_pct == null ? "—" : `${Math.round(u.price_diff_pct)} %`) },
    { label: "Shoda", render: (u) => `${Math.round(u.score)}` },
    { label: "Rozpočet fit", render: (u) => `${Math.round(u.budget_fit)}` },
    { label: "Lokalita fit", render: (u) => `${Math.round(u.location_fit)}` },
    { label: "Dispozice fit", render: (u) => `${Math.round(u.layout_fit)}` },
    { label: "Plocha fit", render: (u) => `${Math.round(u.area_fit)}` },
    { label: "Exteriér fit", render: (u) => `${Math.round(u.outdoor_fit)}` },
    { label: "Walkability", render: (u) => `${Math.round(u.walkability_fit)}` },
    { label: "Dojezd", render: (u) => (u.commute_fit == null ? "—" : `${Math.round(u.commute_fit)}`) },
    { label: "Okolí hluk", render: (u) => u.noise_label ?? "—" },
    { label: "Dokončení", render: (u) => u.construction_completion ?? "—" },
  ];
  for (const cl of commuteLabels) {
    rows.push({
      label: `↦ ${cl}`,
      render: (u) => {
        const m = getCommuteMin(u, cl);
        return m == null ? "—" : `${m} min`;
      },
    });
  }

  const body = (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50"
      onClick={onClose}
    >
      <div
        className="my-6 mx-4 flex w-full max-w-[1400px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="font-semibold text-slate-900">Porovnání jednotek</div>
            <span className="text-xs text-slate-500">{units.length} jednotek</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Vymazat výběr
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Zavřít ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 z-10 bg-white border-b border-slate-200">
                <th className="sticky left-0 z-20 bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-[160px]">Atribut</th>
                {units.map((u) => (
                  <th
                    key={u.rec_id}
                    className="px-3 py-2 text-left font-semibold text-slate-800 min-w-[180px] border-l border-slate-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[13px]">{u.project_name ?? "—"}</div>
                        <div className="text-[11px] text-slate-500">{u.unit_external_id ?? ""}</div>
                      </div>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-600 text-xs"
                        onClick={() => onRemove(u.rec_id)}
                        title="Odebrat z porovnání"
                      >
                        ✕
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 w-[160px]">
                    {row.label}
                  </td>
                  {units.map((u) => (
                    <td key={u.rec_id} className="px-3 py-1.5 text-slate-800 border-l border-slate-100">
                      {row.render(u)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}

function RecsToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <span style={{ fontSize: 16 }}>✓</span>
      <span>{message}</span>
      <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Zavřít">✕</button>
    </div>
  );
}

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] leading-tight text-white opacity-0 group-hover/tip:opacity-100 transition-opacity duration-0 z-50">
        {text}
      </span>
    </span>
  );
}

function NearSourceBadges({ tramM, railM, roadM }: { tramM?: number | null; railM?: number | null; roadM?: number | null }) {
  const badges: { label: string; tip: string }[] = [];
  if (tramM != null && tramM <= 150) badges.push({ label: "Tram", tip: `Tramvajová trať ${Math.round(tramM)} m` });
  if (railM != null && railM <= 200) badges.push({ label: "Vlak", tip: `Železnice ${Math.round(railM)} m` });
  if (roadM != null && roadM <= 80) badges.push({ label: "Silnice", tip: `Hlavní silnice ${Math.round(roadM)} m` });
  if (!badges.length) return null;
  return (
    <>
      {badges.map((b) => (
        <Tip key={b.label} text={b.tip}>
          <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">{b.label}</span>
        </Tip>
      ))}
    </>
  );
}

const POI_EMOJI: Record<string, string> = {
  cafe: "☕",
  restaurant: "🍽️",
  park: "🌳",
  fitness: "🏋️",
  playground: "🛝",
  supermarket: "🛒",
  primary_school: "🎓",
  kindergarten: "👶",
};

const POI_LABELS: Record<string, string> = {
  supermarket: "Obchod",
  park: "Parky",
  cafe: "Kavárny",
  restaurant: "Restaurace",
  fitness: "Fitness",
  playground: "Hřiště",
  kindergarten: "Školka",
  primary_school: "ZŠ",
};

function PoiBadges({ poiCounts, activePrefs }: { poiCounts?: Record<string, number> | null; activePrefs: string[] }) {
  if (!poiCounts) return null;
  const source = activePrefs.length
    ? activePrefs.filter((k) => (poiCounts[k] ?? 0) > 0)
    : Object.keys(POI_LABELS).filter((k) => (poiCounts[k] ?? 0) > 0);
  const badges = source.slice(0, 6);
  if (!badges.length) return null;
  const isFallback = activePrefs.length === 0;
  return (
    <>
      {badges.map((k) => (
        <Tip key={k} text={`${POI_LABELS[k] ?? k}: ${poiCounts[k]} do 500 m`}>
          <span
            className={cn(
              "rounded-full border px-1 py-0.5 text-[10px] font-medium",
              isFallback
                ? "bg-slate-50 border-slate-200 text-slate-600"
                : "bg-teal-50 border-teal-200 text-teal-700",
            )}
          >
            {POI_EMOJI[k] ?? k} {poiCounts[k]}
          </span>
        </Tip>
      ))}
    </>
  );
}

const MHD_CONFIG: { key: "metro" | "tram" | "bus" | "train"; field: "distance_to_metro_station_m" | "distance_to_tram_stop_m" | "distance_to_bus_stop_m" | "distance_to_train_station_m"; threshold: number; emoji: string; label: string }[] = [
  { key: "metro", field: "distance_to_metro_station_m", threshold: 600, emoji: "🚇", label: "Metro" },
  { key: "tram",  field: "distance_to_tram_stop_m",     threshold: 300, emoji: "🚋", label: "Tramvaj" },
  { key: "bus",   field: "distance_to_bus_stop_m",      threshold: 200, emoji: "🚌", label: "Bus" },
  { key: "train", field: "distance_to_train_station_m", threshold: 1000, emoji: "🚆", label: "Vlak" },
];

function MhdBadges({ rec, activePrefs }: { rec: RecommendationItem; activePrefs: string[] }) {
  const isFallback = activePrefs.length === 0;
  const badges = MHD_CONFIG.filter(({ key, field, threshold }) => {
    if (!isFallback && !activePrefs.includes(key)) return false;
    const d = rec[field];
    return d != null && d <= threshold;
  });
  if (!badges.length) return null;
  return (
    <>
      {badges.map(({ key, field, emoji, label }) => {
        const d = rec[field];
        return (
          <Tip key={key} text={`${label} ${Math.round(d!)} m`}>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                isFallback
                  ? "bg-slate-50 border-slate-200 text-slate-600"
                  : "bg-blue-50 border-blue-200 text-blue-700",
              )}
            >
              {emoji} {Math.round(d!)} m
            </span>
          </Tip>
        );
      })}
    </>
  );
}

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
              {r.noise_label && <span className="ml-2"><NoiseBadge label={r.noise_label} /></span>}
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

type SortKey = "score" | "price_czk" | "floor_area_m2" | "price_per_m2_czk" | "exterior_area_m2" | "floor" | "price_diff_pct" | "commute_sum";
type SortDir = "asc" | "desc";

type CommuteDetailItem = { label: string; mode: string; minutes: number; max_minutes: number; priority: string; passed: boolean; is_estimated?: boolean };

/** Extract commute minutes for a given label from reason_json. */
function getCommuteMinutes(r: RecommendationItem, label: string): number | null {
  const details = (r.reason?.commute_details ?? []) as CommuteDetailItem[];
  const d = details.find((d) => d.label === label);
  return d ? d.minutes : null;
}

/** Sum commute minutes for selected labels. Null if no data at all. */
function getCommuteSumMinutes(r: RecommendationItem, labels: string[]): number | null {
  if (!labels.length) return null;
  let sum = 0;
  let hasAny = false;
  for (const label of labels) {
    const m = getCommuteMinutes(r, label);
    if (m != null) { sum += m; hasAny = true; }
  }
  return hasAny ? sum : null;
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className,
  tip,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
  tip?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={cn("cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900", className)}
      onClick={() => onSort(sortKey)}
    >
      {tip ? <Tip text={tip}><span>{label}</span></Tip> : label}
      {active && <span className="ml-1">{currentDir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function UnitRow({
  r,
  thresholds,
  activePoiPrefs,
  commuteLabels,
  selectedCommuteLabels,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  saving,
  compareChecked,
  onToggleCompare,
}: {
  r: RecommendationItem;
  thresholds: ScoringThresholds;
  activePoiPrefs: string[];
  commuteLabels: string[];
  selectedCommuteLabels: string[];
  onPin: () => void;
  onOpen: () => void;
  onFeedback: (type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: () => void;
  saving: boolean;
  compareChecked?: boolean;
  onToggleCompare?: () => void;
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
        {/* Compare checkbox */}
        {onToggleCompare && (
          <td className="px-1 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={!!compareChecked}
              onChange={onToggleCompare}
              aria-label="Přidat do porovnání"
              className="h-4 w-4 rounded border-slate-300 text-slate-700"
            />
          </td>
        )}
        {/* Score */}
        <td className="px-3 py-2.5 text-center">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold", match.cls)}>
            {Math.round(r.score)}
          </span>
        </td>
        {/* Project */}
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-900 truncate max-w-[200px]">{r.project_name ?? "—"}</span>
            {r.noise_label && <NoiseBadge label={r.noise_label} />}
            <NearSourceBadges tramM={r.distance_to_tram_tracks_m} railM={r.distance_to_railway_m} roadM={r.distance_to_primary_road_m} />
          </div>
          {(r.district || r.construction_completion) && (
            <p className="text-[11px] text-slate-400">
              {r.district}{r.district && r.construction_completion ? " · " : ""}{r.construction_completion ? `Dokončení: ${r.construction_completion}` : ""}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap gap-1">
            <MhdBadges rec={r} activePrefs={activePoiPrefs} />
            <PoiBadges poiCounts={r.poi_counts} activePrefs={activePoiPrefs} />
          </div>
          {r.eligibility === "review" && r.eligibility_reasons?.length ? (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {r.eligibility_reasons.map((reason, i) => (
                <span key={i} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title={reason}>
                  ⚠ {reason.replace(/\s*\(data missing\)/i, "").replace(/_/g, " ")}
                </span>
              ))}
            </div>
          ) : null}
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
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 text-xs">{r.price_per_m2_czk != null ? `${Math.round(r.price_per_m2_czk / 1000)}k Kč` : "—"}</td>
        {/* Market deviation */}
        <td className="px-3 py-2.5 text-center"><PriceDiffBadge pct={r.price_diff_pct} /></td>
        {/* Commute columns */}
        {commuteLabels.map((label) => {
          const details = (r.reason?.commute_details ?? []) as CommuteDetailItem[];
          const d = details.find((cd) => cd.label === label);
          const isSelected = selectedCommuteLabels.includes(label);
          if (!d) return <td key={label} className="px-2 py-2.5 text-center text-xs text-slate-300">—</td>;
          return (
            <td key={label} className={cn("px-2 py-2.5 text-center tabular-nums text-xs", isSelected && "bg-sky-50/50")}>
              <span className={cn(
                d.passed ? "text-slate-700" : "text-rose-600 font-medium",
              )}>
                {d.is_estimated && "~"}{Math.round(d.minutes)} min
              </span>
            </td>
          );
        })}
        {/* Commute sum */}
        {commuteLabels.length > 0 && (() => {
          const sum = getCommuteSumMinutes(r, commuteLabels);
          return (
            <td className="px-2 py-2.5 text-center tabular-nums text-xs font-medium text-slate-600">
              {sum != null ? `${Math.round(sum)} min` : "—"}
            </td>
          );
        })()}
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
          <td colSpan={10 + commuteLabels.length + (commuteLabels.length > 0 ? 1 : 0) + (onToggleCompare ? 1 : 0)} className="px-5 py-4">
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
  activePoiPrefs,
  commuteLabels,
  onPin,
  onOpen,
  onFeedback,
  onClearFeedback,
  feedbackSavingId,
  compareIds,
  onToggleCompare,
}: {
  recs: RecommendationItem[];
  thresholds: ScoringThresholds;
  activePoiPrefs: string[];
  commuteLabels: string[];
  onPin: (item: RecommendationItem) => void;
  onOpen: (item: RecommendationItem) => void;
  onFeedback: (item: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => void;
  onClearFeedback: (item: RecommendationItem) => void;
  feedbackSavingId: number | null;
  compareIds?: Set<number>;
  onToggleCompare?: (recId: number) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Multi-select commute labels for combined sort
  const [selectedCommuteLabels, setSelectedCommuteLabels] = useState<string[]>([]);

  const sorted = useMemo(() => {
    const arr = [...recs];
    arr.sort((a, b) => {
      if (sortKey === "commute_sum") {
        const sortLabels = selectedCommuteLabels.length > 0 ? selectedCommuteLabels : commuteLabels;
        const av = getCommuteSumMinutes(a, sortLabels);
        const bv = getCommuteSumMinutes(b, sortLabels);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const av = a[sortKey as keyof RecommendationItem] as number | null | undefined;
      const bv = b[sortKey as keyof RecommendationItem] as number | null | undefined;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [recs, sortKey, sortDir, selectedCommuteLabels]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "score" ? "desc" : "asc");
    }
  };

  const toggleCommuteLabel = (label: string) => {
    setSelectedCommuteLabels((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      if (next.length > 0) {
        setSortKey("commute_sum");
        setSortDir("asc");
      } else {
        setSortKey("score");
        setSortDir("desc");
      }
      return next;
    });
  };

  return (
    <ReamarCard className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {onToggleCompare && (
                <th className="w-[32px] px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="Vybrat pro porovnání">⇌</th>
              )}
              <SortableHeader label="Shoda" sortKey="score" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[70px] text-center" />
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Projekt</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Typ</th>
              <SortableHeader label="Plocha" sortKey="floor_area_m2" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Ext." sortKey="exterior_area_m2" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Patro" sortKey="floor" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center" />
              <SortableHeader label="Cena" sortKey="price_czk" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Kč/m²" sortKey="price_per_m2_czk" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
              <SortableHeader label="Trh" sortKey="price_diff_pct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center" tip="Odchylka od tržní ceny v okruhu 2 km" />
              {/* Dynamic commute columns */}
              {commuteLabels.map((label) => {
                const isSelected = selectedCommuteLabels.includes(label);
                const shortLabel = label.split(/\s+/)[0];
                return (
                  <th
                    key={label}
                    className={cn(
                      "cursor-pointer select-none px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-slate-900",
                      isSelected ? "text-sky-700 bg-sky-50/60" : "text-slate-500",
                    )}
                    onClick={() => toggleCommuteLabel(label)}
                    title={`${label} — klikni pro řazení`}
                  >
                    {shortLabel}
                    {isSelected && <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                );
              })}
              {commuteLabels.length > 0 && (
                <SortableHeader label="Celkem" sortKey="commute_sum" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center" />
              )}
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
                activePoiPrefs={activePoiPrefs}
                commuteLabels={commuteLabels}
                selectedCommuteLabels={selectedCommuteLabels}
                onPin={() => onPin(r)}
                onOpen={() => onOpen(r)}
                onFeedback={(type, options) => onFeedback(r, type, options)}
                onClearFeedback={() => onClearFeedback(r)}
                saving={feedbackSavingId === r.rec_id}
                compareChecked={compareIds?.has(r.rec_id)}
                onToggleCompare={onToggleCompare ? () => onToggleCompare(r.rec_id) : undefined}
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
  activePoiPrefs,
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
  activePoiPrefs: string[];
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

  // Project-level attributes are identical across units of the same project but may be
  // null on some rows. Pick the first non-null value so a single missing row doesn't
  // hide a project-wide signal (noise, near-source distances, POI counts).
  const pickAttr = <K extends keyof RecommendationItem>(key: K): RecommendationItem[K] | null => {
    for (const u of group.units) {
      const v = u[key];
      if (v != null) return v;
    }
    return null;
  };
  const projNoise = pickAttr("noise_label") as string | null;
  const projTram = pickAttr("distance_to_tram_tracks_m") as number | null;
  const projRail = pickAttr("distance_to_railway_m") as number | null;
  const projRoad = pickAttr("distance_to_primary_road_m") as number | null;
  const projPoi = pickAttr("poi_counts") as Record<string, number> | null;
  const projUnitForMhd = group.units.find((u) =>
    MHD_CONFIG.some(({ field }) => u[field] != null),
  ) ?? group.units[0];

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
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900 truncate">{group.project_name}</h3>
              {projNoise && <NoiseBadge label={projNoise} />}
              <NearSourceBadges tramM={projTram} railM={projRail} roadM={projRoad} />
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
            {projUnitForMhd && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                <MhdBadges rec={projUnitForMhd} activePrefs={activePoiPrefs} />
                <PoiBadges poiCounts={projPoi} activePrefs={activePoiPrefs} />
              </div>
            )}
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
              {group.area_range[0] != null && (
                <span>{group.area_range[0] === group.area_range[1] ? `${Math.round(group.area_range[0]!)} m²` : `${Math.round(group.area_range[0]!)}–${Math.round(group.area_range[1]!)} m²`}</span>
              )}
              {group.ext_area_range[0] != null && group.ext_area_range[0]! > 0 && (
                <span>ext. {group.ext_area_range[0] === group.ext_area_range[1] ? `${Math.round(group.ext_area_range[0]!)} m²` : `${Math.round(group.ext_area_range[0]!)}–${Math.round(group.ext_area_range[1]!)} m²`}</span>
              )}
              {group.construction_completion && (
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
                <th className="px-3 py-2 text-right">Kč/m²</th>
                <th className="px-3 py-2 text-center">Trh</th>
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
                      "border-t border-slate-100 text-sm hover:bg-slate-50/80 cursor-pointer",
                      fbType === "disliked" && "opacity-50",
                      isTop && "bg-blue-50/30",
                    )}
                    onClick={() => onOpen(r)}
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
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 text-xs">{r.price_per_m2_czk != null ? `${Math.round(r.price_per_m2_czk / 1000)}k Kč` : "—"}</td>
                    <td className="px-3 py-2 text-center"><PriceDiffBadge pct={r.price_diff_pct} /></td>
                    <td className="px-3 py-2">
                      <StatusBadge r={r} />
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
  activePoiPrefs,
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
  activePoiPrefs: string[];
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
          activePoiPrefs={activePoiPrefs}
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

type QuickFilter = "all" | "pinned" | "hide_disliked" | "undecided" | "review" | "verified";

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "Vše" },
  { key: "pinned", label: "★ Ve výběru" },
  { key: "hide_disliked", label: "Skrýt nechci" },
  { key: "undecided", label: "Bez rozhodnutí" },
  { key: "review", label: "K prověření" },
  { key: "verified", label: "100% splňuje" },
];

function applyQuickFilter(recs: RecommendationItem[], filter: QuickFilter): RecommendationItem[] {
  switch (filter) {
    case "pinned":
      return recs.filter((r) => r.pinned_by_broker);
    case "review":
      return recs.filter((r) => r.eligibility === "review");
    case "verified":
      return recs.filter((r) => r.eligibility !== "review");
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
/*  Working filters bar (Client Mode Phase 2)                */
/* ────────────────────────────────────────────────────────── */

const WORKING_LAYOUT_OPTIONS = ["1kk", "1.5kk", "2kk", "3kk", "4kk", "5+kk"] as const;
const WORKING_PROPERTY_TYPES: { value: string; label: string }[] = [
  { value: "any", label: "Jakýkoliv" },
  { value: "flat", label: "Byt" },
  { value: "house", label: "Dům" },
];

function parseNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function ModifiedBadge() {
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800">
      upraveno
    </span>
  );
}

function WorkingFiltersBar({
  workingFilters,
  modifiedKeys,
  onChange,
  onReset,
  onApply,
  recomputing,
  saving,
}: {
  workingFilters: WorkingFilters;
  modifiedKeys: string[];
  onChange: <K extends keyof WorkingFilters>(key: K, value: WorkingFilters[K]) => void;
  onReset: () => void;
  onApply: () => void;
  recomputing: boolean;
  saving: boolean;
}) {
  const [open, setOpen] = useState(modifiedKeys.length > 0);
  const isModified = (key: string) => modifiedKeys.includes(key);
  const currentPropertyType =
    workingFilters.propertyTypes && workingFilters.propertyTypes.length === 1
      ? workingFilters.propertyTypes[0]
      : "any";
  const currentLayouts = workingFilters.layouts ?? [];

  const toggleLayout = (l: string) => {
    const next = currentLayouts.includes(l)
      ? currentLayouts.filter((x) => x !== l)
      : [...currentLayouts, l];
    onChange("layouts", next.length ? next : undefined);
  };

  return (
    <ReamarCard className="px-4 py-3">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pracovní filtry</span>
          {modifiedKeys.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              {modifiedKeys.length} {modifiedKeys.length === 1 ? "úprava" : modifiedKeys.length < 5 ? "úpravy" : "úprav"}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">shoduje se se zadáním</span>
          )}
        </div>
        <span className={cn("text-slate-400 transition-transform text-xs", open && "rotate-180")}>▾</span>
      </button>

      {/* Expanded edit area */}
      {open && (
      <div className="mt-3">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className={cn("flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500", isModified("budgetMax") && "text-amber-700")}>
            Cena max
            {isModified("budgetMax") && <ModifiedBadge />}
          </label>
          <input
            type="text"
            inputMode="numeric"
            className={cn(reamarInputClass, "mt-1 w-32", isModified("budgetMax") && "border-amber-400")}
            value={workingFilters.budgetMax ?? ""}
            onChange={(e) => onChange("budgetMax", parseNumberOrNull(e.target.value))}
            placeholder="Kč"
          />
        </div>
        <div>
          <label className={cn("flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500", isModified("areaMin") && "text-amber-700")}>
            Plocha min
            {isModified("areaMin") && <ModifiedBadge />}
          </label>
          <input
            type="text"
            inputMode="numeric"
            className={cn(reamarInputClass, "mt-1 w-24", isModified("areaMin") && "border-amber-400")}
            value={workingFilters.areaMin ?? ""}
            onChange={(e) => onChange("areaMin", parseNumberOrNull(e.target.value))}
            placeholder="m²"
          />
        </div>
        <div>
          <label className={cn("flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500", isModified("propertyTypes") && "text-amber-700")}>
            Typ
            {isModified("propertyTypes") && <ModifiedBadge />}
          </label>
          <div className={cn("mt-1 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5", isModified("propertyTypes") && "border-amber-400")}>
            {WORKING_PROPERTY_TYPES.map((opt) => {
              const active = currentPropertyType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  )}
                  onClick={() =>
                    onChange(
                      "propertyTypes",
                      opt.value === "any" ? undefined : [opt.value],
                    )
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={cn("flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500", isModified("layouts") && "text-amber-700")}>
            Dispozice
            {isModified("layouts") && <ModifiedBadge />}
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {WORKING_LAYOUT_OPTIONS.map((l) => {
              const active = currentLayouts.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                    isModified("layouts") && !active && "border-amber-300",
                  )}
                  onClick={() => toggleLayout(l)}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {modifiedKeys.length > 0 && (
            <ReamarButton type="button" variant="ghost" size="sm" onClick={onReset} disabled={saving || recomputing}>
              Reset na zadání
            </ReamarButton>
          )}
          <ReamarButton type="button" variant="primary" size="sm" onClick={onApply} disabled={recomputing}>
            {recomputing ? "Přepočítávám…" : "Přepočítat doporučení"}
          </ReamarButton>
        </div>
      </div>
      {modifiedKeys.length > 0 && (
        <p className="mt-3 text-[11px] text-amber-700">
          Pracovní filtry jsou upraveny oproti zadání klienta ({modifiedKeys.length}{" "}
          {modifiedKeys.length === 1 ? "změna" : modifiedKeys.length < 5 ? "změny" : "změn"}).
        </p>
      )}
      </div>
      )}
    </ReamarCard>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Standards quick-edit bar                                  */
/* ────────────────────────────────────────────────────────── */

type StdPriority = "ignore" | "prefer" | "must";

const STANDARDS_CONTROLS: { key: string; label: string; section: "standards" | "house_amenities" }[] = [
  // Standards
  { key: "recuperation", label: "Rekuperace", section: "standards" },
  { key: "exterior_blinds", label: "Venkovní žaluzie", section: "standards" },
  { key: "air_conditioning", label: "Klimatizace", section: "standards" },
  { key: "smart_home", label: "Smart home", section: "standards" },
  { key: "elevator", label: "Výtah", section: "standards" },
  { key: "cellar", label: "Sklep", section: "standards" },
  { key: "parking", label: "Parkování", section: "standards" },
  // Amenities
  { key: "parking", label: "Parkování v domě", section: "house_amenities" },
  { key: "cellar", label: "Sklepní kóje", section: "house_amenities" },
  { key: "bike_room", label: "Kolárna", section: "house_amenities" },
  { key: "stroller_room", label: "Kočárkárna", section: "house_amenities" },
  { key: "fitness", label: "Fitness", section: "house_amenities" },
  { key: "courtyard_garden", label: "Vnitroblok / zahrada", section: "house_amenities" },
  { key: "concierge", label: "Recepce / concierge", section: "house_amenities" },
];

function StdPill({ value, onChange }: { value: StdPriority; onChange: (v: StdPriority) => void }) {
  const opts: { v: StdPriority; label: string; active: string }[] = [
    { v: "ignore", label: "—", active: "bg-white text-slate-600 shadow-sm" },
    { v: "prefer", label: "Chci", active: "bg-violet-100 text-violet-800 shadow-sm" },
    { v: "must", label: "Musí", active: "bg-slate-900 text-white shadow-sm" },
  ];
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100/60 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors",
            value === o.v ? o.active : "text-slate-400 hover:text-slate-600",
          )}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StandardsBar({
  wizardExtras,
  onChange,
  onApply,
  recomputing,
}: {
  wizardExtras: WizardExtras;
  onChange: (section: string, key: string, value: StdPriority) => void;
  onApply: () => void;
  recomputing: boolean;
}) {
  const [open, setOpen] = useState(false);

  const getValue = (s: typeof STANDARDS_CONTROLS[0]) => {
    const sec = (wizardExtras as Record<string, any>)[s.section] ?? {};
    return (sec[s.key] as string | undefined) ?? "ignore";
  };

  // Count active (non-ignore)
  const activeCount = STANDARDS_CONTROLS.filter(
    (s) => {
      const v = getValue(s);
      return v && v !== "ignore";
    }
  ).length;

  return (
    <ReamarCard className="px-4 py-3">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Standardy a vybavení</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
              {activeCount} aktivní
            </span>
          )}
          {!open && activeCount > 0 && (
            <span className="text-[11px] text-slate-400">
              {STANDARDS_CONTROLS
                .filter((s) => {
                  const v = getValue(s);
                  return v && v !== "ignore";
                })
                .map((s) => {
                  const v = getValue(s);
                  return `${s.label} (${v === "must" ? "musí" : "chci"})`;
                })
                .join(" · ")}
            </span>
          )}
        </div>
        <span className={cn("text-slate-400 transition-transform text-xs", open && "rotate-180")}>▾</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {STANDARDS_CONTROLS.map((s) => {
              const current = (getValue(s) ?? "ignore") as StdPriority;
              return (
                <div key={`${s.section}.${s.key}`} className="flex items-center gap-2">
                  <span className="text-xs text-slate-700 w-[150px]">{s.label}</span>
                  <StdPill value={current} onChange={(v) => onChange(s.section, s.key, v)} />
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <ReamarButton type="button" variant="primary" size="sm" onClick={onApply} disabled={recomputing}>
              {recomputing ? "Přepočítávám…" : "Přepočítat"}
            </ReamarButton>
            <span className="text-[10px] text-slate-400">Změna standardů uloží profil a přepočítá doporučení</span>
          </div>
        </div>
      )}
    </ReamarCard>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Walkability/POI quick controls                            */
/* ────────────────────────────────────────────────────────── */

const WALK_CATEGORIES: { key: keyof WalkabilityPreferences; label: string; group: string }[] = [
  { key: "supermarket", label: "Obchod", group: "Denní potřeby" },
  { key: "pharmacy", label: "Lékárna", group: "Denní potřeby" },
  { key: "park", label: "Park", group: "Volný čas" },
  { key: "restaurant", label: "Restaurace", group: "Volný čas" },
  { key: "cafe", label: "Kavárna", group: "Volný čas" },
  { key: "fitness", label: "Fitness", group: "Volný čas" },
  { key: "playground", label: "Hřiště", group: "Rodina" },
  { key: "kindergarten", label: "Školka", group: "Rodina" },
  { key: "primary_school", label: "ZŠ", group: "Rodina" },
  { key: "metro", label: "Metro", group: "Doprava" },
  { key: "tram", label: "Tramvaj", group: "Doprava" },
  { key: "bus", label: "Bus", group: "Doprava" },
  { key: "train", label: "Vlak", group: "Doprava" },
];

const WALK_VALUES: { value: WalkabilityPreferenceValue; label: string; active: string }[] = [
  { value: "required", label: "Musí", active: "bg-red-500 text-white shadow-sm" },
  { value: "high", label: "Chci", active: "bg-violet-100 text-violet-800 shadow-sm" },
  { value: "normal", label: "—", active: "bg-white text-slate-600 shadow-sm" },
  { value: "ignore", label: "Ne", active: "bg-slate-200 text-slate-500 shadow-sm" },
];

function WalkPill({ value, onChange }: { value: WalkabilityPreferenceValue; onChange: (v: WalkabilityPreferenceValue) => void }) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100/60 p-0.5">
      {WALK_VALUES.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors",
            value === o.value ? o.active : "text-slate-400 hover:text-slate-600",
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WalkabilityBar({
  walkPrefs,
  onChange,
  onApply,
  recomputing,
}: {
  walkPrefs: WalkabilityPreferences;
  onChange: (key: keyof WalkabilityPreferences, value: WalkabilityPreferenceValue) => void;
  onApply: () => void;
  recomputing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chips = getNonDefaultChips(walkPrefs);
  const activeCount = chips.length;

  const groups = useMemo(() => {
    const m = new Map<string, typeof WALK_CATEGORIES>();
    for (const c of WALK_CATEGORIES) {
      const list = m.get(c.group) ?? [];
      list.push(c);
      m.set(c.group, list);
    }
    return m;
  }, []);

  return (
    <ReamarCard className="px-4 py-3">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Okolí a doprava</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
              {activeCount} aktivní
            </span>
          )}
          {!open && activeCount > 0 && (
            <span className="text-[11px] text-slate-400 truncate max-w-[400px]">
              {chips.join(" · ")}
            </span>
          )}
        </div>
        <span className={cn("text-slate-400 transition-transform text-xs", open && "rotate-180")}>▾</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{group}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {items.map((c) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <span className="text-xs text-slate-700 w-[80px]">{c.label}</span>
                    <WalkPill value={walkPrefs[c.key]} onChange={(v) => onChange(c.key, v)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <ReamarButton type="button" variant="primary" size="sm" onClick={onApply} disabled={recomputing}>
              {recomputing ? "Přepočítávám…" : "Přepočítat"}
            </ReamarButton>
            <span className="text-[10px] text-slate-400">Změna okolí uloží profil a přepočítá doporučení</span>
          </div>
        </div>
      )}
    </ReamarCard>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Main page component                                      */
/* ────────────────────────────────────────────────────────── */

export default function RecommendationsPage() {
  const {
    client,
    clientId,
    recs,
    recsFunnel,
    loading,
    error,
    hydrated,
    token,
    recomputing,
    recomputeProgress,
    router,
    handleRecompute,
    handlePin,
    handleRecommendationFeedback,
    clearRecommendationFeedback,
    feedbackSavingId,
    profile, setProfile,
    selectedLayouts, setSelectedLayouts,
    LAYOUT_OPTIONS,
    clientModeState,
    clientModeSaving,
    updateWorkingFilter,
    resetWorkingFilters,
    wizardExtras,
    setWizardExtras,
    handleSaveProfile,
    profileSaving,
    profileDirty,
    walkPrefs,
    setWalkPrefs,
    locationPolygons,
    projectsInsidePolygon,
  } = useCaseData();
  const [selectedRecId, setSelectedRecId] = useState<number | null>(null);
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
    return (["all", "pinned", "hide_disliked", "undecided", "review", "verified"] as QuickFilter[]).includes(saved as QuickFilter)
      ? (saved as QuickFilter)
      : "hide_disliked";
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const toggleCompare = (recId: number) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(recId)) next.delete(recId); else next.add(recId);
      return next;
    });
  };
  const [toast, setToast] = useState<string | null>(null);
  const prevRecomputingRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Detekce dokončení přepočtu: recomputing true→false a bez chyby
    if (prevRecomputingRef.current && !recomputing && !error) {
      const count = recs.length;
      setToast(`Přepočítáno · ${count} doporučení`);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 3500);
    }
    prevRecomputingRef.current = recomputing;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recomputing, error]);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);
  const filteredRecs = useMemo(() => applyQuickFilter(recs, quickFilter), [recs, quickFilter]);

  const filterCounts = useMemo<Record<QuickFilter, number>>(() => ({
    all: recs.length,
    pinned: recs.filter((r) => r.pinned_by_broker).length,
    hide_disliked: recs.filter((r) => r.feedback?.feedback_type !== "disliked").length,
    undecided: recs.filter((r) => !r.pinned_by_broker && !r.feedback).length,
    review: recs.filter((r) => r.eligibility === "review").length,
    verified: recs.filter((r) => r.eligibility !== "review").length,
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

  const activePoiPrefs = useMemo(() => {
    const wprefs = profile?.walkability_preferences_json ?? {};
    return Object.entries(wprefs)
      .filter(([, v]) => v === "normal" || v === "high" || v === "required")
      .map(([k]) => k);
  }, [profile?.walkability_preferences_json]);

  // Detekce odhadnutých dojezdů — musí být před early returns (Rules of Hooks)
  const hasEstimatedCommute = useMemo(() => {
    if (!recs.length) return false;
    return recs.some((r) => {
      const details = (r.reason?.commute_details ?? []) as Array<{ is_estimated?: boolean }>;
      return details.some((d) => d.is_estimated);
    });
  }, [recs]);

  // Extract unique commute point labels — must be before early returns (Rules of Hooks)
  const commuteLabels = useMemo(() => {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const r of recs) {
      for (const d of (r.reason?.commute_details ?? []) as CommuteDetailItem[]) {
        if (d.label && !seen.has(d.label)) { seen.add(d.label); labels.push(d.label); }
      }
    }
    return labels;
  }, [recs]);

  // ── Klávesové zkratky ────────────────────────────────────────────────
  // j/k navigace, p pin, l like, d dislike, Enter detail, Esc zavři
  // ? zobrazí nápovědu; ? se ignoruje uvnitř input/textarea
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore při psaní v input/textarea/contenteditable
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Nápověda
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShortcutsHelpOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (shortcutsHelpOpen) { setShortcutsHelpOpen(false); return; }
        if (selectedRecId != null) { setSelectedRecId(null); return; }
        return;
      }
      if (!filteredRecs.length) return;
      const currentIndex = selectedRecId == null
        ? -1
        : filteredRecs.findIndex((r) => r.rec_id === selectedRecId);

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, filteredRecs.length - 1);
        setSelectedRecId(filteredRecs[nextIdx].rec_id);
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = currentIndex <= 0 ? 0 : currentIndex - 1;
        setSelectedRecId(filteredRecs[prevIdx].rec_id);
        return;
      }
      if (currentIndex < 0) return;
      const cur = filteredRecs[currentIndex];
      if (e.key === "p") {
        e.preventDefault();
        handlePin(cur.rec_id, cur.pinned_by_broker);
        return;
      }
      if (e.key === "l") {
        e.preventDefault();
        handleRecommendationFeedback(cur.rec_id, "liked");
        return;
      }
      if (e.key === "d") {
        e.preventDefault();
        handleRecommendationFeedback(cur.rec_id, "disliked");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (cur.unit_external_id) router.push(`/units/${encodeURIComponent(cur.unit_external_id)}`);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredRecs, selectedRecId, shortcutsHelpOpen, handlePin, handleRecommendationFeedback, router]);

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
    activePoiPrefs,
    onPin: (r: RecommendationItem) => handlePin(r.rec_id, r.pinned_by_broker),
    onOpen: (r: RecommendationItem) => r.unit_external_id && router.push(`/units/${encodeURIComponent(r.unit_external_id)}`),
    onFeedback: (r: RecommendationItem, type: RecommendationFeedbackType, options?: { dislikeReason?: RecommendationDislikeReason | null; note?: string | null }) => handleRecommendationFeedback(r.rec_id, type, options),
    onClearFeedback: (r: RecommendationItem) => clearRecommendationFeedback(r.rec_id),
    feedbackSavingId,
  };

  /* ─── Render ─── */
  {
    const selectedRec = recs.find((r) => r.rec_id === selectedRecId) ?? null;
    const v2SharedProps = {
      ...sharedProps,
      onOpen: (r: RecommendationItem) => setSelectedRecId(r.rec_id),
    };

    return (
      <div className="rv2-page">
        {/* Stale banner — zadání klienta se změnilo po posledním výpočtu */}
        {!recomputing && client?.recommendations_stale && (
          <div
            className="rv2-card"
            style={{
              padding: "var(--r-space-3) var(--r-space-4)",
              display: "flex",
              alignItems: "center",
              gap: "var(--r-space-3)",
              background: "var(--r-state-warning-soft, #fef3c7)",
              color: "var(--r-state-warning, #92400e)",
              borderColor: "transparent",
              fontSize: "var(--r-font-13)",
              marginBottom: "var(--r-space-2)",
            }}
          >
            <span style={{ fontSize: 18 }}>⚠</span>
            <span style={{ flex: 1 }}>
              Zadání klienta bylo upraveno po posledním přepočtu doporučení.
              Aktuální skóre nemusí odpovídat novému zadání.
            </span>
            <ReamarButton
              type="button"
              variant="primary"
              size="sm"
              onClick={handleRecompute}
              disabled={recomputing}
            >
              Přepočítat teď
            </ReamarButton>
          </div>
        )}

        {/* Progress banner */}
        {recomputing && (
          <div
            className="rv2-card"
            style={{
              padding: "var(--r-space-3) var(--r-space-4)",
              display: "flex",
              alignItems: "center",
              gap: "var(--r-space-2)",
              background: "var(--r-state-info-soft)",
              color: "var(--r-state-info)",
              borderColor: "transparent",
              fontSize: "var(--r-font-13)",
            }}
          >
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" fill="none" />
            </svg>
            <span>
              {recomputeProgress && recomputeProgress.total > 0 && recomputeProgress.done < recomputeProgress.total
                ? `Počítám dojezdy… (${recomputeProgress.done}/${recomputeProgress.total} projektů)`
                : recomputeProgress && recomputeProgress.total > 0
                  ? `Skóruji projekty… (${recomputeProgress.total} projektů)`
                  : "Počítám doporučení…"}
            </span>
          </div>
        )}

        {/* Portals — filter chips into tabs bar, stats into stats row */}
        {typeof document !== "undefined" && document.getElementById("case-tabs-slot") && profile && createPortal(
          <>
            <span className="text-[11px] text-slate-400 font-medium">Filtry:</span>
            {profile.budget_max != null && profile.budget_min == null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">do {formatCurrencyCzk(profile.budget_max)}</span>
            )}
            {profile.budget_min != null && profile.budget_max != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{formatCurrencyCzk(profile.budget_min)} – {formatCurrencyCzk(profile.budget_max)}</span>
            )}
            {profile.area_min != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">od {profile.area_min} m²</span>
            )}
            {profile.area_max != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">do {profile.area_max} m²</span>
            )}
            {selectedLayouts.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{selectedLayouts.join(", ")}</span>
            )}
            {profile.property_type && profile.property_type !== "any" && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{profile.property_type === "flat" ? "Byt" : "Dům"}</span>
            )}
            {hasEstimatedCommute && !recomputing && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">⚠ odhady</span>
            )}
          </>,
          document.getElementById("case-tabs-slot")!
        )}

        {typeof document !== "undefined" && document.getElementById("case-stats-slot") && createPortal(
          <>
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Doporučení</span>
              <span className="text-base font-bold text-slate-900">{recs.length}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5">
              <span className="text-[11px] text-amber-700">★ Ve výběru</span>
              <span className="text-base font-bold text-amber-900">{pinnedCount}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5">
              <span className="text-[11px] text-emerald-700">♥ Líbí se</span>
              <span className="text-base font-bold text-emerald-900">{likedCount}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5">
              <span className="text-[11px] text-rose-700">✕ Nechci</span>
              <span className="text-base font-bold text-rose-900">{dislikedCount}</span>
            </div>
          </>,
          document.getElementById("case-stats-slot")!
        )}

        {/* Quick filters + count + Přepočítat + ViewToggle */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <QuickFilterBar
              filter={quickFilter}
              onChange={(f) => { setQuickFilter(f); localStorage.setItem("reamar_recs_filter", f); }}
              counts={filterCounts}
            />
            <span className="text-xs text-slate-400">{filteredRecs.length} z {recs.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rv2-button rv2-button-secondary"
              onClick={() => {
                // Přepnout do Units view, kde jsou checkboxy pro výběr
                if (viewMode !== "units") {
                  setViewMode("units");
                  try { localStorage.setItem("reamar_recs_view", "units"); } catch {}
                }
                if (compareIds.size >= 2) setCompareOpen(true);
              }}
              title="Zobrazit tabulku pro porovnání jednotek"
            >
              ⇌ Porovnat{compareIds.size ? ` (${compareIds.size})` : ""}
            </button>
            <button
              type="button"
              className="rv2-button rv2-button-secondary"
              onClick={handleRecompute}
              disabled={recomputing}
            >
              {recomputing ? "Počítám…" : "⟳ Přepočítat"}
            </button>
            <ViewToggle mode={viewMode} onChange={(m) => { setViewMode(m); localStorage.setItem("reamar_recs_view", m); }} />
          </div>
        </div>

        {/* Active filter chips */}
        <StandardsBar
          wizardExtras={wizardExtras}
          onChange={(section, key, value) => {
            setWizardExtras((prev) => ({
              ...prev,
              [section]: { ...((prev as Record<string, any>)[section] ?? {}), [key]: value },
            }));
          }}
          onApply={async () => { await handleSaveProfile(); await handleRecompute(); }}
          recomputing={recomputing}
        />
        {walkPrefs && setWalkPrefs && (
          <WalkabilityBar
            walkPrefs={walkPrefs}
            onChange={(key, value) => setWalkPrefs((prev) => ({ ...prev, [key]: value }))}
            onApply={async () => { await handleSaveProfile(); await handleRecompute(); }}
            recomputing={recomputing}
          />
        )}

        {/* Content — viewMode aware, drawer only for projects view */}
        {filteredRecs.length === 0 ? (
          <div className="rv2-card">
            <div className="rv2-empty">
              {recs.length === 0
                ? "Zatím žádná doporučení. Spusťte Přepočítat."
                : "V aktuálním filtru nejsou žádné jednotky."}
            </div>
          </div>
        ) : (
          <>
            {(viewMode === "projects" || viewMode === "cards") && (
              <div
                className="rv2-with-drawer"
                data-drawer-open={selectedRec ? "true" : "false"}
              >
                <div style={{ minWidth: 0 }}>
                  <ProjectsGroupedView
                    recs={filteredRecs}
                    {...v2SharedProps}
                    onBulkPin={handleBulkPin}
                    onBulkDislike={handleBulkDislike}
                    onBulkClearFeedback={handleBulkClearFeedback}
                  />
                </div>
                {selectedRec && (
                  <UnitInspectorV2
                    unit={selectedRec}
                    onClose={() => setSelectedRecId(null)}
                    onPin={() => handlePin(selectedRec.rec_id, selectedRec.pinned_by_broker)}
                    onFeedback={(type, options) =>
                      handleRecommendationFeedback(selectedRec.rec_id, type, options)
                    }
                    onClearFeedback={() => clearRecommendationFeedback(selectedRec.rec_id)}
                    saving={feedbackSavingId === selectedRec.rec_id}
                  />
                )}
              </div>
            )}
            {viewMode === "units" && (
              <UnitsTableView
                recs={filteredRecs}
                commuteLabels={commuteLabels}
                compareIds={compareIds}
                onToggleCompare={toggleCompare}
                {...v2SharedProps}
              />
            )}
            {viewMode === "map" && (
              <RecommendationsMap
                recs={filteredRecs}
                onProjectFeedback={(recIds, type) => {
                  for (const id of recIds) handleRecommendationFeedback(id, type);
                }}
              />
            )}
          </>
        )}
        <RecsToast message={toast} onClose={() => setToast(null)} />
        {compareIds.size >= 2 && !compareOpen && (
          <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-800"
            >
              Porovnat ({compareIds.size})
            </button>
            <button
              type="button"
              onClick={() => setCompareIds(new Set())}
              className="ml-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 shadow hover:bg-slate-50"
            >
              Zrušit
            </button>
          </div>
        )}
        {compareOpen && (
          <ComparisonModal
            units={recs.filter((r) => compareIds.has(r.rec_id))}
            commuteLabels={commuteLabels}
            onClose={() => setCompareOpen(false)}
            onRemove={(id) => {
              setCompareIds((prev) => {
                const n = new Set(prev);
                n.delete(id);
                return n;
              });
            }}
            onClear={() => {
              setCompareIds(new Set());
              setCompareOpen(false);
            }}
          />
        )}
        {shortcutsHelpOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
            onClick={() => setShortcutsHelpOpen(false)}
          >
            <div
              className="rounded-xl bg-white p-5 text-sm text-slate-700 shadow-xl w-[320px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="font-semibold text-slate-900">Klávesové zkratky</div>
                <button onClick={() => setShortcutsHelpOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Zavřít">✕</button>
              </div>
              <ul className="space-y-1.5">
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">j</kbd> <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">k</kbd> — pohyb mezi jednotkami</li>
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">p</kbd> — pin / unpin</li>
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">l</kbd> — líbí se</li>
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">d</kbd> — nelíbí se</li>
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">Enter</kbd> — detail jednotky</li>
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">Esc</kbd> — zavřít</li>
                <li><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px]">?</kbd> — tato nápověda</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }
}

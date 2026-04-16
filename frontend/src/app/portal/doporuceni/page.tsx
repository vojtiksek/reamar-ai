"use client";

import React, { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk } from "@/lib/format";
import clsx from "clsx";

type Feedback = { feedback_type: string; dislike_reason: string | null; note: string | null };

type Rec = {
  rec_id: number;
  project_name: string | null;
  unit_external_id: string | null;
  layout_label: string | null;
  floor_area_m2: number | null;
  exterior_area_m2: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  floor: number | null;
  score: number | null;
  district: string | null;
  top_strengths: string[];
  top_compromises: string[];
  pinned_by_broker: boolean;
  shortlist_order: number | null;
  shortlist_reason: string | null;
  shortlist_role: string | null;
  feedback: Feedback | null;
  reason?: Record<string, unknown> | null;
};

type CommuteDetail = { label: string; mode: string; minutes: number; passed: boolean; is_estimated?: boolean };

const ROLE_LABELS: Record<string, { label: string; cls: string }> = {
  top_pick:    { label: "Hlavní volba",     cls: "bg-slate-900 text-white" },
  alternative: { label: "Alternativa",      cls: "bg-blue-100 text-blue-800" },
  fallback:    { label: "Záložní varianta", cls: "bg-amber-100 text-amber-800" },
  wild_card:   { label: "Odvážnější tip",   cls: "bg-purple-100 text-purple-800" },
};

function portalHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("portal_token") : null;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : {};
}

export default function PortalBrokerPicks() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sendingFb, setSendingFb] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/portal/recommendations`, { headers: portalHeaders() })
      .then((r) => {
        if (r.status === 401) throw new Error("Neplatná session");
        if (!r.ok) throw new Error("Chyba načítání");
        return r.json();
      })
      .then((data: Rec[]) => {
        const pinned = data
          .filter((r) => r.pinned_by_broker)
          .sort((a, b) => {
            const ao = a.shortlist_order ?? 999999;
            const bo = b.shortlist_order ?? 999999;
            if (ao !== bo) return ao - bo;
            return (b.score ?? 0) - (a.score ?? 0);
          });
        setRecs(pinned);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const sendFeedback = async (recId: number, feedbackType: string) => {
    setSendingFb(recId);
    try {
      const res = await fetch(`${API_BASE}/portal/recommendations/${recId}/feedback`, {
        method: "PUT",
        headers: portalHeaders(),
        body: JSON.stringify({ feedback_type: feedbackType }),
      });
      if (res.ok) {
        const fb = await res.json();
        setRecs((prev) => prev.map((r) => r.rec_id === recId ? { ...r, feedback: fb } : r));
      }
    } finally { setSendingFb(null); }
  };

  // Extract commute labels
  const commuteLabels: string[] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    for (const d of (r.reason?.commute_details ?? []) as CommuteDetail[]) {
      if (d.label && !seen.has(d.label)) { seen.add(d.label); commuteLabels.push(d.label); }
    }
  }

  if (loading) return <p className="py-10 text-center text-sm text-slate-500">Načítání…</p>;
  if (error) return <p className="py-10 text-center text-sm text-rose-600">{error}</p>;

  if (recs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <h3 className="text-lg font-semibold text-slate-900">Zatím žádná doporučení</h3>
        <p className="mt-2 text-sm text-slate-500">Váš makléř zatím nepřipravil žádný výběr. Jakmile bude připraven, uvidíte ho zde.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{recs.length} jednotek vybraných vaším makléřem</p>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Projekt</th>
                <th className="px-3 py-2 text-left">Typ</th>
                <th className="px-3 py-2 text-right">Plocha</th>
                <th className="px-3 py-2 text-right">Cena</th>
                <th className="px-3 py-2 text-right">Kč/m²</th>
                {commuteLabels.map((l) => (
                  <th key={l} className="px-2 py-2 text-center">{l.split(/\s+/)[0]}</th>
                ))}
                <th className="px-3 py-2 text-center">Váš názor</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => {
                const roleCfg = ROLE_LABELS[r.shortlist_role ?? ""] ?? { label: "Výběr", cls: "bg-violet-100 text-violet-800" };
                const details = (r.reason?.commute_details ?? []) as CommuteDetail[];
                const isExpanded = expandedId === r.rec_id;
                const fbType = r.feedback?.feedback_type;

                return (
                  <React.Fragment key={r.rec_id}>
                    <tr
                      className={clsx(
                        "border-b border-slate-100 text-sm transition-colors cursor-pointer hover:bg-slate-50/80",
                        fbType === "liked" && "bg-emerald-50/40",
                        fbType === "disliked" && "bg-rose-50/40 opacity-60",
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : r.rec_id)}
                    >
                      <td className="px-3 py-2.5">
                        <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", roleCfg.cls)}>{roleCfg.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-slate-900">{r.project_name ?? "—"}</span>
                        {r.district && <p className="text-[11px] text-slate-400">{r.district}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{r.layout_label ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.floor_area_m2 != null ? `${Math.round(r.floor_area_m2)} m²` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">{r.price_czk != null ? formatCurrencyCzk(r.price_czk) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 text-xs">{r.price_per_m2_czk != null ? `${Math.round(r.price_per_m2_czk / 1000)}k Kč` : "—"}</td>
                      {commuteLabels.map((label) => {
                        const d = details.find((cd) => cd.label === label);
                        if (!d) return <td key={label} className="px-2 py-2.5 text-center text-xs text-slate-300">—</td>;
                        return (
                          <td key={label} className="px-2 py-2.5 text-center tabular-nums text-xs">
                            <span className={d.passed ? "text-slate-700" : "text-rose-600 font-medium"}>
                              {d.is_estimated && "~"}{Math.round(d.minutes)} min
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            className={clsx("rounded-full p-1 text-xs", fbType === "liked" ? "bg-emerald-100 text-emerald-700" : "text-slate-400 hover:text-emerald-600")}
                            onClick={() => sendFeedback(r.rec_id, "liked")}
                            disabled={sendingFb === r.rec_id}
                            title="Líbí se mi"
                          >♥</button>
                          <button
                            className={clsx("rounded-full p-1 text-xs", fbType === "disliked" ? "bg-rose-100 text-rose-700" : "text-slate-400 hover:text-rose-600")}
                            onClick={() => sendFeedback(r.rec_id, "disliked")}
                            disabled={sendingFb === r.rec_id}
                            title="Nezajímá mě"
                          >✕</button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <td colSpan={7 + commuteLabels.length + 1} className="px-5 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            {/* Broker reason */}
                            {r.shortlist_reason && (
                              <div className="rounded-xl bg-violet-50/70 p-3">
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700">Proč vám to doporučujeme</p>
                                <p className="text-sm text-violet-900">{r.shortlist_reason}</p>
                              </div>
                            )}
                            {/* Auto strengths */}
                            <div className="space-y-3">
                              {r.top_strengths?.length > 0 && (
                                <div>
                                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Silné stránky</p>
                                  <ul className="space-y-0.5 text-sm text-slate-700">
                                    {r.top_strengths.slice(0, 4).map((s, i) => <li key={i}>+ {s}</li>)}
                                  </ul>
                                </div>
                              )}
                              {r.top_compromises?.length > 0 && (
                                <div>
                                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Na co pozor</p>
                                  <ul className="space-y-0.5 text-sm text-slate-700">
                                    {r.top_compromises.slice(0, 4).map((s, i) => <li key={i}>! {s}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

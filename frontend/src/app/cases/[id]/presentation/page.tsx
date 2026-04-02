"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import { ReamarCard, ReamarButton, ReamarSubtleCard } from "@/components/ui/reamar-ui";
import type { RecommendationItem } from "@/lib/caseTypes";

type ShortlistRole = "top_pick" | "alternative" | "fallback" | "wild_card";

const ROLE_CONFIG: Record<ShortlistRole, { label: string; cls: string }> = {
  top_pick:   { label: "Top pick",    cls: "bg-slate-900 text-white" },
  alternative:{ label: "Alternativa", cls: "bg-blue-100 text-blue-800" },
  fallback:   { label: "Fallback",    cls: "bg-amber-100 text-amber-800" },
  wild_card:  { label: "Wild card",   cls: "bg-purple-100 text-purple-800" },
};

function assignRole(index: number): ShortlistRole {
  if (index === 0) return "top_pick";
  if (index === 1) return "alternative";
  if (index === 2) return "fallback";
  return "wild_card";
}

function confidenceHuman(label?: string): string {
  if (label === "high") return "Vysoká jistota";
  if (label === "medium") return "Střední jistota";
  if (label === "low") return "Nutno ověřit";
  return "—";
}

function eligibilityHuman(elig?: string): { text: string; cls: string } {
  if (elig === "pass") return { text: "Silná volba", cls: "text-emerald-700" };
  if (elig === "review") return { text: "Nutno ověřit", cls: "text-amber-700" };
  return { text: "—", cls: "text-slate-500" };
}

function readinessState(pinned: RecommendationItem[], notesCount: number, reviewCount: number, hasShare: boolean): { text: string; cls: string } {
  if (pinned.length === 0) return { text: "Prázdný shortlist", cls: "text-slate-500" };
  if (reviewCount > 0) return { text: "Needs verification", cls: "text-amber-700" };
  if (notesCount < pinned.length || !hasShare) return { text: "Draft", cls: "text-slate-600" };
  return { text: "Ready for meeting", cls: "text-emerald-700" };
}

function buildMeetingStrategy(pinned: RecommendationItem[], roles: Record<number, ShortlistRole>): string[] {
  const steps: string[] = [];
  const topPicks = pinned.filter((r) => roles[r.rec_id] === "top_pick");
  const alternatives = pinned.filter((r) => roles[r.rec_id] === "alternative");
  const fallbacks = pinned.filter((r) => roles[r.rec_id] === "fallback");
  const wildcards = pinned.filter((r) => roles[r.rec_id] === "wild_card");

  if (topPicks.length > 0) steps.push(`Začít Top pickem — ${topPicks[0].project_name || "hlavní doporučení"}. Představit jako nejsilnější volbu.`);
  if (alternatives.length > 0) steps.push(`Ukázat alternativu — ${alternatives[0].project_name || "další možnost"}. Bezpečná varianta pro porovnání.`);
  if (fallbacks.length > 0) steps.push(`Zmínit fallback — ${fallbacks[0].project_name || "záložní volba"}. Jen pokud klient chce širší výběr.`);
  if (wildcards.length > 0) steps.push(`Wild card — ${wildcards[0].project_name || "překvapení"}. Použít, pokud klient hledá něco neočekávaného.`);

  const reviewItems = pinned.filter((r) => r.eligibility === "review");
  if (reviewItems.length > 0) steps.push(`Upozornění: ${reviewItems.length} položk${reviewItems.length === 1 ? "a" : "y"} vyžaduj${reviewItems.length === 1 ? "e" : "í"} ověření před schůzkou.`);

  if (steps.length === 0) steps.push("Přiřaďte role položkám shortlistu pro doporučenou strategii.");

  return steps;
}

export default function PresentationPage() {
  const params = useParams();
  const clientId = Number(params?.id);
  const [token, setToken] = useState<string | null>(null);
  const [recs, setRecs] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [roles, setRoles] = useState<Record<number, ShortlistRole>>({});

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    setToken(t);
  }, []);

  useEffect(() => {
    if (!token || !clientId) return;
    setLoading(true);
    fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const items = data as RecommendationItem[];
        setRecs(items);
        const pinned = items.filter((r) => r.pinned_by_broker);
        setRoles(Object.fromEntries(pinned.map((r, i) => [r.rec_id, assignRole(i)])));
      })
      .finally(() => setLoading(false));
  }, [token, clientId]);

  const pinned = useMemo(() => recs.filter((r) => r.pinned_by_broker), [recs]);
  const notesCount = pinned.filter((r) => Boolean(r.broker_note)).length;
  const reviewCount = pinned.filter((r) => r.eligibility === "review").length;
  const readiness = readinessState(pinned, notesCount, reviewCount, !!shareUrl);
  const strategy = buildMeetingStrategy(pinned, roles);

  const handleCreateShareLink = async () => {
    if (!token) return;
    setShareLoading(true);
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/share-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setShareUrl(data.url);
      }
    } finally {
      setShareLoading(false);
    }
  };

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Presentation prep</h2>
          <p className="text-sm text-slate-500">Interní preview pro klientskou schůzku — zkontroluj, co bereš na stůl.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReamarButton variant="subtle" size="sm" onClick={handleCreateShareLink} disabled={shareLoading}>
            {shareLoading ? "Vytvářím…" : shareUrl ? "Znovu vytvořit link" : "Vytvořit share link"}
          </ReamarButton>
          <Link href={`/clients/${clientId}/present`} target="_blank">
            <ReamarButton variant="primary" size="sm">Fullscreen prezentace</ReamarButton>
          </Link>
          <Link href={`/clients/${clientId}/report`} target="_blank">
            <ReamarButton variant="ghost" size="sm">PDF report</ReamarButton>
          </Link>
        </div>
      </div>

      {/* 2. Readiness panel */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
        <ReamarCard className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Shortlist</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{pinned.length}</p>
        </ReamarCard>
        <ReamarCard className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Broker notes</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{notesCount} / {pinned.length}</p>
        </ReamarCard>
        <ReamarCard className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Nutno ověřit</p>
          <p className={`mt-1 text-2xl font-semibold ${reviewCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>{reviewCount}</p>
        </ReamarCard>
        <ReamarCard className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Share link</p>
          <p className={`mt-1 text-sm font-medium ${shareUrl ? "text-emerald-700" : "text-slate-500"}`}>{shareUrl ? "Připravený" : "Nevytvořen"}</p>
        </ReamarCard>
        <ReamarCard className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Připravenost</p>
          <p className={`mt-1 text-sm font-semibold ${readiness.cls}`}>{readiness.text}</p>
        </ReamarCard>
      </div>

      {/* Share link block */}
      {shareUrl ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
          <span className="text-emerald-700 font-medium">Share link:</span>
          <code className="flex-1 truncate text-emerald-900">{shareUrl}</code>
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            onClick={() => navigator.clipboard.writeText(shareUrl)}
          >
            Kopírovat
          </button>
        </div>
      ) : (
        <ReamarSubtleCard className="flex items-center justify-between px-4 py-3">
          <p className="text-sm text-slate-600">Share link zatím nevytvořen — klient ho potřebuje pro přístup k prezentaci.</p>
          <ReamarButton variant="subtle" size="sm" onClick={handleCreateShareLink} disabled={shareLoading}>
            {shareLoading ? "Vytvářím…" : "Vytvořit"}
          </ReamarButton>
        </ReamarSubtleCard>
      )}

      {/* 3. Presentation cards */}
      {pinned.length === 0 ? (
        <ReamarCard className="p-8 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">Shortlist je prázdný</h3>
            <p className="text-sm text-slate-600">Nejdřív přidej jednotky z Recommendations do shortlistu.</p>
            <Link href={`/cases/${clientId}/recommendations`}>
              <ReamarButton variant="primary">Přejít na Recommendations</ReamarButton>
            </Link>
          </div>
        </ReamarCard>
      ) : (
        <div className="space-y-4">
          {pinned.map((rec) => {
            const role = roles[rec.rec_id] || "alternative";
            const roleCfg = ROLE_CONFIG[role];
            const elig = eligibilityHuman(rec.eligibility);
            const conf = confidenceHuman(rec.confidence_label);

            return (
              <ReamarCard key={rec.rec_id} className="overflow-hidden">
                {/* Card header */}
                <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${roleCfg.cls}`}>
                        {roleCfg.label}
                      </span>
                      <h3 className="text-base font-semibold text-slate-900">
                        {rec.project_name || "—"}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-medium ${elig.cls}`}>{elig.text}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-500">{conf}</span>
                    </div>
                  </div>
                  {rec.district && (
                    <p className="mt-1 text-xs text-slate-500">{rec.district}</p>
                  )}
                </div>

                {/* Card body */}
                <div className="px-5 py-4 space-y-4">
                  {/* Key facts */}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {rec.layout_label && (
                      <div>
                        <span className="text-[11px] text-slate-500">Dispozice</span>
                        <p className="font-medium text-slate-900">{rec.layout_label}</p>
                      </div>
                    )}
                    {rec.floor_area_m2 != null && (
                      <div>
                        <span className="text-[11px] text-slate-500">Plocha</span>
                        <p className="font-medium text-slate-900">{formatAreaM2(rec.floor_area_m2)}</p>
                      </div>
                    )}
                    {rec.price_czk != null && (
                      <div>
                        <span className="text-[11px] text-slate-500">Cena</span>
                        <p className="font-medium text-slate-900">{formatCurrencyCzk(rec.price_czk)}</p>
                      </div>
                    )}
                    {rec.exterior_area_m2 != null && Number(rec.exterior_area_m2) > 0 && (
                      <div>
                        <span className="text-[11px] text-slate-500">Venkovní plocha</span>
                        <p className="font-medium text-slate-900">{formatAreaM2(rec.exterior_area_m2)}</p>
                      </div>
                    )}
                    {rec.floor != null && (
                      <div>
                        <span className="text-[11px] text-slate-500">Patro</span>
                        <p className="font-medium text-slate-900">{rec.floor}.</p>
                      </div>
                    )}
                  </div>

                  {/* Why we recommend + watch out */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-emerald-50/70 p-3">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Proč doporučujeme</p>
                      {rec.top_strengths && rec.top_strengths.length > 0 ? (
                        <ul className="space-y-1 text-sm text-emerald-900">
                          {rec.top_strengths.slice(0, 3).map((s, i) => (
                            <li key={i}>+ {s}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-emerald-800">Dobrý celkový fit s požadavky klienta.</p>
                      )}
                    </div>
                    <div className="rounded-xl bg-amber-50/70 p-3">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Na co upozornit</p>
                      {(rec.top_compromises && rec.top_compromises.length > 0) || (rec.eligibility_reasons && rec.eligibility_reasons.length > 0) ? (
                        <ul className="space-y-1 text-sm text-amber-900">
                          {(rec.top_compromises && rec.top_compromises.length > 0 ? rec.top_compromises : rec.eligibility_reasons || []).slice(0, 3).map((c, i) => (
                            <li key={i}>! {c}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-amber-800">Bez zásadních výhrad.</p>
                      )}
                    </div>
                  </div>

                  {/* Broker note — subtle hint */}
                  {rec.broker_note && (
                    <div className="rounded-xl border border-slate-200/70 bg-white/60 px-4 py-2.5">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1">Interní poznámka</p>
                      <p className="text-sm text-slate-600 italic whitespace-pre-wrap">{rec.broker_note}</p>
                    </div>
                  )}

                  {/* Detail link */}
                  {rec.unit_external_id && (
                    <Link
                      href={`/units/${rec.unit_external_id}`}
                      className="inline-block text-xs text-slate-500 hover:text-slate-700 hover:underline"
                    >
                      Detail jednotky →
                    </Link>
                  )}
                </div>
              </ReamarCard>
            );
          })}
        </div>
      )}

      {/* 4. Meeting framing box */}
      {pinned.length > 0 && (
        <ReamarCard className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Doporučená strategie prezentace</h3>
          <ol className="space-y-2">
            {strategy.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                  {i + 1}
                </span>
                <span className="text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
        </ReamarCard>
      )}
    </div>
  );
}

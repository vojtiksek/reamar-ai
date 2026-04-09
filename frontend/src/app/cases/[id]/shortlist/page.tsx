"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";
import type { RecommendationItem } from "@/lib/caseTypes";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

type ShortlistRole = "top_pick" | "alternative" | "fallback" | "wild_card";

const ROLE_LABELS: Record<ShortlistRole, string> = {
  top_pick: "Hlavní výběr",
  alternative: "Alternativa",
  fallback: "Záloha",
  wild_card: "Doplněk",
};

function confidenceBadge(label?: string) {
  if (label === "high") return "bg-emerald-100 text-emerald-800";
  if (label === "medium") return "bg-amber-100 text-amber-800";
  if (label === "low") return "bg-rose-100 text-rose-800";
  return "bg-slate-100 text-slate-700";
}

function feedbackLabel(type?: string) {
  if (type === "liked") return "Líbí se";
  if (type === "saved") return "Uloženo";
  if (type === "disliked") return "Nechci";
  return null;
}

const DISLIKE_REASON_LABELS: Record<string, string> = {
  price: "Cena",
  location: "Lokalita",
  layout: "Dispozice",
  small_area: "Malá plocha",
  standard_or_project: "Standard / projekt",
  noise_or_surroundings: "Hluk / okolí",
  accessibility: "Dostupnost",
  other: "Jiné",
};

type ShortlistViewMode = "projects" | "units";

type ShortlistProjectGroup = {
  project_id: number | null;
  project_name: string;
  district: string | null;
  units: RecommendationItem[];
  price_range: [number | null, number | null];
  layouts: string[];
  best_score: number;
};

function buildShortlistGroups(pinned: RecommendationItem[]): ShortlistProjectGroup[] {
  const map = new Map<number | null, RecommendationItem[]>();
  for (const r of pinned) {
    const key = r.project_id ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const groups: ShortlistProjectGroup[] = [];
  for (const [pid, units] of map) {
    const sorted = [...units].sort((a, b) => b.score - a.score);
    const prices = units.map((u) => u.price_czk).filter((p): p is number => p != null);
    const layouts = [...new Set(units.map((u) => u.layout_label).filter(Boolean))] as string[];
    groups.push({
      project_id: pid,
      project_name: sorted[0].project_name ?? sorted[0].unit_external_id ?? "Neznámý projekt",
      district: sorted[0].district ?? null,
      units: sorted,
      price_range: [prices.length ? Math.min(...prices) : null, prices.length ? Math.max(...prices) : null],
      layouts,
      best_score: sorted[0].score,
    });
  }
  groups.sort((a, b) => b.best_score - a.best_score);
  return groups;
}

/* ───────── Unit card (shared between both views) ───────── */

function ShortlistUnitCard({
  rec,
  index,
  roles,
  reasons,
  editingNote,
  noteText,
  onRoleChange,
  onReasonChange,
  onEditNote,
  onSaveNote,
  onCancelNote,
  onNoteTextChange,
  onUnpin,
  compact,
}: {
  rec: RecommendationItem;
  index: number;
  roles: Record<number, ShortlistRole>;
  reasons: Record<number, string>;
  editingNote: number | null;
  noteText: string;
  onRoleChange: (recId: number, role: ShortlistRole) => void;
  onReasonChange: (recId: number, text: string) => void;
  onEditNote: (recId: number) => void;
  onSaveNote: (recId: number) => void;
  onCancelNote: () => void;
  onNoteTextChange: (text: string) => void;
  onUnpin: (recId: number) => void;
  compact?: boolean;
}) {
  const fbLabel = feedbackLabel(rec.feedback?.feedback_type);

  if (compact) {
    return (
      <div className="border-t border-slate-100 px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white">#{index + 1}</span>
              <select
                value={roles[rec.rec_id] || "alternative"}
                onChange={(e) => onRoleChange(rec.rec_id, e.target.value as ShortlistRole)}
                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700"
              >
                {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <span className="text-sm font-medium text-slate-900">{rec.layout_label ?? "—"}</span>
              <span className="text-sm text-slate-500">
                {rec.floor_area_m2 != null ? `${Math.round(rec.floor_area_m2)} m²` : ""}
                {rec.floor != null ? ` · ${rec.floor}. p.` : ""}
              </span>
              <span className="text-sm font-medium text-slate-900">{rec.price_czk != null ? formatCurrencyCzk(rec.price_czk) : "—"}</span>
              <span className="text-xs text-slate-400">shoda {Math.round(rec.score)} %</span>
              {fbLabel && (
                <span className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                  rec.feedback?.feedback_type === "liked" ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                  rec.feedback?.feedback_type === "disliked" ? "bg-rose-50 text-rose-800 border-rose-200" :
                  "bg-blue-50 text-blue-800 border-blue-200"
                )}>{fbLabel}</span>
              )}
            </div>
            {/* Inline note + reason row */}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {rec.top_strengths?.[0] && (
                <span className="text-emerald-700">+ {rec.top_strengths[0]}</span>
              )}
              {rec.top_compromises?.[0] && (
                <span className="text-amber-700">! {rec.top_compromises[0]}</span>
              )}
              {rec.broker_note && (
                <span className="text-slate-500 italic">„{rec.broker_note}"</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="text-xs text-slate-400 hover:text-slate-600"
              onClick={() => onEditNote(rec.rec_id)}
              title="Poznámka"
            >✎</button>
            <Link href={rec.unit_external_id ? `/units/${rec.unit_external_id}` : "#"} className="text-xs text-slate-400 hover:text-slate-700" title="Detail">↗</Link>
            <button onClick={() => onUnpin(rec.rec_id)} className="text-xs text-slate-400 hover:text-rose-600" title="Odebrat">✕</button>
          </div>
        </div>
        {/* Inline note editor */}
        {editingNote === rec.rec_id && (
          <div className="mt-2 space-y-2 pl-8">
            <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} value={noteText} onChange={(e) => onNoteTextChange(e.target.value)} placeholder="Interní poznámka…" />
            <div className="flex gap-2">
              <ReamarButton size="sm" variant="primary" onClick={() => onSaveNote(rec.rec_id)}>Uložit</ReamarButton>
              <ReamarButton size="sm" variant="ghost" onClick={onCancelNote}>Zrušit</ReamarButton>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full card (units view)
  return (
    <ReamarCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">#{index + 1}</span>
              <select
                value={roles[rec.rec_id] || "alternative"}
                onChange={(e) => onRoleChange(rec.rec_id, e.target.value as ShortlistRole)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
              >
                {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${rec.eligibility === "review" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{rec.eligibility === "review" ? "K prověření" : "Připraveno"}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confidenceBadge(rec.confidence_label)}`}>Jistota: {rec.confidence_label === "high" ? "vysoká" : rec.confidence_label === "medium" ? "střední" : rec.confidence_label === "low" ? "nízká" : "—"}</span>
            </div>
            <h3 className="mt-2 text-base font-semibold text-slate-900">{rec.project_name || rec.unit_external_id || "—"}</h3>
            <p className="mt-1 text-sm text-slate-500">{rec.unit_external_id ?? "—"}{rec.layout_label ? ` · ${rec.layout_label}` : ""}{rec.floor_area_m2 != null ? ` · ${formatAreaM2(rec.floor_area_m2)}` : ""}{rec.price_czk != null ? ` · ${formatCurrencyCzk(rec.price_czk)}` : ""}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proč je ve výběru</p>
              <textarea
                value={reasons[rec.rec_id] || ""}
                onChange={(e) => onReasonChange(rec.rec_id, e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                rows={3}
              />
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Feedback</p>
              {rec.feedback ? (
                <div className="space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium">Stav:</span> {fbLabel}</p>
                  {rec.feedback.dislike_reason && <p><span className="font-medium">Důvod:</span> {DISLIKE_REASON_LABELS[rec.feedback.dislike_reason] || rec.feedback.dislike_reason}</p>}
                  {rec.feedback.note && <p><span className="font-medium">Poznámka:</span> {rec.feedback.note}</p>}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Zatím bez feedbacku.</p>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Na co si dát pozor</p>
              {rec.top_compromises?.length || rec.eligibility_reasons?.length ? (
                <ul className="space-y-1 text-sm text-slate-600">
                  {(rec.top_compromises && rec.top_compromises.length ? rec.top_compromises : rec.eligibility_reasons || []).slice(0,3).map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              ) : <p className="text-sm text-slate-500">Bez zásadního rizika.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Interní poznámka</p>
            {editingNote === rec.rec_id ? (
              <div className="space-y-2">
                <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={3} value={noteText} onChange={(e) => onNoteTextChange(e.target.value)} placeholder="Jak to prodat / co ověřit před schůzkou…" />
                <div className="flex gap-2">
                  <ReamarButton size="sm" variant="primary" onClick={() => onSaveNote(rec.rec_id)}>Uložit</ReamarButton>
                  <ReamarButton size="sm" variant="ghost" onClick={onCancelNote}>Zrušit</ReamarButton>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{rec.broker_note || "Zatím bez poznámky."}</p>
                <button className="text-xs text-slate-500 hover:underline" onClick={() => onEditNote(rec.rec_id)}>Upravit</button>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Link href={rec.unit_external_id ? `/units/${rec.unit_external_id}` : "#"}><ReamarButton variant="subtle" size="sm">Detail</ReamarButton></Link>
          <button onClick={() => onUnpin(rec.rec_id)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600">Odebrat</button>
        </div>
      </div>
    </ReamarCard>
  );
}

/* ───────── Main page ───────── */

export default function ShortlistPage() {
  const params = useParams();
  const clientId = Number(params?.id);
  const [token, setToken] = useState<string | null>(null);
  const [recs, setRecs] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [roles, setRoles] = useState<Record<number, ShortlistRole>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<ShortlistViewMode>(() => {
    if (typeof window === "undefined") return "projects";
    const saved = localStorage.getItem("reamar_shortlist_view");
    return saved === "units" ? "units" : "projects";
  });

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
        setRoles(Object.fromEntries(pinned.map((r, i) => [r.rec_id, i === 0 ? "top_pick" : i === 1 ? "alternative" : i === 2 ? "fallback" : "wild_card"] as const)));
        setReasons(Object.fromEntries(pinned.map((r) => [r.rec_id, r.top_strengths?.[0] || "Dobrý celkový fit"] )));
      })
      .finally(() => setLoading(false));
  }, [token, clientId]);

  const pinned = useMemo(() => recs.filter((r) => r.pinned_by_broker), [recs]);
  const groups = useMemo(() => buildShortlistGroups(pinned), [pinned]);
  const reviewCount = pinned.filter((r) => r.eligibility === "review").length;
  const notesCount = pinned.filter((r) => Boolean(r.broker_note)).length;

  const handleUnpin = async (recId: number) => {
    if (!token) return;
    setRecs((prev) => prev.map((r) => (r.rec_id === recId ? { ...r, pinned_by_broker: false } : r)));
    await fetch(`${API_BASE}/clients/${clientId}/recommendations/${recId}/pin`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  const handleSaveNote = async (recId: number) => {
    if (!token) return;
    await fetch(`${API_BASE}/clients/${clientId}/recommendations/${recId}/note`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ broker_note: noteText }),
    });
    setRecs((prev) => prev.map((r) => (r.rec_id === recId ? { ...r, broker_note: noteText } : r)));
    setEditingNote(null);
    setNoteText("");
  };

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

  const cardProps = {
    roles,
    reasons,
    editingNote,
    noteText,
    onRoleChange: (recId: number, role: ShortlistRole) => setRoles((prev) => ({ ...prev, [recId]: role })),
    onReasonChange: (recId: number, text: string) => setReasons((prev) => ({ ...prev, [recId]: text })),
    onEditNote: (recId: number) => { setEditingNote(recId); setNoteText(recs.find((r) => r.rec_id === recId)?.broker_note || ""); },
    onSaveNote: handleSaveNote,
    onCancelNote: () => setEditingNote(null),
    onNoteTextChange: setNoteText,
    onUnpin: handleUnpin,
  };

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  if (pinned.length === 0) {
    return (
      <ReamarCard className="p-8 text-center">
        <div className="mx-auto max-w-md space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Výběr je prázdný</h3>
          <p className="text-sm text-slate-600">Zatím žádné jednotky ve výběru. Přidejte je z doporučení.</p>
          <Link href={`/cases/${clientId}/recommendations`}><ReamarButton variant="primary">Přejít na doporučení</ReamarButton></Link>
        </div>
      </ReamarCard>
    );
  }

  // Build a flat index map: rec_id → global position across all groups
  const globalIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    let idx = 0;
    for (const g of groups) {
      for (const u of g.units) {
        map.set(u.rec_id, idx++);
      }
    }
    return map;
  }, [groups]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Výběr pro klienta</h2>
          <p className="text-sm text-slate-500">Výběr jednotek připravený k prezentaci.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {([
              { key: "projects" as const, label: "Projekty" },
              { key: "units" as const, label: "Jednotky" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
                onClick={() => { setViewMode(key); localStorage.setItem("reamar_shortlist_view", key); }}
              >
                {label}
              </button>
            ))}
          </div>
          <ReamarButton variant="subtle" size="sm" onClick={handleCreateShareLink} disabled={shareLoading}>{shareLoading ? "Vytvářím…" : "Odkaz pro klienta"}</ReamarButton>
          <Link href={`/cases/${clientId}/presentation`}><ReamarButton variant="primary" size="sm">Prezentace</ReamarButton></Link>
        </div>
      </div>

      {/* Readiness panel */}
      <div className="grid gap-3 md:grid-cols-4">
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Ve výběru</p><p className="mt-1 text-2xl font-semibold text-slate-900">{pinned.length}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Projektů</p><p className="mt-1 text-2xl font-semibold text-slate-900">{groups.length}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Poznámky</p><p className="mt-1 text-2xl font-semibold text-slate-900">{notesCount}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Sdílený odkaz</p><p className="mt-1 text-sm font-medium text-slate-900">{shareUrl ? "Připravený" : "Ještě nevytvořen"}</p></ReamarCard>
      </div>

      {shareUrl && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
          <span className="text-emerald-700 font-medium">Sdílený odkaz:</span>
          <code className="flex-1 truncate text-emerald-900">{shareUrl}</code>
          <button className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700" onClick={() => navigator.clipboard.writeText(shareUrl)}>Kopírovat</button>
        </div>
      )}

      {/* Projects view */}
      {viewMode === "projects" && (
        <div className="space-y-4">
          {groups.map((group) => (
            <ReamarCard key={group.project_id ?? "unknown"} className="overflow-hidden">
              {/* Project header */}
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{group.project_name}</h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {group.district ? `${group.district} · ` : ""}
                      {group.units.length} {group.units.length === 1 ? "jednotka" : group.units.length < 5 ? "jednotky" : "jednotek"} ve výběru
                      {group.layouts.length > 0 ? ` · ${group.layouts.join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {group.price_range[0] != null && (
                      <p className="text-sm font-medium text-slate-900">
                        {group.price_range[0] === group.price_range[1]
                          ? formatCurrencyCzk(group.price_range[0]!)
                          : `${formatCurrencyCzk(group.price_range[0]!)} – ${formatCurrencyCzk(group.price_range[1]!)}`}
                      </p>
                    )}
                    <p className="text-xs text-slate-400">top shoda {Math.round(group.best_score)} %</p>
                  </div>
                </div>
              </div>
              {/* Units inside project */}
              {group.units.map((rec) => (
                  <ShortlistUnitCard key={rec.rec_id} rec={rec} index={globalIndexMap.get(rec.rec_id) ?? 0} compact {...cardProps} />
              ))}
            </ReamarCard>
          ))}
        </div>
      )}

      {/* Units view (original flat list) */}
      {viewMode === "units" && (
        <div className="space-y-4">
          {pinned.map((rec, index) => (
            <ShortlistUnitCard key={rec.rec_id} rec={rec} index={index} {...cardProps} />
          ))}
        </div>
      )}
    </div>
  );
}

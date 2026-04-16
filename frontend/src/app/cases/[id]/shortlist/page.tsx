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
  min_order: number; // for group-level sort
};

/** Build project groups preserving the broker's custom ordering.
 *  Group order = position of first unit from each project in orderedPinned.
 *  Unit order within a group = position in orderedPinned. */
function buildShortlistGroups(orderedPinned: RecommendationItem[]): ShortlistProjectGroup[] {
  const groupOrder = new Map<number | null, number>(); // project_id → first index
  const groupUnits = new Map<number | null, RecommendationItem[]>();

  for (let i = 0; i < orderedPinned.length; i++) {
    const r = orderedPinned[i];
    const key = r.project_id ?? null;
    if (!groupOrder.has(key)) {
      groupOrder.set(key, i);
      groupUnits.set(key, []);
    }
    groupUnits.get(key)!.push(r);
  }

  const groups: ShortlistProjectGroup[] = [];
  for (const [pid, units] of groupUnits) {
    const prices = units.map((u) => u.price_czk).filter((p): p is number => p != null);
    const layouts = [...new Set(units.map((u) => u.layout_label).filter(Boolean))] as string[];
    groups.push({
      project_id: pid,
      project_name: units[0].project_name ?? units[0].unit_external_id ?? "Neznámý projekt",
      district: units[0].district ?? null,
      units,
      price_range: [prices.length ? Math.min(...prices) : null, prices.length ? Math.max(...prices) : null],
      layouts,
      best_score: Math.max(...units.map((u) => u.score)),
      min_order: groupOrder.get(pid)!,
    });
  }
  groups.sort((a, b) => a.min_order - b.min_order);
  return groups;
}

/* ───────── Unit card ───────── */

function ShortlistUnitCard({
  rec,
  index,
  totalCount,
  roles,
  reasons,
  editingNote,
  noteText,
  onRoleChange,
  onReasonBlur,
  onReasonChange,
  onEditNote,
  onSaveNote,
  onCancelNote,
  onNoteTextChange,
  onUnpin,
  onMoveUp,
  onMoveDown,
  compact,
}: {
  rec: RecommendationItem;
  index: number;
  totalCount: number;
  roles: Record<number, ShortlistRole>;
  reasons: Record<number, string>;
  editingNote: number | null;
  noteText: string;
  onRoleChange: (recId: number, role: ShortlistRole) => void;
  onReasonBlur: (recId: number) => void;
  onReasonChange: (recId: number, text: string) => void;
  onEditNote: (recId: number) => void;
  onSaveNote: (recId: number) => void;
  onCancelNote: () => void;
  onNoteTextChange: (text: string) => void;
  onUnpin: (recId: number) => void;
  onMoveUp: (recId: number) => void;
  onMoveDown: (recId: number) => void;
  compact?: boolean;
}) {
  const fbLabel = feedbackLabel(rec.feedback?.feedback_type);

  /** Order controls — small up/down arrows */
  const orderControls = (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMoveUp(rec.rec_id)}
        title="Přesunout výše"
        className="rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20"
      >▲</button>
      <button
        type="button"
        disabled={index === totalCount - 1}
        onClick={() => onMoveDown(rec.rec_id)}
        title="Přesunout níže"
        className="rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20"
      >▼</button>
    </div>
  );

  if (compact) {
    return (
      <div className="border-t border-slate-100 px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex shrink-0 items-center gap-1">{orderControls}</div>
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
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {reasons[rec.rec_id] && (
                <span className="text-slate-600">„{reasons[rec.rec_id]}"</span>
              )}
              {rec.broker_note && (
                <span className="text-slate-400 italic">Pozn.: {rec.broker_note}</span>
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
      <div className="flex items-start gap-3">
        {/* Order controls on the left */}
        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">{orderControls}</div>

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
                value={reasons[rec.rec_id] ?? ""}
                onChange={(e) => onReasonChange(rec.rec_id, e.target.value)}
                onBlur={() => onReasonBlur(rec.rec_id)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                rows={3}
                placeholder="Proč tuto jednotku doporučujeme…"
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
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [roles, setRoles] = useState<Record<number, ShortlistRole>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  // Ordered list of rec_ids representing broker's custom shortlist order.
  const [orderedIds, setOrderedIds] = useState<number[]>([]);
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
        // Sort by persisted shortlist_order (nulls last), then by score.
        const sorted = [...pinned].sort((a, b) => {
          const ao = a.shortlist_order ?? 999999;
          const bo = b.shortlist_order ?? 999999;
          if (ao !== bo) return ao - bo;
          return b.score - a.score;
        });
        setOrderedIds(sorted.map((r) => r.rec_id));
        // Use persisted role; fall back to unset (select will show "Alternativa" visually).
        setRoles(Object.fromEntries(
          pinned
            .filter((r) => r.shortlist_role)
            .map((r) => [r.rec_id, r.shortlist_role as ShortlistRole])
        ));
        // Use persisted reason; empty string if not set.
        setReasons(Object.fromEntries(
          pinned.map((r) => [r.rec_id, r.shortlist_reason ?? ""])
        ));
      })
      .finally(() => setLoading(false));
  }, [token, clientId]);

  /** Persist any shortlist metadata field(s) for a single rec. */
  const patchShortlist = async (
    recId: number,
    payload: { shortlist_role?: string | null; shortlist_reason?: string | null; shortlist_order?: number | null },
  ) => {
    if (!token) return;
    await fetch(`${API_BASE}/clients/${clientId}/recommendations/${recId}/shortlist`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const handleRoleChange = (recId: number, role: ShortlistRole) => {
    setRoles((prev) => ({ ...prev, [recId]: role }));
    patchShortlist(recId, { shortlist_role: role });
  };

  const handleReasonChange = (recId: number, text: string) => {
    setReasons((prev) => ({ ...prev, [recId]: text }));
  };

  /** Persist reason when the textarea loses focus. */
  const handleReasonBlur = (recId: number) => {
    patchShortlist(recId, { shortlist_reason: reasons[recId] ?? "" });
  };

  const handleMoveUp = (recId: number) => {
    const idx = orderedIds.indexOf(recId);
    if (idx <= 0) return;
    const next = [...orderedIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setOrderedIds(next);
    patchShortlist(next[idx - 1], { shortlist_order: idx - 1 });
    patchShortlist(next[idx], { shortlist_order: idx });
  };

  const handleMoveDown = (recId: number) => {
    const idx = orderedIds.indexOf(recId);
    if (idx >= orderedIds.length - 1) return;
    const next = [...orderedIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setOrderedIds(next);
    patchShortlist(next[idx], { shortlist_order: idx });
    patchShortlist(next[idx + 1], { shortlist_order: idx + 1 });
  };

  const handleUnpin = async (recId: number) => {
    if (!token) return;
    setRecs((prev) => prev.map((r) => (r.rec_id === recId ? { ...r, pinned_by_broker: false } : r)));
    setOrderedIds((prev) => prev.filter((id) => id !== recId));
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

  const handlePortalInvite = async () => {
    if (!token) return;
    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/portal-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "" }));
        const detail: string = err.detail ?? "";
        if (detail.toLowerCase().includes("no email")) {
          setInviteError("no_email");
        } else {
          setInviteError(detail || "Nepodařilo se vytvořit pozvánku");
        }
        return;
      }
      const data = await res.json();
      setInviteLink(data.magic_link_url);
    } finally {
      setInviteLoading(false);
    }
  };

  // Derive the ordered pinned list from orderedIds + recs.
  const orderedPinned = useMemo(() => {
    const byId = new Map(recs.map((r) => [r.rec_id, r]));
    return orderedIds.map((id) => byId.get(id)).filter((r): r is RecommendationItem => r != null && r.pinned_by_broker);
  }, [orderedIds, recs]);

  const groups = useMemo(() => buildShortlistGroups(orderedPinned), [orderedPinned]);
  const reviewCount = orderedPinned.filter((r) => r.eligibility === "review").length;
  const notesCount = orderedPinned.filter((r) => Boolean(r.broker_note)).length;

  const cardProps = {
    totalCount: orderedPinned.length,
    roles,
    reasons,
    editingNote,
    noteText,
    onRoleChange: handleRoleChange,
    onReasonChange: handleReasonChange,
    onReasonBlur: handleReasonBlur,
    onEditNote: (recId: number) => { setEditingNote(recId); setNoteText(recs.find((r) => r.rec_id === recId)?.broker_note || ""); },
    onSaveNote: handleSaveNote,
    onCancelNote: () => setEditingNote(null),
    onNoteTextChange: setNoteText,
    onUnpin: handleUnpin,
    onMoveUp: handleMoveUp,
    onMoveDown: handleMoveDown,
  };

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  if (orderedPinned.length === 0) {
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

  // Global position lookup for the # badge
  const globalIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    orderedPinned.forEach((r, i) => map.set(r.rec_id, i));
    return map;
  }, [orderedPinned]);

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
          <div className="flex flex-col items-end gap-1">
            <ReamarButton variant="subtle" size="sm" onClick={handlePortalInvite} disabled={inviteLoading}>{inviteLoading ? "Vytvářím…" : "Pozvat do portálu"}</ReamarButton>
            {inviteError === "no_email" && (
              <p className="text-[11px] text-amber-600">
                Klient nemá e-mail —{" "}
                <a href={`/cases/${clientId}/brief`} className="underline hover:text-amber-800">doplnit v detailu</a>
              </p>
            )}
            {inviteError && inviteError !== "no_email" && (
              <p className="text-[11px] text-red-500">{inviteError}</p>
            )}
          </div>
          <Link href={`/cases/${clientId}/presentation`}><ReamarButton variant="primary" size="sm">Prezentace</ReamarButton></Link>
        </div>
      </div>

      {/* Readiness panel */}
      <div className="grid gap-3 md:grid-cols-4">
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Ve výběru</p><p className="mt-1 text-2xl font-semibold text-slate-900">{orderedPinned.length}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Projektů</p><p className="mt-1 text-2xl font-semibold text-slate-900">{groups.length}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Poznámky</p><p className="mt-1 text-2xl font-semibold text-slate-900">{notesCount}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Portálová pozvánka</p><p className="mt-1 text-sm font-medium text-slate-900">{inviteLink ? "Připravená" : "Ještě nevytvořena"}</p></ReamarCard>
      </div>

      {inviteLink && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
          <span className="text-emerald-700 font-medium">Odkaz do portálu:</span>
          <code className="flex-1 truncate text-emerald-900">{inviteLink}</code>
          <button className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700" onClick={() => navigator.clipboard.writeText(inviteLink)}>Kopírovat</button>
        </div>
      )}

      {/* Review warning */}
      {reviewCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ⚠ {reviewCount} {reviewCount === 1 ? "položka vyžaduje" : "položky vyžadují"} ověření před schůzkou.
        </div>
      )}

      {/* Projects view */}
      {viewMode === "projects" && (
        <div className="space-y-4">
          {groups.map((group) => (
            <ReamarCard key={group.project_id ?? "unknown"} className="overflow-hidden">
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
              {group.units.map((rec) => (
                <ShortlistUnitCard key={rec.rec_id} rec={rec} index={globalIndexMap.get(rec.rec_id) ?? 0} compact {...cardProps} />
              ))}
            </ReamarCard>
          ))}
        </div>
      )}

      {/* Units view */}
      {viewMode === "units" && (
        <div className="space-y-4">
          {orderedPinned.map((rec, index) => (
            <ShortlistUnitCard key={rec.rec_id} rec={rec} index={index} {...cardProps} />
          ))}
        </div>
      )}
    </div>
  );
}

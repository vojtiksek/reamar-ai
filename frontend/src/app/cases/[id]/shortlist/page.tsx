"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";
import type { RecommendationItem } from "@/lib/caseTypes";

type ShortlistRole = "top_pick" | "alternative" | "fallback" | "wild_card";

const ROLE_LABELS: Record<ShortlistRole, string> = {
  top_pick: "Top pick",
  alternative: "Alternative",
  fallback: "Fallback",
  wild_card: "Wild card",
};

function confidenceBadge(label?: string) {
  if (label === "high") return "bg-emerald-100 text-emerald-800";
  if (label === "medium") return "bg-amber-100 text-amber-800";
  if (label === "low") return "bg-rose-100 text-rose-800";
  return "bg-slate-100 text-slate-700";
}

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

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  if (pinned.length === 0) {
    return (
      <ReamarCard className="p-8 text-center">
        <div className="mx-auto max-w-md space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Shortlist je prázdný</h3>
          <p className="text-sm text-slate-600">Zatím žádné jednotky ve shortlistu. Přidej je z decision feedu v Recommendations.</p>
          <Link href={`/cases/${clientId}/recommendations`}><ReamarButton variant="primary">Přejít na Recommendations</ReamarButton></Link>
        </div>
      </ReamarCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Curated shortlist</h2>
          <p className="text-sm text-slate-500">Výběr, který skutečně vezmeš klientovi na stůl.</p>
        </div>
        <div className="flex gap-2">
          <ReamarButton variant="subtle" size="sm" onClick={handleCreateShareLink} disabled={shareLoading}>{shareLoading ? "Vytvářím…" : "Vytvořit share link"}</ReamarButton>
          <Link href={`/cases/${clientId}/presentation`}><ReamarButton variant="primary" size="sm">Otevřít prezentaci</ReamarButton></Link>
        </div>
      </div>

      {/* Readiness panel */}
      <div className="grid gap-3 md:grid-cols-4">
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Shortlist</p><p className="mt-1 text-2xl font-semibold text-slate-900">{pinned.length}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Broker notes</p><p className="mt-1 text-2xl font-semibold text-slate-900">{notesCount}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Nutno ověřit</p><p className="mt-1 text-2xl font-semibold text-amber-700">{reviewCount}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Share link</p><p className="mt-1 text-sm font-medium text-slate-900">{shareUrl ? "Připravený" : "Ještě nevytvořen"}</p></ReamarCard>
      </div>

      {shareUrl && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
          <span className="text-emerald-700 font-medium">Share link:</span>
          <code className="flex-1 truncate text-emerald-900">{shareUrl}</code>
          <button className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700" onClick={() => navigator.clipboard.writeText(shareUrl)}>Kopírovat</button>
        </div>
      )}

      {/* Ordered shortlist */}
      <div className="space-y-4">
        {pinned.map((rec, index) => (
          <ReamarCard key={rec.rec_id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">#{index + 1}</span>
                    <select
                      value={roles[rec.rec_id] || "alternative"}
                      onChange={(e) => setRoles((prev) => ({ ...prev, [rec.rec_id]: e.target.value as ShortlistRole }))}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${rec.eligibility === "review" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{rec.eligibility === "review" ? "Nutno prověřit" : "Ready"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confidenceBadge(rec.confidence_label)}`}>Confidence {rec.confidence_label || "—"}</span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-slate-900">{rec.project_name || rec.unit_external_id || "—"}</h3>
                  <p className="mt-1 text-sm text-slate-500">{rec.unit_external_id ?? "—"}{rec.layout_label ? ` · ${rec.layout_label}` : ""}{rec.floor_area_m2 != null ? ` · ${formatAreaM2(rec.floor_area_m2)}` : ""}{rec.price_czk != null ? ` · ${formatCurrencyCzk(rec.price_czk)}` : ""}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason for inclusion</p>
                    <textarea
                      value={reasons[rec.rec_id] || ""}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [rec.rec_id]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      rows={3}
                    />
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Risk / verify</p>
                    {rec.top_compromises?.length || rec.eligibility_reasons?.length ? (
                      <ul className="space-y-1 text-sm text-slate-600">
                        {(rec.top_compromises && rec.top_compromises.length ? rec.top_compromises : rec.eligibility_reasons || []).slice(0,3).map((item, idx) => <li key={idx}>• {item}</li>)}
                      </ul>
                    ) : <p className="text-sm text-slate-500">Bez zásadního rizika.</p>}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Broker note</p>
                  {editingNote === rec.rec_id ? (
                    <div className="space-y-2">
                      <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Jak to prodat / co ověřit před schůzkou…" />
                      <div className="flex gap-2">
                        <ReamarButton size="sm" variant="primary" onClick={() => handleSaveNote(rec.rec_id)}>Uložit</ReamarButton>
                        <ReamarButton size="sm" variant="ghost" onClick={() => setEditingNote(null)}>Zrušit</ReamarButton>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{rec.broker_note || "Zatím bez interní poznámky."}</p>
                      <button className="text-xs text-slate-500 hover:underline" onClick={() => { setEditingNote(rec.rec_id); setNoteText(rec.broker_note || ""); }}>Upravit</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <Link href={rec.unit_external_id ? `/units/${rec.unit_external_id}` : "#"}><ReamarButton variant="subtle" size="sm">Detail</ReamarButton></Link>
                <button onClick={() => handleUnpin(rec.rec_id)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600">Odebrat</button>
              </div>
            </div>
          </ReamarCard>
        ))}
      </div>
    </div>
  );
}

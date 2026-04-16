"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk } from "@/lib/format";
import { ReamarCard, ReamarButton } from "@/components/ui/reamar-ui";
import type { RecommendationItem } from "@/lib/caseTypes";

type ShortlistRole = "top_pick" | "alternative" | "fallback" | "wild_card";

const ROLE_OPTIONS: { value: ShortlistRole; label: string; cls: string }[] = [
  { value: "top_pick",    label: "Hlavní volba",      cls: "bg-slate-900 text-white" },
  { value: "alternative", label: "Alternativa",       cls: "bg-blue-100 text-blue-800" },
  { value: "fallback",    label: "Záložní varianta",  cls: "bg-amber-100 text-amber-800" },
  { value: "wild_card",   label: "Odvážnější tip",    cls: "bg-purple-100 text-purple-800" },
];

type CommuteDetail = { label: string; mode: string; minutes: number; passed: boolean; is_estimated?: boolean };

function NoiseBadge({ label }: { label?: string | null }) {
  if (!label) return null;
  const isHigh = /vyšší|vysoký|vysoká/i.test(label);
  const isMed = /střední/i.test(label);
  return (
    <span className={clsx("rounded px-1 py-0.5 text-[10px] font-medium",
      isHigh ? "bg-rose-100 text-rose-700" : isMed ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
    )}>Hluk: {label}</span>
  );
}

function NearBadge({ label }: { label: string }) {
  return <span className="rounded bg-rose-50 px-1 py-0.5 text-[10px] font-medium text-rose-600">{label}</span>;
}

function MhdBadges({ rec }: { rec: RecommendationItem }) {
  const items: { emoji: string; label: string; dist: number }[] = [];
  if (rec.distance_to_metro_station_m != null && rec.distance_to_metro_station_m <= 600)
    items.push({ emoji: "🚇", label: "Metro", dist: rec.distance_to_metro_station_m });
  if (rec.distance_to_tram_stop_m != null && rec.distance_to_tram_stop_m <= 300)
    items.push({ emoji: "🚋", label: "Tram", dist: rec.distance_to_tram_stop_m });
  if (rec.distance_to_bus_stop_m != null && rec.distance_to_bus_stop_m <= 200)
    items.push({ emoji: "🚌", label: "Bus", dist: rec.distance_to_bus_stop_m });
  if (!items.length) return null;
  return (
    <>
      {items.map((i) => (
        <span key={i.label} className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700" title={`${i.label}: ${i.dist} m`}>
          {i.emoji} {Math.round(i.dist)} m
        </span>
      ))}
    </>
  );
}

const POI_LABELS: Record<string, string> = {
  supermarket: "🛒", pharmacy: "💊", park: "🌳", playground: "🎪",
  kindergarten: "👶", primary_school: "🏫", cafe: "☕", restaurant: "🍽️",
  gym: "🏋️", atm: "🏧", post_office: "📮", drugstore: "🧴",
};

function PoiBadges({ rec, activePrefs }: { rec: RecommendationItem; activePrefs: string[] }) {
  const counts = rec.poi_counts;
  if (!counts || !activePrefs.length) return null;
  const items = activePrefs.filter((k) => (counts[k] ?? 0) > 0).slice(0, 5);
  if (!items.length) return null;
  return (
    <>
      {items.map((k) => (
        <span key={k} className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
          {POI_LABELS[k] ?? k}{counts[k]}
        </span>
      ))}
    </>
  );
}

/* ─── Editable row ─── */
function PinnedRow({
  rec,
  token,
  clientId,
  commuteLabels,
  activePoiPrefs,
  onUpdate,
}: {
  rec: RecommendationItem;
  token: string;
  clientId: number;
  commuteLabels: string[];
  activePoiPrefs: string[];
  onUpdate: (recId: number, patch: Partial<RecommendationItem>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(rec.broker_note ?? "");
  const [reasonLines, setReasonLines] = useState<string[]>(() => (rec.shortlist_reason ?? "").split("\n").filter(Boolean));
  const [risksLines, setRisksLines] = useState<string[]>(() => (rec.shortlist_risks ?? "").split("\n").filter(Boolean));
  const [newReason, setNewReason] = useState("");
  const [newRisk, setNewRisk] = useState("");
  const [role, setRole] = useState<ShortlistRole>((rec.shortlist_role as ShortlistRole) ?? "alternative");
  const [saving, setSaving] = useState(false);

  const roleCfg = ROLE_OPTIONS.find((r) => r.value === role) ?? ROLE_OPTIONS[1];
  const details = (rec.reason?.commute_details ?? []) as CommuteDetail[];

  const saveNote = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/clients/${clientId}/recommendations/${rec.rec_id}/note`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ broker_note: note }),
      });
      onUpdate(rec.rec_id, { broker_note: note });
    } finally { setSaving(false); }
  };

  const saveShortlist = async (patch: { shortlist_role?: string; shortlist_reason?: string; shortlist_risks?: string }) => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/clients/${clientId}/recommendations/${rec.rec_id}/shortlist`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      onUpdate(rec.rec_id, patch as Partial<RecommendationItem>);
    } finally { setSaving(false); }
  };

  const commuteSum = (() => {
    let sum = 0; let any = false;
    for (const label of commuteLabels) { const d = details.find((cd) => cd.label === label); if (d) { sum += d.minutes; any = true; } }
    return any ? sum : null;
  })();

  const fbType = rec.feedback?.feedback_type;
  const priceDiffPct = rec.price_diff_pct;

  return (
    <>
      <tr
        className={clsx(
          "border-b border-slate-100 text-sm hover:bg-slate-50/80 transition-colors cursor-pointer",
          fbType === "liked" && "bg-emerald-50/40",
          fbType === "disliked" && "bg-rose-50/40 opacity-60",
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Score */}
        <td className="px-3 py-2.5 text-center">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">
            {Math.round(rec.score)}
          </span>
        </td>
        {/* Project */}
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-900 truncate max-w-[200px]">{rec.project_name ?? "—"}</span>
            <NoiseBadge label={rec.noise_label} />
            {rec.distance_to_railway_m != null && rec.distance_to_railway_m < 200 && <NearBadge label="Vlak" />}
            {rec.distance_to_tram_tracks_m != null && rec.distance_to_tram_tracks_m < 50 && <NearBadge label="Tram" />}
            {rec.distance_to_primary_road_m != null && rec.distance_to_primary_road_m < 50 && <NearBadge label="Silnice" />}
          </div>
          {(rec.district || rec.construction_completion) && (
            <p className="text-[11px] text-slate-400">
              {rec.district}{rec.district && rec.construction_completion ? " · " : ""}{rec.construction_completion ? `Dokončení: ${rec.construction_completion}` : ""}
            </p>
          )}
          <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", roleCfg.cls)}>{roleCfg.label}</span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <MhdBadges rec={rec} />
            <PoiBadges rec={rec} activePrefs={activePoiPrefs} />
          </div>
        </td>
        {/* Layout */}
        <td className="px-3 py-2.5 text-slate-700">{rec.layout_label ?? "—"}</td>
        {/* Area */}
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rec.floor_area_m2 != null ? `${Math.round(rec.floor_area_m2)} m²` : "—"}</td>
        {/* Ext */}
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{rec.exterior_area_m2 != null ? `${Math.round(rec.exterior_area_m2)} m²` : "—"}</td>
        {/* Floor */}
        <td className="px-3 py-2.5 text-center tabular-nums text-slate-700">{rec.floor ?? "—"}</td>
        {/* Price */}
        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">{rec.price_czk != null ? formatCurrencyCzk(rec.price_czk) : "—"}</td>
        {/* Kč/m² */}
        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 text-xs">{rec.price_per_m2_czk != null ? `${Math.round(rec.price_per_m2_czk / 1000)}k Kč` : "—"}</td>
        {/* Market deviation */}
        <td className="px-3 py-2.5 text-center text-xs">
          {priceDiffPct != null ? (
            <span className={clsx("rounded px-1 py-0.5 font-medium", priceDiffPct < -5 ? "bg-emerald-100 text-emerald-800" : priceDiffPct > 5 ? "bg-rose-100 text-rose-800" : "text-slate-500")}>
              {priceDiffPct > 0 ? "+" : ""}{Math.round(priceDiffPct)} %
            </span>
          ) : "—"}
        </td>
        {/* Commute columns */}
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
        {/* Commute sum */}
        {commuteLabels.length > 0 && (
          <td className="px-2 py-2.5 text-center tabular-nums text-xs font-medium text-slate-600">
            {commuteSum != null ? `${Math.round(commuteSum)} min` : "—"}
          </td>
        )}
        {/* Status */}
        <td className="px-3 py-2.5">
          {rec.pinned_by_broker && <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">★ Ve výběru</span>}
        </td>
        {/* Broker note indicator */}
        <td className="px-2 py-2.5 text-center text-xs">
          {rec.broker_note ? <span className="text-slate-500" title={rec.broker_note}>📝</span> : <span className="text-slate-300">—</span>}
        </td>
      </tr>

      {/* Expanded edit row */}
      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50/50">
          <td colSpan={100} className="px-5 py-5">
            <div className="grid gap-5 md:grid-cols-5">
              {/* Col 1: Role */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Role</label>
                <div className="mt-1.5 flex flex-col gap-1">
                  {ROLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={clsx(
                        "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors text-left",
                        role === opt.value ? opt.cls : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                      )}
                      onClick={(e) => { e.stopPropagation(); setRole(opt.value); saveShortlist({ shortlist_role: opt.value }); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Col 2: Plusy brokera — line by line */}
              <div onClick={(e) => e.stopPropagation()}>
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Plusy (pro klienta)</label>
                <ul className="mt-1.5 space-y-1">
                  {reasonLines.map((line, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <span className="text-emerald-500">+</span>
                      <span className="flex-1">{line}</span>
                      <button type="button" className="text-slate-300 hover:text-rose-500 text-xs" onClick={() => {
                        const next = reasonLines.filter((_, j) => j !== i);
                        setReasonLines(next);
                        saveShortlist({ shortlist_reason: next.join("\n") });
                      }}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 flex gap-1">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-emerald-300 focus:outline-none"
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newReason.trim()) {
                        const next = [...reasonLines, newReason.trim()];
                        setReasonLines(next);
                        setNewReason("");
                        saveShortlist({ shortlist_reason: next.join("\n") });
                      }
                    }}
                    placeholder="Přidat plus…"
                  />
                  <button type="button" className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200" onClick={() => {
                    if (!newReason.trim()) return;
                    const next = [...reasonLines, newReason.trim()];
                    setReasonLines(next);
                    setNewReason("");
                    saveShortlist({ shortlist_reason: next.join("\n") });
                  }}>+</button>
                </div>
              </div>

              {/* Col 3: Rizika — line by line */}
              <div onClick={(e) => e.stopPropagation()}>
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Rizika (pro klienta)</label>
                <ul className="mt-1.5 space-y-1">
                  {risksLines.map((line, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <span className="text-amber-500">!</span>
                      <span className="flex-1">{line}</span>
                      <button type="button" className="text-slate-300 hover:text-rose-500 text-xs" onClick={() => {
                        const next = risksLines.filter((_, j) => j !== i);
                        setRisksLines(next);
                        saveShortlist({ shortlist_risks: next.join("\n") });
                      }}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 flex gap-1">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-amber-300 focus:outline-none"
                    value={newRisk}
                    onChange={(e) => setNewRisk(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newRisk.trim()) {
                        const next = [...risksLines, newRisk.trim()];
                        setRisksLines(next);
                        setNewRisk("");
                        saveShortlist({ shortlist_risks: next.join("\n") });
                      }
                    }}
                    placeholder="Přidat riziko…"
                  />
                  <button type="button" className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200" onClick={() => {
                    if (!newRisk.trim()) return;
                    const next = [...risksLines, newRisk.trim()];
                    setRisksLines(next);
                    setNewRisk("");
                    saveShortlist({ shortlist_risks: next.join("\n") });
                  }}>+</button>
                </div>
              </div>

              {/* Col 4: Interní poznámka */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Interní poznámka</label>
                <textarea
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-300 focus:outline-none"
                  rows={5}
                  value={note}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => { if (note !== (rec.broker_note ?? "")) saveNote(); }}
                  placeholder="Interní poznámka (klient neuvidí)…"
                />
              </div>

              {/* Col 4: Detail link + unit ID */}
              <div className="space-y-2">
                {rec.unit_external_id && (
                  <Link
                    href={`/units/${rec.unit_external_id}`}
                    className="inline-block text-xs text-sky-600 hover:text-sky-800 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Detail jednotky →
                  </Link>
                )}
                {saving && <p className="text-[11px] text-slate-400">Ukládám…</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Main page ─── */
export default function PresentationPage() {
  const params = useParams();
  const clientId = Number(params?.id);
  const [token, setToken] = useState<string | null>(null);
  const [recs, setRecs] = useState<RecommendationItem[]>([]);
  const [activePoiPrefs, setActivePoiPrefs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    setToken(typeof window !== "undefined" ? localStorage.getItem("broker_token") : null);
  }, []);

  useEffect(() => {
    if (!token || !clientId) return;
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/clients/${clientId}/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/clients/${clientId}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([recsData, profile]) => {
      setRecs(recsData as RecommendationItem[]);
      const wprefs = profile?.walkability_preferences_json ?? {};
      setActivePoiPrefs(
        Object.entries(wprefs)
          .filter(([, v]) => v === "normal" || v === "high" || v === "required")
          .map(([k]) => k)
      );
    }).finally(() => setLoading(false));
  }, [token, clientId]);

  const pinned = useMemo(() => {
    const p = recs.filter((r) => r.pinned_by_broker);
    return [...p].sort((a, b) => {
      const ao = a.shortlist_order ?? 999999;
      const bo = b.shortlist_order ?? 999999;
      if (ao !== bo) return ao - bo;
      return b.score - a.score;
    });
  }, [recs]);

  const commuteLabels = useMemo(() => {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const r of pinned) {
      for (const d of (r.reason?.commute_details ?? []) as CommuteDetail[]) {
        if (d.label && !seen.has(d.label)) { seen.add(d.label); labels.push(d.label); }
      }
    }
    return labels;
  }, [pinned]);

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
        setInviteError(detail.toLowerCase().includes("no email") ? "no_email" : (detail || "Chyba"));
        return;
      }
      const data = await res.json();
      setInviteLink(data.magic_link_url);
    } finally { setInviteLoading(false); }
  };

  const handleUpdate = (recId: number, patch: Partial<RecommendationItem>) => {
    setRecs((prev) => prev.map((r) => r.rec_id === recId ? { ...r, ...patch } : r));
  };

  if (loading) return <p className="text-sm text-slate-600 p-6">Načítání…</p>;

  return (
    <div className="space-y-4">
      {/* Portal invite button into layout header bar */}
      {typeof document !== "undefined" && document.getElementById("case-tabs-slot") && createPortal(
        <div className="flex items-center gap-2">
          <ReamarButton variant="subtle" size="sm" onClick={handlePortalInvite} disabled={inviteLoading}>
            {inviteLoading ? "Vytvářím…" : inviteLink ? "Obnovit pozvánku" : "Pozvat klienta do portálu"}
          </ReamarButton>
          {inviteError === "no_email" && <span className="text-[11px] text-amber-600">Chybí e-mail</span>}
          {inviteError && inviteError !== "no_email" && <span className="text-[11px] text-red-500">{inviteError}</span>}
        </div>,
        document.getElementById("case-tabs-slot")!
      )}

      {/* Portal link */}
      {inviteLink && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
          <span className="text-emerald-700 font-medium">Odkaz do portálu:</span>
          <code className="flex-1 truncate text-emerald-900">{inviteLink}</code>
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            onClick={() => navigator.clipboard.writeText(inviteLink)}
          >Kopírovat</button>
        </div>
      )}

      {/* Empty state */}
      {pinned.length === 0 ? (
        <ReamarCard className="p-8 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">Výběr je prázdný</h3>
            <p className="text-sm text-slate-600">Přidejte jednotky do výběru (★) v záložce Doporučení.</p>
            <Link href={`/cases/${clientId}/recommendations`}>
              <ReamarButton variant="primary">Přejít na doporučení</ReamarButton>
            </Link>
          </div>
        </ReamarCard>
      ) : (
        <ReamarCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-center w-[70px]">Shoda</th>
                  <th className="px-3 py-2 text-left">Projekt</th>
                  <th className="px-3 py-2 text-left">Typ</th>
                  <th className="px-3 py-2 text-right">Plocha</th>
                  <th className="px-3 py-2 text-right">Ext.</th>
                  <th className="px-3 py-2 text-center">Patro</th>
                  <th className="px-3 py-2 text-right">Cena</th>
                  <th className="px-3 py-2 text-right">Kč/m²</th>
                  <th className="px-3 py-2 text-center">Trh</th>
                  {commuteLabels.map((label) => (
                    <th key={label} className="px-2 py-2 text-center">{label.split(/\s+/)[0]}</th>
                  ))}
                  {commuteLabels.length > 0 && <th className="px-2 py-2 text-center">Celkem</th>}
                  <th className="px-3 py-2 text-left">Stav</th>
                  <th className="px-2 py-2 text-center">Pozn.</th>
                </tr>
              </thead>
              <tbody>
                {pinned.map((rec) => (
                  <PinnedRow
                    key={rec.rec_id}
                    rec={rec}
                    token={token!}
                    clientId={clientId}
                    commuteLabels={commuteLabels}
                    activePoiPrefs={activePoiPrefs}
                    onUpdate={handleUpdate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </ReamarCard>
      )}
    </div>
  );
}

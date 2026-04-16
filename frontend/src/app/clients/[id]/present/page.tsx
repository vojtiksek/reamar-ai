"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { formatCurrencyCzk, formatAreaM2, formatLayout, formatMinutes } from "@/lib/format";
import { API_BASE, deleteRecommendationFeedback, putRecommendationFeedback } from "@/lib/api";
import { DISLIKE_REASON_LABELS } from "@/lib/caseTypes";

const PresentMap = dynamic(
  () => import("@/app/units/[external_id]/UnitDetailMap"),
  { ssr: false }
);

type RecommendationFeedbackType = "liked" | "saved" | "disliked";
type RecommendationDislikeReason = "price" | "location" | "layout" | "small_area" | "standard_or_project" | "noise_or_surroundings" | "accessibility" | "other";

type RecommendationFeedback = {
  feedback_type: RecommendationFeedbackType;
  dislike_reason?: RecommendationDislikeReason | null;
  note?: string | null;
  updated_at: string;
};

type PinnedRec = {
  rec_id: number;
  pinned_by_broker: boolean;
  unit_external_id: string | null;
  project_name?: string | null;
  layout_label?: string | null;
  floor_area_m2?: number | null;
  price_czk?: number | null;
  score: number;
  shortlist_order?: number | null;
  shortlist_reason?: string | null;
  feedback?: RecommendationFeedback | null;
};

type UnitDetail = {
  external_id: string;
  project_id: number;
  project: {
    name: string;
    gps_latitude?: number | null;
    gps_longitude?: number | null;
    developer?: string | null;
    [k: string]: unknown;
  };
  layout: string | null;
  floor_area_m2: number | null;
  exterior_area_m2?: number | null;
  price_czk: number | null;
  price_per_m2_czk: number | null;
  original_price_czk?: number | null;
  floor?: number | null;
  availability_status?: string | null;
  air_conditioning?: boolean | null;
  exterior_blinds?: string | null;
  heating?: string | null;
  url?: string | null;
  developer?: string | null;
  data?: Record<string, unknown>;
  [k: string]: unknown;
};

function availInfo(status: string | null | undefined): { label: string; cls: string } {
  const s = String(status ?? "").toLowerCase();
  if (s === "available") return { label: "Volná", cls: "bg-emerald-100 text-emerald-800" };
  if (s === "reserved") return { label: "Rezervovaná", cls: "bg-amber-100 text-amber-800" };
  if (s === "sold") return { label: "Prodaná", cls: "bg-red-100 text-red-700" };
  return { label: "—", cls: "bg-slate-100 text-slate-600" };
}

function scoreBadge(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: "Výborná shoda", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= 60) return { label: "Dobrá shoda", cls: "bg-blue-100 text-blue-800" };
  return { label: "Dobrá shoda", cls: "bg-slate-100 text-slate-600" };
}

/** Read a field from unit.data first, then top-level. */
function field<T>(unit: UnitDetail, key: string): T | null | undefined {
  if (unit.data && key in unit.data) return unit.data[key] as T;
  return (unit as Record<string, unknown>)[key] as T;
}

export default function PresentPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = Number(params?.id);

  const [token, setToken] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState<string | null | undefined>(undefined);
  const [budgetMax, setBudgetMax] = useState<number | null>(null);
  const [pinnedRecs, setPinnedRecs] = useState<PinnedRec[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [unitLoading, setUnitLoading] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState("");

  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("broker_token") : null;
    if (!t) { router.push("/login"); return; }
    setToken(t);
  }, [router]);

  // Fetch client name + pinned recs in parallel
  useEffect(() => {
    if (!token || !clientId) return;
    const headers: HeadersInit = { Authorization: `Bearer ${token}` };
    setRecsLoading(true);
    Promise.all([
      fetch(`${API_BASE}/clients/${clientId}`, { headers }).then((r) => r.ok ? r.json() : null),
      fetch(`${API_BASE}/clients/${clientId}/recommendations`, { headers }).then((r) => r.ok ? r.json() : []),
      fetch(`${API_BASE}/clients/${clientId}/profile`, { headers }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([client, recs, profile]) => {
        setClientName(client?.name ?? "Klient");
        setClientEmail(client?.email ?? null);
        setBudgetMax(profile?.budget_max ?? null);
        const pinned: PinnedRec[] = (Array.isArray(recs) ? recs : [])
          .filter((r: PinnedRec) => r.pinned_by_broker)
          .sort((a: PinnedRec, b: PinnedRec) =>
            (a.shortlist_order ?? 999999) - (b.shortlist_order ?? 999999) || b.score - a.score
          );
        setPinnedRecs(pinned);
        if (pinned.length > 0 && pinned[0].unit_external_id) {
          setSelectedId(pinned[0].unit_external_id);
        }
      })
      .catch(() => {})
      .finally(() => setRecsLoading(false));
  }, [token, clientId]);

  // Fetch unit detail when selection changes
  const fetchUnit = useCallback(
    (externalId: string) => {
      if (!token) return;
      setUnitLoading(true);
      setUnit(null);
      fetch(`${API_BASE}/units/${encodeURIComponent(externalId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data) setUnit(data); })
        .catch(() => {})
        .finally(() => setUnitLoading(false));
    },
    [token]
  );

  useEffect(() => {
    if (selectedId) fetchUnit(selectedId);
  }, [selectedId, fetchUnit]);

  const handlePortalInvite = useCallback(async () => {
    if (!token) return;
    setInviteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/portal-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Chyba" }));
        alert(err.detail ?? "Nepodařilo se vytvořit pozvánku");
        return;
      }
      const data = await res.json();
      setInviteLink(data.magic_link_url);
      navigator.clipboard.writeText(data.magic_link_url).catch(() => undefined);
    } finally {
      setInviteLoading(false);
    }
  }, [token, clientId]);

  // Derived unit fields
  const gpsLat = unit?.project?.gps_latitude as number | null | undefined;
  const gpsLng = unit?.project?.gps_longitude as number | null | undefined;
  const hasGps = gpsLat != null && gpsLng != null;
  const developer = unit ? (unit.developer ?? (unit.project as { developer?: string | null })?.developer ?? null) : null;
  const rideMin = unit ? field<number>(unit, "ride_to_center_min") : null;
  const ptMin = unit ? field<number>(unit, "public_transport_to_center_min") : null;
  const ac = unit ? field<boolean>(unit, "air_conditioning") : null;
  const blinds = unit ? field<string>(unit, "exterior_blinds") : null;
  const heating = unit ? field<string>(unit, "heating") : null;
  const unitUrl = unit
    ? ((unit.url as string | null) ?? (unit.data?.unit_url as string | null) ?? null)
    : null;
  let projectUrl: string | null = null;
  if (unitUrl) {
    try {
      const p = new URL(unitUrl);
      projectUrl = `${p.protocol}//${p.host}`;
    } catch {
      const i = unitUrl.indexOf(".cz/");
      if (i !== -1) projectUrl = unitUrl.slice(0, i + 3);
    }
  }

  const selectedRec = pinnedRecs.find((r) => r.unit_external_id === selectedId);

  const updateSelectedFeedback = async (feedbackType: RecommendationFeedbackType, dislikeReason?: RecommendationDislikeReason | null, note?: string | null) => {
    if (!token || !selectedRec) return;
    setFeedbackSaving(true);
    try {
      const feedback = await putRecommendationFeedback({
        token,
        clientId,
        recId: selectedRec.rec_id,
        feedbackType,
        dislikeReason: dislikeReason ?? null,
        note: note ?? null,
      });
      setPinnedRecs((prev) => prev.map((r) => (r.rec_id === selectedRec.rec_id ? { ...r, feedback } : r)));
      setDislikeOpen(false);
    } finally {
      setFeedbackSaving(false);
    }
  };

  const clearSelectedFeedback = async () => {
    if (!token || !selectedRec) return;
    setFeedbackSaving(true);
    try {
      await deleteRecommendationFeedback({ token, clientId, recId: selectedRec.rec_id });
      setPinnedRecs((prev) => prev.map((r) => (r.rec_id === selectedRec.rec_id ? { ...r, feedback: null } : r)));
      setDislikeOpen(false);
    } finally {
      setFeedbackSaving(false);
    }
  };

  const unitCount = pinnedRecs.length;
  const unitCountLabel =
    unitCount === 1 ? "1 jednotka" : unitCount < 5 ? `${unitCount} jednotky` : `${unitCount} jednotek`;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={`/clients/${clientId}`}
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← Zpět
          </Link>
          <span className="text-slate-300">|</span>
          <span className="text-base font-semibold text-slate-900">{clientName || "…"}</span>
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
            Prezentace
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{unitCountLabel} ve výběru</span>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handlePortalInvite}
              disabled={inviteLoading || pinnedRecs.length === 0 || clientEmail === null}
              title={clientEmail === null ? "Klient nemá vyplněný e-mail" : undefined}
              className="rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-50"
            >
              {inviteLoading ? "Vytvářím…" : inviteLink ? "✓ Pozvánka zkopírována" : "Pozvat do portálu"}
            </button>
            {clientEmail === null && (
              <p className="text-[11px] text-amber-600">
                Klient nemá e-mail —{" "}
                <a href={`/clients/${clientId}`} className="underline hover:text-amber-800">doplnit v detailu</a>
              </p>
            )}
            {inviteLink && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                <input
                  readOnly
                  value={inviteLink}
                  className="w-64 bg-transparent text-[11px] text-slate-700 outline-none"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => setInviteLink(null)}
                  className="text-[11px] text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Two-panel body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: shortlist ── */}
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Výběr</p>
          </div>
          {recsLoading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Načítám…</p>
          ) : pinnedRecs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">
              Výběr je prázdný.{" "}
              <Link href={`/clients/${clientId}`} className="underline hover:text-slate-700">
                Přidejte jednotky z doporučení.
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pinnedRecs.map((rec) => {
                const isSelected = rec.unit_external_id === selectedId;
                const fb = rec.feedback?.feedback_type;
                return (
                  <li key={rec.rec_id}>
                    <div className={`flex items-center border-l-[3px] transition-colors ${
                        isSelected
                          ? "border-violet-500 bg-violet-50"
                          : fb === "liked"
                          ? "border-emerald-400 hover:bg-emerald-50/50"
                          : fb === "saved"
                          ? "border-blue-400 hover:bg-blue-50/50"
                          : fb === "disliked"
                          ? "border-rose-300 hover:bg-rose-50/30"
                          : "border-transparent hover:bg-slate-50"
                      }`}>
                      <button
                        type="button"
                        onClick={() => rec.unit_external_id && setSelectedId(rec.unit_external_id)}
                        className="min-w-0 flex-1 px-3 py-3 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <p className={`truncate text-sm font-semibold ${isSelected ? "text-violet-900" : "text-slate-800"}`}>
                            {rec.project_name ?? "—"}
                          </p>
                          {fb === "liked" && <span className="text-emerald-500 text-[11px]" title="Líbí se">&#9829;</span>}
                          {fb === "saved" && <span className="text-blue-500 text-[11px]" title="Uloženo">&#9733;</span>}
                          {fb === "disliked" && <span className="text-rose-400 text-[11px]" title="Nechci">&#10005;</span>}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {rec.layout_label ?? "—"}
                          {rec.floor_area_m2 != null ? ` · ${rec.floor_area_m2.toFixed(0)} m²` : ""}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <p className="text-xs font-medium text-slate-700">
                            {formatCurrencyCzk(rec.price_czk ?? null)}
                          </p>
                          {budgetMax != null && (rec.price_czk ?? 0) > budgetMax && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              nad rozpočet
                            </span>
                          )}
                        </div>
                        {fb === "disliked" && rec.feedback?.dislike_reason && (
                          <p className="mt-1 truncate text-[10px] text-rose-500">
                            {DISLIKE_REASON_LABELS[rec.feedback.dislike_reason as keyof typeof DISLIKE_REASON_LABELS] ?? rec.feedback.note ?? "Jiný důvod"}
                          </p>
                        )}
                      </button>
                      <button
                        type="button"
                        title="Odebrat z výběru"
                        className="shrink-0 px-2 text-amber-400 hover:text-slate-400"
                        onClick={async () => {
                          if (!token) return;
                          await fetch(`${API_BASE}/clients/${clientId}/recommendations/${rec.rec_id}/pin`, {
                            method: "DELETE",
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          setPinnedRecs((prev) => prev.filter((r) => r.rec_id !== rec.rec_id));
                          if (selectedId === rec.unit_external_id && pinnedRecs.length > 1) {
                            const next = pinnedRecs.find((r) => r.rec_id !== rec.rec_id);
                            if (next?.unit_external_id) setSelectedId(next.unit_external_id);
                          }
                        }}
                      >
                        ★
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Right: detail panel ── */}
        <main className="flex-1 overflow-y-auto">
          {pinnedRecs.length === 0 && !recsLoading ? null : unitLoading ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              Načítám detail…
            </div>
          ) : !unit ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              Vyberte jednotku ze seznamu
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">

              {/* Project + identity */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {developer ?? unit.project?.name}
                </p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">
                  {unit.project?.name ?? "—"}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {unit.availability_status && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${availInfo(unit.availability_status).cls}`}>
                      {availInfo(unit.availability_status).label}
                    </span>
                  )}
                  {selectedRec && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreBadge(selectedRec.score).cls}`}>
                      {scoreBadge(selectedRec.score).label}
                    </span>
                  )}
                </div>
              </div>

              {/* Shortlist reason */}
              {selectedRec?.shortlist_reason && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">Proč doporučujeme</p>
                  <p className="mt-1 text-sm text-slate-700">{selectedRec.shortlist_reason}</p>
                </div>
              )}

              {/* Reserved / sold warning */}
              {(unit.availability_status === "reserved" || unit.availability_status === "sold") && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">
                    {unit.availability_status === "reserved"
                      ? "⚠ Tato jednotka je rezervovaná"
                      : "⚠ Tato jednotka je prodaná"}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Sdělte klientovi aktuální stav před prezentací.
                  </p>
                </div>
              )}

              {/* Key specs */}
              <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] font-medium text-slate-400">Dispozice</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatLayout(unit.layout)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-slate-400">Plocha</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatAreaM2(unit.floor_area_m2)}</p>
                </div>
                {(unit.exterior_area_m2 ?? 0) > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Venkovní</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatAreaM2(unit.exterior_area_m2)}</p>
                  </div>
                )}
                {unit.floor != null && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">Podlaží</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{unit.floor}. patro</p>
                  </div>
                )}
              </div>

              {/* Feedback actions */}
              {selectedRec && (
                <div className="space-y-3">
                  {/* Current feedback state banner */}
                  {selectedRec.feedback && (
                    <div className={`rounded-xl px-4 py-3 ${
                      selectedRec.feedback.feedback_type === "liked" ? "bg-emerald-50 border border-emerald-200" :
                      selectedRec.feedback.feedback_type === "saved" ? "bg-blue-50 border border-blue-200" :
                      "bg-rose-50 border border-rose-200"
                    }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-sm font-semibold ${
                            selectedRec.feedback.feedback_type === "liked" ? "text-emerald-800" :
                            selectedRec.feedback.feedback_type === "saved" ? "text-blue-800" :
                            "text-rose-800"
                          }`}>
                            {selectedRec.feedback.feedback_type === "liked" ? "Klientovi se líbí" :
                             selectedRec.feedback.feedback_type === "saved" ? "Uloženo na později" :
                             "Klient nechce"}
                          </p>
                          {selectedRec.feedback.feedback_type === "disliked" && selectedRec.feedback.dislike_reason && (
                            <p className="mt-0.5 text-xs text-rose-600">
                              Důvod: {DISLIKE_REASON_LABELS[selectedRec.feedback.dislike_reason as keyof typeof DISLIKE_REASON_LABELS] ?? selectedRec.feedback.note ?? "Jiný důvod"}
                            </p>
                          )}
                          {selectedRec.feedback.note && selectedRec.feedback.dislike_reason !== "other" && (
                            <p className="mt-0.5 text-xs text-slate-600 italic">„{selectedRec.feedback.note}"</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={clearSelectedFeedback}
                          disabled={feedbackSaving}
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-white/60"
                        >
                          Změnit
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mr-1">Reakce klienta</p>
                    <button
                      type="button"
                      onClick={() => updateSelectedFeedback("liked")}
                      disabled={feedbackSaving}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${selectedRec.feedback?.feedback_type === "liked" ? "bg-emerald-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"}`}
                    >
                      Líbí se mi
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSelectedFeedback("saved")}
                      disabled={feedbackSaving}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${selectedRec.feedback?.feedback_type === "saved" ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"}`}
                    >
                      Uložit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDislikeOpen((v) => !v)}
                      disabled={feedbackSaving}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${selectedRec.feedback?.feedback_type === "disliked" ? "bg-rose-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50"}`}
                    >
                      Nechci
                    </button>
                  </div>

                  {/* Dislike reasons */}
                  {dislikeOpen && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">Co klientovi nesedí?</p>
                        <p className="text-xs text-slate-500">Pomůže to zpřesnit další doporučení.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          ["price", "Cena"],
                          ["location", "Lokalita"],
                          ["layout", "Dispozice"],
                          ["small_area", "Malá plocha"],
                          ["standard_or_project", "Standard / projekt"],
                          ["noise_or_surroundings", "Hluk / okolí"],
                          ["accessibility", "Dostupnost"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateSelectedFeedback("disliked", value as RecommendationDislikeReason, null)}
                            disabled={feedbackSaving}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              selectedRec.feedback?.dislike_reason === value
                                ? "border-rose-400 bg-rose-100 text-rose-800"
                                : "border-rose-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={feedbackNote}
                          onChange={(e) => setFeedbackNote(e.target.value)}
                          placeholder="Jiné – upřesnění"
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            updateSelectedFeedback("disliked", "other", feedbackNote || null);
                            setDislikeOpen(false);
                          }}
                          disabled={feedbackSaving}
                          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                          Uložit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Price */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[11px] font-medium text-slate-400">Cena</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">{formatCurrencyCzk(unit.price_czk)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  {unit.price_per_m2_czk != null && (
                    <span className="text-sm text-slate-500">{formatCurrencyCzk(unit.price_per_m2_czk)} / m²</span>
                  )}
                  {unit.original_price_czk != null && unit.original_price_czk > (unit.price_czk ?? 0) && (
                    <span className="text-sm text-slate-400 line-through">{formatCurrencyCzk(unit.original_price_czk)}</span>
                  )}
                  {budgetMax != null && unit.price_czk != null && unit.price_czk > budgetMax && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      ↑ nad max. rozpočtem ({formatCurrencyCzk(budgetMax)})
                    </span>
                  )}
                </div>
              </div>

              {/* Map */}
              {hasGps && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Poloha</p>
                  <PresentMap
                    lat={gpsLat!}
                    lng={gpsLng!}
                    label={unit.project?.name ?? undefined}
                  />
                </div>
              )}

              {/* Transport */}
              {(rideMin != null || ptMin != null) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dostupnost</p>
                  <div className="flex flex-wrap gap-6">
                    {rideMin != null && (
                      <div>
                        <p className="text-[11px] text-slate-400">Autem do centra</p>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatMinutes(rideMin as number)}</p>
                      </div>
                    )}
                    {ptMin != null && (
                      <div>
                        <p className="text-[11px] text-slate-400">MHD do centra</p>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">{formatMinutes(ptMin as number)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Standards */}
              {(ac != null || blinds != null || heating != null) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Vybavení</p>
                  <div className="flex flex-wrap gap-3">
                    {ac != null && (
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${ac ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400 line-through"}`}>
                        Klimatizace
                      </span>
                    )}
                    {blinds != null && blinds !== "false" && blinds !== "0" && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                        Žaluzie
                      </span>
                    )}
                    {heating && heating !== "—" && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {heating}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Links */}
              {(unitUrl || projectUrl) && (
                <div className="flex flex-wrap gap-3 pb-2">
                  {unitUrl && (
                    <a
                      href={unitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      ↗ Otevřít nabídku
                    </a>
                  )}
                  {projectUrl && projectUrl !== unitUrl && (
                    <a
                      href={projectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      ↗ Web projektu
                    </a>
                  )}
                </div>
              )}

            </div>
          )}
        </main>
      </div>
    </div>
  );
}

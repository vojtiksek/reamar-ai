"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { useCaseData } from "@/hooks/useCaseData";
import { API_BASE, getClientFlatWeights, setClientBrokerWeightOverrides, deleteClientBrokerWeightOverrides } from "@/lib/api";
import { formatCurrencyCzk } from "@/lib/format";
import { profileToFilters } from "@/lib/clientFilters";
import { filtersToSearchParams } from "@/lib/filters";
import { scoreLabel } from "@/components/case/ScoreUtils";
import {
  ReamarButton,
  ReamarCard,
} from "@/components/ui/reamar-ui";
import { DISLIKE_REASON_LABELS } from "@/lib/caseTypes";
import type { RecommendationDislikeReason, FlatWeightsResponse } from "@/lib/caseTypes";


export default function OverviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const {
    client,
    profile,
    loading,
    error,
    hydrated,
    token,
    notes,
    wizardExtras,
    marketFit,
    recs,
    activate,
  } = useCaseData();

  const [flatWeightsData, setFlatWeightsData] = useState<FlatWeightsResponse | null>(null);
  const [editedOverrides, setEditedOverrides] = useState<Record<string, number>>({});
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [weightsSaving, setWeightsSaving] = useState(false);
  const [weightsEditing, setWeightsEditing] = useState(false);

  const hasBrief = Boolean(
    profile && (profile.budget_min != null || profile.budget_max != null || profile.layouts?.values?.length)
  );

  const shortlist = recs.filter((r) => r.pinned_by_broker);
  const reviewCount = recs.filter((r) => r.eligibility === "review").length;
  const topCandidates = recs.slice(0, 3);
  const liked = recs.filter((r) => r.feedback?.feedback_type === "liked");
  const saved = recs.filter((r) => r.feedback?.feedback_type === "saved");
  const disliked = recs.filter((r) => r.feedback?.feedback_type === "disliked");

  const loadFlatWeights = async () => {
    if (!token || !client?.id) return;
    try {
      const data = await getClientFlatWeights(client.id, token);
      setFlatWeightsData(data);
      setEditedOverrides(data.broker_overrides || {});
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!token || !client?.id) return;
    loadFlatWeights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, client?.id]);

  const saveBrokerOverrides = async () => {
    if (!token || !client?.id) return;
    setWeightsSaving(true);
    try {
      await setClientBrokerWeightOverrides(client.id, token, editedOverrides);
      await loadFlatWeights();
      setWeightsEditing(false);
    } finally {
      setWeightsSaving(false);
    }
  };

  const resetBrokerOverrides = async () => {
    if (!token || !client?.id) return;
    setWeightsSaving(true);
    try {
      await deleteClientBrokerWeightOverrides(client.id, token);
      await loadFlatWeights();
      setEditedOverrides({});
      setWeightsEditing(false);
    } finally {
      setWeightsSaving(false);
    }
  };

  if (!hydrated) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Načítání…</div></div>;
  if (!token) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Nejste přihlášen. Přejděte na <Link href="/login" className="text-slate-900 underline">/login</Link>.</div></div>;
  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-600">Klient nenalezen.</p>;

  const strongest = topCandidates.filter((r) => r.eligibility !== "review").length;

  const mustHaves: string[] = [];
  const standards = wizardExtras.standards ?? {};
  if (standards.recuperation === "must") mustHaves.push("Rekuperace");
  if (standards.air_conditioning === "must") mustHaves.push("Klimatizace");
  if (standards.floor_heating === "must") mustHaves.push("Podlahové topení");
  if (standards.exterior_blinds === "must") mustHaves.push("Žaluzie");
  if (wizardExtras.outdoor?.outdoor_space === "must") mustHaves.push("Venkovní plocha");

  const openExplorer = () => {
    if (!profile) return;
    const filters = profileToFilters(profile);
    const p = filtersToSearchParams(filters);
    activate({ clientId: client.id, clientName: client.name, derivedFilters: filters });
    router.push(`/explorer/units?${p.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Brief summary strip */}
      <div className="grid gap-3 lg:grid-cols-4">
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Rozpočet</p><p className="mt-1 text-sm font-medium text-slate-900">{profile?.budget_min != null || profile?.budget_max != null ? `${profile?.budget_min != null ? formatCurrencyCzk(profile.budget_min) : "—"} – ${profile?.budget_max != null ? formatCurrencyCzk(profile.budget_max) : "—"}` : "—"}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Dispozice</p><p className="mt-1 text-sm font-medium text-slate-900">{profile?.layouts?.values?.length ? profile.layouts.values.join(", ") : "—"}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Lokalita</p><p className="mt-1 text-sm font-medium text-slate-900">{profile?.polygon_geojson ? "Vybraná oblast na mapě" : "Bez vymezené oblasti"}</p></ReamarCard>
        <ReamarCard className="p-4"><p className="text-[11px] uppercase tracking-wide text-slate-500">Must-have</p><p className="mt-1 text-sm font-medium text-slate-900">{mustHaves.length ? mustHaves.join(", ") : "Žádné explicitní"}</p></ReamarCard>
      </div>

      {/* Funnel + alerts */}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <ReamarCard className="p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-4">Přehled trhu</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Na trhu</p><p className="mt-1 text-2xl font-semibold text-slate-900">{marketFit?.available_units_count ?? "—"}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Odpovídá zadání</p><p className="mt-1 text-2xl font-semibold text-slate-900">{marketFit?.matching_units_count ?? recs.length}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">K prověření</p><p className="mt-1 text-2xl font-semibold text-amber-700">{reviewCount}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Nejlepší shoda</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{strongest}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Výběr</p><p className="mt-1 text-2xl font-semibold text-slate-900">{shortlist.length}</p></div>
          </div>
        </ReamarCard>

        <ReamarCard className="p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-4">Na co si dát pozor</h3>
          <div className="space-y-2 text-sm text-slate-700">
            {!hasBrief && <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Zadání není dokončené.</div>}
            {recs.length === 0 && hasBrief && <div className="rounded-xl bg-slate-50 px-3 py-2">Ještě nejsou vygenerovaná doporučení.</div>}
            {reviewCount > 0 && <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">{reviewCount} kandidátů je potřeba prověřit.</div>}
            {shortlist.length === 0 && recs.length > 0 && <div className="rounded-xl bg-slate-50 px-3 py-2">Výběr je zatím prázdný.</div>}
            {(marketFit?.available_units_count ?? 0) > 0 && (marketFit?.matching_units_count ?? 0) < 5 && <div className="rounded-xl bg-rose-50 px-3 py-2 text-rose-700">Trh je vůči briefu poměrně úzký.</div>}
          </div>
        </ReamarCard>
      </div>

      {/* Top candidates preview */}
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ReamarCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Nejlepší kandidáti</h3>
              <p className="mt-1 text-sm text-slate-500">Nejrelevantnější doporučení pro tento případ</p>
            </div>
            <ReamarButton variant="subtle" size="sm" onClick={() => router.push(`/cases/${id}/recommendations`)}>Zobrazit vše</ReamarButton>
          </div>
          <div className="space-y-3">
            {topCandidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">Zatím žádní kandidáti.</div>
            ) : topCandidates.map((rec) => {
              const sl = scoreLabel(rec.score);
              return (
                <div key={rec.rec_id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{rec.project_name || rec.unit_external_id || "—"}</h4>
                      <p className="mt-1 text-xs text-slate-500">{rec.layout_label || rec.layout || "—"}{rec.floor_area_m2 != null ? ` · ${Math.round(rec.floor_area_m2)} m²` : ""}{rec.price_czk != null ? ` · ${formatCurrencyCzk(rec.price_czk)}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <div className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${sl.cls}`}>{Math.round(rec.score)} · {sl.label}</div>
                    </div>
                  </div>
                  {rec.top_strengths?.length ? <p className="mt-2 text-xs text-emerald-700">Sedí: {rec.top_strengths.slice(0, 2).join(", ")}</p> : null}
                  {rec.top_compromises?.length ? <p className="mt-1 text-xs text-amber-700">Pozor: {rec.top_compromises.slice(0, 1).join(", ")}</p> : null}
                  <div className="mt-3">
                    <ReamarButton variant="subtle" size="sm" onClick={() => router.push(`/cases/${id}/recommendations`)}>Zobrazit detail</ReamarButton>
                  </div>
                </div>
              );
            })}
          </div>
        </ReamarCard>

        <div className="space-y-6">
          <ReamarCard className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-1">Klientský feedback</h3>
                <p className="text-sm text-slate-600">Rychlý přehled toho, jak klient reaguje na doporučení.</p>
              </div>
              <ReamarButton variant="subtle" size="sm" onClick={() => router.push(`/cases/${id}/recommendations`)}>Všechna doporučení</ReamarButton>
            </div>
            <div className="mt-4 grid gap-3 grid-cols-3">
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] uppercase tracking-wide text-emerald-700">Líbí se</p><p className="mt-1 text-2xl font-semibold text-emerald-900">{liked.length}</p></div>
              <div className="rounded-xl bg-blue-50 p-3"><p className="text-[11px] uppercase tracking-wide text-blue-700">Uloženo</p><p className="mt-1 text-2xl font-semibold text-blue-900">{saved.length}</p></div>
              <div className="rounded-xl bg-rose-50 p-3"><p className="text-[11px] uppercase tracking-wide text-rose-700">Nechci</p><p className="mt-1 text-2xl font-semibold text-rose-900">{disliked.length}</p></div>
            </div>
            {/* Liked items */}
            {liked.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Líbí se</p>
                {liked.slice(0, 3).map((r) => (
                  <p key={r.rec_id} className="text-sm text-slate-700">{r.project_name || r.unit_external_id || "—"}</p>
                ))}
              </div>
            )}
            {/* Disliked items with reasons */}
            {disliked.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-rose-600">Nechce</p>
                {disliked.slice(0, 4).map((r) => (
                  <div key={r.rec_id} className="rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2 text-sm">
                    <p className="font-medium text-slate-900">{r.project_name || r.unit_external_id || "—"}</p>
                    <p className="mt-0.5 text-xs text-rose-700">
                      {r.feedback?.dislike_reason
                        ? DISLIKE_REASON_LABELS[r.feedback.dislike_reason as RecommendationDislikeReason] ?? r.feedback.dislike_reason
                        : "Bez důvodu"}
                      {r.feedback?.note ? ` — „${r.feedback.note}"` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {liked.length === 0 && saved.length === 0 && disliked.length === 0 && (
              <p className="mt-3 text-sm text-slate-500 italic">Zatím bez klientského feedbacku.</p>
            )}
          </ReamarCard>

          <ReamarCard className="p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-3">Aktivita & poznámky</h3>
            <div className="space-y-2">
              {notes.slice(0, 4).map((n) => (
                <div key={n.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-slate-900">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{n.note_type === "meeting" ? "Schůzka" : n.note_type === "call" ? "Hovor" : "Poznámka"} · {new Date(n.created_at).toLocaleDateString("cs-CZ")}</p>
                </div>
              ))}
              {notes.length === 0 && <p className="text-sm text-slate-500 italic">Zatím žádné poznámky.</p>}
            </div>
          </ReamarCard>

          <ReamarCard className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scoring váhy</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {flatWeightsData?.broker_overrides ? "Wizard + broker override" : "Odvozeno z wizardu"}
                </p>
              </div>
              <div className="flex gap-2">
                {!weightsOpen && (
                  <ReamarButton variant="subtle" size="sm" onClick={() => setWeightsOpen(true)}>
                    Zobrazit váhy
                  </ReamarButton>
                )}
                {weightsOpen && !weightsEditing && (
                  <>
                    <ReamarButton variant="subtle" size="sm" onClick={() => { setWeightsEditing(true); setEditedOverrides(flatWeightsData?.broker_overrides || {}); }}>
                      Upravit
                    </ReamarButton>
                    <ReamarButton variant="subtle" size="sm" onClick={() => setWeightsOpen(false)}>
                      Skrýt
                    </ReamarButton>
                  </>
                )}
                {weightsEditing && (
                  <>
                    <ReamarButton variant="subtle" size="sm" onClick={resetBrokerOverrides} disabled={weightsSaving}>
                      Smazat override
                    </ReamarButton>
                    <ReamarButton variant="subtle" size="sm" onClick={() => { setWeightsEditing(false); setEditedOverrides(flatWeightsData?.broker_overrides || {}); }}>
                      Zrušit
                    </ReamarButton>
                    <ReamarButton variant="primary" size="sm" onClick={saveBrokerOverrides} disabled={weightsSaving}>
                      {weightsSaving ? "Ukládám…" : "Uložit override"}
                    </ReamarButton>
                  </>
                )}
              </div>
            </div>

            {weightsOpen && flatWeightsData && (
              <div className="mt-4 space-y-1">
                {/* Category groups */}
                {[
                  { title: "Cena a financování", keys: ["price_distance", "price_per_m2_area", "payment_schedule"] },
                  { title: "Lokalita", keys: ["commute_time", "walkability", "noise"] },
                  { title: "Dispozice a prostor", keys: ["unit_area", "outdoor_area", "floor_preference"] },
                  { title: "Standardy", keys: ["heating", "heating_source", "recuperation", "exterior_blinds", "air_conditioning", "flooring", "ceiling_height", "windows"], skip: flatWeightsData.skip_categories?.standards },
                  { title: "Vybavení projektu", keys: ["reception", "fitness_project", "ev_charger", "courtyard_garden"], skip: flatWeightsData.skip_categories?.amenities },
                  { title: "Dokončení", keys: ["completion_fit"] },
                ].map((group) => (
                  <div key={group.title} className="mb-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{group.title}</span>
                      {group.skip && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">Přeskočeno</span>
                      )}
                    </div>
                    {group.keys.map((key) => {
                      const label = flatWeightsData.labels[key] || key;
                      const wizardW = flatWeightsData.wizard_weights[key] ?? 0;
                      const effectiveW = flatWeightsData.effective_weights[key] ?? 0;
                      const isZeroed = effectiveW === 0 && (flatWeightsData.defaults[key] ?? 0) > 0;
                      const hasBrokerOv = flatWeightsData.broker_overrides?.[key] != null;

                      return (
                        <div key={key} className={`flex items-center gap-2 py-1 ${isZeroed ? "opacity-40" : ""}`}>
                          <span className={`w-40 text-xs ${isZeroed ? "line-through text-slate-400" : "text-slate-700"}`}>
                            {label}
                          </span>
                          {weightsEditing ? (
                            <input
                              type="range"
                              min="0"
                              max="20"
                              step="0.5"
                              value={editedOverrides[key] ?? effectiveW}
                              onChange={(e) => setEditedOverrides((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                              className="flex-1"
                            />
                          ) : (
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${hasBrokerOv ? "bg-amber-400" : "bg-slate-400"}`}
                                style={{ width: `${Math.min(100, effectiveW * 5)}%` }}
                              />
                            </div>
                          )}
                          <span className="w-14 text-right text-xs tabular-nums text-slate-500">
                            {weightsEditing
                              ? `${(editedOverrides[key] ?? effectiveW).toFixed(1)}`
                              : `${effectiveW.toFixed(1)}`}
                          </span>
                          {!weightsEditing && hasBrokerOv && (
                            <span className="text-[9px] text-amber-600" title={`Wizard: ${wizardW.toFixed(1)}`}>OV</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-400">
                  Celkem: {Object.values(flatWeightsData.effective_weights).reduce((a, b) => a + b, 0).toFixed(1)} bodů
                  {flatWeightsData.broker_overrides && (
                    <span className="ml-2 text-amber-600">
                      (obsahuje broker override)
                    </span>
                  )}
                </div>
              </div>
            )}
          </ReamarCard>
        </div>
      </div>
    </div>
  );
}

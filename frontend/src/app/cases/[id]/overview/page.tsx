"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { useCaseData } from "@/hooks/useCaseData";
import { API_BASE } from "@/lib/api";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import { profileToFilters } from "@/lib/clientFilters";
import { filtersToSearchParams } from "@/lib/filters";
import { scoreLabel } from "@/components/case/ScoreUtils";
import {
  ReamarButton,
  ReamarCard,
} from "@/components/ui/reamar-ui";

function stageLabel(hasBrief: boolean, recsCount: number, shortlistCount: number): string {
  if (!hasBrief) return "Nový case";
  if (shortlistCount > 0) return "Shortlist v přípravě";
  if (recsCount > 0) return "Doporučení připravená";
  return "Brief hotový";
}

function nextActionLabel(hasBrief: boolean, recsCount: number, shortlistCount: number): string {
  if (!hasBrief) return "Doplnit brief";
  if (recsCount === 0) return "Přepočítat doporučení";
  if (shortlistCount === 0) return "Vybrat 2–3 kandidáty do shortlistu";
  return "Připravit prezentaci";
}

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

  const [weights, setWeights] = useState<Record<string, number>>({});
  const [weightsSaving, setWeightsSaving] = useState(false);

  const hasBrief = Boolean(
    profile && (profile.budget_min != null || profile.budget_max != null || profile.layouts?.values?.length)
  );

  const shortlist = recs.filter((r) => r.pinned_by_broker);
  const reviewCount = recs.filter((r) => r.eligibility === "review").length;
  const topCandidates = recs.slice(0, 3);

  useEffect(() => {
    if (!token || !client?.id) return;
    fetch(`${API_BASE}/clients/${client.id}/scoring-weights`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: any) => setWeights((data?.weights || data || {}) as Record<string, number>))
      .catch(() => {});
  }, [token, client?.id]);

  const weightEntries = useMemo(() => Object.entries(weights), [weights]);

  const saveClientWeights = async () => {
    if (!token || !client?.id) return;
    setWeightsSaving(true);
    try {
      await fetch(`${API_BASE}/clients/${client.id}/scoring-weights`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(weights),
      });
    } finally {
      setWeightsSaving(false);
    }
  };

  const resetClientWeights = async () => {
    if (!token || !client?.id) return;
    setWeightsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/clients/${client.id}/scoring-weights`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: any = res.ok ? await res.json() : {};
      setWeights((data?.weights || data || {}) as Record<string, number>);
    } finally {
      setWeightsSaving(false);
    }
  };

  if (!hydrated) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Načítání…</div></div>;
  if (!token) return <div className="flex items-center justify-center py-20"><div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Nejste přihlášen. Přejděte na <Link href="/login" className="text-slate-900 underline">/login</Link>.</div></div>;
  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-600">Klient nenalezen.</p>;

  const stage = stageLabel(hasBrief, recs.length, shortlist.length);
  const nextAction = nextActionLabel(hasBrief, recs.length, shortlist.length);
  const strongest = topCandidates.filter((r) => r.eligibility !== "review").length;

  const mustHaves: string[] = [];
  const standards = wizardExtras.standards ?? {};
  if (standards.rekuperace === "must") mustHaves.push("Rekuperace");
  if (standards.air_conditioning === "must") mustHaves.push("Klimatizace");
  if (standards.floor_heating === "must") mustHaves.push("Podlahové topení");
  if (standards.external_blinds === "must") mustHaves.push("Žaluzie");
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
      {/* Compact action strip */}
      <ReamarCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <nav className="text-sm text-slate-500">
              <Link href="/cases" className="hover:underline">Cases</Link>{" / "}
              <span className="font-semibold text-slate-900">{client.name}</span>
            </nav>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white">{stage}</span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">{nextAction}</span>
              <span className="text-xs text-slate-500">Poslední aktivita: {notes[0] ? new Date(notes[0].created_at).toLocaleDateString("cs-CZ") : new Date(client.created_at).toLocaleDateString("cs-CZ")}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ReamarButton variant={hasBrief ? "subtle" : "primary"} size="sm" onClick={() => router.push(`/cases/${id}/brief`)}>
              {hasBrief ? "Upravit brief" : "Doplnit brief"}
            </ReamarButton>
            {hasBrief && (
              <ReamarButton variant="primary" size="sm" onClick={recs.length ? () => router.push(`/cases/${id}/recommendations`) : openExplorer}>
                {recs.length ? "Otevřít doporučení" : "Hledat jednotky"}
              </ReamarButton>
            )}
          </div>
        </div>
      </ReamarCard>

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
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-4">Market funnel</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Na trhu</p><p className="mt-1 text-2xl font-semibold text-slate-900">{marketFit?.available_units_count ?? "—"}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Eligible</p><p className="mt-1 text-2xl font-semibold text-slate-900">{marketFit?.matching_units_count ?? recs.length}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Review</p><p className="mt-1 text-2xl font-semibold text-amber-700">{reviewCount}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Strong picks</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{strongest}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Shortlist</p><p className="mt-1 text-2xl font-semibold text-slate-900">{shortlist.length}</p></div>
          </div>
        </ReamarCard>

        <ReamarCard className="p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 mb-4">Na co si dát pozor</h3>
          <div className="space-y-2 text-sm text-slate-700">
            {!hasBrief && <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Brief není dokončený.</div>}
            {recs.length === 0 && hasBrief && <div className="rounded-xl bg-slate-50 px-3 py-2">Ještě nejsou vygenerovaná doporučení.</div>}
            {reviewCount > 0 && <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">{reviewCount} kandidátů je potřeba prověřit.</div>}
            {shortlist.length === 0 && recs.length > 0 && <div className="rounded-xl bg-slate-50 px-3 py-2">Shortlist je zatím prázdný.</div>}
            {(marketFit?.available_units_count ?? 0) > 0 && (marketFit?.matching_units_count ?? 0) < 5 && <div className="rounded-xl bg-rose-50 px-3 py-2 text-rose-700">Trh je vůči briefu poměrně úzký.</div>}
          </div>
        </ReamarCard>
      </div>

      {/* Top candidates preview */}
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ReamarCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Top kandidáti</h3>
              <p className="mt-1 text-sm text-slate-500">Rychlý preview nejlepších doporučení</p>
            </div>
            <ReamarButton variant="subtle" size="sm" onClick={() => router.push(`/cases/${id}/recommendations`)}>Všechna doporučení</ReamarButton>
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
                  <div className="mt-3 flex gap-2">
                    <ReamarButton variant="subtle" size="sm" onClick={() => router.push(`/cases/${id}/recommendations`)}>Otevřít</ReamarButton>
                    <ReamarButton variant="primary" size="sm" onClick={() => router.push(`/cases/${id}/shortlist`)}>Shortlist</ReamarButton>
                  </div>
                </div>
              );
            })}
          </div>
        </ReamarCard>

        <div className="space-y-6">
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
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Client scoring override</h3>
                <p className="mt-1 text-sm text-slate-600">Lokální váhy pro tento case.</p>
              </div>
              <div className="flex gap-2">
                <ReamarButton variant="subtle" size="sm" onClick={resetClientWeights} disabled={weightsSaving}>Reset</ReamarButton>
                <ReamarButton variant="primary" size="sm" onClick={saveClientWeights} disabled={weightsSaving}>{weightsSaving ? "Ukládám…" : "Uložit"}</ReamarButton>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {weightEntries.map(([key, value]) => (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{key}</span>
                    <span className="text-slate-500">{Math.round(value * 100)} %</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.01" value={value} onChange={(e) => setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))} className="w-full" />
                </div>
              ))}
            </div>
          </ReamarCard>
        </div>
      </div>
    </div>
  );
}

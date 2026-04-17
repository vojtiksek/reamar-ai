"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import type { Priority } from "@/lib/caseTypes";
import { FunnelCard } from "@/components/case/FunnelCard";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import { QuickEdit } from "./QuickEdit";
import {
  ReamarButton,
  ReamarCard,
  ReamarSubtleCard,
  StatCard,
} from "@/components/ui/reamar-ui";
import { getDefaultPreferences } from "@/lib/walkabilityPreferences";
import { useUiVersion } from "@/components/v2/useUiVersion";
import { BriefV2Chrome } from "./BriefV2Chrome";

/* ─── Main page ─── */

export default function BriefPage() {
  const {
    client,
    profile, setProfile,
    selectedLayouts, setSelectedLayouts,
    recs,
    recsFunnel,
    loading,
    error,
    hydrated,
    token,
    profileSaving,
    recomputing,
    recomputeProgress,
    profileSavedMessage,
    profileDirty,
    handleExplicitSave,
    walkPrefsOpen, setWalkPrefsOpen,
    walkPrefs, setWalkPrefs,
    wizardExtras, setWizardExtras,
    locationPolygons, setLocationPolygons,
    activeAreaIndex, setActiveAreaIndex,
    locationProjects,
    projectsInsidePolygon,
    areaMarket,
    marketFit,
    LAYOUT_OPTIONS,
    clientId,
    router,
    activeClient,
    handleSaveProfile,
    handleRecompute,
    handleActivate,
    handleNextStep,
    saveWalkPrefs,
  } = useCaseData();

  const [wizardStep, setWizardStep] = useState<number>(1);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [mapMode, setMapMode] = useState<"polygon" | "commute">("polygon");
  const [nextCommuteLabel, setNextCommuteLabel] = useState<string>("");
  const uiVersion = useUiVersion();

  // Legacy: clear any previously persisted view-mode so old "wizard" sessions
  // don't force users back into the removed inline wizard.
  useEffect(() => {
    try { localStorage.removeItem("reamar-brief-view-mode"); } catch {}
  }, []);

  const openFullscreenWizard = useCallback(() => {
    window.open(`/cases/${clientId}/wizard`, "_blank");
  }, [clientId]);

  /* ── Guards ── */

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">Načítání…</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">
          Nejste přihlášen. Přejděte na{" "}
          <Link href="/login" className="text-slate-900 underline">/login</Link>.
        </div>
      </div>
    );
  }

  if (loading) return <p className="text-sm text-slate-600">Načítání…</p>;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!client) return <p className="text-sm text-slate-600">Klient nenalezen.</p>;

  /* ── Summary builders ── */

  const mustHaveSummary: string[] = [];
  const preferSummary: string[] = [];

  const standardLabels: Record<string, string> = {
    recuperation: "Rekuperace", floor_heating: "Podlahové vytápění", exterior_blinds: "Předokenní žaluzie",
    air_conditioning: "Klimatizace", cellar: "Sklep", parking: "Parkování",
    smart_home: "Smart home", high_standard: "Vyšší standard", elevator: "Výtah",
    heating_source: "Zdroj vytápění",
  };

  if (wizardExtras.standards) {
    Object.entries(wizardExtras.standards).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      const label = standardLabels[key] ?? key;
      if (value === "must") mustHaveSummary.push(label);
      else if (value === "prefer") preferSummary.push(label);
    });
  }

  const outdoorLabels: Record<string, string> = { outdoor_space: "Venkovní prostor", balcony: "Balkon", terrace: "Terasa", garden: "Zahrada" };
  if (wizardExtras.outdoor) {
    Object.entries(outdoorLabels).forEach(([key, label]) => {
      const value = (wizardExtras.outdoor as any)[key] as Priority | undefined;
      if (value === "must") mustHaveSummary.push(label);
      else if (value === "prefer") preferSummary.push(label);
    });
    const floorRule = wizardExtras.outdoor.floor_rule;
    if (floorRule && floorRule !== "ignore") {
      const floorRuleMap: Record<string, string> = { no_ground: "Nechci přízemí", top_3: "Poslední 3 patra", top_1: "Poslední patro" };
      const label = floorRuleMap[floorRule];
      if (label) preferSummary.push(`Patro: ${label}`);
    }
  }


  if (wizardExtras.project_amenities) {
    const amenityLabels: Record<string, string> = { reception: "Recepce", fitness: "Fitness", ev_charger: "Elektro nabíječka", courtyard_garden: "Vnitroblok" };
    Object.entries(wizardExtras.project_amenities).forEach(([key, value]) => {
      const label = amenityLabels[key] ?? key;
      if (value === "prefer") preferSummary.push(label);
      else if (value === "reject") preferSummary.push(`${label}: nechci`);
    });
  }

  /* ── Summary rail component ── */

  const summaryRail = (
    <div className="space-y-4 text-xs">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Živé shrnutí</h3>

      {/* Budget */}
      {profile?.budget_max != null && (
        <div>
          <p className="font-semibold text-slate-700">Rozpočet</p>
          <p className="text-slate-600">Max: {formatCurrencyCzk(profile.budget_max)}</p>
          {wizardExtras.budget?.max_price_tolerance_pct != null && <p className="text-slate-600">Tolerance: +{wizardExtras.budget.max_price_tolerance_pct}%</p>}
        </div>
      )}

      {/* Area */}
      {profile?.area_min != null && (
        <div>
          <p className="font-semibold text-slate-700">Plocha</p>
          <p className="text-slate-600">Min: {formatAreaM2(profile.area_min)}</p>
          {wizardExtras.budget?.max_area_tolerance_pct != null && <p className="text-slate-600">Tolerance: -{wizardExtras.budget.max_area_tolerance_pct}%</p>}
        </div>
      )}

      {/* Layouts */}
      {selectedLayouts.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700">Dispozice</p>
          <p className="text-slate-600">{selectedLayouts.join(", ")}</p>
        </div>
      )}

      {/* Location */}
      {(wizardExtras.location?.method_polygon || wizardExtras.location?.method_commute || wizardExtras.location?.method_admin) && (
        <div>
          <p className="font-semibold text-slate-700">Lokalita</p>
          <ul className="text-slate-600">
            {wizardExtras.location?.method_polygon && <li>Polygon</li>}
            {wizardExtras.location?.method_commute && <li>Dojíždění</li>}
            {wizardExtras.location?.method_admin && <li>Preferované oblasti jako striktní požadavek</li>}
          </ul>
          {locationPolygons.some((p) => p.length >= 3) && (
            <p className="text-slate-500">{projectsInsidePolygon} projektů v oblasti</p>
          )}
        </div>
      )}

      {/* Must-haves */}
      {mustHaveSummary.length > 0 && (
        <div>
          <p className="font-semibold text-emerald-700">Musí být</p>
          <ul className="space-y-0.5">
            {mustHaveSummary.map((item, idx) => (
              <li key={idx} className="flex items-start gap-1.5 text-emerald-800">
                <span className="mt-px text-emerald-500">✓</span>{item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preferences */}
      {preferSummary.length > 0 && (
        <div>
          <p className="font-semibold text-violet-700">Preference</p>
          <ul className="space-y-0.5">
            {preferSummary.map((item, idx) => (
              <li key={idx} className="text-violet-800">· {item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Market */}
      {areaMarket && (
        <div>
          <p className="font-semibold text-slate-700">Trh</p>
          <p className="text-slate-600">{areaMarket.projects_count} projektů · {areaMarket.matching_units_count} odpovídá</p>
        </div>
      )}
    </div>
  );

  /* ── Render ── */

  const recomputingBanner = recomputing ? (
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
  ) : null;

  const analyticsContent = (
    <div className="rv2-analytics-grid">
      <div className="rv2-analytics-card">
        <div style={{ fontSize: "var(--r-font-11)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--r-tracking-wider)", color: "var(--r-text-tertiary)" }}>
          Trh v hledané oblasti
        </div>
        {locationPolygons.length === 0 || locationPolygons[0].length < 3 ? (
          <p style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-secondary)" }}>
            Pro zobrazení trhu vyberte oblast v kroku &quot;Lokalita&quot;.
          </p>
        ) : !areaMarket ? (
          <p style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-secondary)" }}>Načítám…</p>
        ) : areaMarket.projects_count === 0 ? (
          <p style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-secondary)" }}>Žádné aktivní projekty.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--r-font-13)" }}>
            <div>
              <strong style={{ fontSize: "var(--r-font-20)" }}>{areaMarket.projects_count}</strong>
              <span style={{ color: "var(--r-text-tertiary)", marginLeft: 6 }}>projektů v oblasti</span>
            </div>
            <div style={{ color: "var(--r-text-secondary)" }}>
              {areaMarket.active_units_count} aktivních · <strong>{areaMarket.matching_units_count}</strong> odpovídá
            </div>
            {areaMarket.avg_price_per_m2_czk != null && (
              <div style={{ color: "var(--r-text-secondary)" }}>
                Ø {areaMarket.avg_price_per_m2_czk.toLocaleString("cs-CZ")} Kč/m²
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rv2-analytics-card">
        <div style={{ fontSize: "var(--r-font-11)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--r-tracking-wider)", color: "var(--r-text-tertiary)" }}>
          Analýza nabídky
        </div>
        {!marketFit ? (
          <p style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-secondary)" }}>Zatím není k dispozici.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "var(--r-font-13)" }}>
            <div>
              <strong>{marketFit.matching_units_count}</strong>
              <span style={{ color: "var(--r-text-tertiary)" }}> z {marketFit.available_units_count} dostupných</span>
            </div>
            {marketFit.top_blockers.length > 0 && (
              <div>
                <div style={{ fontSize: "var(--r-font-11)", fontWeight: 600, color: "var(--r-text-tertiary)", textTransform: "uppercase", marginBottom: 4 }}>
                  Blokující faktory
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                  {marketFit.top_blockers.slice(0, 3).map((b) => (
                    <li key={b.key} style={{ fontSize: "var(--r-font-12)" }}>
                      <strong>{b.label}:</strong>{" "}
                      <span style={{ color: "var(--r-text-secondary)" }}>
                        {Math.round(b.blocked_percentage * 100)} % vypadá
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rv2-analytics-card">
        <div style={{ fontSize: "var(--r-font-11)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--r-tracking-wider)", color: "var(--r-text-tertiary)" }}>
          Doporučené jednotky
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--r-font-13)" }}>
          <div>
            <strong style={{ fontSize: "var(--r-font-20)" }}>{recs.length}</strong>
            <span style={{ color: "var(--r-text-tertiary)", marginLeft: 6 }}>jednotek</span>
          </div>
          {recs.length > 0 && (
            <Link
              href={`/cases/${clientId}/recommendations`}
              style={{ color: "var(--r-brand)", fontSize: "var(--r-font-12)" }}
            >
              Přejít na doporučení →
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  if (uiVersion === "v2") {
    return (
      <>
        <BriefV2Chrome
          clientName={client.name}
          clientId={clientId}
          isActiveClient={activeClient?.clientId === client.id}
          profileDirty={profileDirty}
          profileSaving={profileSaving}
          profileSavedMessage={profileSavedMessage}
          hasProfile={!!profile}
          onActivate={handleActivate}
          onSave={handleExplicitSave}
          onOpenWizard={openFullscreenWizard}
          onOpenWalkPrefs={() => setWalkPrefsOpen(true)}
          onRecompute={handleRecompute}
          recomputing={recomputing}
          rail={{
            profileBudgetMax: profile?.budget_max ?? null,
            profileAreaMin: profile?.area_min ?? null,
            wizardExtras,
            selectedLayouts,
            mustHaveSummary,
            preferSummary,
            projectsInsidePolygon,
            locationPolygonDrawn: locationPolygons.some((p) => p.length >= 3),
            areaMarket: areaMarket
              ? {
                  projects_count: areaMarket.projects_count,
                  matching_units_count: areaMarket.matching_units_count,
                }
              : null,
          }}
          recomputeBanner={recomputingBanner}
          showAnalytics={showAnalytics}
          setShowAnalytics={setShowAnalytics}
          analyticsContent={analyticsContent}
        >
          <QuickEdit
            profile={profile}
            setProfile={setProfile}
            wizardExtras={wizardExtras}
            setWizardExtras={setWizardExtras}
            selectedLayouts={selectedLayouts}
            setSelectedLayouts={setSelectedLayouts}
            LAYOUT_OPTIONS={LAYOUT_OPTIONS}
            locationPolygons={locationPolygons}
            projectsInsidePolygon={projectsInsidePolygon}
            recs={recs}
            profileDirty={profileDirty}
            recomputing={recomputing}
            handleRecompute={handleRecompute}
            mustHaveSummary={mustHaveSummary}
            preferSummary={preferSummary}
            onSwitchToWizard={openFullscreenWizard}
            walkPrefs={walkPrefs}
            setWalkPrefs={setWalkPrefs}
          />
          {recsFunnel && (
            <div style={{ marginTop: "var(--r-space-4)" }}>
              <FunnelCard funnel={recsFunnel} />
            </div>
          )}
        </BriefV2Chrome>
        <WalkabilityPreferencesDrawer
          open={walkPrefsOpen}
          value={walkPrefs}
          onChange={setWalkPrefs}
          onClose={() => setWalkPrefsOpen(false)}
          onApply={() => { saveWalkPrefs(walkPrefs); setWalkPrefsOpen(false); }}
          onReset={() => { const def = getDefaultPreferences(); setWalkPrefs(def); saveWalkPrefs(def); }}
        />
      </>
    );
  }

  return (
    <div className="space-y-5">
      {recomputing && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <svg className="h-4 w-4 shrink-0 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>
            {recomputeProgress && recomputeProgress.total > 0 && recomputeProgress.done < recomputeProgress.total
              ? <>Počítám dojezdy… <span className="font-medium">({recomputeProgress.done}/{recomputeProgress.total} projektů)</span></>
              : recomputeProgress && recomputeProgress.total > 0
              ? <>Skóruji projekty… <span className="font-medium text-blue-600">({recomputeProgress.total} projektů)</span></>
              : "Počítám doporučení…"
            }
          </span>
        </div>
      )}

      <section className="w-full">
        <ReamarCard className="px-6 py-5 md:px-10 md:py-6">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <nav className="text-sm text-slate-500">
                <Link href="/clients" className="hover:underline">Klienti</Link>{" / "}
                <span className="font-semibold text-slate-900">{client.name}</span>
              </nav>
              {profileSavedMessage && (
                <p className="text-xs text-emerald-600">{profileSavedMessage}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 md:flex">
                {activeClient?.clientId === client.id ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Aktivní klient
                  </span>
                ) : (
                  <ReamarButton type="button" variant="ghost" size="sm" onClick={handleActivate} disabled={!profile} title="Aktivovat klientský mód">
                    Aktivovat klienta
                  </ReamarButton>
                )}
                <ReamarButton type="button" variant="ghost" size="sm" onClick={() => window.open(`/cases/${clientId}/wizard`, "_blank")}>
                  Spustit wizard
                </ReamarButton>
                <ReamarButton type="button" variant="ghost" size="sm" onClick={handleExplicitSave} disabled={!profileDirty || profileSaving}>
                  {profileSaving ? "Ukládám…" : profileDirty ? "Uložit" : "Uloženo"}
                </ReamarButton>
              </div>
            </div>
          </div>

          {/* Main editing surface — Quick Edit.
              The legacy inline step-wizard was removed from the normal flow;
              users open the full-screen wizard via the "Spustit wizard" button. */}
          <QuickEdit
            profile={profile}
            setProfile={setProfile}
            wizardExtras={wizardExtras}
            setWizardExtras={setWizardExtras}
            selectedLayouts={selectedLayouts}
            setSelectedLayouts={setSelectedLayouts}
            LAYOUT_OPTIONS={LAYOUT_OPTIONS}
            locationPolygons={locationPolygons}
            projectsInsidePolygon={projectsInsidePolygon}
            recs={recs}
            profileDirty={profileDirty}
            recomputing={recomputing}
            handleRecompute={handleRecompute}
            mustHaveSummary={mustHaveSummary}
            preferSummary={preferSummary}
            onSwitchToWizard={openFullscreenWizard}
            walkPrefs={walkPrefs}
            setWalkPrefs={setWalkPrefs}
          />
          {profileDirty && (
            <div className="mt-4 flex items-center justify-end">
              <span className="text-[11px] text-amber-600">Neuložené změny</span>
            </div>
          )}
        </ReamarCard>

        {/* Filter funnel (Phase 7b) */}
        {recsFunnel && <FunnelCard funnel={recsFunnel} />}
      </section>

      {/* Analytics collapsible section */}
      <section className="w-full space-y-3">
        <button type="button"
          className="flex w-full items-center justify-between rounded-lg bg-white px-6 py-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-slate-300"
          onClick={() => setShowAnalytics((prev) => !prev)}>
          <span className="text-sm font-semibold text-slate-800">Analytika a podklady</span>
          <span className="text-xs text-slate-400">{showAnalytics ? "▲ Skrýt" : "▼ Zobrazit"}</span>
        </button>

        {showAnalytics && (
          <div className="grid gap-4 md:grid-cols-3">
            <ReamarSubtleCard className="col-span-1 p-4">
              <div className="mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trh v hledané oblasti</h3>
                <p className="mt-1 text-[11px] text-slate-600">Přehled projektů a jednotek v zakreslené oblasti.</p>
              </div>
              {locationPolygons.length === 0 || locationPolygons[0].length < 3 ? (
                <p className="text-[11px] text-slate-500">Pro zobrazení trhu vyberte oblast v kroku &quot;Lokalita&quot; a uložte profil klienta.</p>
              ) : !areaMarket ? (
                <p className="text-[11px] text-slate-500">Načítám data o trhu v hledané oblasti…</p>
              ) : areaMarket.projects_count === 0 ? (
                <p className="text-[11px] text-slate-500">V aktuálně zvolené oblasti nejsou žádné aktivní projekty.</p>
              ) : (
                <div className="space-y-2 text-[11px] text-slate-700">
                  <StatCard label="Projekty v oblasti" value={areaMarket.projects_count} sublabel="s aktivními jednotkami" className="mb-2" />
                  <p><span className="font-semibold text-slate-900">{areaMarket.active_units_count}</span> aktivních jednotek, z toho <span className="font-semibold text-slate-900">{areaMarket.matching_units_count}</span> odpovídá profilu klienta.</p>
                  <p className="mt-1 font-semibold text-slate-900">Ceny v oblasti</p>
                  <p>Průměrná cena: {areaMarket.avg_price_czk != null ? `${areaMarket.avg_price_czk.toLocaleString("cs-CZ")} Kč` : "—"}</p>
                  <p>Průměrná cena/m²: {areaMarket.avg_price_per_m2_czk != null ? `${areaMarket.avg_price_per_m2_czk.toLocaleString("cs-CZ")} Kč/m²` : "—"}</p>
                  <p>Rozptyl cen: {areaMarket.min_price_czk != null ? `${areaMarket.min_price_czk.toLocaleString("cs-CZ")} Kč` : "—"} – {areaMarket.max_price_czk != null ? `${areaMarket.max_price_czk.toLocaleString("cs-CZ")} Kč` : "—"}</p>
                </div>
              )}
            </ReamarSubtleCard>

            <ReamarSubtleCard className="col-span-1 p-4">
              <div className="mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Analýza nabídky</h3>
                <p className="mt-1 text-[11px] text-slate-600">Jak současná nabídka odpovídá profilu klienta.</p>
              </div>
              {!marketFit ? (
                <p className="text-[11px] text-slate-500">Analýza zatím není k dispozici.</p>
              ) : (
                <div className="space-y-3 text-[11px] text-slate-700">
                  <p>Aktuálně odpovídá profilu <span className="font-semibold text-slate-900">{marketFit.matching_units_count}</span> jednotek z <span className="font-semibold text-slate-900">{marketFit.available_units_count}</span> dostupných.</p>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-900">Hlavní blokující faktory</p>
                    <ul className="mt-1 space-y-1">
                      {marketFit.top_blockers.length === 0 ? (
                        <li>Žádný výrazný blokující faktor.</li>
                      ) : (
                        marketFit.top_blockers.slice(0, 3).map((b) => (
                          <li key={b.key}><span className="font-semibold">{b.label}:</span> {Math.round(b.blocked_percentage * 100)} % jednotek vypadá.</li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-900">Jak odemknout více jednotek</p>
                    {marketFit.relaxation_suggestions.length === 0 ? (
                      <p className="mt-1">Změny profilu by nepřinesly významné zvýšení.</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {marketFit.relaxation_suggestions.slice(0, 5).map((s) => (
                          <li key={s.label} className="flex items-center justify-between gap-2">
                            <span>{s.label}</span>
                            <span className="text-[10px] font-semibold text-slate-900">{s.delta_vs_current >= 0 ? "+" : ""}{s.delta_vs_current} jednotek</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </ReamarSubtleCard>

            <ReamarSubtleCard className="col-span-1 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Doporučené jednotky</h3>
                <span className="text-[11px] text-slate-500">{recs.length} jednotek</span>
              </div>
              {recs.length === 0 ? (
                <p className="text-[11px] text-slate-600">Zatím žádná doporučení. Klikněte na &quot;Potvrdit zadání&quot;.</p>
              ) : (
                <div className="max-h-[480px] overflow-y-auto overflow-hidden rounded-lg border border-slate-200/70">
                  <p className="px-3 py-2 text-[11px] text-slate-500">{recs.length} jednotek — přejděte na záložku Doporučení pro detail.</p>
                </div>
              )}
            </ReamarSubtleCard>
          </div>
        )}
      </section>

      <WalkabilityPreferencesDrawer
        open={walkPrefsOpen}
        value={walkPrefs}
        onChange={setWalkPrefs}
        onClose={() => setWalkPrefsOpen(false)}
        onApply={() => { saveWalkPrefs(walkPrefs); setWalkPrefsOpen(false); }}
        onReset={() => { const def = getDefaultPreferences(); setWalkPrefs(def); saveWalkPrefs(def); }}
      />
    </div>
  );
}

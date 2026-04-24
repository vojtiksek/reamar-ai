"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useCaseData } from "@/hooks/useCaseData";
import type { Priority } from "@/lib/caseTypes";
import { FunnelCard } from "@/components/case/FunnelCard";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import { QuickEdit } from "./QuickEdit";
import { getDefaultPreferences } from "@/lib/walkabilityPreferences";
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
    activeClient,
    handleRecompute,
    handleActivate,
    saveWalkPrefs,
  } = useCaseData();

  const [showAnalytics, setShowAnalytics] = useState(false);

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

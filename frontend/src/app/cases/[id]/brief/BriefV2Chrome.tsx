"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import type { WizardExtras } from "@/lib/caseTypes";

type AreaMarket = {
  projects_count: number;
  matching_units_count: number;
};

type RailData = {
  profileBudgetMax?: number | null;
  profileAreaMin?: number | null;
  wizardExtras: WizardExtras;
  selectedLayouts: string[];
  mustHaveSummary: string[];
  preferSummary: string[];
  projectsInsidePolygon: number;
  locationPolygonDrawn: boolean;
  areaMarket: AreaMarket | null;
};

type Props = {
  clientName: string;
  clientId: number | string;
  isActiveClient: boolean;
  profileDirty: boolean;
  profileSaving: boolean;
  profileSavedMessage?: string | null;
  hasProfile: boolean;

  onActivate: () => void;
  onSave: () => void;
  onOpenWizard: () => void;
  onOpenWalkPrefs: () => void;
  onRecompute: () => void;
  recomputing: boolean;

  rail: RailData;
  recomputeBanner: ReactNode;

  showAnalytics: boolean;
  setShowAnalytics: (b: boolean) => void;
  analyticsContent: ReactNode;

  children: ReactNode; // QuickEdit + FunnelCard
};

export function BriefV2Chrome(props: Props) {
  const {
    clientName,
    isActiveClient,
    profileDirty,
    profileSaving,
    profileSavedMessage,
    hasProfile,
    onActivate,
    onSave,
    onOpenWizard,
    rail,
    recomputeBanner,
    showAnalytics,
    setShowAnalytics,
    analyticsContent,
    children,
  } = props;

  return (
    <div className="rv2-page">
      {recomputeBanner}

      <header className="rv2-page-header">
        <div>
          <nav style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-tertiary)", marginBottom: 4 }}>
            <Link href="/cases" style={{ color: "inherit" }}>Klienti</Link>
            <span style={{ margin: "0 6px" }}>/</span>
            <span style={{ color: "var(--r-text-secondary)" }}>{clientName}</span>
          </nav>
          <h1 className="rv2-page-title">Brief klienta</h1>
          <p className="rv2-page-subtitle">
            {clientName} ·{" "}
            {profileSaving
              ? "Ukládám…"
              : profileDirty
                ? "Neuložené změny"
                : profileSavedMessage || "Uloženo"}
          </p>
        </div>
        <div className="rv2-brief-actions">
          {isActiveClient ? (
            <span className="rv2-brief-status-pill" data-tone="success">
              <span className="rv2-brief-status-dot" aria-hidden />
              Aktivní klient
            </span>
          ) : (
            <button
              type="button"
              className="rv2-button rv2-button-secondary"
              onClick={onActivate}
              disabled={!hasProfile}
              title="Aktivovat klientský mód"
            >
              Aktivovat klienta
            </button>
          )}
          <button
            type="button"
            className="rv2-button rv2-button-secondary"
            onClick={onOpenWizard}
          >
            Spustit wizard
          </button>
          <button
            type="button"
            className="rv2-button rv2-button-primary"
            onClick={onSave}
            disabled={!profileDirty || profileSaving}
          >
            {profileSaving ? "Ukládám…" : profileDirty ? "Uložit" : "Uloženo"}
          </button>
        </div>
      </header>

      <div className="rv2-brief">
        <section className="rv2-brief-main">
          <div className="rv2-brief-main-body">{children}</div>
        </section>

        <BriefRail data={rail} />
      </div>

      <button
        type="button"
        className="rv2-analytics-toggle"
        onClick={() => setShowAnalytics(!showAnalytics)}
      >
        <span>Analytika a podklady</span>
        <span style={{ color: "var(--r-text-tertiary)", fontSize: "var(--r-font-12)" }}>
          {showAnalytics ? "▲ Skrýt" : "▼ Zobrazit"}
        </span>
      </button>

      {showAnalytics && analyticsContent}
    </div>
  );
}

function BriefRail({ data }: { data: RailData }) {
  const {
    profileBudgetMax,
    profileAreaMin,
    wizardExtras,
    selectedLayouts,
    mustHaveSummary,
    preferSummary,
    projectsInsidePolygon,
    locationPolygonDrawn,
    areaMarket,
  } = data;

  const hasBudget = profileBudgetMax != null;
  const hasArea = profileAreaMin != null;
  const hasLayouts = selectedLayouts.length > 0;
  const hasLocation =
    wizardExtras.location?.method_polygon ||
    wizardExtras.location?.method_commute ||
    wizardExtras.location?.method_admin;
  const somethingFilled =
    hasBudget ||
    hasArea ||
    hasLayouts ||
    hasLocation ||
    mustHaveSummary.length > 0 ||
    preferSummary.length > 0;

  return (
    <aside className="rv2-brief-rail" aria-label="Živé shrnutí">
      <div className="rv2-brief-rail-header">Živé shrnutí</div>

      {!somethingFilled && (
        <div style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-tertiary)", fontStyle: "italic" }}>
          Zatím nic nevyplněno. Začněte editací vlevo.
        </div>
      )}

      {hasBudget && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label">Rozpočet</span>
          <span className="rv2-brief-rail-row">
            Max {formatCurrencyCzk(profileBudgetMax!)}
            {wizardExtras.budget?.max_price_tolerance_pct != null && (
              <>
                {" "}
                <span style={{ color: "var(--r-text-tertiary)", fontSize: "var(--r-font-12)" }}>
                  (+{wizardExtras.budget.max_price_tolerance_pct}%)
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {hasArea && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label">Plocha</span>
          <span className="rv2-brief-rail-row">
            Min {formatAreaM2(profileAreaMin!)}
            {wizardExtras.budget?.max_area_tolerance_pct != null && (
              <>
                {" "}
                <span style={{ color: "var(--r-text-tertiary)", fontSize: "var(--r-font-12)" }}>
                  (−{wizardExtras.budget.max_area_tolerance_pct}%)
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {hasLayouts && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label">Dispozice</span>
          <span className="rv2-brief-rail-row">{selectedLayouts.join(", ")}</span>
        </div>
      )}

      {hasLocation && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label">Lokalita</span>
          <ul className="rv2-brief-rail-list">
            {wizardExtras.location?.method_polygon && <li>· Polygon na mapě</li>}
            {wizardExtras.location?.method_commute && <li>· Dojíždění</li>}
            {wizardExtras.location?.method_admin && <li>· Oblasti jako striktní filtr</li>}
          </ul>
          {locationPolygonDrawn && (
            <span style={{ fontSize: "var(--r-font-12)", color: "var(--r-text-tertiary)" }}>
              {projectsInsidePolygon} projektů v oblasti
            </span>
          )}
        </div>
      )}

      {mustHaveSummary.length > 0 && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label" style={{ color: "var(--r-state-success)" }}>
            Musí být
          </span>
          <ul className="rv2-brief-rail-list">
            {mustHaveSummary.map((item, i) => (
              <li key={i} style={{ color: "var(--r-state-success)" }}>
                ✓ {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preferSummary.length > 0 && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label" style={{ color: "#7c3aed" }}>
            Preference
          </span>
          <ul className="rv2-brief-rail-list">
            {preferSummary.map((item, i) => (
              <li key={i} style={{ color: "#6d28d9" }}>
                · {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {areaMarket && (
        <div className="rv2-brief-rail-section">
          <span className="rv2-brief-rail-row-label">Trh v oblasti</span>
          <span className="rv2-brief-rail-row">
            {areaMarket.projects_count} projektů ·{" "}
            <strong>{areaMarket.matching_units_count}</strong> odpovídá
          </span>
        </div>
      )}
    </aside>
  );
}

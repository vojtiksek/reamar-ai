"use client";

import type { ReactNode } from "react";
import { formatCurrencyCzk } from "@/lib/format";
import { normalizeAdminAreaList } from "@/lib/wizardTransform";
import {
  getNonDefaultChips as getWalkChips,
  type WalkabilityPreferences,
} from "@/lib/walkabilityPreferences";
import type { WizardExtras } from "@/lib/caseTypes";

type PreviewData = {
  profile: { budget_max?: number | null; area_min?: number | null; purchase_purpose?: string | null } | null;
  wizardExtras: WizardExtras;
  selectedLayouts: string[];
  walkPrefs: WalkabilityPreferences;
  locationProjectsCount: number;
  recomputeMatchCount: number | null;
};

type Props = {
  clientName: string;
  step: number;
  totalSteps: number;
  stepLabels: Record<number, string>;
  onStepChange: (n: number) => void;
  children: ReactNode;

  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
  onClose: () => void;

  profileDirty: boolean;
  profileSaving: boolean;
  onSave: () => void;
  finishing: boolean;
  recomputeStatus: "idle" | "loading" | "done" | "error";

  preview: PreviewData;
};

export function WizardV2Chrome(props: Props) {
  const {
    clientName,
    step,
    totalSteps,
    stepLabels,
    onStepChange,
    children,
    onPrev,
    onNext,
    onFinish,
    onClose,
    profileDirty,
    profileSaving,
    onSave,
    finishing,
    recomputeStatus,
    preview,
  } = props;

  const progressPct = Math.round((step / totalSteps) * 100);
  const isLast = step >= totalSteps;

  return (
    <div className="rv2-wizard">
      {/* Left rail */}
      <aside className="rv2-wizard-rail" aria-label="Kroky dotazníku">
        <div className="rv2-wizard-rail-header">
          <div className="rv2-wizard-rail-client">{clientName}</div>
          <div className="rv2-wizard-rail-progress">
            Krok {step} / {totalSteps}
          </div>
          <div className="rv2-wizard-rail-bar" aria-hidden>
            <div style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => {
            const state = n === step ? "active" : n < step ? "done" : "pending";
            return (
              <button
                key={n}
                type="button"
                className="rv2-wizard-step-btn"
                data-state={state}
                onClick={() => onStepChange(n)}
              >
                <span className="rv2-wizard-step-num">
                  {state === "done" ? "✓" : n}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {stepLabels[n]}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <section className="rv2-wizard-main">
        <header className="rv2-wizard-main-header">
          <div className="rv2-wizard-main-title">{stepLabels[step]}</div>
          <div className="rv2-wizard-main-subtitle">
            {clientName} · {profileDirty ? "Neuložené změny" : "Uloženo"}
          </div>
          {/* Mobile step picker — viditelný když je rail skrytý (≤900px) */}
          <div className="rv2-wizard-mobile-nav" aria-label="Navigace mezi kroky">
            <div className="rv2-wizard-rail-bar" aria-hidden style={{ marginBottom: 6 }}>
              <div style={{ width: `${progressPct}%` }} />
            </div>
            <select
              value={step}
              onChange={(e) => onStepChange(Number(e.target.value))}
              aria-label={`Krok ${step} z ${totalSteps}`}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "var(--r-font-14)",
                borderRadius: "var(--r-radius-sm)",
                border: "1px solid var(--r-border-default)",
                background: "var(--r-surface-1)",
                color: "var(--r-text-primary)",
                minHeight: 44,
              }}
            >
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n < step ? "✓ " : ""}
                  {n}. {stepLabels[n]}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="rv2-wizard-main-body">{children}</div>

        <footer className="rv2-wizard-main-footer">
          <button
            type="button"
            className="rv2-button rv2-button-ghost"
            onClick={onPrev}
            disabled={step === 1}
          >
            ← Zpět
          </button>

          <div className="rv2-wizard-main-footer-actions">
            {!isLast && (
              <>
                <button
                  type="button"
                  className="rv2-button rv2-button-ghost"
                  onClick={onSave}
                  disabled={!profileDirty || profileSaving}
                >
                  {profileSaving ? "Ukládám…" : "Uložit"}
                </button>
                <button
                  type="button"
                  className="rv2-button rv2-button-primary"
                  onClick={onNext}
                >
                  Další →
                </button>
              </>
            )}
            {isLast && recomputeStatus === "done" && (
              <button
                type="button"
                className="rv2-button rv2-button-primary"
                onClick={onClose}
                style={{ background: "var(--r-state-success)" }}
              >
                Zobrazit výsledky →
              </button>
            )}
            {isLast && recomputeStatus !== "done" && (
              <button
                type="button"
                className="rv2-button rv2-button-primary"
                onClick={onFinish}
                disabled={finishing || recomputeStatus === "loading"}
              >
                {finishing
                  ? "Ukládám…"
                  : recomputeStatus === "loading"
                    ? "Počítám…"
                    : "Dokončit a uložit"}
              </button>
            )}
          </div>
        </footer>
      </section>

      {/* Preview */}
      <PreviewPanel
        data={preview}
        recomputeStatus={recomputeStatus}
        progressPct={progressPct}
      />
    </div>
  );
}

function PreviewPanel({
  data,
  recomputeStatus,
  progressPct,
}: {
  data: PreviewData;
  recomputeStatus: "idle" | "loading" | "done" | "error";
  progressPct: number;
}) {
  const { profile, wizardExtras: w, selectedLayouts, walkPrefs, locationProjectsCount, recomputeMatchCount } = data;

  const rows: { label: string; value: string | null }[] = [
    {
      label: "Účel",
      value:
        profile?.purchase_purpose === "own_use"
          ? "Vlastní bydlení"
          : profile?.purchase_purpose === "investment"
            ? "Investice"
            : null,
    },
    { label: "Typ klienta", value: w.client_type ?? null },
    {
      label: "Max. cena",
      value: profile?.budget_max ? formatCurrencyCzk(profile.budget_max) : null,
    },
    {
      label: "Dispozice",
      value: selectedLayouts.length ? selectedLayouts.join(", ") : null,
    },
    {
      label: "Min. plocha",
      value: profile?.area_min ? `${profile.area_min} m²` : null,
    },
    {
      label: "Min. venkovní plocha",
      value: w.outdoor?.min_outdoor_area_m2
        ? `${w.outdoor.min_outdoor_area_m2} m²`
        : null,
    },
    {
      label: "Lokalita",
      value: (() => {
        const list = normalizeAdminAreaList(w.location?.administrative_area);
        return list.length ? list.join(", ") : null;
      })(),
    },
    {
      label: "Financování",
      value: w.financing_type ?? null,
    },
    {
      label: "Nastěhování",
      value: w.move_in_timeline ?? null,
    },
  ];
  const filled = rows.filter((r) => r.value);
  const walkChips = getWalkChips(walkPrefs);

  return (
    <aside className="rv2-wizard-preview" aria-label="Živý náhled">
      <div className="rv2-wizard-preview-header">Živý náhled</div>

      {recomputeStatus === "done" && recomputeMatchCount != null ? (
        <div className="rv2-wizard-preview-count">
          <div className="rv2-wizard-preview-count-value">{recomputeMatchCount}</div>
          <div className="rv2-wizard-preview-count-label">
            {recomputeMatchCount === 0
              ? "Žádné doporučení — upravte filtry"
              : recomputeMatchCount < 10
                ? "Velmi omezený výběr"
                : recomputeMatchCount < 100
                  ? "Dobrý výběr"
                  : "Široký výběr"}
          </div>
        </div>
      ) : (
        <div className="rv2-wizard-preview-count">
          <div className="rv2-wizard-preview-count-value">{progressPct}%</div>
          <div className="rv2-wizard-preview-count-label">
            Postup vyplnění wizardu
          </div>
        </div>
      )}

      {locationProjectsCount > 0 && (
        <div className="rv2-wizard-preview-section">
          <div className="rv2-wizard-preview-header">Oblast na mapě</div>
          <div
            style={{
              fontSize: "var(--r-font-13)",
              color: "var(--r-text-primary)",
            }}
          >
            <strong style={{ fontSize: "var(--r-font-16)" }}>
              {locationProjectsCount}
            </strong>{" "}
            projektů v polygonu
          </div>
        </div>
      )}

      <div className="rv2-wizard-preview-section">
        <div className="rv2-wizard-preview-header">Co víme o klientovi</div>
        {filled.length === 0 ? (
          <div className="rv2-wizard-empty">Zatím nic nevyplněno.</div>
        ) : (
          filled.map((r) => (
            <div key={r.label} className="rv2-wizard-preview-row">
              <span className="rv2-wizard-preview-row-label">{r.label}</span>
              <span className="rv2-wizard-preview-row-value">{r.value}</span>
            </div>
          ))
        )}
      </div>

      {walkChips.length > 0 && (
        <div className="rv2-wizard-preview-section">
          <div className="rv2-wizard-preview-header">Okolí a doprava</div>
          <div className="rv2-wizard-preview-chips">
            {walkChips.map((chip) => (
              <span
                key={chip}
                className="rv2-badge rv2-badge-shortlist"
                style={{ fontSize: "var(--r-font-11)" }}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

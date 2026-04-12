"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import clsx from "clsx";

import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import { API_BASE } from "@/lib/api";
import {
  DEFAULT_PREFERENCES,
} from "@/lib/walkabilityPreferences";
import type { Priority } from "@/lib/caseTypes";
import { PrefToggle } from "@/components/case/PrefToggle";
import { FunnelCard } from "@/components/case/FunnelCard";
import { ClientLocationMap } from "@/components/ClientLocationMap";
import { AddressSearch } from "@/components/AddressSearch";
import { WalkabilityPreferencesGroup } from "@/components/WalkabilityPreferencesGroup";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
import { QuickEdit } from "./QuickEdit";
import { CommutePointsEditor, type CommutePoint } from "./CommutePointsEditor";
import {
  ReamarButton,
  ReamarCard,
  ReamarSubtleCard,
  StatCard,
  reamarInputClass,
  reamarLabelClass,
  reamarSelectClass,
} from "@/components/ui/reamar-ui";
import { getDefaultPreferences } from "@/lib/walkabilityPreferences";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

/* ─── Constants ─── */

const TOTAL_WIZARD_STEPS = 10;

const STEP_LABELS: Record<number, string> = {
  1: "Klient",
  2: "Cena a financování",
  3: "Lokalita",
  4: "Okolí projektu",
  5: "Standardy",
  6: "Vybavení projektu",
  7: "Dispozice a prostor",
  8: "Dokončení",
  9: "Novostavba vs rekonstrukce",
  10: "Shrnutí",
};

const CLIENT_TYPE_CARDS = [
  { key: "family", label: "Rodina", icon: "👨‍👩‍👧‍👦", desc: "Rodina s dětmi nebo plánování rodiny" },
  { key: "couple", label: "Pár", icon: "💑", desc: "Partnerský pár bez dětí" },
  { key: "single", label: "Single", icon: "🧑", desc: "Jeden člověk" },
  { key: "downsizing", label: "Downsizing", icon: "🏡", desc: "Zmenšení, stěhování do menšího" },
] as const;

const FINANCING_TYPE_OPTIONS = [
  { key: "cash", label: "Hotovost", desc: "Platba celé částky z vlastních zdrojů" },
  { key: "mortgage", label: "Hypotéka", desc: "Financování hypotečním úvěrem" },
  { key: "combo", label: "Kombinace", desc: "Část hotově, část na hypotéku" },
  { key: "unknown", label: "Neví", desc: "Klient ještě nemá jasno" },
] as const;

const NOISE_SOURCES = [
  { key: "main_road", label: "Hlavní silnice" },
  { key: "tram", label: "Tramvaj" },
  { key: "railway", label: "Železnice" },
  { key: "airport", label: "Letiště" },
] as const;

const HEATING_OPTIONS = [
  { value: "floor_heating", label: "Podlahové vytápění" },
  { value: "radiators", label: "Radiátory" },
  { value: "ceiling", label: "Stropní" },
] as const;

const HEATING_SOURCE_OPTIONS = [
  { value: "Plynový kotel",    label: "Plynový kotel" },
  { value: "Tepelné čerpadlo", label: "Tepelné čerpadlo" },
  { value: "Teplovod",         label: "Teplovod" },
] as const;

const AC_OPTIONS = [
  { value: "preparation_ac", label: "Příprava pro AC" },
  { value: "complete_ac", label: "Kompletní AC" },
  { value: "cooling_ceilings", label: "Chladicí stropy" },
  { value: "partially_ac", label: "Částečná AC" },
  { value: "cooling_floor", label: "Chladicí podlaha" },
] as const;

const FLOORING_OPTIONS = [
  { value: "hardwood", label: "Dřevo (masiv)" },
  { value: "laminate", label: "Laminát" },
  { value: "vinyl", label: "Vinyl" },
  { value: "tile", label: "Dlažba" },
] as const;

const CEILING_HEIGHT_OPTIONS = [
  { value: "normal", label: "Normální (2.6–2.7 m)" },
  { value: "higher", label: "Vyšší (2.8+ m)" },
  { value: "loft", label: "Loft" },
] as const;

const WINDOW_OPTIONS = [
  { value: "pvc", label: "PVC" },
  { value: "aluminium", label: "Hliníková" },
  { value: "wooden", label: "Dřevěná" },
] as const;

const PROJECT_AMENITY_ITEMS = [
  { key: "reception", label: "Recepce" },
  { key: "fitness", label: "Fitness" },
  { key: "ev_charger", label: "Elektro nabíječka" },
  { key: "courtyard_garden", label: "Vnitroblok" },
] as const;

const FLOOR_RULE_OPTIONS = [
  { value: "ignore", label: "Je mi to jedno" },
  { value: "no_ground", label: "Nechci přízemí" },
  { value: "top_3", label: "Chci poslední 3 patra" },
  { value: "top_1", label: "Chci poslední patro" },
] as const;

const COMPLETION_STANDARD_OPTIONS = [
  { value: "shell_and_core", label: "Shell & Core" },
  { value: "white_wall", label: "White Wall (bílé stěny)" },
  { value: "fit_out", label: "Fit Out (kompletní)" },
] as const;

/* ─── Local step indicator ─── */

function BriefSteps({
  currentStep,
  setCurrentStep,
  totalSteps,
}: {
  currentStep: number;
  setCurrentStep: (s: number) => void;
  totalSteps: number;
}) {
  const steps = Array.from({ length: totalSteps }, (_, idx) => idx + 1);
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200/70 bg-slate-900/5/60 px-4 py-2 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
          {steps.map((step) => {
            const label = STEP_LABELS[step] ?? `Krok ${step}`;
            const isCurrent = step === currentStep;
            const isCompleted = step < currentStep;
            const isFuture = step > currentStep;
            return (
              <button
                key={step}
                type="button"
                onClick={() => setCurrentStep(step)}
                className={cn(
                  "relative flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  isCurrent && "bg-white text-slate-900 shadow-sm",
                  isCompleted && !isCurrent && "text-slate-700 hover:bg-white/50",
                  isFuture && !isCurrent && "text-slate-500 hover:bg-white/40"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                    isCompleted ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrent ? "border-slate-900 text-slate-900"
                      : "border-slate-300 text-slate-400"
                  )}
                >
                  {isCompleted ? "✓" : step}
                </span>
                <span className={cn("whitespace-nowrap", isCurrent && "font-semibold")}>{label}</span>
              </button>
            );
          })}
        </div>
        <span className="hidden text-[11px] text-slate-500 sm:inline">
          Krok {currentStep} / {totalSteps}
        </span>
      </div>
    </div>
  );
}

/* ─── Intensity picker for standards ─── */

function IntensityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [
    { v: "must", label: "Musí být", active: "border-emerald-400 bg-emerald-50 text-emerald-800" },
    { v: "prefer", label: "Preferujeme", active: "border-blue-400 bg-blue-50 text-blue-800" },
    { v: "bonus", label: "Bonus", active: "border-amber-400 bg-amber-50 text-amber-800" },
  ];
  return (
    <div className="flex gap-1">
      {options.map(({ v, label, active }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === v ? active : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─── Tri-state picker for project amenities ─── */

function AmenityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [
    { v: "prefer", label: "Preferuji", active: "border-emerald-400 bg-emerald-50 text-emerald-800" },
    { v: "reject", label: "Nechci", active: "border-rose-400 bg-rose-50 text-rose-800" },
    { v: "ignore", label: "Neřeším", active: "border-slate-400 bg-slate-100 text-slate-800" },
  ];
  return (
    <div className="flex gap-1">
      {options.map(({ v, label, active }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === v ? active : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─── Field-type badges ─── */

function FilterBadge() {
  return <span className="ml-1.5 inline-block rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-emerald-800">Filtr</span>;
}
function PrefBadge() {
  return <span className="ml-1.5 inline-block rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-violet-800">Preference</span>;
}
function CtxBadge() {
  return <span className="ml-1.5 inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-slate-600">Kontext</span>;
}

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
    profileSavedMessage,
    autoSaveStatus,
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

  const noiseLabels: Record<string, string> = { main_road: "Hlavní silnice", tram: "Tramvaj", railway: "Železnice", airport: "Letiště" };
  if (wizardExtras.noise) {
    Object.entries(noiseLabels).forEach(([key, label]) => {
      const value = (wizardExtras.noise as any)[key] as Priority | undefined;
      if (value === "must") mustHaveSummary.push(`${label}: vyloučit`);
      else if (value === "prefer") preferSummary.push(`${label}: citlivý/á`);
    });
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
      {(profile?.budget_max != null || wizardExtras.budget?.ideal_price != null) && (
        <div>
          <p className="font-semibold text-slate-700">Rozpočet</p>
          {wizardExtras.budget?.ideal_price != null && <p className="text-slate-600">Ideál: {formatCurrencyCzk(wizardExtras.budget.ideal_price)}</p>}
          {profile?.budget_max != null && <p className="text-slate-600">Max: {formatCurrencyCzk(profile.budget_max)}</p>}
          {wizardExtras.budget?.max_price_tolerance_pct != null && <p className="text-slate-600">Tolerance: +{wizardExtras.budget.max_price_tolerance_pct}%</p>}
        </div>
      )}

      {/* Area */}
      {(profile?.area_min != null || wizardExtras.budget?.ideal_area != null) && (
        <div>
          <p className="font-semibold text-slate-700">Plocha</p>
          {wizardExtras.budget?.ideal_area != null && <p className="text-slate-600">Ideál: {formatAreaM2(wizardExtras.budget.ideal_area)}</p>}
          {profile?.area_min != null && <p className="text-slate-600">Min: {formatAreaM2(profile.area_min)}</p>}
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

  /* ── Step content renderers ── */

  /* Step 1: Klient */
  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Účel nákupu <CtxBadge /></p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { key: "own_use", label: "Vlastní bydlení", icon: "🏠", desc: "Klient hledá bydlení pro sebe" },
            { key: "investment", label: "Investice", icon: "📈", desc: "Nákup za účelem investice" },
          ] as const).map(({ key, label, icon, desc }) => {
            const active = profile?.purchase_purpose === key;
            return (
              <button key={key} type="button"
                onClick={() => setProfile((prev) => ({ ...(prev ?? {}), purchase_purpose: key }))}
                className={cn(
                  "flex flex-col items-start rounded-2xl border px-5 py-4 text-left transition-colors",
                  active ? "border-indigo-400 bg-white ring-2 ring-indigo-300/40 shadow-sm" : "border-slate-200/90 bg-slate-50/90 hover:border-slate-300 hover:bg-white"
                )}>
                <span className="mb-1 text-2xl">{icon}</span>
                <p className={cn("text-sm font-semibold", active ? "text-indigo-800" : "text-slate-900")}>{label}</p>
                <p className={cn("text-[11px]", active ? "text-indigo-600/80" : "text-slate-600")}>{desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ klienta <CtxBadge /></p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CLIENT_TYPE_CARDS.map(({ key, label, icon, desc }) => {
            const active = wizardExtras.client_type === key;
            return (
              <button key={key} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, client_type: active ? null : key }))}
                className={cn(
                  "flex flex-col items-start rounded-2xl border px-4 py-3 text-left transition-colors",
                  active ? "border-indigo-400 bg-white ring-2 ring-indigo-300/40 shadow-sm" : "border-slate-200/90 bg-slate-50/90 hover:border-slate-300 hover:bg-white"
                )}>
                <span className="mb-1 text-xl">{icon}</span>
                <p className={cn("text-sm font-semibold", active ? "text-indigo-800" : "text-slate-900")}>{label}</p>
                <p className={cn("text-[11px]", active ? "text-indigo-600/80" : "text-slate-600")}>{desc}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* Step 2: Cena a financování (merged from old steps 3 + 4) */
  const renderStep2 = () => (
    <div className="space-y-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Rozpočet</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={reamarLabelClass}>Ideální cena (Kč) <PrefBadge /></label>
          <input type="number" value={wizardExtras.budget?.ideal_price ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_price: e.target.value ? Number(e.target.value) : null } }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Např. 8 500 000" />
          {wizardExtras.budget?.ideal_price != null && <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(wizardExtras.budget.ideal_price)}</p>}
        </div>
        <div>
          <label className={reamarLabelClass}>Maximální cena (Kč) <FilterBadge /></label>
          <input type="number" value={profile?.budget_max ?? ""}
            onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), budget_max: e.target.value ? Number(e.target.value) : null }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Absolutní strop" />
          {profile?.budget_max != null && <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(profile.budget_max)}</p>}
        </div>
      </div>

      <div className="max-w-xs">
        <label className={reamarLabelClass}>Max. překročení ceny (%)</label>
        <input type="number" min={0} max={50} value={wizardExtras.budget?.max_price_tolerance_pct ?? ""}
          onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_price_tolerance_pct: e.target.value ? Number(e.target.value) : null } }))}
          className={cn("mt-1", reamarInputClass)} placeholder="Např. 10" />
        <p className="mt-1 text-[11px] text-slate-500">Jednotky nad max. cenou se vyřadí, ale do tolerance se ještě ukáží s nižším skóre.</p>
      </div>

      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ financování <CtxBadge /></p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FINANCING_TYPE_OPTIONS.map(({ key, label, desc }) => {
            const active = wizardExtras.financing_type === key;
            return (
              <button key={key} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, financing_type: active ? null : key }))}
                className={cn(
                  "flex flex-col items-start rounded-2xl border px-4 py-3 text-left transition-colors",
                  active ? "border-indigo-400 bg-white ring-2 ring-indigo-300/40 shadow-sm" : "border-slate-200/90 bg-slate-50/90 hover:border-slate-300 hover:bg-white"
                )}>
                <p className={cn("text-sm font-semibold", active ? "text-indigo-800" : "text-slate-900")}>{label}</p>
                <p className={cn("text-[11px]", active ? "text-indigo-600/80" : "text-slate-600")}>{desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={reamarLabelClass}>Max. platba při podpisu (%)</label>
          <input type="number" min={0} max={100} value={wizardExtras.budget?.max_payment_contract_pct ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_payment_contract_pct: e.target.value ? Number(e.target.value) : null } }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Např. 20" />
          <p className="mt-1 text-[11px] text-slate-500">Kolik % z ceny je klient ochotný zaplatit hned po podpisu SoSBK.</p>
        </div>
        <div>
          <label className={reamarLabelClass}>Max. platba během výstavby (%)</label>
          <input type="number" min={0} max={100} value={wizardExtras.budget?.max_payment_construction_pct ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_payment_construction_pct: e.target.value ? Number(e.target.value) : null } }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Např. 30" />
          <p className="mt-1 text-[11px] text-slate-500">Kolik % během výstavby před dokončením.</p>
        </div>
      </div>

      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Možnost postoupení smlouvy</p>
        <div className="flex flex-wrap gap-2">
          {([
            { key: "yes", label: "Ano, řeší" },
            { key: "irrelevant", label: "Neřeší" },
          ] as const).map(({ key, label }) => {
            const active = wizardExtras.assignment_important === key;
            return (
              <button key={key} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, assignment_important: active ? null : key }))}
                className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* Step 3: Lokalita (same as old step 5) */
  const renderStep3 = () => (
    <div className="space-y-6">
      {/* Location method selection */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { key: "method_polygon", title: "Oblast na mapě", desc: "Hlavní hard filtr lokality — co je mimo polygon, vypadne z doporučení." },
          { key: "method_commute", title: "Dojíždění do práce / školy", desc: "Doplňkový hard filtr — must-have body musí být v časovém limitu." },
          { key: "method_admin", title: "Preferované části jako striktní požadavek", desc: "Volitelný opt-in. Bez zaškrtnutí jsou preferované oblasti jen soft ranking uvnitř polygonu." },
        ].map(({ key, title, desc }) => {
          const checked = (wizardExtras.location as any)?.[key] ?? false;
          return (
            <button key={key} type="button"
              onClick={() => setWizardExtras((prev) => ({ ...prev, location: { ...(prev.location ?? {}), [key]: !checked } }))}
              className={cn(
                "flex h-full min-h-[148px] flex-col items-start rounded-3xl border px-5 py-4 text-left transition-colors",
                checked ? "border-indigo-400 bg-white ring-2 ring-indigo-300/40 shadow-sm" : "border-slate-200/90 bg-slate-50/90 hover:border-slate-300 hover:bg-white"
              )}>
              <div className="mb-1 flex w-full items-center justify-between gap-2">
                <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px]",
                  checked ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 bg-white text-slate-500")}>
                  {checked ? "✓" : ""}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-70">Metoda lokality</span>
              </div>
              <div className="space-y-0.5">
                <p className={cn("text-sm font-semibold", checked ? "text-indigo-800" : "text-slate-900")}>{title}</p>
                <p className={cn("text-xs", checked ? "text-indigo-600/80" : "text-slate-600")}>{desc}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">
        Polygon je hlavní hard filtr lokality. Preferované oblasti uvnitř polygonu
        ovlivňují řazení a stávají se striktním požadavkem jen s výslovným opt-in.
      </p>

      {/* Market info bar */}
      <div className="grid gap-3 rounded-2xl bg-slate-50/70 p-3 text-[11px] text-slate-700 md:grid-cols-3">
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">Zvolené metody lokality <FilterBadge /></p>
          <ul className="list-disc pl-4">
            {(wizardExtras.location?.method_polygon ?? true) && <li>Polygon v mapě</li>}
            {wizardExtras.location?.method_commute && <li>Dojíždění na klíčová místa</li>}
            {wizardExtras.location?.method_admin && <li>Preferované oblasti jako striktní požadavek</li>}
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">Trh v oblasti</p>
          {areaMarket ? (
            <>
              <p>{areaMarket.projects_count} projektů · {areaMarket.active_units_count} aktivních jednotek</p>
              <p>{areaMarket.matching_units_count} jednotek odpovídá aktuálnímu profilu klienta</p>
            </>
          ) : (
            <p className="text-slate-500">Po uložení profilu a zakreslení oblasti se zobrazí přehled trhu.</p>
          )}
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">Tip</p>
          <p>Ptejte se klienta, které oblasti jsou „určitě ano" a kam se nechce stěhovat.</p>
        </div>
      </div>

      {/* Unified map: polygon + commute */}
      {((wizardExtras.location?.method_polygon ?? true) || wizardExtras.location?.method_commute) && (() => {
        const bothActive = !!((wizardExtras.location?.method_polygon ?? true) && wizardExtras.location?.method_commute);
        const effectiveMapMode = bothActive ? mapMode : wizardExtras.location?.method_commute ? "commute" : "polygon";
        const commutePoints = (wizardExtras.commute?.points ?? []) as CommutePoint[];
        const canAddMore = commutePoints.length < 4;
        return (
          <ReamarSubtleCard className="space-y-3 p-3">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {effectiveMapMode === "commute" ? "Mapa — body dojíždění" : "Polygon na mapě"}
              </h5>
              {bothActive && (
                <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[11px]">
                  <button type="button"
                    onClick={() => { setMapMode("polygon"); setNextCommuteLabel(""); }}
                    className={cn("px-2.5 py-1 transition-colors",
                      mapMode === "polygon" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                    Polygon
                  </button>
                  <button type="button"
                    onClick={() => setMapMode("commute")}
                    className={cn("border-l border-slate-200 px-2.5 py-1 transition-colors",
                      mapMode === "commute" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                    Dojezdové body
                  </button>
                </div>
              )}
            </div>

            {effectiveMapMode === "polygon" && (
              <p className="text-xs text-slate-600">
                Klikáním do mapy zakreslíte oblasti, kde si klient dokáže bydlení reálně představit.
              </p>
            )}

            {effectiveMapMode === "commute" && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-500">
                  Vyberte typ místa a klikněte do mapy, nebo zadejte adresu v editoru níže.
                </p>
                {canAddMore ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {["Práce", "Škola", "Školka", "Vlastní"].map((preset) => (
                      <button key={preset} type="button"
                        onClick={() => setNextCommuteLabel(nextCommuteLabel === preset ? "" : preset)}
                        className={cn(
                          "rounded-full border px-3 py-0.5 text-[11px] font-medium transition-colors",
                          nextCommuteLabel === preset
                            ? "border-violet-600 bg-violet-600 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                        )}>
                        {preset}
                      </button>
                    ))}
                    {nextCommuteLabel && (
                      <span className="self-center text-[11px] text-slate-400">→ klikněte do mapy</span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">4 body jsou maximum — odeberte bod v editoru níže.</p>
                )}
              </div>
            )}

            <ClientLocationMap
              areas={locationPolygons}
              activeAreaIndex={activeAreaIndex}
              projects={locationProjects}
              onChange={(next) => {
                setLocationPolygons(next);
                if (activeAreaIndex >= next.length) setActiveAreaIndex(Math.max(0, next.length - 1));
              }}
              onActiveAreaChange={setActiveAreaIndex}
              mapMode={effectiveMapMode}
              commutePoints={commutePoints}
              onCommuteClick={canAddMore ? (lat, lng) => {
                const label = nextCommuteLabel || "Vlastní";
                setWizardExtras((prev) => ({
                  ...prev,
                  commute: {
                    ...(prev.commute ?? {}),
                    points: [
                      ...(prev.commute?.points ?? []),
                      { id: `cp-${Date.now()}`, label, lat, lng, mode: "transit" as const, max_minutes: 30, priority: "prefer" as const },
                    ],
                  },
                }));
                setNextCommuteLabel("");
              } : undefined}
            />

            {effectiveMapMode === "polygon" && (
              <>
                <div className="flex items-center gap-2">
                  <AddressSearch
                    className="flex-1"
                    placeholder="Nakreslit okruh z adresy…"
                    onSelect={(result) => {
                      const R = 0.009;
                      const pts = Array.from({ length: 24 }, (_, i) => {
                        const angle = (i / 24) * 2 * Math.PI;
                        return {
                          lat: result.lat + R * Math.sin(angle),
                          lng: result.lng + (R / Math.cos((result.lat * Math.PI) / 180)) * Math.cos(angle),
                        };
                      });
                      setLocationPolygons((prev) => {
                        const next = [...prev, pts];
                        setActiveAreaIndex(next.length - 1);
                        return next;
                      });
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ReamarButton type="button" variant="subtle" size="sm" onClick={() => {
                      setLocationPolygons((prev) => { const next = [...prev, []]; setActiveAreaIndex(next.length - 1); return next; });
                    }}>
                      Přidat oblast
                    </ReamarButton>
                    {locationPolygons.length > 0 && (
                      <ReamarButton type="button" variant="ghost" size="sm" onClick={() => {
                        setLocationPolygons((prev) => {
                          if (!prev.length) return prev;
                          const next = prev.filter((_, idx) => idx !== activeAreaIndex);
                          if (!next.length) { setActiveAreaIndex(0); return []; }
                          setActiveAreaIndex(Math.min(activeAreaIndex, next.length - 1));
                          return next;
                        });
                      }}>
                        Odebrat oblast
                      </ReamarButton>
                    )}
                    {locationPolygons.some((p) => p.length > 0) && (
                      <ReamarButton type="button" variant="ghost" size="sm" onClick={() => { setLocationPolygons([]); setActiveAreaIndex(0); }}>
                        Smazat vše
                      </ReamarButton>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {locationPolygons.some((p) => p.length >= 3) && (
                      <span className="text-[11px] text-slate-500">
                        {projectsInsidePolygon}{" "}
                        {projectsInsidePolygon === 1 ? "projekt" : projectsInsidePolygon >= 2 && projectsInsidePolygon <= 4 ? "projekty" : "projektů"}{" "}
                        uvnitř oblasti
                      </span>
                    )}
                    {locationPolygons.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                        <span>Aktivní oblast:</span>
                        {locationPolygons.map((_, idx) => (
                          <button key={idx} type="button" onClick={() => setActiveAreaIndex(idx)}
                            className={cn("rounded-full px-2 py-0.5 text-[11px]",
                              idx === activeAreaIndex ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </ReamarSubtleCard>
        );
      })()}

      {/* Admin areas */}
      {wizardExtras.location?.method_admin && (
        <ReamarSubtleCard className="space-y-3 p-3">
          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Preferované části — striktní požadavek
          </h5>
          <p className="text-[10px] text-slate-500">
            Tato karta je aktivní proto, že je zapnutý opt-in. Seznam níže se aplikuje
            jako tvrdý filtr uvnitř polygonu.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={reamarLabelClass}>Preferované obvody / okresy</label>
              <input
                type="text"
                value={(() => {
                  const raw = wizardExtras.location?.administrative_area;
                  if (Array.isArray(raw)) return raw.join(", ");
                  return raw ?? "";
                })()}
                onChange={(e) => {
                  const next = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  setWizardExtras((prev) => ({
                    ...prev,
                    location: {
                      ...(prev.location ?? {}),
                      administrative_area: next.length ? next : null,
                    },
                  }));
                }}
                className={cn("mt-1 text-xs", reamarInputClass)}
                placeholder="Např. Praha 6, Praha-západ"
              />
            </div>
            <div>
              <label className={reamarLabelClass}>Region / kraj</label>
              <input type="text" value={wizardExtras.location?.administrative_region ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, location: { ...(prev.location ?? {}), administrative_region: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarInputClass)} placeholder="Např. Praha, Středočeský kraj" />
            </div>
          </div>
        </ReamarSubtleCard>
      )}

      {/* Commute points editor */}
      {wizardExtras.location?.method_commute && (
        <CommutePointsEditor
          points={(wizardExtras.commute?.points ?? []) as CommutePoint[]}
          onChange={(next) =>
            setWizardExtras((prev) => ({
              ...prev,
              commute: { ...(prev.commute ?? {}), points: next },
            }))
          }
          maxPoints={4}
        />
      )}
    </div>
  );

  /* Step 4: Dispozice a prostor (NEW) */
  const renderStep4 = () => (
    <div className="space-y-6">
      {/* Layout selection */}
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dispozice <FilterBadge /></p>
        <div className="flex flex-wrap gap-2">
          {LAYOUT_OPTIONS.map((opt) => {
            const checked = selectedLayouts.includes(opt.value);
            return (
              <button key={opt.value} type="button"
                onClick={() => setSelectedLayouts((prev) => checked ? prev.filter((v) => v !== opt.value) : Array.from(new Set([...prev, opt.value])))}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Unit area */}
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Velikost bytu</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={reamarLabelClass}>Ideální (m²) <PrefBadge /></label>
            <input type="number" value={wizardExtras.budget?.ideal_area ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_area: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 75" />
          </div>
          <div>
            <label className={reamarLabelClass}>Minimální (m²) <FilterBadge /></label>
            <input type="number" value={profile?.area_min ?? ""}
              onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), area_min: e.target.value ? Number(e.target.value) : null }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Absolutní minimum" />
          </div>
          <div>
            <label className={reamarLabelClass}>Max. odchylka (%)</label>
            <input type="number" min={0} max={50} value={wizardExtras.budget?.max_area_tolerance_pct ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_area_tolerance_pct: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 10" />
            <p className="mt-1 text-[11px] text-slate-500">Jednotky menší než minimum - odchylka se vyřadí. Čím větší byt, tím vyšší skóre.</p>
          </div>
        </div>
      </div>

      {/* Outdoor space */}
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Venkovní prostor <FilterBadge /></p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={reamarLabelClass}>Minimální venkovní prostor (m²)</label>
            <input type="number" value={wizardExtras.budget?.min_outdoor_area_m2 ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), min_outdoor_area_m2: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 5" />
          </div>
          <div>
            <label className={reamarLabelClass}>Max. odchylka (%)</label>
            <input type="number" min={0} max={50} value={wizardExtras.budget?.max_outdoor_tolerance_pct ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_outdoor_tolerance_pct: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 20" />
            <p className="mt-1 text-[11px] text-slate-500">Čím větší venkovní prostor, tím vyšší skóre (max do 50 m²).</p>
          </div>
        </div>
      </div>

      {/* Property type */}
      <div>
        <label className={reamarLabelClass}>Typ nemovitosti</label>
        <select value={profile?.property_type ?? "any"}
          onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), property_type: e.target.value }))}
          className={cn("mt-1", reamarSelectClass)}>
          <option value="any">Neřeším</option>
          <option value="apartment">Byt</option>
          <option value="house">Dům</option>
        </select>
      </div>

      {/* Floor preference */}
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Preferované patro <PrefBadge /></p>
        <div className="flex flex-wrap gap-2">
          {FLOOR_RULE_OPTIONS.map(({ value, label }) => {
            const active = (wizardExtras.outdoor?.floor_rule ?? "ignore") === value;
            return (
              <button key={value} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), floor_rule: value } }))}
                className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Při nesplnění podmínek se skóre bytu výrazně snižuje.</p>
      </div>
    </div>
  );

  /* Step 5: Okolí projektu (restructured — gate noise, gate walkability, no character/orientation) */
  const renderStep5 = () => (
    <div className="space-y-6">
      {/* Gate 1: Noise */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-medium text-slate-800">Řešíte rušnost (klid) v lokalitě projektu?</p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, skip_categories: { ...prev.skip_categories, surroundings: false } }))}
            className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              !(wizardExtras.skip_categories?.surroundings) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            Ano
          </button>
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, skip_categories: { ...prev.skip_categories, surroundings: true } }))}
            className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              wizardExtras.skip_categories?.surroundings ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            Ne, přeskočit
          </button>
        </div>
        {wizardExtras.skip_categories?.surroundings && (
          <p className="mt-2 text-xs text-slate-400">Váhy hluku a walkability budou 0 — přerozděli se do ostatních aspektů.</p>
        )}
      </div>

      {!wizardExtras.skip_categories?.surroundings && (
        <>
          {/* Noise sensitivity */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Hlučnost lokality <FilterBadge /><PrefBadge /></p>
            <p className="text-xs text-slate-600">
              Neřeším = žádné skóre. Citlivý/á = snížení skóre. Vyloučit = projekty do 200 m od zdroje se vyřadí.
            </p>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {NOISE_SOURCES.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm text-slate-700">{label}</span>
                  <PrefToggle hard value={(wizardExtras.noise as any)?.[key] ?? "ignore"}
                    onChange={(v) => setWizardExtras((prev) => ({ ...prev, noise: { ...(prev.noise ?? {}), [key]: v as Priority } }))}
                    preferLabel="Citlivý/á" mustLabel="Vyloučit" />
                </div>
              ))}
            </div>
          </div>

          {/* Walkability preferences */}
          <div className="space-y-4 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-xs font-semibold text-slate-900">Občanská vybavenost v okolí <PrefBadge /></h5>
              <div className="flex gap-1">
                {[
                  { label: "Rodina", prefs: { ...DEFAULT_PREFERENCES, playground: "high" as const, kindergarten: "high" as const, primary_school: "high" as const, park: "high" as const, supermarket: "high" as const, restaurant: "ignore" as const, cafe: "ignore" as const, fitness: "ignore" as const } },
                  { label: "Městský život", prefs: { ...DEFAULT_PREFERENCES, restaurant: "high" as const, cafe: "high" as const, metro: "high" as const, tram: "high" as const, bus: "high" as const, supermarket: "high" as const, playground: "ignore" as const, kindergarten: "ignore" as const, primary_school: "ignore" as const } },
                  { label: "Klid a zeleň", prefs: { ...DEFAULT_PREFERENCES, park: "high" as const, metro: "ignore" as const, tram: "ignore" as const, restaurant: "ignore" as const, cafe: "ignore" as const, fitness: "ignore" as const } },
                ].map(({ label, prefs }) => (
                  <button key={label} type="button" onClick={() => setWalkPrefs(prefs)}
                    className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 hover:border-slate-500 hover:text-slate-900">
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <WalkabilityPreferencesGroup title="Služby a příroda"
              items={[{ key: "supermarket", label: "Supermarket" }, { key: "park", label: "Park" }, { key: "restaurant", label: "Restaurace" }, { key: "cafe", label: "Kavárna" }, { key: "fitness", label: "Fitness" }]}
              prefs={walkPrefs} onChange={setWalkPrefs} />
            <WalkabilityPreferencesGroup title="Vzdělávání a rodina"
              items={[{ key: "kindergarten", label: "Školka" }, { key: "primary_school", label: "ZŠ" }]}
              prefs={walkPrefs} onChange={setWalkPrefs} />
            <WalkabilityPreferencesGroup title="Doprava"
              items={[{ key: "metro", label: "Metro" }, { key: "tram", label: "Tramvaj" }, { key: "bus", label: "Bus" }]}
              prefs={walkPrefs} onChange={setWalkPrefs} />
          </div>
        </>
      )}
    </div>
  );

  /* Step 6: Standardy (specific pickers per document) */
  const renderStep6 = () => (
    <div className="space-y-6">
      {/* Gate question */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-medium text-slate-800">Zajímají klienta standardy a chce si nastavit preference?</p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, skip_categories: { ...prev.skip_categories, standards: false } }))}
            className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              !(wizardExtras.skip_categories?.standards) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            Ano, chci nastavit
          </button>
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, skip_categories: { ...prev.skip_categories, standards: true } }))}
            className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              wizardExtras.skip_categories?.standards ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            Ne, přeskočit
          </button>
        </div>
        {wizardExtras.skip_categories?.standards && (
          <p className="mt-2 text-xs text-slate-400">Váhy standardů budou 0 — přerozděli se do ostatních aspektů.</p>
        )}
      </div>

      {!wizardExtras.skip_categories?.standards && (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {/* Heating type */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">Vytápění</p>
              <select value={(wizardExtras.standards as any)?.heating_type ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), heating_type: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarSelectClass)}>
                <option value="">Vyberte typ…</option>
                {HEATING_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            {(wizardExtras.standards as any)?.heating_type && (
              <IntensityPicker value={(wizardExtras.standards as any)?.floor_heating ?? "prefer"}
                onChange={(v) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), floor_heating: v as Priority } }))} />
            )}
          </div>

          {/* Heating source */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">Zdroj vytápění</p>
              <select value={(wizardExtras.standards as any)?.heating_source ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), heating_source: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarSelectClass)}>
                <option value="">Vyberte zdroj…</option>
                {HEATING_SOURCE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Rekuperace */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-slate-700">Rekuperace</p>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {(["yes", "no"] as const).map((v) => (
                  <button key={v} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), recuperation: v === "yes" ? "prefer" : "ignore" } }))}
                    className={cn("rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                      ((wizardExtras.standards as any)?.recuperation === "prefer" && v === "yes") || ((wizardExtras.standards as any)?.recuperation !== "prefer" && v === "no")
                        ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>
                    {v === "yes" ? "Ano" : "Ne"}
                  </button>
                ))}
              </div>
              {(wizardExtras.standards as any)?.recuperation === "prefer" && (
                <IntensityPicker value={(wizardExtras.standards as any)?.recuperation ?? "prefer"}
                  onChange={(v) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), recuperation: v as Priority } }))} />
              )}
            </div>
          </div>

          {/* Žaluzie */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm text-slate-700">Žaluzie</p>
              <p className="text-[11px] text-slate-500">Příprava se počítá jako ANO</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {(["yes", "no"] as const).map((v) => (
                  <button key={v} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), exterior_blinds: v === "yes" ? "prefer" : "ignore" } }))}
                    className={cn("rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                      ((wizardExtras.standards as any)?.exterior_blinds === "prefer" || (wizardExtras.standards as any)?.exterior_blinds === "must") && v === "yes"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : (wizardExtras.standards as any)?.exterior_blinds !== "prefer" && (wizardExtras.standards as any)?.exterior_blinds !== "must" && v === "no"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600")}>
                    {v === "yes" ? "Ano" : "Ne"}
                  </button>
                ))}
              </div>
              {((wizardExtras.standards as any)?.exterior_blinds === "prefer" || (wizardExtras.standards as any)?.exterior_blinds === "must") && (
                <IntensityPicker value={(wizardExtras.standards as any)?.exterior_blinds ?? "prefer"}
                  onChange={(v) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), exterior_blinds: v as Priority } }))} />
              )}
            </div>
          </div>

          {/* Klimatizace */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">Klimatizace</p>
              <select value={(wizardExtras.standards as any)?.air_conditioning ?? "ignore"}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), air_conditioning: e.target.value === "ignore" ? "ignore" : "prefer" } }))}
                className={cn("mt-1 text-xs", reamarSelectClass)}>
                <option value="ignore">Neřeším</option>
                {AC_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            {(wizardExtras.standards as any)?.air_conditioning !== "ignore" && (wizardExtras.standards as any)?.air_conditioning != null && (
              <IntensityPicker value={(wizardExtras.standards as any)?.air_conditioning ?? "prefer"}
                onChange={(v) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), air_conditioning: v as Priority } }))} />
            )}
          </div>

          {/* Podlaha */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">Podlaha</p>
              <select value={(wizardExtras.standards as any)?.partitions ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), partitions: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarSelectClass)}>
                <option value="">Neřeším</option>
                {FLOORING_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Výška stropu */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">Výška stropu</p>
              <select value={(wizardExtras.standards as any)?.window_type ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), window_type: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarSelectClass)}>
                <option value="">Neřeším</option>
                {CEILING_HEIGHT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Okna */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">Okna</p>
              <select value={(wizardExtras.standards as any)?.window_material ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), window_material: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarSelectClass)}>
                <option value="">Neřeším</option>
                {WINDOW_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  /* Step 7: Vybavení projektu (NEW) */
  const renderStep7 = () => (
    <div className="space-y-6">
      {/* Gate question */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-medium text-slate-800">Zajímá klienta něco z vybavení projektu?</p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, skip_categories: { ...prev.skip_categories, amenities: false } }))}
            className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              !(wizardExtras.skip_categories?.amenities) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            Ano
          </button>
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, skip_categories: { ...prev.skip_categories, amenities: true } }))}
            className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              wizardExtras.skip_categories?.amenities ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            Ne, přeskočit
          </button>
        </div>
        {wizardExtras.skip_categories?.amenities && (
          <p className="mt-2 text-xs text-slate-400">Váhy vybavení projektu budou 0 — přerozděli se do ostatních aspektů.</p>
        )}
      </div>

      {!wizardExtras.skip_categories?.amenities && (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {PROJECT_AMENITY_ITEMS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm text-slate-700">{label}</span>
              <AmenityPicker
                value={(wizardExtras.project_amenities as any)?.[key] ?? "ignore"}
                onChange={(v) => setWizardExtras((prev) => ({
                  ...prev,
                  project_amenities: { ...(prev.project_amenities ?? {}), [key]: v },
                }))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* Step 8: Dokončení (NEW) */
  const renderStep8 = () => (
    <div className="space-y-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Termín nastěhování</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={reamarLabelClass}>Nejdřívější nastěhování <CtxBadge /></label>
          <input type="date" value={wizardExtras.earliest_move_in ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, earliest_move_in: e.target.value || null }))}
            className={cn("mt-1", reamarInputClass)} />
          <p className="mt-1 text-[11px] text-slate-500">Kdy nejdříve by se klient stěhoval.</p>
        </div>
        <div>
          <label className={reamarLabelClass}>Nejzazší datum nastěhování <FilterBadge /></label>
          <input type="date" value={wizardExtras.latest_move_in ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, latest_move_in: e.target.value || null }))}
            className={cn("mt-1", reamarInputClass)} />
          <p className="mt-1 text-[11px] text-slate-500">Automatická tolerance ± 3 měsíce. Funguje jako hard filter.</p>
        </div>
      </div>

    </div>
  );

  /* Step 9: Novostavba vs rekonstrukce (NEW separate step) */
  const renderStepNovo = () => (
    <div className="space-y-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Novostavba vs. rekonstrukce <FilterBadge /><PrefBadge /></p>
      <div className="flex flex-wrap gap-2">
        {([
          { value: "any", label: "Neřeším" },
          { value: "prefer_new", label: "Spíše novostavba" },
          { value: "only_new", label: "Jen novostavba" },
          { value: "prefer_renovation", label: "Spíše rekonstrukce" },
          { value: "only_renovation", label: "Jen rekonstrukce" },
        ] as const).map(({ value, label }) => {
          const active = (wizardExtras.renovation_preference ?? "any") === value;
          return (
            <button key={value} type="button"
              onClick={() => setWizardExtras((prev) => ({ ...prev, renovation_preference: value }))}
              className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Standard dokončení <PrefBadge /></p>
      <div className="flex flex-wrap gap-2">
        {COMPLETION_STANDARD_OPTIONS.map(({ value, label }) => {
          const active = (wizardExtras as any).completion_standard === value;
          return (
            <button key={value} type="button"
              onClick={() => setWizardExtras((prev) => ({ ...prev, completion_standard: value }))}
              className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">Shell &amp; Core = holé stěny, White Wall = bílé stěny bez podlah, Fit Out = kompletní dokončení.</p>
    </div>
  );

  /* Step 10: Shrnutí */
  const renderStep9 = () => (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {profile?.budget_max != null && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Max. cena</p>
            <p className="mt-1 text-base font-bold text-slate-900">{formatCurrencyCzk(profile.budget_max)}</p>
            {wizardExtras.budget?.max_price_tolerance_pct != null && (
              <p className="text-[10px] text-slate-500">tolerance +{wizardExtras.budget.max_price_tolerance_pct}%</p>
            )}
          </div>
        )}
        {(profile?.area_min != null || profile?.area_max != null) && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Plocha</p>
            <p className="mt-1 text-base font-bold text-slate-900">
              {profile?.area_min != null ? `${profile.area_min}` : "—"}&thinsp;–&thinsp;{profile?.area_max != null ? `${profile.area_max} m²` : "bez max."}
            </p>
            {wizardExtras.budget?.max_area_tolerance_pct != null && (
              <p className="text-[10px] text-slate-500">tolerance -{wizardExtras.budget.max_area_tolerance_pct}%</p>
            )}
          </div>
        )}
        {selectedLayouts.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Dispozice</p>
            <p className="mt-1 text-base font-bold text-slate-900">{selectedLayouts.join(", ")}</p>
          </div>
        )}
        {recs.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Doporučení</p>
            <p className="mt-1 text-base font-bold text-slate-900">{recs.length} jednotek</p>
          </div>
        )}
      </div>

      {/* Skipped categories */}
      {(wizardExtras.skip_categories?.standards || wizardExtras.skip_categories?.amenities || wizardExtras.skip_categories?.surroundings) && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Přeskočené kategorie</p>
          <div className="flex flex-wrap gap-2">
            {wizardExtras.skip_categories?.standards && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-700">Standardy</span>}
            {wizardExtras.skip_categories?.amenities && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-700">Vybavení projektu</span>}
            {wizardExtras.skip_categories?.surroundings && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-700">Okolí projektu</span>}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Váhy těchto kategorií jsou 0 a přerozděly se do ostatních aspektů.</p>
        </div>
      )}

      {/* Must-haves */}
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Musí být</p>
        {mustHaveSummary.length === 0 ? (
          <p className="text-xs text-emerald-600/60">Žádné pevné podmínky.</p>
        ) : (
          <ul className="space-y-1">
            {mustHaveSummary.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-emerald-900">
                <span className="mt-px shrink-0 text-emerald-500">✓</span>{item}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preferences */}
      <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-violet-700">Preferované</p>
        {preferSummary.length === 0 ? (
          <p className="text-xs text-violet-600/60">Žádné preference.</p>
        ) : (
          <ul className="space-y-1">
            {preferSummary.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-violet-900">
                <span className="mt-px shrink-0 text-violet-400">·</span>{item}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dokončení */}
      {(wizardExtras.earliest_move_in || wizardExtras.latest_move_in || (wizardExtras.renovation_preference && wizardExtras.renovation_preference !== "any")) && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dokončení</p>
          <div className="space-y-1 text-xs text-slate-700">
            {wizardExtras.earliest_move_in && <p>Nejdříve: {wizardExtras.earliest_move_in}</p>}
            {wizardExtras.latest_move_in && <p>Nejpozději: {wizardExtras.latest_move_in}</p>}
            {wizardExtras.renovation_preference && wizardExtras.renovation_preference !== "any" && (
              <p>{({ prefer_new: "Spíše novostavba", only_new: "Jen novostavba", prefer_renovation: "Spíše rekonstrukce", only_renovation: "Jen rekonstrukce" } as Record<string, string>)[wizardExtras.renovation_preference]}</p>
            )}
          </div>
        </div>
      )}

      {/* Market simulation */}
      {profile?.budget_max != null && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Simulace trhu — co kdyby?</p>
          <div className="space-y-3">
            {[5, 10, 20].map((pct) => {
              const simBudget = Math.round((profile.budget_max ?? 0) * (1 + pct / 100));
              return (
                <button key={pct} type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                  onClick={async () => {
                    if (!token || !clientId) return;
                    const r = await fetch(`${API_BASE}/clients/${clientId}/market-simulate?budget_max=${simBudget}`,
                      { headers: { Authorization: `Bearer ${token}` } });
                    if (r.ok) {
                      const d = await r.json();
                      alert(`S rozpočtem ${formatCurrencyCzk(simBudget)} (+${pct}%) by matchovalo ${d.matching_units} jednotek.`);
                    }
                  }}>
                  <span className="text-xs text-slate-600">Rozpočet +{pct}% → {formatCurrencyCzk(simBudget)}</span>
                  <span className="text-xs text-indigo-600">Spočítat →</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-700">
        Klikněte na <strong>Přepočítat doporučení →</strong> níže pro vygenerování výsledků dle aktuálního zadání.
      </div>
    </div>
  );

  /* ── Quick Edit view ── */

  const renderQuickEdit = () => (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">

        {/* ─── FILTRY ─── */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Filtry
            <span className="font-normal normal-case tracking-normal text-[10px] text-slate-400">vylučují jednotky</span>
          </p>

          {/* Cena */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Cena <FilterBadge /></p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={reamarLabelClass}>Max. cena (Kč)</label>
                <input type="number" value={profile?.budget_max ?? ""}
                  onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), budget_max: e.target.value ? Number(e.target.value) : null }))}
                  className={cn("mt-1", reamarInputClass)} placeholder="Strop" />
                {profile?.budget_max != null && <p className="mt-0.5 text-[10px] text-slate-500">{formatCurrencyCzk(profile.budget_max)}</p>}
              </div>
              <div>
                <label className={reamarLabelClass}>Tolerance +%</label>
                <input type="number" value={wizardExtras.budget?.max_price_tolerance_pct ?? ""}
                  onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_price_tolerance_pct: e.target.value ? Number(e.target.value) : null } }))}
                  className={cn("mt-1", reamarInputClass)} placeholder="Např. 10" />
              </div>
            </div>
          </div>

          {/* Plocha */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Plocha <FilterBadge /></p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={reamarLabelClass}>Min. plocha (m²)</label>
                <input type="number" value={profile?.area_min ?? ""}
                  onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), area_min: e.target.value ? Number(e.target.value) : null }))}
                  className={cn("mt-1", reamarInputClass)} placeholder="Min." />
              </div>
              <div>
                <label className={reamarLabelClass}>Tolerance -%</label>
                <input type="number" value={wizardExtras.budget?.max_area_tolerance_pct ?? ""}
                  onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_area_tolerance_pct: e.target.value ? Number(e.target.value) : null } }))}
                  className={cn("mt-1", reamarInputClass)} placeholder="Např. 10" />
              </div>
            </div>
          </div>

          {/* Dispozice */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dispozice <FilterBadge /></p>
            <div className="flex flex-wrap gap-1.5">
              {LAYOUT_OPTIONS.map((opt) => {
                const checked = selectedLayouts.includes(opt.value);
                return (
                  <button key={opt.value} type="button"
                    onClick={() => setSelectedLayouts((prev) => checked ? prev.filter((v) => v !== opt.value) : Array.from(new Set([...prev, opt.value])))}
                    className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Venkovní plocha */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={reamarLabelClass}>Min. venkovní plocha (m²) <FilterBadge /></label>
            <input type="number" value={wizardExtras.budget?.min_outdoor_area_m2 ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), min_outdoor_area_m2: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 5" />
          </div>

          {/* Nejzazší nastěhování */}
          <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
            <label className={reamarLabelClass}>Nejzazší nastěhování <FilterBadge /></label>
            <input type="date" value={wizardExtras.latest_move_in ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, latest_move_in: e.target.value || null }))}
              className={cn("mt-1", reamarInputClass)} />
            <p className="text-[10px] text-slate-400">Tolerance ± 3 měsíce — hard filter</p>
          </div>

          {/* Lokalita */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Lokalita <FilterBadge /></p>
            <div className="space-y-0.5 text-xs text-slate-600">
              {wizardExtras.location?.method_polygon && (
                <p>Polygon {locationPolygons.some((p) => p.length >= 3) ? `· ${projectsInsidePolygon} projektů` : "· není zakreslen"}</p>
              )}
              {wizardExtras.location?.method_commute && <p>Dojíždění</p>}
              {(() => {
                const raw = wizardExtras.location?.administrative_area;
                const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
                if (!list.length) return null;
                const hard = !!wizardExtras.location?.method_admin;
                return (
                  <p>
                    Preferované části{hard ? " (striktní)" : " (soft)"}: {list.join(", ")}
                  </p>
                );
              })()}
              {!wizardExtras.location?.method_polygon && !wizardExtras.location?.method_commute && !wizardExtras.location?.method_admin && (
                <p className="text-slate-400">Žádná metoda lokality není nastavena.</p>
              )}
            </div>
            <button type="button"
              onClick={openFullscreenWizard}
              className="text-xs text-indigo-600 hover:underline">
              Upravit lokalitu / polygon →
            </button>
          </div>

          {/* Commute points */}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Dojíždění <FilterBadge /></p>
            <CommutePointsEditor
              points={(wizardExtras.commute?.points ?? []) as CommutePoint[]}
              onChange={(next) =>
                setWizardExtras((prev) => ({
                  ...prev,
                  commute: { ...(prev.commute ?? {}), points: next },
                }))
              }
              maxPoints={4}
            />
          </div>
        </div>

        {/* ─── PREFERENCE ─── */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-violet-700">
            <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
            Preference
            <span className="font-normal normal-case tracking-normal text-[10px] text-slate-400">ovlivňují pořadí</span>
          </p>

          {/* Ideální cena */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={reamarLabelClass}>Ideální cena (Kč) <PrefBadge /></label>
            <input type="number" value={wizardExtras.budget?.ideal_price ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_price: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 8 500 000" />
            {wizardExtras.budget?.ideal_price != null && <p className="mt-0.5 text-[10px] text-slate-500">{formatCurrencyCzk(wizardExtras.budget.ideal_price)}</p>}
          </div>

          {/* Ideální plocha */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={reamarLabelClass}>Ideální plocha (m²) <PrefBadge /></label>
            <input type="number" value={wizardExtras.budget?.ideal_area ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_area: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 75" />
          </div>

          {/* Preferované patro */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Preferované patro <PrefBadge /></p>
            <div className="flex flex-wrap gap-1.5">
              {FLOOR_RULE_OPTIONS.map(({ value, label }) => {
                const active = (wizardExtras.outdoor?.floor_rule ?? "ignore") === value;
                return (
                  <button key={value} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), floor_rule: value } }))}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Novostavba vs rekonstrukce */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Novostavba <PrefBadge /><FilterBadge /></p>
            <div className="flex flex-wrap gap-1.5">
              {([
                { value: "any", label: "Neřeším" },
                { value: "prefer_new", label: "Spíše nová" },
                { value: "only_new", label: "Jen nová" },
                { value: "prefer_renovation", label: "Spíše rekonstrukce" },
                { value: "only_renovation", label: "Jen rekonstrukce" },
              ] as const).map(({ value, label }) => {
                const active = (wizardExtras.renovation_preference ?? "any") === value;
                return (
                  <button key={value} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, renovation_preference: value }))}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hlučnost */}
          <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Hlučnost <FilterBadge /><PrefBadge /></p>
            {NOISE_SOURCES.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs text-slate-700">{label}</span>
                <PrefToggle hard value={(wizardExtras.noise as any)?.[key] ?? "ignore"}
                  onChange={(v) => setWizardExtras((prev) => ({ ...prev, noise: { ...(prev.noise ?? {}), [key]: v as Priority } }))}
                  preferLabel="Citlivý/á" mustLabel="Vyloučit" />
              </div>
            ))}
          </div>

          {/* Klíčové standardy */}
          <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Standardy <PrefBadge /><FilterBadge /></p>
            {([
              { key: "parking",        label: "Parkování" },
              { key: "recuperation",   label: "Rekuperace" },
              { key: "air_conditioning", label: "Klimatizace" },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-xs text-slate-700">{label}</span>
                <IntensityPicker
                  value={(wizardExtras.standards as any)?.[key] ?? "ignore"}
                  onChange={(v) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), [key]: v as Priority } }))}
                />
              </div>
            ))}
          </div>

          {/* Must-haves summary */}
          {mustHaveSummary.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Musí být</p>
              <ul className="space-y-0.5">
                {mustHaveSummary.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 text-xs text-emerald-900">
                    <span className="mt-px text-emerald-500">✓</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preference summary */}
          {preferSummary.length > 0 && (
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-violet-700">Preferované</p>
              <ul className="space-y-0.5">
                {preferSummary.map((item, idx) => (
                  <li key={idx} className="text-xs text-violet-900">· {item}</li>
                ))}
              </ul>
            </div>
          )}

          <button type="button"
            onClick={openFullscreenWizard}
            className="text-xs text-indigo-600 hover:underline">
            Upravit standardy a vybavení →
          </button>
        </div>

        {/* ─── KONTEXT ─── */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
            Kontext klienta
            <span className="font-normal normal-case tracking-normal text-[10px] text-slate-400">metadata</span>
          </p>

          {/* Typ klienta */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ klienta <CtxBadge /></p>
            <div className="grid grid-cols-2 gap-1.5">
              {CLIENT_TYPE_CARDS.map(({ key, label, icon }) => {
                const active = wizardExtras.client_type === key;
                return (
                  <button key={key} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, client_type: active ? null : key }))}
                    className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                      active ? "border-indigo-400 bg-white text-indigo-800 ring-2 ring-indigo-300/40" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white")}>
                    <span>{icon}</span>{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Účel nákupu */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Účel nákupu <CtxBadge /></p>
            <div className="flex gap-2">
              {([
                { key: "own_use", label: "Vlastní bydlení" },
                { key: "investment", label: "Investice" },
              ] as const).map(({ key, label }) => {
                const active = profile?.purchase_purpose === key;
                return (
                  <button key={key} type="button"
                    onClick={() => setProfile((prev) => ({ ...(prev ?? {}), purchase_purpose: key }))}
                    className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Financování */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Financování <CtxBadge /></p>
            <div className="flex flex-wrap gap-1.5">
              {FINANCING_TYPE_OPTIONS.map(({ key, label }) => {
                const active = wizardExtras.financing_type === key;
                return (
                  <button key={key} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, financing_type: active ? null : key }))}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nejdřívější nastěhování */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={reamarLabelClass}>Nejdřívější nastěhování <CtxBadge /></label>
            <input type="date" value={wizardExtras.earliest_move_in ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, earliest_move_in: e.target.value || null }))}
              className={cn("mt-1", reamarInputClass)} />
          </div>

          {/* Doporučení count */}
          {recs.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Doporučení</p>
              <p className="mt-1 text-base font-bold text-slate-900">{recs.length} jednotek</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Edit footer */}
      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <span className={cn("text-[11px] transition-opacity duration-300",
          autoSaveStatus === "saving" ? "text-slate-400 opacity-100" :
          autoSaveStatus === "saved" ? "text-emerald-600 opacity-100" :
          autoSaveStatus === "error" ? "text-rose-500 opacity-100" : "opacity-0")}>
          {autoSaveStatus === "saving" && "Ukládám…"}
          {autoSaveStatus === "saved" && "✓ Uloženo"}
          {autoSaveStatus === "error" && "Chyba ukládání"}
        </span>
        <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>
          {recomputing ? "Přepočítávám…" : "Přepočítat doporučení →"}
        </ReamarButton>
      </div>
    </div>
  );

  /* ── Step map ── */

  const stepRenderers: Record<number, () => React.JSX.Element> = {
    1: renderStep1,          // Klient
    2: renderStep2,          // Cena a financování
    3: renderStep3,          // Lokalita
    4: renderStep5,          // Okolí projektu
    5: renderStep6,          // Standardy
    6: renderStep7,          // Vybavení projektu
    7: renderStep4,          // Dispozice a prostor
    8: renderStep8,          // Dokončení
    9: renderStepNovo,       // Novostavba vs rekonstrukce
    10: renderStep9,         // Shrnutí
  };

  /* ── Render ── */

  return (
    <div className="space-y-5">
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
                <ReamarButton type="button" variant="ghost" size="sm" onClick={() => router.push(`/clients/${clientId}/present`)}>
                  Schůzka →
                </ReamarButton>
                <ReamarButton type="button" variant="ghost" size="sm" onClick={() => window.open(`/clients/${clientId}/report`, "_blank")}>
                  PDF
                </ReamarButton>
                <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>
                  {recomputing ? "Přepočítávám…" : "Přepočítat"}
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
            autoSaveStatus={autoSaveStatus}
            recomputing={recomputing}
            handleRecompute={handleRecompute}
            mustHaveSummary={mustHaveSummary}
            preferSummary={preferSummary}
            onSwitchToWizard={openFullscreenWizard}
          />
          <div className="mt-4 flex items-center justify-end">
            <span className={cn("text-[11px] transition-opacity duration-300",
              autoSaveStatus === "saving" ? "text-slate-400 opacity-100" :
              autoSaveStatus === "saved" ? "text-emerald-600 opacity-100" :
              autoSaveStatus === "error" ? "text-rose-500 opacity-100" : "opacity-0")}>
              {autoSaveStatus === "saving" && "Ukládám…"}
              {autoSaveStatus === "saved" && "✓ Uloženo"}
              {autoSaveStatus === "error" && "Chyba ukládání"}
            </span>
          </div>
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

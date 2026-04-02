"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";

import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import { API_BASE } from "@/lib/api";
import {
  DEFAULT_PREFERENCES,
} from "@/lib/walkabilityPreferences";
import type { Priority } from "@/lib/caseTypes";
import { PrefToggle } from "@/components/case/PrefToggle";
import { ClientLocationMap } from "@/components/ClientLocationMap";
import { AddressSearch } from "@/components/AddressSearch";
import { WalkabilityPreferencesGroup } from "@/components/WalkabilityPreferencesGroup";
import { WalkabilityPreferencesDrawer } from "@/components/WalkabilityPreferencesDrawer";
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

const TOTAL_WIZARD_STEPS = 9;

const STEP_LABELS: Record<number, string> = {
  1: "Klient",
  2: "Kdy",
  3: "Rozpočet",
  4: "Financování",
  5: "Lokalita",
  6: "Standardy",
  7: "Lifestyle",
  8: "Trade-offs",
  9: "Shrnutí",
};

const CLIENT_TYPE_CARDS = [
  { key: "family", label: "Rodina", icon: "👨‍👩‍👧‍👦", desc: "Rodina s dětmi nebo plánování rodiny" },
  { key: "couple", label: "Pár", icon: "💑", desc: "Partnerský pár bez dětí" },
  { key: "single", label: "Single", icon: "🧑", desc: "Jeden člověk" },
  { key: "downsizing", label: "Downsizing", icon: "🏡", desc: "Zmenšení, stěhování do menšího" },
] as const;

const PURCHASE_TIMELINE_OPTIONS = [
  { key: "now", label: "Hned" },
  { key: "3m", label: "Do 3 měsíců" },
  { key: "6m", label: "Do 6 měsíců" },
  { key: "1y", label: "Do 1 roku" },
  { key: "2y+", label: "2 roky+" },
  { key: "mapping", label: "Jen mapují" },
] as const;

const MOVE_IN_TIMELINE_OPTIONS = [
  { key: "asap", label: "Co nejdřív" },
  { key: "by_date", label: "Do konkrétního data" },
  { key: "flexible", label: "Flexibilní" },
] as const;

const FINANCING_TYPE_OPTIONS = [
  { key: "cash", label: "Hotovost", desc: "Platba celé částky z vlastních zdrojů" },
  { key: "mortgage", label: "Hypotéka", desc: "Financování hypotečním úvěrem" },
  { key: "combo", label: "Kombinace", desc: "Část hotově, část na hypotéku" },
  { key: "unknown", label: "Neví", desc: "Klient ještě nemá jasno" },
] as const;

const ASSIGNMENT_OPTIONS = [
  { key: "yes", label: "Ano, řeší" },
  { key: "no", label: "Ne" },
  { key: "irrelevant", label: "Neřeší" },
] as const;

type StandardChipDef = {
  key: string;
  label: string;
  section: "standards" | "outdoor";
};

const STANDARD_CHIPS: StandardChipDef[] = [
  { key: "parking", label: "Parkování", section: "standards" },
  { key: "outdoor_space", label: "Venkovní prostor", section: "outdoor" },
  { key: "rekuperace", label: "Rekuperace", section: "standards" },
  { key: "floor_heating", label: "Podlahové topení", section: "standards" },
  { key: "air_conditioning", label: "Klimatizace", section: "standards" },
  { key: "external_blinds", label: "Žaluzie", section: "standards" },
  { key: "cellar", label: "Sklep", section: "standards" },
  { key: "smart_home", label: "Smart home", section: "standards" },
  { key: "high_standard", label: "Vyšší kvalita standardu", section: "standards" },
  { key: "elevator", label: "Výtah", section: "standards" },
];

const ADVANCED_STANDARD_FIELDS = [
  { key: "window_type", label: "Typ oken", placeholder: "Např. trojsklo, dřevěná…" },
  { key: "heating_type", label: "Typ topení", placeholder: "Např. podlahové, radiátory…" },
  { key: "partitions", label: "Příčky", placeholder: "Např. zděné, sádrokarton…" },
  { key: "materials", label: "Materiály", placeholder: "Např. dřevo, vinyl…" },
];

const TRADE_OFF_ITEMS = [
  { key: "location", label: "Lokalita" },
  { key: "price", label: "Cena" },
  { key: "size", label: "Velikost" },
  { key: "standard", label: "Standard" },
  { key: "outdoor", label: "Venkovní prostor" },
];

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

/* ─── Main page ─── */

export default function BriefPage() {
  const {
    client,
    profile, setProfile,
    selectedLayouts, setSelectedLayouts,
    recs,
    loading,
    error,
    hydrated,
    token,
    profileSaving,
    recomputing,
    profileSavedMessage,
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
  const [showAdvancedStandards, setShowAdvancedStandards] = useState(false);

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

  /* ── Standard chip helpers ── */

  const getStdValue = (item: StandardChipDef): string => {
    if (item.section === "outdoor") return (wizardExtras.outdoor as any)?.[item.key] ?? "ignore";
    return (wizardExtras.standards as any)?.[item.key] ?? "ignore";
  };

  const setStdValue = (item: StandardChipDef, value: string) => {
    if (item.section === "outdoor") {
      setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), [item.key]: value as Priority } }));
    } else {
      setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), [item.key]: value as Priority } }));
    }
  };

  const isStdSelected = (item: StandardChipDef) => {
    const v = getStdValue(item);
    return v !== "ignore" && v !== undefined;
  };

  const toggleStdChip = (item: StandardChipDef) => {
    if (isStdSelected(item)) {
      setStdValue(item, "ignore");
    } else {
      setStdValue(item, "prefer");
    }
  };

  const selectedStandards = STANDARD_CHIPS.filter(isStdSelected);

  /* ── Trade-off ranking helpers ── */

  const ranking = wizardExtras.trade_off_ranking ?? [];

  const toggleRanking = (key: string) => {
    setWizardExtras((prev) => {
      const current = prev.trade_off_ranking ?? [];
      if (current.includes(key)) {
        return { ...prev, trade_off_ranking: current.filter((k) => k !== key) };
      }
      return { ...prev, trade_off_ranking: [...current, key] };
    });
  };

  /* ── Summary builders ── */

  const mustHaveSummary: string[] = [];
  const preferSummary: string[] = [];

  const standardLabels: Record<string, string> = {
    rekuperace: "Rekuperace", floor_heating: "Podlahové vytápění", external_blinds: "Předokenní žaluzie",
    air_conditioning: "Klimatizace", cellar: "Sklep", parking: "Parkování",
    smart_home: "Smart home", high_standard: "Vyšší standard", elevator: "Výtah",
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
    if (wizardExtras.outdoor.preferred_floor && wizardExtras.outdoor.preferred_floor !== "ignore") {
      const floorMap: Record<string, string> = { ground: "Přízemí", low: "Nižší patra", middle: "Střední patra", high: "Vyšší patra" };
      const label = floorMap[wizardExtras.outdoor.preferred_floor];
      if (label) preferSummary.push(`Patro: ${label}`);
    }
    if (wizardExtras.outdoor.ground_floor_sensitive === "must") mustHaveSummary.push("Vyhnout se přízemí");
    else if (wizardExtras.outdoor.ground_floor_sensitive === "prefer") preferSummary.push("Spíše ne přízemí");
    if (wizardExtras.outdoor.orientation) {
      const oLabels: Record<string, string> = { south: "Jih", west: "Západ", east: "Východ", north: "Sever" };
      Object.entries(oLabels).forEach(([key, label]) => {
        const value = (wizardExtras.outdoor!.orientation as any)[key] as Priority | undefined;
        if (value === "must") mustHaveSummary.push(`Orientace ${label}`);
        else if (value === "prefer") preferSummary.push(`Orientace ${label}`);
      });
    }
  }

  const noiseLabels: Record<string, string> = { quiet_area: "Klidná lokalita", main_road: "Hlavní silnice", tram: "Tramvaj", railway: "Železnice", airport: "Letiště" };
  if (wizardExtras.noise) {
    Object.entries(noiseLabels).forEach(([key, label]) => {
      const value = (wizardExtras.noise as any)[key] as Priority | undefined;
      if (value === "must") mustHaveSummary.push(`${label}: vyloučit`);
      else if (value === "prefer") preferSummary.push(`${label}: citlivý/á`);
    });
  }

  if (wizardExtras.character) {
    const { calm_vs_city, privacy_vs_services } = wizardExtras.character;
    if (calm_vs_city && calm_vs_city !== "ignore") preferSummary.push(calm_vs_city === "calm" ? "Spíše klid" : "Spíše město");
    if (privacy_vs_services && privacy_vs_services !== "ignore") preferSummary.push(privacy_vs_services === "privacy" ? "Více soukromí" : "Více služeb");
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
        </div>
      )}

      {/* Area */}
      {(profile?.area_min != null || wizardExtras.budget?.ideal_area != null) && (
        <div>
          <p className="font-semibold text-slate-700">Plocha</p>
          {wizardExtras.budget?.ideal_area != null && <p className="text-slate-600">Ideál: {formatAreaM2(wizardExtras.budget.ideal_area)}</p>}
          {profile?.area_min != null && <p className="text-slate-600">Min: {formatAreaM2(profile.area_min)}</p>}
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
            {wizardExtras.location?.method_admin && <li>Obvod/okres</li>}
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

      {/* Trade-offs */}
      {ranking.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700">Trade-offs (obětujeme dřív)</p>
          <ol className="list-decimal pl-4 text-slate-600">
            {ranking.map((key) => {
              const item = TRADE_OFF_ITEMS.find((t) => t.key === key);
              return <li key={key}>{item?.label ?? key}</li>;
            })}
          </ol>
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

  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Účel nákupu</p>
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
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ klienta</p>
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

  const renderStep2 = () => (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Kdy chtějí kupovat</p>
        <div className="flex flex-wrap gap-2">
          {PURCHASE_TIMELINE_OPTIONS.map(({ key, label }) => {
            const active = wizardExtras.purchase_timeline === key;
            return (
              <button key={key} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, purchase_timeline: active ? null : key }))}
                className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Kdy chtějí bydlet</p>
        <div className="flex flex-wrap gap-2">
          {MOVE_IN_TIMELINE_OPTIONS.map(({ key, label }) => {
            const active = wizardExtras.move_in_timeline === key;
            return (
              <button key={key} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, move_in_timeline: active ? null : key }))}
                className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={reamarLabelClass}>Datum dokončení / nastěhování do</label>
        <input type="date" value={wizardExtras.completion_date ?? ""}
          onChange={(e) => setWizardExtras((prev) => ({ ...prev, completion_date: e.target.value || null }))}
          className={cn("mt-1", reamarInputClass)} />
        <p className="mt-1 text-[11px] text-slate-500">Do kdy se chce klient nastěhovat.</p>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Rozpočet</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={reamarLabelClass}>Ideální cena (Kč)</label>
          <input type="number" value={wizardExtras.budget?.ideal_price ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_price: e.target.value ? Number(e.target.value) : null } }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Např. 8 500 000" />
          {wizardExtras.budget?.ideal_price != null && <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(wizardExtras.budget.ideal_price)}</p>}
        </div>
        <div>
          <label className={reamarLabelClass}>Maximální cena (Kč)</label>
          <input type="number" value={profile?.budget_max ?? ""}
            onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), budget_max: e.target.value ? Number(e.target.value) : null }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Absolutní strop" />
          {profile?.budget_max != null && <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(profile.budget_max)}</p>}
        </div>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Plocha</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={reamarLabelClass}>Ideální (m²)</label>
          <input type="number" value={wizardExtras.budget?.ideal_area ?? ""}
            onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_area: e.target.value ? Number(e.target.value) : null } }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Např. 75" />
        </div>
        <div>
          <label className={reamarLabelClass}>Minimální (m²)</label>
          <input type="number" value={profile?.area_min ?? ""}
            onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), area_min: e.target.value ? Number(e.target.value) : null }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Absolutní minimum" />
        </div>
        <div>
          <label className={reamarLabelClass}>Maximální (m²)</label>
          <input type="number" value={profile?.area_max ?? ""}
            onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), area_max: e.target.value ? Number(e.target.value) : null }))}
            className={cn("mt-1", reamarInputClass)} placeholder="Horní limit" />
        </div>
      </div>

      <div>
        <label className={reamarLabelClass}>Dispozice (více možností)</label>
        <div className="mt-2 flex flex-wrap gap-2">
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

      <div className="grid grid-cols-2 gap-3">
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
        <div>
          <label className={reamarLabelClass}>Novostavba vs. rekonstrukce</label>
          <div className="mt-2 flex flex-wrap gap-1.5">
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
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ financování</p>
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

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm text-slate-700">Preferovaný doplatek až při dokončení</p>
            <p className="text-[11px] text-slate-500">Klient chce zaplatit co největší část až po předání bytu.</p>
          </div>
          <button type="button"
            onClick={() => setWizardExtras((prev) => ({ ...prev, prefer_payment_on_completion: !prev.prefer_payment_on_completion }))}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              wizardExtras.prefer_payment_on_completion ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600"
            )}>
            {wizardExtras.prefer_payment_on_completion ? "Ano" : "Ne"}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Možnost postoupení smlouvy</p>
        <div className="flex flex-wrap gap-2">
          {ASSIGNMENT_OPTIONS.map(({ key, label }) => {
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
        <p className="mt-2 text-[11px] text-slate-500">Řeší klient možnost cese / postoupení smlouvy před kolaudací?</p>
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="space-y-6">
      {/* Location method selection */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { key: "method_polygon", title: "Polygon na mapě", desc: "Vymezíte přesnou oblast, kde klient opravdu chce bydlet." },
          { key: "method_commute", title: "Dojíždění do práce / školy", desc: "Lokalitu odvodíme podle dojezdových časů na klíčová místa." },
          { key: "method_admin", title: "Obvod / okres / kraj", desc: "Pracujete s administrativními celky a známými názvy oblastí." },
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
        Můžete kombinovat více metod najednou.
      </p>

      {/* Market info bar */}
      <div className="grid gap-3 rounded-2xl bg-slate-50/70 p-3 text-[11px] text-slate-700 md:grid-cols-3">
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">Zvolené metody lokality</p>
          <ul className="list-disc pl-4">
            {(wizardExtras.location?.method_polygon ?? true) && <li>Polygon v mapě</li>}
            {wizardExtras.location?.method_commute && <li>Dojíždění na klíčová místa</li>}
            {wizardExtras.location?.method_admin && <li>Obvody / okresy / kraje</li>}
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

      {/* Polygon tool */}
      {(wizardExtras.location?.method_polygon ?? true) && (
        <ReamarSubtleCard className="space-y-3 p-3">
          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Polygon na mapě</h5>
          <p className="text-xs text-slate-600">
            Klikáním do mapy zakreslíte oblasti, kde si klient dokáže bydlení reálně představit.
          </p>
          <ClientLocationMap
            areas={locationPolygons}
            activeAreaIndex={activeAreaIndex}
            projects={locationProjects}
            onChange={(next) => {
              setLocationPolygons(next);
              if (activeAreaIndex >= next.length) setActiveAreaIndex(Math.max(0, next.length - 1));
            }}
            onActiveAreaChange={setActiveAreaIndex}
          />
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
        </ReamarSubtleCard>
      )}

      {/* Admin areas */}
      {wizardExtras.location?.method_admin && (
        <ReamarSubtleCard className="space-y-3 p-3">
          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Obvod / okres / kraj</h5>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={reamarLabelClass}>Preferované obvody / okresy</label>
              <input type="text" value={wizardExtras.location?.administrative_area ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, location: { ...(prev.location ?? {}), administrative_area: e.target.value || null } }))}
                className={cn("mt-1 text-xs", reamarInputClass)} placeholder="Např. Praha 6, Praha-západ" />
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

      {/* Commute placeholder */}
      {wizardExtras.location?.method_commute && (
        <ReamarSubtleCard className="space-y-2 border-dashed p-3">
          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Dojíždění do práce / školy</h5>
          <p className="text-xs text-slate-600">
            V sekci Lifestyle (krok 7) máte detailní sekci pro walkability a občanskou vybavenost.
            Dojíždění je potvrzeno jako relevantní vstup.
          </p>
        </ReamarSubtleCard>
      )}
    </div>
  );

  const renderStep6 = () => (
    <div className="space-y-6">
      {/* Block A — Chips selection */}
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Co klient řeší?</p>
        <p className="mb-3 text-xs text-slate-600">Označte položky, které jsou pro klienta relevantní.</p>
        <div className="flex flex-wrap gap-2">
          {STANDARD_CHIPS.map((item) => {
            const selected = isStdSelected(item);
            return (
              <button key={item.key} type="button" onClick={() => toggleStdChip(item)}
                className={cn("rounded-full border px-4 py-2 text-xs font-medium transition-colors",
                  selected ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                {selected && <span className="mr-1.5">✓</span>}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Block B — Intensity for selected items */}
      {selectedStandards.length > 0 && (
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Jak moc?</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {selectedStandards.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-slate-700">{item.label}</span>
                <IntensityPicker value={getStdValue(item)} onChange={(v) => setStdValue(item, v)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Block C — Advanced standards (collapsed) */}
      <div>
        <button type="button" onClick={() => setShowAdvancedStandards((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100">
          <span className="text-xs font-semibold text-slate-700">Pokročilé standardy</span>
          <span className="text-xs text-slate-400">{showAdvancedStandards ? "▲ Skrýt" : "▼ Zobrazit"}</span>
        </button>
        {showAdvancedStandards && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {ADVANCED_STANDARD_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className={reamarLabelClass}>{label}</label>
                <input type="text" value={(wizardExtras.standards as any)?.[key] ?? ""}
                  onChange={(e) => setWizardExtras((prev) => ({ ...prev, standards: { ...(prev.standards ?? {}), [key]: e.target.value || null } }))}
                  className={cn("mt-1", reamarInputClass)} placeholder={placeholder} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className={reamarLabelClass}>Minimální energetická třída</label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {([
                  { value: "ignore", label: "Neřeším" },
                  { value: "A", label: "A" },
                  { value: "B", label: "B" },
                  { value: "C", label: "C" },
                  { value: "D", label: "D" },
                ] as const).map(({ value, label }) => {
                  const active = (wizardExtras.energy_class ?? "ignore") === value;
                  return (
                    <button key={value} type="button"
                      onClick={() => setWizardExtras((prev) => ({ ...prev, energy_class: value === "ignore" ? null : value }))}
                      className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderStep7 = () => (
    <div className="space-y-6">
      {/* Noise sensitivity */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Hlučnost lokality</p>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {(Object.entries(noiseLabels) as [string, string][]).map(([key, label]) => (
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
          <h5 className="text-xs font-semibold text-slate-900">Walkability – dostupnost v okolí</h5>
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
          items={[{ key: "supermarket", label: "Supermarket" }, { key: "pharmacy", label: "Lékárna" }, { key: "park", label: "Park" }, { key: "restaurant", label: "Restaurace" }, { key: "cafe", label: "Kavárna" }, { key: "fitness", label: "Fitness" }]}
          prefs={walkPrefs} onChange={setWalkPrefs} />
        <WalkabilityPreferencesGroup title="Vzdělávání a rodina"
          items={[{ key: "playground", label: "Hřiště" }, { key: "kindergarten", label: "Školka" }, { key: "primary_school", label: "ZŠ" }]}
          prefs={walkPrefs} onChange={setWalkPrefs} />
        <WalkabilityPreferencesGroup title="Doprava"
          items={[{ key: "metro", label: "Metro" }, { key: "tram", label: "Tramvaj" }, { key: "bus", label: "Bus" }]}
          prefs={walkPrefs} onChange={setWalkPrefs} />
      </div>

      {/* Character */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Charakter lokality</p>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-slate-700">Klid vs. městský život</span>
            <select value={wizardExtras.character?.calm_vs_city ?? "ignore"}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, character: { ...(prev.character ?? {}), calm_vs_city: e.target.value as any } }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
              <option value="ignore">Neřeším</option>
              <option value="calm">Spíše klid</option>
              <option value="city">Spíše městský život</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-slate-700">Soukromí vs. služby v okolí</span>
            <select value={wizardExtras.character?.privacy_vs_services ?? "ignore"}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, character: { ...(prev.character ?? {}), privacy_vs_services: e.target.value as any } }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
              <option value="ignore">Neřeším</option>
              <option value="privacy">Více soukromí</option>
              <option value="services">Více služeb v okolí</option>
            </select>
          </div>
        </div>
      </div>

      {/* Orientation & floor */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Orientace bytu a patro</p>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {[["south", "Orientace na jih"], ["west", "Orientace na západ"], ["east", "Orientace na východ"], ["north", "Orientace na sever"]].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm text-slate-700">{label}</span>
              <PrefToggle value={(wizardExtras.outdoor?.orientation as any)?.[key] ?? "ignore"}
                onChange={(v) => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), orientation: { ...(prev.outdoor?.orientation ?? {}), [key]: v as Priority } } }))} />
            </div>
          ))}
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-slate-700">Preferované patro</span>
            <select value={wizardExtras.outdoor?.preferred_floor ?? "ignore"}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), preferred_floor: e.target.value as any } }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
              <option value="ignore">Neřeším</option>
              <option value="ground">Přízemí</option>
              <option value="low">Nižší patra (1–3)</option>
              <option value="middle">Střední patra (4–7)</option>
              <option value="high">Vyšší patra (8+)</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-slate-700">Vadí přízemí</span>
            <PrefToggle value={wizardExtras.outdoor?.ground_floor_sensitive ?? "ignore"}
              onChange={(v) => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), ground_floor_sensitive: v as Priority } }))}
              preferLabel="Spíše vadí" mustLabel="Musí se vyhnout" />
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep8 = () => (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Co obětujeme dřív?</p>
        <p className="mb-4 text-xs text-slate-600">
          Klikněte na položky v pořadí podle toho, co je klient ochotný obětovat jako první.
          {ranking.length > 0 && " Klikněte znovu pro odebrání z pořadí."}
        </p>
        <div className="flex flex-wrap gap-3">
          {TRADE_OFF_ITEMS.map(({ key, label }) => {
            const idx = ranking.indexOf(key);
            const isRanked = idx >= 0;
            return (
              <button key={key} type="button" onClick={() => toggleRanking(key)}
                className={cn(
                  "relative rounded-2xl border px-5 py-3 text-sm font-medium transition-colors",
                  isRanked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                )}>
                {isRanked && (
                  <span className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                )}
                {label}
              </button>
            );
          })}
        </div>
        {ranking.length > 0 && (
          <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-slate-700">Pořadí obětování:</p>
            <ol className="mt-1 list-decimal pl-4 text-xs text-slate-600">
              {ranking.map((key) => {
                const item = TRADE_OFF_ITEMS.find((t) => t.key === key);
                return <li key={key}>{item?.label ?? key}</li>;
              })}
            </ol>
          </div>
        )}
      </div>

      <div>
        <label className={reamarLabelClass}>Poznámky k trade-offs</label>
        <textarea value={wizardExtras.trade_off_notes ?? ""}
          onChange={(e) => setWizardExtras((prev) => ({ ...prev, trade_off_notes: e.target.value || null }))}
          className={cn("mt-1 min-h-[80px]", reamarInputClass)}
          placeholder="Volný text — cokoliv důležitého k prioritám a kompromisům klienta…" />
      </div>
    </div>
  );

  const renderStep9 = () => (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {profile?.budget_max != null && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Max. cena</p>
            <p className="mt-1 text-base font-bold text-slate-900">{formatCurrencyCzk(profile.budget_max)}</p>
          </div>
        )}
        {(profile?.area_min != null || profile?.area_max != null) && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Plocha</p>
            <p className="mt-1 text-base font-bold text-slate-900">
              {profile?.area_min != null ? `${profile.area_min}` : "—"}&thinsp;–&thinsp;{profile?.area_max != null ? `${profile.area_max} m²` : "bez max."}
            </p>
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

      {/* Trade-offs */}
      {ranking.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-amber-700">Trade-offs</p>
          <ol className="list-decimal pl-4 text-xs text-amber-900">
            {ranking.map((key) => {
              const item = TRADE_OFF_ITEMS.find((t) => t.key === key);
              return <li key={key}>{item?.label ?? key}</li>;
            })}
          </ol>
          {wizardExtras.trade_off_notes && (
            <p className="mt-2 text-xs text-amber-800 italic">{wizardExtras.trade_off_notes}</p>
          )}
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
      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-900">Potvrdit brief a vygenerovat doporučení</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Uloží profil a přepočítá doporučení na základě aktuálního briefu.</p>
        </div>
        <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>
          {recomputing ? "Přepočítávám…" : "Potvrdit brief →"}
        </ReamarButton>
      </div>
    </div>
  );

  /* ── Step map ── */

  const stepRenderers: Record<number, () => React.JSX.Element> = {
    1: renderStep1,
    2: renderStep2,
    3: renderStep3,
    4: renderStep4,
    5: renderStep5,
    6: renderStep6,
    7: renderStep7,
    8: renderStep8,
    9: renderStep9,
  };

  /* ── Render ── */

  return (
    <div className="space-y-5">
      <BriefSteps currentStep={wizardStep} setCurrentStep={setWizardStep} totalSteps={TOTAL_WIZARD_STEPS} />

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
            <div className="hidden shrink-0 items-center gap-2 md:flex">
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

          {/* Two-column layout */}
          <div className="flex gap-6">
            {/* Left: current step */}
            <div className="min-w-0 flex-1 text-sm transition-opacity duration-200">
              {stepRenderers[wizardStep]?.() ?? null}
            </div>

            {/* Right: sticky summary rail (desktop only) */}
            <div className="hidden w-72 shrink-0 lg:block">
              <div className="sticky top-16">
                <ReamarSubtleCard className="p-4">
                  {summaryRail}
                </ReamarSubtleCard>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <ReamarButton type="button" variant="ghost" size="sm"
              onClick={() => setWizardStep((s) => Math.max(1, s - 1))} disabled={wizardStep === 1}>
              Zpět
            </ReamarButton>
            <div className="flex gap-2">
              <ReamarButton type="button" variant="primary" size="sm" onClick={handleSaveProfile} disabled={profileSaving}>
                {profileSaving ? "Ukládám…" : "Uložit profil"}
              </ReamarButton>
              {wizardStep < TOTAL_WIZARD_STEPS && (
                <ReamarButton type="button" variant="secondary" size="sm"
                  onClick={() => handleNextStep(wizardStep, TOTAL_WIZARD_STEPS, setWizardStep)}>
                  Další
                </ReamarButton>
              )}
            </div>
          </div>
        </ReamarCard>
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
                <p className="text-[11px] text-slate-600">Zatím žádná doporučení. Klikněte na &quot;Potvrdit brief&quot;.</p>
              ) : (
                <div className="max-h-[480px] overflow-y-auto overflow-hidden rounded-lg border border-slate-200/70">
                  <p className="px-3 py-2 text-[11px] text-slate-500">{recs.length} jednotek — přejděte na tab Recommendations pro detail.</p>
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

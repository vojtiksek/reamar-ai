"use client";

import { useState } from "react";
import clsx from "clsx";
import type { Dispatch, SetStateAction } from "react";

import type {
  ClientProfile,
  Priority,
  RecommendationFunnel,
  WizardExtras,
} from "@/lib/caseTypes";
import { FunnelCard } from "@/components/case/FunnelCard";
import { formatCurrencyCzk } from "@/lib/format";
import {
  WIZARD_STEPS,
  STANDARD_ENUMS,
  STANDARD_FEATURES,
  AMENITY_FEATURES,
} from "@/lib/wizardModel";
import type { WizardField } from "@/lib/wizardModel";
import { useWizardMetadata, getFieldOptions } from "@/hooks/useWizardMetadata";
import {
  ReamarButton,
} from "@/components/ui/reamar-ui";
import { CommutePointsEditor, type CommutePoint } from "./CommutePointsEditor";
import { QuarterPicker } from "@/components/QuarterPicker";
import type { WalkabilityPreferences, WalkabilityPreferenceValue } from "@/lib/walkabilityPreferences";
import { getNonDefaultChips as getWalkChips } from "@/lib/walkabilityPreferences";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

// ── Shared styles ──

const cardClass = "rounded-lg border border-slate-200 bg-white";
const cardHeaderClass = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500";
const inputClass = "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200";
const labelClass = "text-[10px] font-medium uppercase tracking-wider text-slate-400";
const pillClass = "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors";
const pillActive = "border-slate-800 bg-slate-800 text-white";
const pillInactive = "border-slate-200 bg-white text-slate-600 hover:border-slate-300";

// ── Tolerance slider (compact inline) ──

function ToleranceSlider({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const pct = value ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-400">±</span>
      <input
        type="range" min={0} max={20} step={1} value={pct}
        onChange={(e) => onChange(Number(e.target.value) || null)}
        className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500"
      />
      <span className="w-6 text-[10px] font-medium text-slate-500">{pct}%</span>
    </div>
  );
}

// ── Numeric input with inline tolerance ──

function NumericWithTolerance({ label, value, onValueChange, tolerance, onToleranceChange, placeholder, formatBelow }: {
  label: string;
  value: number | string | null;
  onValueChange: (v: number | null) => void;
  tolerance: number | null;
  onToleranceChange: (v: number | null) => void;
  placeholder?: string;
  formatBelow?: string | null;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="mt-0.5 flex items-center gap-1.5">
        <input type="number" value={value ?? ""}
          onChange={(e) => onValueChange(e.target.value ? Number(e.target.value) : null)}
          className={cn(inputClass, "w-28")} placeholder={placeholder ?? ""} />
        <ToleranceSlider value={tolerance} onChange={onToleranceChange} />
      </div>
      {formatBelow && <p className="mt-0.5 text-[10px] text-slate-400">{formatBelow}</p>}
    </div>
  );
}

// ── Intensity picker (V2: must / prefer / ignore) ──

function IntensityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [
    { v: "must", label: "Musí", active: "border-emerald-400 bg-emerald-50 text-emerald-800" },
    { v: "prefer", label: "Preferuji", active: "border-blue-400 bg-blue-50 text-blue-800" },
    { v: "ignore", label: "Ne", active: "border-slate-300 bg-slate-100 text-slate-500" },
  ];
  return (
    <div className="flex gap-0.5">
      {options.map(({ v, label, active }) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
            value === v ? active : "border-slate-200 bg-white text-slate-400 hover:border-slate-300")}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Props ──

export type QuickEditProps = {
  profile: ClientProfile | null;
  setProfile: Dispatch<SetStateAction<ClientProfile | null>>;
  wizardExtras: WizardExtras;
  setWizardExtras: Dispatch<SetStateAction<WizardExtras>>;
  selectedLayouts: string[];
  setSelectedLayouts: Dispatch<SetStateAction<string[]>>;
  LAYOUT_OPTIONS: { value: string; label: string }[];
  locationPolygons: { lat: number; lng: number }[][];
  projectsInsidePolygon: number;
  recs: { length: number };
  recsFunnel?: RecommendationFunnel | null;
  profileDirty: boolean;
  recomputing: boolean;
  handleRecompute: () => void;
  mustHaveSummary: string[];
  preferSummary: string[];
  onSwitchToWizard: (step?: number) => void;
  walkPrefs?: WalkabilityPreferences;
  setWalkPrefs?: Dispatch<SetStateAction<WalkabilityPreferences>>;
};

// ── Helpers ──

function readWizardValue(wiz: WizardExtras, profile: ClientProfile | null, dataPath: string): any {
  if (dataPath.startsWith("profile.")) {
    const key = dataPath.slice(8);
    return (profile as any)?.[key] ?? null;
  }
  if (dataPath === "selectedLayouts") return undefined;
  const parts = dataPath.split(".");
  let obj: any = wiz;
  for (const p of parts) {
    obj = obj?.[p];
    if (obj === undefined) return null;
  }
  return obj ?? null;
}

function writeWizardValue(
  setWiz: Dispatch<SetStateAction<WizardExtras>>,
  setProfile: Dispatch<SetStateAction<ClientProfile | null>>,
  dataPath: string,
  value: any,
) {
  if (dataPath.startsWith("profile.")) {
    const key = dataPath.slice(8);
    setProfile((prev) => ({ ...(prev ?? {}), [key]: value }));
    return;
  }
  const parts = dataPath.split(".");
  if (parts.length === 1) {
    setWiz((prev) => ({ ...prev, [parts[0]]: value }));
  } else if (parts.length === 2) {
    const [section, key] = parts;
    setWiz((prev) => ({
      ...prev,
      [section]: { ...((prev as any)[section] ?? {}), [key]: value },
    }));
  }
}

// ── Tabs ──

type TabKey = "filtry" | "preference" | "kontext";

const TABS: { key: TabKey; label: string; dot: string; desc: string }[] = [
  { key: "filtry", label: "Filtry", dot: "bg-emerald-500", desc: "vylučují jednotky" },
  { key: "preference", label: "Preference", dot: "bg-violet-500", desc: "ovlivňují pořadí" },
  { key: "kontext", label: "Kontext", dot: "bg-slate-400", desc: "metadata" },
];

// ── QuickEdit Component ──

export function QuickEdit({
  profile, setProfile,
  wizardExtras, setWizardExtras,
  selectedLayouts, setSelectedLayouts,
  LAYOUT_OPTIONS,
  locationPolygons, projectsInsidePolygon,
  recs,
  recsFunnel,
  profileDirty, recomputing, handleRecompute,
  mustHaveSummary, preferSummary,
  onSwitchToWizard,
  walkPrefs, setWalkPrefs,
}: QuickEditProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("filtry");
  const { fields: wizardMeta } = useWizardMetadata();

  // ── Pill renderer (for toggle fields) ──

  const renderPills = (options: { value: string; label: string }[], current: string | null, onSelect: (v: string) => void) => (
    <div className="flex flex-wrap gap-1">
      {options.map(({ value, label }) => (
        <button key={value} type="button" onClick={() => onSelect(value)}
          className={cn(pillClass, current === value ? pillActive : pillInactive)}>
          {label}
        </button>
      ))}
    </div>
  );

  const renderToggleField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath);
    const current = val ?? (f.key === "renovation_preference" ? "any" : "");
    return (
      <div key={f.key}>
        <p className={cn(labelClass, "mb-1.5")}>{f.label}</p>
        {renderPills(f.options ?? [], current, (v) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, v))}
      </div>
    );
  };

  // ── Feature & Enum renderers ──

  const renderFeatureField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath) ?? "ignore";
    return (
      <div key={f.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="text-xs text-slate-700">{f.label}</span>
        <IntensityPicker value={val} onChange={(v) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, v as Priority)} />
      </div>
    );
  };

  const renderEnumField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath);
    const selected: string[] = Array.isArray(val) ? val : val ? [String(val)] : [];
    const section = f.dataPath.includes(".") ? f.dataPath.split(".")[0] : undefined;
    const options = getFieldOptions(wizardMeta, f.key, section, f.options);
    const priorityPath = `${f.dataPath}_priority`;
    const priority = readWizardValue(wizardExtras, profile, priorityPath) ?? "ignore";
    const hasSelection = selected.length > 0;
    return (
      <div key={f.key} className="px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-700">{f.label}</span>
          <div className="flex gap-0.5">
            {options.map(({ value, label }) => {
              const active = selected.includes(value);
              return (
                <button key={value} type="button"
                  onClick={() => {
                    const next = active ? selected.filter((v) => v !== value) : [...selected, value];
                    writeWizardValue(setWizardExtras, setProfile, f.dataPath, next.length ? next : undefined);
                    if (next.length === 0) writeWizardValue(setWizardExtras, setProfile, priorityPath, undefined);
                  }}
                  className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    active ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-400 hover:border-slate-300")}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {hasSelection && (
          <div className="mt-1 flex justify-end">
            <IntensityPicker value={priority} onChange={(v) => writeWizardValue(setWizardExtras, setProfile, priorityPath, v)} />
          </div>
        )}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: FILTRY
  // ═══════════════════════════════════════════════════════════════════════

  const renderFiltry = () => (
    <div className="space-y-3">
      {/* Row 1: Cena + Plocha + Venkovní — inline with tolerances */}
      <div className={cardClass}>
        <p className={cardHeaderClass}>Cena a prostor</p>
        <div className="px-3 pb-3 space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <NumericWithTolerance
              label="Max. cena (Kč)" value={profile?.budget_max ?? null}
              onValueChange={(v) => setProfile((prev) => ({ ...(prev ?? {}), budget_max: v }))}
              tolerance={wizardExtras.budget?.max_price_tolerance_pct ?? null}
              onToleranceChange={(v) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_price_tolerance_pct: v } }))}
              placeholder="Strop"
              formatBelow={profile?.budget_max != null ? formatCurrencyCzk(profile.budget_max) : null}
            />
            <NumericWithTolerance
              label="Min. plocha (m²)" value={profile?.area_min ?? null}
              onValueChange={(v) => setProfile((prev) => ({ ...(prev ?? {}), area_min: v }))}
              tolerance={wizardExtras.budget?.max_area_tolerance_pct ?? null}
              onToleranceChange={(v) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_area_tolerance_pct: v } }))}
              placeholder="Min."
            />
            <NumericWithTolerance
              label="Min. venkovní (m²)" value={wizardExtras.outdoor?.min_outdoor_area_m2 ?? null}
              onValueChange={(v) => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), min_outdoor_area_m2: v } }))}
              tolerance={wizardExtras.budget?.max_outdoor_tolerance_pct ?? null}
              onToleranceChange={(v) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_outdoor_tolerance_pct: v } }))}
              placeholder="Např. 5"
            />
          </div>
          {/* Dispozice + Patro inline */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <label className={cn(labelClass, "mb-1 block")}>Dispozice</label>
              <div className="flex flex-wrap gap-1">
                {LAYOUT_OPTIONS.map((opt) => {
                  const checked = selectedLayouts.includes(opt.value);
                  return (
                    <button key={opt.value} type="button"
                      onClick={() => setSelectedLayouts((prev) => checked ? prev.filter((v) => v !== opt.value) : Array.from(new Set([...prev, opt.value])))}
                      className={cn(pillClass, checked ? pillActive : pillInactive)}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              {renderToggleField(WIZARD_STEPS[2].groups[3].fields[0])}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Platby + Termíny — one row */}
      <div className={cn(cardClass, "flex flex-wrap divide-x divide-slate-100")}>
        <div className="flex-1 sm:min-w-[200px] px-3 py-2 space-y-2">
          <p className={cn(cardHeaderClass, "px-0 py-0")}>Platby</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>Záloha smlouva (%)</label>
              <input type="number" value={wizardExtras.budget?.max_payment_contract_pct ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_payment_contract_pct: e.target.value ? Number(e.target.value) : null } }))}
                className={cn("mt-0.5", inputClass)} placeholder="Max." />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Platba výstavba (%)</label>
              <input type="number" value={wizardExtras.budget?.max_payment_construction_pct ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_payment_construction_pct: e.target.value ? Number(e.target.value) : null } }))}
                className={cn("mt-0.5", inputClass)} placeholder="Max." />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Max. dní na trhu</label>
              <input type="number" value={wizardExtras.budget?.max_days_on_market ?? ""}
                onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_days_on_market: e.target.value ? Number(e.target.value) : null } }))}
                className={cn("mt-0.5", inputClass)} placeholder="Např. 180" />
            </div>
          </div>
        </div>
        <div className="flex-1 sm:min-w-[200px] px-3 py-2 space-y-2">
          <p className={cn(cardHeaderClass, "px-0 py-0")}>Termíny nastěhování</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>Nejdříve</label>
              <QuarterPicker
                value={wizardExtras.earliest_move_in}
                onChange={(v) => setWizardExtras((prev) => ({ ...prev, earliest_move_in: v }))}
                mode="start"
                className={cn("mt-0.5 w-full", inputClass)}
                placeholder="Neřeším"
              />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Nejpozději</label>
              <QuarterPicker
                value={wizardExtras.latest_move_in}
                onChange={(v) => setWizardExtras((prev) => ({ ...prev, latest_move_in: v }))}
                mode="end"
                className={cn("mt-0.5 w-full", inputClass)}
                placeholder="Neřeším"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Lokalita + Dojezdy */}
      <div className={cardClass}>
        <div className="flex items-center justify-between px-3 py-2">
          <p className={cn(cardHeaderClass, "px-0 py-0")}>Lokalita</p>
          <button type="button" onClick={() => onSwitchToWizard(3)} className="text-[11px] text-indigo-600 hover:underline">
            Upravit na mapě →
          </button>
        </div>
        <div className="px-3 pb-3 space-y-2">
          {/* Location status chips */}
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {wizardExtras.location?.method_polygon && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                Polygon {locationPolygons.some((p) => p.length >= 3) ? `· ${projectsInsidePolygon} proj.` : "· prázdný"}
              </span>
            )}
            {wizardExtras.location?.method_commute && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">Dojíždění</span>
            )}
            {(() => {
              const raw = wizardExtras.location?.administrative_area;
              const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
              if (!list.length) return null;
              const hard = !!wizardExtras.location?.method_admin;
              return (
                <span className={cn("rounded-full border px-2 py-0.5", hard ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                  {list.join(", ")}{hard ? " (filtr)" : " (soft)"}
                </span>
              );
            })()}
            {!wizardExtras.location?.method_polygon && !wizardExtras.location?.method_commute && !wizardExtras.location?.method_admin && (
              <span className="text-slate-400">Žádná metoda lokality</span>
            )}
          </div>
          {/* Commute points */}
          <CommutePointsEditor
            points={(wizardExtras.commute?.points ?? []) as CommutePoint[]}
            onChange={(next) =>
              setWizardExtras((prev) => ({
                ...prev,
                commute: { ...(prev.commute ?? {}), points: next },
              }))
            }
          />
          {/* Režim dojezdů */}
          {renderToggleField(WIZARD_STEPS[3].groups[0].fields[2])}
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: PREFERENCE
  // ═══════════════════════════════════════════════════════════════════════

  const renderPreference = () => (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Typ & charakter */}
      <div className={cardClass}>
        <p className={cardHeaderClass}>Typ stavby a charakter</p>
        <div className="space-y-2.5 px-3 pb-3">
          {renderToggleField(WIZARD_STEPS[7].groups[0].fields[0])}
          {renderToggleField(WIZARD_STEPS[7].groups[1].fields[2])}
          {renderToggleField(WIZARD_STEPS[3].groups[1].fields[0])}
          {renderToggleField(WIZARD_STEPS[3].groups[1].fields[1])}
        </div>
      </div>

      {/* Standardy features */}
      <div className={cn(cardClass, "divide-y divide-slate-100")}>
        <p className={cardHeaderClass}>Standardy bytu</p>
        {STANDARD_FEATURES.map((f) => renderFeatureField(f))}
      </div>

      {/* Enum standardy */}
      <div className={cn(cardClass, "divide-y divide-slate-100")}>
        <p className={cardHeaderClass}>Detailní standardy</p>
        {STANDARD_ENUMS.map((f) => renderEnumField(f))}
      </div>

      {/* Vybavení domu */}
      <div className={cn(cardClass, "divide-y divide-slate-100")}>
        <p className={cardHeaderClass}>Vybavení domu</p>
        {AMENITY_FEATURES.map((f) => renderFeatureField(f))}
      </div>

      {/* Okolí a doprava (walkability) */}
      {walkPrefs && setWalkPrefs && (() => {
        const WALK_CATS: { key: keyof WalkabilityPreferences; label: string; defaultDist?: number }[] = [
          { key: "supermarket", label: "Obchod", defaultDist: 500 }, { key: "pharmacy", label: "Lékárna", defaultDist: 800 },
          { key: "park", label: "Park", defaultDist: 500 }, { key: "restaurant", label: "Restaurace", defaultDist: 500 },
          { key: "cafe", label: "Kavárna", defaultDist: 500 }, { key: "fitness", label: "Fitness", defaultDist: 800 },
          { key: "playground", label: "Hřiště", defaultDist: 500 }, { key: "kindergarten", label: "Školka", defaultDist: 800 },
          { key: "primary_school", label: "ZŠ", defaultDist: 1000 },
          { key: "metro", label: "Metro", defaultDist: 600 }, { key: "tram", label: "Tramvaj", defaultDist: 300 },
          { key: "bus", label: "Bus", defaultDist: 200 }, { key: "train", label: "Vlak", defaultDist: 1000 },
        ];
        const poiDist = wizardExtras?.poi_max_distances ?? {};
        const WALK_VALS: { value: WalkabilityPreferenceValue; label: string; active: string }[] = [
          { value: "required", label: "Musí", active: "border-emerald-400 bg-emerald-50 text-emerald-800" },
          { value: "high", label: "Chci", active: "border-blue-400 bg-blue-50 text-blue-800" },
          { value: "ignore", label: "Ne", active: "border-slate-300 bg-slate-100 text-slate-500" },
        ];
        const chips = getWalkChips(walkPrefs);
        return (
          <div className={cn(cardClass, "divide-y divide-slate-100 lg:col-span-2")}>
            <div className="flex items-center justify-between px-3 py-2">
              <p className={cn(cardHeaderClass, "px-0 py-0")}>Okolí a doprava</p>
              {chips.length > 0 && <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">{chips.length}</span>}
            </div>
            <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-2 lg:divide-y-0">
              {WALK_CATS.map((c) => {
                const cur = walkPrefs[c.key] === "normal" ? "ignore" : walkPrefs[c.key];
                return (
                <div key={c.key} className="flex items-center justify-between gap-1 border-b border-slate-100 px-3 py-1.5 lg:border-b-0 lg:odd:border-r">
                  <span className="min-w-[52px] text-[11px] text-slate-700">{c.label}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-0.5">
                      {WALK_VALS.map((o) => (
                        <button key={o.value} type="button"
                          onClick={() => setWalkPrefs((prev) => ({ ...prev, [c.key]: o.value }))}
                          className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                            cur === o.value ? o.active : "border-slate-200 bg-white text-slate-400 hover:border-slate-300")}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {cur !== "ignore" && (
                      <div className="flex items-center gap-0.5">
                        <input type="number" placeholder={String(c.defaultDist ?? 500)}
                          value={poiDist[c.key] ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value ? Number(e.target.value) : undefined;
                            setWizardExtras((prev: WizardExtras) => {
                              const old = { ...(prev.poi_max_distances ?? {}) };
                              if (raw != null) { old[c.key] = raw; } else { delete old[c.key]; }
                              return { ...prev, poi_max_distances: old };
                            });
                          }}
                          className="w-14 rounded border border-slate-200 px-1 py-0.5 text-[10px] text-right text-slate-700 focus:border-indigo-300 focus:outline-none"
                        />
                        <span className="text-[9px] text-slate-400">m</span>
                      </div>
                    )}
                  </div>
                </div>
                ); })}
            </div>
          </div>
        );
      })()}

      {/* Summaries */}
      {(mustHaveSummary.length > 0 || preferSummary.length > 0) && (
        <div className="space-y-2 lg:col-span-2">
          <div className="grid gap-2 lg:grid-cols-2">
            {mustHaveSummary.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Musí být</p>
                <ul className="space-y-0.5">
                  {mustHaveSummary.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1 text-[11px] text-emerald-900">
                      <span className="text-emerald-500">✓</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preferSummary.length > 0 && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">Preferované</p>
                <ul className="space-y-0.5">
                  {preferSummary.map((item, idx) => (
                    <li key={idx} className="text-[11px] text-violet-900">· {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: KONTEXT
  // ═══════════════════════════════════════════════════════════════════════

  const renderKontext = () => (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* O klientovi */}
      <div className={cardClass}>
        <p className={cardHeaderClass}>O klientovi</p>
        <div className="space-y-2.5 px-3 pb-3">
          {/* Typ klienta */}
          <div>
            <label className={cn(labelClass, "mb-1 block")}>Kdo bude bydlet</label>
            <div className="grid grid-cols-2 gap-1">
              {(WIZARD_STEPS[0].groups[1].fields[0].options ?? []).map(({ value, label, icon }) => {
                const active = wizardExtras.client_type === value;
                return (
                  <button key={value} type="button"
                    onClick={() => setWizardExtras((prev) => ({ ...prev, client_type: active ? null : value as any }))}
                    className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors",
                      active ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                    {icon && <span className="text-sm">{icon}</span>}{label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Účel */}
          <div>
            <label className={cn(labelClass, "mb-1 block")}>Účel nákupu</label>
            {renderPills(
              WIZARD_STEPS[0].groups[0].fields[0].options ?? [],
              profile?.purchase_purpose ?? null,
              (v) => setProfile((prev) => ({ ...(prev ?? {}), purchase_purpose: v })),
            )}
          </div>
          {/* Časový horizont */}
          {renderToggleField(WIZARD_STEPS[0].groups[2].fields[0])}
        </div>
      </div>

      {/* Detaily */}
      <div className={cardClass}>
        <p className={cardHeaderClass}>Detaily</p>
        <div className="space-y-2.5 px-3 pb-3">
          {/* Financování */}
          <div>
            <label className={cn(labelClass, "mb-1 block")}>Financování</label>
            {renderPills(
              WIZARD_STEPS[1].groups[1].fields[0].options ?? [],
              wizardExtras.financing_type ?? null,
              (v) => setWizardExtras((prev) => ({ ...prev, financing_type: v as any })),
            )}
          </div>
          {/* Typ nemovitosti */}
          <div>
            <label className={cn(labelClass, "mb-1 block")}>Typ nemovitosti</label>
            {renderPills(
              [{ value: "any", label: "Neřeším" }, { value: "apartment", label: "Byt" }, { value: "house", label: "Dům" }],
              profile?.property_type ?? "any",
              (v) => setProfile((prev) => ({ ...(prev ?? {}), property_type: v })),
            )}
          </div>
          {/* Postoupení */}
          {renderToggleField(WIZARD_STEPS[7].groups[3].fields[2])}
          {/* Standard dokončení */}
          {renderToggleField(WIZARD_STEPS[7].groups[2].fields[0])}
        </div>
      </div>

      {/* Stats */}
      {(recs.length > 0 || recsFunnel) && (
        <div className="lg:col-span-2 grid gap-3 lg:grid-cols-2">
          {recs.length > 0 && (
            <div className={cn(cardClass, "px-3 py-3")}>
              <p className={labelClass}>Doporučení</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">{recs.length} jednotek</p>
            </div>
          )}
          {recsFunnel && <FunnelCard funnel={recsFunnel} />}
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-3">
      {/* Tab bar + recompute */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === t.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", activeTab === t.key ? "bg-white/60" : t.dot)} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {profileDirty && <span className="text-[10px] text-amber-600">Neuložené změny</span>}
          <ReamarButton type="button" variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>
            {recomputing ? "Přepočítávám…" : "Přepočítat →"}
          </ReamarButton>
        </div>
      </div>

      {/* Active tab content */}
      {activeTab === "filtry" && renderFiltry()}
      {activeTab === "preference" && renderPreference()}
      {activeTab === "kontext" && renderKontext()}
    </div>
  );
}

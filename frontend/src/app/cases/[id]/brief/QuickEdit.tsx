"use client";

import clsx from "clsx";
import type { Dispatch, SetStateAction } from "react";

import type { ClientProfile, Priority, WizardExtras } from "@/lib/caseTypes";
import { formatCurrencyCzk, formatAreaM2 } from "@/lib/format";
import {
  WIZARD_STEPS,
  STANDARD_ENUMS,
  STANDARD_FEATURES,
  AMENITY_FEATURES,
  NOISE_FEATURES,
} from "@/lib/wizardModel";
import type { WizardField } from "@/lib/wizardModel";
import { useWizardMetadata, getFieldOptions } from "@/hooks/useWizardMetadata";
import { PrefToggle } from "@/components/case/PrefToggle";
import {
  ReamarButton,
  reamarInputClass,
  reamarLabelClass,
} from "@/components/ui/reamar-ui";
import { CommutePointsEditor, type CommutePoint } from "./CommutePointsEditor";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

// ── Badge components ──

function FilterBadge() {
  return <span className="ml-1.5 inline-block rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-emerald-800">Filtr</span>;
}
function PrefBadge() {
  return <span className="ml-1.5 inline-block rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-violet-800">Preference</span>;
}
function CtxBadge() {
  return <span className="ml-1.5 inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-slate-600">Kontext</span>;
}

function RoleBadge({ role }: { role: string }) {
  if (role === "hard_filter") return <FilterBadge />;
  if (role === "preference") return <PrefBadge />;
  return <CtxBadge />;
}

// ── Intensity picker (must / prefer / bonus) ──

function IntensityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [
    { v: "must", label: "Musí být", active: "border-emerald-400 bg-emerald-50 text-emerald-800" },
    { v: "prefer", label: "Preferujeme", active: "border-blue-400 bg-blue-50 text-blue-800" },
    { v: "bonus", label: "Bonus", active: "border-amber-400 bg-amber-50 text-amber-800" },
  ];
  return (
    <div className="flex gap-1">
      {options.map(({ v, label, active }) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === v ? active : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
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
  autoSaveStatus: string;
  recomputing: boolean;
  handleRecompute: () => void;
  mustHaveSummary: string[];
  preferSummary: string[];
  // For "edit in wizard" links
  onSwitchToWizard: (step: number) => void;
};

// ── Helpers ──

/** Read a value from wizardExtras via dot-notation dataPath */
function readWizardValue(wiz: WizardExtras, profile: ClientProfile | null, dataPath: string): any {
  if (dataPath.startsWith("profile.")) {
    const key = dataPath.slice(8);
    return (profile as any)?.[key] ?? null;
  }
  if (dataPath === "selectedLayouts") return undefined; // handled specially
  const parts = dataPath.split(".");
  let obj: any = wiz;
  for (const p of parts) {
    obj = obj?.[p];
    if (obj === undefined) return null;
  }
  return obj ?? null;
}

/** Write a value to wizardExtras via dot-notation dataPath */
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

// ── QuickEdit Component ──

export function QuickEdit({
  profile, setProfile,
  wizardExtras, setWizardExtras,
  selectedLayouts, setSelectedLayouts,
  LAYOUT_OPTIONS,
  locationPolygons, projectsInsidePolygon,
  recs,
  autoSaveStatus, recomputing, handleRecompute,
  mustHaveSummary, preferSummary,
  onSwitchToWizard,
}: QuickEditProps) {
  const { fields: wizardMeta } = useWizardMetadata();

  // ── Generic field renderers ──

  const renderNumericField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath);
    return (
      <div key={f.key}>
        <label className={reamarLabelClass}>{f.label} {f.unit && `(${f.unit})`} <RoleBadge role={f.role} /></label>
        <input type="number" value={val ?? ""}
          onChange={(e) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, e.target.value ? Number(e.target.value) : null)}
          className={cn("mt-1", reamarInputClass)} placeholder={f.placeholder ?? ""} />
        {f.key === "budget_max" && val != null && <p className="mt-0.5 text-[10px] text-slate-500">{formatCurrencyCzk(val)}</p>}
        {f.key === "ideal_price" && val != null && <p className="mt-0.5 text-[10px] text-slate-500">{formatCurrencyCzk(val)}</p>}
      </div>
    );
  };

  const renderToggleField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath);
    return (
      <div key={f.key} className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{f.label} <RoleBadge role={f.role} /></p>
        <div className="flex flex-wrap gap-1.5">
          {(f.options ?? []).map(({ value, label }) => {
            const active = (val ?? (f.key === "renovation_preference" ? "any" : "")) === value;
            return (
              <button key={value} type="button"
                onClick={() => writeWizardValue(setWizardExtras, setProfile, f.dataPath, value)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDateField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath);
    return (
      <div key={f.key}>
        <label className={reamarLabelClass}>{f.label} <RoleBadge role={f.role} /></label>
        <input type="date" value={val ?? ""}
          onChange={(e) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, e.target.value || null)}
          className={cn("mt-1", reamarInputClass)} />
      </div>
    );
  };

  const renderEnumField = (f: WizardField) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath);
    const selected: string[] = Array.isArray(val) ? val : val ? [String(val)] : [];
    const section = f.dataPath.includes(".") ? f.dataPath.split(".")[0] : undefined;
    const options = getFieldOptions(wizardMeta, f.key, section, f.options);
    return (
      <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-xs text-slate-700">{f.label}</span>
        <div className="flex gap-1">
          {options.map(({ value, label }) => {
            const active = selected.includes(value);
            return (
              <button key={value} type="button"
                onClick={() => {
                  const next = active ? selected.filter((v) => v !== value) : [...selected, value];
                  writeWizardValue(setWizardExtras, setProfile, f.dataPath, next.length ? next : undefined);
                }}
                className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  active ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFeatureField = (f: WizardField, hard = false) => {
    const val = readWizardValue(wizardExtras, profile, f.dataPath) ?? "ignore";
    if (hard) {
      return (
        <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-xs text-slate-700">{f.label}</span>
          <PrefToggle hard value={val} onChange={(v) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, v as Priority)} />
        </div>
      );
    }
    return (
      <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-xs text-slate-700">{f.label}</span>
        <IntensityPicker value={val} onChange={(v) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, v as Priority)} />
      </div>
    );
  };

  // ── Column: FILTRY (hard_filter) ──

  const renderFiltry = () => (
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
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Venkovní prostor <FilterBadge /></p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={reamarLabelClass}>Min. plocha (m²)</label>
            <input type="number" value={wizardExtras.budget?.min_outdoor_area_m2 ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), min_outdoor_area_m2: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 5" />
          </div>
          <div>
            <label className={reamarLabelClass}>Tolerance -%</label>
            <input type="number" value={wizardExtras.budget?.max_outdoor_tolerance_pct ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_outdoor_tolerance_pct: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 10" />
          </div>
        </div>
      </div>

      {/* Platební podmínky (broker) */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Platební podmínky <FilterBadge /></p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={reamarLabelClass}>Max. záloha při smlouvě (%)</label>
            <input type="number" value={wizardExtras.budget?.max_payment_contract_pct ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_payment_contract_pct: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 20" />
          </div>
          <div>
            <label className={reamarLabelClass}>Max. platba při výstavbě (%)</label>
            <input type="number" value={wizardExtras.budget?.max_payment_construction_pct ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), max_payment_construction_pct: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1", reamarInputClass)} placeholder="Např. 30" />
          </div>
        </div>
      </div>

      {/* Termíny */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Nastěhování <FilterBadge /></p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={reamarLabelClass}>Nejdříve</label>
            <input type="date" value={wizardExtras.earliest_move_in ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, earliest_move_in: e.target.value || null }))}
              className={cn("mt-1", reamarInputClass)} />
          </div>
          <div>
            <label className={reamarLabelClass}>Nejpozději</label>
            <input type="date" value={wizardExtras.latest_move_in ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, latest_move_in: e.target.value || null }))}
              className={cn("mt-1", reamarInputClass)} />
          </div>
        </div>
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
        <button type="button" onClick={() => onSwitchToWizard(3)} className="text-xs text-indigo-600 hover:underline">
          Upravit lokalitu / polygon →
        </button>
      </div>

      {/* Commute points — shared editor (same component as fullscreen wizard) */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          Dojíždění <FilterBadge />
        </p>
        <CommutePointsEditor
          points={(wizardExtras.commute?.points ?? []) as CommutePoint[]}
          onChange={(next) =>
            setWizardExtras((prev) => ({
              ...prev,
              commute: { ...(prev.commute ?? {}), points: next },
            }))
          }
        />
      </div>
    </div>
  );

  // ── Column: PREFERENCE ──

  const renderPreference = () => (
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

      {/* Patro */}
      {renderToggleField(WIZARD_STEPS[2].groups[3].fields[0])}

      {/* Novostavba vs rekonstrukce */}
      {renderToggleField(WIZARD_STEPS[7].groups[0].fields[0])}

      {/* Hlučnost — model-driven from NOISE_FEATURES */}
      <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Hlučnost <FilterBadge /><PrefBadge /></p>
        {NOISE_FEATURES.map((f) => {
          const val = readWizardValue(wizardExtras, profile, f.dataPath) ?? "ignore";
          return (
            <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-xs text-slate-700">{f.label}</span>
              <PrefToggle hard value={val}
                preferLabel="Vadí mi"
                mustLabel="Vyloučit"
                onChange={(v) => writeWizardValue(setWizardExtras, setProfile, f.dataPath, v as Priority)} />
            </div>
          );
        })}
      </div>

      {/* Standardy — model-driven from STANDARD_FEATURES */}
      <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Standardy <PrefBadge /><FilterBadge /></p>
        {STANDARD_FEATURES.map((f) => renderFeatureField(f))}
      </div>

      {/* Enum standardy — model-driven from STANDARD_ENUMS */}
      <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Detailní standardy <PrefBadge /></p>
        {STANDARD_ENUMS.map((f) => renderEnumField(f))}
      </div>

      {/* Vybavení domu — model-driven from AMENITY_FEATURES */}
      <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Vybavení domu <PrefBadge /></p>
        {AMENITY_FEATURES.map((f) => renderFeatureField(f))}
      </div>

      {/* Venkovní prostor typy */}
      <div className="space-y-0 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ venkovního prostoru <PrefBadge /></p>
        {WIZARD_STEPS[2].groups[2].fields
          .filter((f) => f.render === "feature")
          .map((f) => renderFeatureField(f))}
      </div>

      {/* Must-haves / Preference summary */}
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
    </div>
  );

  // ── Column: KONTEXT ──

  const renderKontext = () => (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
        Kontext klienta
        <span className="font-normal normal-case tracking-normal text-[10px] text-slate-400">metadata</span>
      </p>

      {/* Typ klienta — from model */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Typ klienta <CtxBadge /></p>
        <div className="grid grid-cols-2 gap-1.5">
          {(WIZARD_STEPS[0].groups[1].fields[0].options ?? []).map(({ value, label, icon }) => {
            const active = wizardExtras.client_type === value;
            return (
              <button key={value} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, client_type: active ? null : value as any }))}
                className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                  active ? "border-indigo-400 bg-white text-indigo-800 ring-2 ring-indigo-300/40" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white")}>
                {icon && <span>{icon}</span>}{label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Účel nákupu */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Účel nákupu <CtxBadge /></p>
        <div className="flex gap-2">
          {(WIZARD_STEPS[0].groups[0].fields[0].options ?? []).map(({ value, label }) => {
            const active = profile?.purchase_purpose === value;
            return (
              <button key={value} type="button"
                onClick={() => setProfile((prev) => ({ ...(prev ?? {}), purchase_purpose: value }))}
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
          {(WIZARD_STEPS[1].groups[1].fields[0].options ?? []).map(({ value, label }) => {
            const active = wizardExtras.financing_type === value;
            return (
              <button key={value} type="button"
                onClick={() => setWizardExtras((prev) => ({ ...prev, financing_type: active ? null : value as any }))}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Postoupení smlouvy (broker) */}
      {renderToggleField(WIZARD_STEPS[7].groups[3].fields[2])}

      {/* Standard dokončení */}
      {renderToggleField(WIZARD_STEPS[7].groups[2].fields[0])}

      {/* Charakter okolí */}
      {renderToggleField(WIZARD_STEPS[3].groups[1].fields[0])}

      {/* Doporučení count */}
      {recs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Doporučení</p>
          <p className="mt-1 text-base font-bold text-slate-900">{recs.length} jednotek</p>
        </div>
      )}
    </div>
  );

  // ── Main render ──

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        {renderFiltry()}
        {renderPreference()}
        {renderKontext()}
      </div>

      {/* Footer */}
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
}

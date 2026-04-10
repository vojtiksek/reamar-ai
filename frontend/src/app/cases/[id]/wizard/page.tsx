"use client";

import { useState, useEffect } from "react";
import clsx from "clsx";
import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk } from "@/lib/format";
import type { Priority } from "@/lib/caseTypes";
import {
  WIZARD_STEPS,
  STANDARD_ENUMS,
  STANDARD_FEATURES,
  AMENITY_FEATURES,
  NOISE_FEATURES,
  NOISE_LABELS,
  ENUM_OPTION_LABELS,
  ENUM_FIELD_LABELS,
  STANDARD_FEATURE_LABELS,
  type WizardField,
} from "@/lib/wizardModel";
import { useWizardMetadata, getFieldOptions, getCompoundInfo } from "@/hooks/useWizardMetadata";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

const TOTAL_STEPS = WIZARD_STEPS.length;

const STEP_LABELS: Record<number, string> = Object.fromEntries(
  WIZARD_STEPS.map((s) => [s.index, s.label]),
);

/* ─── Shared UI ─── */

function OptionCard({
  active,
  onClick,
  icon,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon?: string;
  label: string;
  desc?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded-2xl border px-5 py-4 text-left transition-all",
        active
          ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200/50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm",
      )}
    >
      {icon && <span className="mb-1.5 text-2xl">{icon}</span>}
      <p className={cn("text-sm font-semibold", active ? "text-sky-900" : "text-slate-900")}>{label}</p>
      {desc && <p className={cn("mt-0.5 text-xs", active ? "text-sky-700/80" : "text-slate-500")}>{desc}</p>}
    </button>
  );
}

function PriorityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [
    { v: "must", label: "Musí být", color: "border-emerald-400 bg-emerald-50 text-emerald-800" },
    { v: "prefer", label: "Chtěli bychom", color: "border-sky-400 bg-sky-50 text-sky-800" },
    { v: "bonus", label: "Bonus", color: "border-amber-400 bg-amber-50 text-amber-800" },
  ];
  return (
    <div className="flex gap-1.5">
      {options.map(({ v, label, color }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            value === v ? color : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{children}</label>;
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200/50";

/* ─── Main ─── */

export default function ClientWizardPage() {
  const {
    client,
    profile, setProfile,
    selectedLayouts, setSelectedLayouts,
    loading,
    hydrated,
    wizardExtras, setWizardExtras,
    locationPolygons,
    LAYOUT_OPTIONS,
    clientId,
    handleSaveProfile,
    handleNextStep,
    autoSaveStatus,
  } = useCaseData();

  const { fields: wizardMeta } = useWizardMetadata();
  const [step, setStep] = useState(1);
  const [finishing, setFinishing] = useState(false);

  // Close window after finish
  const handleFinish = async () => {
    setFinishing(true);
    await handleSaveProfile();
    // If opened as popup, close it; otherwise go back
    if (window.opener) {
      window.close();
    } else {
      window.location.href = `/cases/${clientId}/brief`;
    }
  };

  const goNext = () => {
    handleNextStep(step, TOTAL_STEPS, setStep as any);
  };

  const goPrev = () => {
    setStep((s) => Math.max(1, s - 1));
  };

  if (!hydrated || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Načítám...</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-rose-600">Klient nenalezen.</p>
      </div>
    );
  }

  /* ─── Model-driven field renderers ─── */

  const toggleEnumValue = (section: string, attrKey: string, val: string) => {
    setWizardExtras((prev) => {
      const sec = (prev as Record<string, any>)[section] ?? {};
      const current = sec[attrKey];
      const arr: string[] = Array.isArray(current) ? [...current] : current ? [String(current)] : [];
      const idx = arr.indexOf(val);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(val);
      return { ...prev, [section]: { ...sec, [attrKey]: arr.length ? arr : undefined } };
    });
  };

  const getEnumValues = (section: string, attrKey: string): string[] => {
    const sec = (wizardExtras as Record<string, any>)[section];
    const v = sec?.[attrKey];
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string" && v) return [v];
    return [];
  };

  const renderEnumField = (f: WizardField, section: string) => {
    const selected = getEnumValues(section, f.key);
    const options = getFieldOptions(wizardMeta, f.key, section, f.options);
    return (
      <div key={f.key} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
        <span className="mb-2 block text-sm font-medium text-slate-700">{f.label}</span>
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleEnumValue(section, f.key, opt.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-sky-400 bg-sky-50 text-sky-800"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFeatureField = (f: WizardField, section: string) => {
    const sec = (wizardExtras as Record<string, any>)[section] ?? {};
    const priority = (sec[f.key] as string) ?? "";
    const compound = getCompoundInfo(wizardMeta, f.key, section);
    const isActive = priority === "must" || priority === "prefer" || priority === "bonus";

    return (
      <div key={f.key} className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{f.label}</span>
          <PriorityPicker
            value={priority}
            onChange={(v) => setWizardExtras((prev) => ({
              ...prev,
              [section]: { ...((prev as Record<string, any>)[section] ?? {}), [f.key]: v as Priority },
            }))}
          />
        </div>
        {/* Compound detail: sub_options (e.g. air_conditioning type) */}
        {isActive && compound?.sub_options && compound.sub_options.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
            <span className="mr-1 self-center text-xs text-slate-500">Typ:</span>
            {compound.sub_options.map((opt) => {
              const detailKey = `${f.key}_type`;
              const currentType = sec[detailKey] as string | undefined;
              const active = currentType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWizardExtras((prev) => ({
                    ...prev,
                    [section]: {
                      ...((prev as Record<string, any>)[section] ?? {}),
                      [detailKey]: active ? null : opt.value,
                    },
                  }))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-violet-400 bg-violet-50 text-violet-800"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
        {/* Compound detail: state acceptance (e.g. exterior_blinds "preparation" OK?) */}
        {isActive && compound?.states && compound.states.includes("preparation") && (
          <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
            <span className="text-xs text-slate-500">Stačí příprava?</span>
            {([true, false] as const).map((val) => {
              const detailKey = `${f.key}_accept_prep`;
              const current = sec[detailKey] as boolean | undefined;
              const active = current === val;
              return (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setWizardExtras((prev) => ({
                    ...prev,
                    [section]: {
                      ...((prev as Record<string, any>)[section] ?? {}),
                      [detailKey]: active ? null : val,
                    },
                  }))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? val
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                        : "border-rose-400 bg-rose-50 text-rose-800"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                  )}
                >
                  {val ? "Ano" : "Ne"}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /* ─── Step renderers ─── */

  const renderStep1 = () => (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">K čemu bydlení hledáte?</h3>
        <div className="grid grid-cols-2 gap-3">
          {([
            { key: "own_use", label: "Vlastní bydlení", icon: "🏠", desc: "Bydlení pro sebe nebo rodinu" },
            { key: "investment", label: "Investice", icon: "📈", desc: "Nákup za účelem investice" },
          ] as const).map(({ key, label, icon, desc }) => (
            <OptionCard
              key={key}
              active={profile?.purchase_purpose === key}
              onClick={() => setProfile((prev) => ({ ...(prev ?? {}), purchase_purpose: key }))}
              icon={icon}
              label={label}
              desc={desc}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Kdo bude v bytě bydlet?</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { key: "family", label: "Rodina", icon: "👨‍👩‍👧‍👦" },
            { key: "couple", label: "Pár", icon: "💑" },
            { key: "single", label: "Jednotlivec", icon: "🧑" },
            { key: "downsizing", label: "Downsizing", icon: "🏡" },
          ] as const).map(({ key, label, icon }) => (
            <OptionCard
              key={key}
              active={wizardExtras.client_type === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, client_type: prev.client_type === key ? null : key }))}
              icon={icon}
              label={label}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Časový horizont</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {([
            { key: "now", label: "Hned" },
            { key: "3m", label: "Do 3 měsíců" },
            { key: "6m", label: "Do 6 měsíců" },
            { key: "1y", label: "Do roka" },
            { key: "2y+", label: "Za 2+ let" },
            { key: "mapping", label: "Jen mapuji" },
          ] as const).map(({ key, label }) => (
            <OptionCard
              key={key}
              active={wizardExtras.purchase_timeline === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, purchase_timeline: prev.purchase_timeline === key ? null : key }))}
              label={label}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Jaký je váš rozpočet?</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>Ideální cena (Kč)</FieldLabel>
            <input
              type="number"
              value={wizardExtras.budget?.ideal_price ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_price: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Např. 8 500 000"
            />
            {wizardExtras.budget?.ideal_price != null && (
              <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(wizardExtras.budget.ideal_price)}</p>
            )}
          </div>
          <div>
            <FieldLabel>Maximální cena (Kč)</FieldLabel>
            <input
              type="number"
              value={profile?.budget_max ?? ""}
              onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), budget_max: e.target.value ? Number(e.target.value) : null }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Absolutní strop"
            />
            {profile?.budget_max != null && (
              <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(profile.budget_max)}</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Jak budete financovat?</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { key: "cash", label: "Hotově", desc: "Celá částka v hotovosti" },
            { key: "mortgage", label: "Hypotéka", desc: "Financování hypotékou" },
            { key: "combo", label: "Kombinace", desc: "Hotovost + hypotéka" },
            { key: "unknown", label: "Nevím", desc: "Zatím nerozhodnutý/á" },
          ] as const).map(({ key, label, desc }) => (
            <OptionCard
              key={key}
              active={wizardExtras.financing_type === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, financing_type: prev.financing_type === key ? null : key }))}
              label={label}
              desc={desc}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Jakou dispozici hledáte?</h3>
        <div className="flex flex-wrap gap-2">
          {LAYOUT_OPTIONS.map((opt) => {
            const checked = selectedLayouts.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedLayouts((prev) => checked ? prev.filter((v) => v !== opt.value) : [...prev, opt.value])}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  checked
                    ? "border-sky-500 bg-sky-500 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Jak velký byt potřebujete?</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>Ideální plocha (m²)</FieldLabel>
            <input
              type="number"
              value={wizardExtras.budget?.ideal_area ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), ideal_area: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Např. 75"
            />
          </div>
          <div>
            <FieldLabel>Minimální plocha (m²)</FieldLabel>
            <input
              type="number"
              value={profile?.area_min ?? ""}
              onChange={(e) => setProfile((prev) => ({ ...(prev ?? {}), area_min: e.target.value ? Number(e.target.value) : null }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Absolutní minimum"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Venkovní prostor</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>Minimální venkovní prostor (m²)</FieldLabel>
            <input
              type="number"
              value={wizardExtras.budget?.min_outdoor_area_m2 ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, budget: { ...(prev.budget ?? {}), min_outdoor_area_m2: e.target.value ? Number(e.target.value) : null } }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Např. 5"
            />
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel>Jaký typ venkovního prostoru preferujete?</FieldLabel>
          <div className="mt-2 space-y-2">
            {([
              { key: "balcony", label: "Balkón" },
              { key: "terrace", label: "Terasa" },
              { key: "garden", label: "Zahrada" },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{label}</span>
                <PriorityPicker
                  value={(wizardExtras.outdoor?.[key] as string) ?? ""}
                  onChange={(v) => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), [key]: v as Priority } }))}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Patro</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { key: "ignore", label: "Neřeším" },
            { key: "no_ground", label: "Ne přízemí" },
            { key: "top_3", label: "Horní 3 patra" },
            { key: "top_1", label: "Nejvyšší patro" },
          ] as const).map(({ key, label }) => (
            <OptionCard
              key={key}
              active={wizardExtras.outdoor?.floor_rule === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, outdoor: { ...(prev.outdoor ?? {}), floor_rule: key } }))}
              label={label}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Kde chcete bydlet?</h3>
        <p className="mb-4 text-sm text-slate-500">
          Zadejte preferované oblasti. Konkrétní lokality upřesníte s brokerem na mapě.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Preferované obvody / městské části</FieldLabel>
            <input
              type="text"
              value={wizardExtras.location?.administrative_area ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, location: { ...(prev.location ?? {}), administrative_area: e.target.value || null } }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Např. Praha 6, Praha 5"
            />
          </div>
          <div>
            <FieldLabel>Region / kraj</FieldLabel>
            <input
              type="text"
              value={wizardExtras.location?.administrative_region ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, location: { ...(prev.location ?? {}), administrative_region: e.target.value || null } }))}
              className={cn("mt-1.5", inputClass)}
              placeholder="Např. Praha, Středočeský kraj"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Charakter okolí</h3>
        <div className="space-y-4">
          <div>
            <FieldLabel>Klidné bydlení vs. městský život</FieldLabel>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {([
                { key: "calm", label: "Klidné okolí" },
                { key: "city", label: "Městský život" },
                { key: "ignore", label: "Neřeším" },
              ] as const).map(({ key, label }) => (
                <OptionCard
                  key={key}
                  active={wizardExtras.character?.calm_vs_city === key}
                  onClick={() => setWizardExtras((prev) => ({ ...prev, character: { ...(prev.character ?? {}), calm_vs_city: key } }))}
                  label={label}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep5 = () => {
    const step5 = WIZARD_STEPS.find((s) => s.key === "standards")!;
    return (
      <div className="space-y-8">
        {step5.groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 text-base font-semibold text-slate-800">{group.heading}</h3>
            {group.description && (
              <p className="mb-4 text-sm text-slate-500">{group.description}</p>
            )}
            {group.key === "enum" ? (
              <div className="space-y-4">
                {group.fields.map((f) => renderEnumField(f, "standards"))}
              </div>
            ) : (
              <div className="space-y-3">
                {group.fields.map((f) => renderFeatureField(f, "standards"))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderStep6 = () => {
    const step6 = WIZARD_STEPS.find((s) => s.key === "amenities")!;
    return (
      <div className="space-y-8">
        {step6.groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 text-base font-semibold text-slate-800">{group.heading}</h3>
            {group.description && (
              <p className="mb-4 text-sm text-slate-500">{group.description}</p>
            )}
            <div className="space-y-3">
              {group.fields.map((f) => renderFeatureField(f, "house_amenities"))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderNoiseField = (f: WizardField) => {
    const sec = (wizardExtras as Record<string, any>).noise ?? {};
    const val = (sec[f.key] as string) ?? "ignore";
    const noiseOptions = [
      { v: "ignore", label: "Neřeším", color: "border-slate-200 bg-white text-slate-600" },
      { v: "prefer", label: "Vadí mi", color: "border-amber-400 bg-amber-50 text-amber-800" },
      { v: "must", label: "Vyloučit", color: "border-rose-400 bg-rose-50 text-rose-800" },
    ];
    return (
      <div key={f.key} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
        <span className="text-sm font-medium text-slate-700">{f.label}</span>
        <div className="flex gap-1.5">
          {noiseOptions.map(({ v, label, color }) => (
            <button key={v} type="button"
              onClick={() => setWizardExtras((prev) => ({
                ...prev,
                noise: { ...((prev as Record<string, any>).noise ?? {}), [f.key]: v as Priority },
              }))}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                val === v ? color : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderStep7 = () => {
    const step7 = WIZARD_STEPS.find((s) => s.key === "noise")!;
    return (
      <div className="space-y-8">
        {step7.groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 text-base font-semibold text-slate-800">{group.heading}</h3>
            {group.description && (
              <p className="mb-4 text-sm text-slate-500">{group.description}</p>
            )}
            <div className="space-y-3">
              {group.fields.map((f) => renderNoiseField(f))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderStep8 = () => (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Novostavba nebo rekonstrukce?</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {([
            { key: "any", label: "Nezáleží" },
            { key: "prefer_new", label: "Raději novostavba" },
            { key: "only_new", label: "Pouze novostavba" },
            { key: "prefer_renovation", label: "Raději rekonstrukce" },
            { key: "only_renovation", label: "Pouze rekonstrukce" },
          ] as const).map(({ key, label }) => (
            <OptionCard
              key={key}
              active={wizardExtras.renovation_preference === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, renovation_preference: key }))}
              label={label}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Kdy chcete bydlet?</h3>
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: "asap", label: "Co nejdříve" },
            { key: "by_date", label: "Do konkrétního data" },
            { key: "flexible", label: "Flexibilní" },
          ] as const).map(({ key, label }) => (
            <OptionCard
              key={key}
              active={wizardExtras.move_in_timeline === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, move_in_timeline: prev.move_in_timeline === key ? null : key }))}
              label={label}
            />
          ))}
        </div>
        {wizardExtras.move_in_timeline === "by_date" && (
          <div className="mt-3 max-w-xs">
            <FieldLabel>Nejpozději do</FieldLabel>
            <input
              type="date"
              value={wizardExtras.completion_date ?? ""}
              onChange={(e) => setWizardExtras((prev) => ({ ...prev, completion_date: e.target.value || null }))}
              className={cn("mt-1.5", inputClass)}
            />
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-4 text-base font-semibold text-slate-800">Standard dokončení</h3>
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: "shell_and_core", label: "Holá stavba", desc: "Bez vnitřního vybavení" },
            { key: "white_wall", label: "Bílé stěny", desc: "Základní bílá povrchová úprava" },
            { key: "fit_out", label: "Kompletní", desc: "Nastěhování ihned" },
          ] as const).map(({ key, label, desc }) => (
            <OptionCard
              key={key}
              active={wizardExtras.completion_standard === key}
              onClick={() => setWizardExtras((prev) => ({ ...prev, completion_standard: prev.completion_standard === key ? null : key }))}
              label={label}
              desc={desc}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep9 = () => {
    const w = wizardExtras;
    const items: { label: string; value: string | null }[] = [
      { label: "Účel", value: profile?.purchase_purpose === "own_use" ? "Vlastní bydlení" : profile?.purchase_purpose === "investment" ? "Investice" : null },
      { label: "Typ klienta", value: w.client_type ?? null },
      { label: "Časový horizont", value: w.purchase_timeline ?? null },
      { label: "Ideální cena", value: w.budget?.ideal_price ? formatCurrencyCzk(w.budget.ideal_price) : null },
      { label: "Max. cena", value: profile?.budget_max ? formatCurrencyCzk(profile.budget_max) : null },
      { label: "Financování", value: w.financing_type ?? null },
      { label: "Dispozice", value: selectedLayouts.length ? selectedLayouts.join(", ") : null },
      { label: "Ideální plocha", value: w.budget?.ideal_area ? `${w.budget.ideal_area} m²` : null },
      { label: "Min. plocha", value: profile?.area_min ? `${profile.area_min} m²` : null },
      { label: "Min. venkovní prostor", value: w.budget?.min_outdoor_area_m2 ? `${w.budget.min_outdoor_area_m2} m²` : null },
      { label: "Patro", value: w.outdoor?.floor_rule && w.outdoor.floor_rule !== "ignore" ? w.outdoor.floor_rule : null },
      { label: "Lokalita", value: w.location?.administrative_area ?? null },
      { label: "Novostavba/rekonstrukce", value: w.renovation_preference && w.renovation_preference !== "any" ? w.renovation_preference : null },
      { label: "Nastěhování", value: w.move_in_timeline ?? null },
    ];
    const filled = items.filter((i) => i.value);
    const standards: [string, string][] = [];
    const enumStandards: { key: string; label: string; values: string }[] = [];
    // Compound detail keys are rendered inline with their parent feature, not in summary list
    const COMPOUND_DETAIL_KEYS = new Set(["air_conditioning_type", "exterior_blinds_accept_prep"]);
    for (const [k, vRaw] of Object.entries(w.standards ?? {})) {
      if (vRaw === undefined || vRaw === null || vRaw === "ignore") continue;
      if (COMPOUND_DETAIL_KEYS.has(k)) continue;
      // Boolean values (compound details) shouldn't reach here, but be defensive
      if (typeof vRaw === "boolean") continue;
      const v = vRaw;
      // Check if this is an enum field (has options in metadata or hardcoded model)
      const metaField = wizardMeta[`standards.${k}`] ?? wizardMeta[k];
      const staticLabels = ENUM_OPTION_LABELS[k];
      if (staticLabels || metaField?.options) {
        const arr: string[] = Array.isArray(v) ? v : [String(v)];
        // Build label lookup: prefer metadata options, fallback to static
        const optMap: Record<string, string> = {};
        if (metaField?.options) for (const o of metaField.options) optMap[o.value] = o.label;
        if (staticLabels) for (const [ov, ol] of Object.entries(staticLabels)) if (!optMap[ov]) optMap[ov] = ol;
        const labels = arr.map((val) => optMap[val] ?? val).join(", ");
        if (labels) enumStandards.push({ key: k, label: metaField?.label ?? ENUM_FIELD_LABELS[k] ?? k, values: labels });
      } else {
        standards.push([STANDARD_FEATURE_LABELS[k] ?? k, String(v)]);
      }
    }
    const amenities = Object.entries(w.house_amenities ?? {}).filter(([, v]) => v && v !== "ignore") as [string, string][];
    const noise = Object.entries(w.noise ?? {}).filter(([, v]) => v && v !== "ignore") as [string, string][];

    return (
      <div className="space-y-6">
        <h3 className="text-base font-semibold text-slate-800">Shrnutí vašich požadavků</h3>

        {filled.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white">
            {filled.map((item, i) => (
              <div
                key={item.label}
                className={cn(
                  "flex justify-between px-4 py-2.5 text-sm",
                  i < filled.length - 1 && "border-b border-slate-100",
                )}
              >
                <span className="text-slate-500">{item.label}</span>
                <span className="font-medium text-slate-900">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {(standards.length > 0 || enumStandards.length > 0) && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Standardy</p>
            <div className="flex flex-wrap gap-1.5">
              {enumStandards.map((e) => (
                <span key={e.key} className="rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-800">
                  {e.label}: {e.values}
                </span>
              ))}
              {standards.map(([k, v]) => (
                <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                  {k}: {v}
                </span>
              ))}
            </div>
          </div>
        )}

        {amenities.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Vybavení domu</p>
            <div className="flex flex-wrap gap-1.5">
              {amenities.map(([k, v]) => (
                <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                  {k}: {v}
                </span>
              ))}
            </div>
          </div>
        )}

        {noise.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Hluk</p>
            <div className="flex flex-wrap gap-1.5">
              {noise.map(([k, v]) => {
                const noiseLabel = NOISE_LABELS[k] ?? k;
                const levelLabel = v === "must" ? "vyloučit" : v === "prefer" ? "vadí mi" : v;
                return (
                  <span key={k} className={cn("rounded-full px-2.5 py-1 text-xs",
                    v === "must" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800")}>
                    {noiseLabel}: {levelLabel}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {filled.length === 0 && standards.length === 0 && amenities.length === 0 && (
          <p className="text-sm text-slate-500">Zatím jste nevyplnili žádné preference.</p>
        )}
      </div>
    );
  };

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

  /* ─── Render ─── */

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Reamar AI</p>
            <p className="text-xs text-slate-500">{client.name}</p>
          </div>
          <div className="flex items-center gap-3">
            {autoSaveStatus === "saving" && (
              <span className="text-[11px] text-slate-400">Ukládám...</span>
            )}
            {autoSaveStatus === "saved" && (
              <span className="text-[11px] text-emerald-600">Uloženo</span>
            )}
            <span className="text-xs text-slate-400">
              {step}/{TOTAL_STEPS}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-sky-500 transition-all duration-300"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </header>

      {/* Step navigation pills */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl overflow-x-auto px-6 py-2">
          <div className="flex gap-1">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(s)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  s === step
                    ? "bg-sky-100 text-sky-800"
                    : s < step
                      ? "text-slate-600 hover:bg-slate-100"
                      : "text-slate-400 hover:bg-slate-50",
                )}
              >
                {s < step ? "✓ " : ""}
                {STEP_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900">{STEP_LABELS[step]}</h2>
        </div>
        {stepRenderers[step]?.()}
      </main>

      {/* Bottom navigation */}
      <footer className="sticky bottom-0 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 1}
            className={cn(
              "rounded-xl px-5 py-2.5 text-sm font-medium transition-colors",
              step === 1
                ? "cursor-not-allowed text-slate-300"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            ← Zpět
          </button>

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
            >
              Další →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={finishing}
              className="rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {finishing ? "Ukládám..." : "Dokončit a uložit"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

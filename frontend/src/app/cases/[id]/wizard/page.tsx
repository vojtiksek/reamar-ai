"use client";

import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { useCaseData } from "@/hooks/useCaseData";
import { formatCurrencyCzk } from "@/lib/format";
import { API_BASE } from "@/lib/api";
import type { Priority } from "@/lib/caseTypes";
import { normalizeAdminAreaList } from "@/lib/wizardTransform";
import { ClientLocationMap } from "@/components/ClientLocationMap";
import { CommutePointsEditor, type CommutePoint } from "../brief/CommutePointsEditor";
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
  isFieldVisible,
  readFromDataPath,
  type WizardField,
} from "@/lib/wizardModel";
import {
  useWizardMetadata,
  getFieldOptions,
  getCompoundInfo,
  getFieldSemantics,
} from "@/hooks/useWizardMetadata";

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

/* ─── Location autocomplete (text input + dropdown) ───
 *
 *  Free-text input backed by GET /locations/suggest?scope=<scope>.
 *  Dataset is tiny (2 regions, ~35 admin areas) so we fetch once per
 *  scope, cache module-level, then filter client-side on each keystroke.
 *  User can still type free text — suggestions are a quick-pick.  On
 *  blur the dropdown closes after a short delay so a click on a
 *  suggestion registers before the input loses focus.
 */

type LocationSuggestion = { value: string; count: number };

const suggestionCache: Record<string, Promise<LocationSuggestion[]>> = {};

function fetchLocationSuggestions(scope: string): Promise<LocationSuggestion[]> {
  if (scope in suggestionCache) return suggestionCache[scope];
  const promise = fetch(`${API_BASE}/locations/suggest?scope=${encodeURIComponent(scope)}&limit=50`)
    .then((res) => (res.ok ? (res.json() as Promise<LocationSuggestion[]>) : []))
    .catch(() => [] as LocationSuggestion[]);
  suggestionCache[scope] = promise;
  return promise;
}

function SuggestInput({
  value,
  onChange,
  placeholder,
  scope,
}: {
  value: string;
  onChange: (next: string | null) => void;
  placeholder?: string;
  scope: string;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<LocationSuggestion[]>([]);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLocationSuggestions(scope).then((list) => {
      if (!cancelled) setAll(list);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const needle = value.trim().toLowerCase();
  const filtered = needle
    ? all.filter((s) => s.value.toLowerCase().includes(needle))
    : all;
  const display = filtered.slice(0, 12);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value || null);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          // Defer close so a click on a suggestion row still fires.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        className={cn("mt-1.5", inputClass)}
        placeholder={placeholder}
      />
      {open && display.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {display.map((s) => {
            const selected = s.value.toLowerCase() === needle;
            return (
              <li key={s.value}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // onMouseDown (not onClick) so it runs before onBlur.
                    e.preventDefault();
                    onChange(s.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                    selected ? "bg-sky-50 text-sky-900" : "text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <span className="truncate">{s.value}</span>
                  <span className="shrink-0 text-xs text-slate-400">{s.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 *  MultiSuggestInput — chip picker + autocomplete.
 *
 *  Broker/client selects multiple preferred areas (e.g. "Praha 5", "Praha 6").
 *  Chips render above the input; clicking × removes one; Backspace on an
 *  empty input removes the last chip.  Selection sources the same cached
 *  dataset as SuggestInput; already-selected entries are greyed out.
 *  Free-text entries are accepted on Enter/comma.
 */
function MultiSuggestInput({
  values,
  onChange,
  placeholder,
  scope,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  scope: string;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<LocationSuggestion[]>([]);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLocationSuggestions(scope).then((list) => {
      if (!cancelled) setAll(list);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const selectedKeys = new Set(values.map((v) => v.toLowerCase()));

  const addValue = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (selectedKeys.has(key)) {
      setDraft("");
      return;
    }
    onChange([...values, s]);
    setDraft("");
  };

  const removeAt = (idx: number) => {
    const next = values.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const needle = draft.trim().toLowerCase();
  const filtered = needle
    ? all.filter((s) => s.value.toLowerCase().includes(needle))
    : all;
  const display = filtered.slice(0, 12);

  return (
    <div className="relative">
      <div
        className={cn(
          "mt-1.5 flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm",
          "focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100",
        )}
      >
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800"
          >
            {v}
            <button
              type="button"
              aria-label={`Odebrat ${v}`}
              onClick={() => removeAt(i)}
              className="flex h-4 w-4 items-center justify-center rounded-full text-sky-700 transition-colors hover:bg-sky-100 hover:text-sky-900"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addValue(draft);
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              e.preventDefault();
              removeAt(values.length - 1);
            }
          }}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0"
        />
      </div>
      {open && display.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {display.map((s) => {
            const already = selectedKeys.has(s.value.toLowerCase());
            return (
              <li key={s.value}>
                <button
                  type="button"
                  disabled={already}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (already) return;
                    addValue(s.value);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                    already
                      ? "cursor-not-allowed text-slate-300"
                      : "text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <span className="truncate">{s.value}</span>
                  <span className="shrink-0 text-xs text-slate-400">{s.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ─── Main ─── */

export default function ClientWizardPage() {
  const {
    client,
    profile, setProfile,
    selectedLayouts, setSelectedLayouts,
    loading,
    hydrated,
    wizardExtras, setWizardExtras,
    locationPolygons, setLocationPolygons,
    activeAreaIndex, setActiveAreaIndex,
    locationProjects,
    LAYOUT_OPTIONS,
    clientId,
    handleSaveProfile,
    handleNextStep,
    autoSaveStatus,
  } = useCaseData();

  const { fields: wizardMeta } = useWizardMetadata();
  const [step, setStep] = useState(1);
  const [finishing, setFinishing] = useState(false);
  const [mapMode, setMapMode] = useState<"polygon" | "commute">("polygon");
  const [nextCommuteLabel, setNextCommuteLabel] = useState("");
  const [mapTall, setMapTall] = useState(false);
  const [recomputeStatus, setRecomputeStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [matchCount, setMatchCount] = useState<number | null>(null);

  // Save → recompute → show feedback on step 9; navigation handled separately
  const handleFinish = async () => {
    setFinishing(true);
    await handleSaveProfile();
    setFinishing(false);
    setRecomputeStatus("loading");
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/recommendations/recompute`, {
        method: "POST",
      });
      if (res.ok) {
        const data: { created?: number; total_candidates?: number } = await res.json();
        setMatchCount(data.created ?? data.total_candidates ?? 0);
        setRecomputeStatus("done");
      } else {
        setRecomputeStatus("error");
      }
    } catch {
      setRecomputeStatus("error");
    }
  };

  const handleClose = () => {
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

  /* ─── Generic dataPath accessors (top-level + section.key; profile.* and
        selectedLayouts handled explicitly for now) ─── */

  const readField = (f: WizardField): unknown => {
    if (f.dataPath.startsWith("profile.")) {
      const key = f.dataPath.slice("profile.".length);
      return (profile as Record<string, unknown> | null)?.[key];
    }
    if (f.dataPath === "selectedLayouts") return selectedLayouts;
    return readFromDataPath(wizardExtras as unknown as Record<string, unknown>, f.dataPath);
  };

  const writeField = (f: WizardField, value: unknown) => {
    if (f.dataPath.startsWith("profile.")) {
      const key = f.dataPath.slice("profile.".length);
      setProfile((prev) => ({ ...(prev ?? {}), [key]: value } as any));
      return;
    }
    if (f.dataPath === "selectedLayouts") {
      setSelectedLayouts(value as string[]);
      return;
    }
    const parts = f.dataPath.split(".");
    setWizardExtras((prev) => {
      if (parts.length === 1) {
        return { ...prev, [parts[0]]: value } as any;
      }
      // 2-level nesting (section.key)
      const [section, key] = parts;
      const sec = (prev as Record<string, any>)[section] ?? {};
      return { ...prev, [section]: { ...sec, [key]: value } } as any;
    });
  };

  /* ─── Toggle field renderer (single-select option cards) ─── */

  const renderToggleField = (f: WizardField) => {
    if (!isFieldVisible(f, wizardExtras as unknown as Record<string, unknown>)) return null;
    // Top-level toggles look up metadata by bare key; section-scoped ones
    // could pass the section here later.
    const sectionHint = f.dataPath.includes(".") ? f.dataPath.split(".")[0] : undefined;
    const options = getFieldOptions(wizardMeta, f.key, sectionHint, f.options);
    if (options.length === 0) return null;

    const current = readField(f) as string | null | undefined;
    const allowDeselect = f.allow_deselect !== false;
    // Grid layout picks a column count by option count.  Matches the
    // historical hardcoded layouts of the migrated toggle blocks
    // (2 → 2 col, 3 → 3 col, 4 → 2/4 responsive, 5–6 → 3/6, 7+ → 2/3).
    const gridClass =
      options.length === 2
        ? "grid-cols-2"
        : options.length === 3
        ? "grid-cols-3"
        : options.length === 4
        ? "grid-cols-2 sm:grid-cols-4"
        : options.length <= 6
        ? "grid-cols-3 sm:grid-cols-6"
        : "grid-cols-2 sm:grid-cols-3";

    return (
      <div key={f.key}>
        <div className={cn("grid gap-3", gridClass)}>
          {options.map(({ value, label, desc, icon }: any) => {
            const active = current === value;
            return (
              <OptionCard
                key={value}
                active={active}
                onClick={() => {
                  if (active) {
                    if (allowDeselect) writeField(f, null);
                    // else: no-op (clicking the active card does nothing)
                    return;
                  }
                  writeField(f, value);
                }}
                icon={icon}
                label={label}
                desc={desc}
              />
            );
          })}
        </div>
      </div>
    );
  };

  /* ─── Date field renderer ─── */

  const renderDateField = (f: WizardField) => {
    if (!isFieldVisible(f, wizardExtras as unknown as Record<string, unknown>)) return null;
    const current = (readField(f) as string | null | undefined) ?? "";
    return (
      <div key={f.key} className="max-w-xs">
        <FieldLabel>{f.label}</FieldLabel>
        <input
          type="date"
          value={current}
          onChange={(e) => writeField(f, e.target.value || null)}
          className={cn("mt-1.5", inputClass)}
        />
      </div>
    );
  };

  /* ─── Numeric field renderer ─── */

  /**
   * Generic numeric input.  Metadata (wizardMeta["section.key"]) provides:
   *   - placeholder
   *   - unit  (appended to the label as "(Kč)" / "(m²)" / "(%)")
   *   - format: "currency" | "percent" | "plain"  → drives preview
   *   - min / max                                  → HTML validation
   *
   * Falls back to the field definition (f.placeholder, f.unit, f.format)
   * if metadata hasn't loaded yet, so the UI works on first render.
   * Read/write goes through readField/writeField, which already supports
   * profile.*, top-level, and section.key paths — so profile.budget_max
   * and profile.area_min keep working without migration.
   */
  const renderNumericField = (f: WizardField) => {
    if (!isFieldVisible(f, wizardExtras as unknown as Record<string, unknown>)) return null;

    // Metadata keys for numeric fields are section-prefixed by their
    // storage section (e.g. "profile.budget_max", "budget.max_price_tolerance_pct",
    // "outdoor.min_outdoor_area_m2").  The wizardField.dataPath already
    // encodes exactly that path, so we look up metadata by dataPath.
    const meta = wizardMeta[f.dataPath] as
      | {
          placeholder?: string;
          unit?: string;
          format?: "currency" | "percent" | "plain";
          min?: number;
          max?: number;
        }
      | undefined;

    const placeholder = meta?.placeholder ?? f.placeholder ?? "";
    const unit = meta?.unit ?? f.unit ?? "";
    const format = meta?.format ?? f.format ?? "plain";
    const minVal = meta?.min;
    const maxVal = meta?.max;

    const current = readField(f);
    const numericCurrent = typeof current === "number" ? current : null;
    const inputValue = numericCurrent != null ? numericCurrent : "";
    const labelText = unit ? `${f.label} (${unit})` : f.label;

    return (
      <div key={f.key}>
        <FieldLabel>{labelText}</FieldLabel>
        <input
          type="number"
          value={inputValue}
          onChange={(e) => writeField(f, e.target.value ? Number(e.target.value) : null)}
          className={cn("mt-1.5", inputClass)}
          placeholder={placeholder}
          min={minVal}
          max={maxVal}
        />
        {format === "currency" && numericCurrent != null && numericCurrent > 0 && (
          <p className="mt-1 text-xs text-slate-500">{formatCurrencyCzk(numericCurrent)}</p>
        )}
      </div>
    );
  };

  /* ─── Text field renderer ─── */

  const renderTextField = (f: WizardField) => {
    if (!isFieldVisible(f, wizardExtras as unknown as Record<string, unknown>)) return null;
    // Metadata lookup: prefer section-prefixed key, fall back to bare key.
    const sectionHint = f.dataPath.includes(".") ? f.dataPath.split(".")[0] : undefined;
    const meta = sectionHint ? wizardMeta[`${sectionHint}.${f.key}`] : wizardMeta[f.key];
    const placeholder = meta?.placeholder ?? f.placeholder ?? "";
    const suggest = meta?.suggest;
    const multi = !!meta?.multi;

    if (suggest && multi) {
      // Multi-value chip picker. Tolerates legacy string values on read.
      const rawValue = readField(f) as string | string[] | null | undefined;
      const list = normalizeAdminAreaList(rawValue);
      return (
        <div key={f.key}>
          <FieldLabel>{f.label}</FieldLabel>
          <MultiSuggestInput
            values={list}
            onChange={(next) => writeField(f, next.length ? next : null)}
            placeholder={placeholder}
            scope={suggest}
          />
        </div>
      );
    }

    const current = (readField(f) as string | null | undefined) ?? "";
    return (
      <div key={f.key}>
        <FieldLabel>{f.label}</FieldLabel>
        {suggest ? (
          <SuggestInput
            value={current}
            onChange={(next) => writeField(f, next)}
            placeholder={placeholder}
            scope={suggest}
          />
        ) : (
          <input
            type="text"
            value={current}
            onChange={(e) => writeField(f, e.target.value || null)}
            className={cn("mt-1.5", inputClass)}
            placeholder={placeholder}
          />
        )}
      </div>
    );
  };

  /* ─── Bool-toggle / status pill renderer ─── */

  /**
   * Render a boolean status field.  If the metadata carries
   * `note: "edited_on_map"` the pill is read-only — the actual truth lives
   * in a separate editor (map editor, commute editor).  For other bool
   * fields the pill is clickable and toggles the value.
   */
  const renderBoolToggleField = (f: WizardField) => {
    if (!isFieldVisible(f, wizardExtras as unknown as Record<string, unknown>)) return null;
    const sectionHint = f.dataPath.includes(".") ? f.dataPath.split(".")[0] : undefined;
    const meta = sectionHint ? wizardMeta[`${sectionHint}.${f.key}`] : wizardMeta[f.key];
    const note = (meta as { note?: string } | undefined)?.note;
    const readOnly = note === "edited_on_map";
    const current = !!(readField(f) as boolean | null | undefined);

    const statusLabel = current ? "Nastaveno" : "Nenastaveno";
    const statusHint = readOnly
      ? current
        ? "Upravte na mapě"
        : "Zatím nevybráno na mapě"
      : null;

    return (
      <div
        key={f.key}
        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3"
      >
        <div>
          <div className="text-sm font-medium text-slate-700">{f.label}</div>
          {statusHint && (
            <div className="mt-0.5 text-xs text-slate-500">{statusHint}</div>
          )}
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            if (readOnly) return;
            writeField(f, !current);
          }}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            current
              ? "border-emerald-400 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-white text-slate-500",
            !readOnly && "hover:border-slate-300",
            readOnly && "cursor-default",
          )}
        >
          {statusLabel}
        </button>
      </div>
    );
  };

  /* ─── Step renderers ─── */

  const renderStep1 = () => {
    const step1 = WIZARD_STEPS.find((s) => s.key === "about")!;
    // All Step 1 fields are toggles.  Iterate groups → render each toggle
    // field via the generic renderToggleField.
    return (
      <div className="space-y-8">
        {step1.groups.map((group) => {
          const toggleFields = group.fields.filter(
            (f) => f.render === "toggle" && f.visibility !== "broker",
          );
          if (toggleFields.length === 0) return null;
          return (
            <div key={group.key}>
              <h3 className="mb-4 text-base font-semibold text-slate-800">{group.heading}</h3>
              {toggleFields.map((f) => renderToggleField(f))}
            </div>
          );
        })}
      </div>
    );
  };

  const renderStep2 = () => {
    const step2 = WIZARD_STEPS.find((s) => s.key === "budget")!;
    const priceGroup = step2.groups.find((g) => g.key === "price");
    const financingGroup = step2.groups.find((g) => g.key === "financing");
    // Filter: numeric fields visible in the fullscreen (client) view.
    // Broker-only numeric fields (max_payment_contract_pct,
    // max_payment_construction_pct) stay out of this step — they belong to
    // the broker quick-edit.
    const priceFields =
      priceGroup?.fields.filter(
        (f) => f.render === "numeric" && f.visibility !== "broker",
      ) ?? [];
    const financingFields =
      financingGroup?.fields.filter(
        (f) => f.render === "toggle" && f.visibility !== "broker",
      ) ?? [];

    return (
      <div className="space-y-8">
        {priceGroup && (
          <div>
            <h3 className="mb-4 text-base font-semibold text-slate-800">{priceGroup.heading}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {priceFields.map((f) => renderNumericField(f))}
            </div>
          </div>
        )}

        {financingGroup && financingFields.length > 0 && (
          <div>
            <h3 className="mb-4 text-base font-semibold text-slate-800">{financingGroup.heading}</h3>
            {financingFields.map((f) => renderToggleField(f))}
          </div>
        )}
      </div>
    );
  };

  const renderStep3 = () => {
    const step3 = WIZARD_STEPS.find((s) => s.key === "layout")!;
    const areaGroup = step3.groups.find((g) => g.key === "area");
    const outdoorGroup = step3.groups.find((g) => g.key === "outdoor");
    const floorGroup = step3.groups.find((g) => g.key === "floor");
    // Numeric fields visible in the fullscreen (client) wizard.  Broker-only
    // fields, if any are added later, will naturally be filtered out.
    const areaFields =
      areaGroup?.fields.filter(
        (f) => f.render === "numeric" && f.visibility !== "broker",
      ) ?? [];
    const outdoorFields =
      outdoorGroup?.fields.filter(
        (f) => f.render === "numeric" && f.visibility !== "broker",
      ) ?? [];
    const floorFields =
      floorGroup?.fields.filter(
        (f) => f.render === "toggle" && f.visibility !== "broker",
      ) ?? [];

    return (
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

      {areaGroup && (
        <div>
          <h3 className="mb-4 text-base font-semibold text-slate-800">{areaGroup.heading}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {areaFields.map((f) => renderNumericField(f))}
          </div>
        </div>
      )}

      {outdoorGroup && (
        <div>
          <h3 className="mb-4 text-base font-semibold text-slate-800">{outdoorGroup.heading}</h3>
          <p className="mb-4 text-sm text-slate-500">
            Balkon, terasa nebo zahrada — pojmenování se u projektů liší, proto se ptáme jen na minimální plochu.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {outdoorFields.map((f) => renderNumericField(f))}
          </div>
        </div>
      )}

      {floorGroup && floorFields.length > 0 && (
        <div>
          <h3 className="mb-4 text-base font-semibold text-slate-800">{floorGroup.heading}</h3>
          {floorFields.map((f) => renderToggleField(f))}
        </div>
      )}
    </div>
    );
  };

  const renderStep4 = () => {
    const step4 = WIZARD_STEPS.find((s) => s.key === "location")!;
    const areaGroup = step4.groups.find((g) => g.key === "area");
    const characterGroup = step4.groups.find((g) => g.key === "character");
    // Split area-group fields into two visual rows:
    //   1) text inputs go into a 2-col grid
    //   2) bool_toggle status pills go into a vertical stack
    // Rendering is driven by `f.render` from wizardModel (metadata-driven
    // dispatch, same pattern as renderStep8).
    const textFields = areaGroup?.fields.filter((f) => f.render === "text") ?? [];
    const boolFields = areaGroup?.fields.filter((f) => f.render === "bool_toggle") ?? [];
    const characterFields =
      characterGroup?.fields.filter(
        (f) => f.render === "toggle" && f.visibility !== "broker",
      ) ?? [];

    const commutePoints = (wizardExtras.commute?.points ?? []) as CommutePoint[];
    const canAddMore = commutePoints.length < 4;
    const showPolygon = wizardExtras.location?.method_polygon ?? true;
    const showCommute = !!wizardExtras.location?.method_commute;
    const showMap = showPolygon || showCommute;
    const bothActive = showPolygon && showCommute;
    const effectiveMapMode = bothActive ? mapMode : showCommute ? "commute" : "polygon";

    return (
      <div className="space-y-8">
        {areaGroup && (
          <div>
            <h3 className="mb-4 text-base font-semibold text-slate-800">{areaGroup.heading}</h3>
            {areaGroup.description && (
              <p className="mb-4 text-sm text-slate-500">{areaGroup.description}</p>
            )}
            {/* Location methods — explicit rows for clarity */}
            <div className="mb-4 space-y-2">
              {/* Polygon — status driven by map drawing */}
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-700">Oblast na mapě</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {locationPolygons.some((a) => a.length >= 3)
                      ? "Oblast nakreslena — klikněte tlačítko Kreslit oblast pro úpravu"
                      : "Zakreslete oblast klikáním do mapy níže"}
                  </div>
                </div>
                <span className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  locationPolygons.some((a) => a.length >= 3)
                    ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-400"
                )}>
                  {locationPolygons.some((a) => a.length >= 3) ? "Nakresleno" : "Nenakresleno"}
                </span>
              </div>

              {/* Commute — explicit toggle with CTA hint */}
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-700">Dojezdové body</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {showCommute
                      ? commutePoints.length > 0
                        ? `${commutePoints.length} ${commutePoints.length === 1 ? "bod přidán" : "body přidány"} — klikejte do mapy pro další`
                        : "Zapnuto — vyberte typ bodu a klikněte do mapy"
                      : "Filtrovat projekty podle dojezdové vzdálenosti"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !showCommute;
                    setWizardExtras((prev) => ({
                      ...prev,
                      location: { ...(prev.location ?? {}), method_commute: next },
                    }));
                    if (next) setMapMode("commute");
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    showCommute
                      ? "border-violet-400 bg-violet-50 text-violet-800"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  )}
                >
                  {showCommute ? "Zapnuto" : "Zapnout"}
                </button>
              </div>

              {/* Admin hard filter — label changed in wizardModel */}
              {boolFields.filter((f) => f.key === "method_admin").map((f) => renderBoolToggleField(f))}
            </div>
            {textFields.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                {textFields.map((f) => renderTextField(f))}
              </div>
            )}
          </div>
        )}

        {/* Map: polygon drawing + commute point placement */}
        {showMap && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              {bothActive ? (
                <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[11px]">
                  <button type="button"
                    onClick={() => { setMapMode("polygon"); setNextCommuteLabel(""); }}
                    className={cn("px-2.5 py-1 transition-colors",
                      effectiveMapMode === "polygon" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                    Oblast
                  </button>
                  <button type="button"
                    onClick={() => setMapMode("commute")}
                    className={cn("border-l border-slate-200 px-2.5 py-1 transition-colors",
                      effectiveMapMode === "commute" ? "bg-violet-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                    Dojezdové body
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-slate-500">
                  {effectiveMapMode === "commute"
                    ? "Vyberte typ bodu níže a klikněte do mapy"
                    : "Klikněte Kreslit oblast a klikejte do mapy"}
                </span>
              )}
              <button
                type="button"
                onClick={() => setMapTall((t) => !t)}
                className="text-[11px] text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-700"
              >
                {mapTall ? "Zmenšit mapu" : "Zvětšit mapu"}
              </button>
            </div>

            {effectiveMapMode === "commute" && (
              canAddMore ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-medium text-slate-500">Typ bodu:</span>
                    {["Práce", "Škola", "Školka", "Vlastní"].map((preset) => (
                      <button key={preset} type="button"
                        onClick={() => setNextCommuteLabel(nextCommuteLabel === preset || preset === "Vlastní" ? "" : preset)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                          nextCommuteLabel === preset
                            ? "border-violet-600 bg-violet-600 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                        )}>
                        {preset}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-violet-700">
                    {nextCommuteLabel
                      ? `Vybráno „${nextCommuteLabel}" — klikněte do mapy`
                      : "Vyberte typ bodu výše a klikněte do mapy"}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  4 body jsou maximum — odeberte bod v editoru níže.
                </p>
              )
            )}

            <ClientLocationMap
              areas={locationPolygons}
              activeAreaIndex={activeAreaIndex}
              projects={locationProjects}
              onChange={(next) => {
                setLocationPolygons(next);
                if (activeAreaIndex >= next.length) setActiveAreaIndex(Math.max(0, next.length - 1));
                // Auto-enable polygon method when user draws
                if (next.length > 0 && !wizardExtras.location?.method_polygon) {
                  setWizardExtras((prev) => ({ ...prev, location: { ...(prev.location ?? {}), method_polygon: true } }));
                }
              }}
              onActiveAreaChange={setActiveAreaIndex}
              mapMode={effectiveMapMode}
              tall={mapTall}
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
            {showCommute && (
              <CommutePointsEditor
                points={commutePoints}
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
        )}

        {characterGroup && characterFields.length > 0 && (
          <div>
            <h3 className="mb-4 text-base font-semibold text-slate-800">{characterGroup.heading}</h3>
            <div className="space-y-4">
              {characterFields.map((f) => (
                <div key={f.key}>
                  <FieldLabel>{f.label}</FieldLabel>
                  <div className="mt-2">{renderToggleField(f)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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

  /**
   * Generic renderer for fields that use a tri-state "negative constraint"
   * semantics (noise-style: ignore / prefer / must, where higher severity
   * means stricter filtering).  State labels are driven by the backend
   * metadata (`custom_state_labels`); colors and visual layout are a UI
   * concern and stay here.  If metadata is not (yet) loaded, we fall back to
   * the hardcoded Czech labels to avoid blank UI on first render.
   */
  const NEGATIVE_CONSTRAINT_FALLBACK: Array<[string, string]> = [
    ["ignore", "Neřeším"],
    ["prefer", "Vadí mi"],
    ["must", "Vyloučit"],
  ];
  const NEGATIVE_CONSTRAINT_COLORS: Record<string, string> = {
    ignore: "border-slate-200 bg-white text-slate-600",
    prefer: "border-amber-400 bg-amber-50 text-amber-800",
    must: "border-rose-400 bg-rose-50 text-rose-800",
  };

  const renderNegativeConstraintField = (f: WizardField, section: string) => {
    const sec = (wizardExtras as Record<string, any>)[section] ?? {};
    const val = (sec[f.key] as string) ?? "ignore";
    const semanticsMeta = getFieldSemantics(wizardMeta, f.key, section);
    const states = semanticsMeta?.states ?? NEGATIVE_CONSTRAINT_FALLBACK;

    return (
      <div
        key={f.key}
        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3"
      >
        <span className="text-sm font-medium text-slate-700">{f.label}</span>
        <div className="flex gap-1.5">
          {states.map(([stateKey, label]) => {
            const active = val === stateKey;
            const activeColor =
              NEGATIVE_CONSTRAINT_COLORS[stateKey] ??
              "border-slate-400 bg-slate-50 text-slate-800";
            return (
              <button
                key={stateKey}
                type="button"
                onClick={() =>
                  setWizardExtras((prev) => ({
                    ...prev,
                    [section]: {
                      ...((prev as Record<string, any>)[section] ?? {}),
                      [f.key]: stateKey as Priority,
                    },
                  }))
                }
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? activeColor
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Kept as a thin wrapper so existing callers (renderStep7, summary, etc.)
  // don't have to know about the generic semantics-based renderer.
  const renderNoiseField = (f: WizardField) =>
    renderNegativeConstraintField(f, "noise");

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

  const renderStep8 = () => {
    const step8 = WIZARD_STEPS.find((s) => s.key === "completion")!;
    // Fullscreen client wizard hides broker-only fields (earliest/latest_move_in,
    // assignment_important).  Filter at the field level so new broker fields
    // added to wizardModel automatically stay out of the client view.
    return (
      <div className="space-y-8">
        {step8.groups.map((group) => {
          const visible = group.fields.filter((f) => f.visibility !== "broker");
          if (visible.length === 0) return null;
          return (
            <div key={group.key}>
              <h3 className="mb-4 text-base font-semibold text-slate-800">{group.heading}</h3>
              {group.description && (
                <p className="mb-2 text-sm text-slate-500">{group.description}</p>
              )}
              <div className="space-y-3">
                {visible.map((f) => {
                  if (f.render === "toggle") return renderToggleField(f);
                  if (f.render === "date") return renderDateField(f);
                  return null;
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStep9 = () => {
    const w = wizardExtras;
    const items: { label: string; value: string | null }[] = [
      { label: "Účel", value: profile?.purchase_purpose === "own_use" ? "Vlastní bydlení" : profile?.purchase_purpose === "investment" ? "Investice" : null },
      { label: "Typ klienta", value: w.client_type ?? null },
      { label: "Časový horizont", value: w.purchase_timeline ?? null },
      { label: "Max. cena", value: profile?.budget_max ? formatCurrencyCzk(profile.budget_max) : null },
      { label: "Tolerance ceny", value: w.budget?.max_price_tolerance_pct != null ? `${w.budget.max_price_tolerance_pct} %` : null },
      { label: "Financování", value: w.financing_type ?? null },
      { label: "Dispozice", value: selectedLayouts.length ? selectedLayouts.join(", ") : null },
      { label: "Min. plocha", value: profile?.area_min ? `${profile.area_min} m²` : null },
      { label: "Tolerance plochy", value: w.budget?.max_area_tolerance_pct != null ? `${w.budget.max_area_tolerance_pct} %` : null },
      { label: "Min. venkovní prostor", value: w.outdoor?.min_outdoor_area_m2 ? `${w.outdoor.min_outdoor_area_m2} m²` : null },
      { label: "Tolerance venkovní plochy", value: w.budget?.max_outdoor_tolerance_pct != null ? `${w.budget.max_outdoor_tolerance_pct} %` : null },
      { label: "Patro", value: w.outdoor?.floor_rule && w.outdoor.floor_rule !== "ignore" ? w.outdoor.floor_rule : null },
      {
        label: "Lokalita",
        value: (() => {
          const list = normalizeAdminAreaList(w.location?.administrative_area);
          return list.length ? list.join(", ") : null;
        })(),
      },
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
                // Prefer metadata label; fall back to legacy static map.
                const noiseLabel =
                  wizardMeta[`noise.${k}`]?.label ?? NOISE_LABELS[k] ?? k;
                // Prefer metadata custom_state_labels for severity label.
                const semanticsMeta = getFieldSemantics(wizardMeta, k, "noise");
                const stateLabel =
                  semanticsMeta?.states.find(([sk]) => sk === v)?.[1] ??
                  (v === "must" ? "Vyloučit" : v === "prefer" ? "Vadí mi" : v);
                return (
                  <span key={k} className={cn("rounded-full px-2.5 py-1 text-xs",
                    v === "must" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800")}>
                    {noiseLabel}: {stateLabel.toLowerCase()}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {filled.length === 0 && standards.length === 0 && amenities.length === 0 && (
          <p className="text-sm text-slate-500">Zatím jste nevyplnili žádné preference.</p>
        )}

        {/* Recompute feedback — shown after Dokončit is clicked */}
        {recomputeStatus === "loading" && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center">
            <p className="text-sm text-slate-500">Počítám doporučení…</p>
          </div>
        )}
        {recomputeStatus === "done" && matchCount !== null && (
          <div className={cn(
            "mt-6 rounded-xl border px-5 py-5 text-center",
            matchCount === 0
              ? "border-rose-200 bg-rose-50"
              : matchCount < 10
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          )}>
            <p className="text-lg font-semibold text-slate-900">
              Nalezeno {matchCount} doporučení
            </p>
            <p className={cn(
              "mt-1 text-sm",
              matchCount === 0 ? "text-rose-600" : matchCount < 10 ? "text-amber-700" : "text-emerald-700"
            )}>
              {matchCount === 0
                ? "Žádné výsledky — zkuste upravit filtry"
                : matchCount < 10
                ? "Velmi omezený výběr"
                : matchCount < 100
                ? "Dobrý výběr"
                : "Široký výběr"}
            </p>
          </div>
        )}
        {recomputeStatus === "error" && (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-center">
            <p className="text-sm text-rose-600">Nepodařilo se spustit analýzu — zkuste znovu.</p>
          </div>
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
          ) : recomputeStatus === "done" ? (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
            >
              Zobrazit výsledky →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={finishing || recomputeStatus === "loading"}
              className="rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {finishing ? "Ukládám..." : recomputeStatus === "loading" ? "Počítám…" : "Dokončit a uložit"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

"use client";

import type { WalkabilityPreferences, WalkabilityPreferenceValue } from "@/lib/walkabilityPreferences";

type Item = { key: keyof WalkabilityPreferences; label: string };

type Props = {
  title: string;
  items: Item[];
  prefs: WalkabilityPreferences;
  onChange(next: WalkabilityPreferences): void;
};

const OPTIONS: { value: WalkabilityPreferenceValue; label: string; active: string }[] = [
  { value: "required", label: "Musí", active: "bg-emerald-500 text-white" },
  { value: "high", label: "Chci", active: "bg-blue-500 text-white" },
  { value: "ignore", label: "Ne", active: "bg-slate-200 text-slate-800" },
];

export function WalkabilityPreferencesGroup({ title, items, prefs, onChange }: Props) {
  const update = (key: keyof WalkabilityPreferences, value: WalkabilityPreferenceValue) => {
    if (prefs[key] === value) return;
    onChange({ ...prefs, [key]: value });
  };

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="space-y-1.5">
        {items.map((item) => {
          // Normalize legacy "normal" to "ignore" for display
          const raw = prefs[item.key];
          const value = raw === "normal" ? "ignore" : raw;
          return (
            <div key={item.key} className="flex items-center justify-between py-0.5">
              <span className="text-sm text-slate-800">{item.label}</span>
              <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11px]">
                {OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => update(item.key, o.value)}
                    className={
                      "px-2.5 py-0.5 rounded-full transition-colors " +
                      (value === o.value ? o.active : "text-slate-600 hover:text-slate-800")
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

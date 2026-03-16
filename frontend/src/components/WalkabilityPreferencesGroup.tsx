"use client";

import type { WalkabilityPreferences, WalkabilityPreferenceValue } from "@/lib/walkabilityPreferences";

type Item = { key: keyof WalkabilityPreferences; label: string };

type Props = {
  title: string;
  items: Item[];
  prefs: WalkabilityPreferences;
  onChange(next: WalkabilityPreferences): void;
};

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
          const value = prefs[item.key];
          return (
            <div key={item.key} className="flex items-center justify-between py-0.5">
              <span className="text-sm text-slate-800">{item.label}</span>
              <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => update(item.key, "high")}
                  className={
                    "px-2 py-0.5 rounded-full " +
                    (value === "high" ? "bg-emerald-500 text-white" : "text-slate-600 hover:text-slate-800")
                  }
                >
                  Vysoká
                </button>
                <button
                  type="button"
                  onClick={() => update(item.key, "normal")}
                  className={
                    "px-2 py-0.5 rounded-full " +
                    (value === "normal" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-800")
                  }
                >
                  Normální
                </button>
                <button
                  type="button"
                  onClick={() => update(item.key, "ignore")}
                  className={
                    "px-2 py-0.5 rounded-full " +
                    (value === "ignore" ? "bg-slate-200 text-slate-800" : "text-slate-500 hover:text-slate-700")
                  }
                >
                  Nezajímá
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


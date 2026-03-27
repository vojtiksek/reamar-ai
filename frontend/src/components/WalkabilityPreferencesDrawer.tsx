"use client";

import type { WalkabilityPreferences } from "@/lib/walkabilityPreferences";
import { DEFAULT_PREFERENCES } from "@/lib/walkabilityPreferences";
import { WalkabilityPreferencesGroup } from "./WalkabilityPreferencesGroup";

type Props = {
  open: boolean;
  value: WalkabilityPreferences;
  onChange(next: WalkabilityPreferences): void;
  onClose(): void;
  onApply(): void;
  onReset(): void;
};

export function WalkabilityPreferencesDrawer({ open, value, onChange, onClose, onApply, onReset }: Props) {
  if (!open) return null;

  const setPreset = (preset: "family" | "city" | "calm") => {
    let next: WalkabilityPreferences = { ...DEFAULT_PREFERENCES };
    if (preset === "family") {
      next = {
        ...DEFAULT_PREFERENCES,
        park: "high",
        kindergarten: "high",
        primary_school: "high",
        playground: "high",
      };
    } else if (preset === "city") {
      next = {
        ...DEFAULT_PREFERENCES,
        metro: "high",
        tram: "high",
        bus: "high",
        restaurant: "high",
        cafe: "high",
        fitness: "high",
      };
    } else if (preset === "calm") {
      next = {
        ...DEFAULT_PREFERENCES,
        park: "high",
      };
    }
    onChange(next);
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="flex w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Preference lokality</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Zavřít
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Presety</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="glass-pill px-3 py-1 text-xs"
                onClick={() => setPreset("family")}
              >
                Rodina
              </button>
              <button
                type="button"
                className="glass-pill px-3 py-1 text-xs"
                onClick={() => setPreset("city")}
              >
                Městský život
              </button>
              <button
                type="button"
                className="glass-pill px-3 py-1 text-xs"
                onClick={() => setPreset("calm")}
              >
                Klid a zeleň
              </button>
              <span className="text-[11px] text-slate-500">Vlastní nastavení podle úprav níže.</span>
            </div>
          </div>

          <WalkabilityPreferencesGroup
            title="Denní potřeby"
            items={[
              { key: "supermarket", label: "Supermarket" },
              { key: "pharmacy", label: "Lékárna" },
            ]}
            prefs={value}
            onChange={onChange}
          />
          <WalkabilityPreferencesGroup
            title="Doprava"
            items={[
              { key: "metro", label: "Metro" },
              { key: "tram", label: "Tramvaj" },
              { key: "bus", label: "Bus" },
            ]}
            prefs={value}
            onChange={onChange}
          />
          <WalkabilityPreferencesGroup
            title="Volný čas"
            items={[
              { key: "park", label: "Park" },
              { key: "restaurant", label: "Restaurace" },
              { key: "cafe", label: "Kavárna" },
              { key: "fitness", label: "Fitness" },
            ]}
            prefs={value}
            onChange={onChange}
          />
          <WalkabilityPreferencesGroup
            title="Rodina"
            items={[
              { key: "kindergarten", label: "Školka" },
              { key: "primary_school", label: "ZŠ" },
              { key: "playground", label: "Hřiště" },
            ]}
            prefs={value}
            onChange={onChange}
          />
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="text-xs text-slate-600 hover:text-slate-800"
            onClick={onReset}
          >
            Reset na výchozí
          </button>
          <button
            type="button"
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
            onClick={onApply}
          >
            Použít
          </button>
        </div>
      </aside>
    </div>
  );
}


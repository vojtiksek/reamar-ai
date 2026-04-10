"use client";

/**
 * CommutePointsEditor — minimal fullscreen wizard editor for commute points.
 *
 * Data contract matches exactly what useCaseData.ts hydrates/serializes
 * (commute_points_json → wizardExtras.commute.points), so no transform is
 * needed on either side.
 *
 * Scope (MVP):
 *   - list existing points as compact rows
 *   - add a new point via AddressSearch (geocoded via Nominatim)
 *   - per-point inline edit: label, max_minutes, mode, priority
 *   - delete a point
 *   - preset quick-picker (Práce / Škola / Školka / Vlastní) that only seeds
 *     the label for the next added point
 *
 * Intentionally out of scope for this phase:
 *   - map picker / drawing on map
 *   - tolerance_minutes (defaults to 0; advanced field)
 *   - travel-time preview (backend routing is internal)
 *   - reorder / drag-drop
 */

import { useState } from "react";
import clsx from "clsx";

import { AddressSearch } from "@/components/AddressSearch";
import {
  ReamarButton,
  ReamarSubtleCard,
  reamarInputClass,
  reamarLabelClass,
  reamarSelectClass,
} from "@/components/ui/reamar-ui";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type CommutePoint = {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  mode: "drive" | "transit";
  max_minutes: number | null;
  priority: "must_have" | "prefer" | "ignore";
  tolerance_minutes?: number | null;
  address?: string | null;
  place_id?: string | null;
};

type Props = {
  points: CommutePoint[];
  onChange: (next: CommutePoint[]) => void;
  /** Maximum number of points allowed. When reached, the add-new section is hidden. */
  maxPoints?: number;
};

// ────────────────────────────────────────────────────────────────────────
// Preset templates (seed the label only; broker can override later)
// ────────────────────────────────────────────────────────────────────────

const PRESETS: { key: string; label: string; icon: string }[] = [
  { key: "work",       label: "Práce",   icon: "💼" },
  { key: "school",     label: "Škola",   icon: "🎓" },
  { key: "preschool",  label: "Školka",  icon: "🧸" },
  { key: "custom",     label: "Vlastní", icon: "📍" },
];

const MODE_OPTIONS: { value: CommutePoint["mode"]; label: string }[] = [
  { value: "transit", label: "MHD" },
  { value: "drive",   label: "Auto" },
];

const PRIORITY_OPTIONS: { value: CommutePoint["priority"]; label: string }[] = [
  { value: "must_have", label: "Musí být" },
  { value: "prefer",    label: "Preferovaně" },
  { value: "ignore",    label: "Ignorovat" },
];

// Stable-ish random ID — no external deps
const newId = () =>
  `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function CommutePointsEditor({ points, onChange, maxPoints }: Props) {
  // `pendingLabel` is the label the next added point will take (from preset
  // click).  Reset to "" after the point is added.
  const [pendingLabel, setPendingLabel] = useState<string>("");

  const updatePoint = (id: string, patch: Partial<CommutePoint>) => {
    onChange(points.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePoint = (id: string) => {
    onChange(points.filter((p) => p.id !== id));
  };

  const addPoint = (result: {
    label: string;
    lat: number;
    lng: number;
    address: string;
    place_id: string;
  }) => {
    const label = (pendingLabel || result.label).trim() || "Bod";
    const next: CommutePoint = {
      id: newId(),
      label,
      lat: result.lat,
      lng: result.lng,
      mode: "transit",
      max_minutes: 30,
      priority: "prefer",
      tolerance_minutes: 0,
      address: result.address,
      place_id: result.place_id,
    };
    onChange([...points, next]);
    setPendingLabel("");
  };

  return (
    <ReamarSubtleCard className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Dojezdové body
          </h5>
          <p className="mt-1 text-[11px] text-slate-500">
            Zadejte klíčová místa (práce, škola, …). Priorita „Musí být“ se chová
            jako hard filter — projekty mimo časový limit vypadnou.
          </p>
        </div>
        {points.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {points.length}
          </span>
        )}
      </div>

      {/* Existing points ──────────────────────────────────────────── */}
      {points.length > 0 && (
        <ul className="space-y-2">
          {points.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-slate-200 bg-white p-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={p.label}
                    onChange={(e) => updatePoint(p.id, { label: e.target.value })}
                    className={cn("text-xs font-semibold", reamarInputClass)}
                    placeholder="Název (např. Práce)"
                  />
                  {p.address && (
                    <p
                      className="mt-1 truncate text-[11px] text-slate-500"
                      title={p.address}
                    >
                      {p.address}
                    </p>
                  )}
                  {(p.lat === null || p.lng === null) && (
                    <p className="mt-1 text-[11px] text-amber-600">
                      Chybí souřadnice — tento bod nebude použit ve skórování.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removePoint(p.id)}
                  className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600"
                  title="Odebrat bod"
                >
                  ✕
                </button>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  <label className={reamarLabelClass}>Max čas (min)</label>
                  <input
                    type="number"
                    min={0}
                    value={p.max_minutes ?? ""}
                    onChange={(e) =>
                      updatePoint(p.id, {
                        max_minutes: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className={cn("mt-1 text-xs", reamarInputClass)}
                    placeholder="Např. 30"
                  />
                </div>
                <div>
                  <label className={reamarLabelClass}>Doprava</label>
                  <select
                    value={p.mode}
                    onChange={(e) =>
                      updatePoint(p.id, {
                        mode: e.target.value as CommutePoint["mode"],
                      })
                    }
                    className={cn("mt-1 text-xs", reamarSelectClass)}
                  >
                    {MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={reamarLabelClass}>Priorita</label>
                  <select
                    value={p.priority}
                    onChange={(e) =>
                      updatePoint(p.id, {
                        priority: e.target.value as CommutePoint["priority"],
                      })
                    }
                    className={cn("mt-1 text-xs", reamarSelectClass)}
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add-new-point flow ───────────────────────────────────────── */}
      {maxPoints != null && points.length >= maxPoints ? (
        <p className="text-[11px] text-slate-400">
          Dosažen limit {maxPoints} bodů — odeberte bod pro přidání nového.
        </p>
      ) : (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-slate-500">
            Typ:
          </span>
          {PRESETS.map((preset) => {
            const active = pendingLabel === preset.label;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() =>
                  setPendingLabel(active ? "" : preset.key === "custom" ? "" : preset.label)
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                )}
              >
                <span className="mr-1">{preset.icon}</span>
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="mt-2">
          <AddressSearch
            placeholder={
              pendingLabel
                ? `Adresa pro „${pendingLabel}“…`
                : "Hledat adresu (práce, škola, …)…"
            }
            onSelect={addPoint}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500">
          Po výběru z nabídky se bod přidá s výchozími hodnotami (30 min, MHD,
          Preferovaně). Můžete je upravit kdykoli níže.
        </p>
      </div>
      )}

      {points.length === 0 && (
        <p className="text-[11px] italic text-slate-500">
          Zatím nejsou přidané žádné body. Vyberte typ a začněte psát adresu.
        </p>
      )}

      {/* Clear-all helper ─────────────────────────────────────────── */}
      {points.length > 1 && (
        <div className="flex justify-end">
          <ReamarButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
          >
            Smazat vše
          </ReamarButton>
        </div>
      )}
    </ReamarSubtleCard>
  );
}

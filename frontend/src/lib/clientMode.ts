/**
 * Client Mode — foundation types and pure mapping helpers.
 *
 * The wizard defines an immutable **base profile**.  The broker can then
 * diverge from it through **working filters** in the client zone; changes
 * are tracked via `modifiedKeys` so we can (a) show which filters were
 * manually edited and (b) reset them back to the base profile.
 *
 * Helpers in this file MUST stay pure: no API calls, no DOM access, no
 * side effects.  They are consumed both from the `useCaseData` hook and
 * from the (future) client-zone UI, so keep the signatures stable.
 */

import type { ClientProfile, WizardExtras } from "@/lib/caseTypes";
import { normalizeAdminAreaList } from "@/lib/wizardTransform";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClientLocationMode = "polygon" | "admin_area" | "none";

/** Immutable snapshot of what the wizard produced — used as the reset target. */
export type ClientProfileBase = {
  budgetMax?: number | null;
  areaMin?: number | null;
  propertyTypes?: string[];
  layouts?: string[];
  locationMode?: ClientLocationMode;
  polygon?: unknown;
  adminAreas?: string[];
  renovationPreference?: string | null;
};

/** Editable filter state the broker works with in the client zone. */
export type WorkingFilters = {
  budgetMax?: number | null;
  areaMin?: number | null;
  propertyTypes?: string[];
  layouts?: string[];
  locationMode?: ClientLocationMode;
  polygon?: unknown;
  adminAreas?: string[];
  renovationPreference?: string | null;
  hideBelowScore?: number | null;
  visibleLimit?: number | null;
};

export type ClientModeState = {
  baseProfile: ClientProfileBase;
  workingFilters: WorkingFilters;
  /** Keys in `WorkingFilters` that the broker has manually modified. */
  modifiedKeys: string[];
  /** Timestamp of the last working-filters save (not recommendations recompute). */
  filtersUpdatedAt?: string | null;
};

/** Keys that appear in both ClientProfileBase and WorkingFilters. */
export const WORKING_FILTER_KEYS = [
  "budgetMax",
  "areaMin",
  "propertyTypes",
  "layouts",
  "locationMode",
  "polygon",
  "adminAreas",
  "renovationPreference",
  "hideBelowScore",
  "visibleLimit",
] as const;

export type WorkingFilterKey = (typeof WORKING_FILTER_KEYS)[number];

// ---------------------------------------------------------------------------
// Helpers — pure, deterministic
// ---------------------------------------------------------------------------

/** Normalize a renovation preference value (drops empty/ignore variants). */
function normalizeRenovation(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "any" || s === "ignore") return null;
  return s;
}

/** Derive locationMode from wizard location flags + profile state. */
function deriveLocationMode(
  wizard: WizardExtras | null | undefined,
  profile: ClientProfile | null | undefined,
): ClientLocationMode {
  const location = wizard?.location ?? {};
  const hasPolygon =
    typeof profile?.polygon_geojson === "string" &&
    profile.polygon_geojson.trim().length > 0;

  if (location.method_polygon && hasPolygon) return "polygon";
  if (hasPolygon) return "polygon";
  if (location.method_admin) return "admin_area";
  return "none";
}

/**
 * Build the deterministic base profile snapshot from the existing
 * ClientProfile (DB row + wizard extras in filter_json).
 *
 * This is pure: same inputs → same outputs, no API calls.  When some
 * fields are missing we emit `undefined`, never placeholder values, so
 * downstream code can distinguish "unset" from "explicitly empty".
 */
export function wizardToBaseProfile(
  profile: ClientProfile | null | undefined,
): ClientProfileBase {
  if (!profile) return {};

  const filterJson = (profile.filter_json ?? {}) as {
    wizard?: WizardExtras;
  };
  const wizard: WizardExtras = filterJson.wizard ?? {};

  const propertyTypes: string[] = [];
  if (profile.property_type && profile.property_type !== "any") {
    propertyTypes.push(profile.property_type);
  }

  const layouts: string[] = Array.isArray(profile.layouts?.values)
    ? ((profile.layouts?.values ?? []) as string[]).filter(Boolean)
    : [];

  const adminAreas = normalizeAdminAreaList(
    wizard.location?.administrative_area,
  );

  const locationMode = deriveLocationMode(wizard, profile);

  let polygon: unknown = undefined;
  if (locationMode === "polygon" && profile.polygon_geojson) {
    try {
      polygon = JSON.parse(profile.polygon_geojson);
    } catch {
      polygon = profile.polygon_geojson; // fall back to raw string
    }
  }

  return {
    budgetMax: profile.budget_max ?? undefined,
    areaMin: profile.area_min ?? undefined,
    propertyTypes: propertyTypes.length ? propertyTypes : undefined,
    layouts: layouts.length ? layouts : undefined,
    locationMode,
    polygon,
    adminAreas: adminAreas.length ? adminAreas : undefined,
    renovationPreference: normalizeRenovation(wizard.renovation_preference),
  };
}

/**
 * Produce the initial WorkingFilters from a ClientProfileBase.
 * Pure copy — WorkingFilters adds a few UI-only fields (`hideBelowScore`,
 * `visibleLimit`) which start as undefined so the backend defaults win.
 */
export function baseProfileToWorkingFilters(
  base: ClientProfileBase,
): WorkingFilters {
  return {
    budgetMax: base.budgetMax,
    areaMin: base.areaMin,
    propertyTypes: base.propertyTypes ? [...base.propertyTypes] : undefined,
    layouts: base.layouts ? [...base.layouts] : undefined,
    locationMode: base.locationMode,
    polygon: base.polygon,
    adminAreas: base.adminAreas ? [...base.adminAreas] : undefined,
    renovationPreference: base.renovationPreference,
    hideBelowScore: undefined,
    visibleLimit: undefined,
  };
}

/**
 * Build a fresh ClientModeState from a client profile.
 * Used when we don't yet have persisted client-mode state.
 */
export function createClientModeStateFromProfile(
  profile: ClientProfile | null | undefined,
): ClientModeState {
  const baseProfile = wizardToBaseProfile(profile);
  return {
    baseProfile,
    workingFilters: baseProfileToWorkingFilters(baseProfile),
    modifiedKeys: [],
    filtersUpdatedAt: null,
  };
}

/** Shallow equality for working-filter scalar values. Used to decide
 *  whether a key is actually "modified" relative to the base. */
function filterValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  if (typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** Recompute `modifiedKeys` by diffing working filters against the base. */
export function computeModifiedKeys(
  base: ClientProfileBase,
  working: WorkingFilters,
): string[] {
  const modified: string[] = [];
  for (const key of WORKING_FILTER_KEYS) {
    const baseVal =
      key === "hideBelowScore" || key === "visibleLimit"
        ? undefined
        : (base as Record<string, unknown>)[key];
    const workVal = (working as Record<string, unknown>)[key];
    if (!filterValueEqual(baseVal, workVal)) modified.push(key);
  }
  return modified;
}

/**
 * Return working filters with a single field updated and the modifiedKeys
 * list recomputed.  Pure — callers can drive local state with this.
 */
export function updateWorkingFilter<K extends WorkingFilterKey>(
  state: ClientModeState,
  key: K,
  value: WorkingFilters[K],
): ClientModeState {
  const workingFilters: WorkingFilters = { ...state.workingFilters, [key]: value };
  const modifiedKeys = computeModifiedKeys(state.baseProfile, workingFilters);
  return { ...state, workingFilters, modifiedKeys };
}

/** Reset working filters back to the base profile; clears modifiedKeys. */
export function resetWorkingFilters(state: ClientModeState): ClientModeState {
  return {
    ...state,
    workingFilters: baseProfileToWorkingFilters(state.baseProfile),
    modifiedKeys: [],
  };
}

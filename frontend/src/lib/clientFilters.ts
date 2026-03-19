/**
 * Pure helpers for deriving working table filters from a client profile.
 * Used by ActiveClientContext to compute the initial filter state for client mode.
 */

import type { CurrentFilters } from "@/lib/filters";
import { filtersToSearchParams } from "@/lib/filters";
import { polygonToGeoJson, type LatLng } from "@/lib/geo";

/** Minimal subset of ClientProfile needed for filter derivation. */
export type ClientProfileForFilters = {
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  layouts?: { values?: string[] } | null;
  property_type?: string | null;
  filter_json?: unknown;
};

/**
 * Derive a CurrentFilters object from a client profile.
 *
 * Only hard filters are applied:
 *   - budget_min / budget_max  (price range, optional +10 % tolerance)
 *   - area_min / area_max      (floor area range, optional -10 % tolerance)
 *   - layouts                  (dispozice list)
 *   - property_type            (category list: flat / house)
 *   - standards marked "must"  (air_conditioning, exterior_blinds)
 *
 * Soft preferences (balcony, walkability, noise …) are intentionally excluded.
 * The default availability filter is always included.
 */
export function profileToFilters(profile: ClientProfileForFilters): CurrentFilters {
  const filters: CurrentFilters = {};
  const wizard = (profile.filter_json as { wizard?: Record<string, unknown> } | null)?.wizard ?? {};
  const budget = (wizard.budget ?? {}) as Record<string, unknown>;
  const standards = (wizard.standards ?? {}) as Record<string, unknown>;

  // ── Price range ────────────────────────────────────────────────────────────
  if (profile.budget_min != null && profile.budget_min > 0) {
    filters.price_min = profile.budget_min;
  }
  if (profile.budget_max != null && profile.budget_max > 0) {
    const factor = budget.tolerate_plus_10 === true ? 1.1 : 1.0;
    filters.price_max = Math.round(profile.budget_max * factor);
  }

  // ── Floor area range ───────────────────────────────────────────────────────
  if (profile.area_min != null && profile.area_min > 0) {
    const factor = budget.tolerate_minus_10 === true ? 0.9 : 1.0;
    filters.floor_area_min = Math.round(profile.area_min * factor);
  } else if (typeof budget.ideal_area === "number" && budget.ideal_area > 0) {
    // No explicit minimum set — derive a soft floor from ideal_area (−30 %).
    // Mirrors the backend's ideal_area fallback in _compute_unit_match_score.
    filters.floor_area_min = Math.round(budget.ideal_area * 0.7);
  }
  if (profile.area_max != null && profile.area_max > 0) {
    filters.floor_area_max = profile.area_max;
  }

  // ── Layouts ────────────────────────────────────────────────────────────────
  // Profile stores display bucket names ("3kk") but the DB stores raw BuiltMind
  // values ("layout_3"). Convert before applying as a hard filter so the SQL
  // WHERE layout IN (...) actually matches rows.
  const layouts = profile.layouts?.values;
  if (Array.isArray(layouts) && layouts.length > 0) {
    const dbLayouts = layouts
      .map((v) => {
        const s = String(v).trim().toLowerCase().replace(",", ".");
        if (s === "1kk")   return "layout_1";
        if (s === "1.5kk") return "layout_1_5";
        if (s === "2kk")   return "layout_2";
        if (s === "3kk")   return "layout_3";
        if (s === "4kk")   return "layout_4";
        return null; // unknown bucket — skip
      })
      .filter((v): v is string => v !== null);
    if (dbLayouts.length > 0) filters.layout = dbLayouts;
  }

  // ── Property type → category ───────────────────────────────────────────────
  if (profile.property_type === "flat") filters.category = ["flat"];
  else if (profile.property_type === "house") filters.category = ["house"];

  // ── Standards marked "must" → boolean hard filters ─────────────────────────
  // Wizard key: "external_blinds" (with 'a'), filter key: "exterior_blinds" (with 'o')
  if (standards.air_conditioning === "must") filters.air_conditioning = true;
  if (standards.external_blinds === "must") filters.exterior_blinds = true;

  // ── Renovation preference → hard filter (only for "only_*" options) ────────
  const renovPref = wizard.renovation_preference as string | undefined;
  if (renovPref === "only_new") filters.renovation = false;
  else if (renovPref === "only_renovation") filters.renovation = true;
  // "prefer_*" and "any" are soft preferences only — no hard filter applied.

  // ── Default availability ───────────────────────────────────────────────────
  filters.availability = ["available", "unseen", "reserved"];

  return filters;
}

/** Partial profile payload for POST /clients/{id}/profile */
export type ClientProfilePatch = {
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  layouts?: { values: string[] } | null;
  property_type?: string | null;
  polygon_geojson?: string | null;
};

/** Reverse mapping: DB layout value → profile bucket name */
function dbLayoutToProfileValue(db: string): string | null {
  switch (db) {
    case "layout_1":   return "1kk";
    case "layout_1_5": return "1.5kk";
    case "layout_2":   return "2kk";
    case "layout_3":   return "3kk";
    case "layout_4":   return "4kk";
    default:           return null;
  }
}

/**
 * Map current filter state back to a partial ClientProfile payload.
 * Only fields that directly correspond to profile top-level fields are included.
 * Standards, availability, and walkability are excluded.
 *
 * @param polygon - When provided (including empty array), polygon_geojson is included
 *   in the patch: a valid polygon is serialised to GeoJSON; an empty array clears it.
 *   When omitted (undefined), polygon_geojson is not sent and the stored value is untouched.
 */
export function filtersToProfilePatch(filters: CurrentFilters, polygon?: LatLng[]): ClientProfilePatch {
  const patch: ClientProfilePatch = {};

  const priceMin = filters.price_min as number | undefined;
  const priceMax = filters.price_max as number | undefined;
  if (priceMin != null) patch.budget_min = Math.round(priceMin);
  else patch.budget_min = null;
  if (priceMax != null) patch.budget_max = Math.round(priceMax);
  else patch.budget_max = null;

  const areaMin = filters.floor_area_min as number | undefined;
  const areaMax = filters.floor_area_max as number | undefined;
  if (areaMin != null) patch.area_min = areaMin;
  else patch.area_min = null;
  if (areaMax != null) patch.area_max = areaMax;
  else patch.area_max = null;

  const layout = filters.layout as string[] | undefined;
  if (Array.isArray(layout) && layout.length > 0) {
    const profileLayouts = layout
      .map(dbLayoutToProfileValue)
      .filter((v): v is string => v !== null);
    patch.layouts = profileLayouts.length > 0 ? { values: profileLayouts } : null;
  } else {
    patch.layouts = null;
  }

  const category = filters.category as string[] | undefined;
  if (Array.isArray(category) && category.length === 1 && category[0] === "flat") {
    patch.property_type = "flat";
  } else if (Array.isArray(category) && category.length === 1 && category[0] === "house") {
    patch.property_type = "house";
  } else {
    patch.property_type = "any";
  }

  // ── Polygon ────────────────────────────────────────────────────────────────
  // Only included when caller explicitly passes the polygon argument.
  // Empty array → clear (null); valid polygon → GeoJSON Polygon string.
  if (polygon !== undefined) {
    patch.polygon_geojson = polygonToGeoJson(polygon);
  }

  return patch;
}

/**
 * Compare two CurrentFilters states by their serialized URL params.
 * Handles array ordering and key ordering differences.
 */
export function filtersEqual(a: CurrentFilters, b: CurrentFilters): boolean {
  const serialize = (f: CurrentFilters): string =>
    Array.from(filtersToSearchParams(f).entries())
      .sort(([ka, va], [kb, vb]) => ka.localeCompare(kb) || va.localeCompare(vb))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
  return serialize(a) === serialize(b);
}

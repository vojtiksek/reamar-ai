/**
 * wizardTransform.ts — Frontend mirror of backend build_structured_wizard().
 *
 * Pure transform: WizardExtras + ClientProfile → StructuredWizardPayload.
 * No side effects, no API calls, no state mutations.
 *
 * The output is sent alongside raw wizard in filter_json.structured_wizard
 * for forward-compatibility. Backend currently ignores it but will eventually
 * read from it directly.
 */

import type { ClientProfile, Priority, WizardExtras } from "./caseTypes";

// ---------------------------------------------------------------------------
// Types — mirror backend HardFilters / PreferenceTags / WizardMetadata
// ---------------------------------------------------------------------------

export type HardFilters = {
  // Price
  budget_max: number | null;
  budget_max_tolerance_pct: number | null;
  // Area
  area_min: number | null;
  area_min_tolerance_pct: number | null;
  // Outdoor
  outdoor_area_min: number | null;
  outdoor_area_min_tolerance_pct: number | null;
  // Layouts
  layouts: string[];
  // Location
  location_polygon: boolean;
  /** Multi-value administrative area list (Phase 5b).  Backend accepts both
   *  legacy string and new list shapes; frontend always writes a list. */
  location_admin_area: string[];
  location_admin_region: string | null;
  /** Explicit opt-in for admin_area hard filtering. */
  method_admin: boolean;
  location_commute: boolean;
  // Completion
  latest_move_in: string | null;
  // Renovation
  renovation_preference: "only_new" | "only_renovation" | null;
  // Standards — "must" only
  must_recuperation: boolean;
  must_air_conditioning: boolean;
  must_floor_heating: boolean;
  must_exterior_blinds: boolean;
  // Amenities — "must" only
  must_bike_room: boolean;
  must_stroller_room: boolean;
  must_fitness: boolean;
  must_courtyard_garden: boolean;
  must_reception: boolean;
  must_concierge: boolean;
  // Noise — "must" only
  must_quiet_area: boolean;
  must_no_main_road: boolean;
  must_no_tram: boolean;
  must_no_railway: boolean;
  must_no_airport: boolean;
  // Outdoor — "must" only
  must_outdoor_space: boolean;
  must_balcony: boolean;
  must_terrace: boolean;
  must_garden: boolean;
  // Payment
  max_payment_contract_pct: number | null;
  max_payment_construction_pct: number | null;
  // Days on market
  max_days_on_market: number | null;
  // Energy
  energy_class: string | null;
  // Floor
  exclude_ground_floor: boolean;
  penthouse_only: boolean;
};

export type PreferenceTags = {
  purchase_purpose: string | null;
  // Standards — "prefer" level
  prefer_recuperation: boolean;
  prefer_air_conditioning: boolean;
  prefer_floor_heating: boolean;
  prefer_exterior_blinds: boolean;
  prefer_smart_home: boolean;
  // Specific standard values
  heating_type: string | null;
  heating_source: string | null;
  partition_type: string | null;
  window_type: string | null;
  window_material: string | null;
  // Project amenities
  prefer_reception: string | null;
  prefer_fitness: string | null;
  prefer_ev_charger: string | null;
  prefer_courtyard_garden: string | null;
  // Noise — "prefer" level
  prefer_quiet_area: boolean;
  prefer_no_main_road: boolean;
  prefer_no_tram: boolean;
  prefer_no_railway: boolean;
  prefer_no_airport: boolean;
  // Floor
  preferred_floor: string | null;
  ground_floor_sensitive: boolean;
  // Area
  ideal_area: number | null;
  // Outdoor
  prefer_outdoor_space: boolean;
  outdoor_orientation: Record<string, string> | null;
  // Renovation
  prefer_new: boolean;
  prefer_renovation: boolean;
  // Completion
  earliest_move_in: string | null;
  // Developer
  preferred_developer: string | null;
  // Walkability
  walkability_active: boolean;
  // Skip categories
  skip_standards: boolean;
  skip_amenities: boolean;
  skip_noise: boolean;
  skip_walkability: boolean;
};

export type WizardMetadata = {
  client_type: string | null;
  financing_type: string | null;
  assignment_important: string | null;
  completion_standard: string | null;
  property_type: string | null;
};

export type StructuredWizardPayload = {
  hard_filters: HardFilters;
  preferences: PreferenceTags;
  metadata: WizardMetadata;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMust(p: Priority | undefined | null): boolean {
  return p === "must";
}

function isPrefer(p: Priority | undefined | null): boolean {
  return p === "prefer";
}

/**
 * Coerce wizardExtras.location.administrative_area into a deduplicated list.
 * Backward-compat: legacy profiles stored a plain string; Phase 5b stores
 * an array.  This helper tolerates both shapes and returns `string[]`.
 */
export function normalizeAdminAreaList(
  raw: string | string[] | null | undefined,
): string[] {
  if (raw == null) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item == null) continue;
    const s = String(item).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export function buildStructuredWizard(
  w: WizardExtras | undefined | null,
  profile: ClientProfile | undefined | null,
  /** Selected layouts from useCaseData state (not inside wizardExtras) */
  selectedLayouts?: string[],
): StructuredWizardPayload {
  const wiz = w ?? {};
  const prof = profile ?? {};

  const budget = wiz.budget ?? {};
  const outdoor = wiz.outdoor ?? {};
  const standards = wiz.standards ?? {};
  const noise = wiz.noise ?? {};
  const amenities = wiz.house_amenities ?? {};
  const projectAmenities = wiz.project_amenities ?? {};
  const location = wiz.location ?? {};
  const skip = wiz.skip_categories ?? {};

  const reno = wiz.renovation_preference ?? null;
  const floorRule = outdoor.floor_rule ?? null;

  // ── Hard Filters ─────────────────────────────────────────────────────

  const hard_filters: HardFilters = {
    // Price / area / outdoor
    budget_max: prof.budget_max ?? null,
    budget_max_tolerance_pct: budget.max_price_tolerance_pct ?? null,
    area_min: prof.area_min ?? null,
    area_min_tolerance_pct: budget.max_area_tolerance_pct ?? null,
    outdoor_area_min: budget.min_outdoor_area_m2 ?? outdoor.min_outdoor_area_m2 ?? null,
    outdoor_area_min_tolerance_pct: budget.max_outdoor_tolerance_pct ?? null,

    // Layouts
    layouts: selectedLayouts?.length ? selectedLayouts : [],

    // Location
    location_polygon: !!location.method_polygon,
    location_admin_area: normalizeAdminAreaList(location.administrative_area),
    location_admin_region: location.administrative_region ?? null,
    method_admin: !!location.method_admin,
    location_commute: !!location.method_commute,

    // Completion
    latest_move_in: wiz.completion_date ?? wiz.latest_move_in ?? null,

    // Renovation — only "only_*" are hard filters
    renovation_preference:
      reno === "only_new" || reno === "only_renovation" ? reno : null,

    // Standards must
    must_recuperation: isMust(standards.recuperation),
    must_air_conditioning: isMust(standards.air_conditioning),
    must_floor_heating: isMust(standards.floor_heating),
    must_exterior_blinds: isMust(standards.exterior_blinds),

    // Amenities must
    must_bike_room: isMust(amenities.bike_room),
    must_stroller_room: isMust(amenities.stroller_room),
    must_fitness: isMust(amenities.fitness),
    must_courtyard_garden: isMust(amenities.courtyard_garden),
    must_reception: isMust(projectAmenities.reception as Priority | undefined),
    must_concierge: isMust(amenities.concierge),

    // Noise must
    must_quiet_area: isMust(noise.quiet_area),
    must_no_main_road: isMust(noise.main_road),
    must_no_tram: isMust(noise.tram),
    must_no_railway: isMust(noise.railway),
    must_no_airport: isMust(noise.airport),

    // Outdoor must
    must_outdoor_space: isMust(outdoor.outdoor_space),
    must_balcony: isMust(outdoor.balcony),
    must_terrace: isMust(outdoor.terrace),
    must_garden: isMust(outdoor.garden),

    // Payment
    max_payment_contract_pct: budget.max_payment_contract_pct ?? null,
    max_payment_construction_pct: budget.max_payment_construction_pct ?? null,

    // Days on market
    max_days_on_market: budget.max_days_on_market ?? null,

    // Energy class
    energy_class:
      wiz.energy_class && wiz.energy_class !== "ignore"
        ? wiz.energy_class
        : null,

    // Floor
    exclude_ground_floor: floorRule === "no_ground",
    penthouse_only: floorRule === "top_1",
  };

  // ── Preferences ──────────────────────────────────────────────────────

  // Build orientation only if non-trivial
  let orientationPayload: Record<string, string> | null = null;
  if (outdoor.orientation) {
    const entries = Object.entries(outdoor.orientation).filter(
      ([, v]) => v && v !== "ignore",
    );
    if (entries.length > 0) {
      orientationPayload = Object.fromEntries(entries);
    }
  }

  const preferences: PreferenceTags = {
    purchase_purpose: prof.purchase_purpose ?? null,

    // Standards prefer
    prefer_recuperation: isPrefer(standards.recuperation),
    prefer_air_conditioning: isPrefer(standards.air_conditioning),
    prefer_floor_heating: isPrefer(standards.floor_heating),
    prefer_exterior_blinds: isPrefer(standards.exterior_blinds),
    prefer_smart_home: isPrefer(standards.smart_home),

    // Specific values — normalize arrays to comma-separated strings
    heating_type: Array.isArray(standards.heating_type) ? standards.heating_type.join(",") : (standards.heating_type ?? null),
    heating_source: Array.isArray(standards.heating_source) ? standards.heating_source.join(",") : (standards.heating_source ?? null),
    partition_type: Array.isArray(standards.partitions) ? standards.partitions.join(",") : (standards.partitions ?? null),
    window_type: standards.window_type ?? null,
    window_material: Array.isArray(standards.window_material) ? standards.window_material.join(",") : (standards.window_material ?? null),

    // Project amenities
    prefer_reception: projectAmenities.reception ?? null,
    prefer_fitness: projectAmenities.fitness ?? null,
    prefer_ev_charger: projectAmenities.ev_charger ?? null,
    prefer_courtyard_garden: projectAmenities.courtyard_garden ?? null,

    // Noise prefer
    prefer_quiet_area: isPrefer(noise.quiet_area),
    prefer_no_main_road: isPrefer(noise.main_road),
    prefer_no_tram: isPrefer(noise.tram),
    prefer_no_railway: isPrefer(noise.railway),
    prefer_no_airport: isPrefer(noise.airport),

    // Floor — derive from floor_rule enum (wizard never sets preferred_floor directly)
    preferred_floor:
      floorRule === "top_3" ? "top_3" :
      floorRule === "top_1" ? "top_floor" :
      outdoor.preferred_floor ?? null,
    ground_floor_sensitive:
      isPrefer(outdoor.ground_floor_sensitive) ||
      floorRule === "top_3",

    // Area
    ideal_area: budget.ideal_area ?? null,

    // Outdoor
    prefer_outdoor_space: isPrefer(outdoor.outdoor_space),
    outdoor_orientation: orientationPayload,

    // Renovation
    prefer_new: reno === "prefer_new",
    prefer_renovation: reno === "prefer_renovation",

    // Completion
    earliest_move_in: wiz.earliest_move_in ?? null,

    // Developer
    preferred_developer: wiz.preferred_developer ?? null,

    // Walkability
    walkability_active: !!(
      prof.walkability_preferences_json &&
      Object.keys(prof.walkability_preferences_json).length > 0
    ),

    // Skip — wizard uses "surroundings" for noise+walkability combined
    skip_standards: !!skip.standards,
    skip_amenities: !!skip.amenities,
    skip_noise: !!skip.noise || !!skip.surroundings,
    skip_walkability: !!skip.walkability || !!skip.surroundings,
  };

  // ── Metadata ─────────────────────────────────────────────────────────

  const metadata: WizardMetadata = {
    client_type: wiz.client_type ?? null,
    financing_type: wiz.financing_type ?? null,
    assignment_important: wiz.assignment_important ?? null,
    completion_standard: wiz.completion_standard ?? null,
    property_type: prof.property_type ?? null,
  };

  return { hard_filters, preferences, metadata };
}

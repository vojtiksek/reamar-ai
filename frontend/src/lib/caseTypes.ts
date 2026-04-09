import type { WalkabilityPreferences } from "@/lib/walkabilityPreferences";

export type ClientSummary = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  broker_id: number;
  created_at: string;
  updated_at: string;
  recommendations_count: number;
  notes?: string | null;
};

export type ClientProfile = {
  budget_min?: number | null;
  budget_max?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  layouts?: { values?: string[] } | null;
  property_type?: string | null;
  purchase_purpose?: string | null;
  walkability_preferences_json?: WalkabilityPreferences | null;
  filter_json?: any | null;
  polygon_geojson?: string | null;
  commute_points_json?: Record<string, unknown> | null;
  scoring_weights_json?: Record<string, number> | null;
};

export type RecommendationFeedbackType = "liked" | "saved" | "disliked";
export type RecommendationDislikeReason =
  | "price"
  | "location"
  | "layout"
  | "small_area"
  | "standard_or_project"
  | "noise_or_surroundings"
  | "accessibility"
  | "other";

export type RecommendationFeedback = {
  feedback_type: RecommendationFeedbackType;
  dislike_reason?: RecommendationDislikeReason | null;
  note?: string | null;
  updated_at: string;
};

export const DISLIKE_REASON_LABELS: Record<RecommendationDislikeReason, string> = {
  price: "Cena",
  location: "Lokalita",
  layout: "Dispozice",
  small_area: "Malá plocha",
  standard_or_project: "Standard / projekt",
  noise_or_surroundings: "Hluk / okolí",
  accessibility: "Dostupnost",
  other: "Jiný důvod",
};

export type RecommendationItem = {
  rec_id: number;
  pinned_by_broker: boolean;
  unit_external_id: string | null;
  project_id: number | null;
  project_name?: string | null;
  layout?: string | null;
  layout_label?: string | null;
  district?: string | null;
  project_lat?: number | null;
  project_lng?: number | null;
  exterior_area_m2?: number | null;
  floor_area_m2?: number | null;
  price_czk?: number | null;
  price_per_m2_czk?: number | null;
  floor?: number | null;
  score: number;
  budget_fit: number;
  walkability_fit: number;
  location_fit: number;
  layout_fit: number;
  area_fit: number;
  outdoor_fit: number;
  commute_fit?: number;
  eligibility?: string;
  eligibility_reasons?: string[];
  confidence?: number;
  confidence_label?: string;
  confidence_reasons?: string[];
  top_strengths?: string[];
  top_compromises?: string[];
  broker_note?: string | null;
  reason?: Record<string, unknown> | null;
  feedback?: RecommendationFeedback | null;
};

export type MarketFitBlocker = {
  key: string;
  label: string;
  blocked_count: number;
  blocked_percentage: number;
};

export type RelaxationSuggestion = {
  label: string;
  matching_units_count: number;
  delta_vs_current: number;
};

export type MarketFitAnalysis = {
  client_id: number;
  matching_units_count: number;
  available_units_count: number;
  top_blockers: MarketFitBlocker[];
  relaxation_suggestions: RelaxationSuggestion[];
};

export type AreaMarketAnalysis = {
  client_id: number;
  projects_count: number;
  active_units_count: number;
  matching_units_count: number;
  avg_price_czk: number | null;
  avg_price_per_m2_czk: number | null;
  min_price_czk: number | null;
  max_price_czk: number | null;
  avg_floor_area_m2: number | null;
  layout_distribution: Record<string, number>;
  budget_fit_units_count: number;
  area_fit_units_count: number;
};

export type Priority = "must" | "prefer" | "bonus" | "ignore";

export type NoteItem = {
  id: number;
  client_id: number;
  broker_id: number;
  note_type: string;
  body: string;
  created_at: string;
};

export type WizardExtras = {
  // v2 fields
  client_type?: "family" | "couple" | "single" | "downsizing" | null;
  purchase_timeline?: "now" | "3m" | "6m" | "1y" | "2y+" | "mapping" | null;
  move_in_timeline?: "asap" | "by_date" | "flexible" | null;
  financing_type?: "cash" | "mortgage" | "combo" | "unknown" | null;
  prefer_payment_on_completion?: boolean;
  assignment_important?: "yes" | "no" | "irrelevant" | null;
  trade_off_ranking?: string[];
  trade_off_notes?: string | null;

  location?: {
    walkability?: Priority;
    noise_sensitivity?: Priority;
    project_size?: "small" | "medium" | "large" | "ignore";
    urban_vs_quiet?: "quiet" | "urban" | "ignore";
    method_polygon?: boolean;
    method_commute?: boolean;
    method_admin?: boolean;
    administrative_area?: string | null;
    administrative_region?: string | null;
  };
  budget?: {
    max_price?: number | null;
    tolerate_plus_10?: boolean;
    max_price_tolerance_pct?: number | null;
    ideal_area?: number | null;
    min_area?: number | null;
    tolerate_minus_10?: boolean;
    max_area_tolerance_pct?: number | null;
    min_outdoor_area_m2?: number | null;
    max_outdoor_tolerance_pct?: number | null;
    payment_schedule?: "upfront" | "during_construction" | "on_completion" | "ignore";
    max_payment_contract_pct?: number | null;
    max_payment_construction_pct?: number | null;
    max_days_on_market?: number | null;
  };
  standards?: {
    recuperation?: Priority;
    floor_heating?: Priority;
    exterior_blinds?: Priority;
    air_conditioning?: Priority;
    cellar?: Priority;
    parking?: Priority;
    smart_home?: Priority;
    high_standard?: Priority;
    elevator?: Priority;
    window_type?: string | null;
    heating_type?: string | null;
    partitions?: string | null;
    heating_source?: string | null;
  };
  outdoor?: {
    outdoor_space?: Priority;
    min_outdoor_area_m2?: number | null;
    balcony?: Priority;
    terrace?: Priority;
    garden?: Priority;
    anything_ok?: Priority;
    preferred_floor?: "ground" | "low" | "middle" | "high" | "ignore";
    floor_rule?: "no_ground" | "ignore" | "top_3" | "top_1";
    ground_floor_sensitive?: Priority;
    orientation?: {
      south?: Priority;
      west?: Priority;
      east?: Priority;
      north?: Priority;
    };
  };
  noise?: {
    quiet_area?: Priority;
    main_road?: Priority;
    tram?: Priority;
    railway?: Priority;
    airport?: Priority;
  };
  house_amenities?: {
    parking?: Priority;
    cellar?: Priority;
    bike_room?: Priority;
    stroller_room?: Priority;
    fitness?: Priority;
    courtyard_garden?: Priority;
    concierge?: Priority;
  };
  character?: {
    project_size?: "small" | "medium" | "large" | "ignore";
    calm_vs_city?: "calm" | "city" | "ignore";
    privacy_vs_services?: "privacy" | "services" | "ignore";
  };
  project_amenities?: {
    reception?: "prefer" | "reject" | "ignore";
    fitness?: "prefer" | "reject" | "ignore";
    ev_charger?: "prefer" | "reject" | "ignore";
    courtyard_garden?: "prefer" | "reject" | "ignore";
  };
  renovation_preference?: "any" | "prefer_new" | "only_new" | "prefer_renovation" | "only_renovation";
  completion_standard?: "shell_and_core" | "white_wall" | "fit_out" | null;
  completion_date?: string | null;
  energy_class?: "A" | "B" | "C" | "D" | "ignore" | null;
  preferred_developer?: string | null;
  commute?: {
    points?: {
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
    }[];
  };
  skip_categories?: {
    standards?: boolean;
    amenities?: boolean;
    surroundings?: boolean;  // legacy — kept for backward compat
    noise?: boolean;
    walkability?: boolean;
  };
  earliest_move_in?: string | null;
  latest_move_in?: string | null;
};

export type FlatWeightKey =
  | "price_distance"
  | "price_per_m2_area"
  | "payment_schedule"
  | "commute_time"
  | "walkability"
  | "noise"
  | "unit_area"
  | "outdoor_area"
  | "floor_preference"
  | "heating"
  | "heating_source"
  | "recuperation"
  | "exterior_blinds"
  | "air_conditioning"
  | "flooring"
  | "ceiling_height"
  | "windows"
  | "reception"
  | "fitness_project"
  | "ev_charger"
  | "courtyard_garden"
  | "completion_fit";

export type FlatWeights = Record<FlatWeightKey, number>;

export type FlatWeightsResponse = {
  wizard_weights: Record<string, number>;
  broker_overrides: Record<string, number> | null;
  effective_weights: Record<string, number>;
  skip_categories: Record<string, boolean>;
  defaults: Record<string, number>;
  labels: Record<string, string>;
  categories: Record<string, string[]>;
};

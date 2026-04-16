"""Scoring v2 — extracted scoring logic for unit–client matching.

Public API:
    compute_full_score(unit, project, profile, weights=None, db=None) → dict
    build_structured_wizard(profile) → dict   # structured wizard output
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from typing import Any

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session

from .models import Unit, Project, ClientProfile
from .walkability import compute_personalized_walkability_score, project_to_raw_metrics
from .routing_provider import get_cached_travel_time_minutes, get_cached_commute_result
from .aggregates import _layout_group

# These are imported from main.py — they live there because many other
# parts of main.py also use them.  We import lazily to avoid circular imports.
_geo_helpers_loaded = False
_parse_polygon_geojson = None
_parse_polygon_or_multipolygon_geojson = None
_point_in_polygon = None
_point_in_any_polygon = None
_wizard_preferences_adjustment = None


def _ensure_geo_helpers():
    global _geo_helpers_loaded, _parse_polygon_geojson, _parse_polygon_or_multipolygon_geojson, _point_in_polygon, _point_in_any_polygon, _wizard_preferences_adjustment
    if not _geo_helpers_loaded:
        from . import main as _main
        _parse_polygon_geojson = _main._parse_polygon_geojson
        _parse_polygon_or_multipolygon_geojson = _main._parse_polygon_or_multipolygon_geojson
        _point_in_polygon = _main._point_in_polygon
        _point_in_any_polygon = _main._point_in_any_polygon
        _wizard_preferences_adjustment = _main._wizard_preferences_adjustment
        _geo_helpers_loaded = True


DEFAULT_WEIGHTS = {
    'budget': 0.30,
    'walkability': 0.20,
    'location': 0.20,
    'layout': 0.10,
    'area': 0.10,
    'outdoor': 0.05,
    'commute': 0.05,
}

# ---------------------------------------------------------------------------
# Flat scoring weights — individual aspects, summing to 100
# ---------------------------------------------------------------------------

FLAT_WEIGHT_DEFAULTS: dict[str, float] = {
    # Cena a financování
    'price_distance': 15.0,       # vzdálenost od ideální ceny
    'price_per_m2_area': 8.0,     # odchylka ceny/m² od okolí (1km/2km)
    'payment_schedule': 5.0,      # platební podmínky (nižší na začátku = lepší)
    # Lokalita
    'commute_time': 12.0,         # dojezdové vzdálenosti
    'walkability': 10.0,          # občanská vybavenost
    'noise': 5.0,                 # hluk / klidná lokalita
    # Dispozice a prostor
    'unit_area': 8.0,             # velikost bytu
    'outdoor_area': 5.0,          # venkovní prostor
    'floor_preference': 4.0,      # preferované patro
    # Standardy
    'heating': 3.0,               # vytápění (podlahové/radiátory/stropní)
    'heating_source': 2.0,        # zdroj vytápění (tepelné čerpadlo/plyn/teplovod)
    'recuperation': 2.0,          # rekuperace
    'exterior_blinds': 2.0,       # žaluzie
    'air_conditioning': 2.0,      # klimatizace
    'flooring': 1.0,              # podlaha
    'ceiling_height': 1.0,        # výška stropu
    'windows': 1.0,               # okna
    # Vybavení projektu
    'reception': 2.0,             # recepce
    'fitness_project': 2.0,       # fitness
    'ev_charger': 1.0,            # elektro nabíječka
    'courtyard_garden': 2.0,      # vnitroblok / zahrada
    # Dokončení
    'completion_fit': 6.0,        # jak blízko preferovanému termínu
}
# Total = 100.0

# Grouping of flat weights for "skip category" behavior
FLAT_WEIGHT_CATEGORIES: dict[str, list[str]] = {
    'standards': ['heating', 'heating_source', 'recuperation', 'exterior_blinds',
                  'air_conditioning', 'flooring', 'ceiling_height', 'windows'],
    'amenities': ['reception', 'fitness_project', 'ev_charger', 'courtyard_garden'],
    'noise': ['noise'],
    'walkability': ['walkability'],
    'surroundings': ['walkability', 'noise'],  # backward compat: old wizard data
}

# ---------------------------------------------------------------------------
# Scoring v2 — configurable constants
# ---------------------------------------------------------------------------

SCORING_V2_CONFIG: dict[str, Any] = {
    # Core aspect base weights (sum ≈ 64, redistributed when inactive)
    "core_weights": {
        "price_savings": 8.0,
        "price_per_m2": 6.0,
        "unit_area": 8.0,
        "outdoor_area": 4.0,
        "payment_schedule": 4.0,
        "commute_time": 12.0,
        "walkability_poi": 10.0,
        "center_distance": 4.0,
        "completion_preference": 5.0,
        "renovation_preference": 3.0,
    },
    # Preference pools (split evenly among active preferences)
    "pref_standard_pool": 22.0,
    "pref_amenity_pool": 14.0,
    # Price bell-curve
    "price_bell_sweet_low": 30,      # % savings where max score starts
    "price_bell_sweet_high": 55,     # % savings where max score ends
    "price_bell_penalty": 1.5,       # penalty steepness for too-cheap
    # Price per m²
    "price_m2_neutral": 70,          # fit at 0% deviation
    "price_m2_cheap_bonus": 1.5,     # bonus steepness
    "price_m2_expensive_penalty": 2.5,  # penalty steepness
    # Area
    "area_ratio_cap": 1.5,           # above this, no more fit increase
    # Commute modes
    "commute_primary_weight": 0.80,
    "commute_secondary_weight": 0.20,
    "commute_sum_penalty_rate": 2.0,
    # Center distance (Prague center)
    "center_lat": 50.087431,
    "center_lng": 14.420073,
    "center_near_full_km": 3,
    "center_near_mid_km": 8,
    "center_far_cutoff_km": 20,
    # POI gradual categories (count matters, not just presence)
    "poi_gradual_categories": ["restaurant", "cafe"],
    "poi_gradual_scores": [0, 40, 60, 75, 90, 100],
    # Standard/amenity fit values
    "pref_match": 95,
    "pref_miss": 15,
    "pref_neutral": 50,
    # Noise adjustment (outside weighted system)
    "noise_quiet_bonus": 2,
    "noise_medium_penalty": -1,
    "noise_high_penalty": -3,
    "noise_very_high_penalty": -5,
    "noise_road_close_m": 200,
    "noise_road_penalty": -2,
    "noise_tram_close_m": 150,
    "noise_tram_penalty": -1,
    "noise_rail_close_m": 400,
    "noise_rail_penalty": -2,
    "noise_airport_close_m": 3000,
    "noise_airport_penalty": -2,
    "noise_adj_min": -8,
    "noise_adj_max": 2,
    # Admin area adjustment
    "admin_inside_bonus": 4.0,
    "admin_outside_penalty": -2.0,
    # Hard filter tolerances (defaults)
    "tolerance_budget_pct": 5,
    "tolerance_area_pct": 5,
    "tolerance_outdoor_pct": 0,
}

# V2 Czech labels for UI
SCORING_V2_LABELS: dict[str, str] = {
    # Core
    'price_savings': 'Cena (úspora vs. budget)',
    'price_per_m2': 'Cena/m² vs. okolí',
    'unit_area': 'Velikost bytu',
    'outdoor_area': 'Venkovní prostor',
    'payment_schedule': 'Platební podmínky',
    'commute_time': 'Dojezdové vzdálenosti',
    'walkability_poi': 'Občanská vybavenost',
    'center_distance': 'Vzdálenost od centra',
    'completion_preference': 'Termín nastěhování',
    'renovation_preference': 'Novostavba / rekonstrukce',
    # Standards (prefixed std_)
    'std_heating': 'Vytápění',
    'std_heating_source': 'Zdroj vytápění',
    'std_recuperation': 'Rekuperace',
    'std_exterior_blinds': 'Venkovní žaluzie',
    'std_air_conditioning': 'Klimatizace',
    'std_flooring': 'Podlahová krytina',
    'std_ceiling_height': 'Výška stropu',
    'std_windows': 'Okna',
    # Amenities (prefixed amen_)
    'amen_reception': 'Recepce',
    'amen_fitness': 'Fitness',
    'amen_ev_charger': 'Elektro nabíječka',
    'amen_courtyard_garden': 'Vnitroblok / zahrada',
    'amen_bike_room': 'Kolárna',
    'amen_stroller_room': 'Kočárkárna',
    'amen_concierge': 'Concierge',
}

# Mapping: standard key → (DB field on unit, DB field on project)
V2_STANDARD_DB_FIELDS: dict[str, tuple[str | None, str | None]] = {
    "heating": ("heating", "heating"),
    "heating_source": (None, "heating_source"),
    "recuperation": (None, "recuperation"),
    "air_conditioning": ("air_conditioning", None),
    "exterior_blinds": ("exterior_blinds", None),
    "flooring": (None, "floors"),
    "ceiling_height": (None, "ceiling_height"),
    "windows": (None, "windows"),
}

# Wizard enum field keys → standard key mapping
V2_ENUM_STANDARD_MAP: dict[str, str] = {
    "heating_type": "heating",
    "heating_source": "heating_source",
    "flooring": "flooring",
    "window_type": "windows",
    "ceiling_height": "ceiling_height",
}

# Amenity fields on Project model
V2_AMENITY_DB_FIELDS: list[str] = [
    "reception", "fitness", "ev_charger", "courtyard_garden",
    "bike_room", "stroller_room", "concierge",
]

# POI category → DB count field mapping (500m radius)
V2_POI_COUNT_FIELDS: dict[str, str] = {
    "supermarket": "count_supermarket_500m",
    "park": "count_park_500m",
    "cafe": "count_cafe_500m",
    "restaurant": "count_restaurant_500m",
    "fitness": "count_fitness_500m",
    "playground": "count_playground_500m",
    "kindergarten": "count_kindergarten_500m",
    "primary_school": "count_primary_school_500m",
}

# POI category → DB distance field mapping (MHD)
V2_POI_DISTANCE_FIELDS: dict[str, tuple[str, int]] = {
    "metro": ("distance_to_metro_station_m", 600),
    "tram": ("distance_to_tram_stop_m", 300),
    "bus": ("distance_to_bus_stop_m", 200),
    "train": ("distance_to_train_station_m", 1000),
}

# Czech labels for UI
FLAT_WEIGHT_LABELS: dict[str, str] = {
    'price_distance': 'Cena (vzdálenost od ideálu)',
    'price_per_m2_area': 'Cena/m² vs. okolí',
    'payment_schedule': 'Platební podmínky',
    'commute_time': 'Dojezdové vzdálenosti',
    'walkability': 'Občanská vybavenost',
    'noise': 'Hluk / klid lokality',
    'unit_area': 'Velikost bytu',
    'outdoor_area': 'Venkovní prostor',
    'floor_preference': 'Preferované patro',
    'heating': 'Vytápění',
    'heating_source': 'Zdroj vytápění',
    'recuperation': 'Rekuperace',
    'exterior_blinds': 'Žaluzie',
    'air_conditioning': 'Klimatizace',
    'flooring': 'Podlaha',
    'ceiling_height': 'Výška stropu',
    'windows': 'Okna',
    'reception': 'Recepce',
    'fitness_project': 'Fitness',
    'ev_charger': 'Elektro nabíječka',
    'courtyard_garden': 'Vnitroblok / zahrada',
    'completion_fit': 'Termín dokončení',
}


def derive_flat_weights_from_wizard(
    wizard_or_sw: 'dict | StructuredWizard | None' = None,
) -> dict[str, float]:
    """Derive flat scoring weights from wizard answers.

    If the client skipped a category (e.g. standards_skip=True),
    all weights in that category are zeroed and redistributed.

    Accepts either a StructuredWizard instance or a raw wizard dict (legacy).
    """
    weights = dict(FLAT_WEIGHT_DEFAULTS)
    if not wizard_or_sw:
        return weights

    # Extract skip flags from StructuredWizard or raw dict
    if isinstance(wizard_or_sw, StructuredWizard):
        pref = wizard_or_sw.preferences
        skip_flags: dict[str, bool] = {
            "standards": pref.skip_standards,
            "amenities": pref.skip_amenities,
            "noise": pref.skip_noise,
            "walkability": pref.skip_walkability,
            "surroundings": pref.skip_noise or pref.skip_walkability,
        }
    else:
        skip_flags = wizard_or_sw.get('skip_categories') or {}

    zeroed_total = 0.0
    for category, keys in FLAT_WEIGHT_CATEGORIES.items():
        if skip_flags.get(category):
            for k in keys:
                zeroed_total += weights.get(k, 0.0)
                weights[k] = 0.0

    # Redistribute zeroed weight proportionally among remaining active aspects
    if zeroed_total > 0:
        active_total = sum(v for v in weights.values() if v > 0)
        if active_total > 0:
            scale = (active_total + zeroed_total) / active_total
            weights = {k: (v * scale if v > 0 else 0.0) for k, v in weights.items()}

    return weights


def merge_broker_weight_overrides(
    wizard_weights: dict[str, float],
    broker_overrides: dict[str, float] | None,
) -> dict[str, float]:
    """Apply broker's manual weight overrides on top of wizard-derived weights.

    Broker overrides replace individual aspect weights, then the total is
    renormalized to 100.
    """
    if not broker_overrides:
        return wizard_weights

    merged = dict(wizard_weights)
    for k, v in broker_overrides.items():
        if k in merged:
            merged[k] = float(v)

    # Renormalize to sum = 100
    total = sum(merged.values())
    if total > 0 and abs(total - 100.0) > 0.01:
        merged = {k: v / total * 100.0 for k, v in merged.items()}

    return merged


def resolve_flat_weights(
    profile: 'ClientProfile | None',
) -> dict[str, float]:
    """Resolve effective flat weights: wizard-derived → broker overrides → normalize."""
    sw = build_structured_wizard(profile)
    base = derive_flat_weights_from_wizard(sw)
    broker_ov = None
    if profile and hasattr(profile, 'broker_weight_overrides_json'):
        broker_ov = profile.broker_weight_overrides_json
    return merge_broker_weight_overrides(base, broker_ov)

DEFAULT_THRESHOLDS = {
    'strong_pick_min_score': 70,
    'review_pick_min_score': 55,
    'hide_below_score': 0,
    'default_visible_limit': 50,
    'max_strong_picks': 0,   # 0 = unlimited
    'max_review_picks': 0,   # 0 = unlimited
    # Availability visibility settings
    'hide_stale_reservations': 1,  # 1 = hide reserved units with is_stale_reservation=true
    'not_seen_max_days': 180,      # include not_seen units last seen within N days (0 = exclude all)
}


def resolve_thresholds(stored: dict | None) -> dict:
    """Merge stored thresholds on top of defaults."""
    result = dict(DEFAULT_THRESHOLDS)
    if stored:
        for k in DEFAULT_THRESHOLDS:
            if k in stored and stored[k] is not None:
                result[k] = stored[k]
    return result


def resolve_weights(global_weights: dict | None, client_weights: dict | None) -> dict:
    """Merge global → client overrides on top of defaults, then normalize to sum=1.0."""
    base = dict(DEFAULT_WEIGHTS)
    if global_weights:
        base.update({k: v for k, v in global_weights.items() if k in DEFAULT_WEIGHTS})
    if client_weights:
        base.update({k: v for k, v in client_weights.items() if k in DEFAULT_WEIGHTS})
    total = sum(base.values())
    if total > 0:
        base = {k: v / total for k, v in base.items()}
    return base


# ---------------------------------------------------------------------------
# Wizard normalization — new 10-step wizard (cases/[id]/brief) → scoring fields
# ---------------------------------------------------------------------------

def normalize_wizard(wizard: dict) -> dict:
    """Translate field names from the new 10-step wizard to the names scoring logic reads.

    The new wizard (cases/[id]/brief/page.tsx) uses different field names than the
    legacy wizard and the backend scoring engine.  This function is a pure mapping
    layer — no data is dropped, only aliased where the names diverge.

    Called at the top of compute_eligibility() and compute_flat_match() so that
    both hard-filter and soft-preference paths see consistent field names.
    Backward-compatible: fields already in the canonical form pass through unchanged.
    """
    w = dict(wizard)

    # ── 1. latest_move_in → completion_date ───────────────────────────────────
    # New wizard stores the hard deadline as wizard.latest_move_in ("YYYY-MM-DD").
    # compute_eligibility() reads wizard.completion_date.
    if w.get("latest_move_in") and not w.get("completion_date"):
        w["completion_date"] = w["latest_move_in"]

    # ── 2. outdoor.floor_rule → outdoor.ground_floor_sensitive / preferred_floor ─
    # New wizard stores a single enum: "no_ground" | "top_3" | "top_1" | "ignore".
    # _wizard_preferences_adjustment() reads outdoor.ground_floor_sensitive (Priority)
    # and outdoor.preferred_floor ("ground"|"low"|"middle"|"high"|"ignore").
    outdoor = dict(w.get("outdoor") or {})
    floor_rule = outdoor.get("floor_rule")
    if floor_rule and floor_rule != "ignore":
        if floor_rule == "no_ground" and not outdoor.get("ground_floor_sensitive"):
            outdoor["ground_floor_sensitive"] = "must"
        elif floor_rule in ("top_3", "top_1") and not outdoor.get("preferred_floor"):
            outdoor["preferred_floor"] = "top_3" if floor_rule == "top_3" else "top_floor"
    w["outdoor"] = outdoor

    # ── 3. budget.min_outdoor_area_m2 → outdoor.min_outdoor_area_m2 ───────────
    # Step 3 (Dispozice) saves the minimum outdoor area under wizard.budget.*
    # but compute_eligibility() and _flat_outdoor_fit() read outdoor.min_outdoor_area_m2.
    budget = w.get("budget") or {}
    if budget.get("min_outdoor_area_m2") is not None and outdoor.get("min_outdoor_area_m2") is None:
        w["outdoor"] = {**w.get("outdoor", {}), "min_outdoor_area_m2": budget["min_outdoor_area_m2"]}

    # NOTE: "bonus" is a valid Priority in the wizard UI but is NOT mapped here.
    # The structured_wizard path (wizardTransform.ts isPrefer()) treats "bonus"
    # as false (equivalent to "ignore"). This is intentional post-clean-slate.

    return w


# ---------------------------------------------------------------------------
# Structured wizard output — separates hard filters / preferences / metadata
# ---------------------------------------------------------------------------

@dataclass
class HardFilters:
    """Fields that EXCLUDE units/projects. If violated → score = 0."""
    # Price
    budget_max: int | None = None
    budget_max_tolerance_pct: float | None = None
    # Area
    area_min: float | None = None
    area_min_tolerance_pct: float | None = None
    # Outdoor area
    outdoor_area_min: float | None = None
    outdoor_area_min_tolerance_pct: float | None = None
    # Layouts (any-of)
    layouts: list[str] = field(default_factory=list)
    # Location — polygon / admin district (stored separately on profile)
    location_polygon: bool = False
    # Multi-value: broker/client can pick several preferred administrative
    # areas (e.g. ["Praha 5", "Praha 6"]).  Backward-compat: hydration
    # accepts both a plain string and a list of strings.
    location_admin_area: list[str] = field(default_factory=list)
    location_admin_region: str | None = None
    # Explicit opt-in for administrative-area hard filtering.  Without this
    # flag the `location_admin_area` list only acts as broker metadata and
    # never excludes projects.
    method_admin: bool = False
    # Commute — points stored separately on profile
    location_commute: bool = False
    # Completion
    latest_move_in: str | None = None  # "YYYY-MM-DD"
    # Renovation
    renovation_preference: str | None = None  # "only_new" | "only_renovation" | None
    # Standards — only "must" level
    must_recuperation: bool = False
    must_air_conditioning: bool = False
    must_floor_heating: bool = False
    must_exterior_blinds: bool = False
    # Amenities — only "must" level
    must_bike_room: bool = False
    must_stroller_room: bool = False
    must_fitness: bool = False
    must_courtyard_garden: bool = False
    must_reception: bool = False
    must_concierge: bool = False
    # Noise — only "must" level
    must_quiet_area: bool = False
    must_no_main_road: bool = False
    must_no_tram: bool = False
    must_no_railway: bool = False
    must_no_airport: bool = False
    # Outdoor — only "must" level
    must_outdoor_space: bool = False
    must_balcony: bool = False
    must_terrace: bool = False
    must_garden: bool = False
    # Payment
    max_payment_contract_pct: float | None = None
    max_payment_construction_pct: float | None = None
    # Days on market
    max_days_on_market: int | None = None
    # Energy
    energy_class: str | None = None  # "A" | "B" | "C" | "D" | None (ignore)
    # Floor
    exclude_ground_floor: bool = False
    penthouse_only: bool = False


@dataclass
class PreferenceTags:
    """Fields that RANK units but never exclude. Soft scoring + preference adj."""
    # Purchase purpose
    purchase_purpose: str | None = None  # "own_use" | "investment"
    # Standards — "prefer" level (not "must")
    prefer_recuperation: bool = False
    prefer_air_conditioning: bool = False
    prefer_floor_heating: bool = False
    prefer_exterior_blinds: bool = False
    prefer_smart_home: bool = False
    # Specific standard values
    heating_type: str | None = None
    heating_source: str | None = None
    partition_type: str | None = None  # flooring / partitions
    window_type: str | None = None  # actually ceiling height in wizard
    window_material: str | None = None
    flooring: str | None = None
    # Project amenities — "prefer" / "reject"
    prefer_reception: str | None = None  # "prefer" | "reject" | None
    prefer_fitness: str | None = None
    prefer_ev_charger: str | None = None
    prefer_courtyard_garden: str | None = None
    # Noise sensitivity — "prefer" level
    prefer_quiet_area: bool = False
    prefer_no_main_road: bool = False
    prefer_no_tram: bool = False
    prefer_no_railway: bool = False
    prefer_no_airport: bool = False
    # Floor preference
    preferred_floor: str | None = None  # "ground" | "low" | "middle" | "high" | None
    ground_floor_sensitive: bool = False  # prefer (not must) to avoid floor 1
    # Outdoor
    prefer_outdoor_space: bool = False
    outdoor_orientation: dict[str, str] | None = None  # {"south": "prefer", ...}
    # Renovation
    prefer_new: bool = False  # "prefer_new" (not "only_new")
    prefer_renovation: bool = False  # "prefer_renovation"
    # Completion
    earliest_move_in: str | None = None  # "YYYY-MM-DD"
    # Developer
    preferred_developer: str | None = None
    # Walkability (stored separately on profile, referenced here)
    walkability_active: bool = False
    # Skip categories
    skip_standards: bool = False
    skip_amenities: bool = False
    skip_noise: bool = False
    skip_walkability: bool = False
    # ── V2 unified dicts ────────────────────────────────────────────────
    # Standard modes: {"heating": "must", "recuperation": "prefer", ...}
    standard_modes: dict[str, str] = field(default_factory=dict)
    # Standard values (multi-select): {"heating": ["underfloor"], "flooring": ["wood", "vinyl"]}
    standard_values: dict[str, list[str]] = field(default_factory=dict)
    # Amenity modes: {"reception": "prefer", "fitness": "must", ...}
    amenity_modes: dict[str, str] = field(default_factory=dict)
    # POI modes: {"supermarket": "nice", "park": "must", "metro": "nice", ...}
    poi_modes: dict[str, str] = field(default_factory=dict)
    # POI max distances in meters: {"supermarket": 500, "metro": 800, ...}
    poi_max_distances: dict[str, int] = field(default_factory=dict)
    # Center preference: "closer" | "farther" | None
    center_preference: str | None = None
    # Completion preference: "sooner" | "later" | None (separate from hard filter deadline)
    completion_preference: str | None = None
    # Commute scoring mode: "primary" | "compromise" | "sum" | None
    commute_mode: str | None = None
    commute_primary_index: int | None = None


@dataclass
class WizardMetadata:
    """Non-filtering, non-scoring context for the broker."""
    client_type: str | None = None  # "family" | "couple" | "single" | "downsizing"
    financing_type: str | None = None  # "cash" | "mortgage" | "combo" | "unknown"
    assignment_important: str | None = None  # "yes" | "no" | "irrelevant"
    completion_standard: str | None = None  # "shell_and_core" | "white_wall" | "fit_out"
    property_type: str | None = None  # "any" | "apartment" | "house"


@dataclass
class StructuredWizard:
    """Clean, categorized wizard output. Source of truth for scoring pipeline."""
    hard_filters: HardFilters = field(default_factory=HardFilters)
    preferences: PreferenceTags = field(default_factory=PreferenceTags)
    metadata: WizardMetadata = field(default_factory=WizardMetadata)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalize_admin_area(raw: Any) -> list[str]:
    """Coerce a wizard administrative_area value into a clean list[str].

    admin_area is always list[str] in structured_wizard payloads.
    Empty/None becomes an empty list.  All entries are stripped and blanks
    are dropped while preserving order and deduplicating.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        out: list[str] = []
        seen: set[str] = set()
        for item in raw:
            if item is None:
                continue
            s = str(item).strip()
            if not s:
                continue
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(s)
        return out
    return []


def _admin_area_signal(
    project: "Project",
    hf: "HardFilters",
) -> dict[str, Any]:
    """Detailed admin_area signal used for both scoring and explainability.

    Returns a dict with:
        status: one of
            'off'        — no preferred areas selected
            'na'         — project missing admin/district data
            'inside'     — soft-mode match  (adj = +6.0)
            'outside'    — soft-mode miss   (adj = -3.0)
            'hard_match' — hard-mode match (adj = 0.0, just informational)
            'hard_miss'  — defensive: project that slipped past the hard filter
        adj: float contribution to the total score
        matched_area: original-casing label that matched, or None
        preferred_areas: list of preferred labels (original casing)

    `_admin_area_soft_adjustment` is a thin wrapper over this helper so the
    ranking behaviour stays unchanged.
    """
    if not hf.location_admin_area:
        return {
            "status": "off",
            "adj": 0.0,
            "matched_area": None,
            "preferred_areas": [],
        }

    preferred = [str(a).strip() for a in hf.location_admin_area if a and str(a).strip()]
    if not preferred:
        return {
            "status": "off",
            "adj": 0.0,
            "matched_area": None,
            "preferred_areas": [],
        }

    proj_admin = getattr(project, "administrative_district_iga", None)
    proj_district = getattr(project, "district", None)
    proj_municipality = getattr(project, "municipality", None)
    proj_city = getattr(project, "city", None)
    proj_cadastral = getattr(project, "cadastral_area_iga", None)
    proj_neighborhood = getattr(project, "neighborhood", None)
    candidates_raw = [
        str(v).strip()
        for v in (proj_neighborhood, proj_admin, proj_district, proj_municipality, proj_city, proj_cadastral)
        if v is not None and str(v).strip()
    ]

    if not candidates_raw:
        return {
            "status": "na",
            "adj": 0.0,
            "matched_area": None,
            "preferred_areas": preferred,
        }

    candidates_lower = {c.lower() for c in candidates_raw}
    matched_area: str | None = None
    for label in preferred:
        if label.lower() in candidates_lower:
            matched_area = label
            break

    if hf.method_admin:
        # Hard-filter path: project has already been filtered by eligibility;
        # anything reaching here should be a match, but be defensive.
        return {
            "status": "hard_match" if matched_area else "hard_miss",
            "adj": 0.0,
            "matched_area": matched_area,
            "preferred_areas": preferred,
        }

    if matched_area:
        return {
            "status": "inside",
            "adj": float(SCORING_V2_CONFIG.get("admin_inside_bonus", 4.0)),
            "matched_area": matched_area,
            "preferred_areas": preferred,
        }
    return {
        "status": "outside",
        "adj": float(SCORING_V2_CONFIG.get("admin_outside_penalty", -2.0)),
        "matched_area": None,
        "preferred_areas": preferred,
    }


def _admin_area_soft_adjustment(
    project: "Project",
    hf: "HardFilters",
) -> float:
    """Soft location preference based on `administrative_area` list.

    Only active when the broker/client did NOT opt in to the hard filter
    (`method_admin == False`).  When opted in, the hard filter has already
    excluded non-matching projects so the boost would be a no-op noise.

    Returns:
        +6.0 — project is inside one of the preferred areas
        -3.0 — project has admin data but no match
         0.0 — no admin data / no areas selected / method_admin opt-in active

    Values are intentionally small: they nudge ranking without overpowering
    the hard price/area/commute signals.
    """
    return float(_admin_area_signal(project, hf).get("adj") or 0.0)


def _admin_area_explain_texts(
    signal: dict[str, Any] | None,
) -> tuple[str | None, str | None]:
    """Translate an admin_area signal into (strength_text, compromise_text).

    Returns `(None, None)` when the signal is off / na / hard_miss — those
    states carry no actionable insight for the broker.
    """
    if not signal:
        return (None, None)
    status = signal.get("status")
    matched = signal.get("matched_area")
    if status in ("inside", "hard_match"):
        text = (
            f"V preferované části ({matched})"
            if matched
            else "V preferované části"
        )
        return (text, None)
    if status == "outside":
        return (None, "Mimo preferované části")
    return (None, None)


def _commute_explain_texts(
    fits: dict[str, Any],
) -> tuple[list[str], list[str]]:
    """Translate commute_details into human-readable strength / compromise texts.

    Replaces the generic "Dojezdové vzdálenosti" / "Dojezd" aspect label with
    specific per-point texts when travel-time data is available in the fits.

    Selection strategy
    ------------------
    Strengths  — points whose travel time is within max_minutes (passed=True),
                 prioritised by must_have first, then quickest.
    Compromises — points whose travel time exceeded the limit (passed=False),
                  prioritised by must_have first, then worst overshoot.

    Cap: at most 2 strengths and 2 compromises, to avoid zahltění.

    Format
    ------
    Strength    → "Do {label} za {N} min"
    Compromise  → "Delší dojezd do {label}"   (no exact minutes — avoids
                   confusion with hard-filter limit values)

    Returns ([], []) when commute_details is empty (no travel data cached or
    no commute points configured), allowing the generic aspect label to stand.
    """
    details: list[dict[str, Any]] = fits.get("commute_details") or []
    if not details:
        return ([], [])

    _priority_rank = {"must_have": 0, "prefer": 1, "ignore": 2}

    passed = [d for d in details if d.get("passed")]
    failed = [d for d in details if not d.get("passed")]

    # must_have first; within group, quickest travel time wins for strengths
    passed.sort(key=lambda d: (
        _priority_rank.get(str(d.get("priority", "ignore")), 2),
        float(d.get("minutes") or 999),
    ))
    # must_have first; within group, largest overshoot is most informative
    failed.sort(key=lambda d: (
        _priority_rank.get(str(d.get("priority", "ignore")), 2),
        -float(d.get("minutes") or 0),
    ))

    strengths: list[str] = []
    for d in passed[:2]:
        label = str(d.get("label") or "").strip()
        minutes = d.get("minutes")
        if label and minutes is not None:
            strengths.append(f"Do {label} za {int(round(float(minutes)))} min")

    compromises: list[str] = []
    for d in failed[:2]:
        label = str(d.get("label") or "").strip()
        if label:
            compromises.append(f"Delší dojezd do {label}")

    return (strengths, compromises)


def _hydrate_from_structured(sw_payload: dict, profile: ClientProfile) -> StructuredWizard:
    """Hydrate StructuredWizard from frontend-provided structured_wizard payload.

    Profile-column fields (budget_max, area_min, layouts, purchase_purpose, etc.)
    are always read from the DB profile object — they are authoritative and may be
    updated outside the wizard flow.
    """
    result = StructuredWizard()
    hf_d = sw_payload.get("hard_filters") or {}
    pref_d = sw_payload.get("preferences") or {}
    meta_d = sw_payload.get("metadata") or {}

    hf = result.hard_filters
    pref = result.preferences
    meta = result.metadata

    # ── Hard filters ────────────────────────────────────────────────────
    # Profile-column fields: always from DB
    hf.budget_max = profile.budget_max
    hf.area_min = profile.area_min
    layouts_raw = profile.layouts
    if isinstance(layouts_raw, dict) and "values" in layouts_raw:
        hf.layouts = [str(l) for l in (layouts_raw["values"] or []) if l]
    elif isinstance(layouts_raw, list):
        hf.layouts = [str(l) for l in layouts_raw if l]

    # Wizard-derived fields from structured payload
    hf.budget_max_tolerance_pct = hf_d.get("budget_max_tolerance_pct")
    hf.area_min_tolerance_pct = hf_d.get("area_min_tolerance_pct")
    hf.outdoor_area_min = hf_d.get("outdoor_area_min")
    hf.outdoor_area_min_tolerance_pct = hf_d.get("outdoor_area_min_tolerance_pct")

    hf.location_polygon = bool(hf_d.get("location_polygon"))
    hf.location_commute = bool(hf_d.get("location_commute"))
    hf.method_admin = bool(hf_d.get("method_admin"))
    hf.location_admin_area = _normalize_admin_area(hf_d.get("location_admin_area"))
    hf.location_admin_region = hf_d.get("location_admin_region")

    hf.latest_move_in = hf_d.get("latest_move_in")
    reno = hf_d.get("renovation_preference")
    hf.renovation_preference = reno if reno in ("only_new", "only_renovation") else None

    # Bool flags
    for attr in (
        "must_recuperation", "must_air_conditioning", "must_floor_heating",
        "must_exterior_blinds", "must_bike_room", "must_stroller_room",
        "must_fitness", "must_courtyard_garden", "must_reception", "must_concierge",
        "must_quiet_area", "must_no_main_road", "must_no_tram",
        "must_no_railway", "must_no_airport",
        "must_outdoor_space", "must_balcony", "must_terrace", "must_garden",
        "exclude_ground_floor", "penthouse_only",
    ):
        setattr(hf, attr, bool(hf_d.get(attr)))

    hf.max_payment_contract_pct = hf_d.get("max_payment_contract_pct")
    hf.max_payment_construction_pct = hf_d.get("max_payment_construction_pct")
    dom = hf_d.get("max_days_on_market")
    hf.max_days_on_market = int(dom) if dom is not None else None
    ec = hf_d.get("energy_class")
    hf.energy_class = ec if ec and ec != "ignore" else None

    # ── Preferences ─────────────────────────────────────────────────────
    # Profile-column field
    pref.purchase_purpose = profile.purchase_purpose

    # Bool flags
    for attr in (
        "prefer_recuperation", "prefer_air_conditioning", "prefer_floor_heating",
        "prefer_exterior_blinds", "prefer_smart_home",
        "prefer_quiet_area", "prefer_no_main_road", "prefer_no_tram",
        "prefer_no_railway", "prefer_no_airport",
        "ground_floor_sensitive", "prefer_outdoor_space",
        "prefer_new", "prefer_renovation",
        "skip_standards", "skip_amenities", "skip_noise", "skip_walkability",
    ):
        setattr(pref, attr, bool(pref_d.get(attr)))

    # String/value fields
    pref.heating_type = pref_d.get("heating_type")
    pref.heating_source = pref_d.get("heating_source")
    pref.partition_type = pref_d.get("partition_type")
    pref.window_type = pref_d.get("window_type")
    pref.window_material = pref_d.get("window_material")
    pref.prefer_reception = pref_d.get("prefer_reception")
    pref.prefer_fitness = pref_d.get("prefer_fitness")
    pref.prefer_ev_charger = pref_d.get("prefer_ev_charger")
    pref.prefer_courtyard_garden = pref_d.get("prefer_courtyard_garden")
    pref.preferred_floor = pref_d.get("preferred_floor")
    pref.outdoor_orientation = pref_d.get("outdoor_orientation")
    pref.earliest_move_in = pref_d.get("earliest_move_in")
    pref.preferred_developer = pref_d.get("preferred_developer")

    # Profile-column field
    pref.walkability_active = bool(profile.walkability_preferences_json)

    # ── Metadata ────────────────────────────────────────────────────────
    meta.client_type = meta_d.get("client_type")
    meta.financing_type = meta_d.get("financing_type")
    meta.assignment_important = meta_d.get("assignment_important")
    meta.completion_standard = meta_d.get("completion_standard")
    meta.property_type = profile.property_type

    # ── V2 unified dicts from structured payload ────────────────────────
    # Read directly from structured_wizard if provided
    v2_prefs = pref_d
    pref.standard_modes = dict(v2_prefs.get("standard_modes") or {})
    pref.standard_values = dict(v2_prefs.get("standard_values") or {})
    pref.amenity_modes = dict(v2_prefs.get("amenity_modes") or {})
    pref.poi_modes = dict(v2_prefs.get("poi_modes") or {})
    pref.poi_max_distances = dict(v2_prefs.get("poi_max_distances") or {})
    pref.center_preference = v2_prefs.get("center_preference")
    pref.completion_preference = v2_prefs.get("completion_preference")
    pref.commute_mode = v2_prefs.get("commute_mode")
    ci = v2_prefs.get("commute_primary_index")
    pref.commute_primary_index = int(ci) if ci is not None else None

    # If V2 dicts are empty, populate from legacy bool fields
    if not pref.standard_modes:
        # Reconstruct from wizard raw as fallback
        wiz = (profile.filter_json or {}).get("wizard") or {}
        standards = (wiz.get("standards") or {})
        house_amenities = (wiz.get("house_amenities") or {})
        project_amenities_d = (wiz.get("project_amenities") or {})
        _populate_v2_dicts(hf, pref, standards, house_amenities, project_amenities_d, profile)

    # ── Portal overrides ────────────────────────────────────────────────
    _apply_portal_overrides(hf, pref, profile)

    return result


def build_structured_wizard(profile: ClientProfile | None) -> StructuredWizard:
    """Transform wizard state into a clean structured model.

    Prefers filter_json.structured_wizard (frontend-provided) when available.
    Falls back to raw wizard transform when structured_wizard is absent.
    """
    result = StructuredWizard()
    if not profile:
        return result

    filter_json = profile.filter_json or {}

    # ── Prefer structured_wizard from frontend ──────────────────────────
    sw_payload = filter_json.get("structured_wizard")
    if isinstance(sw_payload, dict) and "hard_filters" in sw_payload:
        return _hydrate_from_structured(sw_payload, profile)

    # ── Fallback: transform from raw wizard ─────────────────────────────
    logger.warning(
        "build_structured_wizard: profile %s has no structured_wizard payload — using raw wizard fallback",
        getattr(profile, "id", "unknown"),
    )
    wizard = normalize_wizard(filter_json.get("wizard") or {})
    budget_section = wizard.get("budget") or {}
    outdoor_section = wizard.get("outdoor") or {}
    standards = wizard.get("standards") or {}
    noise = wizard.get("noise") or {}
    amenities = wizard.get("house_amenities") or {}
    project_amenities = wizard.get("project_amenities") or {}
    location = wizard.get("location") or {}
    skip = wizard.get("skip_categories") or {}

    hf = result.hard_filters
    pref = result.preferences
    meta = result.metadata

    # ── Hard filters: price / area / outdoor ────────────────────────────────
    hf.budget_max = profile.budget_max
    hf.budget_max_tolerance_pct = budget_section.get("max_price_tolerance_pct")
    hf.area_min = profile.area_min
    hf.area_min_tolerance_pct = budget_section.get("max_area_tolerance_pct")
    hf.outdoor_area_min = outdoor_section.get("min_outdoor_area_m2")
    hf.outdoor_area_min_tolerance_pct = budget_section.get("max_outdoor_tolerance_pct")

    # Layouts — stored as {"values": ["3kk", "4kk"]} or as a plain list
    layouts_raw = profile.layouts
    if isinstance(layouts_raw, dict) and "values" in layouts_raw:
        hf.layouts = [str(l) for l in (layouts_raw["values"] or []) if l]
    elif isinstance(layouts_raw, list):
        hf.layouts = [str(l) for l in layouts_raw if l]

    # Location
    hf.location_polygon = bool(location.get("method_polygon"))
    hf.location_commute = bool(location.get("method_commute"))
    hf.method_admin = bool(location.get("method_admin"))
    hf.location_admin_area = _normalize_admin_area(location.get("administrative_area"))
    hf.location_admin_region = location.get("administrative_region")

    # Completion
    hf.latest_move_in = wizard.get("completion_date") or wizard.get("latest_move_in")

    # Renovation — only "only_*" variants are hard filters
    reno = wizard.get("renovation_preference")
    if reno in ("only_new", "only_renovation"):
        hf.renovation_preference = reno

    # Standards — "must" level → hard filter
    hf.must_recuperation = standards.get("recuperation") == "must"
    hf.must_air_conditioning = standards.get("air_conditioning") == "must"
    hf.must_floor_heating = standards.get("floor_heating") == "must"
    hf.must_exterior_blinds = standards.get("exterior_blinds") == "must"

    # Amenities — "must" level → hard filter
    hf.must_bike_room = amenities.get("bike_room") == "must"
    hf.must_stroller_room = amenities.get("stroller_room") == "must"
    hf.must_fitness = amenities.get("fitness") == "must"
    hf.must_courtyard_garden = amenities.get("courtyard_garden") == "must"
    hf.must_reception = amenities.get("reception") == "must"
    hf.must_concierge = amenities.get("concierge") == "must"

    # Noise — "must" level → hard filter
    hf.must_quiet_area = noise.get("quiet_area") == "must"
    hf.must_no_main_road = noise.get("main_road") == "must"
    hf.must_no_tram = noise.get("tram") == "must"
    hf.must_no_railway = noise.get("railway") == "must"
    hf.must_no_airport = noise.get("airport") == "must"

    # Outdoor — "must" level → hard filter
    hf.must_outdoor_space = outdoor_section.get("outdoor_space") == "must"
    hf.must_balcony = outdoor_section.get("balcony") == "must"
    hf.must_terrace = outdoor_section.get("terrace") == "must"
    hf.must_garden = outdoor_section.get("garden") == "must"

    # Payment
    hf.max_payment_contract_pct = budget_section.get("max_payment_contract_pct")
    hf.max_payment_construction_pct = budget_section.get("max_payment_construction_pct")

    # Days on market
    dom = budget_section.get("max_days_on_market")
    hf.max_days_on_market = int(dom) if dom is not None else None

    # Energy class
    ec = wizard.get("energy_class")
    hf.energy_class = ec if ec and ec != "ignore" else None

    # Floor filters (NEW)
    floor_rule = outdoor_section.get("floor_rule")
    hf.exclude_ground_floor = floor_rule == "no_ground"
    hf.penthouse_only = floor_rule == "top_1"

    # ── Preferences ─────────────────────────────────────────────────────────
    pref.purchase_purpose = profile.purchase_purpose

    # Standards — "prefer" level
    pref.prefer_recuperation = standards.get("recuperation") == "prefer"
    pref.prefer_air_conditioning = standards.get("air_conditioning") == "prefer"
    # floor_heating from legacy wizard, or derived from heating_type enum
    _ht = standards.get("heating_type")
    _ht_vals = _ht if isinstance(_ht, list) else ([_ht] if _ht else [])
    pref.prefer_floor_heating = (
        standards.get("floor_heating") == "prefer"
        or "underfloor" in _ht_vals
    )
    pref.prefer_exterior_blinds = standards.get("exterior_blinds") == "prefer"
    pref.prefer_smart_home = standards.get("smart_home") == "prefer"

    # Specific standard values (for scoring match, not for hard filtering)
    # Wizard may send arrays (multi-select) — normalize to comma-separated strings
    def _enum_val(v: object) -> str | None:
        if isinstance(v, list):
            return ",".join(str(x) for x in v) if v else None
        return str(v) if v else None

    pref.heating_type = _enum_val(standards.get("heating_type"))
    pref.heating_source = _enum_val(standards.get("heating_source"))
    pref.partition_type = _enum_val(standards.get("partitions"))
    pref.window_type = _enum_val(standards.get("window_type"))
    pref.window_material = _enum_val(standards.get("window_material"))
    pref.flooring = _enum_val(standards.get("flooring"))

    # Project amenities
    pref.prefer_reception = project_amenities.get("reception")
    pref.prefer_fitness = project_amenities.get("fitness")
    pref.prefer_ev_charger = project_amenities.get("ev_charger")
    pref.prefer_courtyard_garden = project_amenities.get("courtyard_garden")

    # Noise — "prefer" level
    pref.prefer_quiet_area = noise.get("quiet_area") == "prefer"
    pref.prefer_no_main_road = noise.get("main_road") == "prefer"
    pref.prefer_no_tram = noise.get("tram") == "prefer"
    pref.prefer_no_railway = noise.get("railway") == "prefer"
    pref.prefer_no_airport = noise.get("airport") == "prefer"

    # Floor preference
    pref.preferred_floor = outdoor_section.get("preferred_floor")
    pref.ground_floor_sensitive = (
        outdoor_section.get("ground_floor_sensitive") == "prefer"
        or (floor_rule == "top_3" and not hf.exclude_ground_floor)
    )

    # Outdoor
    pref.prefer_outdoor_space = outdoor_section.get("outdoor_space") == "prefer"
    pref.outdoor_orientation = outdoor_section.get("orientation")

    # Renovation — "prefer_*" variants are preferences
    pref.prefer_new = reno == "prefer_new"
    pref.prefer_renovation = reno == "prefer_renovation"

    # Completion
    pref.earliest_move_in = wizard.get("earliest_move_in")

    # Developer
    pref.preferred_developer = wizard.get("preferred_developer")

    # Walkability
    pref.walkability_active = bool(profile.walkability_preferences_json)

    # Skip categories — wizard uses "surroundings" for noise+walkability combined
    pref.skip_standards = bool(skip.get("standards"))
    pref.skip_amenities = bool(skip.get("amenities"))
    pref.skip_noise = bool(skip.get("noise") or skip.get("surroundings"))
    pref.skip_walkability = bool(skip.get("walkability") or skip.get("surroundings"))

    # ── Metadata ────────────────────────────────────────────────────────────
    meta.client_type = wizard.get("client_type")
    meta.financing_type = wizard.get("financing_type")
    meta.assignment_important = wizard.get("assignment_important")
    meta.completion_standard = wizard.get("completion_standard")
    meta.property_type = profile.property_type

    # ── V2 unified dicts ────────────────────────────────────────────────────
    _populate_v2_dicts(hf, pref, standards, amenities, project_amenities, profile)

    # ── Portal overrides (client can flip must↔prefer in portal) ────────
    _apply_portal_overrides(hf, pref, profile)

    return result


def _populate_v2_dicts(
    hf: HardFilters,
    pref: PreferenceTags,
    standards: dict,
    amenities: dict,
    project_amenities: dict,
    profile: 'ClientProfile',
) -> None:
    """Populate V2 unified dicts (standard_modes/values, amenity_modes, poi_modes)
    from wizard data.  Called at the end of build_structured_wizard."""

    # ── Standards ────────────────────────────────────────────────────────
    # Boolean standards: recuperation, air_conditioning, exterior_blinds
    for key in ("recuperation", "air_conditioning", "exterior_blinds"):
        mode = standards.get(key)
        if mode in ("must", "prefer"):
            pref.standard_modes[key] = mode

    # Enum standards: heating_type→heating, heating_source, flooring, etc.
    for enum_key, std_key in V2_ENUM_STANDARD_MAP.items():
        vals = standards.get(enum_key)
        priority = standards.get(f"{enum_key}_priority")

        # Determine mode: _priority field > legacy floor_heating field > default
        if priority in ("must", "prefer"):
            mode = priority
        elif std_key == "heating" and standards.get("floor_heating") in ("must", "prefer"):
            mode = standards.get("floor_heating")
        elif vals:
            mode = "prefer"  # default if values selected but no explicit priority
        else:
            mode = None

        if mode:
            pref.standard_modes[std_key] = mode
            if isinstance(vals, list) and vals:
                pref.standard_values[std_key] = [str(v) for v in vals]
            elif vals:
                pref.standard_values[std_key] = [str(vals)]

    # ── Amenities ───────────────────────────────────────────────────────
    for key in V2_AMENITY_DB_FIELDS:
        if getattr(hf, f"must_{key}", False):
            pref.amenity_modes[key] = "must"
        else:
            val = project_amenities.get(key) or amenities.get(key)
            if val == "must":
                pref.amenity_modes[key] = "must"
            elif val in ("prefer", "dont_want"):
                pref.amenity_modes[key] = val

    # ── POI modes (from walkability_preferences_json) ───────────────────
    wprefs = (profile.walkability_preferences_json or {}) if profile else {}
    for key, val in wprefs.items():
        if val == "required":
            pref.poi_modes[key] = "must"
        elif val in ("important", "preferred"):
            pref.poi_modes[key] = "nice"
        # "normal", "not_important" → not included (= ignore)

    # ── POI max distances from wizard extras ──────────────────────────
    wizard_full = (profile.filter_json or {}).get("wizard") or {}
    raw_poi_dists = wizard_full.get("poi_max_distances") or {}
    for key, val in raw_poi_dists.items():
        if val is not None:
            try:
                pref.poi_max_distances[key] = int(val)
            except (ValueError, TypeError):
                pass

    # ── New preference fields from wizard ───────────────────────────────
    context = wizard_full.get("context") or {}
    location = wizard_full.get("location") or {}

    pref.center_preference = context.get("center_preference")  # "closer" | "farther" | None
    pref.completion_preference = context.get("completion_preference")  # "sooner" | "later" | None
    pref.commute_mode = location.get("commute_mode")  # "primary" | "compromise" | "sum"
    ci = location.get("commute_primary_index")
    pref.commute_primary_index = int(ci) if ci is not None else None


def _apply_portal_overrides(
    hf: HardFilters,
    pref: PreferenceTags,
    profile: 'ClientProfile',
) -> None:
    """Apply client portal overrides on top of wizard-derived modes.

    portal_overrides_json on profile stores client-side toggles that flip
    must↔prefer for standards/amenities, change commute mode, etc.
    """
    overrides = getattr(profile, "portal_overrides_json", None) or {}
    if not overrides:
        return

    # Standard mode overrides
    for field_key, ov in (overrides.get("standards") or {}).items():
        new_mode = ov.get("mode") if isinstance(ov, dict) else ov
        if new_mode not in ("must", "prefer", "ignore"):
            continue
        # Only allow flipping if the wizard originally set something (not "ignore")
        if field_key in pref.standard_modes or new_mode != "ignore":
            if new_mode == "ignore":
                pref.standard_modes.pop(field_key, None)
            else:
                pref.standard_modes[field_key] = new_mode
        # Sync legacy bool fields for eligibility
        must_attr = f"must_{field_key}"
        prefer_attr = f"prefer_{field_key}"
        if hasattr(hf, must_attr):
            setattr(hf, must_attr, new_mode == "must")
        if hasattr(pref, prefer_attr):
            setattr(pref, prefer_attr, new_mode == "prefer")

    # Amenity mode overrides
    for field_key, ov in (overrides.get("amenities") or {}).items():
        new_mode = ov.get("mode") if isinstance(ov, dict) else ov
        if new_mode in ("must", "prefer", "dont_want", "ignore"):
            if new_mode == "ignore":
                pref.amenity_modes.pop(field_key, None)
            else:
                pref.amenity_modes[field_key] = new_mode
            must_attr = f"must_{field_key}"
            if hasattr(hf, must_attr):
                setattr(hf, must_attr, new_mode == "must")

    # POI mode overrides
    for field_key, ov in (overrides.get("poi") or {}).items():
        new_mode = ov.get("mode") if isinstance(ov, dict) else ov
        if new_mode in ("must", "nice", "ignore"):
            if new_mode == "ignore":
                pref.poi_modes.pop(field_key, None)
            else:
                pref.poi_modes[field_key] = new_mode

    # Commute mode override
    cm = overrides.get("commute_mode")
    if cm in ("primary", "compromise", "sum"):
        pref.commute_mode = cm
    cpi = overrides.get("commute_primary_index")
    if cpi is not None:
        pref.commute_primary_index = int(cpi)


# ---------------------------------------------------------------------------
# Eligibility (hard filters)
# ---------------------------------------------------------------------------

def compute_eligibility(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    *,
    project_derived_total_floors: int | None = None,
) -> dict[str, Any]:
    """Evaluate hard-filter eligibility using StructuredWizard as source of truth.

    Returns {'status': 'pass'|'review'|'fail', 'reasons': [...]}.
    When a must-have field is NULL on the unit/project → status='review' instead of fail.
    """
    if not profile:
        return {"status": "pass", "reasons": []}

    sw = build_structured_wizard(profile)
    hf = sw.hard_filters
    reasons: list[str] = []
    has_review = False

    def _fail(reason: str):
        reasons.append(reason)

    def _review(reason: str):
        nonlocal has_review
        reasons.append(f"{reason} (data missing)")
        has_review = True

    # -- Standards --
    if hf.must_recuperation:
        val = getattr(project, "recuperation", None)
        if val is None:
            _review("recuperation")
        elif val != "true":
            _fail("recuperation")

    if hf.must_air_conditioning:
        val = getattr(unit, "air_conditioning", None)
        if val is None:
            _review("air_conditioning")
        elif not val:
            _fail("air_conditioning")

    if hf.must_floor_heating:
        h = getattr(unit, "heating", None) or getattr(project, "heating", None)
        if h is None:
            _review("floor_heating")
        else:
            h_lower = str(h).lower()
            if not ("podlah" in h_lower or "underfloor" in h_lower or "floor" in h_lower):
                _fail("floor_heating")

    if hf.must_exterior_blinds:
        eb = getattr(unit, "exterior_blinds", None)
        if eb is None:
            _review("exterior_blinds")
        elif str(eb).lower() in ("false", "0", ""):
            _fail("exterior_blinds")

    # -- Amenities --
    _amenity_checks: list[tuple[bool, str, str]] = [
        (hf.must_bike_room, "bike_room", "bike_room"),
        (hf.must_stroller_room, "stroller_room", "stroller_room"),
        (hf.must_fitness, "fitness", "fitness"),
        (hf.must_courtyard_garden, "courtyard_garden", "courtyard_garden"),
        (hf.must_reception, "reception", "reception"),
        (hf.must_concierge, "concierge", "concierge"),
    ]
    for must_flag, reason_key, project_attr in _amenity_checks:
        if must_flag:
            val = getattr(project, project_attr, None)
            if val is None:
                _review(reason_key)
            elif not val:
                _fail(reason_key)

    # -- Noise --
    if hf.must_quiet_area:
        nl = getattr(project, "noise_label", None)
        if nl and ("vyšší" in nl.lower() or "vysoký" in nl.lower() or "vysoká" in nl.lower()):
            _fail("quiet_area")

    _noise_checks: list[tuple[bool, str, str, int]] = [
        (hf.must_no_main_road, "main_road", "distance_to_primary_road_m", 150),
        (hf.must_no_tram, "tram", "distance_to_tram_tracks_m", 100),
        (hf.must_no_railway, "railway", "distance_to_railway_m", 300),
        (hf.must_no_airport, "airport", "distance_to_airport_m", 5000),
    ]
    for must_flag, reason_key, attr, threshold in _noise_checks:
        if must_flag:
            d = getattr(project, attr, None)
            if d is not None and d < threshold:
                _fail(f"{reason_key}_noise" if reason_key != "main_road" else reason_key)

    # -- Outdoor --
    # outdoor_area_min is a standalone hard filter: if the broker sets a
    # minimum outdoor area (m²), units below that threshold are excluded
    # regardless of must_outdoor_space.  must_outdoor_space additionally
    # requires ANY outdoor space (even if no minimum is set).
    _ext_raw = unit.exterior_area_m2
    _ext_val = float(_ext_raw) if _ext_raw is not None else 0.0
    if hf.outdoor_area_min is not None:
        tol = float(hf.outdoor_area_min_tolerance_pct or 0)
        effective_min = float(hf.outdoor_area_min) * (1 - tol / 100)
        if _ext_val < effective_min:
            _fail("outdoor_space_too_small")
    if hf.must_outdoor_space and _ext_val <= 0:
        _fail("outdoor_space")

    if hf.must_balcony:
        val = getattr(unit, "balcony_area_m2", None)
        if val is None or float(val) <= 0:
            _fail("balcony")

    if hf.must_terrace:
        val = getattr(unit, "terrace_area_m2", None)
        if val is None or float(val) <= 0:
            _fail("terrace")

    if hf.must_garden:
        val = getattr(unit, "garden_area_m2", None)
        if val is None or float(val) <= 0:
            _fail("garden")

    # -- Energy class --
    if hf.energy_class:
        unit_ec = getattr(project, "energy_class", None)
        if unit_ec:
            ec_order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6}
            req_rank = ec_order.get(hf.energy_class.upper(), 99)
            unit_rank = ec_order.get(str(unit_ec).strip().upper()[:1], 99)
            if unit_rank > req_rank + 1:
                _fail("energy_class")
        else:
            _review("energy_class")

    # -- Completion date --
    if hf.latest_move_in:
        from datetime import date as _date
        try:
            max_date = _date.fromisoformat(str(hf.latest_move_in))
            proj_date = getattr(project, "completion_date", None)
            if proj_date is not None:
                if isinstance(proj_date, str):
                    proj_date = _date.fromisoformat(proj_date)
                if hasattr(proj_date, "date"):
                    proj_date = proj_date.date()
                if proj_date > max_date:
                    _fail("completion_date")
        except (ValueError, TypeError):
            pass

    # -- Days on market --
    if hf.max_days_on_market is not None:
        proj_dom = getattr(project, "max_days_on_market", None)
        if proj_dom is not None and int(proj_dom) > hf.max_days_on_market:
            _fail("days_on_market")

    # -- Payment contract --
    if hf.max_payment_contract_pct is not None:
        proj_pc = getattr(project, "payment_contract", None)
        if proj_pc is not None:
            pct_val = float(proj_pc) * 100 if float(proj_pc) <= 1 else float(proj_pc)
            if pct_val > float(hf.max_payment_contract_pct):
                _fail("payment_contract")

    # -- Renovation preference --
    if hf.renovation_preference == "only_new" and unit.renovation is True:
        _fail("only_new")
    if hf.renovation_preference == "only_renovation" and unit.renovation is False:
        _fail("only_renovation")

    # -- Floor filters --
    unit_floor = getattr(unit, "floor", None)

    if hf.exclude_ground_floor:
        if unit_floor is not None and int(unit_floor) <= 1:
            _fail("exclude_ground_floor")
        elif unit_floor is None:
            _review("exclude_ground_floor")

    if hf.penthouse_only:
        if unit_floor is not None and project_derived_total_floors is not None:
            if int(unit_floor) < int(project_derived_total_floors):
                _fail("penthouse_only")
        elif unit_floor is None or project_derived_total_floors is None:
            _review("penthouse_only")

    # ── Location hard filters ───────────────────────────────────────────
    #
    # Priority:
    #   1. Polygon  — the primary "kde se vůbec hledá" hard filter.
    #                 Applied whenever profile.polygon_geojson exists.
    #   2. Commute  — enforced per-point inside compute_match / compute_flat_match
    #                 (must_have points that exceed the time budget return 0).
    #                 Not repeated here to avoid double-eval.
    #   3. Admin_area — soft preference by default (ranking only, handled in
    #                 `_admin_area_soft_adjustment`).  Becomes a hard filter
    #                 ONLY when the broker explicitly opted in via
    #                 `method_admin = True`.
    #
    # This order also guarantees that `reasons[0]` points at the polygon
    # failure first when both polygon and admin_area would fail, which
    # matches the product wording "polygon = hlavní hard filtr lokality".

    # -- Polygon (primary location hard filter) --
    # Uses MultiPolygon-aware parser so both Polygon and MultiPolygon
    # GeoJSON types are handled correctly.
    if profile.polygon_geojson:
        _ensure_geo_helpers()
        polys = _parse_polygon_or_multipolygon_geojson(profile.polygon_geojson)
        if polys:
            lat = getattr(project, "gps_latitude", None)
            lon = getattr(project, "gps_longitude", None)
            if lat is not None and lon is not None:
                if not _point_in_any_polygon(float(lat), float(lon), polys):
                    _fail("outside_polygon")
            else:
                _review("polygon_location")

    # -- Administrative area (opt-in hard filter) --
    # Only applied when the broker/client explicitly chose
    # "Použít preferované oblasti i jako striktní požadavek".  Without that
    # opt-in, `location_admin_area` acts as a ranking-only soft preference
    # (see `_admin_area_soft_adjustment`).
    if hf.method_admin and hf.location_admin_area:
        proj_admin = getattr(project, "administrative_district_iga", None)
        proj_district = getattr(project, "district", None)
        proj_municipality = getattr(project, "municipality", None)
        proj_city = getattr(project, "city", None)
        proj_cadastral = getattr(project, "cadastral_area_iga", None)
        proj_neighborhood = getattr(project, "neighborhood", None)
        candidates = {
            str(v).strip().lower()
            for v in (proj_neighborhood, proj_admin, proj_district, proj_municipality, proj_city, proj_cadastral)
            if v is not None and str(v).strip()
        }
        if not candidates:
            _review("admin_area")
        else:
            targets = {a.strip().lower() for a in hf.location_admin_area if a.strip()}
            if targets and not (targets & candidates):
                _fail("outside_admin_area")

    # -- Walkability: required preferences act as hard filters --
    wprefs = (profile.walkability_preferences_json or {}) if profile else {}
    _required_prefs = [k for k, v in wprefs.items() if v == "required"]
    if _required_prefs:
        # POI categories: require at least 1 facility within 500m
        _poi_count_fields: dict[str, str] = {
            "supermarket": "count_supermarket_500m",
            "park": "count_park_500m",
            "cafe": "count_cafe_500m",
            "restaurant": "count_restaurant_500m",
            "fitness": "count_fitness_500m",
            "playground": "count_playground_500m",
            "kindergarten": "count_kindergarten_500m",
            "primary_school": "count_primary_school_500m",
        }
        for pref_key in _required_prefs:
            count_field = _poi_count_fields.get(pref_key)
            if count_field:
                cnt = getattr(project, count_field, None)
                if cnt is None:
                    _review(f"poi_required_{pref_key}")
                elif int(cnt) == 0:
                    _fail(f"poi_required_{pref_key}")

        # MHD categories: require project within distance threshold
        _mhd_thresholds: dict[str, tuple[str, int]] = {
            "metro": ("distance_to_metro_station_m", 600),
            "tram":  ("distance_to_tram_stop_m", 300),
            "bus":   ("distance_to_bus_stop_m", 200),
        }
        for pref_key in _required_prefs:
            mhd = _mhd_thresholds.get(pref_key)
            if mhd:
                attr, threshold = mhd
                d = getattr(project, attr, None)
                if d is None:
                    _review(f"mhd_required_{pref_key}")
                elif float(d) > threshold:
                    _fail(f"mhd_required_{pref_key}")

    # Determine status
    fail_reasons = [r for r in reasons if "(data missing)" not in r]
    if fail_reasons:
        return {"status": "fail", "reasons": reasons}
    if has_review:
        return {"status": "review", "reasons": reasons}
    return {"status": "pass", "reasons": []}


# ---------------------------------------------------------------------------
# Soft scoring helpers
# ---------------------------------------------------------------------------

def _flat_outdoor_fit(unit, outdoor_area_min: float | None = None) -> float:
    """Score: outdoor space size. Bigger = better up to 50m².

    outdoor_area_min from HardFilters.outdoor_area_min.
    """
    ext = getattr(unit, 'exterior_area_m2', None)
    if ext is not None:
        outdoor = float(ext)
    else:
        outdoor = (
            float(getattr(unit, 'balcony_area_m2', None) or 0)
            + float(getattr(unit, 'terrace_area_m2', None) or 0)
            + float(getattr(unit, 'garden_area_m2', None) or 0)
        )

    if outdoor_area_min is not None:
        min_out = float(outdoor_area_min)
        if outdoor < min_out * 0.5:
            return 10.0
        if outdoor < min_out:
            return 30.0 + 40.0 * (outdoor / min_out)

    # Cap scoring benefit at 50m²
    cap = min(outdoor, 50.0)
    if cap <= 0:
        return 20.0
    return min(100.0, 20.0 + cap * 1.6)


def _check_standard_match(val, field: str) -> bool:
    """Check if a standard value matches what the client wants."""
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ('true', '1', 'yes', 'ano'):
        return True
    if field == 'heating' and 'podlah' in s:
        return True
    if field == 'recuperation' and s not in ('none', 'false', '0', 'ne', ''):
        return True
    if field == 'exterior_blinds' and s not in ('false', '0', ''):
        return True  # "preparation" counts as having blinds
    if field == 'air_conditioning' and s not in ('false', '0', 'none', ''):
        return True
    return s not in ('false', '0', 'no', 'ne', 'none', '')


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two GPS points."""
    from math import radians, sin, cos, asin, sqrt
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * 6371 * asin(sqrt(a))


# ---------------------------------------------------------------------------
# V2 fit functions
# ---------------------------------------------------------------------------

def _v2_price_savings_fit(unit, profile, cfg: dict) -> float:
    """Bell-curve: sweet spot at 30-55% savings vs budget."""
    price = getattr(unit, 'price_czk', None)
    if price is None or not profile:
        return 50.0
    budget = getattr(profile, 'budget_max', None)
    if not budget or budget <= 0:
        return 50.0
    savings_pct = (budget - price) / budget * 100
    if savings_pct < 0:
        return 0.0
    sweet_lo = cfg.get("price_bell_sweet_low", 30)
    sweet_hi = cfg.get("price_bell_sweet_high", 55)
    penalty_rate = cfg.get("price_bell_penalty", 1.5)
    if savings_pct <= 5:
        return 55.0 + savings_pct * 2.0
    if savings_pct <= sweet_lo:
        return 65.0 + (savings_pct - 5) * (35.0 / max(sweet_lo - 5, 1))
    if savings_pct <= sweet_hi:
        return 100.0
    return max(0.0, 100.0 - (savings_pct - sweet_hi) * penalty_rate)


def _v2_price_per_m2_fit(unit, cfg: dict) -> float:
    """Cheaper than neighbourhood = better."""
    diff_1k = getattr(unit, 'local_price_diff_1000m', None)
    diff_2k = getattr(unit, 'local_price_diff_2000m', None)
    diff = float(diff_1k) if diff_1k is not None else (float(diff_2k) if diff_2k is not None else None)
    if diff is None:
        return 50.0
    neutral = cfg.get("price_m2_neutral", 70)
    if diff <= 0:
        bonus = cfg.get("price_m2_cheap_bonus", 1.5)
        return min(100.0, neutral + abs(diff) * bonus)
    pen = cfg.get("price_m2_expensive_penalty", 2.5)
    return max(0.0, neutral - diff * pen)


def _v2_area_fit(unit, profile, cfg: dict) -> float:
    """Bigger = better, cap at area_ratio_cap × area_min."""
    area = float(unit.floor_area_m2) if getattr(unit, 'floor_area_m2', None) is not None else None
    if area is None or not profile:
        return 50.0
    area_min = getattr(profile, 'area_min', None)
    if area_min is None or float(area_min) <= 0:
        return 50.0
    area_min = float(area_min)
    ratio = area / area_min
    cap = cfg.get("area_ratio_cap", 1.5)
    if ratio < 0.8:
        return max(0.0, ratio * 50.0)
    if ratio < 1.0:
        return 40.0 + (ratio - 0.8) * 200.0
    if ratio < cap:
        return 80.0 + (ratio - 1.0) * (20.0 / max(cap - 1.0, 0.01))
    return 100.0


def _v2_payment_fit(unit) -> float:
    """More payment at completion = better."""
    contract_pct = getattr(unit, 'payment_contract', None)
    construction_pct = getattr(unit, 'payment_construction', None)
    completion_pct = getattr(unit, 'payment_occupancy', None)
    if contract_pct is None and construction_pct is None:
        return 50.0
    cp = float(contract_pct or 0)
    bp = float(construction_pct or 0)
    op = float(completion_pct or 0)
    if cp <= 1:
        cp *= 100
    if bp <= 1:
        bp *= 100
    if op <= 1:
        op *= 100
    return max(0.0, min(100.0, op * 1.2 + 10.0))


def _v2_commute_fit(
    project, profile, db, pref: 'PreferenceTags', cfg: dict,
) -> tuple[float, list[dict[str, Any]], bool]:
    """Commute scoring with 3 modes: primary, compromise, sum.

    Returns (fit, commute_details, hard_fail).
    """
    commute_details: list[dict[str, Any]] = []

    if (
        not profile
        or not getattr(profile, 'commute_points_json', None)
        or getattr(project, 'gps_latitude', None) is None
        or getattr(project, 'gps_longitude', None) is None
        or db is None
    ):
        return 0.0, [], False

    points = profile.commute_points_json or []
    if isinstance(points, dict):
        points = points.get('points') or []
    if not points:
        return 50.0, [], False

    per_point_fits: list[dict[str, Any]] = []
    hard_fail = False

    for i, cp in enumerate(points):
        try:
            label = str(cp.get('label') or '')
            float(cp.get('lat'))
            float(cp.get('lng'))
            mode = str(cp.get('mode') or 'drive')
            max_minutes = float(cp.get('max_minutes'))
        except Exception:
            continue
        priority = str(cp.get('priority') or 'ignore')
        tol = cp.get('tolerance_minutes')
        tolerance_minutes = float(tol) if tol is not None else 0.0
        commute_result = get_cached_commute_result(db, project, cp)
        if commute_result is None:
            continue
        travel_min = commute_result.minutes
        limit = max_minutes + tolerance_minutes

        # Hard fail check (always, regardless of mode)
        if priority == 'must_have' and travel_min > limit:
            commute_details.append({
                'label': label, 'mode': mode, 'minutes': travel_min,
                'max_minutes': max_minutes, 'priority': priority, 'passed': False,
                'itinerary': commute_result.itinerary,
                'is_estimated': commute_result.is_estimated,
            })
            hard_fail = True
            break

        # Per-point fit
        if priority in ('must_have', 'prefer'):
            if travel_min <= max_minutes:
                pt_fit = 100.0
            elif travel_min > limit and limit > 0:
                pt_fit = 0.0
            elif limit > max_minutes:
                ratio = (travel_min - max_minutes) / max(1.0, limit - max_minutes)
                pt_fit = max(0.0, 100.0 * (1.0 - ratio))
            else:
                pt_fit = 0.0
        else:
            pt_fit = 50.0  # "ignore" priority

        per_point_fits.append({
            'index': i, 'fit': pt_fit, 'label': label, 'mode': mode,
            'minutes': travel_min, 'max_minutes': max_minutes,
            'priority': priority, 'passed': travel_min <= limit,
            'itinerary': commute_result.itinerary,
            'is_estimated': commute_result.is_estimated,
        })

    if hard_fail:
        return 0.0, commute_details or [d for d in per_point_fits], True

    commute_details = per_point_fits
    if not per_point_fits:
        return 50.0, [], False

    # Aggregate by mode
    scoring_fits = [d for d in per_point_fits if d['priority'] in ('must_have', 'prefer')]
    if not scoring_fits:
        return 50.0, commute_details, False

    commute_mode = pref.commute_mode or 'compromise'
    primary_idx = pref.commute_primary_index or 0

    if commute_mode == 'primary' and len(scoring_fits) >= 2:
        pw = cfg.get('commute_primary_weight', 0.80)
        sw = cfg.get('commute_secondary_weight', 0.20)
        # Find primary among scoring fits
        primary_fit = scoring_fits[0]['fit']
        for sf in scoring_fits:
            if sf['index'] == primary_idx:
                primary_fit = sf['fit']
                break
        secondary_fits = [sf['fit'] for sf in scoring_fits if sf['index'] != primary_idx]
        sec_avg = sum(secondary_fits) / len(secondary_fits) if secondary_fits else 50.0
        fit = primary_fit * pw + sec_avg * sw

    elif commute_mode == 'sum':
        total_min = sum(sf['minutes'] for sf in scoring_fits)
        total_max = sum(sf['max_minutes'] for sf in scoring_fits)
        if total_min <= total_max:
            fit = 100.0
        else:
            over_ratio = (total_min - total_max) / max(total_max, 1.0)
            penalty_rate = cfg.get('commute_sum_penalty_rate', 2.0)
            fit = max(0.0, 100.0 * (1.0 - over_ratio * penalty_rate))

    else:  # compromise (default)
        fit = min(sf['fit'] for sf in scoring_fits)

    return fit, commute_details, False


def _v2_walkability_poi_fit(project, pref: 'PreferenceTags', cfg: dict) -> float:
    """Per-category POI scoring. "nice" POIs contribute to fit, "must" always pass (hard filter)."""
    active_pois = {k: v for k, v in pref.poi_modes.items() if v in ("nice", "must")}
    if not active_pois:
        return 50.0  # no POI preferences → neutral

    gradual_cats = set(cfg.get("poi_gradual_categories", ["restaurant", "cafe"]))
    gradual_scores = cfg.get("poi_gradual_scores", [0, 40, 60, 75, 90, 100])

    poi_fits: list[float] = []
    for key, mode in active_pois.items():
        # If client set a max distance for this POI, use distance-based scoring
        client_max = pref.poi_max_distances.get(key)
        if client_max and hasattr(project, f"distance_to_{key}_m"):
            d = getattr(project, f"distance_to_{key}_m", None)
            if d is None:
                poi_fits.append(50.0)
            elif float(d) <= client_max:
                poi_fits.append(100.0)
            else:
                over_ratio = (float(d) - client_max) / (client_max * 2)
                poi_fits.append(max(0.0, 100.0 * (1.0 - min(over_ratio, 1.0))))
            continue
        # Count-based POI
        count_field = V2_POI_COUNT_FIELDS.get(key)
        if count_field:
            cnt = getattr(project, count_field, None)
            cnt = int(cnt) if cnt is not None else 0
            if key in gradual_cats:
                idx = min(cnt, len(gradual_scores) - 1)
                poi_fits.append(float(gradual_scores[idx]))
            else:
                poi_fits.append(100.0 if cnt >= 1 else 0.0)
            continue
        # Distance-based POI (metro, tram, bus, train)
        dist_info = V2_POI_DISTANCE_FIELDS.get(key)
        if dist_info:
            attr, default_threshold = dist_info
            # Client-specific threshold overrides default
            threshold = pref.poi_max_distances.get(key, default_threshold)
            d = getattr(project, attr, None)
            if d is None:
                poi_fits.append(50.0)
            elif float(d) <= threshold:
                poi_fits.append(100.0)
            else:
                # Linear decay up to 3× threshold
                over_ratio = (float(d) - threshold) / (threshold * 2)
                poi_fits.append(max(0.0, 100.0 * (1.0 - min(over_ratio, 1.0))))
            continue

    return sum(poi_fits) / len(poi_fits) if poi_fits else 50.0


def _v2_center_distance_fit(project, pref: 'PreferenceTags', cfg: dict) -> float:
    """Closer/farther to city center."""
    lat = getattr(project, 'gps_latitude', None)
    lon = getattr(project, 'gps_longitude', None)
    if lat is None or lon is None:
        return 50.0

    center_lat = cfg.get("center_lat", 50.087431)
    center_lng = cfg.get("center_lng", 14.420073)
    dist_km = _haversine_km(float(lat), float(lon), center_lat, center_lng)

    near_full = cfg.get("center_near_full_km", 3)
    near_mid = cfg.get("center_near_mid_km", 8)
    far_cutoff = cfg.get("center_far_cutoff_km", 20)

    direction = pref.center_preference
    if direction == "closer":
        if dist_km <= near_full:
            return 100.0
        if dist_km <= near_mid:
            return 100.0 - (dist_km - near_full) / (near_mid - near_full) * 40.0
        if dist_km <= far_cutoff:
            return 60.0 - (dist_km - near_mid) / (far_cutoff - near_mid) * 36.0
        return 20.0
    elif direction == "farther":
        if dist_km >= far_cutoff:
            return 100.0
        if dist_km >= near_mid:
            return 60.0 + (dist_km - near_mid) / (far_cutoff - near_mid) * 40.0
        if dist_km >= near_full:
            return 30.0 + (dist_km - near_full) / (near_mid - near_full) * 30.0
        return 30.0
    return 50.0  # should not reach here if aspect is active


def _v2_completion_preference_fit(project, pref: 'PreferenceTags') -> float:
    """Sooner/later preference for move-in date."""
    from datetime import date as _date

    proj_date = getattr(project, 'completion_date', None)
    if proj_date is None:
        return 50.0
    try:
        if isinstance(proj_date, str):
            proj_date = _date.fromisoformat(proj_date)
        if hasattr(proj_date, 'date'):
            proj_date = proj_date.date()
    except (ValueError, TypeError):
        return 50.0

    months = (proj_date - _date.today()).days / 30.0

    direction = pref.completion_preference
    if direction == "sooner":
        if months <= 3:
            return 100.0
        if months <= 12:
            return 100.0 - (months - 3) * 5.0
        if months <= 36:
            return 55.0 - (months - 12) * 1.5
        return 15.0
    elif direction == "later":
        if months >= 36:
            return 100.0
        if months >= 12:
            return 55.0 + (months - 12) * (45.0 / 24.0)
        if months >= 3:
            return 30.0 + (months - 3) * (25.0 / 9.0)
        return 30.0
    return 50.0


def _v2_renovation_preference_fit(unit, pref: 'PreferenceTags') -> float:
    """Preference (not hard filter) for new build vs renovation."""
    is_reno = getattr(unit, 'renovation', None)
    if is_reno is None:
        return 50.0
    if pref.prefer_new:
        return 30.0 if is_reno else 85.0
    if pref.prefer_renovation:
        return 85.0 if is_reno else 30.0
    return 50.0


def _v2_standard_preference_fit(
    unit, project, std_key: str, selected_values: list[str] | None, cfg: dict,
) -> float:
    """Multi-select standard preference: any-match → high fit."""
    match_val = cfg.get("pref_match", 95)
    miss_val = cfg.get("pref_miss", 15)
    neutral_val = cfg.get("pref_neutral", 50)

    db_fields = V2_STANDARD_DB_FIELDS.get(std_key)
    if not db_fields:
        return float(neutral_val)

    unit_field, project_field = db_fields
    val = None
    if unit_field:
        val = getattr(unit, unit_field, None)
    if val is None and project_field:
        val = getattr(project, project_field, None)
    if val is None:
        return float(neutral_val)

    # Boolean standards (recuperation, air_conditioning, exterior_blinds)
    if not selected_values:
        # Bool check: does project/unit have the feature?
        has_it = _check_standard_match(val, unit_field or project_field or std_key)
        return float(match_val) if has_it else float(miss_val)

    # Multi-select: any of the selected values match?
    val_lower = str(val).strip().lower()
    for sv in selected_values:
        if sv.strip().lower() in val_lower:
            return float(match_val)
    return float(miss_val)


def _v2_amenity_preference_fit(project, field_key: str, mode: str, cfg: dict) -> float:
    """Amenity preference: prefer/dont_want."""
    match_val = cfg.get("pref_match", 95)
    miss_val = cfg.get("pref_miss", 15)
    neutral_val = cfg.get("pref_neutral", 50)

    val = getattr(project, field_key, None)
    has_it = bool(val) if val is not None else False

    if mode in ("prefer", "must"):
        # "must" already hard-filtered; for scoring treat same as "prefer"
        return float(match_val) if has_it else float(miss_val)
    if mode == "dont_want":
        return float(match_val) if not has_it else float(miss_val)
    return float(neutral_val)


def _v2_noise_adj(project, cfg: dict) -> float:
    """Noise adjustment (outside weighted system). Higher noise = penalty."""
    adj = 0.0
    noise_db = getattr(project, 'noise_day_db', None)
    if noise_db is not None:
        noise_db = float(noise_db)
        if noise_db < 50:
            adj += cfg.get("noise_quiet_bonus", 2)
        elif 60 <= noise_db < 65:
            adj += cfg.get("noise_medium_penalty", -1)
        elif 65 <= noise_db < 70:
            adj += cfg.get("noise_high_penalty", -3)
        elif noise_db >= 70:
            adj += cfg.get("noise_very_high_penalty", -5)

    # Proximity penalties
    road_dist = getattr(project, 'distance_to_primary_road_m', None)
    if road_dist is not None and float(road_dist) < cfg.get("noise_road_close_m", 200):
        adj += cfg.get("noise_road_penalty", -2)
    tram_dist = getattr(project, 'distance_to_tram_tracks_m', None)
    if tram_dist is not None and float(tram_dist) < cfg.get("noise_tram_close_m", 150):
        adj += cfg.get("noise_tram_penalty", -1)
    rail_dist = getattr(project, 'distance_to_railway_m', None)
    if rail_dist is not None and float(rail_dist) < cfg.get("noise_rail_close_m", 400):
        adj += cfg.get("noise_rail_penalty", -2)
    airport_dist = getattr(project, 'distance_to_airport_m', None)
    if airport_dist is not None and float(airport_dist) < cfg.get("noise_airport_close_m", 3000):
        adj += cfg.get("noise_airport_penalty", -2)

    return max(cfg.get("noise_adj_min", -8), min(cfg.get("noise_adj_max", 2), adj))


def compute_flat_match(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    flat_weights: dict[str, float],
    db: Session | None = None,
) -> tuple[float, dict[str, Any]]:
    """Compute match score using V2 core+preference pool model.

    Core aspects (always active, ~64 pts) + preference aspects (standards/amenities,
    ~36 pts) are redistributed based on what's active.  Noise and admin area are
    applied as adjustments outside the weighted system.

    The flat_weights parameter is accepted for backward compatibility — if broker
    weight overrides exist, they are applied on top of the computed weights.
    """
    _ensure_geo_helpers()
    cfg = SCORING_V2_CONFIG

    sw = build_structured_wizard(profile)
    hf = sw.hard_filters
    pref = sw.preferences

    # ── Determine active core aspects ───────────────────────────────────
    core_base: dict[str, float] = dict(cfg["core_weights"])

    # Center distance: only active if preference set
    if not pref.center_preference:
        core_base.pop("center_distance", None)

    # Completion preference: only active if sooner/later preference
    if not pref.completion_preference:
        core_base.pop("completion_preference", None)

    # Renovation preference: only active if preference set
    if not pref.prefer_new and not pref.prefer_renovation:
        core_base.pop("renovation_preference", None)

    # ── Determine active preference aspects ─────────────────────────────
    # Standards in "prefer" mode score; "must" is hard-filtered, "ignore" is off
    active_std_prefer = [
        (k, pref.standard_values.get(k))
        for k, mode in pref.standard_modes.items()
        if mode == "prefer"
    ]
    # Also score "must" standards (already hard-filtered, but still rank)
    active_std_must = [
        (k, pref.standard_values.get(k))
        for k, mode in pref.standard_modes.items()
        if mode == "must"
    ]
    active_std_scoring = active_std_prefer + active_std_must

    active_amen_prefer = [
        (k, mode)
        for k, mode in pref.amenity_modes.items()
        if mode in ("prefer", "dont_want")
    ]
    active_amen_must = [
        (k, mode)
        for k, mode in pref.amenity_modes.items()
        if mode == "must"
    ]
    active_amen_scoring = active_amen_prefer + active_amen_must

    # ── Compute weights with redistribution ─────────────────────────────
    core_total = sum(core_base.values())

    std_pool = cfg.get("pref_standard_pool", 22.0) if active_std_scoring else 0.0
    amen_pool = cfg.get("pref_amenity_pool", 14.0) if active_amen_scoring else 0.0
    active_total = core_total + std_pool + amen_pool

    if active_total > 0:
        scale = 100.0 / active_total
    else:
        scale = 1.0

    core_weights = {k: v * scale for k, v in core_base.items()}
    std_count = len(active_std_scoring)
    amen_count = len(active_amen_scoring)
    std_weight_each = (std_pool * scale / std_count) if std_count > 0 else 0.0
    amen_weight_each = (amen_pool * scale / amen_count) if amen_count > 0 else 0.0

    # ── Compute aspect fits ─────────────────────────────────────────────
    aspect_fits: dict[str, float] = {}
    aspect_weights: dict[str, float] = {}

    # --- Core: Cena ---
    aspect_fits['price_savings'] = _v2_price_savings_fit(unit, profile, cfg)
    aspect_weights['price_savings'] = core_weights.get('price_savings', 0.0)

    aspect_fits['price_per_m2'] = _v2_price_per_m2_fit(unit, cfg)
    aspect_weights['price_per_m2'] = core_weights.get('price_per_m2', 0.0)

    # --- Core: Plocha ---
    aspect_fits['unit_area'] = _v2_area_fit(unit, profile, cfg)
    aspect_weights['unit_area'] = core_weights.get('unit_area', 0.0)

    aspect_fits['outdoor_area'] = _flat_outdoor_fit(unit, outdoor_area_min=hf.outdoor_area_min)
    aspect_weights['outdoor_area'] = core_weights.get('outdoor_area', 0.0)

    # --- Core: Platební podmínky ---
    aspect_fits['payment_schedule'] = _v2_payment_fit(unit)
    aspect_weights['payment_schedule'] = core_weights.get('payment_schedule', 0.0)

    # --- Core: Dojezdy ---
    commute_fit, commute_details, commute_hard_fail = _v2_commute_fit(
        project, profile, db, pref, cfg)
    aspect_fits['commute_time'] = commute_fit
    aspect_weights['commute_time'] = core_weights.get('commute_time', 0.0)

    # --- Core: Walkability/POI ---
    aspect_fits['walkability_poi'] = _v2_walkability_poi_fit(project, pref, cfg)
    aspect_weights['walkability_poi'] = core_weights.get('walkability_poi', 0.0)

    # --- Core: Vzdálenost od centra ---
    if 'center_distance' in core_weights:
        aspect_fits['center_distance'] = _v2_center_distance_fit(project, pref, cfg)
        aspect_weights['center_distance'] = core_weights['center_distance']

    # --- Core: Nastěhování preference ---
    if 'completion_preference' in core_weights:
        aspect_fits['completion_preference'] = _v2_completion_preference_fit(project, pref)
        aspect_weights['completion_preference'] = core_weights['completion_preference']

    # --- Core: Renovace preference ---
    if 'renovation_preference' in core_weights:
        aspect_fits['renovation_preference'] = _v2_renovation_preference_fit(unit, pref)
        aspect_weights['renovation_preference'] = core_weights['renovation_preference']

    # --- Preference: Standardy ---
    for std_key, std_vals in active_std_scoring:
        aspect_key = f"std_{std_key}"
        aspect_fits[aspect_key] = _v2_standard_preference_fit(
            unit, project, std_key, std_vals, cfg)
        aspect_weights[aspect_key] = std_weight_each

    # --- Preference: Vybavení ---
    for amen_key, amen_mode in active_amen_scoring:
        aspect_key = f"amen_{amen_key}"
        aspect_fits[aspect_key] = _v2_amenity_preference_fit(
            project, amen_key, amen_mode, cfg)
        aspect_weights[aspect_key] = amen_weight_each

    # ── Weighted total ──────────────────────────────────────────────────
    if commute_hard_fail:
        fits = {
            **aspect_fits, 'commute_details': commute_details,
            'commute_hard_fail': True, 'aspect_weights': aspect_weights,
        }
        return 0.0, fits

    total = 0.0
    for key, fit_val in aspect_fits.items():
        w = aspect_weights.get(key, 0.0)
        total += w * fit_val / 100.0

    # Adjustments (outside weighted system)
    noise_adj = _v2_noise_adj(project, cfg)
    admin_signal = _admin_area_signal(project, hf)
    admin_adj = float(admin_signal.get("adj") or 0.0)
    total = max(0.0, min(100.0, total + noise_adj + admin_adj))

    fits = {
        **aspect_fits,
        'aspect_weights': aspect_weights,
        'commute_details': commute_details,
        'noise_adj': noise_adj,
        'admin_area_adj': admin_adj,
        'admin_area_signal': admin_signal,
        # Backward-compatible fit fields
        'budget_fit': aspect_fits.get('price_savings', 50.0),
        'walkability_fit': aspect_fits.get('walkability_poi', 50.0),
        'location_fit': aspect_fits.get('commute_time', 0.0),
        'layout_fit': 50.0,  # layout is a hard filter only
        'area_fit': aspect_fits.get('unit_area', 50.0),
        'outdoor_fit': aspect_fits.get('outdoor_area', 50.0),
        'commute_fit': aspect_fits.get('commute_time', 0.0),
    }

    return total, fits


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------

def compute_confidence(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    fits: dict[str, Any],
) -> dict[str, Any]:
    """Compute a confidence score (0-100) based on data completeness.

    Higher confidence = more data points available for scoring.
    """
    checks: list[tuple[str, bool, int]] = [
        ("price present", unit.price_czk is not None, 15),
        ("area present", unit.floor_area_m2 is not None, 10),
        ("GPS present", project.gps_latitude is not None and project.gps_longitude is not None, 15),
        ("walkability present", project.walkability_score is not None, 10),
        ("layout present", unit.layout is not None, 5),
        ("floor present", unit.floor is not None, 5),
        ("exterior area present", unit.exterior_area_m2 is not None, 5),
        ("energy class present", getattr(project, "energy_class", None) is not None, 5),
        ("completion date present", getattr(project, "completion_date", None) is not None, 5),
        ("noise data present", getattr(project, "noise_label", None) is not None, 5),
        ("heating info present", getattr(unit, "heating", None) is not None or getattr(project, "heating", None) is not None, 5),
        ("district present", getattr(project, "district", None) is not None, 5),
        ("orientation present", unit.orientation is not None, 5),
        ("developer present", getattr(project, "developer", None) is not None, 5),
    ]

    total_weight = sum(w for _, _, w in checks)
    earned = sum(w for _, present, w in checks if present)
    missing_reasons = [label for label, present, _ in checks if not present]

    score = round(100.0 * earned / total_weight) if total_weight > 0 else 0

    if score >= 75:
        label = "high"
    elif score >= 45:
        label = "medium"
    else:
        label = "low"

    return {
        "score": score,
        "label": label,
        "reasons": missing_reasons,
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _flat_strengths_compromises(
    aspect_fits: dict[str, float],
    flat_weights: dict[str, float],
) -> tuple[list[str], list[str]]:
    """Derive top strengths and compromises from flat/V2 aspect fits.

    Only considers aspects with non-zero weight (active aspects).
    Uses V2 labels when available, falls back to legacy labels.
    """
    # Non-scoring keys to skip
    _SKIP_KEYS = {
        'commute_details', 'commute_hard_fail', 'budget_fit',
        'walkability_fit', 'location_fit', 'layout_fit',
        'area_fit', 'outdoor_fit', 'commute_fit', 'pref_adj', 'hard_filter',
        'aspect_weights', 'noise_adj', 'admin_area_adj', 'admin_area_signal',
    }
    # V2 uses aspect_weights inside fits dict; fall back to flat_weights
    v2_weights = aspect_fits.get('aspect_weights') or flat_weights
    all_labels = {**FLAT_WEIGHT_LABELS, **SCORING_V2_LABELS}

    scored_aspects: list[tuple[str, float, float]] = []
    for key, fit in aspect_fits.items():
        if key in _SKIP_KEYS:
            continue
        if not isinstance(fit, (int, float)):
            continue
        w = v2_weights.get(key, flat_weights.get(key, 0.0))
        if w <= 0:
            continue
        scored_aspects.append((key, float(fit), float(w)))

    scored_aspects.sort(key=lambda t: t[1], reverse=True)

    strengths = [all_labels.get(k, k) for k, f, _ in scored_aspects if f >= 80][:5]
    compromises = [all_labels.get(k, k) for k, f, _ in scored_aspects if f <= 30][:5]
    return strengths, compromises


def compute_full_score(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    weights: dict[str, float] | None = None,
    db: Session | None = None,
    scoring_config: dict | None = None,
    aggregates=None,
    flat_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Orchestrate eligibility → flat match → confidence.

    Uses the flat scoring model when flat_weights are provided.
    Falls back to legacy config-driven scoring otherwise.
    """
    # 1. Eligibility
    # Extract derived_total_floors from aggregates if available
    _dtf = getattr(aggregates, "derived_total_floors", None) if aggregates else None
    elig = compute_eligibility(
        unit, project, profile,
        project_derived_total_floors=_dtf,
    )
    if elig["status"] == "fail":
        fits = {
            "budget_fit": 0.0, "walkability_fit": 0.0, "location_fit": 0.0,
            "layout_fit": 0.0, "area_fit": 0.0, "outdoor_fit": 0.0,
            "commute_fit": 0.0, "pref_adj": 0.0,
            "hard_filter": elig["reasons"][0] if elig["reasons"] else "unknown",
        }
        conf = compute_confidence(unit, project, profile, fits)
        return {
            "score": 0.0,
            "eligibility": elig["status"],
            "eligibility_reasons": elig["reasons"],
            "confidence": conf["score"],
            "confidence_label": conf["label"],
            "confidence_reasons": conf["reasons"],
            "fits": fits,
            "top_strengths": [],
            "top_compromises": [],
            **fits,
        }

    # 2. Match — flat model or legacy
    if flat_weights is not None:
        score, fits = compute_flat_match(unit, project, profile, flat_weights, db)
        strengths, compromises = _flat_strengths_compromises(fits, flat_weights)
    else:
        w = weights or DEFAULT_WEIGHTS
        score, fits = compute_match(unit, project, profile, w, db, scoring_config=scoring_config, aggregates=aggregates)
        strengths, compromises = config_driven_strengths_compromises(fits, profile)

    # 2.5 Admin-area explainability — propagate soft location preference
    # into strengths / compromises.  Flat path already stores the signal in
    # `fits`; legacy path needs an on-demand computation.  Either way this
    # runs once per unit and never touches the numerical score.
    admin_signal = fits.get("admin_area_signal")
    if admin_signal is None:
        try:
            _sw = build_structured_wizard(profile)
            admin_signal = _admin_area_signal(project, _sw.hard_filters)
            fits["admin_area_signal"] = admin_signal
        except Exception:
            admin_signal = None
    if admin_signal:
        _strength_txt, _compromise_txt = _admin_area_explain_texts(admin_signal)
        if _strength_txt and _strength_txt not in strengths:
            strengths = [_strength_txt, *strengths][:5]
        if _compromise_txt and _compromise_txt not in compromises:
            compromises = [_compromise_txt, *compromises][:5]

    # 2.6 Commute explainability — replace generic "Dojezdové vzdálenosti" /
    # "Dojezd" aspect label with specific per-point texts when cached travel
    # times are available.  When no travel data exists the generic label from
    # the aspect scorer remains unchanged.
    _COMMUTE_GENERIC = {"Dojezdové vzdálenosti", "Dojezd"}
    _comm_s, _comm_c = _commute_explain_texts(fits)
    if _comm_s or _comm_c:
        # Drop the generic label so specifics don't duplicate it
        strengths = [s for s in strengths if s not in _COMMUTE_GENERIC]
        compromises = [c for c in compromises if c not in _COMMUTE_GENERIC]
        for _txt in _comm_s:
            if _txt not in strengths:
                strengths = [*strengths, _txt][:5]
        for _txt in _comm_c:
            if _txt not in compromises:
                compromises = [*compromises, _txt][:5]

    # 3. Confidence
    conf = compute_confidence(unit, project, profile, fits)

    return {
        "score": score,
        "eligibility": elig["status"],
        "eligibility_reasons": elig["reasons"],
        "confidence": conf["score"],
        "confidence_label": conf["label"],
        "confidence_reasons": conf["reasons"],
        "fits": fits,
        "top_strengths": strengths,
        "top_compromises": compromises,
        **fits,
    }


# ---------------------------------------------------------------------------
# Scoring Studio — config defaults and resolution
# ---------------------------------------------------------------------------

import copy
from typing import Optional

DEFAULT_GROUPS = {
    "finance": {"label": "Finance", "enabled": True, "weight": 1.2, "order": 1},
    "location": {"label": "Lokalita", "enabled": True, "weight": 1.2, "order": 2},
    "layout": {"label": "Dispozice a prostor", "enabled": True, "weight": 1.0, "order": 3},
    "unit_quality": {"label": "Kvalita bytu", "enabled": True, "weight": 1.0, "order": 4},
    "project_quality": {"label": "Kvalita projektu", "enabled": True, "weight": 0.9, "order": 5},
    "comfort": {"label": "Komfort", "enabled": True, "weight": 0.8, "order": 6},
    "commute": {"label": "Dojezd", "enabled": True, "weight": 0.7, "order": 7},
    "risk": {"label": "Rizika", "enabled": True, "weight": 0.6, "order": 8},
}

DEFAULT_FIELD_RULES = [
    {
        "field_key": "budget_fit",
        "label": "Rozpočet",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": True,
        "include_in_score": True,
        "group_key": "finance",
        "weight": 1.0,
        "rule_type": "numeric_target",
        "rule_config": {"tolerance_pct": 0.5, "decay": "linear"},
        "missing_value_policy": "neutral",
        "explanation_template": "Jak dobře cena odpovídá rozpočtu klienta.",
        "client_mode": "auto",
    },
    {
        "field_key": "location_fit",
        "label": "Lokalita",
        "entity_type": "location",
        "data_type": "number",
        "enabled": True,
        "include_in_score": True,
        "group_key": "location",
        "weight": 1.0,
        "rule_type": "numeric_thresholds",
        "rule_config": {"inside_polygon": 100, "outside_polygon": 60, "no_polygon": 70},
        "missing_value_policy": "neutral",
        "explanation_template": "Zda byt leží v preferované lokalitě klienta.",
        "client_mode": "auto",
    },
    {
        "field_key": "layout_fit",
        "label": "Dispozice",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": True,
        "include_in_score": True,
        "group_key": "layout",
        "weight": 1.0,
        "rule_type": "enum_map",
        "rule_config": {"match": 100, "no_match": 50},
        "missing_value_policy": "neutral",
        "explanation_template": "Shoda dispozice s požadavkem klienta.",
        "client_mode": "wizard",
    },
    {
        "field_key": "area_fit",
        "label": "Plocha",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": True,
        "include_in_score": True,
        "group_key": "layout",
        "weight": 0.8,
        "rule_type": "numeric_target",
        "rule_config": {"tolerance_pct": 0.5, "decay": "linear"},
        "missing_value_policy": "neutral",
        "explanation_template": "Jak dobře plocha odpovídá požadavku.",
        "client_mode": "wizard",
    },
    {
        "field_key": "walkability",
        "label": "Občanská vybavenost",
        "entity_type": "location",
        "data_type": "number",
        "enabled": True,
        "include_in_score": True,
        "group_key": "location",
        "weight": 0.9,
        "rule_type": "numeric_linear",
        "rule_config": {"higher_is_better": True, "fallback": 50},
        "missing_value_policy": "neutral",
        "explanation_template": "Kvalita občanské vybavenosti v okolí.",
        "client_mode": "auto",
    },
    {
        "field_key": "outdoor_space",
        "label": "Venkovní prostor",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": True,
        "include_in_score": True,
        "group_key": "comfort",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Dostupnost venkovního prostoru (terasa, balkón, zahrada).",
        "client_mode": "wizard",
    },
    {
        "field_key": "commute_fit",
        "label": "Dojezd",
        "entity_type": "location",
        "data_type": "number",
        "enabled": True,
        "include_in_score": True,
        "group_key": "commute",
        "weight": 1.0,
        "rule_type": "numeric_linear",
        "rule_config": {"higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Dojezdová vzdálenost na klíčová místa.",
        "client_mode": "wizard",
    },
    {
        "field_key": "floor_heating",
        "label": "Podlahové vytápění",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "boolean_bonus",
        "rule_config": {"true_score": 8, "false_score": 0},
        "missing_value_policy": "neutral",
        "explanation_template": "Podlahové vytápění zvyšuje komfort.",
        "client_mode": "wizard",
    },
    {
        "field_key": "energy_class",
        "label": "Energetická třída",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.4,
        "rule_type": "enum_map",
        "rule_config": {"A": 10, "B": 7, "C": 4, "D": 0, "E": -5},
        "missing_value_policy": "neutral",
        "explanation_template": "Energetická třída budovy.",
        "client_mode": "wizard",
    }
]

DEFAULT_ELIGIBILITY_RULES = [
    {
        "field": "noise_distance",
        "label": "Hluk",
        "enabled": True,
        "rule_type": "noise_proximity",
        "config": {
            "main_road_m": 150,
            "tram_m": 100,
            "railway_m": 300,
            "airport_m": 5000
        },
        "on_fail": "review"
    },
    {
        "field": "energy_class",
        "label": "Energetická třída",
        "enabled": True,
        "rule_type": "max_deviation",
        "config": {"max_classes_below": 1},
        "on_fail": "review"
    },
    {
        "field": "budget",
        "label": "Rozpočet",
        "enabled": True,
        "rule_type": "budget_range",
        "config": {"hard_max_over_pct": 1.0},
        "on_fail": "reject"
    },
    {
        "field": "layout",
        "label": "Dispozice",
        "enabled": True,
        "rule_type": "layout_match",
        "config": {},
        "on_fail": "reject",
        "ui_type": "simple_toggle",
        "ui_description": "Byt musí odpovídat požadované dispozici klienta."
    },
    {
        "field": "min_area",
        "label": "Minimální plocha",
        "enabled": True,
        "rule_type": "min_value",
        "config": {"tolerance_pct": 10},
        "on_fail": "review",
        "ui_type": "slider",
        "ui_description": "Byt nesmí být menší než požadovaná minimální plocha.",
        "ui_config": {"param": "tolerance_pct", "label": "Tolerance pod minimum (%)", "min": 0, "max": 30, "step": 1, "unit": "%"}
    },
    {
        "field": "max_area",
        "label": "Maximální plocha",
        "enabled": False,
        "rule_type": "max_value",
        "config": {"tolerance_pct": 20},
        "on_fail": "review",
        "ui_type": "slider",
        "ui_description": "Byt by neměl být výrazně větší než požadovaná maximální plocha.",
        "ui_config": {"param": "tolerance_pct", "label": "Tolerance nad maximum (%)", "min": 0, "max": 50, "step": 5, "unit": "%"}
    },
    {
        "field": "location_polygon",
        "label": "Lokalita (polygon)",
        "enabled": True,
        "rule_type": "inside_polygon",
        "config": {},
        "on_fail": "review",
        "ui_type": "simple_toggle",
        "ui_description": "Byt musí ležet v preferované lokalitě klienta."
    },
    {
        "field": "availability",
        "label": "Dostupnost bytu",
        "enabled": True,
        "rule_type": "must_be_available",
        "config": {},
        "on_fail": "reject",
        "ui_type": "simple_toggle",
        "ui_description": "Byt musí být aktuálně v prodeji (ne prodaný/rezervovaný)."
    },
    {
        "field": "terrace_required",
        "label": "Terasa požadována",
        "enabled": False,
        "rule_type": "must_have_outdoor",
        "config": {"outdoor_type": "terrace"},
        "on_fail": "review",
        "ui_type": "simple_toggle",
        "ui_description": "Pokud klient vyžaduje terasu, byt ji musí mít."
    },
    {
        "field": "balcony_required",
        "label": "Balkón požadován",
        "enabled": False,
        "rule_type": "must_have_outdoor",
        "config": {"outdoor_type": "balcony"},
        "on_fail": "review",
        "ui_type": "simple_toggle",
        "ui_description": "Pokud klient vyžaduje balkón, byt ho musí mít."
    },
    {
        "field": "parking_required",
        "label": "Parkování požadováno",
        "enabled": False,
        "rule_type": "must_have_parking",
        "config": {},
        "on_fail": "review",
        "ui_type": "simple_toggle",
        "ui_description": "Pokud klient vyžaduje parkování, projekt ho musí nabízet."
    },
    {
        "field": "floor_preference",
        "label": "Preferované patro",
        "enabled": False,
        "rule_type": "floor_range",
        "config": {"min_floor": 2, "max_floor": 99, "ground_floor_action": "review"},
        "on_fail": "review",
        "ui_type": "range",
        "ui_description": "Byt by měl být v preferovaném rozmezí pater.",
        "ui_config": {"params": [
            {"key": "min_floor", "label": "Min. patro", "min": 0, "max": 30, "step": 1},
            {"key": "max_floor", "label": "Max. patro", "min": 1, "max": 30, "step": 1}
        ]}
    },
    {
        "field": "completion_deadline",
        "label": "Termín dokončení",
        "enabled": False,
        "rule_type": "completion_before",
        "config": {"max_years_from_now": 3},
        "on_fail": "review",
        "ui_type": "slider",
        "ui_description": "Projekt musí být dokončen do X let od teď.",
        "ui_config": {"param": "max_years_from_now", "label": "Max. let do dokončení", "min": 1, "max": 10, "step": 1, "unit": "let"}
    },
    {
        "field": "max_noise",
        "label": "Maximální hluk (dB)",
        "enabled": False,
        "rule_type": "max_value",
        "config": {"max_day_db": 65, "max_night_db": 55},
        "on_fail": "review",
        "ui_type": "range",
        "ui_description": "Projekt by neměl překročit maximální hladinu hluku.",
        "ui_config": {"params": [
            {"key": "max_day_db", "label": "Max. denní hluk (dB)", "min": 40, "max": 80, "step": 1},
            {"key": "max_night_db", "label": "Max. noční hluk (dB)", "min": 30, "max": 70, "step": 1}
        ]}
    },
    {
        "field": "min_walkability",
        "label": "Minimální walkability",
        "enabled": False,
        "rule_type": "min_value",
        "config": {"min_score": 40},
        "on_fail": "review",
        "ui_type": "slider",
        "ui_description": "Projekt musí mít alespoň minimální walkability skóre.",
        "ui_config": {"param": "min_score", "label": "Min. walkability skóre", "min": 0, "max": 100, "step": 5, "unit": "bodů"}
    },
    {
        "field": "max_commute",
        "label": "Maximální dojezd MHD do centra",
        "enabled": False,
        "rule_type": "max_value",
        "config": {"max_minutes": 45},
        "on_fail": "review",
        "ui_type": "slider",
        "ui_description": "MHD do centra nesmí trvat déle než nastavený limit.",
        "ui_config": {"param": "max_minutes", "label": "Max. minut MHD do centra", "min": 10, "max": 90, "step": 5, "unit": "min"}
    },
    {
        "field": "recuperation_required",
        "label": "Rekuperace požadována",
        "enabled": False,
        "rule_type": "must_have_feature",
        "config": {"field": "recuperation", "expected": "ANO"},
        "on_fail": "review",
        "ui_type": "simple_toggle",
        "ui_description": "Projekt musí mít rekuperaci."
    },
]


def resolve_groups(db_config: Optional[dict]) -> dict:
    """Merge DB groups config over defaults."""
    result = copy.deepcopy(DEFAULT_GROUPS)
    if db_config:
        for key, overrides in db_config.items():
            if key in result:
                result[key].update(overrides)
            else:
                result[key] = overrides
    return result


def resolve_field_rules(db_config: Optional[list]) -> list:
    """Merge DB field rules over defaults. DB can only override existing defaults, not add removed rules."""
    defaults_by_key = {r["field_key"]: copy.deepcopy(r) for r in DEFAULT_FIELD_RULES}
    if db_config:
        for rule in db_config:
            key = rule.get("field_key")
            if key and key in defaults_by_key:
                defaults_by_key[key].update(rule)
    return list(defaults_by_key.values())


def resolve_eligibility_rules(db_config: Optional[list]) -> list:
    """Merge DB eligibility rules over defaults."""
    defaults_by_field = {r["field"]: copy.deepcopy(r) for r in DEFAULT_ELIGIBILITY_RULES}
    if db_config:
        for rule in db_config:
            field = rule.get("field")
            if field and field in defaults_by_field:
                defaults_by_field[field].update(rule)
            elif field:
                defaults_by_field[field] = rule
    return list(defaults_by_field.values())


# ---------------------------------------------------------------------------
# Additional field rules — auto-generated from models.py
# ---------------------------------------------------------------------------

"""
ADDITIONAL_FIELD_RULES pro Scoring Studio.

Vygenerováno z models.py (Project, Unit, ProjectAggregates).
Existujících 10 polí NENÍ opakováno:
  budget_fit, location_fit, layout_fit, area_fit, walkability,
  outdoor_space, commute_fit, floor_heating, orientation, energy_class

Přeskočená pole (identifikátory, FK, timestamps, raw_json, urls, metadata):
  id, project_id, external_id, updated_at, created_at, raw_json, url,
  floorplan_url, image_url, project_url, builtmind_project_id,
  builtmind_developer_id, gps_latitude, gps_longitude,
  noise_source, noise_method, noise_updated_at,
  micro_location_source, micro_location_method, micro_location_updated_at,
  walkability_source, walkability_method, walkability_updated_at,
  walkability_walking_fallback_used,
  name, unit_name, available, availability_status (filtrovací, ne scoring)
"""

ADDITIONAL_FIELD_RULES = [

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – TRANSPORT / DOJEZDOVOST
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "ride_to_center_min",
        "label": "Dojezd do centra autem (min)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.6,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 5, "max": 40, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Dojezd autem do centra: {value} min",
        "client_mode": "auto",
    },
    {
        "field_key": "public_transport_to_center_min",
        "label": "MHD do centra (min)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 10, "max": 60, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "MHD do centra: {value} min",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – KVALITA & STANDARD
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "renovation_project",
        "label": "Rekonstrukce (projekt)",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt je rekonstrukce: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "windows_project",
        "label": "Okna (projekt)",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "triple_glazing": 1.0,
                "double_glazing": 0.6,
                "single_glazing": 0.2,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Okna projektu: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "heating_project",
        "label": "Vytápění (projekt)",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "heat_pump": 1.0,
                "central": 0.7,
                "gas": 0.5,
                "electric": 0.4,
                "other": 0.3,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Vytápění projektu: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "partition_walls_project",
        "label": "Příčky (projekt)",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.4,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "brick": 1.0,
                "concrete": 0.9,
                "ytong": 0.7,
                "plasterboard": 0.4,
                "other": 0.3,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Příčky projektu: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "ceiling_height",
        "label": "Výška stropů",
        "entity_type": "project",
        "data_type": "string",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "2.9+": 1.0,
                "2.7-2.9": 0.7,
                "2.5-2.7": 0.4,
                "<2.5": 0.1,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Výška stropů: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "recuperation",
        "label": "Rekuperace",
        "entity_type": "project",
        "data_type": "string",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.6,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "central": 1.0,
                "decentral": 0.8,
                "preparation": 0.4,
                "none": 0.0,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Rekuperace: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "cooling_project",
        "label": "Chlazení (projekt)",
        "entity_type": "project",
        "data_type": "string",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "central": 1.0,
                "split": 0.7,
                "preparation": 0.3,
                "none": 0.0,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Chlazení projektu: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "floors_above_ground",
        "label": "Počet nadzemních podlaží",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Počet nadzemních podlaží: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "completion_date",
        "label": "Datum dokončení",
        "entity_type": "project",
        "data_type": "string",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Plánované dokončení: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "construction_completion",
        "label": "Stav výstavby",
        "entity_type": "project",
        "data_type": "string",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Stav výstavby: {value}",
        "client_mode": "hidden",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – AMENITIES (boolean bonusy)
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "concierge",
        "label": "Concierge",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má concierge službu",
        "client_mode": "wizard",
    },
    {
        "field_key": "reception",
        "label": "Recepce",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má recepci",
        "client_mode": "wizard",
    },
    {
        "field_key": "bike_room",
        "label": "Kolárna",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má kolárnu",
        "client_mode": "wizard",
    },
    {
        "field_key": "stroller_room",
        "label": "Kočárkárna",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má kočárkárnu",
        "client_mode": "wizard",
    },
    {
        "field_key": "fitness_project",
        "label": "Fitness v projektu",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má vlastní fitness",
        "client_mode": "wizard",
    },
    {
        "field_key": "courtyard_garden",
        "label": "Vnitroblok / zahrada",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má vnitroblok nebo zahradu",
        "client_mode": "wizard",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – HLUK
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "noise_day_db",
        "label": "Hluk ve dne (dB)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 40, "max": 75, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Denní hluk: {value} dB",
        "client_mode": "auto",
    },
    {
        "field_key": "noise_night_db",
        "label": "Hluk v noci (dB)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 30, "max": 65, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Noční hluk: {value} dB",
        "client_mode": "auto",
    },
    {
        "field_key": "noise_label",
        "label": "Hluková kategorie",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.6,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "very_quiet": 1.0,
                "quiet": 0.8,
                "moderate": 0.5,
                "noisy": 0.2,
                "very_noisy": 0.0,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Hluková kategorie: {value}",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – MIKRO-LOKALITA (vzdálenosti k hluku)
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "distance_to_primary_road_m",
        "label": "Vzdálenost od hlavní silnice (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 20, "max": 500, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Vzdálenost od hlavní silnice: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_tram_tracks_m",
        "label": "Vzdálenost od tramvajových kolejí (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 10, "max": 300, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Vzdálenost od tramvajových kolejí: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_railway_m",
        "label": "Vzdálenost od železnice (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Vzdálenost od železnice: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_airport_m",
        "label": "Vzdálenost od letiště (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 1000, "max": 15000, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Vzdálenost od letiště: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "micro_location_score",
        "label": "Skóre mikro-lokality",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Skóre mikro-lokality: {value}/100",
        "client_mode": "auto",
    },
    {
        "field_key": "micro_location_label",
        "label": "Kategorie mikro-lokality",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.6,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "excellent": 1.0,
                "good": 0.75,
                "average": 0.5,
                "below_average": 0.25,
                "poor": 0.0,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Mikro-lokalita: {value}",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – WALKABILITY – VZDÁLENOSTI K POI (menší = lepší)
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "distance_to_supermarket_m",
        "label": "Vzdálenost k supermarketu (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Supermarket: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_drugstore_m",
        "label": "Vzdálenost k drogerii (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Drogerie: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_pharmacy_m",
        "label": "Vzdálenost k lékárně (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1500, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Lékárna: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_atm_m",
        "label": "Vzdálenost k bankomatu (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Bankomat: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_post_office_m",
        "label": "Vzdálenost k poště (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 100, "max": 2000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Pošta: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_tram_stop_m",
        "label": "Vzdálenost k tramvaji (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.6,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 800, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Tramvajová zastávka: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_bus_stop_m",
        "label": "Vzdálenost k autobusu (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 800, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Autobusová zastávka: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_metro_station_m",
        "label": "Vzdálenost k metru (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 100, "max": 2000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Stanice metra: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_train_station_m",
        "label": "Vzdálenost k vlaku (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 200, "max": 3000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Vlaková stanice: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_restaurant_m",
        "label": "Vzdálenost k restauraci (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 800, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Restaurace: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_cafe_m",
        "label": "Vzdálenost ke kavárně (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 800, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Kavárna: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_park_m",
        "label": "Vzdálenost k parku (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Park: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_fitness_m",
        "label": "Vzdálenost k fitness (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Fitness: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_playground_m",
        "label": "Vzdálenost k hřišti (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 800, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Hřiště: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_kindergarten_m",
        "label": "Vzdálenost ke školce (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 100, "max": 1500, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Školka: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_primary_school_m",
        "label": "Vzdálenost k základní škole (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 100, "max": 2000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Základní škola: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "distance_to_pediatrician_m",
        "label": "Vzdálenost k pediatrovi (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 100, "max": 2000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Pediatr: {value} m",
        "client_mode": "auto",
    },

    # Walking distances (pěší vzdálenosti k MHD)
    {
        "field_key": "walking_distance_to_tram_stop_m",
        "label": "Pěší vzdálenost k tramvaji (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.6,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Pěšky k tramvaji: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "walking_distance_to_bus_stop_m",
        "label": "Pěší vzdálenost k autobusu (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 50, "max": 1000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Pěšky k autobusu: {value} m",
        "client_mode": "auto",
    },
    {
        "field_key": "walking_distance_to_metro_station_m",
        "label": "Pěší vzdálenost k metru (m)",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 100, "max": 2500, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Pěšky k metru: {value} m",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – WALKABILITY – POČTY POI DO 500 m (větší = lepší)
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "count_supermarket_500m",
        "label": "Supermarkety do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 5, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Supermarkety do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_drugstore_500m",
        "label": "Drogerie do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 3, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Drogerie do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_pharmacy_500m",
        "label": "Lékárny do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 3, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Lékárny do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_atm_500m",
        "label": "Bankomaty do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 5, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Bankomaty do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_post_office_500m",
        "label": "Pošty do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 2, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Pošty do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_restaurant_500m",
        "label": "Restaurace do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 15, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Restaurace do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_cafe_500m",
        "label": "Kavárny do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 10, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Kavárny do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_park_500m",
        "label": "Parky do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 5, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Parky do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_fitness_500m",
        "label": "Fitness do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 5, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Fitness do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_playground_500m",
        "label": "Hřiště do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 5, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Hřiště do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_kindergarten_500m",
        "label": "Školky do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 3, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Školky do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_primary_school_500m",
        "label": "Základní školy do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 3, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Základní školy do 500 m: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "count_pediatrician_500m",
        "label": "Pediatři do 500 m",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.3,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 3, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Pediatři do 500 m: {value}",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT – WALKABILITY SUB-SKÓRE (vyšší = lepší)
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "walkability_daily_needs_score",
        "label": "Walkability – denní potřeby",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.6,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Walkability denní potřeby: {value}/100",
        "client_mode": "auto",
    },
    {
        "field_key": "walkability_transport_score",
        "label": "Walkability – doprava",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "commute",
        "weight": 0.6,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Walkability doprava: {value}/100",
        "client_mode": "auto",
    },
    {
        "field_key": "walkability_leisure_score",
        "label": "Walkability – volný čas",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Walkability volný čas: {value}/100",
        "client_mode": "auto",
    },
    {
        "field_key": "walkability_family_score",
        "label": "Walkability – rodina",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Walkability rodina: {value}/100",
        "client_mode": "auto",
    },
    {
        "field_key": "walkability_score",
        "label": "Walkability – celkové skóre",
        "entity_type": "project",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.7,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Walkability celkové: {value}/100",
        "client_mode": "auto",
    },
    {
        "field_key": "walkability_label",
        "label": "Walkability – kategorie",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "location",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "excellent": 1.0,
                "good": 0.75,
                "average": 0.5,
                "below_average": 0.25,
                "poor": 0.0,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Walkability: {value}",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # JEDNOTKA (UNIT) – PLOCHY
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "total_area_m2",
        "label": "Celková plocha (m²)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "layout",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 20, "max": 200, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Celková plocha: {value} m²",
        "client_mode": "hidden",
    },
    {
        "field_key": "exterior_area_m2",
        "label": "Venkovní plocha celkem (m²)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "layout",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 100, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Venkovní plocha: {value} m²",
        "client_mode": "wizard",
    },
    {
        "field_key": "balcony_area_m2",
        "label": "Plocha balkónu (m²)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "layout",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 30, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Balkón: {value} m²",
        "client_mode": "wizard",
    },
    {
        "field_key": "terrace_area_m2",
        "label": "Plocha terasy (m²)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "layout",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 60, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Terasa: {value} m²",
        "client_mode": "wizard",
    },
    {
        "field_key": "garden_area_m2",
        "label": "Plocha zahrady (m²)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "layout",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 200, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Zahrada: {value} m²",
        "client_mode": "wizard",
    },

    # ═══════════════════════════════════════════════════════════════════
    # JEDNOTKA – PATRO & DISPOZICE
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "floor",
        "label": "Patro",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0, "max": 15, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Patro: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "category",
        "label": "Kategorie jednotky",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Kategorie: {value}",
        "client_mode": "hidden",
    },

    # ═══════════════════════════════════════════════════════════════════
    # JEDNOTKA – KVALITA & VYBAVENÍ
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "windows_unit",
        "label": "Okna (jednotka)",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "triple_glazing": 1.0,
                "double_glazing": 0.6,
                "single_glazing": 0.2,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Okna jednotky: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "heating_unit",
        "label": "Vytápění (jednotka)",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.5,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "heat_pump": 1.0,
                "central": 0.7,
                "gas": 0.5,
                "electric": 0.4,
                "other": 0.3,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Vytápění jednotky: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "partition_walls_unit",
        "label": "Příčky (jednotka)",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.4,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "brick": 1.0,
                "concrete": 0.9,
                "ytong": 0.7,
                "plasterboard": 0.4,
                "other": 0.3,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Příčky jednotky: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "renovation_unit",
        "label": "Rekonstrukce (jednotka)",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Jednotka je rekonstrukce: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "air_conditioning",
        "label": "Klimatizace",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Jednotka má klimatizaci",
        "client_mode": "wizard",
    },
    {
        "field_key": "cooling_ceilings",
        "label": "Chladicí stropy",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.5,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Jednotka má chladicí stropy",
        "client_mode": "wizard",
    },
    {
        "field_key": "exterior_blinds",
        "label": "Venkovní žaluzie",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "true": 1.0,
                "preparation": 0.5,
                "false": 0.0,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Venkovní žaluzie: {value}",
        "client_mode": "wizard",
    },
    {
        "field_key": "smart_home",
        "label": "Smart home",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "comfort",
        "weight": 0.4,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Jednotka má smart home",
        "client_mode": "wizard",
    },

    # ═══════════════════════════════════════════════════════════════════
    # JEDNOTKA – FINANCE & CENY
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "price_czk",
        "label": "Cena (Kč)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Cena: {value} Kč",
        "client_mode": "auto",
    },
    {
        "field_key": "price_per_m2_czk",
        "label": "Cena za m² (Kč)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 60000, "max": 200000, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Cena za m²: {value} Kč",
        "client_mode": "auto",
    },
    {
        "field_key": "parking_indoor_price_czk",
        "label": "Cena vnitřního parkování (Kč)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Vnitřní parkování: {value} Kč",
        "client_mode": "wizard",
    },
    {
        "field_key": "parking_outdoor_price_czk",
        "label": "Cena venkovního parkování (Kč)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Venkovní parkování: {value} Kč",
        "client_mode": "wizard",
    },
    {
        "field_key": "local_price_diff_500m",
        "label": "Cenová odchylka 500 m (%)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.6,
        "rule_type": "numeric_linear",
        "rule_config": {"min": -30, "max": 30, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Cenová odchylka vs. okolí 500 m: {value} %",
        "client_mode": "auto",
    },
    {
        "field_key": "local_price_diff_1000m",
        "label": "Cenová odchylka 1 km (%)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": -30, "max": 30, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Cenová odchylka vs. okolí 1 km: {value} %",
        "client_mode": "auto",
    },
    {
        "field_key": "local_price_diff_2000m",
        "label": "Cenová odchylka 2 km (%)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": -30, "max": 30, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Cenová odchylka vs. okolí 2 km: {value} %",
        "client_mode": "auto",
    },

    # Platební podmínky
    {
        "field_key": "payment_contract",
        "label": "Platba při podpisu smlouvy",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0.0, "max": 0.5, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Platba při smlouvě: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "payment_construction",
        "label": "Platba při výstavbě",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Platba při výstavbě: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "payment_occupancy",
        "label": "Platba při kolaudaci",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.4,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 0.0, "max": 1.0, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Platba při kolaudaci: {value:.0%}",
        "client_mode": "hidden",
    },

    # ═══════════════════════════════════════════════════════════════════
    # JEDNOTKA – RIZIKO & ČAS NA TRHU
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "days_on_market",
        "label": "Dny na trhu",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.5,
        "rule_type": "numeric_thresholds",
        "rule_config": {
            "thresholds": [
                {"max": 30, "score": 1.0, "label": "Čerstvá nabídka"},
                {"max": 90, "score": 0.7, "label": "Běžná doba"},
                {"max": 180, "score": 0.4, "label": "Delší doba na trhu"},
                {"max": 365, "score": 0.2, "label": "Dlouho na trhu"},
                {"max": 99999, "score": 0.0, "label": "Velmi dlouho na trhu"},
            ]
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Na trhu: {value} dní",
        "client_mode": "auto",
    },

    # ═══════════════════════════════════════════════════════════════════
    # PROJEKT AGGREGÁTY
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "total_units",
        "label": "Celkem jednotek v projektu",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Celkem jednotek: {value}",
        "client_mode": "hidden",
    },
]

# ═══════════════════════════════════════════════════════════════════
# SOUHRN
# ═══════════════════════════════════════════════════════════════════
print(f"Celkem přidaných polí: {len(ADDITIONAL_FIELD_RULES)}")

DEFAULT_FIELD_RULES.extend(ADDITIONAL_FIELD_RULES)


# ---------------------------------------------------------------------------
# Config-driven scoring integration (auto-applied)
# ---------------------------------------------------------------------------

from .config_driven_scoring import (
    config_driven_compute_match,
    config_driven_strengths_compromises,
    config_driven_compute_confidence,
    get_field_value,
    compute_field_score,
)


def compute_match(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    weights: dict[str, float],
    db: Session | None = None,
    scoring_config: dict | None = None,
    aggregates=None,
) -> tuple[float, dict[str, Any]]:
    """Config-driven match scoring.

    Delegates to config_driven_compute_match which reads field_rules and groups.
    Falls back to legacy defaults if no config provided.

    The scoring_config dict should have:
        - 'groups': dict overrides for DEFAULT_GROUPS
        - 'field_rules': list overrides for DEFAULT_FIELD_RULES

    For backward compatibility, if called without scoring_config,
    it uses the default field rules and groups.
    """
    return config_driven_compute_match(
        unit=unit,
        project=project,
        profile=profile,
        weights=weights,
        db=db,
        scoring_config=scoring_config,
        aggregates=aggregates,
    )

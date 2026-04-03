"""Scoring v2 — extracted scoring logic for unit–client matching.

Public API:
    compute_full_score(unit, project, profile, weights=None, db=None) → dict
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import Unit, Project, ClientProfile
from .walkability import compute_personalized_walkability_score, project_to_raw_metrics
from .routing_provider import get_cached_travel_time_minutes
from .aggregates import _layout_group

# These are imported from main.py — they live there because many other
# parts of main.py also use them.  We import lazily to avoid circular imports.
_geo_helpers_loaded = False
_parse_polygon_geojson = None
_point_in_polygon = None
_wizard_preferences_adjustment = None


def _ensure_geo_helpers():
    global _geo_helpers_loaded, _parse_polygon_geojson, _point_in_polygon, _wizard_preferences_adjustment
    if not _geo_helpers_loaded:
        from . import main as _main
        _parse_polygon_geojson = _main._parse_polygon_geojson
        _point_in_polygon = _main._point_in_polygon
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

DEFAULT_THRESHOLDS = {
    'strong_pick_min_score': 70,
    'review_pick_min_score': 55,
    'hide_below_score': 0,
    'default_visible_limit': 50,
    'max_strong_picks': 0,   # 0 = unlimited
    'max_review_picks': 0,   # 0 = unlimited
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
# Eligibility (hard filters)
# ---------------------------------------------------------------------------

def compute_eligibility(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
) -> dict[str, Any]:
    """Evaluate hard-filter eligibility.

    Returns {'status': 'pass'|'review'|'fail', 'reasons': [...]}.
    When a must-have field is NULL on the unit/project → status='review' instead of fail.
    """
    if not profile or not profile.filter_json:
        return {"status": "pass", "reasons": []}

    wizard = (profile.filter_json or {}).get("wizard") or {}
    reasons: list[str] = []
    has_review = False

    def _fail(reason: str):
        reasons.append(reason)

    def _check_null_or_fail(value, reason: str) -> bool:
        """If value is None → mark review; otherwise return True if should fail."""
        nonlocal has_review
        if value is None:
            reasons.append(f"{reason} (data missing)")
            has_review = True
            return False  # don't fail, review
        return True

    # -- Standards --
    standards = wizard.get("standards") or {}
    if standards.get("rekuperace") == "must":
        val = getattr(project, "recuperation", None)
        if val is None:
            reasons.append("rekuperace (data missing)")
            has_review = True
        elif val != "true":
            _fail("rekuperace")

    if standards.get("air_conditioning") == "must":
        val = getattr(unit, "air_conditioning", None)
        if val is None:
            reasons.append("air_conditioning (data missing)")
            has_review = True
        elif not val:
            _fail("air_conditioning")

    if standards.get("floor_heating") == "must":
        h = getattr(unit, "heating", None) or getattr(project, "heating", None)
        if h is None:
            reasons.append("floor_heating (data missing)")
            has_review = True
        elif "podlah" not in str(h).lower():
            _fail("floor_heating")

    if standards.get("external_blinds") == "must":
        eb = getattr(unit, "exterior_blinds", None)
        if eb is None:
            reasons.append("external_blinds (data missing)")
            has_review = True
        elif str(eb).lower() in ("false", "0", ""):
            _fail("external_blinds")

    # -- Amenities --
    amenities = wizard.get("house_amenities") or {}
    amenity_map = {
        "parking": None,
        "bike_room": "bike_room",
        "stroller_room": "stroller_room",
        "fitness": "fitness",
        "courtyard_garden": "courtyard_garden",
        "reception": "reception",
        "concierge": "concierge",
    }
    for pref_key, project_attr in amenity_map.items():
        if amenities.get(pref_key) == "must" and project_attr:
            val = getattr(project, project_attr, None)
            if val is None:
                reasons.append(f"{pref_key} (data missing)")
                has_review = True
            elif not val:
                _fail(pref_key)

    # -- Noise --
    noise = wizard.get("noise") or {}
    if noise.get("quiet_area") == "must":
        nl = getattr(project, "noise_label", None)
        if nl and ("vyšší" in nl.lower() or "vysoký" in nl.lower() or "vysoká" in nl.lower()):
            _fail("quiet_area")

    noise_checks = [
        ("main_road", "distance_to_primary_road_m", 150),
        ("tram", "distance_to_tram_tracks_m", 100),
        ("railway", "distance_to_railway_m", 300),
        ("airport", "distance_to_airport_m", 5000),
    ]
    for key, attr, threshold in noise_checks:
        if noise.get(key) == "must":
            d = getattr(project, attr, None)
            if d is not None and d < threshold:
                _fail(f"{key}_noise" if key != "main_road" else key)

    # -- Outdoor --
    outdoor = wizard.get("outdoor") or {}
    if outdoor.get("outdoor_space") == "must":
        ext = unit.exterior_area_m2
        if ext is None or float(ext) <= 0:
            _fail("outdoor_space")
        else:
            min_out = outdoor.get("min_outdoor_area_m2")
            if min_out is not None and float(ext) < float(min_out):
                _fail("outdoor_space_too_small")

    for outdoor_key in ("balcony", "terrace", "garden"):
        if outdoor.get(outdoor_key) == "must":
            val = getattr(unit, f"{outdoor_key}_area_m2", None)
            if val is None or float(val) <= 0:
                _fail(outdoor_key)

    # -- Energy class --
    energy_pref = wizard.get("energy_class")
    if energy_pref and energy_pref != "ignore":
        unit_ec = getattr(project, "energy_class", None)
        if unit_ec:
            ec_order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6}
            req_rank = ec_order.get(energy_pref.upper(), 99)
            unit_rank = ec_order.get(str(unit_ec).strip().upper()[:1], 99)
            if unit_rank > req_rank + 1:
                _fail("energy_class")
        else:
            reasons.append("energy_class (data missing)")
            has_review = True

    # -- Completion date --
    completion_pref = wizard.get("completion_date")
    if completion_pref:
        from datetime import date as _date
        try:
            max_date = _date.fromisoformat(str(completion_pref))
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
    budget_prefs = wizard.get("budget") or {}
    max_dom = budget_prefs.get("max_days_on_market")
    if max_dom is not None:
        proj_dom = getattr(project, "max_days_on_market", None)
        if proj_dom is not None and int(proj_dom) > int(max_dom):
            _fail("days_on_market")

    # -- Payment contract --
    max_pct = budget_prefs.get("max_payment_contract_pct")
    if max_pct is not None:
        proj_pc = getattr(project, "payment_contract", None)
        if proj_pc is not None:
            pct_val = float(proj_pc) * 100 if float(proj_pc) <= 1 else float(proj_pc)
            if pct_val > float(max_pct):
                _fail("payment_contract")

    # -- Renovation preference --
    reno_pref = wizard.get("renovation_preference")
    if reno_pref == "only_new" and unit.renovation is True:
        _fail("only_new")
    if reno_pref == "only_renovation" and unit.renovation is False:
        _fail("only_renovation")

    # Determine status
    fail_reasons = [r for r in reasons if "(data missing)" not in r]
    if fail_reasons:
        return {"status": "fail", "reasons": reasons}
    if has_review:
        return {"status": "review", "reasons": reasons}
    return {"status": "pass", "reasons": []}


# ---------------------------------------------------------------------------
# Soft scoring (match)
# ---------------------------------------------------------------------------

def _legacy_compute_match(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    weights: dict[str, float],
    db: Session | None = None,
) -> tuple[float, dict[str, Any]]:
    """Compute the weighted match score.

    Returns (score, fits_dict) where fits_dict contains all component fits.
    """
    _ensure_geo_helpers()

    price = unit.price_czk
    area = float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None

    # -- Budget fit --
    budget_fit = 0.0
    if profile and price is not None:
        if profile.budget_min is None and profile.budget_max is None:
            budget_fit = 100.0
        else:
            lo = profile.budget_min or 0
            hi = profile.budget_max or price
            if lo <= price <= hi:
                budget_fit = 100.0
            else:
                center = (lo + hi) / 2 if hi > lo else hi or lo or 1
                diff_ratio = abs(price - center) / max(center, 1)
                budget_fit = max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))

    # -- Walkability fit --
    walk_fit = 0.0
    try:
        prefs = (profile.walkability_preferences_json if profile else None) or {}
        if prefs and any(v != "normal" for v in prefs.values()):
            raw = project_to_raw_metrics(project)
            result = compute_personalized_walkability_score(raw, prefs)
            if result.get("score") is not None:
                walk_fit = float(result["score"])
        elif project.walkability_score is not None:
            walk_fit = float(project.walkability_score)
        else:
            walk_fit = 50.0
    except Exception:
        walk_fit = 50.0

    # -- Location fit --
    loc_fit = 0.0
    if project.gps_latitude is not None and project.gps_longitude is not None and profile:
        poly = _parse_polygon_geojson(profile.polygon_geojson)
        if poly:
            inside = _point_in_polygon(
                float(project.gps_latitude),
                float(project.gps_longitude),
                poly,
            )
            loc_fit = 100.0 if inside else 60.0
        else:
            loc_fit = 70.0

    # -- Layout fit --
    layout_fit = 0.0
    if profile and profile.layouts and "values" in profile.layouts and unit.layout:
        pref_values = [str(v).strip().lower() for v in (profile.layouts.get("values") or [])]
        unit_bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
        layout_fit = 100.0 if unit_bucket in pref_values else 50.0

    # -- Area fit --
    area_fit = 50.0
    if profile and area is not None:
        has_lo = profile.area_min is not None
        has_hi = profile.area_max is not None
        if has_lo or has_hi:
            lo = profile.area_min or 0.0
            hi = profile.area_max or area
            if lo <= area <= hi:
                area_fit = 100.0
            else:
                center = (lo + hi) / 2 if hi > lo else hi or lo or 1.0
                diff_ratio = abs(area - center) / max(center, 1.0)
                area_fit = max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))
        else:
            wizard_budget = (
                ((profile.filter_json or {}).get("wizard") or {}).get("budget") or {}
                if profile.filter_json
                else {}
            )
            ideal_area = wizard_budget.get("ideal_area")
            if ideal_area is not None:
                try:
                    ideal_area = float(ideal_area)
                    center = ideal_area
                    diff_ratio = abs(area - center) / max(center, 1.0)
                    area_fit = max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))
                except (TypeError, ValueError):
                    pass

    # -- Outdoor fit --
    outdoor_fit = 50.0
    if profile and profile.filter_json:
        wizard_outdoor = (
            ((profile.filter_json or {}).get("wizard") or {}).get("outdoor") or {}
        )
        min_outdoor = wizard_outdoor.get("min_outdoor_area_m2")
        if min_outdoor is not None:
            try:
                min_outdoor = float(min_outdoor)
                if unit.exterior_area_m2 is not None:
                    unit_outdoor = float(unit.exterior_area_m2)
                else:
                    unit_outdoor = (
                        (unit.balcony_area_m2 or 0.0)
                        + (unit.terrace_area_m2 or 0.0)
                        + (unit.garden_area_m2 or 0.0)
                    )
                if min_outdoor <= 0:
                    outdoor_fit = 100.0
                elif unit_outdoor >= min_outdoor:
                    outdoor_fit = 100.0
                else:
                    outdoor_fit = max(0.0, 100.0 * unit_outdoor / min_outdoor)
            except (TypeError, ValueError):
                pass

    # -- Commute fit --
    commute_fit = 0.0
    commute_details: list[dict[str, Any]] = []
    commute_hard_fail = False
    if (
        profile
        and profile.commute_points_json
        and project.gps_latitude is not None
        and project.gps_longitude is not None
        and db is not None
    ):
        points = profile.commute_points_json or []
        if isinstance(points, dict):
            points = points.get("points") or []
        per_point_scores: list[float] = []
        for cp in points:
            try:
                label = str(cp.get("label") or "")
                dest_lat = float(cp.get("lat"))
                dest_lng = float(cp.get("lng"))
                mode = str(cp.get("mode") or "drive")
                max_minutes = float(cp.get("max_minutes"))
            except Exception:
                continue
            priority = str(cp.get("priority") or "ignore")
            tol = cp.get("tolerance_minutes")
            tolerance_minutes = float(tol) if tol is not None else 0.0
            travel_min = get_cached_travel_time_minutes(db, project, cp)
            if travel_min is None:
                continue
            limit = max_minutes + tolerance_minutes
            if priority == "must_have" and travel_min > limit:
                commute_details.append({
                    "label": label, "mode": mode, "minutes": travel_min,
                    "max_minutes": max_minutes, "priority": priority, "passed": False,
                })
                commute_hard_fail = True
                break
            if priority in ("must_have", "prefer"):
                if travel_min <= max_minutes:
                    score = 100.0
                elif travel_min > limit and limit > 0:
                    score = 0.0
                elif limit > max_minutes:
                    ratio = (travel_min - max_minutes) / max(1.0, limit - max_minutes)
                    score = max(0.0, 100.0 * (1.0 - ratio))
                else:
                    score = 0.0
                per_point_scores.append(score)
                commute_details.append({
                    "label": label, "mode": mode, "minutes": travel_min,
                    "max_minutes": max_minutes, "priority": priority,
                    "passed": travel_min <= limit,
                })
        if not commute_hard_fail and per_point_scores:
            commute_fit = min(per_point_scores)

    fits = {
        "budget_fit": budget_fit,
        "walkability_fit": walk_fit,
        "location_fit": loc_fit,
        "layout_fit": layout_fit,
        "area_fit": area_fit,
        "outdoor_fit": outdoor_fit,
        "commute_fit": commute_fit,
        "commute_details": commute_details,
    }

    if commute_hard_fail:
        return 0.0, fits

    # Aggregate with weights
    total = (
        weights.get('budget', 0.30) * budget_fit
        + weights.get('walkability', 0.20) * walk_fit
        + weights.get('location', 0.20) * loc_fit
        + weights.get('layout', 0.10) * layout_fit
        + weights.get('area', 0.10) * area_fit
        + weights.get('outdoor', 0.05) * outdoor_fit
        + weights.get('commute', 0.05) * commute_fit
    )

    # Wizard preferences adjustment
    pref_adj = _wizard_preferences_adjustment(unit, project, profile)
    pref_adj = max(-20.0, min(15.0, pref_adj))
    total = max(0.0, min(100.0, total + pref_adj))

    fits["pref_adj"] = pref_adj
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
# Strengths / compromises
# ---------------------------------------------------------------------------

def _top_strengths_and_compromises(
    fits: dict[str, Any],
    profile: ClientProfile | None,
) -> tuple[list[str], list[str]]:
    """Derive top strengths and top compromises from fit scores."""
    labels = {
        "budget_fit": "Rozpočet",
        "walkability_fit": "Walkability",
        "location_fit": "Poloha",
        "layout_fit": "Dispozice",
        "area_fit": "Plocha",
        "outdoor_fit": "Venkovní prostor",
        "commute_fit": "Dojezd",
    }
    strengths: list[str] = []
    compromises: list[str] = []
    for key, label in labels.items():
        val = fits.get(key)
        if val is None:
            continue
        if val >= 85:
            strengths.append(label)
        elif val <= 30:
            compromises.append(label)
    return strengths[:5], compromises[:5]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def compute_full_score(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    weights: dict[str, float] | None = None,
    db: Session | None = None,
    scoring_config: dict | None = None,
    aggregates=None,
) -> dict[str, Any]:
    """Orchestrate eligibility → match → confidence.

    Returns a dict with: score, eligibility, eligibility_reasons,
    confidence, confidence_label, confidence_reasons, fits,
    top_strengths, top_compromises, and all individual fit values.
    """
    w = weights or DEFAULT_WEIGHTS

    # 1. Eligibility
    elig = compute_eligibility(unit, project, profile)
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

    # 2. Match
    score, fits = compute_match(unit, project, profile, w, db, scoring_config=scoring_config, aggregates=aggregates)

    # 3. Confidence
    conf = compute_confidence(unit, project, profile, fits)

    # 4. Strengths / compromises
    strengths, compromises = config_driven_strengths_compromises(fits, profile)

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
        "field_key": "orientation",
        "label": "Orientace",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.8,
        "rule_type": "enum_map",
        "rule_config": {"south": 10, "west": 6, "east": 2, "north": -6},
        "missing_value_policy": "neutral",
        "explanation_template": "Orientace bytu ovlivňuje světelnost.",
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
    """Merge DB field rules over defaults. DB can override by field_key or add new."""
    defaults_by_key = {r["field_key"]: copy.deepcopy(r) for r in DEFAULT_FIELD_RULES}
    if db_config:
        for rule in db_config:
            key = rule.get("field_key")
            if key and key in defaults_by_key:
                defaults_by_key[key].update(rule)
            elif key:
                defaults_by_key[key] = rule
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
        "field_key": "permit_regular_project",
        "label": "Řádné stavební povolení (projekt)",
        "entity_type": "project",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.8,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Projekt má řádné stavební povolení",
        "client_mode": "auto",
    },
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
        "field_key": "overall_quality_project",
        "label": "Celková kvalita projektu",
        "entity_type": "project",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.8,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "luxury": 1.0,
                "premium": 0.85,
                "standard_plus": 0.65,
                "standard": 0.5,
                "economy": 0.25,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Kvalita projektu: {value}",
        "client_mode": "wizard",
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
    {
        "field_key": "developer",
        "label": "Developer",
        "entity_type": "project",
        "data_type": "string",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Developer: {value}",
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
        "field_key": "equivalent_area_m2",
        "label": "Ekvivalentní plocha (m²)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "layout",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": 20, "max": 200, "higher_is_better": True},
        "missing_value_policy": "neutral",
        "explanation_template": "Ekvivalentní plocha: {value} m²",
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
    {
        "field_key": "use_type",
        "label": "Typ užití",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Typ užití: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "building_use",
        "label": "Využití budovy",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Využití budovy: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "sale_type",
        "label": "Typ prodeje",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Typ prodeje: {value}",
        "client_mode": "hidden",
    },

    # ═══════════════════════════════════════════════════════════════════
    # JEDNOTKA – KVALITA & VYBAVENÍ
    # ═══════════════════════════════════════════════════════════════════

    {
        "field_key": "overall_quality_unit",
        "label": "Celková kvalita (jednotka)",
        "entity_type": "unit",
        "data_type": "enum",
        "enabled": False,
        "include_in_score": False,
        "group_key": "unit_quality",
        "weight": 0.8,
        "rule_type": "enum_map",
        "rule_config": {
            "value_map": {
                "luxury": 1.0,
                "premium": 0.85,
                "standard_plus": 0.65,
                "standard": 0.5,
                "economy": 0.25,
            }
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Kvalita jednotky: {value}",
        "client_mode": "wizard",
    },
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
        "field_key": "permit_regular_unit",
        "label": "Řádné stavební povolení (jednotka)",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.8,
        "rule_type": "boolean_bonus",
        "rule_config": {"bonus": 1.0},
        "missing_value_policy": "neutral",
        "explanation_template": "Jednotka má řádné stavební povolení",
        "client_mode": "auto",
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
        "field_key": "price_change",
        "label": "Změna ceny (%)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.5,
        "rule_type": "numeric_linear",
        "rule_config": {"min": -0.2, "max": 0.2, "higher_is_better": False},
        "missing_value_policy": "neutral",
        "explanation_template": "Změna ceny: {value}",
        "client_mode": "auto",
    },
    {
        "field_key": "original_price_czk",
        "label": "Původní cena (Kč)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Původní cena: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "original_price_per_m2_czk",
        "label": "Původní cena za m² (Kč)",
        "entity_type": "finance",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Původní cena za m²: {value} Kč",
        "client_mode": "hidden",
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
    {
        "field_key": "reservation_duration_days",
        "label": "Délka rezervace (dny)",
        "entity_type": "unit",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Délka rezervace: {value} dní",
        "client_mode": "hidden",
    },
    {
        "field_key": "is_stale_reservation",
        "label": "Zastaralá rezervace",
        "entity_type": "unit",
        "data_type": "boolean",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.5,
        "rule_type": "boolean_penalty",
        "rule_config": {"penalty": -0.5},
        "missing_value_policy": "neutral",
        "explanation_template": "Jednotka má zastaralou/podezřelou rezervaci",
        "client_mode": "hidden",
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
    {
        "field_key": "available_units",
        "label": "Dostupných jednotek",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Dostupných jednotek: {value}",
        "client_mode": "hidden",
    },
    {
        "field_key": "availability_ratio",
        "label": "Poměr dostupnosti (%)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.4,
        "rule_type": "numeric_thresholds",
        "rule_config": {
            "thresholds": [
                {"max": 0.1, "score": 0.3, "label": "Téměř vyprodáno"},
                {"max": 0.3, "score": 0.6, "label": "Nízká dostupnost"},
                {"max": 0.6, "score": 1.0, "label": "Dobrá dostupnost"},
                {"max": 0.8, "score": 0.7, "label": "Vysoká dostupnost"},
                {"max": 1.0, "score": 0.5, "label": "Skoro neprodáno"},
            ]
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Dostupnost projektu: {value:.0%}",
        "client_mode": "auto",
    },
    {
        "field_key": "avg_price_czk",
        "label": "Průměrná cena v projektu (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Průměrná cena v projektu: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "min_price_czk",
        "label": "Nejnižší cena v projektu (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Nejnižší cena: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_price_czk",
        "label": "Nejvyšší cena v projektu (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Nejvyšší cena: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "avg_price_per_m2_czk",
        "label": "Průměrná cena za m² v projektu (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.4,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Průměrná cena/m² v projektu: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "avg_floor_area_m2",
        "label": "Průměrná plocha v projektu (m²)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "project_quality",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Průměrná plocha v projektu: {value} m²",
        "client_mode": "hidden",
    },
    {
        "field_key": "min_parking_indoor_price_czk",
        "label": "Min. cena vnitřního parkování (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Min. vnitřní parkování: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_parking_indoor_price_czk",
        "label": "Max. cena vnitřního parkování (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Max. vnitřní parkování: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "min_parking_outdoor_price_czk",
        "label": "Min. cena venkovního parkování (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Min. venkovní parkování: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_parking_outdoor_price_czk",
        "label": "Max. cena venkovního parkování (Kč)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Max. venkovní parkování: {value} Kč",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_days_on_market",
        "label": "Max. dny na trhu (projekt)",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "risk",
        "weight": 0.4,
        "rule_type": "numeric_thresholds",
        "rule_config": {
            "thresholds": [
                {"max": 60, "score": 1.0, "label": "Nový projekt"},
                {"max": 180, "score": 0.7, "label": "Běžný projekt"},
                {"max": 365, "score": 0.4, "label": "Starší projekt"},
                {"max": 99999, "score": 0.2, "label": "Velmi starý projekt"},
            ]
        },
        "missing_value_policy": "neutral",
        "explanation_template": "Nejdéle na trhu v projektu: {value} dní",
        "client_mode": "hidden",
    },
    {
        "field_key": "min_payment_contract",
        "label": "Min. platba při smlouvě",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Min. platba při smlouvě: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_payment_contract",
        "label": "Max. platba při smlouvě",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Max. platba při smlouvě: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "min_payment_construction",
        "label": "Min. platba při výstavbě",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Min. platba při výstavbě: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_payment_construction",
        "label": "Max. platba při výstavbě",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Max. platba při výstavbě: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "min_payment_occupancy",
        "label": "Min. platba při kolaudaci",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Min. platba při kolaudaci: {value:.0%}",
        "client_mode": "hidden",
    },
    {
        "field_key": "max_payment_occupancy",
        "label": "Max. platba při kolaudaci",
        "entity_type": "aggregate",
        "data_type": "number",
        "enabled": False,
        "include_in_score": False,
        "group_key": "finance",
        "weight": 0.3,
        "rule_type": "informational_only",
        "rule_config": {},
        "missing_value_policy": "neutral",
        "explanation_template": "Max. platba při kolaudaci: {value:.0%}",
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

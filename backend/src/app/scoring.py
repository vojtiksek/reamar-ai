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

def compute_match(
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
    score, fits = compute_match(unit, project, profile, w, db)

    # 3. Confidence
    conf = compute_confidence(unit, project, profile, fits)

    # 4. Strengths / compromises
    strengths, compromises = _top_strengths_and_compromises(fits, profile)

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
        "explanation_template": "Jak dobře cena odpovídá rozpočtu klienta."
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
        "explanation_template": "Zda byt leží v preferované lokalitě klienta."
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
        "explanation_template": "Shoda dispozice s požadavkem klienta."
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
        "explanation_template": "Jak dobře plocha odpovídá požadavku."
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
        "explanation_template": "Kvalita občanské vybavenosti v okolí."
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
        "explanation_template": "Dostupnost venkovního prostoru (terasa, balkón, zahrada)."
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
        "explanation_template": "Dojezdová vzdálenost na klíčová místa."
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
        "explanation_template": "Podlahové vytápění zvyšuje komfort."
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
        "explanation_template": "Orientace bytu ovlivňuje světelnost."
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
        "explanation_template": "Energetická třída budovy."
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
    }
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

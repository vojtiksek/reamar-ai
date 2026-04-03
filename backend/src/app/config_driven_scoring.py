"""Config-driven scoring engine for Reamar AI.

Replaces hardcoded 7-dimensional compute_match() with a config-driven version
that reads resolved field_rules and groups from Scoring Studio.

Usage:
    from .config_driven_scoring import config_driven_compute_match
    # Then wire into scoring.py's compute_match()
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Field value getter — maps field_key to actual ORM attribute values
# ---------------------------------------------------------------------------

# Explicit mapping for field_keys that don't match ORM attribute names directly.
# Format: field_key -> (entity, attribute) or field_key -> callable(unit, project, profile, aggregates)
_FIELD_KEY_ALIASES = {
    # field_key in config  →  (entity, actual_attr)
    "floor_heating": ("_custom", "_get_floor_heating"),
    "outdoor_space": ("_custom", "_get_outdoor_space"),
    "renovation_project": ("project", "renovation"),
    "renovation_unit": ("unit", "renovation"),
    "permit_regular_project": ("project", "permit_regular"),
    "permit_regular_unit": ("unit", "permit_regular"),
    "overall_quality_project": ("project", "overall_quality"),
    "overall_quality_unit": ("unit", "overall_quality"),
    "windows_project": ("project", "windows"),
    "windows_unit": ("unit", "windows"),
    "heating_project": ("project", "heating"),
    "heating_unit": ("unit", "heating"),
    "partition_walls_project": ("project", "partition_walls"),
    "partition_walls_unit": ("unit", "partition_walls"),
    "cooling_project": ("project", "cooling"),
    "fitness_project": ("project", "fitness"),
}


def _get_floor_heating(unit, project, profile, aggregates):
    """Check if unit/project has floor heating."""
    h = getattr(unit, "heating", None) or getattr(project, "heating", None)
    if h is None:
        return None
    return "podlah" in str(h).lower()


def _get_outdoor_space(unit, project, profile, aggregates):
    """Get total outdoor area in m2."""
    ext = getattr(unit, "exterior_area_m2", None)
    if ext is not None:
        return float(ext)
    bal = float(getattr(unit, "balcony_area_m2", None) or 0)
    ter = float(getattr(unit, "terrace_area_m2", None) or 0)
    gar = float(getattr(unit, "garden_area_m2", None) or 0)
    total = bal + ter + gar
    return total if total > 0 else None


# Custom getters registry
_CUSTOM_GETTERS = {
    "_get_floor_heating": _get_floor_heating,
    "_get_outdoor_space": _get_outdoor_space,
}


def get_field_value(
    field_key: str,
    unit,
    project,
    profile,
    aggregates=None,
) -> Any:
    """Resolve a field_key to its actual value from ORM models.

    Resolution order:
    1. Check _FIELD_KEY_ALIASES for explicit mapping
    2. Try getattr on unit
    3. Try getattr on project
    4. Try getattr on aggregates (ProjectAggregates)
    5. Return None (field not found)
    """
    # 1. Check aliases
    if field_key in _FIELD_KEY_ALIASES:
        entity, attr = _FIELD_KEY_ALIASES[field_key]
        if entity == "_custom":
            getter = _CUSTOM_GETTERS.get(attr)
            if getter:
                return getter(unit, project, profile, aggregates)
        elif entity == "unit" and unit is not None:
            return getattr(unit, attr, None)
        elif entity == "project" and project is not None:
            return getattr(project, attr, None)
        elif entity == "aggregate" and aggregates is not None:
            return getattr(aggregates, attr, None)
        return None

    # 2. Direct attribute lookup: unit → project → aggregates
    if unit is not None and hasattr(unit, field_key):
        return getattr(unit, field_key, None)
    if project is not None and hasattr(project, field_key):
        return getattr(project, field_key, None)
    if aggregates is not None and hasattr(aggregates, field_key):
        return getattr(aggregates, field_key, None)

    return None


# ---------------------------------------------------------------------------
# Field score computation by rule_type
# ---------------------------------------------------------------------------

def compute_field_score(
    rule: dict,
    value: Any,
    unit=None,
    project=None,
    profile=None,
) -> Optional[float]:
    """Compute a 0-100 score for a single field based on its rule_type and rule_config.

    Returns None if the field should not be scored (informational_only, missing value).
    """
    rule_type = rule.get("rule_type", "informational_only")
    rule_config = rule.get("rule_config") or {}
    missing_policy = rule.get("missing_value_policy", "neutral")

    # informational_only — never scored
    if rule_type == "informational_only":
        return None

    # Handle missing values
    if value is None:
        if missing_policy == "neutral":
            return None  # skip from scoring
        elif missing_policy == "zero":
            return 0.0
        elif missing_policy == "full":
            return 100.0
        return None

    # Convert value to float/str for calculations
    try:
        if rule_type.startswith("numeric") or rule_type.startswith("boolean"):
            pass  # handle below
        # otherwise keep as-is
    except Exception:
        pass

    # --- boolean_bonus ---
    if rule_type == "boolean_bonus":
        is_true = _to_bool(value)
        if is_true is None:
            return None
        true_score = float(rule_config.get("true_score", rule_config.get("bonus", 100)))
        false_score = float(rule_config.get("false_score", 0))
        # Normalize: if scores are in 0-1 range, scale to 0-100
        if true_score <= 1.0 and true_score > 0:
            true_score *= 100
        if false_score <= 1.0 and false_score != 0:
            false_score *= 100
        return true_score if is_true else false_score

    # --- boolean_penalty ---
    if rule_type == "boolean_penalty":
        is_true = _to_bool(value)
        if is_true is None:
            return None
        penalty = float(rule_config.get("penalty", -50))
        # boolean_penalty: true = bad (penalty), false = neutral (100)
        if is_true:
            # penalty is negative, clamp to 0
            return max(0.0, 100.0 + penalty * 100 if abs(penalty) <= 1 else 100.0 + penalty)
        return 100.0

    # --- enum_map ---
    if rule_type == "enum_map":
        str_val = str(value).strip().lower()
        # Check value_map first (new format)
        value_map = rule_config.get("value_map")
        if value_map:
            # Try exact match, then lowercase
            score = value_map.get(str_val)
            if score is None:
                # Try case-insensitive match
                for k, v in value_map.items():
                    if k.lower() == str_val:
                        score = v
                        break
            if score is not None:
                score = float(score)
                # Normalize 0-1 to 0-100
                if 0 <= score <= 1.0:
                    score *= 100
                return score
            # No match in map — return neutral
            return None

        # Legacy format: direct key-value in rule_config
        score = rule_config.get(str_val)
        if score is None:
            for k, v in rule_config.items():
                if k.lower() == str_val:
                    score = v
                    break
        if score is not None:
            score = float(score)
            if 0 < score <= 1.0:
                score *= 100
            return max(0.0, min(100.0, score))
        return None

    # --- numeric_linear ---
    if rule_type == "numeric_linear":
        try:
            num_val = float(value)
        except (TypeError, ValueError):
            return None

        cfg_min = float(rule_config.get("min", 0))
        cfg_max = float(rule_config.get("max", 100))
        higher_is_better = rule_config.get("higher_is_better", True)
        fallback = rule_config.get("fallback")

        if cfg_max == cfg_min:
            return fallback if fallback is not None else 50.0

        # Normalize to 0-1
        ratio = (num_val - cfg_min) / (cfg_max - cfg_min)
        ratio = max(0.0, min(1.0, ratio))

        if not higher_is_better:
            ratio = 1.0 - ratio

        return ratio * 100.0

    # --- numeric_target ---
    if rule_type == "numeric_target":
        try:
            num_val = float(value)
        except (TypeError, ValueError):
            return None

        target = rule_config.get("target")
        tolerance_pct = rule_config.get("tolerance_pct", 0.5)

        if target is None:
            # No target specified — need profile data for context
            # This is used for budget_fit and area_fit which are special
            # They compute their own score externally
            return None

        target = float(target)
        tolerance = abs(target * float(tolerance_pct))

        if tolerance == 0:
            return 100.0 if num_val == target else 0.0

        diff = abs(num_val - target)
        if diff <= tolerance:
            # Within tolerance — linear from 100 at center to some minimum at edge
            return max(0.0, 100.0 * (1.0 - diff / tolerance * 0.5))
        else:
            # Outside tolerance — linear decay to 0
            over = diff - tolerance
            return max(0.0, 50.0 * (1.0 - min(over / tolerance, 1.0)))

    # --- numeric_thresholds ---
    if rule_type == "numeric_thresholds":
        try:
            num_val = float(value)
        except (TypeError, ValueError):
            return None

        thresholds = rule_config.get("thresholds", [])
        if not thresholds:
            return None

        for thresh in thresholds:
            max_val = float(thresh.get("max", float("inf")))
            if num_val <= max_val:
                score = float(thresh.get("score", 50))
                # Normalize 0-1 to 0-100
                if 0 <= score <= 1.0:
                    score *= 100
                return score

        # Beyond all thresholds — return last score or 0
        last_score = float(thresholds[-1].get("score", 0))
        if 0 <= last_score <= 1.0:
            last_score *= 100
        return last_score

    # Unknown rule_type
    logger.warning(f"Unknown rule_type '{rule_type}' for field '{rule.get('field_key')}'")
    return None


def _to_bool(value) -> Optional[bool]:
    """Convert various value types to boolean."""
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in ("true", "1", "yes", "ano"):
        return True
    if s in ("false", "0", "no", "ne", ""):
        return False
    return None


# ---------------------------------------------------------------------------
# Legacy fit fields — special handling for the original 7 dimensions
# ---------------------------------------------------------------------------

def _compute_legacy_budget_fit(unit, project, profile) -> Optional[float]:
    """Compute budget fit using original logic (needs profile budget range)."""
    price = getattr(unit, "price_czk", None)
    if price is None or profile is None:
        return None

    if getattr(profile, "budget_min", None) is None and getattr(profile, "budget_max", None) is None:
        return 100.0

    lo = getattr(profile, "budget_min", None) or 0
    hi = getattr(profile, "budget_max", None) or price
    if lo <= price <= hi:
        return 100.0
    center = (lo + hi) / 2 if hi > lo else hi or lo or 1
    diff_ratio = abs(price - center) / max(center, 1)
    return max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))


def _compute_legacy_walkability_fit(unit, project, profile) -> Optional[float]:
    """Compute walkability fit using original logic."""
    try:
        from .walkability import compute_personalized_walkability_score, project_to_raw_metrics
        prefs = (getattr(profile, "walkability_preferences_json", None) if profile else None) or {}
        if prefs and any(v != "normal" for v in prefs.values()):
            raw = project_to_raw_metrics(project)
            result = compute_personalized_walkability_score(raw, prefs)
            if result.get("score") is not None:
                return float(result["score"])
        elif getattr(project, "walkability_score", None) is not None:
            return float(project.walkability_score)
        return 50.0
    except Exception:
        return 50.0


def _compute_legacy_location_fit(unit, project, profile) -> Optional[float]:
    """Compute location fit using original polygon logic."""
    if (
        getattr(project, "gps_latitude", None) is None
        or getattr(project, "gps_longitude", None) is None
        or profile is None
    ):
        return None

    from .scoring import _ensure_geo_helpers, _parse_polygon_geojson, _point_in_polygon
    _ensure_geo_helpers()

    poly = _parse_polygon_geojson(getattr(profile, "polygon_geojson", None))
    if poly:
        inside = _point_in_polygon(
            float(project.gps_latitude),
            float(project.gps_longitude),
            poly,
        )
        return 100.0 if inside else 60.0
    return 70.0


def _compute_legacy_layout_fit(unit, project, profile) -> Optional[float]:
    """Compute layout fit using original logic."""
    from .aggregates import _layout_group
    if profile and getattr(profile, "layouts", None) and "values" in (profile.layouts or {}) and getattr(unit, "layout", None):
        pref_values = [str(v).strip().lower() for v in (profile.layouts.get("values") or [])]
        unit_bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
        return 100.0 if unit_bucket in pref_values else 50.0
    return None


def _compute_legacy_area_fit(unit, project, profile) -> Optional[float]:
    """Compute area fit using original logic."""
    area = float(unit.floor_area_m2) if getattr(unit, "floor_area_m2", None) is not None else None
    if area is None or profile is None:
        return None

    has_lo = getattr(profile, "area_min", None) is not None
    has_hi = getattr(profile, "area_max", None) is not None
    if has_lo or has_hi:
        lo = profile.area_min or 0.0
        hi = profile.area_max or area
        if lo <= area <= hi:
            return 100.0
        center = (lo + hi) / 2 if hi > lo else hi or lo or 1.0
        diff_ratio = abs(area - center) / max(center, 1.0)
        return max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))
    else:
        wizard_budget = (
            ((getattr(profile, "filter_json", None) or {}).get("wizard") or {}).get("budget") or {}
        )
        ideal_area = wizard_budget.get("ideal_area")
        if ideal_area is not None:
            try:
                ideal_area = float(ideal_area)
                diff_ratio = abs(area - ideal_area) / max(ideal_area, 1.0)
                return max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))
            except (TypeError, ValueError):
                pass
    return 50.0


def _compute_legacy_outdoor_fit(unit, project, profile) -> Optional[float]:
    """Compute outdoor fit using original logic."""
    if not profile or not getattr(profile, "filter_json", None):
        return None

    wizard_outdoor = (
        ((profile.filter_json or {}).get("wizard") or {}).get("outdoor") or {}
    )
    min_outdoor = wizard_outdoor.get("min_outdoor_area_m2")
    if min_outdoor is None:
        return None

    try:
        min_outdoor = float(min_outdoor)
        if getattr(unit, "exterior_area_m2", None) is not None:
            unit_outdoor = float(unit.exterior_area_m2)
        else:
            unit_outdoor = (
                float(getattr(unit, "balcony_area_m2", None) or 0)
                + float(getattr(unit, "terrace_area_m2", None) or 0)
                + float(getattr(unit, "garden_area_m2", None) or 0)
            )
        if min_outdoor <= 0:
            return 100.0
        if unit_outdoor >= min_outdoor:
            return 100.0
        return max(0.0, 100.0 * unit_outdoor / min_outdoor)
    except (TypeError, ValueError):
        return None


def _compute_legacy_commute_fit(unit, project, profile, db=None) -> tuple[Optional[float], list[dict], bool]:
    """Compute commute fit using original logic.

    Returns (score, commute_details, hard_fail).
    """
    if (
        not profile
        or not getattr(profile, "commute_points_json", None)
        or getattr(project, "gps_latitude", None) is None
        or getattr(project, "gps_longitude", None) is None
        or db is None
    ):
        return None, [], False

    from .routing_provider import get_cached_travel_time_minutes

    points = profile.commute_points_json or []
    if isinstance(points, dict):
        points = points.get("points") or []

    per_point_scores: list[float] = []
    commute_details: list[dict] = []
    commute_hard_fail = False

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

    if commute_hard_fail:
        return 0.0, commute_details, True
    if per_point_scores:
        return min(per_point_scores), commute_details, False
    return None, commute_details, False


# Map of legacy field_keys that need special computation (profile-dependent)
_LEGACY_FIELD_COMPUTERS = {
    "budget_fit": _compute_legacy_budget_fit,
    "location_fit": _compute_legacy_location_fit,
    "layout_fit": _compute_legacy_layout_fit,
    "area_fit": _compute_legacy_area_fit,
    "walkability": _compute_legacy_walkability_fit,
    "outdoor_space": _compute_legacy_outdoor_fit,
    # commute_fit handled separately due to db dependency
}


# ---------------------------------------------------------------------------
# Config-driven compute_match
# ---------------------------------------------------------------------------

def config_driven_compute_match(
    unit,
    project,
    profile,
    weights: dict[str, float],
    db: Session | None = None,
    scoring_config: dict | None = None,
    aggregates=None,
) -> tuple[float, dict[str, Any]]:
    """Config-driven match scoring.

    Reads resolved field_rules and groups, computes per-field scores,
    aggregates into groups, and produces a final 0-100 score.

    Args:
        unit: Unit ORM object
        project: Project ORM object
        profile: ClientProfile ORM object (or None)
        weights: Legacy weights dict (used as fallback)
        db: SQLAlchemy session (needed for commute)
        scoring_config: Dict with 'groups' and 'field_rules' (resolved).
                        If None, uses defaults from scoring module.
        aggregates: ProjectAggregates ORM object (optional)

    Returns:
        (score, fits_dict) — same interface as legacy compute_match
    """
    from .scoring import (
        resolve_groups, resolve_field_rules,
        _ensure_geo_helpers, _wizard_preferences_adjustment,
    )
    _ensure_geo_helpers()

    # Resolve config
    if scoring_config:
        groups = resolve_groups(scoring_config.get("groups"))
        field_rules = resolve_field_rules(scoring_config.get("field_rules"))
    else:
        groups = resolve_groups(None)
        field_rules = resolve_field_rules(None)

    # --- Compute per-field scores ---
    field_scores: dict[str, dict] = {}  # field_key -> {score, weight, group_key, label, value, rule}
    commute_details: list[dict] = []
    commute_hard_fail = False

    for rule in field_rules:
        field_key = rule.get("field_key")
        if not field_key:
            continue
        if not rule.get("enabled", False):
            continue
        if not rule.get("include_in_score", False):
            continue

        group_key = rule.get("group_key", "other")
        field_weight = float(rule.get("weight", 1.0))
        label = rule.get("label", field_key)

        # Special handling for commute_fit (needs db)
        if field_key == "commute_fit":
            score, details, hard_fail = _compute_legacy_commute_fit(unit, project, profile, db)
            commute_details = details
            commute_hard_fail = hard_fail
            if score is not None:
                field_scores[field_key] = {
                    "score": score,
                    "weight": field_weight,
                    "group_key": group_key,
                    "label": label,
                    "value": score,
                }
            continue

        # Try legacy computer first (for profile-dependent fields)
        if field_key in _LEGACY_FIELD_COMPUTERS:
            legacy_fn = _LEGACY_FIELD_COMPUTERS[field_key]
            score = legacy_fn(unit, project, profile)
            if score is not None:
                field_scores[field_key] = {
                    "score": score,
                    "weight": field_weight,
                    "group_key": group_key,
                    "label": label,
                    "value": score,
                }
            continue

        # Generic field value getter
        value = get_field_value(field_key, unit, project, profile, aggregates)

        # Compute field score
        score = compute_field_score(rule, value, unit, project, profile)
        if score is not None:
            field_scores[field_key] = {
                "score": score,
                "weight": field_weight,
                "group_key": group_key,
                "label": label,
                "value": value,
            }

    # --- Hard fail on commute ---
    if commute_hard_fail:
        fits = _build_fits_dict(field_scores, commute_details)
        fits["pref_adj"] = 0.0
        return 0.0, fits

    # --- Aggregate into groups ---
    group_scores: dict[str, dict] = {}  # group_key -> {score, weight, fields}

    for group_key, group_cfg in groups.items():
        if not group_cfg.get("enabled", True):
            continue

        group_weight = float(group_cfg.get("weight", 1.0))
        group_fields = [
            fs for fs in field_scores.values()
            if fs["group_key"] == group_key
        ]

        if not group_fields:
            continue

        # Weighted average within group
        total_w = sum(f["weight"] for f in group_fields)
        if total_w <= 0:
            continue

        weighted_sum = sum(f["score"] * f["weight"] for f in group_fields)
        group_score = weighted_sum / total_w

        group_scores[group_key] = {
            "score": group_score,
            "weight": group_weight,
            "fields": [f["label"] for f in group_fields],
        }

    # --- Final score: weighted average across groups ---
    if not group_scores:
        # No scorable fields — return neutral
        fits = _build_fits_dict(field_scores, commute_details)
        fits["pref_adj"] = 0.0
        return 50.0, fits

    total_group_weight = sum(gs["weight"] for gs in group_scores.values())
    if total_group_weight <= 0:
        total_score = 50.0
    else:
        total_score = sum(
            gs["score"] * gs["weight"] for gs in group_scores.values()
        ) / total_group_weight

    # --- Wizard preferences adjustment ---
    pref_adj = _wizard_preferences_adjustment(unit, project, profile)
    pref_adj = max(-20.0, min(15.0, pref_adj))
    total_score = max(0.0, min(100.0, total_score + pref_adj))

    # --- Build fits dict ---
    fits = _build_fits_dict(field_scores, commute_details)
    fits["pref_adj"] = pref_adj
    fits["group_scores"] = {
        gk: {"score": round(gs["score"], 2), "weight": gs["weight"], "fields": gs["fields"]}
        for gk, gs in group_scores.items()
    }
    fits["field_scores"] = {
        fk: {"score": round(fs["score"], 2), "weight": fs["weight"], "label": fs["label"]}
        for fk, fs in field_scores.items()
    }

    return total_score, fits


def _build_fits_dict(
    field_scores: dict[str, dict],
    commute_details: list[dict],
) -> dict[str, Any]:
    """Build backward-compatible fits dict from field scores."""
    # Map new field_keys to legacy fit names
    legacy_map = {
        "budget_fit": "budget_fit",
        "walkability": "walkability_fit",
        "location_fit": "location_fit",
        "layout_fit": "layout_fit",
        "area_fit": "area_fit",
        "outdoor_space": "outdoor_fit",
        "commute_fit": "commute_fit",
    }

    fits: dict[str, Any] = {}
    for field_key, fit_name in legacy_map.items():
        if field_key in field_scores:
            fits[fit_name] = field_scores[field_key]["score"]
        else:
            fits[fit_name] = 0.0

    fits["commute_details"] = commute_details
    return fits


# ---------------------------------------------------------------------------
# Config-driven strengths & compromises
# ---------------------------------------------------------------------------

def config_driven_strengths_compromises(
    fits: dict[str, Any],
    profile=None,
) -> tuple[list[str], list[str]]:
    """Generate strengths/compromises from field_scores in fits dict."""
    strengths: list[str] = []
    compromises: list[str] = []

    # Use field_scores if available (new format)
    field_scores = fits.get("field_scores")
    if field_scores:
        for fk, fs in field_scores.items():
            score = fs.get("score", 0)
            label = fs.get("label", fk)
            if score >= 85:
                strengths.append(label)
            elif score <= 30:
                compromises.append(label)
    else:
        # Fallback to legacy fit names
        labels = {
            "budget_fit": "Rozpočet",
            "walkability_fit": "Walkability",
            "location_fit": "Poloha",
            "layout_fit": "Dispozice",
            "area_fit": "Plocha",
            "outdoor_fit": "Venkovní prostor",
            "commute_fit": "Dojezd",
        }
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
# Config-driven confidence
# ---------------------------------------------------------------------------

def config_driven_compute_confidence(
    unit,
    project,
    profile,
    fits: dict[str, Any],
    field_rules: list[dict] | None = None,
) -> dict[str, Any]:
    """Compute confidence based on how many enabled scoring fields have data.

    If field_rules not provided, falls back to the original confidence logic.
    """
    if not field_rules:
        # Fall back to original
        from .scoring import compute_confidence
        return compute_confidence(unit, project, profile, fits)

    enabled_count = 0
    has_value_count = 0
    missing_fields: list[str] = []

    for rule in field_rules:
        if not rule.get("enabled", False):
            continue
        if not rule.get("include_in_score", False):
            continue
        if rule.get("rule_type") == "informational_only":
            continue

        enabled_count += 1
        field_key = rule.get("field_key", "")
        label = rule.get("label", field_key)

        # Check if we got a score for this field
        field_scores = fits.get("field_scores", {})
        if field_key in field_scores:
            has_value_count += 1
        else:
            missing_fields.append(label)

    if enabled_count == 0:
        return {"score": 0, "label": "low", "reasons": ["No scoring fields configured"]}

    score = round(100.0 * has_value_count / enabled_count)

    if score >= 75:
        label = "high"
    elif score >= 45:
        label = "medium"
    else:
        label = "low"

    return {
        "score": score,
        "label": label,
        "reasons": missing_fields,
    }

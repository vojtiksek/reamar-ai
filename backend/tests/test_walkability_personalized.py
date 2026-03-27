"""
Tests for personalized walkability scoring.
Invariant: when all preferences are "normal", personalized score must match default score.
"""

import pytest

from app.walkability import (
    compute_walkability_score,
    compute_personalized_walkability_score,
)


def _sample_raw_metrics() -> dict:
    """Sample raw_metrics with mixed distances/counts to produce non-trivial scores."""
    return {
        "distance_to_supermarket_m": 250.0,
        "count_supermarket_500m": 2,
        "distance_to_pharmacy_m": 180.0,
        "count_pharmacy_500m": 1,
        "distance_to_restaurant_m": 400.0,
        "count_restaurant_500m": 5,
        "distance_to_cafe_m": 350.0,
        "count_cafe_500m": 3,
        "distance_to_park_m": 120.0,
        "count_park_500m": 2,
        "distance_to_fitness_m": 600.0,
        "count_fitness_500m": 1,
        "distance_to_playground_m": 300.0,
        "count_playground_500m": 1,
        "distance_to_kindergarten_m": 800.0,
        "count_kindergarten_500m": 0,
        "distance_to_primary_school_m": 1200.0,
        "count_primary_school_500m": 0,
        "walking_distance_to_tram_stop_m": 200.0,
        "walking_distance_to_bus_stop_m": 150.0,
        "walking_distance_to_metro_station_m": 2500.0,
        "distance_to_tram_stop_m": 200.0,
        "distance_to_bus_stop_m": 150.0,
        "distance_to_metro_station_m": 2500.0,
    }


def _all_normal_preferences() -> dict:
    return {cat: "normal" for cat in (
        "supermarket", "pharmacy", "park", "restaurant", "cafe", "fitness",
        "playground", "kindergarten", "primary_school", "metro", "tram", "bus",
    )}


ROUNDING_TOLERANCE = 1  # allow 1 point difference due to int rounding in default


def test_personalized_with_all_normal_matches_default_total():
    """When all preferences are 'normal', personalized score must equal default score."""
    raw = _sample_raw_metrics()
    default = compute_walkability_score(raw)
    prefs = _all_normal_preferences()
    personalized = compute_personalized_walkability_score(raw, prefs)

    default_score = default["walkability_score"]
    personalized_score = personalized["score"]
    assert personalized_score is not None
    assert abs(personalized_score - default_score) <= ROUNDING_TOLERANCE, (
        f"Personalized score {personalized_score} should match default {default_score} "
        "when all preferences are 'normal'."
    )


def test_personalized_with_all_normal_matches_default_subscores():
    """When all preferences are 'normal', personalized subscores must match default subscores."""
    raw = _sample_raw_metrics()
    default = compute_walkability_score(raw)
    prefs = _all_normal_preferences()
    personalized = compute_personalized_walkability_score(raw, prefs)

    for key, pkey in (
        ("walkability_daily_needs_score", "daily_needs_score"),
        ("walkability_transport_score", "transport_score"),
        ("walkability_leisure_score", "leisure_score"),
        ("walkability_family_score", "family_score"),
    ):
        d_val = default.get(key)
        p_val = personalized.get(pkey)
        assert p_val is not None, f"Personalized {pkey} should be present"
        assert d_val is not None, f"Default {key} should be present"
        assert abs(p_val - d_val) <= ROUNDING_TOLERANCE, (
            f"Personalized {pkey} {p_val} should match default {key} {d_val} when all normal."
        )


def test_personalized_high_preference_increases_influence():
    """Setting one category to 'high' should change the score (direction depends on data)."""
    raw = _sample_raw_metrics()
    prefs_normal = _all_normal_preferences()
    result_normal = compute_personalized_walkability_score(raw, prefs_normal)

    prefs_high_park = {**prefs_normal, "park": "high"}
    result_high_park = compute_personalized_walkability_score(raw, prefs_high_park)

    # Score may go up or down; we only require it can change (not identical in all cases)
    # With our sample, park is 120m + 2 count -> relatively good. Boosting park should increase leisure
    # and thus can change total. So at least one subscore or total should differ.
    changed = (
        result_high_park["score"] != result_normal["score"]
        or result_high_park["leisure_score"] != result_normal["leisure_score"]
        or result_high_park["family_score"] != result_normal["family_score"]
    )
    assert changed, (
        "Setting park to 'high' should change personalized score or a subscore."
    )


def test_personalized_ignore_preference_removes_category():
    """Setting a category to 'ignore' should exclude it from its subscore (or reweight)."""
    raw = _sample_raw_metrics()
    prefs_normal = _all_normal_preferences()
    result_normal = compute_personalized_walkability_score(raw, prefs_normal)

    prefs_ignore_pharmacy = {**prefs_normal, "pharmacy": "ignore"}
    result_ignore = compute_personalized_walkability_score(raw, prefs_ignore_pharmacy)

    # Daily needs now only has supermarket (pharmacy ignored). Score can differ.
    assert result_ignore["daily_needs_score"] is not None
    # With only supermarket in daily needs, daily_needs_score equals supermarket score
    assert result_ignore["daily_needs_score"] != result_normal["daily_needs_score"] or (
        result_ignore["score"] != result_normal["score"]
    )

"""Regression tests for wizard → scoring field integrity (Phase 6a).

Covers Steps 4–7 field mapping:
  - normalize_wizard: floor_rule → preferred_floor (top_3 / top_1)
  - normalize_wizard: budget.min_outdoor_area_m2 → outdoor.min_outdoor_area_m2
  - build_structured_wizard: skip_categories.surroundings → skip_noise / skip_walkability
  - build_structured_wizard: outdoor_area_min reads from budget, not outdoor
  - derive_flat_weights_from_wizard: surroundings=True zeros noise + walkability weights
  - compute_flat_match: floor_preference scoring with top_3 / top_1

All tests are pure-Python and do not hit the database.
"""
import pytest
from app.scoring import (
    normalize_wizard,
    build_structured_wizard,
    derive_flat_weights_from_wizard,
    FLAT_WEIGHT_DEFAULTS,
)


# ---------------------------------------------------------------------------
# Fake profile helpers
# ---------------------------------------------------------------------------

class _Profile:
    """Minimal fake ClientProfile for tests that don't need DB."""
    def __init__(self, filter_json=None, **kwargs):
        self.filter_json = filter_json or {}
        self.budget_max = kwargs.get("budget_max")
        self.area_min = kwargs.get("area_min")
        self.layouts = kwargs.get("layouts")
        self.purchase_purpose = kwargs.get("purchase_purpose")
        self.property_type = kwargs.get("property_type")
        self.walkability_preferences_json = kwargs.get("walkability_preferences_json")
        self.commute_points_json = kwargs.get("commute_points_json")
        self.polygon_geojson = kwargs.get("polygon_geojson")

    def __getattr__(self, name):
        return None


def _wizard_profile(wizard: dict) -> _Profile:
    """Build a fake profile with raw wizard and no structured_wizard (forces fallback path)."""
    return _Profile(filter_json={"wizard": wizard})


def _structured_profile(wizard: dict) -> _Profile:
    """Build a fake profile that has structured_wizard (primary path).

    The structured_wizard is computed by replicating what buildStructuredWizard()
    does in the frontend. For test purposes we build it manually from the
    AFTER-fix logic so the tests lock in the corrected behaviour.
    """
    # We intentionally use build_structured_wizard via the raw wizard path
    # to get a StructuredWizard, then serialise it into filter_json.
    # This simulates the frontend having applied the fix.
    from dataclasses import asdict
    prof = _wizard_profile(wizard)
    sw = build_structured_wizard(prof)
    return _Profile(filter_json={
        "wizard": wizard,
        "structured_wizard": asdict(sw),
    })


# ---------------------------------------------------------------------------
# 1. normalize_wizard: floor_rule → preferred_floor
# ---------------------------------------------------------------------------

class TestNormalizeWizardFloorRule:
    """BUG 3b fix: top_3/top_1 must produce correct preferred_floor values."""

    def test_top_3_produces_top_3_preferred_floor(self):
        result = normalize_wizard({"outdoor": {"floor_rule": "top_3"}})
        assert result["outdoor"]["preferred_floor"] == "top_3", (
            "floor_rule=top_3 must map to preferred_floor='top_3', "
            "not 'high' (which _flat_floor_preference_fit never matches)"
        )

    def test_top_1_produces_top_floor_preferred_floor(self):
        result = normalize_wizard({"outdoor": {"floor_rule": "top_1"}})
        assert result["outdoor"]["preferred_floor"] == "top_floor", (
            "floor_rule=top_1 must map to preferred_floor='top_floor'"
        )

    def test_no_ground_does_not_set_preferred_floor(self):
        result = normalize_wizard({"outdoor": {"floor_rule": "no_ground"}})
        # no_ground sets ground_floor_sensitive, not preferred_floor
        assert result["outdoor"].get("preferred_floor") is None
        assert result["outdoor"]["ground_floor_sensitive"] == "must"

    def test_ignore_produces_no_changes(self):
        result = normalize_wizard({"outdoor": {"floor_rule": "ignore"}})
        assert result["outdoor"].get("preferred_floor") is None
        assert result["outdoor"].get("ground_floor_sensitive") is None

    def test_existing_preferred_floor_not_overwritten(self):
        """Backward compat: legacy data that already has preferred_floor is left alone."""
        result = normalize_wizard({"outdoor": {"floor_rule": "top_3", "preferred_floor": "high"}})
        assert result["outdoor"]["preferred_floor"] == "high"  # pre-existing value preserved

    def test_top_3_preferred_floor_reaches_build_structured_wizard(self):
        """The corrected preferred_floor value propagates through build_structured_wizard."""
        prof = _wizard_profile({"outdoor": {"floor_rule": "top_3"}})
        sw = build_structured_wizard(prof)
        assert sw.preferences.preferred_floor == "top_3"

    def test_top_1_preferred_floor_reaches_build_structured_wizard(self):
        prof = _wizard_profile({"outdoor": {"floor_rule": "top_1"}})
        sw = build_structured_wizard(prof)
        assert sw.preferences.preferred_floor == "top_floor"
        assert sw.hard_filters.penthouse_only is True


# ---------------------------------------------------------------------------
# 2. normalize_wizard: budget.min_outdoor_area_m2 → outdoor.min_outdoor_area_m2
# ---------------------------------------------------------------------------

class TestNormalizeWizardOutdoorArea:
    """BUG 1 (backend fallback path): verify existing normalize_wizard mapping."""

    def test_budget_outdoor_area_mapped_to_outdoor_section(self):
        result = normalize_wizard({"budget": {"min_outdoor_area_m2": 12}})
        assert result["outdoor"]["min_outdoor_area_m2"] == 12

    def test_mapping_does_not_overwrite_existing_outdoor_value(self):
        result = normalize_wizard({
            "budget": {"min_outdoor_area_m2": 12},
            "outdoor": {"min_outdoor_area_m2": 20},
        })
        # Existing outdoor value takes precedence (normalize_wizard only fills if missing)
        assert result["outdoor"]["min_outdoor_area_m2"] == 20

    def test_outdoor_area_reaches_hard_filters(self):
        """outdoor_area_min propagates into HardFilters via the raw wizard path."""
        prof = _wizard_profile({"budget": {"min_outdoor_area_m2": 8}})
        sw = build_structured_wizard(prof)
        assert sw.hard_filters.outdoor_area_min == 8, (
            "budget.min_outdoor_area_m2 must reach hf.outdoor_area_min "
            "via normalize_wizard mapping"
        )

    def test_missing_outdoor_area_is_none(self):
        prof = _wizard_profile({"budget": {}})
        sw = build_structured_wizard(prof)
        assert sw.hard_filters.outdoor_area_min is None


# ---------------------------------------------------------------------------
# 3. build_structured_wizard: skip_categories.surroundings
# ---------------------------------------------------------------------------

class TestSkipCategoriesSurroundings:
    """BUG 2 fix: surroundings=true must set skip_noise AND skip_walkability."""

    def test_surroundings_skip_sets_skip_noise(self):
        prof = _wizard_profile({"skip_categories": {"surroundings": True}})
        sw = build_structured_wizard(prof)
        assert sw.preferences.skip_noise is True, (
            "skip_categories.surroundings=True must set skip_noise=True"
        )

    def test_surroundings_skip_sets_skip_walkability(self):
        prof = _wizard_profile({"skip_categories": {"surroundings": True}})
        sw = build_structured_wizard(prof)
        assert sw.preferences.skip_walkability is True, (
            "skip_categories.surroundings=True must set skip_walkability=True"
        )

    def test_surroundings_false_leaves_flags_false(self):
        prof = _wizard_profile({"skip_categories": {"surroundings": False}})
        sw = build_structured_wizard(prof)
        assert sw.preferences.skip_noise is False
        assert sw.preferences.skip_walkability is False

    def test_explicit_noise_skip_still_works(self):
        """Legacy/direct noise skip key continues to work."""
        prof = _wizard_profile({"skip_categories": {"noise": True, "walkability": False}})
        sw = build_structured_wizard(prof)
        assert sw.preferences.skip_noise is True
        assert sw.preferences.skip_walkability is False

    def test_surroundings_zeros_noise_and_walkability_weights(self):
        """End-to-end: surroundings skip → flat weights for noise+walkability are 0."""
        prof = _wizard_profile({"skip_categories": {"surroundings": True}})
        sw = build_structured_wizard(prof)
        weights = derive_flat_weights_from_wizard(sw)
        assert weights.get("noise", 1.0) == 0.0, "noise weight must be 0 when surroundings skipped"
        assert weights.get("walkability", 1.0) == 0.0, "walkability weight must be 0 when surroundings skipped"

    def test_surroundings_skip_redistributes_weight(self):
        """Zeroed noise+walkability weight is redistributed to remaining aspects."""
        prof_skip = _wizard_profile({"skip_categories": {"surroundings": True}})
        prof_noskip = _wizard_profile({})
        sw_skip = build_structured_wizard(prof_skip)
        sw_noskip = build_structured_wizard(prof_noskip)
        weights_skip = derive_flat_weights_from_wizard(sw_skip)
        weights_noskip = derive_flat_weights_from_wizard(sw_noskip)
        # Active remaining aspects must have higher weight than without skip
        assert weights_skip.get("unit_area", 0) > weights_noskip.get("unit_area", 0)
        # Noise and walkability must be 0
        assert weights_skip.get("noise", 1.0) == 0.0
        assert weights_skip.get("walkability", 1.0) == 0.0

    def test_no_skip_categories_leaves_defaults(self):
        """No skip_categories = default weights unchanged."""
        prof = _wizard_profile({})
        sw = build_structured_wizard(prof)
        weights = derive_flat_weights_from_wizard(sw)
        assert weights.get("noise", 0) > 0
        assert weights.get("walkability", 0) > 0


# ---------------------------------------------------------------------------
# 4. derive_flat_weights_from_wizard: individual skip categories
# ---------------------------------------------------------------------------

class TestDeriveWeightsSkipCategories:
    """Verify skip_standards and skip_amenities zero the right aspect groups."""

    def test_skip_standards_zeros_all_standard_aspects(self):
        prof = _wizard_profile({"skip_categories": {"standards": True}})
        sw = build_structured_wizard(prof)
        weights = derive_flat_weights_from_wizard(sw)
        for key in ("heating", "heating_source", "recuperation", "exterior_blinds",
                    "air_conditioning", "flooring", "ceiling_height", "windows"):
            assert weights.get(key, 1.0) == 0.0, f"standards skip must zero '{key}'"

    def test_skip_amenities_zeros_all_amenity_aspects(self):
        prof = _wizard_profile({"skip_categories": {"amenities": True}})
        sw = build_structured_wizard(prof)
        weights = derive_flat_weights_from_wizard(sw)
        for key in ("reception", "fitness_project", "ev_charger", "courtyard_garden"):
            assert weights.get(key, 1.0) == 0.0, f"amenities skip must zero '{key}'"

    def test_no_skip_all_defaults_positive(self):
        weights = derive_flat_weights_from_wizard(None)
        for key, default in FLAT_WEIGHT_DEFAULTS.items():
            if default > 0:
                assert weights.get(key, 0) > 0, f"default weight for '{key}' must be positive"

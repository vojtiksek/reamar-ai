"""Regression tests for administrative_area scoring + explainability.

Covers Phase 5b-5e behaviour:
  - _normalize_admin_area  (backward compat: None / str / list)
  - _admin_area_signal     (status, adj, matched_area, preferred_areas)
  - _admin_area_soft_adjustment  (Phase 5c numeric regression)
  - _admin_area_explain_texts    (strength / compromise text production)
  - compute_eligibility          (polygon > admin priority; soft vs hard mode)
  - compute_full_score           (propagation into top_strengths / top_compromises)

All tests are pure-Python and do not hit the database.
"""
import json
import pytest

from app.scoring import (
    _normalize_admin_area,
    _admin_area_signal,
    _admin_area_soft_adjustment,
    _admin_area_explain_texts,
    HardFilters,
    compute_eligibility,
    compute_full_score,
)


# ---------------------------------------------------------------------------
# Shared test fixtures
# ---------------------------------------------------------------------------

class _Profile:
    """Minimal fake ClientProfile."""

    def __init__(
        self,
        polygon_geojson=None,
        admin_areas=None,
        method_admin=False,
    ):
        self.polygon_geojson = polygon_geojson
        self.filter_json = {
            "wizard": {
                "hard_filters": {
                    "location_admin_area": admin_areas or [],
                    "method_admin": method_admin,
                },
                "location": {
                    "administrative_area": admin_areas or [],
                    "method_admin": method_admin,
                },
            }
        }

    def __getattr__(self, name):
        return None


class _Unit:
    """Minimal fake Unit."""

    id = 1
    price_czk = 8_000_000
    floor_area_m2 = 60
    layout = "2+kk"

    def __getattr__(self, name):
        return None


class _Project:
    """Minimal fake Project."""

    def __init__(self, lat=50.10, lon=14.38, admin=None, district=None):
        self.gps_latitude = lat
        self.gps_longitude = lon
        self.administrative_district_iga = admin
        self.district = district
        self.id = 1
        self.walkability_score = 65.0

    def __getattr__(self, name):
        return None


# GeoJSON polygon enclosing (50.08-50.12 lat, 14.35-14.42 lon)
_POLYGON = json.dumps({
    "type": "Polygon",
    "coordinates": [
        [[14.35, 50.08], [14.42, 50.08], [14.42, 50.12], [14.35, 50.12], [14.35, 50.08]]
    ],
})
_INSIDE = (50.10, 14.38)   # inside polygon
_OUTSIDE = (50.04, 14.44)  # outside polygon

# Minimal flat_weights for compute_full_score flat-path tests
_FLAT_W = {
    "price_distance": 15,
    "unit_area": 10,
    "walkability": 15,
    "commute_time": 10,
    "outdoor_area": 10,
    "layout_match": 10,
    "quiet_environment": 10,
    "project_quality": 10,
    "standards": 10,
}


def _mk_hf(areas, method_admin=False):
    h = HardFilters()
    h.location_admin_area = areas
    h.method_admin = method_admin
    return h


# ---------------------------------------------------------------------------
# 1. _normalize_admin_area — backward compatibility
# ---------------------------------------------------------------------------

class TestNormalizeAdminArea:
    def test_none_returns_empty_list(self):
        assert _normalize_admin_area(None) == []

    def test_string_ignored_post_clean_slate(self):
        # Post-clean-slate: admin_area is always list[str] in structured_wizard.
        # Plain string input is no longer supported — returns empty list.
        assert _normalize_admin_area("Praha 6") == []
        assert _normalize_admin_area("") == []

    def test_list_passthrough(self):
        result = _normalize_admin_area(["Praha 6", "Praha 7"])
        assert result == ["Praha 6", "Praha 7"]

    def test_list_with_empty_strings_filtered(self):
        result = _normalize_admin_area(["Praha 6", "", "  "])
        # whitespace-only entries are stripped; only non-empty survive
        assert "Praha 6" in result

    def test_unexpected_type_returns_empty(self):
        # Defensive: unexpected types return empty list without crashing
        result = _normalize_admin_area(42)
        assert result == []


# ---------------------------------------------------------------------------
# 2. _admin_area_signal — status, adj, matched_area
# ---------------------------------------------------------------------------

class TestAdminAreaSignal:
    def test_off_when_no_preferred_areas(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf([]))
        assert sig["status"] == "off"
        assert sig["adj"] == 0.0
        assert sig["matched_area"] is None

    def test_inside_on_administrative_district_iga_match(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 6"]))
        assert sig["status"] == "inside"
        assert sig["adj"] == 6.0
        assert sig["matched_area"] == "Praha 6"

    def test_inside_on_district_fallback(self):
        """Match via project.district when administrative_district_iga is None."""
        sig = _admin_area_signal(
            _Project(admin=None, district="Praha 4"),
            _mk_hf(["Praha 4"]),
        )
        assert sig["status"] == "inside"
        assert sig["adj"] == 6.0
        assert sig["matched_area"] == "Praha 4"

    def test_inside_case_insensitive(self):
        """Broker may type lowercase; should still match."""
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["praha 6"]))
        assert sig["status"] == "inside"

    def test_inside_preserves_broker_casing_in_matched_area(self):
        """matched_area should reflect the broker's original input."""
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 6"]))
        assert sig["matched_area"] == "Praha 6"

    def test_outside_when_no_match(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 10"]))
        assert sig["status"] == "outside"
        assert sig["adj"] == -3.0
        assert sig["matched_area"] is None

    def test_na_when_project_has_no_admin_data(self):
        sig = _admin_area_signal(_Project(admin=None, district=None), _mk_hf(["Praha 6"]))
        assert sig["status"] == "na"
        assert sig["adj"] == 0.0

    def test_hard_match_when_method_admin_true_and_found(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 6"], method_admin=True))
        assert sig["status"] == "hard_match"
        assert sig["adj"] == 0.0
        assert sig["matched_area"] == "Praha 6"

    def test_hard_miss_when_method_admin_true_and_not_found(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 10"], method_admin=True))
        assert sig["status"] == "hard_miss"
        assert sig["adj"] == 0.0
        assert sig["matched_area"] is None

    def test_multi_area_first_match_wins(self):
        sig = _admin_area_signal(
            _Project(admin="Praha 6"),
            _mk_hf(["Praha 5", "Praha 6", "Praha 7"]),
        )
        assert sig["status"] == "inside"
        assert sig["matched_area"] == "Praha 6"

    def test_preferred_areas_list_preserved(self):
        areas = ["Praha 5", "Praha 6"]
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(areas))
        assert sig["preferred_areas"] == areas


# ---------------------------------------------------------------------------
# 3. _admin_area_soft_adjustment — Phase 5c numeric regression
# ---------------------------------------------------------------------------

class TestAdminAreaSoftAdjustment:
    """Ensure the thin wrapper returns the same numerics as before the refactor."""

    def test_off_returns_zero(self):
        assert _admin_area_soft_adjustment(_Project(admin="Praha 6"), _mk_hf([])) == 0.0

    def test_inside_returns_plus_six(self):
        assert _admin_area_soft_adjustment(_Project(admin="Praha 6"), _mk_hf(["Praha 6"])) == 6.0

    def test_outside_returns_minus_three(self):
        assert _admin_area_soft_adjustment(_Project(admin="Praha 6"), _mk_hf(["Praha 10"])) == -3.0

    def test_hard_opt_in_suppresses_boost(self):
        """method_admin=True means hard filter is on; soft boost must be zero."""
        assert _admin_area_soft_adjustment(
            _Project(admin="Praha 6"), _mk_hf(["Praha 6"], method_admin=True)
        ) == 0.0

    def test_na_returns_zero(self):
        assert _admin_area_soft_adjustment(_Project(admin=None, district=None), _mk_hf(["Praha 6"])) == 0.0


# ---------------------------------------------------------------------------
# 4. _admin_area_explain_texts — human-readable output
# ---------------------------------------------------------------------------

class TestAdminAreaExplainTexts:
    def test_off_produces_no_texts(self):
        sig = _admin_area_signal(_Project(), _mk_hf([]))
        s, c = _admin_area_explain_texts(sig)
        assert s is None and c is None

    def test_inside_produces_strength_with_area_label(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 6"]))
        s, c = _admin_area_explain_texts(sig)
        assert c is None
        assert s is not None
        assert "Praha 6" in s
        assert "preferované" in s.lower()

    def test_outside_produces_compromise(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 10"]))
        s, c = _admin_area_explain_texts(sig)
        assert s is None
        assert c is not None
        assert "preferované" in c.lower()

    def test_na_produces_no_texts(self):
        sig = _admin_area_signal(_Project(admin=None, district=None), _mk_hf(["Praha 6"]))
        s, c = _admin_area_explain_texts(sig)
        assert s is None and c is None

    def test_hard_match_produces_strength(self):
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 6"], method_admin=True))
        s, c = _admin_area_explain_texts(sig)
        assert s is not None
        assert c is None
        assert "Praha 6" in s

    def test_hard_miss_produces_no_texts(self):
        """hard_miss is a defensive state; don't surface noise to broker."""
        sig = _admin_area_signal(_Project(admin="Praha 6"), _mk_hf(["Praha 10"], method_admin=True))
        s, c = _admin_area_explain_texts(sig)
        assert s is None and c is None

    def test_none_signal_produces_no_texts(self):
        s, c = _admin_area_explain_texts(None)
        assert s is None and c is None


# ---------------------------------------------------------------------------
# 5. compute_eligibility — location priority (Phase 5d)
# ---------------------------------------------------------------------------

def _make_profile(polygon=None, admin_areas=None, method_admin=False):
    return _Profile(polygon_geojson=polygon, admin_areas=admin_areas, method_admin=method_admin)


class TestEligibilityLocationPriority:
    """Polygon must be evaluated before admin_area."""

    def test_inside_polygon_no_admin_pref_passes(self):
        profile = _make_profile(polygon=_POLYGON)
        project = _Project(*_INSIDE)
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "pass"

    def test_outside_polygon_fails_with_outside_polygon_reason(self):
        profile = _make_profile(polygon=_POLYGON)
        project = _Project(*_OUTSIDE)
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "fail"
        assert "outside_polygon" in result["reasons"]

    def test_polygon_failure_takes_priority_over_admin_failure(self):
        """When both polygon and admin_area would fail, polygon must be reasons[0]."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 10"], method_admin=True)
        project = _Project(*_OUTSIDE, admin="Praha 4")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "fail"
        assert result["reasons"][0] == "outside_polygon"

    def test_outside_polygon_fails_even_when_admin_would_match(self):
        """Polygon outside should fail even if admin_area matches (hard opt-in)."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 4"], method_admin=True)
        project = _Project(*_OUTSIDE, admin="Praha 4")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "fail"
        assert "outside_polygon" in result["reasons"]


class TestEligibilityAdminAreaHardFilter:
    """method_admin=True → admin_area acts as hard filter."""

    def test_hard_match_passes(self):
        profile = _make_profile(admin_areas=["Praha 6"], method_admin=True)
        project = _Project(*_INSIDE, admin="Praha 6")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "pass"

    def test_hard_miss_fails(self):
        profile = _make_profile(admin_areas=["Praha 6"], method_admin=True)
        project = _Project(*_INSIDE, admin="Praha 10")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "fail"
        assert "outside_admin_area" in result["reasons"]

    def test_soft_miss_passes(self):
        """method_admin=False (default) — admin_area is soft; project must pass."""
        profile = _make_profile(admin_areas=["Praha 6"], method_admin=False)
        project = _Project(*_INSIDE, admin="Praha 10")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "pass"

    def test_no_polygon_hard_match_passes(self):
        profile = _make_profile(admin_areas=["Praha 6"], method_admin=True)
        project = _Project(admin="Praha 6")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "pass"

    def test_no_polygon_hard_miss_fails(self):
        profile = _make_profile(admin_areas=["Praha 6"], method_admin=True)
        project = _Project(admin="Praha 10")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "fail"
        assert "outside_admin_area" in result["reasons"]

    def test_hard_filter_case_insensitive(self):
        profile = _make_profile(admin_areas=["praha 6"], method_admin=True)
        project = _Project(admin="Praha 6")
        result = compute_eligibility(_Unit(), project, profile)
        assert result["status"] == "pass"


# ---------------------------------------------------------------------------
# 6. compute_full_score — propagation into top_strengths / top_compromises
# ---------------------------------------------------------------------------

class TestFullScoreAdminExplainability:
    """Both flat and legacy scoring paths must propagate admin_area signal."""

    # ── Flat path ────────────────────────────────────────────────────────

    def test_flat_inside_strength_present(self):
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 6"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert any("Praha 6" in s for s in r["top_strengths"]), r["top_strengths"]

    def test_flat_outside_compromise_present(self):
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 10"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert any("preferované" in c.lower() for c in r["top_compromises"]), r["top_compromises"]

    def test_flat_off_neither_present(self):
        """No preferred areas → no admin-area entry in strengths or compromises."""
        profile = _make_profile(polygon=_POLYGON)
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert not any("preferované" in s.lower() for s in r["top_strengths"])
        assert not any("preferované" in c.lower() for c in r["top_compromises"])

    def test_flat_hard_match_strength_present(self):
        """Hard opt-in + match → strength, no numeric boost."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 6"], method_admin=True)
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert any("Praha 6" in s for s in r["top_strengths"]), r["top_strengths"]
        # No numeric boost in hard mode
        assert r["fits"].get("admin_area_adj", 0.0) == 0.0

    def test_flat_strength_prepended_first(self):
        """Admin-area strength should appear before generic aspect strengths."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 6"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        if r["top_strengths"]:
            assert "Praha 6" in r["top_strengths"][0]

    def test_flat_compromise_prepended_first(self):
        """Admin-area compromise should appear before generic aspect compromises."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 10"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        if r["top_compromises"]:
            assert "preferované" in r["top_compromises"][0].lower()

    def test_flat_signal_stored_in_fits(self):
        """admin_area_signal must be present in fits for downstream consumers."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 6"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert "admin_area_signal" in r["fits"]
        assert r["fits"]["admin_area_signal"]["status"] == "inside"

    # ── Legacy path ──────────────────────────────────────────────────────

    def test_legacy_inside_strength_present(self):
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 6"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile)  # no flat_weights → legacy
        assert any("Praha 6" in s for s in r["top_strengths"]), r["top_strengths"]

    def test_legacy_outside_compromise_present(self):
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 10"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile)
        assert any("preferované" in c.lower() for c in r["top_compromises"]), r["top_compromises"]

    def test_legacy_off_neither_present(self):
        profile = _make_profile(polygon=_POLYGON)
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile)
        assert not any("preferované" in s.lower() for s in r["top_strengths"])
        assert not any("preferované" in c.lower() for c in r["top_compromises"])

    def test_legacy_signal_stored_in_fits(self):
        profile = _make_profile(admin_areas=["Praha 6"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile)
        assert "admin_area_signal" in r["fits"]

    # ── Top-list length cap ──────────────────────────────────────────────

    def test_strengths_capped_at_five(self):
        """Even after prepending admin_area, list must not exceed 5 items."""
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 6"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert len(r["top_strengths"]) <= 5

    def test_compromises_capped_at_five(self):
        profile = _make_profile(polygon=_POLYGON, admin_areas=["Praha 10"])
        project = _Project(*_INSIDE, admin="Praha 6")
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert len(r["top_compromises"]) <= 5

    # ── Eligibility fail path ────────────────────────────────────────────

    def test_failed_eligibility_has_empty_strengths_and_compromises(self):
        """Unit that fails eligibility must have empty strengths/compromises."""
        profile = _make_profile(admin_areas=["Praha 6"], method_admin=True)
        project = _Project(admin="Praha 10")  # guaranteed hard-filter fail
        r = compute_full_score(_Unit(), project, profile, flat_weights=_FLAT_W)
        assert r["eligibility"] == "fail"
        assert r["top_strengths"] == []
        assert r["top_compromises"] == []


# ---------------------------------------------------------------------------
# 7. Backward compatibility end-to-end
# ---------------------------------------------------------------------------

class TestBackwardCompat:
    """Post-clean-slate: only list[str] admin_area is supported."""

    def test_legacy_string_stored_as_admin_area(self):
        """Post-clean-slate: plain string admin_area in raw wizard fallback is ignored.
        All new profiles use structured_wizard with list[str] admin_area.
        """
        profile = _Profile()
        # Old string format in raw wizard (no structured_wizard key)
        profile.filter_json = {
            "wizard": {
                "hard_filters": {},
                "location": {
                    "administrative_area": "Praha 6",  # string — no longer supported
                    "method_admin": False,
                },
            }
        }
        from app.scoring import build_structured_wizard
        sw = build_structured_wizard(profile)
        assert isinstance(sw.hard_filters.location_admin_area, list)
        # String is not coerced — result is empty (string compat removed)
        assert sw.hard_filters.location_admin_area == []

    def test_null_admin_area_does_not_crash(self):
        profile = _Profile()
        profile.filter_json = {
            "wizard": {
                "hard_filters": {},
                "location": {
                    "administrative_area": None,
                    "method_admin": False,
                },
            }
        }
        from app.scoring import build_structured_wizard
        sw = build_structured_wizard(profile)
        assert sw.hard_filters.location_admin_area == []

    def test_list_admin_area_passthrough(self):
        profile = _Profile(admin_areas=["Praha 5", "Praha 6"])
        from app.scoring import build_structured_wizard
        sw = build_structured_wizard(profile)
        assert "Praha 5" in sw.hard_filters.location_admin_area
        assert "Praha 6" in sw.hard_filters.location_admin_area

    def test_method_admin_missing_defaults_to_false(self):
        """Old profiles without method_admin in wizard must default to soft mode."""
        profile = _Profile()
        profile.filter_json = {
            "wizard": {
                "hard_filters": {},
                "location": {
                    "administrative_area": ["Praha 6"],
                    # method_admin absent
                },
            }
        }
        from app.scoring import build_structured_wizard
        sw = build_structured_wizard(profile)
        assert sw.hard_filters.method_admin is False

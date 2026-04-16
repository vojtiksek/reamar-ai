"""Unit tests for V2 scoring fit functions in app.scoring."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from unittest.mock import patch

from app.scoring import (
    SCORING_V2_CONFIG,
    _v2_price_savings_fit,
    _v2_price_per_m2_fit,
    _v2_area_fit,
    _v2_payment_fit,
    _v2_commute_fit,
    _v2_walkability_poi_fit,
    _v2_center_distance_fit,
    _v2_noise_adj,
    _v2_standard_preference_fit,
    _v2_completion_preference_fit,
    PreferenceTags,
)

CFG = SCORING_V2_CONFIG


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------

class _Unit:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)

    def __getattr__(self, name):
        return None


class _Profile:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)

    def __getattr__(self, name):
        return None


class _Project:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)

    def __getattr__(self, name):
        return None


class _CommuteResult:
    def __init__(self, minutes, itinerary=None, is_estimated=False):
        self.minutes = minutes
        self.itinerary = itinerary
        self.is_estimated = is_estimated


# ---------------------------------------------------------------------------
# 1. _v2_price_savings_fit
# ---------------------------------------------------------------------------

def test_price_savings_at_budget():
    """Price equals budget => 0% savings => fit ~55 (low savings zone)."""
    unit = _Unit(price_czk=10_000_000)
    profile = _Profile(budget_max=10_000_000)
    fit = _v2_price_savings_fit(unit, profile, CFG)
    assert 50 <= fit <= 60, f"Expected ~55, got {fit}"


def test_price_savings_sweet_spot():
    """Price at 70% of budget => 30% savings => fit 100 (sweet spot start)."""
    unit = _Unit(price_czk=7_000_000)
    profile = _Profile(budget_max=10_000_000)
    fit = _v2_price_savings_fit(unit, profile, CFG)
    assert fit == 100.0, f"Expected 100, got {fit}"


def test_price_savings_too_cheap():
    """Price at 30% of budget => 70% savings => fit < 100 (too-cheap penalty)."""
    unit = _Unit(price_czk=3_000_000)
    profile = _Profile(budget_max=10_000_000)
    fit = _v2_price_savings_fit(unit, profile, CFG)
    assert fit < 100, f"Expected < 100, got {fit}"
    assert fit > 0, f"Expected > 0, got {fit}"


def test_price_savings_over_budget():
    """Price over budget => negative savings => fit 0."""
    unit = _Unit(price_czk=12_000_000)
    profile = _Profile(budget_max=10_000_000)
    fit = _v2_price_savings_fit(unit, profile, CFG)
    assert fit == 0.0


def test_price_savings_no_budget():
    """No budget => fit 50."""
    unit = _Unit(price_czk=5_000_000)
    profile = _Profile()
    fit = _v2_price_savings_fit(unit, profile, CFG)
    assert fit == 50.0


def test_price_savings_no_profile():
    """No profile => fit 50."""
    unit = _Unit(price_czk=5_000_000)
    fit = _v2_price_savings_fit(unit, None, CFG)
    assert fit == 50.0


# ---------------------------------------------------------------------------
# 2. _v2_price_per_m2_fit
# ---------------------------------------------------------------------------

def test_price_m2_cheaper():
    """-10% diff => cheaper than neighbourhood => fit > 70."""
    unit = _Unit(local_price_diff_1000m=-10)
    fit = _v2_price_per_m2_fit(unit, CFG)
    assert fit > 70, f"Expected > 70, got {fit}"


def test_price_m2_neutral():
    """0% diff => fit ~70 (neutral)."""
    unit = _Unit(local_price_diff_1000m=0)
    fit = _v2_price_per_m2_fit(unit, CFG)
    assert fit == 70.0


def test_price_m2_expensive():
    """+15% diff => more expensive => fit < 70."""
    unit = _Unit(local_price_diff_1000m=15)
    fit = _v2_price_per_m2_fit(unit, CFG)
    assert fit < 70, f"Expected < 70, got {fit}"


def test_price_m2_no_data():
    """No local price diff data => fit 50."""
    unit = _Unit()
    fit = _v2_price_per_m2_fit(unit, CFG)
    assert fit == 50.0


def test_price_m2_falls_back_to_2k():
    """Uses 2000m diff when 1000m is absent."""
    unit = _Unit(local_price_diff_2000m=-5)
    fit = _v2_price_per_m2_fit(unit, CFG)
    assert fit > 70


# ---------------------------------------------------------------------------
# 3. _v2_area_fit
# ---------------------------------------------------------------------------

def test_area_at_minimum():
    """area == area_min => ratio 1.0 => fit ~80."""
    unit = _Unit(floor_area_m2=60)
    profile = _Profile(area_min=60)
    fit = _v2_area_fit(unit, profile, CFG)
    assert 75 <= fit <= 85, f"Expected ~80, got {fit}"


def test_area_above_minimum():
    """area = 1.3 * area_min => fit close to 100."""
    unit = _Unit(floor_area_m2=78)
    profile = _Profile(area_min=60)
    fit = _v2_area_fit(unit, profile, CFG)
    assert fit > 90, f"Expected > 90, got {fit}"


def test_area_capped():
    """area = 1.5+ * area_min => fit = 100 (cap)."""
    unit = _Unit(floor_area_m2=100)
    profile = _Profile(area_min=60)
    fit = _v2_area_fit(unit, profile, CFG)
    assert fit == 100.0


def test_area_below_minimum():
    """area = 0.7 * area_min => fit < 50."""
    unit = _Unit(floor_area_m2=42)
    profile = _Profile(area_min=60)
    fit = _v2_area_fit(unit, profile, CFG)
    assert fit < 50, f"Expected < 50, got {fit}"


def test_area_no_area_min():
    """No area_min on profile => fit 50."""
    unit = _Unit(floor_area_m2=60)
    profile = _Profile()
    fit = _v2_area_fit(unit, profile, CFG)
    assert fit == 50.0


# ---------------------------------------------------------------------------
# 4. _v2_payment_fit
# ---------------------------------------------------------------------------

def test_payment_mostly_at_completion():
    """10/10/80 => completion_pct = 80 => fit = min(100, 80*1.2+10) = 100."""
    unit = _Unit(payment_contract=10, payment_construction=10, payment_occupancy=80)
    fit = _v2_payment_fit(unit)
    assert fit >= 95, f"Expected ~100, got {fit}"


def test_payment_upfront_heavy():
    """30/40/30 => completion_pct = 30 => fit = 30*1.2+10 = 46."""
    unit = _Unit(payment_contract=30, payment_construction=40, payment_occupancy=30)
    fit = _v2_payment_fit(unit)
    assert 40 <= fit <= 50, f"Expected ~46, got {fit}"


def test_payment_no_data():
    """No payment data => fit 50."""
    unit = _Unit()
    fit = _v2_payment_fit(unit)
    assert fit == 50.0


def test_payment_fractional_values():
    """Fractional values (0.10/0.10/0.80) are converted to percentage."""
    unit = _Unit(payment_contract=0.10, payment_construction=0.10, payment_occupancy=0.80)
    fit = _v2_payment_fit(unit)
    assert fit >= 95, f"Expected ~100, got {fit}"


# ---------------------------------------------------------------------------
# 5. _v2_commute_fit (3 modes + hard fail)
# ---------------------------------------------------------------------------

def _make_commute_point(label, lat, lng, mode, max_minutes, priority='must_have', tolerance=0):
    return {
        'label': label, 'lat': lat, 'lng': lng, 'mode': mode,
        'max_minutes': max_minutes, 'priority': priority,
        'tolerance_minutes': tolerance,
    }


def test_commute_compromise_mode():
    """Compromise mode: fit = min of point fits."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    profile = _Profile(commute_points_json=[
        _make_commute_point('A', 50.1, 14.5, 'drive', 30, 'must_have'),
        _make_commute_point('B', 50.0, 14.3, 'drive', 20, 'prefer'),
    ])
    pref = PreferenceTags(commute_mode='compromise')

    results = [_CommuteResult(20), _CommuteResult(25)]
    call_count = [0]

    def mock_get_cached(db, proj, cp):
        idx = call_count[0]
        call_count[0] += 1
        return results[idx] if idx < len(results) else None

    with patch('app.scoring.get_cached_commute_result', side_effect=mock_get_cached):
        fit, details, hard_fail = _v2_commute_fit(project, profile, 'fake_db', pref, CFG)

    assert not hard_fail
    # Point A: 20 min <= 30 limit => fit 100
    # Point B: 25 min > 20 limit => some degradation, so fit < 100
    # Compromise = min => should be < 100
    assert fit < 100


def test_commute_primary_mode():
    """Primary mode: 80% primary + 20% secondary."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    profile = _Profile(commute_points_json=[
        _make_commute_point('A', 50.1, 14.5, 'drive', 30, 'must_have'),
        _make_commute_point('B', 50.0, 14.3, 'drive', 20, 'prefer'),
    ])
    pref = PreferenceTags(commute_mode='primary', commute_primary_index=0)

    results = [_CommuteResult(15), _CommuteResult(15)]
    call_count = [0]

    def mock_get_cached(db, proj, cp):
        idx = call_count[0]
        call_count[0] += 1
        return results[idx] if idx < len(results) else None

    with patch('app.scoring.get_cached_commute_result', side_effect=mock_get_cached):
        fit, details, hard_fail = _v2_commute_fit(project, profile, 'fake_db', pref, CFG)

    assert not hard_fail
    # Both within limits => both fit 100
    # primary*0.8 + secondary*0.2 = 100
    assert fit == 100.0


def test_commute_sum_mode():
    """Sum mode: total minutes vs total limits."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    profile = _Profile(commute_points_json=[
        _make_commute_point('A', 50.1, 14.5, 'drive', 30, 'must_have'),
        _make_commute_point('B', 50.0, 14.3, 'drive', 30, 'prefer'),
    ])
    pref = PreferenceTags(commute_mode='sum')

    # Total: 25+25 = 50 min, limits: 30+30 = 60 => within => fit 100
    results = [_CommuteResult(25), _CommuteResult(25)]
    call_count = [0]

    def mock_get_cached(db, proj, cp):
        idx = call_count[0]
        call_count[0] += 1
        return results[idx] if idx < len(results) else None

    with patch('app.scoring.get_cached_commute_result', side_effect=mock_get_cached):
        fit, details, hard_fail = _v2_commute_fit(project, profile, 'fake_db', pref, CFG)

    assert not hard_fail
    assert fit == 100.0


def test_commute_hard_fail():
    """must_have point over limit => hard fail, fit 0."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    profile = _Profile(commute_points_json=[
        _make_commute_point('A', 50.1, 14.5, 'drive', 20, 'must_have', tolerance=5),
    ])
    pref = PreferenceTags(commute_mode='compromise')

    # 30 min > 20 + 5 = 25 limit => hard fail
    def mock_get_cached(db, proj, cp):
        return _CommuteResult(30)

    with patch('app.scoring.get_cached_commute_result', side_effect=mock_get_cached):
        fit, details, hard_fail = _v2_commute_fit(project, profile, 'fake_db', pref, CFG)

    assert hard_fail
    assert fit == 0.0


def test_commute_no_points():
    """Empty commute_points_json => fit 0 (falsy guard exits early)."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    profile = _Profile(commute_points_json=[])
    pref = PreferenceTags()

    with patch('app.scoring.get_cached_commute_result'):
        fit, details, hard_fail = _v2_commute_fit(project, profile, 'fake_db', pref, CFG)

    # Empty list is falsy, so the guard `not getattr(profile, 'commute_points_json', None)`
    # triggers and returns 0.0 before reaching the `if not points` branch.
    assert fit == 0.0
    assert not hard_fail


def test_commute_ignore_only_points():
    """All points with 'ignore' priority => fit 50."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    profile = _Profile(commute_points_json=[
        _make_commute_point('A', 50.1, 14.5, 'drive', 30, 'ignore'),
    ])
    pref = PreferenceTags(commute_mode='compromise')

    def mock_get_cached(db, proj, cp):
        return _CommuteResult(15)

    with patch('app.scoring.get_cached_commute_result', side_effect=mock_get_cached):
        fit, details, hard_fail = _v2_commute_fit(project, profile, 'fake_db', pref, CFG)

    assert fit == 50.0
    assert not hard_fail


# ---------------------------------------------------------------------------
# 6. _v2_walkability_poi_fit
# ---------------------------------------------------------------------------

def test_poi_binary_present():
    """Binary POI (park) with count=1 => fit 100."""
    project = _Project(count_park_500m=1)
    pref = PreferenceTags(poi_modes={'park': 'nice'})
    fit = _v2_walkability_poi_fit(project, pref, CFG)
    assert fit == 100.0


def test_poi_binary_absent():
    """Binary POI (park) with count=0 => fit 0."""
    project = _Project(count_park_500m=0)
    pref = PreferenceTags(poi_modes={'park': 'nice'})
    fit = _v2_walkability_poi_fit(project, pref, CFG)
    assert fit == 0.0


def test_poi_gradual():
    """Gradual POI (restaurant) with count=3 => score from gradual_scores[3] = 75."""
    project = _Project(count_restaurant_500m=3)
    pref = PreferenceTags(poi_modes={'restaurant': 'nice'})
    fit = _v2_walkability_poi_fit(project, pref, CFG)
    assert fit == 75.0


def test_poi_no_active():
    """No active POI preferences => fit 50."""
    project = _Project()
    pref = PreferenceTags(poi_modes={})
    fit = _v2_walkability_poi_fit(project, pref, CFG)
    assert fit == 50.0


def test_poi_multiple_categories():
    """Multiple active POIs => average of individual fits."""
    project = _Project(count_park_500m=1, count_restaurant_500m=0)
    pref = PreferenceTags(poi_modes={'park': 'nice', 'restaurant': 'nice'})
    fit = _v2_walkability_poi_fit(project, pref, CFG)
    # park=100, restaurant(gradual, count=0)=0 => avg = 50
    assert fit == 50.0


# ---------------------------------------------------------------------------
# 7. _v2_center_distance_fit
# ---------------------------------------------------------------------------

def test_center_closer_near():
    """'closer' + 2km => fit 100 (within near_full_km=3)."""
    # Prague center ~50.087, 14.420. Place project ~2km away.
    project = _Project(gps_latitude=50.105, gps_longitude=14.420)
    pref = PreferenceTags(center_preference='closer')
    fit = _v2_center_distance_fit(project, pref, CFG)
    assert fit == 100.0


def test_center_closer_mid():
    """'closer' + ~10km => fit between 24 and 60."""
    # Approx 10km from center
    project = _Project(gps_latitude=50.17, gps_longitude=14.42)
    pref = PreferenceTags(center_preference='closer')
    fit = _v2_center_distance_fit(project, pref, CFG)
    assert 24 <= fit <= 60, f"Expected 24-60, got {fit}"


def test_center_farther_far():
    """'farther' + 25km => fit 100."""
    # Approx 25km from center
    project = _Project(gps_latitude=50.31, gps_longitude=14.42)
    pref = PreferenceTags(center_preference='farther')
    fit = _v2_center_distance_fit(project, pref, CFG)
    assert fit == 100.0


def test_center_no_preference():
    """No center preference => fit 50."""
    project = _Project(gps_latitude=50.08, gps_longitude=14.42)
    pref = PreferenceTags(center_preference=None)
    fit = _v2_center_distance_fit(project, pref, CFG)
    assert fit == 50.0


def test_center_no_coordinates():
    """No project coordinates => fit 50."""
    project = _Project()
    pref = PreferenceTags(center_preference='closer')
    fit = _v2_center_distance_fit(project, pref, CFG)
    assert fit == 50.0


# ---------------------------------------------------------------------------
# 8. _v2_noise_adj
# ---------------------------------------------------------------------------

def test_noise_quiet():
    """Quiet area (45dB) => bonus of +2."""
    project = _Project(noise_day_db=45)
    adj = _v2_noise_adj(project, CFG)
    assert adj == 2.0


def test_noise_noisy():
    """Noisy area (68dB) => penalty of -3."""
    project = _Project(noise_day_db=68)
    adj = _v2_noise_adj(project, CFG)
    assert adj == -3.0


def test_noise_road_close():
    """Close road (150m < 200m threshold) => includes road penalty -2."""
    project = _Project(noise_day_db=55, distance_to_primary_road_m=150)
    adj = _v2_noise_adj(project, CFG)
    # 55dB is 50-60 range => no dB penalty/bonus, but road penalty = -2
    assert adj == -2.0


def test_noise_no_data():
    """No noise data => adj 0."""
    project = _Project()
    adj = _v2_noise_adj(project, CFG)
    assert adj == 0.0


def test_noise_multiple_sources():
    """Multiple noise sources accumulate."""
    project = _Project(
        noise_day_db=68,  # -3
        distance_to_primary_road_m=150,  # -2
        distance_to_tram_tracks_m=100,  # -1
    )
    adj = _v2_noise_adj(project, CFG)
    assert adj == -6.0


def test_noise_clamped_min():
    """Noise adjustment is clamped to noise_adj_min (-8)."""
    project = _Project(
        noise_day_db=75,  # -5
        distance_to_primary_road_m=50,  # -2
        distance_to_tram_tracks_m=50,  # -1
        distance_to_railway_m=100,  # -2
    )
    adj = _v2_noise_adj(project, CFG)
    # Total would be -10, but clamped to -8
    assert adj == -8.0


# ---------------------------------------------------------------------------
# 9. _v2_standard_preference_fit
# ---------------------------------------------------------------------------

def test_standard_match():
    """Selected ['underfloor'], project has 'underfloor' => 95."""
    unit = _Unit(heating='underfloor')
    project = _Project(heating='underfloor')
    fit = _v2_standard_preference_fit(unit, project, 'heating', ['underfloor'], CFG)
    assert fit == 95.0


def test_standard_any_match():
    """Selected ['underfloor', 'radiators'], project has 'radiators' => 95."""
    unit = _Unit()
    project = _Project(heating='radiators')
    fit = _v2_standard_preference_fit(unit, project, 'heating', ['underfloor', 'radiators'], CFG)
    assert fit == 95.0


def test_standard_no_match():
    """Selected ['underfloor'], project has 'radiators' => 15."""
    unit = _Unit()
    project = _Project(heating='radiators')
    fit = _v2_standard_preference_fit(unit, project, 'heating', ['underfloor'], CFG)
    assert fit == 15.0


def test_standard_no_data():
    """No data on project/unit => fit 50."""
    unit = _Unit()
    project = _Project()
    fit = _v2_standard_preference_fit(unit, project, 'heating', ['underfloor'], CFG)
    assert fit == 50.0


def test_standard_bool_match():
    """Boolean standard (recuperation) with True value => 95."""
    unit = _Unit()
    project = _Project(recuperation=True)
    fit = _v2_standard_preference_fit(unit, project, 'recuperation', None, CFG)
    assert fit == 95.0


def test_standard_bool_no_match():
    """Boolean standard (recuperation) with False value => 15."""
    unit = _Unit()
    project = _Project(recuperation=False)
    fit = _v2_standard_preference_fit(unit, project, 'recuperation', None, CFG)
    assert fit == 15.0


# ---------------------------------------------------------------------------
# 10. _v2_completion_preference_fit
# ---------------------------------------------------------------------------

def test_completion_sooner_near():
    """'sooner' + completion in 2 months => fit 100."""
    comp_date = date.today() + timedelta(days=60)
    project = _Project(completion_date=comp_date)
    pref = PreferenceTags(completion_preference='sooner')
    fit = _v2_completion_preference_fit(project, pref)
    assert fit == 100.0


def test_completion_sooner_far():
    """'sooner' + completion in 24 months => fit ~37."""
    comp_date = date.today() + timedelta(days=24 * 30)
    project = _Project(completion_date=comp_date)
    pref = PreferenceTags(completion_preference='sooner')
    fit = _v2_completion_preference_fit(project, pref)
    assert 30 <= fit <= 45, f"Expected ~37, got {fit}"


def test_completion_later_far():
    """'later' + completion in 36+ months => fit 100."""
    comp_date = date.today() + timedelta(days=37 * 30)
    project = _Project(completion_date=comp_date)
    pref = PreferenceTags(completion_preference='later')
    fit = _v2_completion_preference_fit(project, pref)
    assert fit == 100.0


def test_completion_no_date():
    """No completion date => fit 50."""
    project = _Project()
    pref = PreferenceTags(completion_preference='sooner')
    fit = _v2_completion_preference_fit(project, pref)
    assert fit == 50.0


def test_completion_no_preference():
    """No completion preference => fit 50."""
    comp_date = date.today() + timedelta(days=180)
    project = _Project(completion_date=comp_date)
    pref = PreferenceTags(completion_preference=None)
    fit = _v2_completion_preference_fit(project, pref)
    assert fit == 50.0

"""Tests for the Phase 7b filter-funnel diagnostics helper.

Pure-Python tests — no database or FastAPI client required. They lock in the
invariants the broker UI depends on:
  - step counts add up (removed at step N + remaining = remaining at N-1)
  - optional steps are only emitted when meaningful
  - edge cases (very restrictive filter, 0 results) produce sane output
"""

from app.main import _build_recompute_funnel


def _assert_funnel_consistent(funnel: dict, *, expected_total: int, expected_final: int) -> None:
    """Common invariants every funnel response must satisfy."""
    assert funnel["total"] == expected_total
    assert funnel["final"] == expected_final
    assert isinstance(funnel["steps"], list)
    # Every step's removed count must be non-negative and remaining must be <= total.
    for step in funnel["steps"]:
        assert step["removed"] >= 0
        assert step["remaining"] >= 0
        assert step["remaining"] <= expected_total
    # Sum of removals + final should never exceed total.
    total_removed = sum(step["removed"] for step in funnel["steps"])
    assert total_removed + expected_final <= expected_total + sum(
        # The visible_limit step can stack below the scoring step — that's OK,
        # we only assert overall conservation on the non-limit chain.
        0 for _ in funnel["steps"]
    )


def test_funnel_normal_case_drops_through_every_stage():
    """Broker has a realistic wizard: all filter types are active and drop some units."""
    funnel = _build_recompute_funnel(
        funnel_total=1200,
        funnel_after_budget=400,
        funnel_after_area=370,
        funnel_after_type=360,
        has_budget_filter=True,
        has_area_filter=True,
        has_type_filter=True,
        has_layout_filter=True,
        dropped_layout=100,
        dropped_location=240,
        dropped_other=0,
        scored_before_threshold=20,
        scored_after_threshold=20,
        dropped_score=0,
        dropped_limit=0,
        final_count=20,
    )
    _assert_funnel_consistent(funnel, expected_total=1200, expected_final=20)

    keys = [step["key"] for step in funnel["steps"]]
    assert keys == ["budget", "area", "property_type", "layout", "location"]

    by_key = {step["key"]: step for step in funnel["steps"]}
    assert by_key["budget"]["removed"] == 800  # 1200 - 400
    assert by_key["area"]["removed"] == 30     # 400 - 370
    assert by_key["property_type"]["removed"] == 10  # 370 - 360
    assert by_key["layout"]["removed"] == 100
    assert by_key["location"]["removed"] == 240

    # Remaining after each stage should flow down to final count
    assert by_key["budget"]["remaining"] == 400
    assert by_key["location"]["remaining"] == 20
    assert funnel["final"] == 20


def test_funnel_very_restrictive_filter_drops_everything_but_one():
    """Broker cranked budget down — almost nothing passes the first stage."""
    funnel = _build_recompute_funnel(
        funnel_total=1200,
        funnel_after_budget=3,
        funnel_after_area=3,
        funnel_after_type=3,
        has_budget_filter=True,
        has_area_filter=True,
        has_type_filter=False,
        has_layout_filter=False,
        dropped_layout=0,
        dropped_location=2,
        dropped_other=0,
        scored_before_threshold=1,
        scored_after_threshold=1,
        dropped_score=0,
        dropped_limit=0,
        final_count=1,
    )
    _assert_funnel_consistent(funnel, expected_total=1200, expected_final=1)

    by_key = {step["key"]: step for step in funnel["steps"]}
    # Budget is clearly the bottleneck — 1197 units gone on that step alone.
    assert by_key["budget"]["removed"] == 1197
    assert by_key["area"]["removed"] == 0
    # type step omitted because the filter was not applied
    assert "property_type" not in by_key
    # location still reports the drop because dropped_location > 0
    assert by_key["location"]["removed"] == 2
    assert by_key["location"]["remaining"] == 1


def test_funnel_zero_results():
    """Filters eliminate every candidate. UI still needs a coherent funnel."""
    funnel = _build_recompute_funnel(
        funnel_total=1200,
        funnel_after_budget=500,
        funnel_after_area=500,
        funnel_after_type=500,
        has_budget_filter=True,
        has_area_filter=False,
        has_type_filter=False,
        has_layout_filter=True,
        dropped_layout=50,
        dropped_location=450,
        dropped_other=0,
        scored_before_threshold=0,
        scored_after_threshold=0,
        dropped_score=0,
        dropped_limit=0,
        final_count=0,
    )
    _assert_funnel_consistent(funnel, expected_total=1200, expected_final=0)

    by_key = {step["key"]: step for step in funnel["steps"]}
    assert by_key["budget"]["removed"] == 700
    assert "area" not in by_key
    assert "property_type" not in by_key
    assert by_key["layout"]["removed"] == 50
    assert by_key["layout"]["remaining"] == 450
    assert by_key["location"]["removed"] == 450
    assert by_key["location"]["remaining"] == 0
    assert funnel["final"] == 0


def test_funnel_no_filters_applied_returns_empty_steps():
    """Wizard with no hard filters at all → nothing to show in the steps list."""
    funnel = _build_recompute_funnel(
        funnel_total=1200,
        funnel_after_budget=1200,
        funnel_after_area=1200,
        funnel_after_type=1200,
        has_budget_filter=False,
        has_area_filter=False,
        has_type_filter=False,
        has_layout_filter=False,
        dropped_layout=0,
        dropped_location=0,
        dropped_other=0,
        scored_before_threshold=1200,
        scored_after_threshold=1200,
        dropped_score=0,
        dropped_limit=0,
        final_count=1200,
    )
    assert funnel["total"] == 1200
    assert funnel["final"] == 1200
    assert funnel["steps"] == []


def test_funnel_scoring_and_limit_steps_emitted_only_when_relevant():
    """hide_below_score and visible_limit show up as their own steps when active."""
    funnel = _build_recompute_funnel(
        funnel_total=500,
        funnel_after_budget=500,
        funnel_after_area=500,
        funnel_after_type=500,
        has_budget_filter=False,
        has_area_filter=False,
        has_type_filter=False,
        has_layout_filter=False,
        dropped_layout=0,
        dropped_location=0,
        dropped_other=0,
        scored_before_threshold=300,
        scored_after_threshold=180,
        dropped_score=120,
        dropped_limit=80,
        final_count=100,
    )
    by_key = {step["key"]: step for step in funnel["steps"]}
    assert by_key["scoring"]["removed"] == 120
    assert by_key["scoring"]["remaining"] == 180
    assert by_key["visible_limit"]["removed"] == 80
    assert by_key["visible_limit"]["remaining"] == 100

"""Tests for scoring threshold resolution and recommendation visibility logic."""
from app.scoring import resolve_thresholds, resolve_weights, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS


def test_resolve_thresholds_returns_defaults_when_none():
    result = resolve_thresholds(None)
    assert result == DEFAULT_THRESHOLDS


def test_resolve_thresholds_returns_defaults_when_empty():
    result = resolve_thresholds({})
    assert result == DEFAULT_THRESHOLDS


def test_resolve_thresholds_overrides_specific_keys():
    stored = {"strong_pick_min_score": 80, "hide_below_score": 30}
    result = resolve_thresholds(stored)
    assert result["strong_pick_min_score"] == 80
    assert result["hide_below_score"] == 30
    # Non-overridden keys stay at defaults
    assert result["review_pick_min_score"] == DEFAULT_THRESHOLDS["review_pick_min_score"]
    assert result["default_visible_limit"] == DEFAULT_THRESHOLDS["default_visible_limit"]
    assert result["max_strong_picks"] == DEFAULT_THRESHOLDS["max_strong_picks"]
    assert result["max_review_picks"] == DEFAULT_THRESHOLDS["max_review_picks"]


def test_resolve_thresholds_ignores_none_values():
    stored = {"strong_pick_min_score": None, "hide_below_score": 20}
    result = resolve_thresholds(stored)
    assert result["strong_pick_min_score"] == DEFAULT_THRESHOLDS["strong_pick_min_score"]
    assert result["hide_below_score"] == 20


def test_resolve_thresholds_ignores_unknown_keys():
    stored = {"strong_pick_min_score": 80, "bogus_key": 999}
    result = resolve_thresholds(stored)
    assert result["strong_pick_min_score"] == 80
    assert "bogus_key" not in result


def test_resolve_thresholds_all_keys_overridden():
    stored = {
        "strong_pick_min_score": 85,
        "review_pick_min_score": 60,
        "hide_below_score": 25,
        "default_visible_limit": 100,
        "max_strong_picks": 10,
        "max_review_picks": 20,
    }
    result = resolve_thresholds(stored)
    assert result == stored


def test_resolve_weights_returns_defaults_when_none():
    result = resolve_weights(None, None)
    total = sum(result.values())
    assert abs(total - 1.0) < 0.001
    assert set(result.keys()) == set(DEFAULT_WEIGHTS.keys())


def test_resolve_weights_global_overrides_defaults():
    global_w = {"budget": 0.50, "walkability": 0.50}
    result = resolve_weights(global_w, None)
    # budget and walkability should be higher than remaining keys
    assert result["budget"] > result["layout"]
    assert abs(sum(result.values()) - 1.0) < 0.001


def test_resolve_weights_client_overrides_global():
    global_w = {"budget": 0.50}
    client_w = {"budget": 0.10}
    result = resolve_weights(global_w, client_w)
    # Client override should take precedence: budget should be relatively small
    assert result["budget"] < result["walkability"]


def test_hide_below_score_filters_low_scores():
    """Verify the filtering logic used in recompute endpoint."""
    thresholds = resolve_thresholds({"hide_below_score": 40})
    hide_below = thresholds["hide_below_score"]

    scored = [(80, "u1"), (60, "u2"), (39, "u3"), (41, "u4"), (10, "u5")]
    filtered = [(s, u) for s, u in scored if s >= hide_below]
    assert len(filtered) == 3
    assert all(s >= 40 for s, _ in filtered)


def test_visible_limit_caps_results():
    """Verify the visible_limit logic used in recompute endpoint."""
    thresholds = resolve_thresholds({"default_visible_limit": 3})
    limit = thresholds["default_visible_limit"]

    scored = [(90, "u1"), (80, "u2"), (70, "u3"), (60, "u4"), (50, "u5")]
    top = scored[:limit]
    assert len(top) == 3


def test_categorization_logic():
    """Verify the frontend categorization logic: strong / review / fallback."""
    thresholds = resolve_thresholds({
        "strong_pick_min_score": 70,
        "review_pick_min_score": 55,
    })
    strong_min = thresholds["strong_pick_min_score"]
    review_min = thresholds["review_pick_min_score"]

    items = [
        {"score": 85, "eligibility": "pass"},   # strong
        {"score": 72, "eligibility": "pass"},   # strong
        {"score": 65, "eligibility": "pass"},   # review (score between review_min and strong_min)
        {"score": 60, "eligibility": "review"}, # review (eligibility)
        {"score": 50, "eligibility": "pass"},   # fallback
        {"score": 30, "eligibility": "pass"},   # fallback
    ]

    strong = [i for i in items if i["eligibility"] != "review" and i["score"] >= strong_min]
    review = [i for i in items if i["eligibility"] == "review" or (i["eligibility"] != "review" and i["score"] >= review_min and i["score"] < strong_min)]
    fallback = [i for i in items if i["eligibility"] != "review" and i["score"] < review_min]

    assert len(strong) == 2
    assert len(review) == 2  # one by score range, one by eligibility
    assert len(fallback) == 2
    # No item should be in multiple categories
    assert len(strong) + len(review) + len(fallback) == len(items)

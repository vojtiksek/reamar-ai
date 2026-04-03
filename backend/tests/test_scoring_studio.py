"""Tests for Scoring Studio backend — resolve functions and bucket assignment."""
import pytest
import copy

from app.scoring import (
    DEFAULT_GROUPS,
    DEFAULT_FIELD_RULES,
    DEFAULT_ELIGIBILITY_RULES,
    resolve_groups,
    resolve_field_rules,
    resolve_eligibility_rules,
)


class TestResolveGroups:
    def test_defaults_when_none(self):
        result = resolve_groups(None)
        assert result == DEFAULT_GROUPS
        assert result is not DEFAULT_GROUPS

    def test_merge_override(self):
        db_config = {"finance": {"weight": 2.0}}
        result = resolve_groups(db_config)
        assert result["finance"]["weight"] == 2.0
        assert result["finance"]["label"] == "Finance"
        assert result["finance"]["enabled"] is True

    def test_add_new_group(self):
        db_config = {"custom": {"label": "Custom Group", "enabled": True, "weight": 0.5, "order": 9}}
        result = resolve_groups(db_config)
        assert "custom" in result
        assert result["custom"]["label"] == "Custom Group"
        assert len(result) == len(DEFAULT_GROUPS) + 1

    def test_does_not_mutate_defaults(self):
        original = copy.deepcopy(DEFAULT_GROUPS)
        resolve_groups({"finance": {"weight": 999}})
        assert DEFAULT_GROUPS == original


class TestResolveFieldRules:
    def test_defaults_when_none(self):
        result = resolve_field_rules(None)
        assert len(result) == len(DEFAULT_FIELD_RULES)
        keys = [r["field_key"] for r in result]
        assert "budget_fit" in keys

    def test_override_existing(self):
        db_config = [{"field_key": "budget_fit", "weight": 2.0}]
        result = resolve_field_rules(db_config)
        budget = [r for r in result if r["field_key"] == "budget_fit"][0]
        assert budget["weight"] == 2.0
        assert budget["label"] == "Rozpočet"

    def test_add_new_field(self):
        db_config = [{"field_key": "custom_field", "label": "Custom", "weight": 0.5}]
        result = resolve_field_rules(db_config)
        assert len(result) == len(DEFAULT_FIELD_RULES) + 1
        custom = [r for r in result if r["field_key"] == "custom_field"][0]
        assert custom["label"] == "Custom"

    def test_disable_field(self):
        db_config = [{"field_key": "orientation", "enabled": True, "include_in_score": True}]
        result = resolve_field_rules(db_config)
        orientation = [r for r in result if r["field_key"] == "orientation"][0]
        assert orientation["enabled"] is True
        assert orientation["include_in_score"] is True

    def test_does_not_mutate_defaults(self):
        original = copy.deepcopy(DEFAULT_FIELD_RULES)
        resolve_field_rules([{"field_key": "budget_fit", "weight": 999}])
        assert DEFAULT_FIELD_RULES == original


class TestResolveEligibilityRules:
    def test_defaults_when_none(self):
        result = resolve_eligibility_rules(None)
        assert len(result) == len(DEFAULT_ELIGIBILITY_RULES)

    def test_override_existing(self):
        db_config = [{"field": "budget", "on_fail": "review"}]
        result = resolve_eligibility_rules(db_config)
        budget = [r for r in result if r["field"] == "budget"][0]
        assert budget["on_fail"] == "review"
        assert budget["rule_type"] == "budget_range"

    def test_add_new_rule(self):
        db_config = [{"field": "custom_check", "label": "Custom", "enabled": True, "on_fail": "reject"}]
        result = resolve_eligibility_rules(db_config)
        assert len(result) == len(DEFAULT_ELIGIBILITY_RULES) + 1


class TestBucketAssignment:
    def _assign_bucket(self, score, strong_min=70, review_min=55):
        if score >= strong_min:
            return "strong"
        elif score >= review_min:
            return "review"
        else:
            return "fallback"

    def test_strong_bucket(self):
        assert self._assign_bucket(85) == "strong"

    def test_review_bucket(self):
        assert self._assign_bucket(60) == "review"

    def test_fallback_bucket(self):
        assert self._assign_bucket(40) == "fallback"

    def test_boundary_strong(self):
        assert self._assign_bucket(70) == "strong"

    def test_boundary_review(self):
        assert self._assign_bucket(55) == "review"

    def test_boundary_fallback(self):
        assert self._assign_bucket(54.9) == "fallback"

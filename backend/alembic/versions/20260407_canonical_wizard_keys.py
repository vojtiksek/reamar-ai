"""Rename old wizard JSON keys to canonical DB-aligned names.

Revision ID: 20260407_canonical_wizard_keys
Revises: 4dd0a9f71bc6
Create Date: 2026-04-07

Context
-------
Phase 2C of the consistency audit.  Several wizard preference keys were stored
in filter_json under names that differed from the underlying DB columns.  This
migration renames those keys in-place so all persisted payloads use the
canonical names that match the DB schema.

Renames applied
---------------
client_profiles.filter_json (nested under wizard.*):
  wizard.standards.rekuperace        → wizard.standards.recuperation
  wizard.standards.external_blinds   → wizard.standards.exterior_blinds
  wizard.project_amenities.courtyard → wizard.project_amenities.courtyard_garden
  wizard.house_amenities.shared_garden → wizard.house_amenities.courtyard_garden

client_profiles.broker_weight_overrides_json (top-level keys):
  blinds    → exterior_blinds
  courtyard → courtyard_garden

scoring_config.field_rules_json:
  Inspected at 2026-04-07 — no old key names found as field_key values.
  No changes applied.

Safety guarantees
-----------------
- Each UPDATE is guarded: old key must exist AND new key must NOT already exist.
  If a row already has the canonical name, it is left untouched.
- Values are copied exactly; no transformation is applied.
- The remove-old + add-new is done in a single expression so no intermediate
  state is visible.

Downgrade limitation
---------------------
Downgrade reverses the renames (canonical → old key names).  It is safe only
if no new wizard saves were made after the upgrade — those would have canonical
keys that would be renamed back.  In practice this means downgrade is a
best-effort rollback, not a guaranteed lossless operation.
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op


revision: str = "20260407_canonical_wizard_keys"
down_revision: Union[str, Sequence[str]] = "4dd0a9f71bc6"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers: rename a deeply-nested JSONB key under wizard.*
# ---------------------------------------------------------------------------
# Pattern:
#   jsonb_set(doc #- old_path, new_path, doc #> old_path)
#
# This atomically copies the value to the new path and removes the old key
# in one expression.  The WHERE clause ensures idempotency.


def _filter_json_rename(old_path: list[str], new_path: list[str]) -> tuple[str, str]:
    """Return (upgrade_sql, downgrade_sql) for a filter_json nested rename."""
    old_pg = "{" + ",".join(old_path) + "}"
    new_pg = "{" + ",".join(new_path) + "}"

    upgrade = f"""
        UPDATE client_profiles
        SET filter_json = jsonb_set(
            filter_json #- '{old_pg}',
            '{new_pg}',
            filter_json #> '{old_pg}'
        )
        WHERE filter_json #>> '{old_pg}' IS NOT NULL
          AND filter_json #>> '{new_pg}' IS NULL
    """

    downgrade = f"""
        UPDATE client_profiles
        SET filter_json = jsonb_set(
            filter_json #- '{new_pg}',
            '{old_pg}',
            filter_json #> '{new_pg}'
        )
        WHERE filter_json #>> '{new_pg}' IS NOT NULL
          AND filter_json #>> '{old_pg}' IS NULL
    """

    return upgrade.strip(), downgrade.strip()


def _overrides_rename(old_key: str, new_key: str) -> tuple[str, str]:
    """Return (upgrade_sql, downgrade_sql) for a broker_weight_overrides_json key rename."""
    upgrade = f"""
        UPDATE client_profiles
        SET broker_weight_overrides_json = jsonb_set(
            broker_weight_overrides_json - '{old_key}',
            '{{{new_key}}}',
            broker_weight_overrides_json -> '{old_key}'
        )
        WHERE broker_weight_overrides_json ? '{old_key}'
          AND NOT (broker_weight_overrides_json ? '{new_key}')
    """

    downgrade = f"""
        UPDATE client_profiles
        SET broker_weight_overrides_json = jsonb_set(
            broker_weight_overrides_json - '{new_key}',
            '{{{old_key}}}',
            broker_weight_overrides_json -> '{new_key}'
        )
        WHERE broker_weight_overrides_json ? '{new_key}'
          AND NOT (broker_weight_overrides_json ? '{old_key}')
    """

    return upgrade.strip(), downgrade.strip()


# ---------------------------------------------------------------------------
# Rename definitions
# ---------------------------------------------------------------------------

FILTER_JSON_RENAMES = [
    # (old_path, new_path)
    (["wizard", "standards", "rekuperace"],          ["wizard", "standards", "recuperation"]),
    (["wizard", "standards", "external_blinds"],     ["wizard", "standards", "exterior_blinds"]),
    (["wizard", "project_amenities", "courtyard"],   ["wizard", "project_amenities", "courtyard_garden"]),
    (["wizard", "house_amenities", "shared_garden"], ["wizard", "house_amenities", "courtyard_garden"]),
]

OVERRIDES_RENAMES = [
    # (old_key, new_key)
    ("blinds",    "exterior_blinds"),
    ("courtyard", "courtyard_garden"),
]


# ---------------------------------------------------------------------------
# Upgrade / downgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    for old_path, new_path in FILTER_JSON_RENAMES:
        sql, _ = _filter_json_rename(old_path, new_path)
        op.execute(sql)

    for old_key, new_key in OVERRIDES_RENAMES:
        sql, _ = _overrides_rename(old_key, new_key)
        op.execute(sql)


def downgrade() -> None:
    # Reverse order for clean rollback
    for old_key, new_key in reversed(OVERRIDES_RENAMES):
        _, sql = _overrides_rename(old_key, new_key)
        op.execute(sql)

    for old_path, new_path in reversed(FILTER_JSON_RENAMES):
        _, sql = _filter_json_rename(old_path, new_path)
        op.execute(sql)

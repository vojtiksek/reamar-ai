"""add_partial_indexes_for_filters_distinct

The /filters endpoint runs SELECT DISTINCT col FROM units WHERE col IS NOT
NULL for every enum filter (~10 of them). 20260429_perf_indexes covered
`layout`. Stack traces in /admin/errors show `orientation` and others still
hitting statement_timeout. Add partial indexes for every Unit string column
exposed as an enum filter so Postgres can use index-only scans.

Revision ID: 20260429_more_indexes
Revises: 20260429_perf_indexes
Create Date: 2026-04-29

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260429_more_indexes"
down_revision: Union[str, None] = "20260429_perf_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (column, index_name) — indexes built CONCURRENTLY, partial WHERE NOT NULL
# so they're tiny and ideal for SELECT DISTINCT scans.
_INDEXES = [
    ("orientation", "ix_units_orientation"),
    ("heating", "ix_units_heating"),
    ("windows", "ix_units_windows"),
    ("partition_walls", "ix_units_partition_walls"),
    ("category", "ix_units_category"),
    ("exterior_blinds", "ix_units_exterior_blinds"),
    ("overall_quality", "ix_units_overall_quality"),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for col, idx in _INDEXES:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {idx} "
                f"ON units ({col}) WHERE {col} IS NOT NULL"
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for _col, idx in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {idx}")

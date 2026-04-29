"""add_perf_indexes_units

Adds indexes that resolve the statement_timeout errors observed in
production /admin/errors:

  - SELECT DISTINCT layout FROM units WHERE layout IS NOT NULL  (/filters)
  - EXISTS (SELECT 1 FROM units WHERE project_id = ... AND availability ...)
    (/projects with unit-level filters)
  - ORDER BY price_per_m2_czk under project_id  (project list / map)

CONCURRENTLY = no exclusive lock on units (table is large, would block
inserts during index build). Each index runs in its own transaction.

Revision ID: 20260429_perf_indexes
Revises: 20260428_error_logs
Create Date: 2026-04-29

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260429_perf_indexes"
down_revision: Union[str, None] = "20260428_error_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CONCURRENTLY cannot run inside a transaction — autocommit per statement.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_layout "
            "ON units (layout) WHERE layout IS NOT NULL"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_project_id_available "
            "ON units (project_id, available)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_project_id_availability_status "
            "ON units (project_id, availability_status)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_project_id_price_per_m2 "
            "ON units (project_id, price_per_m2_czk)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_project_id_price_per_m2")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_project_id_availability_status")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_project_id_available")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_layout")

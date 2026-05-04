"""add_perf_indexes_for_project_agg_subquery

Production timing (Browser Performance API, 4. 5. 2026):

  /projects?limit=100&with_count=false                    = 14.8 s (full scan)
  /projects?limit=100&with_count=false&availability=…     =  0.5 s (filtered)

30× rozdíl mezi nefiltrovaným a filtrovaným ukazuje že
`_project_agg_subquery` (GROUP BY project_id přes všechny units) jede
sekvenční scan tabulky units (~40 k řádků), když Postgres nemá použitelný
index pro kvantifikaci available/availability_status.

Existující indexy z 20260429_perf_indexes jsou všechny composite
(project_id, X). To nepomůže pro:
  - WHERE availability_status IN (…)             — bez project_id
  - SUM(CASE WHEN available = true …)            — funkční index
  - GROUP BY project_id WHERE available = true   — partial scan

Revision ID: 20260504_perf_agg_indexes
Revises: 20260429_more_indexes
Create Date: 2026-05-04

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260504_perf_agg_indexes"
down_revision: Union[str, None] = "20260429_more_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CONCURRENTLY = bez zámku tabulky (units má desítky tisíc řádků,
    # blokovat insert během buildu by zastavilo daily import).
    with op.get_context().autocommit_block():
        # 1) Standalone availability_status — pro WHERE/SUM(CASE) bez project_id.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_availability_status "
            "ON units (availability_status)"
        )

        # 2) Partial index pro project_id WHERE available = true.
        # _project_agg_subquery dělá SUM(CASE WHEN available = true …) a
        # GROUP BY project_id. Partial index pokrývá jen ~25 % řádků
        # (10 k volných z 40 k) a je tedy malý + horký v cache.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_project_id_available_true "
            "ON units (project_id) WHERE available = true"
        )

        # 3) Partial index pro reservation count v agg subquery
        # (lower(availability_status) = 'reserved').
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_project_id_reserved "
            "ON units (project_id) WHERE lower(availability_status) = 'reserved'"
        )

        # 4) Composite (project_id, sold_date) pro recent_sold_cutoff filter
        # v `not include_archived` větvi /units list — ta dnes spouští
        # plné scan units pro každé list_units volání.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_project_id_sold_date "
            "ON units (project_id, sold_date)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_project_id_sold_date")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_project_id_reserved")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_project_id_available_true")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_availability_status")

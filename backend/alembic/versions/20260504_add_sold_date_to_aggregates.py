"""add_sold_date_to_project_aggregates

Refactor _project_agg_subquery → cached JOIN ProjectAggregates vyžaduje
sloupec sold_date v cached tabulce. Dnes ho tam ProjectAggregates nemá,
takže include_archived větev v /projects (`OR agg.sold_date >= recent_cutoff`)
musí jet přes live GROUP BY subquery — to je jeden ze zdrojů pomalých
8–15 s response time na produkci.

Po této migraci se sloupec naplní:
  - okamžitě jednorázovým backfillem (aggregates.recompute_project_aggregates
    pro všechny project_id), který spouštíme ručně bezprostředně po deployi
  - dále automaticky daily ops_runnerem v 5:00 a po každém override
    (commit 5a91f38 přidává hook)

Revision ID: 20260504_add_sold_date
Revises: 20260504_perf_agg_indexes
Create Date: 2026-05-04

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260504_add_sold_date"
down_revision: Union[str, None] = "20260504_perf_agg_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_aggregates",
        sa.Column("sold_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_aggregates", "sold_date")

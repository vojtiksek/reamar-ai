"""add_partial_index_units_on_market

Partial index covering only on-market units (available, reserved, not_seen).
This is ~27% of the table. The _market_filter_from_config() query that runs
on every recompute, recommendation list, and market-fit analysis will use
this index instead of scanning all 45K+ rows.

Revision ID: f54d0c023e9e
Revises: 964dea397da1
Create Date: 2026-04-14 08:55:53.771573

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f54d0c023e9e'
down_revision: Union[str, None] = '964dea397da1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS
            ix_units_on_market
        ON units (availability_status, last_seen, is_stale_reservation)
        WHERE lower(availability_status) IN ('available', 'reserved', 'not_seen')
    """))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_units_on_market"))

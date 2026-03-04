"""Add local price diff columns to units.

Revision ID: 20260304_local_price_diff_on_unit
Revises: 1a2b3c4d5e6f
Create Date: 2026-03-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260304_local_price_diff_on_unit"
down_revision = "1a2b3c4d5e6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "units",
        sa.Column("local_price_diff_500m", sa.Numeric(6, 2), nullable=True),
    )
    op.add_column(
        "units",
        sa.Column("local_price_diff_1000m", sa.Numeric(6, 2), nullable=True),
    )
    op.add_column(
        "units",
        sa.Column("local_price_diff_2000m", sa.Numeric(6, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("units", "local_price_diff_2000m")
    op.drop_column("units", "local_price_diff_1000m")
    op.drop_column("units", "local_price_diff_500m")


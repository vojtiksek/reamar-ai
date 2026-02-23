"""full api schema columns

Revision ID: 0004_full_api_schema
Revises: 0003_add_unit_raw_json
Create Date: 2026-02-22

Adds missing Unit columns (floors) and alters original_price* to Numeric.
No drops or renames.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_full_api_schema"
down_revision: Union[str, None] = "0003_add_unit_raw_json"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "units",
        sa.Column("floors", sa.String(length=255), nullable=True),
    )
    op.alter_column(
        "units",
        "original_price_czk",
        existing_type=sa.Integer(),
        type_=sa.Numeric(16, 4),
        existing_nullable=True,
        postgresql_using="original_price_czk::numeric(16,4)",
    )
    op.alter_column(
        "units",
        "original_price_per_m2_czk",
        existing_type=sa.Integer(),
        type_=sa.Numeric(16, 4),
        existing_nullable=True,
        postgresql_using="original_price_per_m2_czk::numeric(16,4)",
    )


def downgrade() -> None:
    op.alter_column(
        "units",
        "original_price_per_m2_czk",
        existing_type=sa.Numeric(16, 4),
        type_=sa.Integer(),
        existing_nullable=True,
        postgresql_using="round(original_price_per_m2_czk)::integer",
    )
    op.alter_column(
        "units",
        "original_price_czk",
        existing_type=sa.Numeric(16, 4),
        type_=sa.Integer(),
        existing_nullable=True,
        postgresql_using="round(original_price_czk)::integer",
    )
    op.drop_column("units", "floors")

"""Add unit_api_pending table for API conflict resolution (cena, cena_m2, stav).

Revision ID: 20260308_api_pending
Revises: 20260308_drop_by_project
Create Date: 2026-03-08

When import sends new value for price_czk, price_per_m2_czk or availability_status
that differs from current (override or unit), we store it here and let user choose.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision = "20260308_api_pending"
down_revision = "20260308_drop_by_project"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "unit_api_pending",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("field", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("unit_id", "field", name="uq_unit_api_pending_unit_field"),
    )
    op.create_index(
        "ix_unit_api_pending_unit_id",
        "unit_api_pending",
        ["unit_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_unit_api_pending_unit_id", table_name="unit_api_pending")
    op.drop_table("unit_api_pending")

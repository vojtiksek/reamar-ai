"""project aggregates cache table

Revision ID: 9a3b1a2c4d6e
Revises: e4d92e9cde75
Create Date: 2026-02-27

Adds project_aggregates table for cached per-project metrics computed from units.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9a3b1a2c4d6e"
down_revision: Union[str, None] = "e4d92e9cde75"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
  op.create_table(
      "project_aggregates",
      sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), primary_key=True, nullable=False),
      sa.Column("total_units", sa.Integer(), nullable=True),
      sa.Column("available_units", sa.Integer(), nullable=True),
      sa.Column("availability_ratio", sa.Numeric(10, 4), nullable=True),
      sa.Column("avg_price_czk", sa.Numeric(16, 4), nullable=True),
      sa.Column("min_price_czk", sa.Integer(), nullable=True),
      sa.Column("max_price_czk", sa.Integer(), nullable=True),
      sa.Column("avg_price_per_m2_czk", sa.Numeric(16, 4), nullable=True),
      sa.Column("avg_floor_area_m2", sa.Numeric(10, 4), nullable=True),
      sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
  )


def downgrade() -> None:
  op.drop_table("project_aggregates")


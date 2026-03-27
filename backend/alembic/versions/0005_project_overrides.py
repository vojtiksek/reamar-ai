"""project overrides table

Revision ID: 0005_project_overrides
Revises: 0004_full_api_schema
Create Date: 2026-02-23

Adds project_overrides table for per-project field overrides.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_project_overrides"
down_revision: Union[str, None] = "0004_full_api_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("field", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.UniqueConstraint("project_id", "field", name="uq_project_override_project_field"),
    )
    op.create_index(
        "ix_project_overrides_project_field",
        "project_overrides",
        ["project_id", "field"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_overrides_project_field", table_name="project_overrides")
    op.drop_table("project_overrides")


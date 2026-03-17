"""commute_cache table

Revision ID: 20260321_commute_cache
Revises: 20260320_unit_events
Create Date: 2026-03-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260321_commute_cache"
down_revision = "20260320_unit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "commute_cache",
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("dest_lat", sa.Float(), nullable=False),
        sa.Column("dest_lng", sa.Float(), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("minutes", sa.Float(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint(
            "project_id",
            "dest_lat",
            "dest_lng",
            "mode",
            name="pk_commute_cache",
        ),
    )
    op.create_index(
        "ix_commute_cache_project_mode",
        "commute_cache",
        ["project_id", "mode"],
    )


def downgrade() -> None:
    op.drop_index("ix_commute_cache_project_mode", table_name="commute_cache")
    op.drop_table("commute_cache")


"""unit_events table

Revision ID: 20260320_unit_events
Revises: 20260319_client_unit_matches
Create Date: 2026-03-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260320_unit_events"
down_revision = "20260319_client_unit_matches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "unit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("old_value", sa.String(length=255), nullable=True),
        sa.Column("new_value", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_unit_events_unit_id", "unit_events", ["unit_id"])
    op.create_index("ix_unit_events_created_at", "unit_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_unit_events_created_at", table_name="unit_events")
    op.drop_index("ix_unit_events_unit_id", table_name="unit_events")
    op.drop_table("unit_events")


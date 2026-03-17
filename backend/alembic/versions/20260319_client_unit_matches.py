"""client_unit_matches table

Revision ID: 20260319_client_unit_matches
Revises: 20260318_client_profiles
Create Date: 2026-03-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260319_client_unit_matches"
down_revision = "20260318_client_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_unit_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "seen",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.UniqueConstraint("client_id", "unit_id", name="uq_client_unit_match"),
    )
    op.create_index("ix_client_unit_matches_client_id", "client_unit_matches", ["client_id"])
    op.create_index("ix_client_unit_matches_unit_id", "client_unit_matches", ["unit_id"])


def downgrade() -> None:
    op.drop_index("ix_client_unit_matches_unit_id", table_name="client_unit_matches")
    op.drop_index("ix_client_unit_matches_client_id", table_name="client_unit_matches")
    op.drop_table("client_unit_matches")


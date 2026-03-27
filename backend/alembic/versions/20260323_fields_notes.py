"""Add project/unit fields and client_notes table

Revision ID: 20260323_fields_notes
Revises: 20260322_client_share_links
Create Date: 2026-03-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260323_fields_notes"
down_revision = "20260322_client_share_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Project: new columns --
    op.add_column("projects", sa.Column("completion_date", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("image_url", sa.String(1024), nullable=True))
    op.add_column("projects", sa.Column("floors_above_ground", sa.Integer(), nullable=True))
    op.add_column("projects", sa.Column("energy_class", sa.String(16), nullable=True))

    # -- Unit: floorplan_url --
    op.add_column("units", sa.Column("floorplan_url", sa.String(1024), nullable=True))

    # -- ClientNote table --
    op.create_table(
        "client_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=False, index=True),
        sa.Column("broker_id", sa.Integer(), sa.ForeignKey("brokers.id"), nullable=False),
        sa.Column("note_type", sa.String(32), nullable=False, server_default=sa.text("'internal'")),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("client_notes")
    op.drop_column("units", "floorplan_url")
    op.drop_column("projects", "energy_class")
    op.drop_column("projects", "floors_above_ground")
    op.drop_column("projects", "image_url")
    op.drop_column("projects", "completion_date")

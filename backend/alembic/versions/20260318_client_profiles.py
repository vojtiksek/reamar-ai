"""client profiles and brokers

Revision ID: 20260318_client_profiles
Revises: 20260317_500
Create Date: 2026-03-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260318_client_profiles"
down_revision = "20260317_500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "brokers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("session_token", sa.String(length=255), nullable=True, unique=True),
        sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'broker'")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "clients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("broker_id", sa.Integer(), sa.ForeignKey("brokers.id"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'new'")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "client_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=False, unique=True),
        sa.Column("budget_min", sa.Integer(), nullable=True),
        sa.Column("budget_max", sa.Integer(), nullable=True),
        sa.Column("area_min", sa.Float(), nullable=True),
        sa.Column("area_max", sa.Float(), nullable=True),
        sa.Column("layouts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("property_type", sa.String(length=32), nullable=False, server_default=sa.text("'any'")),
        sa.Column("purchase_purpose", sa.String(length=32), nullable=False, server_default=sa.text("'own_use'")),
        sa.Column("walkability_preferences_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("filter_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("polygon_geojson", sa.Text(), nullable=True),
        sa.Column("commute_points_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "client_recommendations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("reason_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "pinned_by_broker",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "hidden_by_broker",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'suggested'"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_client_recommendations_client_id", "client_recommendations", ["client_id"])
    op.create_index("ix_client_recommendations_unit_id", "client_recommendations", ["unit_id"])
    op.create_index("ix_client_recommendations_project_id", "client_recommendations", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_client_recommendations_project_id", table_name="client_recommendations")
    op.drop_index("ix_client_recommendations_unit_id", table_name="client_recommendations")
    op.drop_index("ix_client_recommendations_client_id", table_name="client_recommendations")
    op.drop_table("client_recommendations")
    op.drop_table("client_profiles")
    op.drop_table("clients")
    op.drop_table("brokers")


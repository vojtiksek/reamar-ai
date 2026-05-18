"""geocode_cache table — persistent HERE Geocoding/Autosuggest response cache

HERE Geocoding API is hit live on every map-search keystroke (the broker
typing in the address bar of /map) — no DB cache existed before. This adds
a simple (kind, query) → results JSONB table with a TTL handled in the
caller. Cuts repeated HERE calls for the same query across sessions and
brokers.

Revision ID: 20260518_geocode_cache
Revises: 20260514_app_settings
Create Date: 2026-05-18
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260518_geocode_cache"
down_revision: Union[str, None] = "20260514_app_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "geocode_cache",
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("query", sa.String(length=512), nullable=False),
        sa.Column("results_json", postgresql.JSONB, nullable=False),
        sa.Column("boundary_json", postgresql.JSONB, nullable=True),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("kind", "query", name="pk_geocode_cache"),
    )
    op.create_index(
        "ix_geocode_cache_updated_at",
        "geocode_cache",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_geocode_cache_updated_at", table_name="geocode_cache")
    op.drop_table("geocode_cache")

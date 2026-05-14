"""boundary_areas table — cached geographic boundaries from OSM Nominatim

Backs the new "Oblast" filter that replaces seven legacy text-based location
filters (region_iga, administrative_district_iga, cadastral_area_iga, city,
municipality, district, postal_code). Broker types "Praha 8" → backend
resolves it via Nominatim → polygon stored here → PostGIS ST_Contains
filter on project GPS. Subsequent lookups hit the cache.

geom is a PostGIS geometry(MultiPolygon, 4326). We always store as
MultiPolygon so the filter code handles a single type. GIST index on geom
for fast ST_Contains evaluation against the 1052+ project points.

Revision ID: 20260514_boundary_areas
Revises: 20260504_notif_indexes
Create Date: 2026-05-14
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260514_boundary_areas"
down_revision: Union[str, None] = "20260504_notif_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostGIS extension is already enabled (used by walkability + noise).
    # We omit `geom` from create_table and add it via raw SQL — SQLAlchemy
    # can't emit `geometry(MultiPolygon, 4326)` natively without geoalchemy2,
    # and the table is empty when we ADD COLUMN NOT NULL so it's safe.
    op.create_table(
        "boundary_areas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(512), nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="nominatim"),
        sa.Column("osm_type", sa.String(16), nullable=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=True),
        sa.Column("bbox_south", sa.Float(), nullable=True),
        sa.Column("bbox_north", sa.Float(), nullable=True),
        sa.Column("bbox_west", sa.Float(), nullable=True),
        sa.Column("bbox_east", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_used_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.execute(
        "ALTER TABLE boundary_areas ADD COLUMN geom geometry(MultiPolygon, 4326) NOT NULL"
    )

    # GIST index on the geometry for fast ST_Contains() / ST_Intersects().
    op.execute("CREATE INDEX IF NOT EXISTS ix_boundary_areas_geom ON boundary_areas USING GIST (geom)")
    # Case-insensitive lookup by name when resolving "Praha 8" / "praha 8".
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_boundary_areas_name_lower "
        "ON boundary_areas (lower(name))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_boundary_areas_name_lower")
    op.execute("DROP INDEX IF EXISTS ix_boundary_areas_geom")
    op.drop_table("boundary_areas")

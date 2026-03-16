"""osm_id BIGINT for OSM tables (OSM IDs can exceed INTEGER max)

Revision ID: 20260315_osm_bigint
Revises: 20260315_micro_loc
Create Date: 2026-03-15

OSM node/way IDs can be > 2^31-1; PostgreSQL INTEGER is signed 32-bit.
Alter osm_id to BIGINT on all four osm_* tables.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260315_osm_bigint"
down_revision: Union[str, None] = "20260315_micro_loc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table_name in ("osm_primary_roads", "osm_tram_tracks", "osm_railways", "osm_airports"):
        op.execute(f"ALTER TABLE {table_name} ALTER COLUMN osm_id TYPE BIGINT USING osm_id::BIGINT")


def downgrade() -> None:
    for table_name in ("osm_primary_roads", "osm_tram_tracks", "osm_railways", "osm_airports"):
        op.execute(
            f"ALTER TABLE {table_name} ALTER COLUMN osm_id TYPE INTEGER USING osm_id::INTEGER"
        )

"""convert noise_map_polygons.geom to PostGIS geometry

Revision ID: 20260313_project_noise_geom
Revises: 20260313_project_noise
Create Date: 2026-03-13

This migration finalizes the noise infrastructure for a full PostGIS setup:
- converts noise_map_polygons.geom from TEXT to geometry(Polygon, 4326)
- creates a GIST index for fast point-in-polygon lookups

IMPORTANT: Requires PostGIS to be installed on the PostgreSQL server,
otherwise this migration will fail. Run e.g.:
    CREATE EXTENSION postgis;
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260313_project_noise_geom"
down_revision: Union[str, None] = "20260313_project_noise"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: This migration assumes PostGIS is already installed on the server.
    # If not, skip running Alembic to this revision until PostGIS is available.
    # We still convert TEXT geom to a generic Geometry to be compatible with
    # both Polygon and MultiPolygon (final widening is handled in a follow-up migration).
    op.execute(
        """
        ALTER TABLE noise_map_polygons
        ALTER COLUMN geom
        TYPE geometry(Geometry, 4326)
        USING ST_SetSRID(geom::geometry, 4326)
        """
    )

    # GIST index for point-in-polygon.
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_noise_map_geom ON noise_map_polygons USING GIST (geom)'
    )


def downgrade() -> None:
    # Drop index and convert back to TEXT if needed.
    op.execute("DROP INDEX IF EXISTS ix_noise_map_geom")
    op.execute(
        """
        ALTER TABLE noise_map_polygons
        ALTER COLUMN geom
        TYPE TEXT
        USING ST_AsText(geom)
        """
    )


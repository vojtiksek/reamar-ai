"""widen noise_map_polygons.geom to generic Geometry

Revision ID: 20260313_project_noise_geom_any
Revises: 20260313_project_noise_geom
Create Date: 2026-03-13

Allows storing both Polygon and MultiPolygon from Prague GeoJSON exports.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260313_project_noise_geom_any"
down_revision: Union[str, None] = "20260313_project_noise_geom"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Widen geometry type so both Polygon and MultiPolygon are accepted.
    op.execute(
        """
        ALTER TABLE noise_map_polygons
        ALTER COLUMN geom
        TYPE geometry(Geometry, 4326)
        USING ST_SetSRID(geom::geometry, 4326)
        """
    )


def downgrade() -> None:
    # Narrow back to Polygon; MultiPolygon geometries would need manual handling.
    op.execute(
        """
        ALTER TABLE noise_map_polygons
        ALTER COLUMN geom
        TYPE geometry(Polygon, 4326)
        USING ST_SetSRID(geom::geometry, 4326)
        """
    )


"""walkability: count radius 800m -> 500m, osm_parks geom -> Geometry for polygon distance

Revision ID: 20260317_500
Revises: 20260316_walk
Create Date: 2026-03-17

- Renames project count_*_800m columns to count_*_500m (radius for POI count is 500 m).
- Alters osm_parks.geom from Point to Geometry so parks can store polygons;
  distance_to_park_m is then computed to nearest edge of polygon, not centroid.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260317_500"
down_revision: Union[str, None] = "20260316_walk"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COUNT_COLUMNS_800_TO_500 = (
    ("count_supermarket_800m", "count_supermarket_500m"),
    ("count_drugstore_800m", "count_drugstore_500m"),
    ("count_pharmacy_800m", "count_pharmacy_500m"),
    ("count_atm_800m", "count_atm_500m"),
    ("count_post_office_800m", "count_post_office_500m"),
    ("count_restaurant_800m", "count_restaurant_500m"),
    ("count_cafe_800m", "count_cafe_500m"),
    ("count_park_800m", "count_park_500m"),
    ("count_fitness_800m", "count_fitness_500m"),
    ("count_playground_800m", "count_playground_500m"),
    ("count_kindergarten_800m", "count_kindergarten_500m"),
    ("count_primary_school_800m", "count_primary_school_500m"),
    ("count_pediatrician_800m", "count_pediatrician_500m"),
)


def upgrade() -> None:
    for old_name, new_name in COUNT_COLUMNS_800_TO_500:
        op.alter_column(
            "projects",
            old_name,
            new_column_name=new_name,
        )
    # osm_parks: allow Polygon (distance = to nearest edge); keep existing Points valid
    op.execute(
        "ALTER TABLE osm_parks ALTER COLUMN geom TYPE geometry(Geometry, 4326) USING geom::geometry"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE osm_parks ALTER COLUMN geom TYPE geometry(Point, 4326) "
        "USING CASE WHEN ST_GeometryType(geom) = 'ST_Point' THEN geom ELSE ST_Centroid(geom)::geometry(Point, 4326) END"
    )
    for old_name, new_name in COUNT_COLUMNS_800_TO_500:
        op.alter_column(
            "projects",
            new_name,
            new_column_name=old_name,
        )

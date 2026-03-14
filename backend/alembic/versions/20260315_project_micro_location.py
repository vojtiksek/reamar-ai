"""add project micro_location fields and OSM geometry tables

Revision ID: 20260315_micro_loc
Revises: 20260313_project_noise_geom_any
Create Date: 2026-03-15

Adds distance_to_*_m, micro_location_* on projects and tables
osm_primary_roads, osm_tram_tracks, osm_railways, osm_airports for OSM geometry.
Expects PostGIS to be available (geometry(Geometry, 4326)).
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260315_micro_loc"
down_revision: Union[str, None] = "20260313_project_noise_geom_any"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Project micro-location columns
    op.add_column(
        "projects",
        sa.Column("distance_to_primary_road_m", sa.Float(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("distance_to_tram_tracks_m", sa.Float(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("distance_to_railway_m", sa.Float(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("distance_to_airport_m", sa.Float(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("micro_location_score", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("micro_location_label", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column(
            "micro_location_updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("micro_location_source", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("micro_location_method", sa.String(length=64), nullable=True),
    )

    # OSM geometry tables (PostGIS). Create with native geometry type.
    for table_name in ("osm_primary_roads", "osm_tram_tracks", "osm_railways", "osm_airports"):
        op.execute(
            f"""
            CREATE TABLE {table_name} (
                id SERIAL PRIMARY KEY,
                osm_id INTEGER,
                geom geometry(Geometry, 4326) NOT NULL
            )
            """
        )
        op.execute(
            f"CREATE INDEX ix_{table_name}_geom ON {table_name} USING GIST (geom)"
        )


def downgrade() -> None:
    for table_name in ("osm_primary_roads", "osm_tram_tracks", "osm_railways", "osm_airports"):
        op.execute(f"DROP INDEX IF EXISTS ix_{table_name}_geom")
        op.drop_table(table_name)

    op.drop_column("projects", "micro_location_method")
    op.drop_column("projects", "micro_location_source")
    op.drop_column("projects", "micro_location_updated_at")
    op.drop_column("projects", "micro_location_label")
    op.drop_column("projects", "micro_location_score")
    op.drop_column("projects", "distance_to_airport_m")
    op.drop_column("projects", "distance_to_railway_m")
    op.drop_column("projects", "distance_to_tram_tracks_m")
    op.drop_column("projects", "distance_to_primary_road_m")

"""add walkability score module: project columns + OSM POI tables

Revision ID: 20260316_walk
Revises: 20260315_osm_bigint
Create Date: 2026-03-16

Adds walkability distance/count/score fields on projects and 17 OSM POI tables
for walkability (supermarkets, drugstores, pharmacies, atms, post_offices,
tram_stops, bus_stops, metro_stations, train_stations, restaurants, cafes,
parks, fitness, playgrounds, kindergartens, primary_schools, pediatricians).
PostGIS geometry(Point, 4326) for POI; GIST index on geom.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260316_walk"
down_revision: Union[str, None] = "20260315_osm_bigint"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# All walkability POI table names (separate tables per category)
WALKABILITY_POI_TABLES = (
    "osm_supermarkets",
    "osm_drugstores",
    "osm_pharmacies",
    "osm_atms",
    "osm_post_offices",
    "osm_tram_stops",
    "osm_bus_stops",
    "osm_metro_stations",
    "osm_train_stations",
    "osm_restaurants",
    "osm_cafes",
    "osm_parks",
    "osm_fitness",
    "osm_playgrounds",
    "osm_kindergartens",
    "osm_primary_schools",
    "osm_pediatricians",
)


def upgrade() -> None:
    # ----- Project: raw distance fields (air distance in m) -----
    for col in (
        "distance_to_supermarket_m",
        "distance_to_drugstore_m",
        "distance_to_pharmacy_m",
        "distance_to_atm_m",
        "distance_to_post_office_m",
        "distance_to_tram_stop_m",
        "distance_to_bus_stop_m",
        "distance_to_metro_station_m",
        "distance_to_train_station_m",
        "distance_to_restaurant_m",
        "distance_to_cafe_m",
        "distance_to_park_m",
        "distance_to_fitness_m",
        "distance_to_playground_m",
        "distance_to_kindergarten_m",
        "distance_to_primary_school_m",
        "distance_to_pediatrician_m",
    ):
        op.add_column("projects", sa.Column(col, sa.Float(), nullable=True))

    # ----- Project: walking distance (routing) for MHD -----
    for col in (
        "walking_distance_to_tram_stop_m",
        "walking_distance_to_bus_stop_m",
        "walking_distance_to_metro_station_m",
    ):
        op.add_column("projects", sa.Column(col, sa.Float(), nullable=True))
    op.add_column(
        "projects",
        sa.Column("walkability_walking_fallback_used", sa.Boolean(), nullable=True),
    )

    # ----- Project: count within 800 m -----
    for col in (
        "count_supermarket_800m",
        "count_drugstore_800m",
        "count_pharmacy_800m",
        "count_atm_800m",
        "count_post_office_800m",
        "count_restaurant_800m",
        "count_cafe_800m",
        "count_park_800m",
        "count_fitness_800m",
        "count_playground_800m",
        "count_kindergarten_800m",
        "count_primary_school_800m",
        "count_pediatrician_800m",
    ):
        op.add_column("projects", sa.Column(col, sa.Integer(), nullable=True))

    # ----- Project: sub-scores and final walkability -----
    op.add_column(
        "projects",
        sa.Column("walkability_daily_needs_score", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_transport_score", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_leisure_score", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_family_score", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_score", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_label", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column(
            "walkability_updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_source", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("walkability_method", sa.String(length=64), nullable=True),
    )

    # ----- OSM POI tables: id, osm_id, name, geom -----
    for table_name in WALKABILITY_POI_TABLES:
        op.execute(
            f"""
            CREATE TABLE {table_name} (
                id SERIAL PRIMARY KEY,
                osm_id BIGINT,
                name VARCHAR(255),
                geom geometry(Point, 4326) NOT NULL
            )
            """
        )
        op.execute(
            f"CREATE INDEX ix_{table_name}_geom ON {table_name} USING GIST (geom)"
        )


def downgrade() -> None:
    for table_name in WALKABILITY_POI_TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table_name}_geom")
        op.drop_table(table_name)

    # Drop project columns in reverse order
    for col in (
        "walkability_method",
        "walkability_source",
        "walkability_updated_at",
        "walkability_label",
        "walkability_score",
        "walkability_family_score",
        "walkability_leisure_score",
        "walkability_transport_score",
        "walkability_daily_needs_score",
    ):
        op.drop_column("projects", col)
    for col in (
        "count_pediatrician_800m",
        "count_primary_school_800m",
        "count_kindergarten_800m",
        "count_playground_800m",
        "count_fitness_800m",
        "count_park_800m",
        "count_cafe_800m",
        "count_restaurant_800m",
        "count_post_office_800m",
        "count_atm_800m",
        "count_pharmacy_800m",
        "count_drugstore_800m",
        "count_supermarket_800m",
    ):
        op.drop_column("projects", col)
    op.drop_column("projects", "walkability_walking_fallback_used")
    for col in (
        "walking_distance_to_metro_station_m",
        "walking_distance_to_bus_stop_m",
        "walking_distance_to_tram_stop_m",
    ):
        op.drop_column("projects", col)
    for col in (
        "distance_to_pediatrician_m",
        "distance_to_primary_school_m",
        "distance_to_kindergarten_m",
        "distance_to_playground_m",
        "distance_to_fitness_m",
        "distance_to_park_m",
        "distance_to_cafe_m",
        "distance_to_restaurant_m",
        "distance_to_train_station_m",
        "distance_to_metro_station_m",
        "distance_to_bus_stop_m",
        "distance_to_tram_stop_m",
        "distance_to_post_office_m",
        "distance_to_atm_m",
        "distance_to_pharmacy_m",
        "distance_to_drugstore_m",
        "distance_to_supermarket_m",
    ):
        op.drop_column("projects", col)

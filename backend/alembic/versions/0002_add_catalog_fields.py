"""add catalog fields

Revision ID: 0002_add_catalog_fields
Revises: 0001_init_schema
Create Date: 2026-02-22

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_add_catalog_fields"
down_revision: Union[str, None] = "8f132b46fc8c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- projects: new columns ---
    op.add_column("projects", sa.Column("city", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("municipality", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("district", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("postal_code", sa.String(length=32), nullable=True))
    op.add_column("projects", sa.Column("cadastral_area_iga", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("administrative_district_iga", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("region_iga", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("gps_latitude", sa.Numeric(10, 8), nullable=True))
    op.add_column("projects", sa.Column("gps_longitude", sa.Numeric(10, 8), nullable=True))
    op.add_column("projects", sa.Column("ride_to_center_min", sa.Numeric(10, 1), nullable=True))
    op.add_column("projects", sa.Column("public_transport_to_center_min", sa.Numeric(10, 1), nullable=True))
    op.add_column("projects", sa.Column("permit_regular", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("renovation", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("overall_quality", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("windows", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("heating", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("partition_walls", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("amenities", sa.Text(), nullable=True))

    # --- units: new columns ---
    op.add_column("units", sa.Column("price_change", sa.Numeric(10, 4), nullable=True))
    op.add_column("units", sa.Column("original_price_czk", sa.Integer(), nullable=True))
    op.add_column("units", sa.Column("original_price_per_m2_czk", sa.Integer(), nullable=True))
    op.add_column("units", sa.Column("parking_indoor_price_czk", sa.Integer(), nullable=True))
    op.add_column("units", sa.Column("parking_outdoor_price_czk", sa.Integer(), nullable=True))
    op.add_column("units", sa.Column("total_area_m2", sa.Numeric(10, 1), nullable=True))
    op.add_column("units", sa.Column("days_on_market", sa.Integer(), nullable=True))
    op.add_column("units", sa.Column("payment_contract", sa.Numeric(6, 4), nullable=True))
    op.add_column("units", sa.Column("payment_construction", sa.Numeric(6, 4), nullable=True))
    op.add_column("units", sa.Column("payment_occupancy", sa.Numeric(6, 4), nullable=True))
    op.add_column("units", sa.Column("first_seen", sa.Date(), nullable=True))
    op.add_column("units", sa.Column("last_seen", sa.Date(), nullable=True))
    op.add_column("units", sa.Column("sold_date", sa.Date(), nullable=True))
    op.add_column("units", sa.Column("air_conditioning", sa.Boolean(), nullable=True))
    op.add_column("units", sa.Column("cooling_ceilings", sa.Boolean(), nullable=True))
    op.add_column("units", sa.Column("exterior_blinds", sa.Boolean(), nullable=True))
    op.add_column("units", sa.Column("smart_home", sa.Boolean(), nullable=True))
    op.add_column("units", sa.Column("category", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("orientation", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("sale_type", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("building", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("amenities", sa.Text(), nullable=True))
    op.add_column("units", sa.Column("usage", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("building_use", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("windows", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("heating", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("partition_walls", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("overall_quality", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("cadastral_area_iga", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("city_iga", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("municipal_district_iga", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("administrative_district_iga", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("region_iga", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("district_okres_iga", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("district", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("address", sa.String(length=255), nullable=True))
    op.add_column("units", sa.Column("developer", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("units", "developer")
    op.drop_column("units", "address")
    op.drop_column("units", "district")
    op.drop_column("units", "district_okres_iga")
    op.drop_column("units", "region_iga")
    op.drop_column("units", "administrative_district_iga")
    op.drop_column("units", "municipal_district_iga")
    op.drop_column("units", "city_iga")
    op.drop_column("units", "cadastral_area_iga")
    op.drop_column("units", "overall_quality")
    op.drop_column("units", "partition_walls")
    op.drop_column("units", "heating")
    op.drop_column("units", "windows")
    op.drop_column("units", "building_use")
    op.drop_column("units", "usage")
    op.drop_column("units", "amenities")
    op.drop_column("units", "building")
    op.drop_column("units", "sale_type")
    op.drop_column("units", "orientation")
    op.drop_column("units", "category")
    op.drop_column("units", "smart_home")
    op.drop_column("units", "exterior_blinds")
    op.drop_column("units", "cooling_ceilings")
    op.drop_column("units", "air_conditioning")
    op.drop_column("units", "sold_date")
    op.drop_column("units", "last_seen")
    op.drop_column("units", "first_seen")
    op.drop_column("units", "payment_occupancy")
    op.drop_column("units", "payment_construction")
    op.drop_column("units", "payment_contract")
    op.drop_column("units", "days_on_market")
    op.drop_column("units", "total_area_m2")
    op.drop_column("units", "parking_outdoor_price_czk")
    op.drop_column("units", "parking_indoor_price_czk")
    op.drop_column("units", "original_price_per_m2_czk")
    op.drop_column("units", "original_price_czk")
    op.drop_column("units", "price_change")

    op.drop_column("projects", "amenities")
    op.drop_column("projects", "partition_walls")
    op.drop_column("projects", "heating")
    op.drop_column("projects", "windows")
    op.drop_column("projects", "overall_quality")
    op.drop_column("projects", "renovation")
    op.drop_column("projects", "permit_regular")
    op.drop_column("projects", "public_transport_to_center_min")
    op.drop_column("projects", "ride_to_center_min")
    op.drop_column("projects", "gps_longitude")
    op.drop_column("projects", "gps_latitude")
    op.drop_column("projects", "region_iga")
    op.drop_column("projects", "administrative_district_iga")
    op.drop_column("projects", "cadastral_area_iga")
    op.drop_column("projects", "postal_code")
    op.drop_column("projects", "district")
    op.drop_column("projects", "municipality")
    op.drop_column("projects", "city")

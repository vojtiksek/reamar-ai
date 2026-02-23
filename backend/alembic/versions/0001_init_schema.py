"""init schema

Revision ID: 0001_init_schema
Revises:
Create Date: 2026-02-22

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0001_init_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("developer", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.UniqueConstraint(
            "developer",
            "name",
            "address",
            name="uq_project_developer_name_address",
        ),
    )

    op.create_table(
        "unit_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "imported_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("source", sa.String(length=255), nullable=True),
    )

    op.create_table(
        "units",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("external_id", sa.String(length=255), nullable=False, unique=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("unit_name", sa.String(length=255), nullable=True),
        sa.Column("layout", sa.String(length=255), nullable=True),
        sa.Column("floor", sa.Integer(), nullable=True),
        sa.Column("availability_status", sa.String(length=50), nullable=True),
        sa.Column(
            "available",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("price_czk", sa.Integer(), nullable=True),
        sa.Column("price_per_m2_czk", sa.Integer(), nullable=True),
        sa.Column("floor_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("equivalent_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("exterior_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("balcony_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("terrace_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("garden_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("gps_latitude", sa.Numeric(10, 8), nullable=True),
        sa.Column("gps_longitude", sa.Numeric(10, 8), nullable=True),
        sa.Column("ride_to_center_min", sa.Numeric(10, 1), nullable=True),
        sa.Column("public_transport_to_center_min", sa.Numeric(10, 1), nullable=True),
        sa.Column("permit_regular", sa.Boolean(), nullable=True),
        sa.Column("renovation", sa.Boolean(), nullable=True),
        sa.Column("city", sa.String(length=255), nullable=True),
        sa.Column("municipality", sa.String(length=255), nullable=True),
        sa.Column("postal_code", sa.String(length=32), nullable=True),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "unit_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("field", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.UniqueConstraint(
            "unit_id",
            "field",
            name="uq_unit_override_unit_field",
        ),
    )

    op.create_table(
        "unit_price_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column(
            "captured_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("price_czk", sa.Integer(), nullable=True),
        sa.Column("price_per_m2_czk", sa.Integer(), nullable=True),
        sa.Column("availability_status", sa.String(length=50), nullable=True),
        sa.Column("available", sa.Boolean(), nullable=False),
    )

    op.create_index(
        "ix_units_project_id",
        "units",
        ["project_id"],
    )
    op.create_index(
        "ix_units_price_per_m2_czk",
        "units",
        ["price_per_m2_czk"],
    )
    op.create_index(
        "ix_unit_price_history_unit_id_captured_at_desc",
        "unit_price_history",
        ["unit_id", "captured_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_unit_price_history_unit_id_captured_at_desc",
        table_name="unit_price_history",
    )
    op.drop_index("ix_units_price_per_m2_czk", table_name="units")
    op.drop_index("ix_units_project_id", table_name="units")

    op.drop_table("unit_price_history")
    op.drop_table("unit_overrides")
    op.drop_table("units")
    op.drop_table("unit_snapshots")
    op.drop_table("projects")


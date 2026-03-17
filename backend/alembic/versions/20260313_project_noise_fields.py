"""add project noise fields and noise_map_polygons

Revision ID: 20260313_project_noise
Revises: 20260313_proj_std_amen
Create Date: 2026-03-13
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260313_project_noise"
down_revision: Union[str, None] = "20260313_proj_std_amen"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Project noise columns
    op.add_column("projects", sa.Column("noise_day_db", sa.Float(), nullable=True))
    op.add_column("projects", sa.Column("noise_night_db", sa.Float(), nullable=True))
    op.add_column("projects", sa.Column("noise_source", sa.String(length=64), nullable=True))
    op.add_column("projects", sa.Column("noise_method", sa.String(length=64), nullable=True))
    op.add_column(
        "projects",
        sa.Column("noise_updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column("projects", sa.Column("noise_label", sa.String(length=32), nullable=True))

    # Prague noise map polygons (day & night).
    # NOTE: expects PostGIS to be installed and configured on the DB server.
    op.create_table(
        "noise_map_polygons",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("noise_db", sa.Float(), nullable=False),
        sa.Column("noise_type", sa.String(length=16), nullable=False),
        # Geometry column – created as plain TEXT here to avoid requiring PostGIS
        # at migration time. In a PostGIS-enabled deployment this should be
        # converted to a proper geometry type.
        sa.Column("geom", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_index("ix_noise_map_geom", table_name="noise_map_polygons")
    op.drop_table("noise_map_polygons")
    op.drop_column("projects", "noise_label")
    op.drop_column("projects", "noise_updated_at")
    op.drop_column("projects", "noise_method")
    op.drop_column("projects", "noise_source")
    op.drop_column("projects", "noise_night_db")
    op.drop_column("projects", "noise_day_db")


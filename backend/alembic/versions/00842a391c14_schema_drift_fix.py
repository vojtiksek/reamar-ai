"""schema_drift_fix

Minimal schema-drift fix migration. Adds columns present in the ORM models
but missing in migrations (discovered during initial Supabase deploy).

Does NOT drop any tables — the original autogenerate output wanted to drop
all OSM tables, noise_map_polygons, project_verification_records, and even
spatial_ref_sys (PostGIS system table). Those tables are populated by
walkability/verification pipelines via raw SQL and intentionally not in
the ORM models; dropping them would break production.

Revision ID: 00842a391c14
Revises: c3f8a9b12d4e
Create Date: 2026-04-21

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "00842a391c14"
down_revision: Union[str, None] = "c3f8a9b12d4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add projects.neighborhood (in model, missing from migrations).
    op.add_column(
        "projects",
        sa.Column("neighborhood", sa.String(length=255), nullable=True),
    )

    # Add client_recommendations.shortlist_risks (in model, missing from migrations).
    op.add_column(
        "client_recommendations",
        sa.Column("shortlist_risks", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("client_recommendations", "shortlist_risks")
    op.drop_column("projects", "neighborhood")

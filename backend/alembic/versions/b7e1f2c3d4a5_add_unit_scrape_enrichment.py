"""add_unit_scrape_enrichment

Revision ID: b7e1f2c3d4a5
Revises: 20260411_client_mode
Create Date: 2026-04-11 21:00:00.000000

Milestone 3 of the scraping pipeline: a dedicated side-table that stores
parsed unit-card data as an enrichment layer. One row per units.id (unique),
keyed by unit_url for matching. The full parsed JSON from
``app.parse_units.parse_unit_html`` is stored verbatim in ``parsed_json``,
plus a small set of queryable extracted columns.

Design notes:
 * Side-table (not a JSONB column on units) — units is already wide, and
   scraping metadata (status, fetch_method, error) is a separate concern.
 * ``unit_id`` UNIQUE → upsert is always in place; no duplicate rows per unit.
 * ``first_parsed_at`` and ``last_parsed_at`` + ``parse_run_count`` give
   overwrite traceability without a full history table.
 * Raw HTML is NOT stored here (can be gigabytes). We store only the parsed
   output + audit metadata.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "b7e1f2c3d4a5"
down_revision: Union[str, None] = "20260411_client_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "unit_scrape_enrichment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "unit_id",
            sa.Integer(),
            sa.ForeignKey("units.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,  # one enrichment row per unit
        ),
        sa.Column("unit_url", sa.String(1024), nullable=False),
        # --- scrape/parse status + audit
        sa.Column("scrape_status", sa.String(32), nullable=False),
        sa.Column("fetch_method", sa.String(32), nullable=True),
        sa.Column("fetch_status_code", sa.Integer(), nullable=True),
        sa.Column("html_length", sa.Integer(), nullable=True),
        sa.Column("parse_status", sa.String(32), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "first_parsed_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_parsed_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "parse_run_count",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        # --- full parsed payload (verbatim dict from parse_unit_html)
        sa.Column("parsed_json", JSONB, nullable=True),
        # --- extracted, queryable fields
        sa.Column("scraped_layout", sa.String(32), nullable=True),
        sa.Column("scraped_total_area_m2", sa.Numeric(10, 1), nullable=True),
        sa.Column("has_pantry", sa.Boolean(), nullable=True),
        sa.Column("has_wardrobe", sa.Boolean(), nullable=True),
        sa.Column("has_cellar", sa.Boolean(), nullable=True),
        sa.Column("outdoor_kind", sa.String(32), nullable=True),
        sa.Column("outdoor_area_m2", sa.Numeric(10, 1), nullable=True),
    )
    op.create_index(
        "ix_unit_scrape_enrichment_unit_url",
        "unit_scrape_enrichment",
        ["unit_url"],
    )
    op.create_index(
        "ix_unit_scrape_enrichment_scrape_status",
        "unit_scrape_enrichment",
        ["scrape_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_unit_scrape_enrichment_scrape_status",
        table_name="unit_scrape_enrichment",
    )
    op.drop_index(
        "ix_unit_scrape_enrichment_unit_url",
        table_name="unit_scrape_enrichment",
    )
    op.drop_table("unit_scrape_enrichment")

"""Store exterior_blinds as string (true/false/preparation) instead of boolean.

Revision ID: 20260308_exterior_blinds_str
Revises: 20260308_api_pending
Create Date: 2026-03-08

API sends true/false/preparation; we currently only store boolean + raw.
This migration merges into a single string column.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision = "20260308_exterior_blinds_str"
down_revision = "20260308_api_pending"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "units",
        sa.Column("exterior_blinds_new", sa.String(length=50), nullable=True),
    )
    # Backfill: prefer raw (e.g. "preparation"), else derive from boolean
    op.execute("""
        UPDATE units
        SET exterior_blinds_new = COALESCE(
            exterior_blinds_raw,
            CASE
                WHEN exterior_blinds = true THEN 'true'
                WHEN exterior_blinds = false THEN 'false'
                ELSE NULL
            END
        )
    """)
    op.drop_column("units", "exterior_blinds")
    op.drop_column("units", "exterior_blinds_raw")
    op.alter_column(
        "units",
        "exterior_blinds_new",
        new_column_name="exterior_blinds",
    )


def downgrade() -> None:
    op.alter_column(
        "units",
        "exterior_blinds",
        new_column_name="exterior_blinds_old",
    )
    op.add_column(
        "units",
        sa.Column("exterior_blinds", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "units",
        sa.Column("exterior_blinds_raw", sa.String(length=255), nullable=True),
    )
    op.execute("""
        UPDATE units
        SET
            exterior_blinds = CASE
                WHEN exterior_blinds_old = 'true' THEN true
                WHEN exterior_blinds_old = 'false' THEN false
                ELSE NULL
            END,
            exterior_blinds_raw = CASE
                WHEN exterior_blinds_old NOT IN ('true', 'false') THEN exterior_blinds_old
                ELSE NULL
            END
    """)
    op.drop_column("units", "exterior_blinds_old")

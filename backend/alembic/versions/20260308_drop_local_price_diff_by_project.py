"""Drop local_price_diff_*_by_project columns (výpočet nyní v hlavních sloupcích).

Revision ID: 20260308_drop_by_project
Revises: 20260308_by_project
Create Date: 2026-03-08

"""
from __future__ import annotations

from alembic import op


revision = "20260308_drop_by_project"
down_revision = "20260308_by_project"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("units", "local_price_diff_2000m_by_project")
    op.drop_column("units", "local_price_diff_1000m_by_project")


def downgrade() -> None:
    import sqlalchemy as sa
    op.add_column("units", sa.Column("local_price_diff_1000m_by_project", sa.Numeric(6, 2), nullable=True))
    op.add_column("units", sa.Column("local_price_diff_2000m_by_project", sa.Numeric(6, 2), nullable=True))

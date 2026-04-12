"""Add shortlist_role, shortlist_reason, shortlist_order to client_recommendations

Revision ID: 20260411_shortlist_metadata
Revises: 5cf4db1bc1d9
Create Date: 2026-04-11
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260411_shortlist_metadata"
down_revision: Union[str, None] = "5cf4db1bc1d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "client_recommendations",
        sa.Column("shortlist_role", sa.String(32), nullable=True),
    )
    op.add_column(
        "client_recommendations",
        sa.Column("shortlist_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "client_recommendations",
        sa.Column("shortlist_order", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("client_recommendations", "shortlist_order")
    op.drop_column("client_recommendations", "shortlist_reason")
    op.drop_column("client_recommendations", "shortlist_role")

"""app_settings key/value table — admin-configurable runtime knobs

Generic key/value JSONB store for small admin-managed config that doesn't
warrant its own table. First user: the projects-explorer column allow-list
("projects_columns_allowed") that lets the admin restrict which columns
appear in the broker's column picker.

Revision ID: 20260514_app_settings
Revises: 20260514_boundary_areas
Create Date: 2026-05-14
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260514_app_settings"
down_revision: Union[str, None] = "20260514_boundary_areas"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("value", postgresql.JSONB, nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("app_settings")

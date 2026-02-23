"""add unit raw_json

Revision ID: 0003_add_unit_raw_json
Revises: 0002_add_catalog_fields
Create Date: 2026-02-22

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0003_add_unit_raw_json"
down_revision: Union[str, None] = "0002_add_catalog_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("units", sa.Column("raw_json", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("units", "raw_json")

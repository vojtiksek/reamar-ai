"""add_derived_total_floors_to_project_aggregates

Revision ID: 724920d64703
Revises: 20260407_canonical_wizard_keys
Create Date: 2026-04-08 14:25:21.750271

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '724920d64703'
down_revision: Union[str, None] = '20260407_canonical_wizard_keys'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_aggregates",
        sa.Column("derived_total_floors", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_aggregates", "derived_total_floors")

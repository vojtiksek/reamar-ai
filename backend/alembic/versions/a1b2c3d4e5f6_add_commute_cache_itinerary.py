"""add_commute_cache_itinerary

Adds itinerary_json column to commute_cache to store simplified route legs
for display in the recommendations map popup tooltip.

Revision ID: a1b2c3d4e5f6
Revises: f54d0c023e9e
Create Date: 2026-04-14 09:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f54d0c023e9e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('commute_cache', sa.Column('itinerary_json', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('commute_cache', 'itinerary_json')

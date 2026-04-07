"""add_broker_weight_overrides_json

Revision ID: 4dd0a9f71bc6
Revises: 20260405_client_rec_fb
Create Date: 2026-04-07 16:51:57.186268

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '4dd0a9f71bc6'
down_revision: Union[str, None] = '20260405_client_rec_fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('client_profiles', sa.Column('broker_weight_overrides_json', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('client_profiles', 'broker_weight_overrides_json')

"""add_portal_overrides_json_to_client_profile

Revision ID: 772632b901c3
Revises: a1b2c3d4e5f6
Create Date: 2026-04-16 14:38:35.206475

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '772632b901c3'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'client_profiles',
        sa.Column('portal_overrides_json', JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column('client_profiles', 'portal_overrides_json')

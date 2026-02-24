"""merge heads

Revision ID: e4d92e9cde75
Revises: 0005_project_overrides, 515b59ced536
Create Date: 2026-02-23 16:42:40.107723

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4d92e9cde75'
down_revision: Union[str, None] = ('0005_project_overrides', '515b59ced536')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass


from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "1a2b3c4d5e6f"
down_revision: Union[str, None] = "9b7c2f3d4e8f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("units", sa.Column("exterior_blinds_raw", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("units", "exterior_blinds_raw")


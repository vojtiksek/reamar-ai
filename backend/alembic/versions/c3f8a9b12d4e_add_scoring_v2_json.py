"""add scoring_v2_json to scoring_config

Revision ID: c3f8a9b12d4e
Revises: 772632b901c3
Create Date: 2026-04-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "c3f8a9b12d4e"
down_revision: Union[str, None] = "772632b901c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scoring_config",
        sa.Column("scoring_v2_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scoring_config", "scoring_v2_json")

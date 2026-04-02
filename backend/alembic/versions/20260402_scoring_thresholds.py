"""Add thresholds_json column to scoring_config

Revision ID: 4a8c1d2e3f5b
Revises: 29cc302a0ade
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "4a8c1d2e3f5b"
down_revision = "29cc302a0ade"
branch_labels = None
depends_on = None

DEFAULT_THRESHOLDS = {
    "strong_pick_min_score": 70,
    "review_pick_min_score": 55,
    "hide_below_score": 0,
    "default_visible_limit": 50,
    "max_strong_picks": 0,
    "max_review_picks": 0,
}


def upgrade() -> None:
    op.add_column(
        "scoring_config",
        sa.Column("thresholds_json", JSONB, nullable=True),
    )
    # Seed defaults on existing row(s)
    scoring_config = sa.table(
        "scoring_config",
        sa.column("thresholds_json", JSONB),
    )
    op.execute(
        scoring_config.update().values(thresholds_json=DEFAULT_THRESHOLDS)
    )


def downgrade() -> None:
    op.drop_column("scoring_config", "thresholds_json")

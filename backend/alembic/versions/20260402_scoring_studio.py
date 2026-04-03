"""Add scoring studio columns to scoring_config

Revision ID: 5b9d3e4f6a7c
Revises: 4a8c1d2e3f5b
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "5b9d3e4f6a7c"
down_revision = "4a8c1d2e3f5b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scoring_config",
        sa.Column("groups_json", JSONB, nullable=True),
    )
    op.add_column(
        "scoring_config",
        sa.Column("field_rules_json", JSONB, nullable=True),
    )
    op.add_column(
        "scoring_config",
        sa.Column("eligibility_rules_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scoring_config", "eligibility_rules_json")
    op.drop_column("scoring_config", "field_rules_json")
    op.drop_column("scoring_config", "groups_json")

"""Add scoring_config table and scoring_weights_json to client_profiles

Revision ID: 29cc302a0ade
Revises: 20260330_builtmind_march2026
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "29cc302a0ade"
down_revision = "20260330_builtmind_march2026"
branch_labels = None
depends_on = None

DEFAULT_WEIGHTS = {
    "budget": 0.30,
    "walkability": 0.20,
    "location": 0.20,
    "layout": 0.10,
    "area": 0.10,
    "outdoor": 0.05,
    "commute": 0.05,
}


def upgrade() -> None:
    op.create_table(
        "scoring_config",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("config_json", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        if_not_exists=True,
    )

    # Insert default row
    scoring_config = sa.table(
        "scoring_config",
        sa.column("config_json", JSONB),
    )
    op.bulk_insert(scoring_config, [{"config_json": DEFAULT_WEIGHTS}])

    op.add_column(
        "client_profiles",
        sa.Column("scoring_weights_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("client_profiles", "scoring_weights_json")
    op.drop_table("scoring_config")

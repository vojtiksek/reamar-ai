"""add broker.supabase_user_id

Revision ID: d5a8f3c2b1e0
Revises: 00842a391c14
Create Date: 2026-04-22 10:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d5a8f3c2b1e0"
down_revision = "00842a391c14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "brokers",
        sa.Column("supabase_user_id", sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_brokers_supabase_user_id",
        "brokers",
        ["supabase_user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_brokers_supabase_user_id", "brokers", type_="unique")
    op.drop_column("brokers", "supabase_user_id")

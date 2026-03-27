"""client_share_links table

Revision ID: 20260322_client_share_links
Revises: 20260321_commute_cache
Create Date: 2026-03-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260322_client_share_links"
down_revision = "20260321_commute_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_share_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("broker_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["broker_id"], ["brokers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "broker_id", name="uq_share_link_client_broker"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_client_share_links_client_id", "client_share_links", ["client_id"])
    op.create_index("ix_client_share_links_broker_id", "client_share_links", ["broker_id"])
    op.create_index("ix_client_share_links_token", "client_share_links", ["token"])


def downgrade() -> None:
    op.drop_table("client_share_links")

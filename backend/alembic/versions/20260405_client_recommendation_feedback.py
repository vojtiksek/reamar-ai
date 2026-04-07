"""client recommendation feedback table

Revision ID: 20260405_client_rec_fb
Revises: 5b9d3e4f6a7c, 20260403_proj_verif_pipe
Create Date: 2026-04-05

Adds client_recommendation_feedback table for current-state client
feedback (liked/saved/disliked) keyed to client_recommendations.id.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260405_client_rec_fb"
down_revision: Union[str, Sequence[str]] = (
    "5b9d3e4f6a7c",
    "20260403_proj_verif_pipe",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_recommendation_feedback",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "recommendation_id",
            sa.Integer(),
            sa.ForeignKey("client_recommendations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("feedback_type", sa.String(16), nullable=False),
        sa.Column("dislike_reason", sa.String(32), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
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
    )
    op.create_index(
        "ix_client_recommendation_feedback_recommendation_id",
        "client_recommendation_feedback",
        ["recommendation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_client_recommendation_feedback_recommendation_id")
    op.drop_table("client_recommendation_feedback")

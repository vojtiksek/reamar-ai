"""add_error_logs_table

Revision ID: 20260428_error_logs
Revises: d80bc8267634
Create Date: 2026-04-28

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260428_error_logs"
down_revision: Union[str, None] = "d80bc8267634"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "error_logs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("ts", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),  # server | client | probe
        sa.Column("level", sa.String(length=16), nullable=False, server_default=sa.text("'error'")),
        sa.Column("status", sa.Integer(), nullable=True),
        sa.Column("method", sa.String(length=8), nullable=True),
        sa.Column("path", sa.Text(), nullable=True),
        sa.Column("query", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("traceback", sa.Text(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("broker_id", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("extra_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_error_logs_ts_desc",
        "error_logs",
        [sa.literal_column("ts DESC")],
        unique=False,
    )
    op.create_index("ix_error_logs_source", "error_logs", ["source"], unique=False)
    op.create_index("ix_error_logs_status", "error_logs", ["status"], unique=False)
    op.create_index("ix_error_logs_resolved_at", "error_logs", ["resolved_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_error_logs_resolved_at", table_name="error_logs")
    op.drop_index("ix_error_logs_status", table_name="error_logs")
    op.drop_index("ix_error_logs_source", table_name="error_logs")
    op.drop_index("ix_error_logs_ts_desc", table_name="error_logs")
    op.drop_table("error_logs")

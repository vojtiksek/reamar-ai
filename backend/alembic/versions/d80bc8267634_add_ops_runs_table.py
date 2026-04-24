"""add_ops_runs_table

Revision ID: d80bc8267634
Revises: d5a8f3c2b1e0
Create Date: 2026-04-24 11:06:20.387655

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd80bc8267634'
down_revision: Union[str, None] = 'd5a8f3c2b1e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ops_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trigger', sa.String(length=32), server_default=sa.text("'manual'"), nullable=False),
        sa.Column('status', sa.String(length=32), server_default=sa.text("'running'"), nullable=False),
        sa.Column('started_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('steps_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('summary_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_ops_runs_started_at_desc',
        'ops_runs',
        [sa.literal_column('started_at DESC')],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_ops_runs_started_at_desc', table_name='ops_runs')
    op.drop_table('ops_runs')

"""add_client_magic_links_and_portal_sessions

Revision ID: 5cf4db1bc1d9
Revises: 21418e509910
Create Date: 2026-04-09 12:59:53.142597

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5cf4db1bc1d9'
down_revision: Union[str, None] = '21418e509910'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'client_magic_links',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('client_id', sa.Integer(), sa.ForeignKey('clients.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('token', sa.String(64), nullable=False, unique=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('used_at', sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_table(
        'client_portal_sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('client_id', sa.Integer(), sa.ForeignKey('clients.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('token', sa.String(64), nullable=False, unique=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.TIMESTAMP(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('client_portal_sessions')
    op.drop_table('client_magic_links')

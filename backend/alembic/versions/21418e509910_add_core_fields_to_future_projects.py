"""add_core_fields_to_future_projects

Revision ID: 21418e509910
Revises: 31c930e0e737
Create Date: 2026-04-09 12:28:54.202493

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '21418e509910'
down_revision: Union[str, None] = '31c930e0e737'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('future_projects', sa.Column('developer', sa.String(255), nullable=True))
    op.add_column('future_projects', sa.Column('address', sa.String(500), nullable=True))
    op.add_column('future_projects', sa.Column('stage', sa.String(100), nullable=True))
    op.add_column('future_projects', sa.Column('total_units', sa.Integer(), nullable=True))
    op.add_column('future_projects', sa.Column('date_sale_start', sa.String(50), nullable=True))
    op.add_column('future_projects', sa.Column('construction_completion', sa.String(50), nullable=True))
    op.add_column('future_projects', sa.Column('project_type', sa.String(100), nullable=True))
    op.add_column('future_projects', sa.Column('url', sa.Text(), nullable=True))
    op.add_column('future_projects', sa.Column('renovation', sa.Boolean(), nullable=True))
    op.add_column('future_projects', sa.Column('gps_latitude', sa.Numeric(10, 8), nullable=True))
    op.add_column('future_projects', sa.Column('gps_longitude', sa.Numeric(11, 8), nullable=True))
    op.add_column('future_projects', sa.Column('city', sa.String(255), nullable=True))
    op.add_column('future_projects', sa.Column('municipal_district', sa.String(255), nullable=True))
    op.add_column('future_projects', sa.Column('region', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('future_projects', 'region')
    op.drop_column('future_projects', 'municipal_district')
    op.drop_column('future_projects', 'city')
    op.drop_column('future_projects', 'gps_longitude')
    op.drop_column('future_projects', 'gps_latitude')
    op.drop_column('future_projects', 'renovation')
    op.drop_column('future_projects', 'url')
    op.drop_column('future_projects', 'project_type')
    op.drop_column('future_projects', 'construction_completion')
    op.drop_column('future_projects', 'date_sale_start')
    op.drop_column('future_projects', 'total_units')
    op.drop_column('future_projects', 'stage')
    op.drop_column('future_projects', 'address')
    op.drop_column('future_projects', 'developer')

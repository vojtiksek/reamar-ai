"""add project standards & amenities fields

Revision ID: 20260313_project_standards_amenities
Revises: 
Create Date: 2026-03-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
# Pozor: alembic_version.version_num má délku 32 znaků, proto používáme kratší ID.
revision: str = "20260313_proj_std_amen"
# Navazuje na poslední existující migraci (exterior_blinds jako string),
# aby se aplikovala korektně na aktuální schéma.
down_revision: Union[str, None] = "20260308_exterior_blinds_str"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("ceiling_height", sa.String(length=50), nullable=True))
    op.add_column("projects", sa.Column("recuperation", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("cooling", sa.Boolean(), nullable=True))

    op.add_column("projects", sa.Column("concierge", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("reception", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("bike_room", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("stroller_room", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("fitness", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("courtyard_garden", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "courtyard_garden")
    op.drop_column("projects", "fitness")
    op.drop_column("projects", "stroller_room")
    op.drop_column("projects", "bike_room")
    op.drop_column("projects", "reception")
    op.drop_column("projects", "concierge")
    op.drop_column("projects", "cooling")
    op.drop_column("projects", "recuperation")
    op.drop_column("projects", "ceiling_height")


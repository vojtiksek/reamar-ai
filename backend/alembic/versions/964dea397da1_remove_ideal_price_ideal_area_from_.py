"""remove_ideal_price_ideal_area_from_wizard_json

Strip ideal_price and ideal_area from filter_json.wizard.budget for all
client profiles.  These fields are no longer used in the product — the
wizard only asks for min area + tolerance and max price + tolerance.

Backend scoring degrades gracefully (neutral 50) when the fields are absent.

Revision ID: 964dea397da1
Revises: b7e1f2c3d4a5
Create Date: 2026-04-13 18:01:05.675333

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '964dea397da1'
down_revision: Union[str, None] = 'b7e1f2c3d4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove ideal_price from filter_json.wizard.budget
    op.execute(sa.text("""
        UPDATE client_profiles
        SET filter_json = jsonb_set(
            filter_json,
            '{wizard,budget}',
            (filter_json->'wizard'->'budget') - 'ideal_price' - 'ideal_area'
        )
        WHERE filter_json->'wizard'->'budget' IS NOT NULL
          AND (
            filter_json->'wizard'->'budget' ? 'ideal_price'
            OR filter_json->'wizard'->'budget' ? 'ideal_area'
          )
    """))


def downgrade() -> None:
    # No-op: we cannot restore deleted values
    pass

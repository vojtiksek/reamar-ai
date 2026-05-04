"""indexes_for_brokers_notifications_endpoint

Naměřeno na produkci po Supabase Pro upgradu (4. 5. 2026, 16:00):

  GET /brokers/notifications  = 11.3 s

Endpoint dělá 6 queries; pomalá je query #5 (new_projects):

  SELECT Project.id, Project.name, MIN(Unit.first_seen)
  FROM projects JOIN units ON unit.project_id = project.id
  WHERE Unit.first_seen >= :since
  GROUP BY Project.id, Project.name
  HAVING MIN(Unit.first_seen) >= :since

Bez indexu na units.first_seen = full scan 40 k řádků jen kvůli zjištění
"jaké projekty se objevily za posledních 7 dní". Stejně tak query #3
(UnitEvent batch lookup) nemá composite index pokrývající filtr.

Tato migrace vrátí endpoint do desítek milisekund.

Revision ID: 20260504_notif_indexes
Revises: 20260504_add_sold_date
Create Date: 2026-05-04

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260504_notif_indexes"
down_revision: Union[str, None] = "20260504_add_sold_date"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        # /brokers/notifications query #5: WHERE first_seen >= :since
        # Partial WHERE NOT NULL — zhruba 99 % řádků má first_seen, takže
        # partial je tady spíš out of habit; standalone btree by byl OK.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_units_first_seen "
            "ON units (first_seen) WHERE first_seen IS NOT NULL"
        )
        # /brokers/notifications query #3:
        #   WHERE unit_id IN (...) AND created_at >= :since
        #         AND event_type IN ('price_change','availability_change')
        # Composite (unit_id, created_at) by stačil — event_type filtr na
        # 2 z ~5 hodnot je selektivní jen mírně, ne worth zahrnout do indexu.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_unit_events_unit_id_created_at "
            "ON unit_events (unit_id, created_at DESC)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_unit_events_unit_id_created_at")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_units_first_seen")

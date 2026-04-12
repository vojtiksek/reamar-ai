"""client_mode_foundation

Add base_profile_json, working_filters_json, modified_keys_json, and
client_mode_updated_at columns to client_profiles.  Used by Client Mode
Phase 1 foundation — stores wizard-derived base profile, editable working
filters, and metadata about which filters were manually modified.

Revision ID: 20260411_client_mode
Revises: 20260411_shortlist_metadata
Create Date: 2026-04-11
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260411_client_mode"
down_revision: Union[str, None] = "20260411_shortlist_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "client_profiles",
        sa.Column("base_profile_json", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "client_profiles",
        sa.Column("working_filters_json", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "client_profiles",
        sa.Column("modified_keys_json", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "client_profiles",
        sa.Column(
            "client_mode_updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("client_profiles", "client_mode_updated_at")
    op.drop_column("client_profiles", "modified_keys_json")
    op.drop_column("client_profiles", "working_filters_json")
    op.drop_column("client_profiles", "base_profile_json")

"""BuiltMind March 2026 API migration

- Project: add builtmind_project_id, builtmind_developer_id, project_url, construction_completion
- Project: change recuperation/cooling from boolean to varchar(50)
- Project: reset completion_date and project_url (will be repopulated from API on next import)
- Unit: rename usage -> use_type (migrate data, drop old column)
- Unit: add reserved_date, reservation_duration_days, is_stale_reservation

Revision ID: 20260330_builtmind_march2026
Revises: 20260324_broker_note
Create Date: 2026-03-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260330_builtmind_march2026"
down_revision = "20260324_broker_note"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Project: new BuiltMind identifier columns ────────────────────────────
    op.add_column("projects", sa.Column("builtmind_project_id", sa.Integer(), nullable=True))
    op.add_column("projects", sa.Column("builtmind_developer_id", sa.Integer(), nullable=True))
    op.create_unique_constraint(
        "uq_projects_builtmind_project_id", "projects", ["builtmind_project_id"]
    )
    op.create_index(
        "ix_projects_builtmind_project_id", "projects", ["builtmind_project_id"]
    )

    # ── Project: project_url (official API field, replaces derived logic) ────
    op.add_column("projects", sa.Column("project_url", sa.String(1024), nullable=True))
    # Reset any previously derived project_url data; repopulate from API on next import.
    op.execute("UPDATE projects SET project_url = NULL")

    # ── Project: construction_completion (raw "YYYY-MM" string from API) ─────
    op.add_column("projects", sa.Column("construction_completion", sa.String(20), nullable=True))
    # Reset completion_date: was never manually maintained; will be repopulated from
    # construction_completion on next import.
    op.execute("UPDATE projects SET completion_date = NULL")

    # ── Project: recuperation/cooling boolean -> varchar(50) ─────────────────
    # Preserves existing true/false values as strings.
    op.alter_column(
        "projects",
        "recuperation",
        type_=sa.String(50),
        existing_type=sa.Boolean(),
        existing_nullable=True,
        postgresql_using="CASE WHEN recuperation IS NULL THEN NULL "
                         "WHEN recuperation THEN 'true' ELSE 'false' END",
    )
    op.alter_column(
        "projects",
        "cooling",
        type_=sa.String(50),
        existing_type=sa.Boolean(),
        existing_nullable=True,
        postgresql_using="CASE WHEN cooling IS NULL THEN NULL "
                         "WHEN cooling THEN 'true' ELSE 'false' END",
    )

    # ── Unit: rename usage -> use_type ────────────────────────────────────────
    op.add_column("units", sa.Column("use_type", sa.String(255), nullable=True))
    op.execute("UPDATE units SET use_type = usage WHERE usage IS NOT NULL")
    op.drop_column("units", "usage")

    # ── Unit: new reservation / stale-reservation fields ─────────────────────
    op.add_column("units", sa.Column("reserved_date", sa.Date(), nullable=True))
    op.add_column("units", sa.Column("reservation_duration_days", sa.Integer(), nullable=True))
    op.add_column("units", sa.Column("is_stale_reservation", sa.Boolean(), nullable=True))


def downgrade() -> None:
    # Unit: reverse reservation fields
    op.drop_column("units", "is_stale_reservation")
    op.drop_column("units", "reservation_duration_days")
    op.drop_column("units", "reserved_date")

    # Unit: rename use_type back to usage
    op.add_column("units", sa.Column("usage", sa.String(255), nullable=True))
    op.execute("UPDATE units SET usage = use_type WHERE use_type IS NOT NULL")
    op.drop_column("units", "use_type")

    # Project: reverse recuperation/cooling to boolean
    op.alter_column(
        "projects",
        "cooling",
        type_=sa.Boolean(),
        existing_type=sa.String(50),
        existing_nullable=True,
        postgresql_using="CASE WHEN cooling IS NULL THEN NULL "
                         "WHEN cooling = 'true' THEN TRUE ELSE FALSE END",
    )
    op.alter_column(
        "projects",
        "recuperation",
        type_=sa.Boolean(),
        existing_type=sa.String(50),
        existing_nullable=True,
        postgresql_using="CASE WHEN recuperation IS NULL THEN NULL "
                         "WHEN recuperation = 'true' THEN TRUE ELSE FALSE END",
    )

    op.drop_column("projects", "construction_completion")
    op.drop_column("projects", "project_url")
    op.drop_index("ix_projects_builtmind_project_id", table_name="projects")
    op.drop_constraint("uq_projects_builtmind_project_id", "projects", type_="unique")
    op.drop_column("projects", "builtmind_developer_id")
    op.drop_column("projects", "builtmind_project_id")

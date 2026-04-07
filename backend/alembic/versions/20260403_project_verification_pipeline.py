"""project verification pipeline schema

Revision ID: 20260403_proj_verif_pipe
Revises: 20260402_scoring_thresholds
Create Date: 2026-04-03
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260403_proj_verif_pipe"
down_revision = "20260316_walk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    project_columns = {col["name"] for col in inspector.get_columns("projects")}

    if "completion_standard" not in project_columns:
        op.add_column("projects", sa.Column("completion_standard", sa.String(length=255), nullable=True))
    if "heating_source" not in project_columns:
        op.add_column("projects", sa.Column("heating_source", sa.String(length=255), nullable=True))
    if "parking_type" not in project_columns:
        op.add_column("projects", sa.Column("parking_type", sa.String(length=255), nullable=True))
    if "ev_charging" not in project_columns:
        op.add_column("projects", sa.Column("ev_charging", sa.String(length=50), nullable=True))
    if "assignment_possible" not in project_columns:
        op.add_column("projects", sa.Column("assignment_possible", sa.String(length=50), nullable=True))
    if "reservation_policy" not in project_columns:
        op.add_column("projects", sa.Column("reservation_policy", sa.Text(), nullable=True))

    if "project_verification_records" not in inspector.get_table_names():
        op.create_table(
            "project_verification_records",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("verification_status", sa.String(length=50), nullable=True),
            sa.Column("source_type", sa.String(length=50), nullable=True),
            sa.Column("source_note", sa.Text(), nullable=True),
            sa.Column("verified_at", sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column("verified_by", sa.String(length=255), nullable=True),
            sa.Column("import_action", sa.String(length=50), nullable=True),
            sa.Column("import_note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    existing_indexes = {idx["name"] for idx in inspector.get_indexes("project_verification_records")} if "project_verification_records" in inspector.get_table_names() else set()
    if "ix_project_verification_records_project_id" not in existing_indexes:
        op.create_index(
            "ix_project_verification_records_project_id",
            "project_verification_records",
            ["project_id"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index("ix_project_verification_records_project_id", table_name="project_verification_records")
    op.drop_table("project_verification_records")

    op.drop_column("projects", "reservation_policy")
    op.drop_column("projects", "assignment_possible")
    op.drop_column("projects", "ev_charging")
    op.drop_column("projects", "parking_type")
    op.drop_column("projects", "heating_source")
    op.drop_column("projects", "completion_standard")

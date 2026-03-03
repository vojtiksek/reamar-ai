from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "9b7c2f3d4e8f"
down_revision: Union[str, None] = "9a3b1a2c4d6e"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.add_column("project_aggregates", sa.Column("min_parking_indoor_price_czk", sa.Integer(), nullable=True))
  op.add_column("project_aggregates", sa.Column("max_parking_indoor_price_czk", sa.Integer(), nullable=True))
  op.add_column("project_aggregates", sa.Column("min_parking_outdoor_price_czk", sa.Integer(), nullable=True))
  op.add_column("project_aggregates", sa.Column("max_parking_outdoor_price_czk", sa.Integer(), nullable=True))
  op.add_column("project_aggregates", sa.Column("project_first_seen", sa.Date(), nullable=True))
  op.add_column("project_aggregates", sa.Column("project_last_seen", sa.Date(), nullable=True))
  op.add_column("project_aggregates", sa.Column("max_days_on_market", sa.Integer(), nullable=True))
  op.add_column("project_aggregates", sa.Column("min_payment_contract", sa.Numeric(6, 4), nullable=True))
  op.add_column("project_aggregates", sa.Column("max_payment_contract", sa.Numeric(6, 4), nullable=True))
  op.add_column("project_aggregates", sa.Column("min_payment_construction", sa.Numeric(6, 4), nullable=True))
  op.add_column("project_aggregates", sa.Column("max_payment_construction", sa.Numeric(6, 4), nullable=True))
  op.add_column("project_aggregates", sa.Column("min_payment_occupancy", sa.Numeric(6, 4), nullable=True))
  op.add_column("project_aggregates", sa.Column("max_payment_occupancy", sa.Numeric(6, 4), nullable=True))


def downgrade() -> None:
  op.drop_column("project_aggregates", "max_payment_occupancy")
  op.drop_column("project_aggregates", "min_payment_occupancy")
  op.drop_column("project_aggregates", "max_payment_construction")
  op.drop_column("project_aggregates", "min_payment_construction")
  op.drop_column("project_aggregates", "max_payment_contract")
  op.drop_column("project_aggregates", "min_payment_contract")
  op.drop_column("project_aggregates", "max_days_on_market")
  op.drop_column("project_aggregates", "project_last_seen")
  op.drop_column("project_aggregates", "project_first_seen")
  op.drop_column("project_aggregates", "max_parking_outdoor_price_czk")
  op.drop_column("project_aggregates", "min_parking_outdoor_price_czk")
  op.drop_column("project_aggregates", "max_parking_indoor_price_czk")
  op.drop_column("project_aggregates", "min_parking_indoor_price_czk")


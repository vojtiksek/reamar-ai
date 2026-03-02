from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    TIMESTAMP,
    UniqueConstraint,
    Index,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    """Base class for all ORM models."""


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint(
            "developer",
            "name",
            "address",
            name="uq_project_developer_name_address",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    developer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    municipality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    district: Mapped[str | None] = mapped_column(String(255), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cadastral_area_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    administrative_district_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gps_latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 8), nullable=True)
    gps_longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 8), nullable=True)
    ride_to_center_min: Mapped[Decimal | None] = mapped_column(Numeric(10, 1), nullable=True)
    public_transport_to_center_min: Mapped[Decimal | None] = mapped_column(Numeric(10, 1), nullable=True)
    permit_regular: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    renovation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    overall_quality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    windows: Mapped[str | None] = mapped_column(String(255), nullable=True)
    heating: Mapped[str | None] = mapped_column(String(255), nullable=True)
    partition_walls: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amenities: Mapped[str | None] = mapped_column(Text, nullable=True)

    units: Mapped[list["Unit"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    overrides: Mapped[list["ProjectOverride"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"),
        nullable=False,
    )

    unit_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    layout: Mapped[str | None] = mapped_column(String(255), nullable=True)
    floor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    availability_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    available: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )

    price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_per_m2_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_change: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    original_price_czk: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    original_price_per_m2_czk: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    parking_indoor_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parking_outdoor_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)

    floor_area_m2: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )
    total_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 1), nullable=True)
    equivalent_area_m2: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )
    exterior_area_m2: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )
    balcony_area_m2: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )
    terrace_area_m2: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )
    garden_area_m2: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )

    gps_latitude: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 8),
        nullable=True,
    )
    gps_longitude: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 8),
        nullable=True,
    )

    ride_to_center_min: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )
    public_transport_to_center_min: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 1),
        nullable=True,
    )

    days_on_market: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payment_contract: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    payment_construction: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    payment_occupancy: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)

    first_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    sold_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    permit_regular: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    renovation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    air_conditioning: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    cooling_ceilings: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    exterior_blinds: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    smart_home: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    orientation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sale_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    building: Mapped[str | None] = mapped_column(String(255), nullable=True)
    floors: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amenities: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage: Mapped[str | None] = mapped_column(String(255), nullable=True)
    building_use: Mapped[str | None] = mapped_column(String(255), nullable=True)
    windows: Mapped[str | None] = mapped_column(String(255), nullable=True)
    heating: Mapped[str | None] = mapped_column(String(255), nullable=True)
    partition_walls: Mapped[str | None] = mapped_column(String(255), nullable=True)
    overall_quality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cadastral_area_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    municipal_district_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    administrative_district_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    district_okres_iga: Mapped[str | None] = mapped_column(String(255), nullable=True)
    district: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    municipality: Mapped[str | None] = mapped_column(String(255), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    developer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    raw_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    project: Mapped["Project"] = relationship(back_populates="units")
    overrides: Mapped[list["UnitOverride"]] = relationship(
        back_populates="unit",
        cascade="all, delete-orphan",
    )
    price_history: Mapped[list["UnitPriceHistory"]] = relationship(
        back_populates="unit",
        cascade="all, delete-orphan",
    )


class UnitOverride(Base):
    __tablename__ = "unit_overrides"
    __table_args__ = (
        UniqueConstraint(
            "unit_id",
            "field",
            name="uq_unit_override_unit_field",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    unit_id: Mapped[int] = mapped_column(
        ForeignKey("units.id"),
        nullable=False,
    )
    field: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)

    unit: Mapped["Unit"] = relationship(back_populates="overrides")


class ProjectOverride(Base):
    __tablename__ = "project_overrides"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "field",
            name="uq_project_override_project_field",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"),
        nullable=False,
    )
    field: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="overrides")


class UnitSnapshot(Base):
    __tablename__ = "unit_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    imported_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)


class UnitPriceHistory(Base):
    __tablename__ = "unit_price_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    unit_id: Mapped[int] = mapped_column(
        ForeignKey("units.id"),
        nullable=False,
    )
    captured_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_per_m2_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    availability_status: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )
    available: Mapped[bool] = mapped_column(Boolean, nullable=False)

    unit: Mapped["Unit"] = relationship(back_populates="price_history")


class ProjectAggregates(Base):
    __tablename__ = "project_aggregates"

    project_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("projects.id"),
        primary_key=True,
    )
    total_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    available_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    availability_ratio: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    avg_price_czk: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    min_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_price_per_m2_czk: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    avg_floor_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    project: Mapped["Project"] = relationship("Project")


# Indexes
Index("ix_units_project_id", Unit.project_id)
Index("ix_units_price_per_m2_czk", Unit.price_per_m2_czk)
Index(
    "ix_unit_price_history_unit_id_captured_at_desc",
    UnitPriceHistory.unit_id,
    UnitPriceHistory.captured_at.desc(),
)



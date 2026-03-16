from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    Float,
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

    # Projektové standardy – ručně editovaná pole s připravenou podporou pro budoucí import.
    # Effective hodnota = override (ProjectOverride) pokud existuje, jinak Project.* (import/base).
    ceiling_height: Mapped[str | None] = mapped_column(String(50), nullable=True)
    recuperation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    cooling: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Projektové amenities – booleany; platí stejný princip override > base.
    concierge: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reception: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    bike_room: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    stroller_room: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    fitness: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    courtyard_garden: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Hluk – numerické hodnoty v dB + metadata o zdroji/výpočtu,
    # ukládáno pouze pro projekty v Praze (region_iga = 'Hlavní město Praha').
    noise_day_db: Mapped[float | None] = mapped_column(Float, nullable=True)
    noise_night_db: Mapped[float | None] = mapped_column(Float, nullable=True)
    noise_source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    noise_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    noise_updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    noise_label: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Mikro-lokalita / noise exposure – vzdálenosti k dopravě + souhrnné skóre (batch z OSM).
    distance_to_primary_road_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_tram_tracks_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_railway_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_airport_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    micro_location_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    micro_location_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    micro_location_updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    micro_location_source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    micro_location_method: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Walkability (POI distances, counts 500 m, sub-scores; separate from micro_location)
    distance_to_supermarket_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_drugstore_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_pharmacy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_atm_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_post_office_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_tram_stop_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_bus_stop_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_metro_station_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_train_station_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_restaurant_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_cafe_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_park_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_fitness_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_playground_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_kindergarten_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_primary_school_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_pediatrician_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    walking_distance_to_tram_stop_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    walking_distance_to_bus_stop_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    walking_distance_to_metro_station_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    walkability_walking_fallback_used: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    count_supermarket_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_drugstore_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_pharmacy_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_atm_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_post_office_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_restaurant_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_cafe_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_park_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_fitness_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_playground_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_kindergarten_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_primary_school_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    count_pediatrician_500m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    walkability_daily_needs_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    walkability_transport_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    walkability_leisure_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    walkability_family_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    walkability_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    walkability_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    walkability_updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    walkability_source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    walkability_method: Mapped[str | None] = mapped_column(String(64), nullable=True)

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

    # Lokální cenová odchylka (procentní rozdíl vůči trhu v okolí, v p.b.).
    # Hodnoty se počítají offline (skript / cron) z effective price_per_m2_czk.
    local_price_diff_500m: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 2),
        nullable=True,
    )
    local_price_diff_1000m: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 2),
        nullable=True,
    )
    local_price_diff_2000m: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 2),
        nullable=True,
    )

    first_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    sold_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    permit_regular: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    renovation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    air_conditioning: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    cooling_ceilings: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    exterior_blinds: Mapped[str | None] = mapped_column(String(50), nullable=True)  # "true" | "false" | "preparation"
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
    api_pending: Mapped[list["UnitApiPending"]] = relationship(
        back_populates="unit",
        cascade="all, delete-orphan",
    )


class Broker(Base):
    __tablename__ = "brokers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'broker'"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    clients: Mapped[list["Client"]] = relationship(
        back_populates="broker",
        cascade="all, delete-orphan",
    )


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    broker_id: Mapped[int] = mapped_column(ForeignKey("brokers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'new'"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        server_onupdate=func.now(),
    )

    broker: Mapped["Broker"] = relationship(back_populates="clients")
    profile: Mapped["ClientProfile"] = relationship(
        back_populates="client",
        uselist=False,
        cascade="all, delete-orphan",
    )
    recommendations: Mapped[list["ClientRecommendation"]] = relationship(
        back_populates="client",
        cascade="all, delete-orphan",
    )


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, unique=True)

    budget_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    budget_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    area_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    layouts: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    property_type: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'any'"))
    purchase_purpose: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'own_use'"))

    walkability_preferences_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    filter_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    polygon_geojson: Mapped[str | None] = mapped_column(Text, nullable=True)
    commute_points_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        server_onupdate=func.now(),
    )

    client: Mapped["Client"] = relationship(back_populates="profile")


class ClientRecommendation(Base):
    __tablename__ = "client_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("units.id"), nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    reason_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    pinned_by_broker: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    hidden_by_broker: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'suggested'"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    client: Mapped["Client"] = relationship(back_populates="recommendations")
    unit: Mapped["Unit"] = relationship()
    project: Mapped["Project"] = relationship()


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


class UnitApiPending(Base):
    """Čekající hodnota z API (cena, cena/m², stav) – liší se od aktuální/ruční; uživatel si zvolí."""
    __tablename__ = "unit_api_pending"
    __table_args__ = (
        UniqueConstraint("unit_id", "field", name="uq_unit_api_pending_unit_field"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    unit_id: Mapped[int] = mapped_column(
        ForeignKey("units.id"),
        nullable=False,
    )
    field: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    unit: Mapped["Unit"] = relationship("Unit", back_populates="api_pending")


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
    # Parking price aggregates (Kč)
    min_parking_indoor_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_parking_indoor_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_parking_outdoor_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_parking_outdoor_price_czk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Time/status aggregates
    project_first_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    project_last_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    max_days_on_market: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Payment scheme aggregates (fractions 0–1)
    min_payment_contract: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    max_payment_contract: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    min_payment_construction: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    max_payment_construction: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    min_payment_occupancy: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    max_payment_occupancy: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
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



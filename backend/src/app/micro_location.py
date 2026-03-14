"""
Micro-location / noise exposure: distances to OSM transport layers + composite score.

Data are stored on Project; computed in batch from OSM geometry tables (osm_primary_roads,
osm_tram_tracks, osm_railways, osm_airports). Uses PostGIS ST_Distance(geography) for meters.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Column, Float, Integer, String, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Mapped, Session, declarative_base, mapped_column
from sqlalchemy.sql import func

from .models import Project

Base = declarative_base()


# ---------------------------------------------------------------------------
# OSM geometry tables (lines for roads/tram/railway, geometry for airport)
# ---------------------------------------------------------------------------

class OsmPrimaryRoad(Base):
    __tablename__ = "osm_primary_roads"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    osm_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    geom = Column("geom")  # type: ignore[assignment]  # geometry(Geometry, 4326)


class OsmTramTracks(Base):
    __tablename__ = "osm_tram_tracks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    osm_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    geom = Column("geom")  # type: ignore[assignment]


class OsmRailway(Base):
    __tablename__ = "osm_railways"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    osm_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    geom = Column("geom")  # type: ignore[assignment]


class OsmAirport(Base):
    __tablename__ = "osm_airports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    osm_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    geom = Column("geom")  # type: ignore[assignment]  # polygon or point


# ---------------------------------------------------------------------------
# Score configuration: thresholds (meters) and penalties. Transparent, tunable.
# Base score 100; each penalty is negative; final score = 100 + sum(penalties), clamped 0–100.
# ---------------------------------------------------------------------------

MICRO_LOCATION_SCORE_CONFIG = {
    "base_score": 100,
    "noise_label_penalties": {
        "Nízký": 0,
        "Střední": -2,
        "Vyšší": -5,
        "Vysoký": -8,
    },
    "distance_to_primary_road_m": [
        (30, -6),
        (80, -4),
        (150, -2),
        (float("inf"), 0),
    ],
    "distance_to_tram_tracks_m": [
        (20, -5),
        (60, -3),
        (120, -1),
        (float("inf"), 0),
    ],
    "distance_to_railway_m": [
        (50, -6),
        (150, -3),
        (float("inf"), 0),
    ],
    "distance_to_airport_m": [
        (3000, -4),
        (7000, -2),
        (float("inf"), 0),
    ],
}

MICRO_LOCATION_LABEL_THRESHOLDS = [
    (80, "Výborná"),
    (60, "Dobrá"),
    (40, "Horší"),
    (0, "Riziková"),
]


def _penalty_for_distance(distance_m: Optional[float], bands: list[tuple[float, int]]) -> int:
    """Return penalty (<=0) for a distance; None/missing distance = no penalty (0)."""
    if distance_m is None:
        return 0
    for threshold_m, penalty in bands:
        if distance_m < threshold_m:
            return penalty
    return 0


def _penalty_for_noise_label(label: Optional[str]) -> int:
    penalties = MICRO_LOCATION_SCORE_CONFIG["noise_label_penalties"]
    if not label or label not in penalties:
        return 0
    return penalties[label]


def _score_to_label(score: int) -> str:
    for threshold, label in MICRO_LOCATION_LABEL_THRESHOLDS:
        if score >= threshold:
            return label
    return "Riziková"


def _nearest_distance_m(
    db: Session,
    table_name: str,
    geom_column: str,
    lon: float,
    lat: float,
    limit_m: float = 50_000,
) -> Optional[float]:
    """
    Nearest distance in meters from point (lon, lat) to geometries in table.
    Uses ST_DWithin on geography for performance, then MIN(ST_Distance).
    """
    # ST_DWithin(geography, geography, meters) for index-friendly filter
    sql = text(
        f"""
        SELECT MIN(
            ST_Distance(
                geom::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
            )
        ) AS d
        FROM {table_name}
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :limit_m
        )
        """
    )
    try:
        row = db.execute(
            sql,
            {"lon": lon, "lat": lat, "limit_m": limit_m},
        ).first()
    except DBAPIError:
        return None
    if row is None or row[0] is None:
        return None
    return float(row[0])


def compute_project_micro_location(db: Session, project: Project) -> None:
    """
    Compute distances to OSM layers + micro_location_score and micro_location_label;
    persist on project. Uses existing noise_label if present.
    """
    lat = project.gps_latitude
    lon = project.gps_longitude
    if lat is None or lon is None:
        _clear_micro_location(project)
        return

    lon_f = float(lon)
    lat_f = float(lat)

    # Distances in meters (None if table empty or error)
    d_road = _nearest_distance_m(db, "osm_primary_roads", "geom", lon_f, lat_f)
    d_tram = _nearest_distance_m(db, "osm_tram_tracks", "geom", lon_f, lat_f)
    d_rail = _nearest_distance_m(db, "osm_railways", "geom", lon_f, lat_f)
    d_air = _nearest_distance_m(db, "osm_airports", "geom", lon_f, lat_f, limit_m=100_000)

    project.distance_to_primary_road_m = d_road
    project.distance_to_tram_tracks_m = d_tram
    project.distance_to_railway_m = d_rail
    project.distance_to_airport_m = d_air

    # Score: base + penalties (noise + distances)
    base = MICRO_LOCATION_SCORE_CONFIG["base_score"]
    p_noise = _penalty_for_noise_label(project.noise_label)
    p_road = _penalty_for_distance(
        d_road,
        MICRO_LOCATION_SCORE_CONFIG["distance_to_primary_road_m"],
    )
    p_tram = _penalty_for_distance(
        d_tram,
        MICRO_LOCATION_SCORE_CONFIG["distance_to_tram_tracks_m"],
    )
    p_rail = _penalty_for_distance(
        d_rail,
        MICRO_LOCATION_SCORE_CONFIG["distance_to_railway_m"],
    )
    p_air = _penalty_for_distance(
        d_air,
        MICRO_LOCATION_SCORE_CONFIG["distance_to_airport_m"],
    )

    total_penalty = p_noise + p_road + p_tram + p_rail + p_air
    score = max(0, min(100, base + total_penalty))
    project.micro_location_score = int(score)
    project.micro_location_label = _score_to_label(project.micro_location_score)
    project.micro_location_updated_at = datetime.now(timezone.utc)
    project.micro_location_source = "osm_geometry"
    project.micro_location_method = "st_distance_geography"


def _clear_micro_location(project: Project) -> None:
    project.distance_to_primary_road_m = None
    project.distance_to_tram_tracks_m = None
    project.distance_to_railway_m = None
    project.distance_to_airport_m = None
    project.micro_location_score = None
    project.micro_location_label = None
    project.micro_location_updated_at = None
    project.micro_location_source = None
    project.micro_location_method = None

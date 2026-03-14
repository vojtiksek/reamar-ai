from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, Float, Integer, String, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Mapped, Session, declarative_base, mapped_column
from sqlalchemy.sql import func

from .models import Project

Base = declarative_base()


class NoiseMapPolygon(Base):
    """
    Simple PostGIS-backed polygon table for Prague noise map.

    Data are expected to come from the official Prague strategic noise map
    (Geoportál / Atlas ŽP), preprocessed offline into EPSG:4326 polygons.

    The corresponding DB table is created by Alembic migrations:
    - initially with TEXT geom
    - then converted to geometry(Polygon, 4326) once PostGIS is installed.
    """

    __tablename__ = "noise_map_polygons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    noise_db: Mapped[float] = mapped_column(Float, nullable=False)
    noise_type: Mapped[str] = mapped_column(String(16), nullable=False)  # "day" | "night"
    # Geometry column; in a PostGIS-enabled DB this is geometry(Polygon, 4326).
    # We intentionally keep a generic SQLAlchemy type here and rely on PostGIS
    # functions (ST_Contains / ST_GeomFromGeoJSON) at runtime.
    geom = Column("geom")  # type: ignore[assignment]


def _classify_noise_label(day_db: Optional[float], night_db: Optional[float]) -> Optional[str]:
    """
    Map numeric dB to a coarse label for UI.
    Uses day value when available, otherwise night.
    """

    value: Optional[float] = day_db if day_db is not None else night_db
    if value is None:
        return None
    if value < 50:
        return "Nízký"
    if value < 60:
        return "Střední"
    if value < 70:
        return "Vyšší"
    return "Vysoký"


def compute_project_noise(db: Session, project: Project) -> None:
    """
    Compute and persist noise information for a single project.

    - If project has no GPS → sets noise_* to NULL.
    - If project is not in Prague (region_iga != 'Hlavní město Praha') → noise_* = NULL.
    - Otherwise performs point-in-polygon lookup against noise_map_polygons
      for both day and night layers using PostGIS ST_Contains.
    """

    lat = project.gps_latitude
    lon = project.gps_longitude
    if lat is None or lon is None:
        project.noise_day_db = None
        project.noise_night_db = None
        project.noise_source = None
        project.noise_method = None
        project.noise_updated_at = None
        project.noise_label = None
        return

    # Only compute for Prague – other regions keep NULL to avoid mixing other cities' maps.
    if (project.region_iga or "").strip() != "Hlavní město Praha":
        project.noise_day_db = None
        project.noise_night_db = None
        project.noise_source = None
        project.noise_method = None
        project.noise_updated_at = None
        project.noise_label = None
        return

    point = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)

    # If the noise map is not loaded yet, bail out quickly.
    try:
        total_polygons = (
            db.execute(select(func.count()).select_from(NoiseMapPolygon))
            .scalar_one()
        )
    except DBAPIError:
        # Most likely PostGIS functions/types are not available yet; leave noise as NULL.
        project.noise_day_db = None
        project.noise_night_db = None
        project.noise_source = None
        project.noise_method = None
        project.noise_updated_at = None
        project.noise_label = None
        return

    if not total_polygons:
        project.noise_day_db = None
        project.noise_night_db = None
        project.noise_source = None
        project.noise_method = None
        project.noise_updated_at = None
        project.noise_label = None
        return

    def _lookup(noise_type: str) -> Optional[float]:
        try:
            row = (
                db.execute(
                    select(NoiseMapPolygon.noise_db)
                    .where(NoiseMapPolygon.noise_type == noise_type)
                    # ST_Covers: polygon covers point including boundary
                    .where(func.ST_Covers(NoiseMapPolygon.geom, point))
                    .limit(1)
                )
                .scalars()
                .first()
            )
        except DBAPIError:
            # If PostGIS is misconfigured, fail gracefully and propagate "no data".
            return None
        return float(row) if row is not None else None

    day_db = _lookup("day")
    night_db = _lookup("night")

    project.noise_day_db = day_db
    project.noise_night_db = night_db

    if day_db is not None or night_db is not None:
        # We only set metadata + updated_at when we have actual noise data.
        project.noise_source = "geoportal_praha_noise_map"
        project.noise_method = "point_in_polygon"
        project.noise_updated_at = datetime.now(timezone.utc)
        project.noise_label = _classify_noise_label(day_db, night_db)
    else:
        # No polygon hit – keep metadata empty.
        project.noise_source = None
        project.noise_method = None
        project.noise_updated_at = None
        project.noise_label = None


"""boundary_areas — cached geographic boundaries from OSM Nominatim.

Backs the unified "Oblast" filter used in /explorer/{projects,units,map}.
Broker types "Praha 8" → resolve_area_by_name() either returns a cached
row or fetches the polygon from Nominatim and inserts. Subsequent queries
hit the cache.

We always store as MultiPolygon (Nominatim returns Polygon for some
areas, MultiPolygon for others — single type makes downstream PostGIS
filter code simpler).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import requests
from sqlalchemy import BigInteger, Column, Float, Integer, String, TIMESTAMP, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Mapped, Session, declarative_base, mapped_column

logger = logging.getLogger(__name__)

Base = declarative_base()

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": "reamar-ai/1.0 (broker app, contact: vojtech.sommer@me.com)"
}
NOMINATIM_TIMEOUT_S = 8


class BoundaryArea(Base):
    """One administrative or named geographic area (Praha 8, Vinohrady, Stodůlky).

    PostGIS geom is geometry(MultiPolygon, 4326). We never touch it via
    SQLAlchemy attribute setting — inserts go through raw SQL with
    ST_GeomFromGeoJSON, reads happen via ST_Contains in filter queries.
    """

    __tablename__ = "boundary_areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="nominatim")
    osm_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    osm_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    bbox_south: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bbox_north: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bbox_west: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bbox_east: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    # PostGIS geometry column — accessed via raw SQL (ST_Contains etc.).
    geom = Column("geom")  # type: ignore[assignment]


def _to_multipolygon(geom: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize Polygon → MultiPolygon. Returns None if shape isn't usable."""
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not isinstance(coords, list):
        return None
    if gtype == "MultiPolygon":
        return geom
    if gtype == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [coords]}
    return None


def _fetch_from_nominatim(query: str) -> dict[str, Any] | None:
    """One Nominatim call; returns the first administrative-class match with
    a polygon geometry, or None if nothing usable came back."""
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={
                "q": query,
                "format": "json",
                "polygon_geojson": 1,
                "limit": 5,
                "countrycodes": "cz",
                "addressdetails": 0,
            },
            headers=NOMINATIM_HEADERS,
            timeout=NOMINATIM_TIMEOUT_S,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Nominatim lookup for %r failed: %s", query, exc)
        return None

    items = resp.json() or []
    for item in items:
        if item.get("class") != "boundary" or item.get("type") != "administrative":
            continue
        geojson = item.get("geojson")
        if not isinstance(geojson, dict):
            continue
        multi = _to_multipolygon(geojson)
        if multi is None:
            continue
        bbox = item.get("boundingbox")
        bounds: dict[str, float] | None = None
        if isinstance(bbox, list) and len(bbox) == 4:
            try:
                bounds = {
                    "south": float(bbox[0]),
                    "north": float(bbox[1]),
                    "west": float(bbox[2]),
                    "east": float(bbox[3]),
                }
            except (TypeError, ValueError):
                bounds = None
        return {
            "display_name": item.get("display_name"),
            "geometry": multi,
            "bounds": bounds,
            "osm_type": item.get("osm_type"),
            "osm_id": item.get("osm_id"),
        }
    return None


def resolve_area_by_name(db: Session, name: str) -> Optional[BoundaryArea]:
    """Return a cached area row by name (case-insensitive). If missing, fetch
    from Nominatim, insert, return. Returns None when Nominatim has nothing
    usable for the query."""
    normalized = name.strip()
    if not normalized:
        return None

    cached = db.execute(
        select(BoundaryArea).where(func_lower_eq(BoundaryArea.name, normalized))
    ).scalars().first()
    if cached is not None:
        cached.last_used_at = datetime.now(timezone.utc)
        db.add(cached)
        return cached

    fetched = _fetch_from_nominatim(normalized)
    if fetched is None:
        return None

    geom_json = json.dumps(fetched["geometry"])
    bounds = fetched.get("bounds") or {}
    osm_id = fetched.get("osm_id")
    try:
        result = db.execute(
            text(
                """
                INSERT INTO boundary_areas
                  (name, display_name, source, osm_type, osm_id,
                   bbox_south, bbox_north, bbox_west, bbox_east, geom)
                VALUES
                  (:name, :display_name, :source, :osm_type, :osm_id,
                   :bs, :bn, :bw, :be,
                   ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326)))
                RETURNING id
                """
            ),
            {
                "name": normalized,
                "display_name": fetched.get("display_name"),
                "source": "nominatim",
                "osm_type": fetched.get("osm_type"),
                "osm_id": int(osm_id) if osm_id is not None else None,
                "bs": bounds.get("south"),
                "bn": bounds.get("north"),
                "bw": bounds.get("west"),
                "be": bounds.get("east"),
                "geom": geom_json,
            },
        )
        new_id = result.scalar()
        db.commit()
    except DBAPIError as exc:
        db.rollback()
        logger.warning("Failed to cache boundary for %r: %s", normalized, exc)
        return None

    return db.get(BoundaryArea, new_id)


def get_area_geometry_geojson(db: Session, area_id: int) -> dict[str, Any] | None:
    """Return the area's geometry as a GeoJSON dict (for map highlight on the
    frontend). Reads from the geom column via ST_AsGeoJSON."""
    row = db.execute(
        text("SELECT ST_AsGeoJSON(geom) FROM boundary_areas WHERE id = :id"),
        {"id": area_id},
    ).scalar()
    if not row:
        return None
    try:
        return json.loads(row)
    except (TypeError, ValueError):
        return None


def count_projects_in_area(db: Session, area_id: int) -> int:
    """Number of projects with GPS that fall inside the area's polygon.
    Used by the frontend chip label "Praha 8 (134)"."""
    try:
        result = db.execute(
            text(
                """
                SELECT count(*) FROM projects p, boundary_areas b
                WHERE b.id = :id
                  AND p.gps_latitude IS NOT NULL
                  AND p.gps_longitude IS NOT NULL
                  AND ST_Contains(
                    b.geom,
                    ST_SetSRID(ST_MakePoint(p.gps_longitude, p.gps_latitude), 4326)
                  )
                """
            ),
            {"id": area_id},
        ).scalar()
        return int(result or 0)
    except DBAPIError:
        return 0


def func_lower_eq(column: Any, value: str) -> Any:
    """Case-insensitive equality predicate using the lower() expression that
    matches the partial unique index in the boundary_areas migration."""
    from sqlalchemy import func as _func

    return _func.lower(column) == value.lower()

"""
Download OSM infrastructure data from Overpass API and store in PostGIS tables.

Used for micro-location: primary roads, tram tracks, railways, airports.
No intermediate GeoJSON files; direct Overpass API -> DB.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from .location_sources import OSM_LAYER_TO_TABLE
from .project_location_metrics import recompute_all_project_location_metrics

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Praha + okolí (south, west, north, east)
BBOX = (49.95, 14.1, 50.2, 14.8)


def _overpass_query(query: str) -> dict[str, Any]:
    """Run Overpass query and return JSON. Raises on HTTP or API error."""
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        timeout=120,
        headers={"Accept": "application/json"},
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Overpass API error: {data.get('error', data)}")
    return data


def _way_geometry_to_geojson_linestring(geometry: list[dict[str, float]]) -> dict[str, Any] | None:
    """Convert Overpass way geometry [{"lat", "lon"}, ...] to GeoJSON LineString."""
    if not geometry or len(geometry) < 2:
        return None
    coords = [[float(p["lon"]), float(p["lat"])] for p in geometry]
    return {"type": "LineString", "coordinates": coords}


def _node_to_geojson_point(lat: float, lon: float) -> dict[str, Any]:
    return {"type": "Point", "coordinates": [float(lon), float(lat)]}


def _insert_geometries(
    db: Session,
    table: str,
    rows: list[tuple[int | None, dict[str, Any]]],
) -> int:
    """Insert (osm_id, geojson_geom) rows into table. Returns inserted count."""
    if not rows:
        return 0
    inserted = 0
    for osm_id, geom in rows:
        geom_json = json.dumps(geom)
        db.execute(
            text(
                """
                INSERT INTO {table} (osm_id, geom)
                VALUES (:osm_id, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))
                """
            ).format(table=table),
            {"osm_id": osm_id, "geom": geom_json},
        )
        inserted += 1
    return inserted


def download_osm_primary_roads(db: Session) -> int:
    """
    Download highway=motorway|trunk|primary in bbox from Overpass, insert into osm_primary_roads.
    Returns inserted count.
    """
    south, west, north, east = BBOX
    query = f"""
[out:json][timeout:90];
(
  way["highway"="motorway"]({south},{west},{north},{east});
  way["highway"="trunk"]({south},{west},{north},{east});
  way["highway"="primary"]({south},{west},{north},{east});
);
out geom;
"""
    data = _overpass_query(query)
    table = OSM_LAYER_TO_TABLE["primary_roads"]
    rows: list[tuple[int | None, dict[str, Any]]] = []
    for el in data.get("elements") or []:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom:
            continue
        geojson = _way_geometry_to_geojson_linestring(geom)
        if geojson:
            rows.append((el.get("id"), geojson))
    count = _insert_geometries(db, table, rows)
    logger.info("download_osm_primary_roads: inserted %s", count)
    return count


def download_osm_tram_tracks(db: Session) -> int:
    """Download railway=tram in bbox, insert into osm_tram_tracks. Returns inserted count."""
    south, west, north, east = BBOX
    query = f"""
[out:json][timeout:90];
way["railway"="tram"]({south},{west},{north},{east});
out geom;
"""
    data = _overpass_query(query)
    table = OSM_LAYER_TO_TABLE["tram_tracks"]
    rows: list[tuple[int | None, dict[str, Any]]] = []
    for el in data.get("elements") or []:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom:
            continue
        geojson = _way_geometry_to_geojson_linestring(geom)
        if geojson:
            rows.append((el.get("id"), geojson))
    count = _insert_geometries(db, table, rows)
    logger.info("download_osm_tram_tracks: inserted %s", count)
    return count


def download_osm_railways(db: Session) -> int:
    """Download railway=rail in bbox, insert into osm_railways. Returns inserted count."""
    south, west, north, east = BBOX
    query = f"""
[out:json][timeout:90];
way["railway"="rail"]({south},{west},{north},{east});
out geom;
"""
    data = _overpass_query(query)
    table = OSM_LAYER_TO_TABLE["railway"]
    rows: list[tuple[int | None, dict[str, Any]]] = []
    for el in data.get("elements") or []:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom:
            continue
        geojson = _way_geometry_to_geojson_linestring(geom)
        if geojson:
            rows.append((el.get("id"), geojson))
    count = _insert_geometries(db, table, rows)
    logger.info("download_osm_railways: inserted %s", count)
    return count


def download_osm_airports(db: Session) -> int:
    """
    Download aeroway=aerodrome (nodes and ways) in bbox, insert into osm_airports.
    Nodes -> Point; ways -> LineString (or Polygon if closed). Returns inserted count.
    """
    south, west, north, east = BBOX
    query = f"""
[out:json][timeout:90];
(
  node["aeroway"="aerodrome"]({south},{west},{north},{east});
  way["aeroway"="aerodrome"]({south},{west},{north},{east});
);
out geom;
"""
    data = _overpass_query(query)
    table = OSM_LAYER_TO_TABLE["airports"]
    rows: list[tuple[int | None, dict[str, Any]]] = []
    for el in data.get("elements") or []:
        osm_id = el.get("id")
        if el.get("type") == "node":
            lat, lon = el.get("lat"), el.get("lon")
            if lat is not None and lon is not None:
                rows.append((osm_id, _node_to_geojson_point(float(lat), float(lon))))
        elif el.get("type") == "way":
            geom = el.get("geometry")
            if geom:
                geojson = _way_geometry_to_geojson_linestring(geom)
                if geojson:
                    rows.append((osm_id, geojson))
    count = _insert_geometries(db, table, rows)
    logger.info("download_osm_airports: inserted %s", count)
    return count


def download_osm_sources_and_recompute(
    db: Session,
    *,
    batch_size: int = 200,
) -> dict[str, Any]:
    """
    1) Truncate all osm_* tables.
    2) Download primary roads, tram tracks, railways, airports from Overpass (Praha bbox).
    3) Run full recompute of project location metrics.

    Suitable for cron or manual trigger. No file paths required.
    """
    for table in OSM_LAYER_TO_TABLE.values():
        db.execute(text(f"TRUNCATE {table} RESTART IDENTITY"))

    counts = {
        "primary_roads": download_osm_primary_roads(db),
        "tram_tracks": download_osm_tram_tracks(db),
        "railways": download_osm_railways(db),
        "airports": download_osm_airports(db),
    }
    db.commit()

    recompute_result = recompute_all_project_location_metrics(db, batch_size=batch_size)
    return {
        "osm": counts,
        "recompute": recompute_result,
    }

"""
Download OSM data from Overpass API for micro-location (primary roads, tram, railway, airports).

No intermediate GeoJSON files: query Overpass, parse response, return elements ready for DB insert.
Used by download_osm_sources_and_recompute() in location_sources.py.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Praha + okolí: south, west, north, east
BBOX_PRAHA = (49.95, 14.1, 50.2, 14.8)
TIMEOUT_S = 120


def _bbox_str() -> str:
    south, west, north, east = BBOX_PRAHA
    return f"({south},{west},{north},{east})"


def _overpass_request(query: str) -> list[dict[str, Any]]:
    """POST query to Overpass API; returns list of elements (nodes/ways). Raises on HTTP or API error."""
    import time
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=TIMEOUT_S,
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            if "elements" not in data:
                return []
            return data["elements"]
        except requests.exceptions.RequestException as e:
            last_error = e
            if attempt == 0:
                logger.warning("Overpass request failed (%s), retrying in 15s...", e)
                time.sleep(15)
                continue
            raise
    raise last_error or RuntimeError("Overpass request failed")


def _element_to_geojson_geom(element: dict[str, Any]) -> dict[str, Any] | None:
    """
    Convert Overpass element (node or way with geometry) to GeoJSON geometry object.
    Returns {"type": "Point"|"LineString", "coordinates": ...} or None if no geometry.
    """
    el_type = element.get("type")
    if el_type == "node":
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            return None
        return {"type": "Point", "coordinates": [float(lon), float(lat)]}
    if el_type == "way":
        geometry = element.get("geometry")
        if not geometry or len(geometry) < 2:
            return None
        coords = [[float(p["lon"]), float(p["lat"])] for p in geometry]
        return {"type": "LineString", "coordinates": coords}
    return None


def _elements_to_rows(elements: list[dict[str, Any]]) -> list[tuple[int | None, dict[str, Any]]]:
    """Convert list of Overpass elements to list of (osm_id, geojson_geom) for DB insert."""
    rows: list[tuple[int | None, dict[str, Any]]] = []
    for el in elements:
        geom = _element_to_geojson_geom(el)
        if geom is None:
            continue
        osm_id = el.get("id")
        if isinstance(osm_id, (int, float)):
            osm_id = int(osm_id)
        else:
            osm_id = None
        rows.append((osm_id, geom))
    return rows


def download_osm_primary_roads() -> list[tuple[int | None, dict[str, Any]]]:
    """
    Download highway=motorway, trunk, primary in Praha bbox from Overpass.
    Returns list of (osm_id, geojson_geometry) for DB insert.
    """
    b = _bbox_str()
    query = f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["highway"="motorway"]{b};
  way["highway"="trunk"]{b};
  way["highway"="primary"]{b};
);
out body geom;
"""
    elements = _overpass_request(query)
    ways = [e for e in elements if e.get("type") == "way"]
    logger.info("Overpass primary_roads: %s ways", len(ways))
    return _elements_to_rows(ways)


def download_osm_tram_tracks() -> list[tuple[int | None, dict[str, Any]]]:
    """Download railway=tram in Praha bbox. Returns list of (osm_id, geojson_geometry)."""
    b = _bbox_str()
    query = f"""
[out:json][timeout:{TIMEOUT_S}];
way["railway"="tram"]{b};
out body geom;
"""
    elements = _overpass_request(query)
    ways = [e for e in elements if e.get("type") == "way"]
    logger.info("Overpass tram_tracks: %s ways", len(ways))
    return _elements_to_rows(ways)


def download_osm_railways() -> list[tuple[int | None, dict[str, Any]]]:
    """Download railway=rail in Praha bbox. Returns list of (osm_id, geojson_geometry)."""
    b = _bbox_str()
    query = f"""
[out:json][timeout:{TIMEOUT_S}];
way["railway"="rail"]{b};
out body geom;
"""
    elements = _overpass_request(query)
    ways = [e for e in elements if e.get("type") == "way"]
    logger.info("Overpass railways: %s ways", len(ways))
    return _elements_to_rows(ways)


def download_osm_airports() -> list[tuple[int | None, dict[str, Any]]]:
    """
    Download aeroway=aerodrome (nodes and ways) in Praha bbox.
    Returns list of (osm_id, geojson_geometry). Points and polygons both supported.
    """
    b = _bbox_str()
    query = f"""
[out:json][timeout:{TIMEOUT_S}];
(
  node["aeroway"="aerodrome"]{b};
  way["aeroway"="aerodrome"]{b};
);
out body geom;
"""
    elements = _overpass_request(query)
    nodes = [e for e in elements if e.get("type") == "node"]
    ways = [e for e in elements if e.get("type") == "way"]
    logger.info("Overpass airports: %s nodes, %s ways", len(nodes), len(ways))
    return _elements_to_rows(nodes + ways)


def download_osm_all_layers() -> dict[str, list[tuple[int | None, dict[str, Any]]]]:
    """
    Download all four OSM layers in a single Overpass request (union query).
    Returns dict: primary_roads, tram_tracks, railway, airports -> list of (osm_id, geojson_geom).
    Much faster and avoids rate limits vs. four separate requests.
    """
    b = _bbox_str()
    query = f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["highway"="motorway"]{b};
  way["highway"="trunk"]{b};
  way["highway"="primary"]{b};
  way["railway"="tram"]{b};
  way["railway"="rail"]{b};
  node["aeroway"="aerodrome"]{b};
  way["aeroway"="aerodrome"]{b};
);
out body geom;
"""
    elements = _overpass_request(query)
    primary_roads: list[tuple[int | None, dict[str, Any]]] = []
    tram_tracks: list[tuple[int | None, dict[str, Any]]] = []
    railway: list[tuple[int | None, dict[str, Any]]] = []
    airports: list[tuple[int | None, dict[str, Any]]] = []

    for el in elements:
        row = _element_to_row(el)
        if row is None:
            continue
        tags = el.get("tags") or {}
        if el.get("type") == "node":
            if tags.get("aeroway") == "aerodrome":
                airports.append(row)
            continue
        if el.get("type") != "way":
            continue
        if tags.get("aeroway") == "aerodrome":
            airports.append(row)
        elif tags.get("railway") == "tram":
            tram_tracks.append(row)
        elif tags.get("railway") == "rail":
            railway.append(row)
        elif tags.get("highway") in ("motorway", "trunk", "primary"):
            primary_roads.append(row)

    logger.info(
        "Overpass all_layers: primary_roads=%s tram_tracks=%s railway=%s airports=%s",
        len(primary_roads), len(tram_tracks), len(railway), len(airports),
    )
    return {
        "primary_roads": primary_roads,
        "tram_tracks": tram_tracks,
        "railway": railway,
        "airports": airports,
    }


def _element_to_row(element: dict[str, Any]) -> tuple[int | None, dict[str, Any]] | None:
    """Convert one element to (osm_id, geojson_geom) or None if no geometry."""
    geom = _element_to_geojson_geom(element)
    if geom is None:
        return None
    osm_id = element.get("id")
    if isinstance(osm_id, (int, float)):
        osm_id = int(osm_id)
    else:
        osm_id = None
    return (osm_id, geom)

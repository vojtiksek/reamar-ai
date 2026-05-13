"""
Download OSM POI for walkability from Overpass API.

Separate table per category; each returns list of (osm_id, name, geojson_point).
Uses Praha bbox same as micro-location. POI are points (nodes or way centroids).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

import requests

logger = logging.getLogger(__name__)

# Multiple Overpass endpoints — try in order, fall back on any non-2xx.
# The main `overpass-api.de` started returning 406 around 2026-05-12 even
# for valid POST bodies; the Kumi and z.overpass mirrors stayed up. Keeping
# all three lets us survive any single mirror being down without manual
# intervention.
OVERPASS_URLS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
)
BBOX_PRAHA = (49.95, 14.1, 50.2, 14.8)
TIMEOUT_S = 120


def _bbox_str(bbox: tuple[float, float, float, float] | None = None) -> str:
    south, west, north, east = bbox or BBOX_PRAHA
    return f"({south},{west},{north},{east})"


def _bbox_quadrants() -> list[tuple[float, float, float, float]]:
    """Split Prague bbox into 4 overlapping quadrants for categories where the
    full-bbox query gets 504 timeouts (restaurants, big leisure layers).
    Returns (south, west, north, east) tuples. Mild overlap (0.005°, ~500 m)
    ensures POI on the cut don't fall through; we dedup by osm_id."""
    south, west, north, east = BBOX_PRAHA
    mid_lat = (south + north) / 2.0
    mid_lon = (west + east) / 2.0
    o = 0.005
    return [
        (south,       west,         mid_lat + o, mid_lon + o),  # SW
        (south,       mid_lon - o,  mid_lat + o, east),         # SE
        (mid_lat - o, west,         north,       mid_lon + o),  # NW
        (mid_lat - o, mid_lon - o,  north,       east),         # NE
    ]


def _overpass_request(query: str) -> list[dict[str, Any]]:
    """POST query to Overpass; try mirrors in order. Returns elements."""
    last_error: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            resp = requests.post(
                url,
                data={"data": query},
                timeout=TIMEOUT_S,
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("elements") or []) if isinstance(data, dict) else []
        except requests.exceptions.RequestException as e:
            last_error = e
            logger.warning("Overpass mirror %s failed (%s), trying next", url, e)
            continue
    raise last_error or RuntimeError("All Overpass mirrors failed")


def _element_to_point_geom(element: dict[str, Any]) -> tuple[float, float] | None:
    """Return (lon, lat) for node or way center (or first point of way)."""
    if element.get("type") == "node":
        lat, lon = element.get("lat"), element.get("lon")
        if lat is not None and lon is not None:
            return (float(lon), float(lat))
        return None
    if element.get("type") == "way":
        geom = element.get("geometry")
        if geom and len(geom) >= 1:
            p = geom[0]
            return (float(p["lon"]), float(p["lat"]))
        center = element.get("center")
        if center:
            return (float(center["lon"]), float(center["lat"]))
        return None
    return None


def _element_name(element: dict[str, Any]) -> str | None:
    tags = element.get("tags") or {}
    return (tags.get("name") or "").strip() or None


# Exclude POI that are closed, abandoned, or disused (no reliable active/inactive for ATMs, etc.)
def _is_inactive_poi(tags: dict[str, Any]) -> bool:
    if not tags:
        return False
    inactive_values = {"yes", "true", "1", "abandoned", "disused", "closed"}
    for key in ("abandoned", "disused", "closed"):
        if tags.get(key) in inactive_values:
            return True
    lifecycle = (tags.get("lifecycle") or "").strip().lower()
    if lifecycle in ("abandoned", "disused", "closed", "removed"):
        return True
    return False


def _elements_to_rows(
    elements: list[dict[str, Any]],
) -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """Convert to (osm_id, name, geojson_point). Skips inactive (closed/abandoned/disused) POI."""
    rows: list[tuple[int | None, str | None, dict[str, Any]]] = []
    for el in elements:
        tags = el.get("tags") or {}
        if _is_inactive_poi(tags):
            continue
        pt = _element_to_point_geom(el)
        if pt is None:
            continue
        osm_id = el.get("id")
        if isinstance(osm_id, (int, float)):
            osm_id = int(osm_id)
        else:
            osm_id = None
        name = _element_name(el)
        geom = {"type": "Point", "coordinates": list(pt)}
        rows.append((osm_id, name, geom))
    return rows


def _run_query(node_query: str, way_query: str | None = None) -> list[tuple[int | None, str | None, dict[str, Any]]]:
    b = _bbox_str()
    if way_query is None:
        q = f'[out:json][timeout:{TIMEOUT_S}];\nnode{node_query}{b};\nout body qt;'
    else:
        q = f'[out:json][timeout:{TIMEOUT_S}];\n(node{node_query}{b};way{way_query}{b};);\nout body geom qt;'
    elements = _overpass_request(q)
    return _elements_to_rows(elements)


def _run_query_split(
    node_query: str,
    way_query: str | None = None,
    *,
    elements_to_rows: Callable[[list[dict[str, Any]]], list[tuple[int | None, str | None, dict[str, Any]]]] | None = None,
) -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """Run a category query against each of the 4 Prague quadrants and merge.
    Use for categories where the full-bbox query consistently 504-times-out
    on the Kumi mirror (restaurants, parks). Dedups by osm_id so the small
    overlap between adjacent quadrants doesn't produce duplicates.

    `elements_to_rows` lets callers (e.g. parks) override the default
    point-only conversion with one that retains polygon geometry."""
    convert = elements_to_rows or _elements_to_rows
    seen_ids: set[int] = set()
    seen_keys: set[tuple[float, float]] = set()
    merged: list[tuple[int | None, str | None, dict[str, Any]]] = []

    for quad in _bbox_quadrants():
        b = _bbox_str(quad)
        if way_query is None:
            q = f'[out:json][timeout:{TIMEOUT_S}];\nnode{node_query}{b};\nout body qt;'
        else:
            q = f'[out:json][timeout:{TIMEOUT_S}];\n(node{node_query}{b};way{way_query}{b};);\nout body geom qt;'
        try:
            elements = _overpass_request(q)
        except Exception as exc:
            logger.warning("Quadrant %s failed (%s); continuing with other quadrants", quad, exc)
            continue
        rows = convert(elements)
        for osm_id, name, geom in rows:
            if osm_id is not None:
                if osm_id in seen_ids:
                    continue
                seen_ids.add(osm_id)
            else:
                coords = geom.get("coordinates")
                if isinstance(coords, list) and len(coords) == 2 and all(isinstance(c, (int, float)) for c in coords):
                    key = (round(coords[0], 6), round(coords[1], 6))
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
            merged.append((osm_id, name, geom))
    return merged


def _way_geometry_to_polygon_geojson(geometry: list[dict[str, float]]) -> dict[str, Any] | None:
    """Build GeoJSON Polygon from way geometry (list of {lat, lon}). Distance to park = to nearest edge."""
    if not geometry or len(geometry) < 3:
        return None
    ring = [[float(p["lon"]), float(p["lat"])] for p in geometry]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def _elements_to_rows_parks(elements: list[dict[str, Any]]) -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """Parks: nodes as Point, ways as Polygon (distance = to nearest edge of polygon). Skips inactive."""
    rows: list[tuple[int | None, str | None, dict[str, Any]]] = []
    for el in elements:
        tags = el.get("tags") or {}
        if _is_inactive_poi(tags):
            continue
        osm_id = el.get("id")
        if isinstance(osm_id, (int, float)):
            osm_id = int(osm_id)
        else:
            osm_id = None
        name = _element_name(el)
        if el.get("type") == "node":
            pt = _element_to_point_geom(el)
            if pt is None:
                continue
            geom = {"type": "Point", "coordinates": list(pt)}
        elif el.get("type") == "way":
            geom_list = el.get("geometry")
            if not geom_list or len(geom_list) < 3:
                pt = _element_to_point_geom(el)
                if pt is not None:
                    geom = {"type": "Point", "coordinates": list(pt)}
                else:
                    continue
            else:
                poly = _way_geometry_to_polygon_geojson(geom_list)
                if poly is None:
                    continue
                geom = poly
        else:
            continue
        rows.append((osm_id, name, geom))
    return rows


# --- Daily needs ---
def download_osm_supermarkets() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """shop=supermarket, convenience, greengrocer."""
    return _run_query('["shop"~"^(supermarket|convenience|greengrocer)$"]')


def download_osm_drugstores() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """shop=chemist, cosmetics."""
    return _run_query('["shop"~"^(chemist|cosmetics)$"]')


def download_osm_pharmacies() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=pharmacy."""
    return _run_query('["amenity"="pharmacy"]')


def download_osm_atms() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=atm."""
    return _run_query('["amenity"="atm"]')


def download_osm_post_offices() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=post_office."""
    return _run_query('["amenity"="post_office"]')


# --- Transport ---
def download_osm_tram_stops() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """railway=tram_stop or public_transport=platform + tram."""
    return _run_query(
        '["railway"="tram_stop"]',
        way_query='["railway"="tram_stop"]',
    )


def download_osm_bus_stops() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """highway=bus_stop or public_transport=platform + bus."""
    return _run_query(
        '["highway"="bus_stop"]',
        way_query='["highway"="bus_stop"]',
    )


def download_osm_metro_stations() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """railway=station + station=subway, or railway=subway_entrance (Prague metro)."""
    b = _bbox_str()
    # Two node queries: subway_entrance and station+subway; one way query
    q = f"""[out:json][timeout:{TIMEOUT_S}];
(node["railway"="subway_entrance"]{b};
 node["railway"="station"]["station"="subway"]{b};
 way["railway"="station"]["station"="subway"]{b};
);
out body geom qt;
"""
    elements = _overpass_request(q)
    return _elements_to_rows(elements)


def download_osm_train_stations() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """railway=station (main stations); public_transport=station for broader coverage."""
    return _run_query(
        '["railway"="station"]',
        way_query='["railway"="station"]',
    )


# --- Leisure ---
def download_osm_restaurants() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=restaurant. Split into 4 quadrants — the Prague-wide query
    times out (504 Gateway Timeout) on every Overpass mirror as of
    2026-05-13 because restaurants are the densest OSM amenity layer."""
    return _run_query_split('["amenity"="restaurant"]', way_query='["amenity"="restaurant"]')


def download_osm_cafes() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=cafe."""
    return _run_query('["amenity"="cafe"]', way_query='["amenity"="cafe"]')


def download_osm_parks() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """leisure=park (often ways). Ways stored as Polygon so distance = to
    nearest edge, not centroid. Quadrant split because full-bbox park query
    also intermittently times out."""
    return _run_query_split(
        '["leisure"="park"]',
        way_query='["leisure"="park"]',
        elements_to_rows=_elements_to_rows_parks,
    )


def download_osm_fitness() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """leisure=fitness_centre, sport=fitness."""
    return _run_query(
        '["leisure"="fitness_centre"]',
        way_query='["leisure"="fitness_centre"]',
    )


def download_osm_playgrounds() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """leisure=playground."""
    return _run_query('["leisure"="playground"]', way_query='["leisure"="playground"]')


# --- Family ---
def download_osm_kindergartens() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=kindergarten."""
    return _run_query('["amenity"="kindergarten"]', way_query='["amenity"="kindergarten"]')


def download_osm_primary_schools() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """amenity=school (primary/basic: no strict tag in OSM; we take all schools as proxy for ZŠ)."""
    return _run_query('["amenity"="school"]', way_query='["amenity"="school"]')


def download_osm_pediatricians() -> list[tuple[int | None, str | None, dict[str, Any]]]:
    """healthcare=pediatrician; fallback: amenity=doctors (pragmatic - many pediatricians not tagged).
    Quadrant split because the same big-bbox timeouts hit this layer too."""
    return _run_query_split(
        '["healthcare"="pediatrician"]',
        way_query='["healthcare"="pediatrician"]',
    )


# Table name -> download function
WALKABILITY_DOWNLOADERS: dict[str, Any] = {
    "osm_supermarkets": download_osm_supermarkets,
    "osm_drugstores": download_osm_drugstores,
    "osm_pharmacies": download_osm_pharmacies,
    "osm_atms": download_osm_atms,
    "osm_post_offices": download_osm_post_offices,
    "osm_tram_stops": download_osm_tram_stops,
    "osm_bus_stops": download_osm_bus_stops,
    "osm_metro_stations": download_osm_metro_stations,
    "osm_train_stations": download_osm_train_stations,
    "osm_restaurants": download_osm_restaurants,
    "osm_cafes": download_osm_cafes,
    "osm_parks": download_osm_parks,
    "osm_fitness": download_osm_fitness,
    "osm_playgrounds": download_osm_playgrounds,
    "osm_kindergartens": download_osm_kindergartens,
    "osm_primary_schools": download_osm_primary_schools,
    "osm_pediatricians": download_osm_pediatricians,
}


# Retry config for Overpass (504/timeouts are common for large bboxes)
DOWNLOAD_MAX_ATTEMPTS = 2
DOWNLOAD_RETRY_DELAY_S = 15


def download_all_walkability_poi() -> dict[str, list[tuple[int | None, str | None, dict[str, Any]]]]:
    """
    Download all POI categories from Overpass; returns dict table_name -> rows (osm_id, name, geom).
    Single source of truth: iterates WALKABILITY_DOWNLOADERS so any new category is included.
    Retries each category up to DOWNLOAD_MAX_ATTEMPTS on failure; logs empty results.
    """
    out: dict[str, list[tuple[int | None, str | None, dict[str, Any]]]] = {}
    for table_name, fn in WALKABILITY_DOWNLOADERS.items():
        last_error: Exception | None = None
        for attempt in range(DOWNLOAD_MAX_ATTEMPTS):
            try:
                logger.info("Walkability POI download started: %s (attempt %s/%s)", table_name, attempt + 1, DOWNLOAD_MAX_ATTEMPTS)
                rows = fn()
                out[table_name] = rows
                logger.info("Walkability POI %s: %s features", table_name, len(rows))
                if len(rows) == 0:
                    logger.warning("Walkability POI category %s returned 0 features (may be expected for this bbox or Overpass empty)", table_name)
                break
            except Exception as e:
                last_error = e
                logger.warning("Download %s failed (attempt %s/%s): %s", table_name, attempt + 1, DOWNLOAD_MAX_ATTEMPTS, e)
                if attempt < DOWNLOAD_MAX_ATTEMPTS - 1:
                    logger.info("Retrying %s in %ss...", table_name, DOWNLOAD_RETRY_DELAY_S)
                    time.sleep(DOWNLOAD_RETRY_DELAY_S)
        else:
            logger.exception("Download %s failed after %s attempts: %s", table_name, DOWNLOAD_MAX_ATTEMPTS, last_error)
            out[table_name] = []
        time.sleep(1)
    return out

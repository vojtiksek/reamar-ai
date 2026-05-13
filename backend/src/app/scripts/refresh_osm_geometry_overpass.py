#!/usr/bin/env python
"""
Download OSM LineString features (railways, tram tracks, primary roads) for
Prague bbox via Overpass (Kumi mirror first, fallback to others) and insert
into osm_railways / osm_tram_tracks / osm_primary_roads.

Run with: python /tmp/load_osm_lines.py --layer=<railway|tram_tracks|primary_roads>
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

sys.path.insert(0, "/Users/reamar/Desktop/reamar-ai/backend/src")
from app.db import get_db  # noqa: E402

OVERPASS_URLS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
)

# Prague bbox (south, west, north, east)
BBOX = (49.95, 14.1, 50.2, 14.8)

LAYERS = {
    # layer name -> (overpass filter, target table)
    "railway": (
        '["railway"~"^(rail|light_rail|subway|narrow_gauge)$"]',
        "osm_railways",
    ),
    "tram_tracks": (
        '["railway"="tram"]',
        "osm_tram_tracks",
    ),
    "primary_roads": (
        # Heavier roads only — feed for the "Silnice" near-source noise badge.
        '["highway"~"^(motorway|trunk|primary)$"]',
        "osm_primary_roads",
    ),
}


def _bbox_str() -> str:
    s, w, n, e = BBOX
    return f"({s},{w},{n},{e})"


def _build_query(osm_filter: str) -> str:
    return f"""
[out:json][timeout:180];
way{osm_filter}{_bbox_str()};
out geom;
""".strip()


def _overpass(query: str) -> list[dict[str, Any]]:
    last_err: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            print(f"  POST {url} ...", flush=True)
            t = time.time()
            resp = requests.post(url, data={"data": query}, timeout=240)
            resp.raise_for_status()
            data = resp.json()
            elements = (data.get("elements") or []) if isinstance(data, dict) else []
            print(f"  ok in {time.time()-t:.1f}s, {len(elements)} elements", flush=True)
            return elements
        except requests.exceptions.RequestException as e:
            print(f"  {url} -> {e}", flush=True)
            last_err = e
            continue
    raise last_err or RuntimeError("All Overpass mirrors failed")


def _way_to_geometry(elem: dict[str, Any]) -> dict[str, Any] | None:
    if elem.get("type") != "way":
        return None
    geometry = elem.get("geometry") or []
    if len(geometry) < 2:
        return None
    coords = [[p["lon"], p["lat"]] for p in geometry]
    return {"type": "LineString", "coordinates": coords}


def load_layer(layer: str) -> None:
    osm_filter, table = LAYERS[layer]
    query = _build_query(osm_filter)
    print(f"Layer: {layer} -> table: {table}")
    elements = _overpass(query)

    rows: list[tuple[int | None, str]] = []
    for el in elements:
        geom = _way_to_geometry(el)
        if not geom:
            continue
        osm_id = el.get("id")
        rows.append((int(osm_id) if osm_id is not None else None, json.dumps(geom)))
    print(f"  parsed {len(rows)} valid LineString features")

    if not rows:
        print("  no features to insert, leaving table untouched")
        return

    with get_db() as db:
        assert isinstance(db, Session)
        # Replace contents atomically (TRUNCATE + bulk insert).
        db.execute(text(f"TRUNCATE {table} RESTART IDENTITY"))
        for osm_id, geom_json in rows:
            db.execute(
                text(
                    f"INSERT INTO {table} (osm_id, geom) VALUES (:osm_id, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))"
                ),
                {"osm_id": osm_id, "geom": geom_json},
            )
        db.commit()
        print(f"  inserted {len(rows)} rows into {table}")


def main() -> None:
    layer = "tram_tracks"
    for arg in sys.argv[1:]:
        if arg.startswith("--layer="):
            layer = arg.split("=", 1)[1]
    if layer not in LAYERS:
        print(f"ERROR: unknown layer {layer!r}; choose from {list(LAYERS)}")
        sys.exit(1)
    load_layer(layer)


if __name__ == "__main__":
    main()

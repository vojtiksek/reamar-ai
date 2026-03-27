#!/usr/bin/env python
from __future__ import annotations

"""
Import OSM-derived geometry (roads, tram, railway, airports) into micro-location tables.

Usage (from backend/ with venv active):

    python -m app.scripts.import_osm_geometry --layer=primary_roads path/to/roads.geojson
    python -m app.scripts.import_osm_geometry --layer=tram_tracks path/to/tram.geojson
    python -m app.scripts.import_osm_geometry --layer=railway path/to/railway.geojson
    python -m app.scripts.import_osm_geometry --layer=airports path/to/airports.geojson

Options:
  --layer   One of: primary_roads, tram_tracks, railway, airports
  --truncate  Clear table before import (default: append)

Expected input: GeoJSON FeatureCollection, EPSG:4326. Each feature: geometry (Point/LineString/
MultiLineString/Polygon/MultiPolygon), optional properties.id or properties.osm_id for osm_id.
"""

import json
import sys
from pathlib import Path
from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db


LAYER_TO_TABLE: dict[str, str] = {
    "primary_roads": "osm_primary_roads",
    "tram_tracks": "osm_tram_tracks",
    "railway": "osm_railways",
    "airports": "osm_airports",
}


def _parse_args() -> tuple[Path, Literal["primary_roads", "tram_tracks", "railway", "airports"], bool]:
    if len(sys.argv) < 2:
        print(
            "Usage: python -m app.scripts.import_osm_geometry --layer=<layer> path/to/file.geojson [--truncate]"
        )
        print("  --layer: primary_roads | tram_tracks | railway | airports")
        raise SystemExit(1)

    path_arg: str | None = None
    layer_arg: Literal["primary_roads", "tram_tracks", "railway", "airports"] = "primary_roads"
    truncate = False

    for arg in sys.argv[1:]:
        if arg.startswith("--layer="):
            v = arg.split("=", 1)[1].strip().lower()
            if v in LAYER_TO_TABLE:
                layer_arg = v  # type: ignore[assignment]
            else:
                print(f"ERROR: --layer must be one of {list(LAYER_TO_TABLE.keys())}")
                raise SystemExit(1)
        elif arg == "--truncate":
            truncate = True
        else:
            path_arg = arg

    if not path_arg:
        print("ERROR: path to GeoJSON file required")
        raise SystemExit(1)
    path = Path(path_arg)
    return path, layer_arg, truncate


def main() -> None:
    path, layer, truncate = _parse_args()
    if not path.is_file():
        print(f"File not found: {path}")
        raise SystemExit(1)

    table = LAYER_TO_TABLE[layer]
    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features") or []
    if not features:
        print("No features found in GeoJSON.")
        return

    with get_db() as db:
        assert isinstance(db, Session)
        if truncate:
            db.execute(text(f"TRUNCATE {table} RESTART IDENTITY"))

        inserted = 0
        for feature in features:
            geom = feature.get("geometry")
            if not geom:
                continue
            props = feature.get("properties") or {}
            osm_id = props.get("id") or props.get("osm_id")
            if isinstance(osm_id, (int, float)):
                osm_id = int(osm_id)
            else:
                osm_id = None
            geom_json = json.dumps(geom)
            db.execute(
                text(
                    f"""
                    INSERT INTO {table} (osm_id, geom)
                    VALUES (:osm_id, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))
                    """
                ),
                {"osm_id": osm_id, "geom": geom_json},
            )
            inserted += 1
        db.commit()

    print(f"Imported {inserted} features into {table}.")


if __name__ == "__main__":
    main()

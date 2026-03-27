#!/usr/bin/env python
from __future__ import annotations

"""
Import Prague strategic noise map polygons into noise_map_polygons.

Usage (from backend/ with venv active):

    python -m app.scripts.import_noise_map_polygons path/to/noise.geojson

Expected input (Prague 2024 surface traffic noise, exported from ArcGIS layer 6/7):

- GeoJSON FeatureCollection in EPSG:4326 (reprojected from S-JTSK / EPSG:5514)
- each feature has:
    properties["DB_LO"]      -> lower edge of 5 dB band (e.g. 55, 60, 65)
    properties["DB_HI"]      -> upper edge of 5 dB band (e.g. 60, 65, 70)
    properties["ET_Index"]   -> category / legend label (optional, not used here)
  We derive a representative value as (DB_LO + DB_HI) / 2.

Noise type is determined either from:
- a command-line flag (--type=day|night), or
- a per-feature override via properties["noise_type"] (if present).

Geometry handling:
- We store geom as geometry(Polygon, 4326) using PostGIS ST_GeomFromGeoJSON.
"""

import json
import sys
from pathlib import Path
from typing import Literal, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db


def _parse_args() -> tuple[Path, Optional[Literal["day", "night"]], bool]:
    """
    Simple CLI parsing:

    python -m app.scripts.import_noise_map_polygons path/to/file.geojson [--type=day|night]

    If --type is omitted, importer expects properties["noise_type"] on each feature.
    """
    if len(sys.argv) < 2:
        print(
            "Usage: python -m app.scripts.import_noise_map_polygons "
            "path/to/noise.geojson [--type=day|night] [--truncate]"
        )
        raise SystemExit(1)

    geojson_arg = sys.argv[1]
    noise_type_arg: Optional[Literal["day", "night"]] = None
    truncate = False
    for arg in sys.argv[2:]:
        if arg.startswith("--type="):
            v = arg.split("=", 1)[1].strip().lower()
            if v in ("day", "night"):
                noise_type_arg = v  # type: ignore[assignment]
            else:
                print("ERROR: --type must be 'day' or 'night'")
                raise SystemExit(1)
        elif arg == "--truncate":
            truncate = True
    path = Path(geojson_arg)
    return path, noise_type_arg, truncate


def main() -> None:
    path, default_noise_type, truncate = _parse_args()
    if not path.is_file():
        print(f"File not found: {path}")
        raise SystemExit(1)

    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features") or []
    if not features:
        print("No features found in GeoJSON.")
        return

    with get_db() as db:
        assert isinstance(db, Session)

        # Optional: clear existing data when explicitly requested.
        if truncate:
            db.execute(text("TRUNCATE noise_map_polygons RESTART IDENTITY"))

        inserted = 0
        for feature in features:
            props = feature.get("properties") or {}
            geom = feature.get("geometry")
            if not geom:
                continue

            # For Prague 2024 noise maps, DB_LO / DB_HI define 5 dB bands.
            db_lo = props.get("DB_LO")
            db_hi = props.get("DB_HI")
            if db_lo is None and db_hi is None:
                # Fallback to a direct noise_db property if present (custom data)
                noise_db = props.get("noise_db")
            else:
                try:
                    lo = float(db_lo) if db_lo is not None else float(db_hi)
                    hi = float(db_hi) if db_hi is not None else float(db_lo)
                    noise_db = (lo + hi) / 2.0
                except (TypeError, ValueError):
                    noise_db = None

            if noise_db is None:
                continue

            # Determine noise_type: prefer explicit per-feature flag, then CLI default.
            noise_type_prop = (props.get("noise_type") or "").strip().lower()
            if noise_type_prop in ("day", "night"):
                noise_type = noise_type_prop
            else:
                noise_type = default_noise_type

            if noise_type not in ("day", "night"):
                # Skip features when we cannot reliably decide whether they are day or night.
                continue

            geom_json = json.dumps(geom)

            db.execute(
                text(
                    """
                    INSERT INTO noise_map_polygons (noise_db, noise_type, geom)
                    VALUES (:noise_db, :noise_type, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))
                    """
                ),
                {
                    "noise_db": float(noise_db),
                    "noise_type": str(noise_type),
                    "geom": geom_json,
                },
            )
            inserted += 1

        db.commit()
        print(f"Imported {inserted} noise polygons into noise_map_polygons.")


if __name__ == "__main__":
    main()


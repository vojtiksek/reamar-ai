"""
Source data refresh for location metrics: noise map polygons and OSM geometry.

Jobs:
- refresh_noise_source_data(db, day_path, night_path) — (re)load noise_map_polygons from GeoJSON.
- refresh_osm_source_data(db, paths) — (re)load osm_* tables from GeoJSON per layer.
- refresh_all_location_sources_and_recompute(db, ...) — refresh sources then full project recompute.

Scheduler-ready: run refresh weekly/monthly; then run full recompute.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from .project_location_metrics import recompute_all_project_location_metrics
from .osm_overpass import download_osm_all_layers

OSM_LAYER_TO_TABLE = {
    "primary_roads": "osm_primary_roads",
    "tram_tracks": "osm_tram_tracks",
    "railway": "osm_railways",
    "airports": "osm_airports",
}


def import_noise_geojson_file(
    db: Session,
    path: Path,
    noise_type: Literal["day", "night"],
    truncate: bool = False,
) -> int:
    """Load one GeoJSON into noise_map_polygons. Used by CLI script. Returns inserted count."""
    if truncate:
        db.execute(text("TRUNCATE noise_map_polygons RESTART IDENTITY"))
    return _import_noise_geojson(db, path, noise_type)


def _import_noise_geojson(
    db: Session,
    path: Path,
    noise_type: Literal["day", "night"],
) -> int:
    """Load one GeoJSON file into noise_map_polygons for the given noise_type. Returns inserted count."""
    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features") or []
    inserted = 0
    for feature in features:
        props = feature.get("properties") or {}
        geom = feature.get("geometry")
        if not geom:
            continue
        db_lo = props.get("DB_LO")
        db_hi = props.get("DB_HI")
        if db_lo is None and db_hi is None:
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
        noise_type_prop = (props.get("noise_type") or "").strip().lower()
        if noise_type_prop in ("day", "night"):
            actual_type = noise_type_prop
        else:
            actual_type = noise_type
        if actual_type not in ("day", "night"):
            continue
        geom_json = json.dumps(geom)
        db.execute(
            text(
                """
                INSERT INTO noise_map_polygons (noise_db, noise_type, geom)
                VALUES (:noise_db, :noise_type, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))
                """
            ),
            {"noise_db": float(noise_db), "noise_type": actual_type, "geom": geom_json},
        )
        inserted += 1
    return inserted


def refresh_noise_source_data(
    db: Session,
    day_path: Path | None = None,
    night_path: Path | None = None,
) -> dict[str, Any]:
    """
    Truncate noise_map_polygons and reload from GeoJSON files.
    If both paths are None, no-op. Returns summary with inserted_day, inserted_night, truncated.
    """
    if day_path is None and night_path is None:
        return {"truncated": False, "inserted_day": 0, "inserted_night": 0}

    db.execute(text("TRUNCATE noise_map_polygons RESTART IDENTITY"))
    inserted_day = 0
    inserted_night = 0
    if day_path is not None and day_path.is_file():
        inserted_day = _import_noise_geojson(db, day_path, "day")
    if night_path is not None and night_path.is_file():
        inserted_night = _import_noise_geojson(db, night_path, "night")
    db.commit()
    return {
        "truncated": True,
        "inserted_day": inserted_day,
        "inserted_night": inserted_night,
    }


def import_osm_geojson_file(
    db: Session,
    path: Path,
    layer: str,
    truncate: bool = False,
) -> int:
    """Load one GeoJSON into one OSM layer table. Used by CLI script. Returns inserted count."""
    if layer not in OSM_LAYER_TO_TABLE:
        return 0
    if truncate:
        db.execute(text(f"TRUNCATE {OSM_LAYER_TO_TABLE[layer]} RESTART IDENTITY"))
    return _import_osm_geojson(db, path, layer)


def _import_osm_geojson(db: Session, path: Path, layer: str) -> int:
    """Load one GeoJSON into the given OSM layer table. Returns inserted count."""
    table = OSM_LAYER_TO_TABLE.get(layer)
    if not table:
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features") or []
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
    return inserted


def refresh_osm_source_data(
    db: Session,
    paths: dict[str, Path],
) -> dict[str, int]:
    """
    For each layer in paths (primary_roads, tram_tracks, railway, airports), truncate table and load from GeoJSON.
    Returns dict layer -> inserted count.
    """
    result: dict[str, int] = {}
    for layer, path in paths.items():
        if layer not in OSM_LAYER_TO_TABLE or path is None or not path.is_file():
            continue
        table = OSM_LAYER_TO_TABLE[layer]
        db.execute(text(f"TRUNCATE {table} RESTART IDENTITY"))
        inserted = _import_osm_geojson(db, path, layer)
        result[layer] = inserted
    db.commit()
    return result


def refresh_all_location_sources_and_recompute(
    db: Session,
    *,
    noise_day_path: Path | None = None,
    noise_night_path: Path | None = None,
    osm_paths: dict[str, Path] | None = None,
    batch_size: int = 200,
) -> dict[str, Any]:
    """
    1) Refresh noise source data from paths (if provided).
    2) Refresh OSM source data from paths (if provided).
    3) Run full recompute of all project location metrics.

    Suitable for weekly/monthly scheduler. If no paths are set, only step 3 runs.
    """
    out: dict[str, Any] = {"noise": None, "osm": None, "recompute": None}

    if noise_day_path is not None or noise_night_path is not None:
        out["noise"] = refresh_noise_source_data(db, noise_day_path, noise_night_path)
    if osm_paths:
        out["osm"] = refresh_osm_source_data(db, osm_paths)

    out["recompute"] = recompute_all_project_location_metrics(db, batch_size=batch_size)
    return out


def _insert_osm_elements(
    db: Session,
    table: str,
    rows: list[tuple[int | None, dict[str, Any]]],
) -> int:
    """Insert (osm_id, geojson_geom) rows into table. Caller should truncate first. Returns inserted count."""
    if table not in OSM_LAYER_TO_TABLE.values():
        return 0
    inserted = 0
    for osm_id, geom in rows:
        geom_json = json.dumps(geom)
        db.execute(
            text(
                f"INSERT INTO {table} (osm_id, geom) VALUES (:osm_id, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))"
            ),
            {"osm_id": osm_id, "geom": geom_json},
        )
        inserted += 1
    return inserted


def download_osm_sources_and_recompute(
    db: Session,
    *,
    batch_size: int = 200,
) -> dict[str, Any]:
    """
    1) Truncate all osm_* tables.
    2) Download OSM data from Overpass API (primary roads, tram, railway, airports) for Praha bbox.
    3) Insert into PostGIS tables.
    4) Run full recompute of project location metrics.

    No file paths or env needed; suitable for cron and for the "Stáhnout OSM infrastrukturu" button.
    """
    out: dict[str, Any] = {"osm": {}, "recompute": None}

    # Truncate all four tables
    for table in OSM_LAYER_TO_TABLE.values():
        db.execute(text(f"TRUNCATE {table} RESTART IDENTITY"))

    # Single Overpass request for all layers (avoids rate limit and long total time)
    all_layers = download_osm_all_layers()
    for name, table_key in [
        ("primary_roads", "primary_roads"),
        ("tram_tracks", "tram_tracks"),
        ("railway", "railway"),
        ("airports", "airports"),
    ]:
        rows = all_layers.get(name, [])
        table = OSM_LAYER_TO_TABLE[table_key]
        count = _insert_osm_elements(db, table, rows)
        out["osm"][name] = count

    db.commit()
    out["recompute"] = recompute_all_project_location_metrics(db, batch_size=batch_size)
    return out

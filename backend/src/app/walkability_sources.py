"""
Walkability POI source refresh: download from Overpass and fill osm_* POI tables.

Single source of truth: categories come from osm_walkability_overpass.WALKABILITY_DOWNLOADERS.
Any new category added there is automatically included in refresh (no hardcoded subset).

Jobs:
- refresh_walkability_sources(db) — truncate all POI tables from WALKABILITY_DOWNLOADERS, download, insert.
- refresh_walkability_sources_and_recompute(db) — refresh then recompute all project walkability.

Scheduler-ready; can be called from admin endpoint.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import Project
from .osm_walkability_overpass import WALKABILITY_DOWNLOADERS, download_all_walkability_poi
from .walkability import compute_project_walkability

logger = logging.getLogger(__name__)


def _insert_poi_rows(
    db: Session,
    table_name: str,
    rows: list[tuple[int | None, str | None, dict[str, Any]]],
) -> int:
    """Insert (osm_id, name, geom) into table. Returns count."""
    inserted = 0
    for osm_id, name, geom in rows:
        geom_json = json.dumps(geom)
        db.execute(
            text(
                f"""
                INSERT INTO {table_name} (osm_id, name, geom)
                VALUES (:osm_id, :name, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))
                """
            ),
            {"osm_id": osm_id, "name": name or None, "geom": geom_json},
        )
        inserted += 1
    return inserted


def refresh_walkability_sources(db: Session) -> dict[str, Any]:
    """
    Truncate all walkability POI tables (from WALKABILITY_DOWNLOADERS), download from Overpass, insert.
    Single source of truth: no hardcoded table list; future categories are included automatically.
    Returns dict with source_counts, warnings, elapsed_seconds.
    """
    start = time.perf_counter()
    tables = list(WALKABILITY_DOWNLOADERS.keys())
    for t in tables:
        db.execute(text(f"TRUNCATE {t} RESTART IDENTITY"))
    data = download_all_walkability_poi()
    source_counts: dict[str, int] = {}
    warnings: list[str] = []
    for table_name in tables:
        rows = data.get(table_name, [])
        count = _insert_poi_rows(db, table_name, rows)
        source_counts[table_name] = count
        if count == 0:
            warnings.append(f"{table_name}: 0 rows (table empty after refresh)")
            logger.warning("Walkability source table %s has 0 rows after refresh", table_name)
    db.commit()
    elapsed = time.perf_counter() - start
    return {
        "source_counts": source_counts,
        "warnings": warnings,
        "elapsed_seconds": round(elapsed, 2),
    }


def recompute_all_project_walkability(db: Session, batch_size: int = 200) -> dict[str, Any]:
    """Recompute walkability for all projects with GPS. Returns processed/total/elapsed_seconds."""
    start = time.perf_counter()
    project_ids = [
        r[0]
        for r in db.execute(
            select(Project.id).where(
                Project.gps_latitude.isnot(None),
                Project.gps_longitude.isnot(None),
            ).order_by(Project.id)
        ).all()
    ]
    if not project_ids:
        return {"processed": 0, "total": 0, "elapsed_seconds": 0.0}
    total = len(project_ids)
    for i in range(0, total, batch_size):
        batch = project_ids[i : i + batch_size]
        for pid in batch:
            project = db.execute(select(Project).where(Project.id == pid)).scalars().first()
            if project:
                compute_project_walkability(db, project)
        db.commit()
    elapsed = time.perf_counter() - start
    return {"processed": total, "total": total, "elapsed_seconds": round(elapsed, 2)}


def refresh_walkability_sources_and_recompute(
    db: Session,
    batch_size: int = 200,
) -> dict[str, Any]:
    """
    One-click flow: 1) Refresh all walkability POI tables from Overpass. 2) Recompute all project walkability.
    Response includes per-category source counts, recompute stats, total duration, and any warnings.
    """
    total_start = time.perf_counter()
    walkability_poi = refresh_walkability_sources(db)
    recompute = recompute_all_project_walkability(db, batch_size=batch_size)
    total_elapsed = time.perf_counter() - total_start
    all_warnings = list(walkability_poi.get("warnings", []))
    return {
        "walkability_poi": {
            "source_counts": walkability_poi["source_counts"],
            "warnings": walkability_poi["warnings"],
            "elapsed_seconds": walkability_poi["elapsed_seconds"],
        },
        "recompute": recompute,
        "total_elapsed_seconds": round(total_elapsed, 2),
        "warnings": all_warnings,
    }

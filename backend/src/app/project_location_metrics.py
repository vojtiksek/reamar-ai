"""
Per-project and batch location metrics: noise + micro-location.

Architecture:
- enrich_project_location_metrics(project_id) — per-project: compute noise + micro-location for one project.
- recompute_all_project_location_metrics() — full recompute of all projects with GPS (e.g. after source refresh).
- Source refresh and combined job live in location_sources.py.

Scheduler-ready: call enrich on project create/update; run refresh + full recompute weekly/monthly.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .micro_location import compute_project_micro_location
from .models import Project, ProjectOverride
from .noise import compute_project_noise
from .walkability import compute_project_walkability
from .overrides import _parse_project_override_value
from .project_catalog import get_project_columns

# When these project fields change (base or override), we trigger per-project enrichment.
LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS = frozenset(
    {"gps_latitude", "gps_longitude", "region_iga"}
)


def _effective_project_for_location(project: Project, override_map: dict[str, str]) -> None:
    """Apply project overrides for location-related fields onto the project instance in-place."""
    if not override_map:
        return
    col_types = {c["key"]: c.get("data_type", "text") for c in get_project_columns()}
    for field in LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS:
        if field not in override_map:
            continue
        raw = override_map[field]
        data_type = col_types.get(field, "number" if "latitude" in field or "longitude" in field else "text")
        parsed = _parse_project_override_value(raw, data_type)
        if parsed is None and field == "region_iga":
            continue
        if field == "gps_latitude":
            try:
                project.gps_latitude = Decimal(str(parsed)) if parsed is not None else None
            except Exception:
                pass
        elif field == "gps_longitude":
            try:
                project.gps_longitude = Decimal(str(parsed)) if parsed is not None else None
            except Exception:
                pass
        elif field == "region_iga":
            project.region_iga = str(parsed).strip() if parsed is not None else project.region_iga


def enrich_project_location_metrics(db: Session, project_id: int) -> bool:
    """
    Load project, apply overrides for gps/region, then compute and persist noise + micro-location
    only for this project. Use after create/update when GPS or region changed.

    Returns True if metrics were computed (project had GPS), False if skipped (no GPS).
    """
    project = db.execute(select(Project).where(Project.id == project_id)).scalars().first()
    if project is None:
        return False

    # Load overrides for this project and apply location-related ones to the instance
    override_rows = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == project.id,
                ProjectOverride.field.in_(LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map_flat: dict[str, str] = {}
    for o in override_rows:
        override_map_flat[o.field] = o.value
    _effective_project_for_location(project, override_map_flat)

    if project.gps_latitude is None or project.gps_longitude is None:
        # Clear noise, micro_location and walkability when GPS removed
        compute_project_noise(db, project)
        compute_project_micro_location(db, project)
        compute_project_walkability(db, project)
        return False

    compute_project_noise(db, project)
    compute_project_micro_location(db, project)
    compute_project_walkability(db, project)
    return True


def recompute_all_project_location_metrics(db: Session, batch_size: int = 200) -> dict[str, Any]:
    """
    Recompute noise + micro-location for all projects that have GPS.
    Uses current source data (noise_map_polygons, osm_*). Intended after source refresh or manual run.

    Returns dict with processed count and elapsed info for API/scheduler.
    """
    import time
    start = time.perf_counter()
    project_ids = [
        row[0]
        for row in db.execute(
            select(Project.id)
            .where(
                Project.gps_latitude.isnot(None),
                Project.gps_longitude.isnot(None),
            )
            .order_by(Project.id)
        ).all()
    ]
    if not project_ids:
        return {"processed": 0, "total": 0, "elapsed_seconds": 0.0}

    total = len(project_ids)
    processed = 0
    for i in range(0, total, batch_size):
        batch_ids = project_ids[i : i + batch_size]
        for pid in batch_ids:
            enrich_project_location_metrics(db, pid)
            processed += 1
        db.commit()

    elapsed = time.perf_counter() - start
    return {"processed": processed, "total": total, "elapsed_seconds": round(elapsed, 2)}


def should_enrich_after_project_change(
    *,
    is_new_project: bool,
    old_lat: Any,
    old_lon: Any,
    old_region: Any,
    new_lat: Any,
    new_lon: Any,
    new_region: Any,
) -> bool:
    """
    Decide if we should call enrich_project_location_metrics after a project create/update.
    True when: new project, or gps_latitude / gps_longitude / region_iga changed.
    """
    if is_new_project:
        return True
    return (
        old_lat != new_lat
        or old_lon != new_lon
        or (old_region or "").strip() != (new_region or "").strip()
    )

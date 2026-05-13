"""Daily ops pipeline runner.

Two-tier cadence:

  Daily (every night):
    1. BuiltMind import (new projects + units)
    2. Walkability for new/missing projects only (per-project, cheap)
    3. Noise for new/missing projects only
    4. Micro-location for new/missing projects only
    5. Derived floors aggregation (cheap, all projects)
    6. Local price diffs (market deviation) recompute
    7. Location metrics
    8. Error log cleanup

  Monthly (1st of month only):
    9. Walkability POI source refresh from Overpass (TRUNCATE + reload all
       osm_* POI tables, then recompute every project)

The "monthly" steps early-return on other days, so the daily cron stays
cheap (~1 min) and only the first-of-month run does the expensive global
Overpass refresh.

Each step runs best-effort: a failure is logged to OpsRun.steps_json and the
pipeline continues. The whole run completes with status='done' if every step
succeeded, 'partial' if some steps failed, or 'error' if the entire pipeline
crashed before recording per-step results.

Triggered manually (button) or by a Vercel cron hitting /admin/ops/daily-run.
"""
from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select

from .db import SessionLocal
from .models import OpsRun


def _is_monthly_full_refresh_day() -> bool:
    """True on the 1st of the month (UTC). Gates expensive global refreshes."""
    return datetime.now(timezone.utc).day == 1


# --- Step wrapper --------------------------------------------------------

def _run_step(name: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Run a single pipeline step, capturing result/error/duration."""
    step: dict[str, Any] = {
        "name": name,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "duration_s": None,
        "output": None,
        "error": None,
    }
    t0 = time.monotonic()
    try:
        result = fn() or {}
        step["output"] = _sanitize(result)
        step["status"] = "done"
    except Exception as exc:  # noqa: BLE001
        step["status"] = "error"
        step["error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    finally:
        step["finished_at"] = datetime.now(timezone.utc).isoformat()
        step["duration_s"] = round(time.monotonic() - t0, 2)
    return step


def _sanitize(value: Any) -> Any:
    """Best-effort coerce to JSON-serializable primitives."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    return str(value)


# --- Individual step implementations ------------------------------------

def _step_builtmind_import() -> dict[str, Any]:
    """Fetch + import + recompute for all clients. Synchronous (no threading)."""
    import tempfile
    import json as _json
    import os
    from pathlib import Path as _Path

    from .fetch_builtmind import fetch_from_api
    from .import_units import import_units as _import_units
    from .settings import settings

    api_key = (settings.builtmind_api_key or os.environ.get("BUILTMIND_API_KEY", "")).strip()
    if not api_key:
        raise RuntimeError("BUILTMIND_API_KEY not set in environment")

    units = fetch_from_api(api_key)

    fd, tmp_path_str = tempfile.mkstemp(suffix=".json", prefix="builtmind_")
    tmp_path = _Path(tmp_path_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            _json.dump(units, f, ensure_ascii=False)
        stats = _import_units(tmp_path, source="api", chunk_size=500)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    # Recompute recommendations for all clients (uses its own sessions).
    from .main import _recompute_all_client_recommendations  # lazy to avoid cycle
    recompute = _recompute_all_client_recommendations()

    # Invalidate /filters enum options cache — new import may bring new values.
    from .filter_catalog import _enum_cache_clear
    _enum_cache_clear()

    return {
        "fetched_units": len(units),
        "import_stats": stats,
        "recompute": recompute,
    }


def _step_walkability_full_refresh() -> dict[str, Any]:
    """Monthly: refresh OSM POI source tables from Overpass and recompute
    walkability for every project. Skipped on non-1st days."""
    if not _is_monthly_full_refresh_day():
        return {"skipped": True, "reason": "not first of month"}
    from .walkability_sources import refresh_walkability_sources_and_recompute

    db = SessionLocal()
    try:
        return refresh_walkability_sources_and_recompute(db)
    finally:
        db.close()


def _step_walkability_for_new_projects() -> dict[str, Any]:
    """Daily: compute walkability for projects that have never had it computed.
    Selector: walkability_updated_at IS NULL — set by compute_project_walkability
    on any successful run, so projects without OSM POI coverage (e.g. just
    outside the Prague bbox) skip cleanly once they've been attempted."""
    from .models import Project
    from .walkability import compute_project_walkability

    t0 = time.monotonic()
    db = SessionLocal()
    try:
        ids = [
            pid
            for (pid,) in db.execute(
                select(Project.id).where(
                    Project.gps_latitude.isnot(None),
                    Project.gps_longitude.isnot(None),
                    Project.walkability_updated_at.is_(None),
                )
            ).all()
        ]
        if not ids:
            return {"processed": 0, "elapsed_seconds": 0}
        for pid in ids:
            project = db.get(Project, pid)
            if project is not None:
                compute_project_walkability(db, project)
        db.commit()
        return {
            "processed": len(ids),
            "elapsed_seconds": round(time.monotonic() - t0, 2),
        }
    finally:
        db.close()


def _step_noise_for_new_projects() -> dict[str, Any]:
    """Daily: compute noise label for projects that have never had it computed.
    Selector: only projects in Prague that have not been attempted yet.
    Non-Prague projects are skipped — they will never have data from the
    Prague noise map."""
    from .models import Project
    from .noise import compute_project_noise

    t0 = time.monotonic()
    db = SessionLocal()
    try:
        ids = [
            pid
            for (pid,) in db.execute(
                select(Project.id).where(
                    Project.gps_latitude.isnot(None),
                    Project.gps_longitude.isnot(None),
                    Project.region_iga == "Hlavní město Praha",
                    Project.noise_updated_at.is_(None),
                )
            ).all()
        ]
        if not ids:
            return {"processed": 0, "elapsed_seconds": 0}
        for pid in ids:
            project = db.get(Project, pid)
            if project is not None:
                compute_project_noise(db, project)
        db.commit()
        return {
            "processed": len(ids),
            "elapsed_seconds": round(time.monotonic() - t0, 2),
        }
    finally:
        db.close()


def _step_micro_location_for_new_projects() -> dict[str, Any]:
    """Daily: compute micro-location (distances to railway / tram tracks /
    primary roads) for projects that have never had it computed.
    compute_project_micro_location sets micro_location_updated_at on every
    successful run, so the selector cleanly skips fully-processed projects."""
    from .models import Project
    from .micro_location import compute_project_micro_location

    t0 = time.monotonic()
    db = SessionLocal()
    try:
        ids = [
            pid
            for (pid,) in db.execute(
                select(Project.id).where(
                    Project.gps_latitude.isnot(None),
                    Project.gps_longitude.isnot(None),
                    Project.micro_location_updated_at.is_(None),
                )
            ).all()
        ]
        if not ids:
            return {"processed": 0, "elapsed_seconds": 0}
        for pid in ids:
            project = db.get(Project, pid)
            if project is not None:
                compute_project_micro_location(db, project)
        db.commit()
        return {
            "processed": len(ids),
            "elapsed_seconds": round(time.monotonic() - t0, 2),
        }
    finally:
        db.close()


def _step_derived_floors() -> dict[str, Any]:
    from .aggregates import recompute_project_aggregates
    from .models import Project, ProjectAggregates

    t0 = time.monotonic()
    db = SessionLocal()
    try:
        all_project_ids = [pid for (pid,) in db.execute(select(Project.id)).all()]
        if not all_project_ids:
            return {"processed": 0, "elapsed_seconds": 0}
        recompute_project_aggregates(db, all_project_ids)
        db.commit()

        agg_rows = (
            db.execute(
                select(ProjectAggregates).where(
                    ProjectAggregates.project_id.in_(all_project_ids)
                )
            )
            .scalars()
            .all()
        )
        with_floors = sum(1 for a in agg_rows if a.derived_total_floors is not None)
        return {
            "processed": len(all_project_ids),
            "with_derived_floors": with_floors,
            "elapsed_seconds": round(time.monotonic() - t0, 2),
        }
    finally:
        db.close()


def _step_local_price_diffs() -> dict[str, Any]:
    from .aggregates import recompute_local_price_diffs

    t0 = time.monotonic()
    db = SessionLocal()
    try:
        recompute_local_price_diffs(db)
        db.commit()
        return {"elapsed_seconds": round(time.monotonic() - t0, 2)}
    finally:
        db.close()


def _step_location_metrics() -> dict[str, Any]:
    from .project_location_metrics import recompute_all_project_location_metrics

    db = SessionLocal()
    try:
        return recompute_all_project_location_metrics(db)
    finally:
        db.close()


def _step_error_log_cleanup() -> dict[str, Any]:
    """Delete error_logs older than 14 days to keep the table bounded."""
    from .error_logging import cleanup_old_error_logs

    db = SessionLocal()
    try:
        deleted = cleanup_old_error_logs(db, days=14)
        return {"deleted": deleted}
    finally:
        db.close()


DEFAULT_STEPS: list[tuple[str, Callable[[], dict[str, Any]]]] = [
    ("builtmind_import", _step_builtmind_import),
    # Daily incremental — cheap, runs every night for projects added today.
    ("walkability_for_new_projects", _step_walkability_for_new_projects),
    ("noise_for_new_projects", _step_noise_for_new_projects),
    ("micro_location_for_new_projects", _step_micro_location_for_new_projects),
    # Cheap globals that touch project_aggregates / units (not osm_*).
    ("derived_floors", _step_derived_floors),
    ("local_price_diffs", _step_local_price_diffs),
    ("location_metrics", _step_location_metrics),
    # Monthly only (early-returns on non-1st days).
    ("walkability_refresh", _step_walkability_full_refresh),
    ("error_log_cleanup", _step_error_log_cleanup),
]


# --- Orchestration -------------------------------------------------------

def _execute_pipeline(run_id: int) -> None:
    """Run every step, persisting progress to OpsRun row after each one."""
    steps_record: list[dict[str, Any]] = []
    any_error = False

    db = SessionLocal()
    try:
        run = db.get(OpsRun, run_id)
        if run is None:
            return
        run.status = "running"
        run.steps_json = steps_record
        db.commit()
    finally:
        db.close()

    for name, fn in DEFAULT_STEPS:
        step_result = _run_step(name, fn)
        steps_record.append(step_result)
        if step_result["status"] == "error":
            any_error = True

        # Persist progress after each step so the dashboard can show live state.
        db = SessionLocal()
        try:
            run = db.get(OpsRun, run_id)
            if run is not None:
                run.steps_json = list(steps_record)
                db.commit()
        finally:
            db.close()

    # Final status + summary
    db = SessionLocal()
    try:
        run = db.get(OpsRun, run_id)
        if run is not None:
            run.status = "partial" if any_error else "done"
            run.finished_at = datetime.now(timezone.utc)
            run.summary_json = _build_summary(steps_record)
            db.commit()
    finally:
        db.close()


def _build_summary(steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Condense per-step outputs into a single dashboard-friendly dict."""
    total_duration = sum(float(s.get("duration_s") or 0) for s in steps)
    ok = sum(1 for s in steps if s.get("status") == "done")
    err = sum(1 for s in steps if s.get("status") == "error")
    summary: dict[str, Any] = {
        "total_duration_s": round(total_duration, 2),
        "steps_ok": ok,
        "steps_err": err,
    }

    for step in steps:
        out = step.get("output") or {}
        if step["name"] == "builtmind_import":
            stats = (out.get("import_stats") or {}) if isinstance(out, dict) else {}
            summary["units_created"] = stats.get("units_created")
            summary["units_updated"] = stats.get("units_updated")
            summary["projects_created"] = stats.get("projects_created")
            summary["projects_reused"] = stats.get("projects_reused")
            rec = (out.get("recompute") or {}) if isinstance(out, dict) else {}
            summary["clients_recomputed"] = rec.get("clients_processed") or rec.get("processed")
    return summary


# --- Lock (one at a time) ------------------------------------------------

_run_lock = threading.Lock()
_active_run_id: int | None = None


def start_pipeline(trigger: str = "manual") -> int:
    """Create an OpsRun row and kick off the pipeline in a daemon thread.

    Raises RuntimeError if another run is already active.
    """
    global _active_run_id
    with _run_lock:
        if _active_run_id is not None:
            # Double-check in DB in case of stale in-proc state (worker restart).
            db = SessionLocal()
            try:
                active = db.get(OpsRun, _active_run_id)
                if active is not None and active.status == "running":
                    raise RuntimeError(f"Ops run #{_active_run_id} is already in progress")
                _active_run_id = None
            finally:
                db.close()

        db = SessionLocal()
        try:
            run = OpsRun(trigger=trigger, status="running", steps_json=[])
            db.add(run)
            db.commit()
            run_id = run.id
            _active_run_id = run_id
        finally:
            db.close()

    def _target() -> None:
        global _active_run_id
        try:
            _execute_pipeline(run_id)
        except Exception:  # noqa: BLE001
            # Mark whole run as error if the orchestrator itself crashed.
            db = SessionLocal()
            try:
                run = db.get(OpsRun, run_id)
                if run is not None:
                    run.status = "error"
                    run.finished_at = datetime.now(timezone.utc)
                    run.error = traceback.format_exc()[:4000]
                    db.commit()
            finally:
                db.close()
        finally:
            with _run_lock:
                if _active_run_id == run_id:
                    _active_run_id = None

    thread = threading.Thread(target=_target, daemon=True, name=f"ops-run-{run_id}")
    thread.start()
    return run_id


def get_active_run_id() -> int | None:
    return _active_run_id

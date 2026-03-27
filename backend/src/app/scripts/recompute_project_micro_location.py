#!/usr/bin/env python
from __future__ import annotations

"""
Batch recompute of project micro-location: distances to OSM layers + score/label.

Usage (from backend/ with venv active):

    python -m app.scripts.recompute_project_micro_location
"""

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Project
from app.micro_location import compute_project_micro_location


def main(batch_size: int = 200) -> None:
    start = time.perf_counter()
    print(f"Recomputing project micro-location (batch_size={batch_size})")

    with get_db() as db:
        assert isinstance(db, Session)

        project_ids = [
            row[0]
            for row in db.execute(
                select(Project.id)
                .where(Project.gps_latitude.isnot(None), Project.gps_longitude.isnot(None))
                .order_by(Project.id)
            ).all()
        ]
        if not project_ids:
            print("No projects with GPS coordinates found. Nothing to do.")
            return

        total = len(project_ids)
        print(f"Found {total} projects with GPS.")

        processed = 0
        for i in range(0, total, batch_size):
            batch_ids = project_ids[i : i + batch_size]
            batch_start = time.perf_counter()
            projects = (
                db.execute(select(Project).where(Project.id.in_(batch_ids)))
                .scalars()
                .all()
            )
            for p in projects:
                compute_project_micro_location(db, p)
            db.commit()
            processed += len(projects)
            elapsed_batch = time.perf_counter() - batch_start
            print(
                f"Processed batch of {len(projects)} projects "
                f"({processed}/{total}) in {elapsed_batch:.2f}s"
            )

    total_elapsed = time.perf_counter() - start
    print(f"Done. Recomputed micro-location for {processed} projects in {total_elapsed:.2f}s.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python
from __future__ import annotations

"""
One-off backfill script to recompute cached project aggregates
for all projects that currently have units.

Usage (from backend/ with venv active):

    python -m app.scripts.backfill_project_aggregates
"""

import time
from typing import Iterable, List

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.aggregates import recompute_project_aggregates
from app.db import get_db
from app.models import Unit


def _batched(iterable: Iterable[int], batch_size: int) -> Iterable[List[int]]:
    batch: List[int] = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def main(batch_size: int = 200) -> None:
    start = time.perf_counter()
    print(f"Backfilling project_aggregates (batch_size={batch_size})")

    with get_db() as db:
        assert isinstance(db, Session)

        # Load distinct project_ids from units table
        project_ids = [
            row[0]
            for row in db.execute(
                select(Unit.project_id).distinct().order_by(Unit.project_id)
            ).all()
        ]
        if not project_ids:
            print("No projects with units found. Nothing to do.")
            return

        total_projects = len(project_ids)
        print(f"Found {total_projects} projects with units.")

        processed = 0
        for batch in _batched(project_ids, batch_size):
            batch_start = time.perf_counter()
            recompute_project_aggregates(db, batch)
            db.commit()
            processed += len(batch)
            elapsed_batch = time.perf_counter() - batch_start
            print(
                f"Processed batch of {len(batch)} projects "
                f"({processed}/{total_projects}) in {elapsed_batch:.2f}s"
            )

    total_elapsed = time.perf_counter() - start
    print(f"Done. Recomputed aggregates for {processed} projects in {total_elapsed:.2f}s.")


if __name__ == "__main__":
    main()


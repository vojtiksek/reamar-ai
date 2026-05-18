"""Lightweight in-process counter for HERE API calls.

Counts are bucketed by endpoint kind ("geocode", "suggest", "transit") and
distinguish cache hits vs. live HERE calls. Used by:

  - geocoding endpoints in main.py
  - routing_provider.py (commute_cache hits/misses)
  - ops_runner.py (snapshot per run, persisted into OpsRun.summary_json)

Process-local — does not survive a Railway restart. Good enough to see the
daily trend in the ops log.
"""
from __future__ import annotations

import threading
from collections import defaultdict


_lock = threading.Lock()
_counts: dict[str, int] = defaultdict(int)


def incr(metric: str, n: int = 1) -> None:
    with _lock:
        _counts[metric] += n


def snapshot() -> dict[str, int]:
    """Return a copy of the current counters."""
    with _lock:
        return dict(_counts)


def snapshot_and_reset() -> dict[str, int]:
    """Atomically copy + zero the counters. Use this around a daily run so the
    OpsRun summary captures only the calls that happened during the run."""
    with _lock:
        snap = dict(_counts)
        _counts.clear()
        return snap


def reset() -> None:
    with _lock:
        _counts.clear()

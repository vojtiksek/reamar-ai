#!/usr/bin/env python3
"""Fetch market data from BuiltMind API and run import.

Uses BUILTMIND_API_KEY from environment. Never commit the API key.

Usage:
  export BUILTMIND_API_KEY="sk_live_..."
  python -m app.fetch_builtmind                    # fetch + import
  python -m app.fetch_builtmind --dry-run         # fetch only, no import
  python -m app.fetch_builtmind --output file.json # save to file, no import
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# Optional: use requests if available (recommended)
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

logger = logging.getLogger(__name__)

# Base URL from API docs (BuiltMind Data API - Reamar)
BUILTMIND_API_URL = "https://1ki66xm0jc.execute-api.eu-central-1.amazonaws.com/Prod/api"

# Map BuiltMind API field names to our import JSON keys (import_units expects these).
# Keys not listed are passed through as-is (import uses _key_to_attr for DB columns).
# March 2026: project_id -> builtmind_project_id (avoids collision with our internal FK),
#             developer_id -> builtmind_developer_id, use_type replaces usage.
BUILTMIND_TO_IMPORT: dict[str, str] = {
    # March 2026 API key remaps
    "project_id": "builtmind_project_id",       # avoid collision with internal project FK
    "developer_id": "builtmind_developer_id",
    "use_type": "use_type",                      # renamed from usage in March 2026

    # Old-name fallbacks (API no longer sends these; kept for safety with older exports)
    "unit_id": "unique_id",
    "project_name": "project",
    "current_price": "price",
    "price_per_sm": "price_per_m2_czk",
    "original_price": "original_price_czk",
    "original_price_per_sm": "original_price_per_m2_czk",
    "floor_area": "floor_area_m2",
    "area": "floor_area_m2",
    "status": "availability",
    "unit_url": "url",
    "unit_name": "unit_name",
    "layout": "layout",
    "first_seen_date": "first_seen",
    "sold_date": "sold_date",
    "last_seen_date": "last_seen",
}


def _map_unit(unit: dict[str, Any]) -> dict[str, Any]:
    """Convert BuiltMind unit keys to our import format. Preserves unmapped keys."""
    out: dict[str, Any] = {}
    for k, v in unit.items():
        if v is None:
            continue
        target = BUILTMIND_TO_IMPORT.get(k)
        if target:
            out[target] = v
        else:
            out[k] = v
    return out


def _unwrap_units(data: Any) -> list[dict[str, Any]]:
    """Return list of units from API response (list, or dict with 'units'/'data')."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if "units" in data:
            return data["units"]
        if "data" in data:
            return data["data"]
        if "items" in data:
            return data["items"]
        raise ValueError(f"JSON object must contain 'units', 'data' or 'items', got: {list(data.keys())}")
    raise ValueError(f"JSON must be a list or object, got: {type(data)}")


def _api_get_with_retry(url: str, params: dict, headers: dict, timeout: int = 60) -> "requests.Response":
    """GET with retry for 429 (rate-limit) and 504 (gateway timeout).

    - 429: waits Retry-After seconds (default 60) then retries up to 3 times.
    - 504: waits 30 s then retries up to 2 times (use city= instead of country= for large exports).
    - 403: raises immediately with a clear message (bad key / no access).
    - Other 4xx/5xx: raises immediately.
    """
    max_retries = 3
    for attempt in range(max_retries):
        resp = requests.get(url, params=params, headers=headers, timeout=timeout)

        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 60))
            logger.warning("BuiltMind API: rate-limited (429). Waiting %s s (attempt %d/%d).", wait, attempt + 1, max_retries)
            time.sleep(wait)
            continue

        if resp.status_code == 504:
            if attempt < max_retries - 1:
                logger.warning("BuiltMind API: gateway timeout (504). Waiting 30 s (attempt %d/%d).", attempt + 1, max_retries)
                time.sleep(30)
                continue
            raise RuntimeError(
                "BuiltMind API: gateway timeout (504) after retries. "
                "Try using city= instead of country= for large exports."
            )

        if resp.status_code == 403:
            raise RuntimeError(
                "BuiltMind API: access denied (403). Check BUILTMIND_API_KEY and city/country subscription."
            )

        if resp.status_code == 404:
            raise RuntimeError(
                f"BuiltMind API: not found (404). City/country not found or no data available. params={params}"
            )

        resp.raise_for_status()
        return resp

    raise RuntimeError(f"BuiltMind API: max retries ({max_retries}) exceeded.")


def fetch_from_api(api_key: str) -> list[dict[str, Any]]:
    """Call BuiltMind API, follow presigned URL, return list of units (mapped to import format)."""
    if not HAS_REQUESTS:
        raise RuntimeError("Install requests: pip install requests")

    params = {
        "country": "czechia",
        "export_type": "market_data_dashboard",
        "format": "json",
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    # 1) Get presigned download URL
    logger.info("BuiltMind API: requesting export (params=%s)", params)
    resp = _api_get_with_retry(BUILTMIND_API_URL, params=params, headers=headers, timeout=60)
    download_url = resp.text.strip().strip('"')
    if not download_url.startswith("http"):
        raise ValueError(f"Expected presigned URL, got: {download_url[:200]}")

    # 2) Download actual JSON from presigned S3 URL (valid 1 hour)
    logger.info("BuiltMind API: downloading data from presigned URL.")
    data_resp = requests.get(download_url, timeout=300)
    data_resp.raise_for_status()
    raw = data_resp.json()

    units = _unwrap_units(raw)
    logger.info("BuiltMind API: %d units fetched.", len(units))
    return [_map_unit(u) for u in units]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch data from BuiltMind API and optionally run import",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only fetch and print unit count; do not save or import",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        metavar="FILE",
        help="Save JSON to this file (no import). Use with --dry-run to only fetch.",
    )
    parser.add_argument(
        "--no-import",
        action="store_true",
        help="Fetch and save to temp file, but do not run import_units",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="api",
        help="Source identifier for import (default: api)",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=2000,
        metavar="N",
        help="Import chunk size (default: 2000)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("BUILTMIND_API_KEY", "").strip()
    if not api_key:
        print("Error: Set BUILTMIND_API_KEY in environment.", file=sys.stderr)
        print("  export BUILTMIND_API_KEY='sk_live_...'", file=sys.stderr)
        sys.exit(1)

    print("Fetching from BuiltMind API...")
    try:
        units = fetch_from_api(api_key)
    except Exception as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Fetched {len(units)} units.")

    if args.dry_run and not args.output:
        print("Dry run: not saving or importing.")
        return

    import json

    out_path = args.output
    used_temp = False
    if out_path is None:
        fd, path = tempfile.mkstemp(suffix=".json", prefix="builtmind_")
        out_path = Path(path)
        used_temp = True

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(units, f, ensure_ascii=False, indent=2)
    print(f"Saved to {out_path}")

    if args.no_import or args.output:
        if args.no_import and args.output is None:
            print("Skipping import (--no-import). To import later: python -m app.import_units", out_path, "--source api")
        else:
            print("Skipping import (--no-import or --output).")
        return

    from .import_units import import_units

    import_units(out_path, args.source, dry_run=False, chunk_size=args.chunk_size)

    if used_temp:
        out_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

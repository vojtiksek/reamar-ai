#!/usr/bin/env python3
"""
BuiltMind API payload diagnostics.
Run from backend/ with the key in env:
  export BUILTMIND_API_KEY="sk_live_..."
  source .venv/bin/activate
  python debug_builtmind_payload.py
"""
from __future__ import annotations

import json
import os
import sys
import time

import requests

API_URL = "https://1ki66xm0jc.execute-api.eu-central-1.amazonaws.com/Prod/api"

# Fields we expect in the March 2026 schema
NEW_FIELDS = [
    "project_id", "developer_id", "project_url", "construction_completion",
    "reserved_date", "reservation_duration_days", "is_stale_reservation", "use_type",
]
# Fields that should be GONE (or renamed) in March 2026 schema
OLD_FIELDS = ["usage", "city", "district", "municipality"]


def fetch_raw(api_key: str, params: dict) -> tuple[str, list]:
    """Return (presigned_url, raw_rows_list). Does NO mapping."""
    headers = {"Authorization": f"Bearer {api_key}"}
    print(f"\n>>> GET {API_URL}")
    print(f"    params: {params}")
    resp = requests.get(API_URL, params=params, headers=headers, timeout=60)
    print(f"    status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"    body: {resp.text[:500]}")
        return "", []
    presigned = resp.text.strip().strip('"')
    print(f"    presigned URL: {presigned[:80]}...")

    print(f">>> Downloading from presigned URL...")
    data_resp = requests.get(presigned, timeout=300)
    data_resp.raise_for_status()
    raw = data_resp.json()

    # Unwrap
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("units") or raw.get("data") or raw.get("items") or []
    else:
        rows = []

    print(f"    total rows: {len(rows)}")
    return presigned, rows


def analyze(label: str, rows: list) -> None:
    if not rows:
        print(f"  [{label}] NO ROWS RETURNED")
        return

    sample = rows[0]
    all_keys = set(sample.keys())

    print(f"\n=== {label} ===")
    print(f"  total rows: {len(rows)}")
    print(f"  first row keys ({len(all_keys)}): {sorted(all_keys)}")

    print(f"\n  NEW March 2026 fields:")
    for f in NEW_FIELDS:
        present = f in all_keys
        val = sample.get(f, "<absent>")
        mark = "✓" if present else "✗"
        print(f"    {mark} {f}: {val!r}")

    print(f"\n  OLD fields (expect absent/renamed in March 2026):")
    for f in OLD_FIELDS:
        present = f in all_keys
        val = sample.get(f, "<absent>")
        mark = "STILL PRESENT" if present else "absent"
        print(f"    {mark}: {f}: {val!r}")

    # Scan across first 3 rows for any new fields that might be sparse
    found_new_in_3 = set()
    for row in rows[:3]:
        for f in NEW_FIELDS:
            if f in row:
                found_new_in_3.add(f)
    print(f"\n  NEW fields found in any of first 3 rows: {sorted(found_new_in_3) or 'NONE'}")

    # Full first row as JSON for reference
    print(f"\n  First row (raw JSON):")
    print("  " + json.dumps(sample, ensure_ascii=False, default=str)[:1200])


def main() -> None:
    api_key = os.environ.get("BUILTMIND_API_KEY", "").strip()
    if not api_key:
        print("ERROR: Set BUILTMIND_API_KEY environment variable.")
        sys.exit(1)

    tests = [
        ("country=czechia + market_data_dashboard (CURRENT)",
         {"country": "czechia", "export_type": "market_data_dashboard", "format": "json"}),
        ("city=prague + market_data_dashboard",
         {"city": "prague", "export_type": "market_data_dashboard", "format": "json"}),
        ("country=czechia + supply",
         {"country": "czechia", "export_type": "supply", "format": "json"}),
    ]

    results = []
    for label, params in tests:
        print(f"\n{'='*60}")
        print(f"TEST: {label}")
        try:
            _, rows = fetch_raw(api_key, params)
            analyze(label, rows)
            results.append((label, rows))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append((label, []))
        # Be polite to rate limiter
        time.sleep(2)

    print(f"\n{'='*60}")
    print("SUMMARY")
    for label, rows in results:
        if not rows:
            print(f"  {label}: NO DATA")
            continue
        new_found = [f for f in NEW_FIELDS if f in rows[0]]
        old_still = [f for f in OLD_FIELDS if f in rows[0]]
        schema = "NEW (March 2026)" if len(new_found) >= 3 else ("MIXED" if new_found else "OLD (pre-March 2026)")
        print(f"  {label}:")
        print(f"    schema: {schema}")
        print(f"    new fields present: {new_found or 'NONE'}")
        print(f"    old fields still present: {old_still or 'none'}")


if __name__ == "__main__":
    main()

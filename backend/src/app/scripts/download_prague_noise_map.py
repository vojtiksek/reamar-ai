#!/usr/bin/env python
"""
Download Prague strategic noise map polygons (layer 6 = day, layer 7 = night)
from gs-pub.praha.eu ArcGIS REST service and save as one GeoJSON file per
layer. The server rejects pages > ~100 features (500 internal error), so we
page in chunks of 50 with retry-on-error.

Usage:
  python /tmp/dl_noise.py --layer=6  -> writes /tmp/noise_day.geojson
  python /tmp/dl_noise.py --layer=7  -> writes /tmp/noise_night.geojson
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

import requests

BASE = "https://gs-pub.praha.eu/arcgis/rest/services/hm/hluk/MapServer"
PAGE_SIZE = 50           # geometries are big; >100 fails with 500
PAGE_TIMEOUT = 90
RETRIES = 3


def _count(layer: int) -> int:
    r = requests.get(
        f"{BASE}/{layer}/query",
        params={"where": "1=1", "returnCountOnly": "true", "f": "json"},
        timeout=30,
    )
    r.raise_for_status()
    return int(r.json().get("count", 0))


def _page(layer: int, offset: int) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(
                f"{BASE}/{layer}/query",
                params={
                    "where": "1=1",
                    "outFields": "DB_LO,DB_HI",
                    "resultOffset": offset,
                    "resultRecordCount": PAGE_SIZE,
                    "outSR": 4326,
                    "f": "geojson",
                },
                timeout=PAGE_TIMEOUT,
            )
            r.raise_for_status()
            return r.json()
        except requests.exceptions.RequestException as e:
            last_exc = e
            wait = 5 * (attempt + 1)
            print(f"  offset {offset} attempt {attempt+1} failed: {e}; retry in {wait}s", flush=True)
            time.sleep(wait)
    raise last_exc or RuntimeError("page download failed")


def download(layer: int, out_path: str) -> None:
    total = _count(layer)
    print(f"Layer {layer}: total {total} features, page_size={PAGE_SIZE}")

    all_features: list[dict[str, Any]] = []
    offset = 0
    while offset < total:
        t = time.time()
        page = _page(layer, offset)
        feats = page.get("features") or []
        if not feats:
            print(f"  offset {offset}: empty page, stopping early")
            break
        all_features.extend(feats)
        print(
            f"  offset {offset:>5} +{len(feats):<3} = {len(all_features):>5}/{total} ({time.time()-t:.1f}s)",
            flush=True,
        )
        offset += len(feats)

    fc = {"type": "FeatureCollection", "features": all_features}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"  wrote {out_path} ({len(all_features)} features)")


def main() -> None:
    layer = 6
    out = None
    for arg in sys.argv[1:]:
        if arg.startswith("--layer="):
            layer = int(arg.split("=", 1)[1])
        elif arg.startswith("--out="):
            out = arg.split("=", 1)[1]
    if not out:
        out = f"/tmp/noise_{'day' if layer == 6 else 'night'}.geojson"
    download(layer, out)


if __name__ == "__main__":
    main()

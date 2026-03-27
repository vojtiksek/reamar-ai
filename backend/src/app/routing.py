"""
Walking-distance routing adapter for walkability (tram/bus/metro stops).

If OSRM_URL is set, requests walking route from OSRM and returns distance in meters.
If not set or request fails, returns None and caller uses air-distance fallback.
Architecture is ready for other backends (e.g. GraphHopper) via same interface.
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from .settings import settings

logger = logging.getLogger(__name__)

# OSRM foot/walk profile; default table service returns distance in meters
OSRM_ROUTE_SERVICE = "route"
OSRM_PROFILE = "foot"
TIMEOUT_S = 10


def get_walking_distance_m(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
) -> tuple[float | None, bool]:
    """
    Return (walking distance in meters, used_fallback).
    - If OSRM is configured and returns a route: (distance_m, False).
    - If OSRM is not configured or fails: (None, True); caller should use air distance and set walkability_walking_fallback_used.
    """
    base = (settings.osrm_url or "").rstrip("/")
    if not base:
        logger.debug("OSRM_URL not set; walking distance will use fallback (air distance)")
        return (None, True)

    url = f"{base}/{OSRM_ROUTE_SERVICE}/v1/{OSRM_PROFILE}/{origin_lon},{origin_lat};{dest_lon},{dest_lat}"
    params: dict[str, Any] = {"overview": "false"}
    try:
        resp = requests.get(url, params=params, timeout=TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        logger.warning("OSRM request failed: %s", e)
        return (None, True)
    except Exception as e:
        logger.warning("OSRM parse/error: %s", e)
        return (None, True)

    routes = data.get("routes") or []
    if not routes:
        return (None, True)
    route = routes[0]
    # OSRM returns distance in meters
    distance_m = route.get("distance")
    if distance_m is None:
        return (None, True)
    try:
        return (float(distance_m), False)
    except (TypeError, ValueError):
        return (None, True)


def air_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters (for fallback when routing is unavailable)."""
    import math
    R = 6_371_000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

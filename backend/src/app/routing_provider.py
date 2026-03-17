from __future__ import annotations

from dataclasses import dataclass
from math import acos, cos, radians, sin
from typing import Protocol
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CommuteCache, Project


class RoutingProvider(Protocol):
  def get_travel_time_minutes(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
  ) -> float | None: ...


@dataclass
class MockRoutingProvider:
  """MVP routing provider – používá vzdušnou vzdálenost a průměrnou rychlost.

  - drive: 40 km/h
  - transit: 25 km/h
  """

  drive_speed_kmh: float = 40.0
  transit_speed_kmh: float = 25.0

  def get_travel_time_minutes(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
  ) -> float | None:
    d_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    if d_km is None or d_km <= 0:
      return 0.0
    mode_norm = (mode or "drive").lower()
    if mode_norm == "transit":
      speed = self.transit_speed_kmh
    else:
      speed = self.drive_speed_kmh
    if speed <= 0:
      return None
    hours = d_km / speed
    return hours * 60.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float | None:
  try:
    rlat1, rlon1, rlat2, rlon2 = map(radians, [lat1, lon1, lat2, lon2])
  except Exception:
    return None
  dlon = rlon2 - rlon1
  dlat = rlat2 - rlat1
  a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
  c = 2 * acos(max(-1.0, min(1.0, 1 - 2 * a))) if a > 0 else 0.0
  earth_radius_km = 6371.0
  return earth_radius_km * c


def _build_provider_from_config() -> RoutingProvider:
  """Select routing provider based on ROUTING_PROVIDER env var.

  Supported (for now):
    - "mock" (default)
    - "google" (stub)
    - "traveltime" (stub)
  """
  provider_name = os.getenv("ROUTING_PROVIDER", "mock").lower()
  if provider_name == "google":
    # Placeholder for future Google Maps implementation.
    return MockRoutingProvider()
  if provider_name == "traveltime":
    # Placeholder for future TravelTime implementation.
    return MockRoutingProvider()
  return MockRoutingProvider()


_provider: RoutingProvider = _build_provider_from_config()

COMMUTE_CACHE_TTL_DAYS = 30
COMMUTE_PROVIDER_NAME = "mock"


def get_travel_time_minutes(
  origin_lat: float,
  origin_lng: float,
  dest_lat: float,
  dest_lng: float,
  mode: str,
) -> float | None:
  """Low-level provider call without caching."""
  return _provider.get_travel_time_minutes(origin_lat, origin_lng, dest_lat, dest_lng, mode)


def get_cached_travel_time_minutes(
  db: Session,
  project: Project,
  commute_point: dict,
) -> float | None:
  """Return travel time using commute_cache with 30-day TTL.

  All external/provider calls must go through this helper.
  """
  from datetime import datetime, timedelta, timezone

  if project.gps_latitude is None or project.gps_longitude is None:
    return None

  try:
    # Normalize destination coordinates to fixed precision to stabilize cache key.
    raw_lat = float(commute_point.get("lat"))
    raw_lng = float(commute_point.get("lng"))
  except Exception:
    return None
  dest_lat = round(raw_lat, 6)
  dest_lng = round(raw_lng, 6)
  mode = str(commute_point.get("mode") or "drive").lower()

  ttl = timedelta(days=COMMUTE_CACHE_TTL_DAYS)
  now = datetime.now(timezone.utc)

  try:
    row = (
      db.execute(
        select(CommuteCache).where(
          CommuteCache.project_id == project.id,
          CommuteCache.dest_lat == dest_lat,
          CommuteCache.dest_lng == dest_lng,
          CommuteCache.mode == mode,
        )
      )
      .scalars()
      .first()
    )
    if row and (now - row.updated_at) <= ttl:
      return row.minutes

    minutes = get_travel_time_minutes(
      float(project.gps_latitude),
      float(project.gps_longitude),
      dest_lat,
      dest_lng,
      mode,
    )
    if minutes is None:
      return None

    if row:
      row.minutes = minutes
      row.provider = COMMUTE_PROVIDER_NAME
      row.updated_at = now
      db.add(row)
    else:
      db.add(
        CommuteCache(
          project_id=project.id,
          dest_lat=dest_lat,
          dest_lng=dest_lng,
          mode=mode,
          minutes=minutes,
          provider=COMMUTE_PROVIDER_NAME,
          updated_at=now,
        )
      )
    return minutes
  except Exception:
    # Fallback when commute_cache table or row handling fails – still return a travel time,
    # but skip DB caching to avoid breaking the API.
    return get_travel_time_minutes(
      float(project.gps_latitude),
      float(project.gps_longitude),
      dest_lat,
      dest_lng,
      mode,
    )


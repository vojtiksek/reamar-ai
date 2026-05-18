from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import date, datetime, timedelta, timezone
from math import acos, cos, radians, sin
from typing import Protocol
import logging
import os

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CommuteCache, Project

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CommuteResult — carries both travel time and optional route legs
# ---------------------------------------------------------------------------

@dataclass
class CommuteResult:
    minutes: float
    itinerary: list[dict] | None = None  # simplified legs for display
    is_estimated: bool = False           # True = mock/haversine, False = real routing


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float | None:
  try:
    rlat1, rlon1, rlat2, rlon2 = map(radians, [lat1, lon1, lat2, lon2])
  except Exception:
    return None
  dlon = rlon2 - rlon1
  dlat = rlat2 - rlat1
  a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
  c = 2 * acos(max(-1.0, min(1.0, 1 - 2 * a))) if a > 0 else 0.0
  return 6371.0 * c


def _next_weekday_date(weekday: int = 0) -> str:
  """Return next occurrence of given weekday (0=Mon) as YYYY-MM-DD."""
  today = date.today()
  days_ahead = (weekday - today.weekday()) % 7 or 7
  return (today + timedelta(days=days_ahead)).isoformat()


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

class RoutingProvider(Protocol):
  def get_travel_time_minutes(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
    arrival_time: str | None = None,
  ) -> float | None: ...


# ---------------------------------------------------------------------------
# Mock provider
# ---------------------------------------------------------------------------

@dataclass
class MockRoutingProvider:
  """Vzdušná vzdálenost ÷ průměrná rychlost. Fallback / testy."""

  drive_speed_kmh: float = 40.0
  transit_speed_kmh: float = 25.0

  def get_travel_time_minutes(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
    arrival_time: str | None = None,
  ) -> float | None:
    d_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    if d_km is None or d_km <= 0:
      return 0.0
    speed = self.transit_speed_kmh if (mode or "").lower() == "transit" else self.drive_speed_kmh
    return (d_km / speed) * 60.0 if speed > 0 else None


# ---------------------------------------------------------------------------
# OSRM + HERE provider (current default)
# ---------------------------------------------------------------------------

OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "http://router.project-osrm.org")
OSRM_TIMEOUT_SECONDS = 2.0

# Circuit breaker — po první síťové chybě přeskočí OSRM pro zbytek procesu
_osrm_circuit_open = False

HERE_API_KEY = os.getenv("HERE_API_KEY", "")
HERE_TRANSIT_BASE_URL = "https://transit.router.hereapi.com/v8/routes"
HERE_TIMEOUT_SECONDS = 8.0


@dataclass
class OsrmRoutingProvider:
  """drive → OSRM, transit → HERE (s arrival_time podporou), fallback → mock."""

  transit_speed_kmh: float = 25.0

  def get_travel_time_minutes(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
    arrival_time: str | None = None,
  ) -> float | None:
    if (mode or "drive").lower() == "drive":
      return self._osrm_drive(origin_lat, origin_lng, dest_lat, dest_lng)
    if HERE_API_KEY:
      return self._here_transit(origin_lat, origin_lng, dest_lat, dest_lng, arrival_time)
    d_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    if d_km is None or d_km <= 0:
      return 0.0
    return (d_km / self.transit_speed_kmh) * 60.0

  def _osrm_drive(self, origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> float | None:
    global _osrm_circuit_open
    d_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    if _osrm_circuit_open:
      return (d_km / 40.0) * 60.0 if d_km else 0.0
    url = f"{OSRM_BASE_URL}/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}?overview=false"
    try:
      resp = httpx.get(url, timeout=OSRM_TIMEOUT_SECONDS)
      resp.raise_for_status()
      data = resp.json()
      if data.get("code") != "Ok":
        logger.warning("OSRM code=%s", data.get("code"))
        return None
      return data["routes"][0]["duration"] / 60.0
    except Exception as exc:
      logger.warning("OSRM failed (%s), mock fallback", exc)
      _osrm_circuit_open = True
      return (d_km / 40.0) * 60.0 if d_km else 0.0

  def _here_transit(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    arrival_time: str | None,
  ) -> float | None:
    """HERE Transit API.

    arrival_time="HH:MM" → arriveBy dotaz na příští pondělí v daný čas.
    Bez arrival_time → "teď" (HERE použije aktuální čas).
    """
    params: dict = {
      "origin": f"{origin_lat},{origin_lng}",
      "destination": f"{dest_lat},{dest_lng}",
      "apikey": HERE_API_KEY,
    }
    if arrival_time:
      params["arrivalTime"] = f"{_next_weekday_date()}T{arrival_time}:00"

    try:
      resp = httpx.get(HERE_TRANSIT_BASE_URL, params=params, timeout=HERE_TIMEOUT_SECONDS)
      resp.raise_for_status()
      data = resp.json()
      routes = data.get("routes") or []
      if not routes:
        logger.warning("HERE Transit: no routes %s→%s", (origin_lat, origin_lng), (dest_lat, dest_lng))
        return None
      sections = routes[0].get("sections") or []
      if not sections:
        return None
      total_seconds = (
        datetime.fromisoformat(sections[-1]["arrival"]["time"])
        - datetime.fromisoformat(sections[0]["departure"]["time"])
      ).total_seconds()
      return max(0.0, total_seconds / 60.0)
    except Exception as exc:
      logger.warning("HERE Transit failed (%s), mock fallback", exc)
      d_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
      return (d_km / self.transit_speed_kmh) * 60.0 if d_km else 0.0


# ---------------------------------------------------------------------------
# Itinerary helpers
# ---------------------------------------------------------------------------

def _simplify_legs(legs: list[dict]) -> list[dict]:
  """Convert raw OTP legs into a compact display-friendly list."""
  result = []
  for leg in legs:
    mode = leg.get("mode", "WALK")
    dur_min = round(leg.get("duration", 0) / 60)
    if dur_min < 1:
      continue  # skip trivial legs
    entry: dict = {
      "mode": mode,
      "duration_min": dur_min,
      "from": (leg.get("from") or {}).get("name") or "",
      "to": (leg.get("to") or {}).get("name") or "",
    }
    route = leg.get("route") or {}
    if route.get("shortName"):
      entry["line"] = route["shortName"]
    result.append(entry)
  return result


# ---------------------------------------------------------------------------
# OTP provider (pro nasazení na server)
# ---------------------------------------------------------------------------

OTP_BASE_URL = os.getenv("OTP_BASE_URL", "http://localhost:8080")
OTP_TIMEOUT_SECONDS = 10.0

# Časy arriveBy dotazů (bez zadaného arrival_time od klienta)
_OTP_DEFAULT_ARRIVE_BY_TIMES = ["08:00:00", "08:30:00"]


@dataclass
class OtpRoutingProvider:
  """OpenTripPlanner provider — drive → OSRM, transit → OTP.

  arrival_time="HH:MM" → jeden arriveBy dotaz na příští pondělí.
  Bez arrival_time → 5 dotazů (07:00–09:00) → minimum (= nejlepší spoj v ráno).
  Fallback na OsrmRoutingProvider pokud OTP neodpovídá.
  """

  _fallback: OsrmRoutingProvider = None  # type: ignore[assignment]

  def __post_init__(self) -> None:
    self._fallback = OsrmRoutingProvider()

  def get_travel_time_minutes(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
    arrival_time: str | None = None,
  ) -> float | None:
    r = self.get_commute_result(origin_lat, origin_lng, dest_lat, dest_lng, mode, arrival_time)
    return r.minutes if r is not None else None

  def get_commute_result(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    mode: str,
    arrival_time: str | None = None,
  ) -> CommuteResult | None:
    mode_norm = (mode or "drive").lower()
    if mode_norm == "drive":
      # Use OTP CAR routing (real road network from OSM) instead of OSRM
      result = self._otp_drive(origin_lat, origin_lng, dest_lat, dest_lng)
      if result is not None:
        return result
      # Fallback to OSRM/haversine if OTP CAR fails
      minutes = self._fallback._osrm_drive(origin_lat, origin_lng, dest_lat, dest_lng)
      return CommuteResult(minutes=minutes, is_estimated=True) if minutes is not None else None
    result = self._otp_transit(origin_lat, origin_lng, dest_lat, dest_lng, arrival_time, mode_norm)
    return result

  def _otp_drive(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
  ) -> CommuteResult | None:
    """OTP CAR routing — real road network from OSM, no traffic."""
    query = """
    {
      plan(
        from: {lat: %(from_lat)s, lon: %(from_lon)s}
        to:   {lat: %(to_lat)s,   lon: %(to_lon)s}
        transportModes: [{mode: CAR}]
        numItineraries: 1
      ) {
        itineraries {
          duration
          legs { mode distance duration }
        }
      }
    }
    """ % {
      "from_lat": origin_lat, "from_lon": origin_lng,
      "to_lat": dest_lat,     "to_lon":   dest_lng,
    }
    try:
      resp = httpx.post(
        f"{OTP_BASE_URL}/otp/gtfs/v1",
        json={"query": query},
        timeout=OTP_TIMEOUT_SECONDS,
      )
      resp.raise_for_status()
      data = resp.json()
      itineraries = (
        data.get("data", {}).get("plan", {}).get("itineraries") or []
      )
      if not itineraries:
        return None
      best = itineraries[0]
      minutes = best["duration"] / 60.0
      legs = best.get("legs") or []
      distance_m = sum(leg.get("distance", 0) for leg in legs)
      itinerary = [{"mode": "CAR", "duration_min": round(minutes, 1), "distance_km": round(distance_m / 1000, 1)}]
      return CommuteResult(minutes=minutes, itinerary=itinerary)
    except Exception as exc:
      logger.warning("OTP CAR query failed (%s)", exc)
      return None

  def _otp_transit(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    arrival_time: str | None,
    mode: str = "transit",
  ) -> CommuteResult | None:
    monday = _next_weekday_date()

    modes_to_try = [mode]
    # For park_and_ride, also query pure transit — take the faster result.
    if mode == "park_and_ride":
      modes_to_try = ["park_and_ride", "transit"]

    candidates: list[CommuteResult] = []

    for m in modes_to_try:
      if arrival_time:
        r = self._otp_query(origin_lat, origin_lng, dest_lat, dest_lng, monday, f"{arrival_time}:00", arrive_by=True, mode=m)
        if r is not None:
          candidates.append(r)
      else:
        for t in _OTP_DEFAULT_ARRIVE_BY_TIMES:
          r = self._otp_query(origin_lat, origin_lng, dest_lat, dest_lng, monday, t, arrive_by=True, mode=m)
          if r is not None:
            candidates.append(r)

    if candidates:
      return min(candidates, key=lambda c: c.minutes)

    # OTP nedostupný → vzdušná vzdálenost (okamžité, bez síťového volání)
    logger.warning("OTP transit failed, mock fallback")
    d_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    if d_km is None or d_km <= 0:
      return CommuteResult(minutes=0.0, is_estimated=True)
    return CommuteResult(minutes=(d_km / 25.0) * 60.0, is_estimated=True)

  def _otp_query(
    self,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    date_str: str,
    time_str: str,
    arrive_by: bool,
    mode: str = "transit",
  ) -> CommuteResult | None:
    """OTP 2.x GraphQL API — endpoint /otp/gtfs/v1.

    mode="transit"       → TRANSIT + WALK
    mode="park_and_ride" → CAR (qualifier PARK) + TRANSIT + WALK
    """
    if mode == "park_and_ride":
      transport_modes = "[{mode: CAR, qualifier: PARK}, {mode: TRANSIT}, {mode: WALK}]"
    else:
      transport_modes = "[{mode: TRANSIT}, {mode: WALK}]"

    query = """
    {
      plan(
        from: {lat: %(from_lat)s, lon: %(from_lon)s}
        to:   {lat: %(to_lat)s,   lon: %(to_lon)s}
        date: "%(date)s"
        time: "%(time)s"
        numItineraries: 3
        transportModes: %(transport_modes)s
        walkSpeed: 1.6
        arriveBy: %(arrive_by)s
      ) {
        itineraries {
          duration
          legs {
            mode
            duration
            distance
            from { name }
            to { name }
            route { shortName }
          }
        }
      }
    }
    """ % {
      "from_lat": origin_lat, "from_lon": origin_lng,
      "to_lat": dest_lat,     "to_lon":   dest_lng,
      "date": date_str, "time": time_str,
      "arrive_by": "true" if arrive_by else "false",
      "transport_modes": transport_modes,
    }
    try:
      resp = httpx.post(
        f"{OTP_BASE_URL}/otp/gtfs/v1",
        json={"query": query},
        timeout=OTP_TIMEOUT_SECONDS,
      )
      resp.raise_for_status()
      data = resp.json()
      itineraries = (
        data.get("data", {}).get("plan", {}).get("itineraries") or []
      )
      if not itineraries:
        return None
      best = min(itineraries, key=lambda it: it["duration"])
      minutes = best["duration"] / 60.0
      itinerary = _simplify_legs(best.get("legs") or [])
      return CommuteResult(minutes=minutes, itinerary=itinerary or None)
    except Exception as exc:
      logger.warning("OTP query failed date=%s time=%s (%s)", date_str, time_str, exc)
      return None


# ---------------------------------------------------------------------------
# Provider factory
# ---------------------------------------------------------------------------

def _build_provider_from_config() -> RoutingProvider:
  """ROUTING_PROVIDER env var:
    "otp"  — OTP (transit) + OSRM (drive) — pro produkci na serveru
    "osrm" — OSRM (drive) + HERE (transit) — default
    "mock" — vzdušná vzdálenost
  """
  name = os.getenv("ROUTING_PROVIDER", "osrm").lower()
  if name == "otp":
    return OtpRoutingProvider()
  if name == "mock":
    return MockRoutingProvider()
  return OsrmRoutingProvider()


_provider: RoutingProvider = _build_provider_from_config()

COMMUTE_CACHE_TTL_DAYS = 90

# ---------------------------------------------------------------------------
# In-process request-scoped commute cache — eliminuje opakované DB SELECT
# dotazy pro stejný projekt (sdílené napříč jednotkami v scoring loop)
# ---------------------------------------------------------------------------
_request_commute_cache: dict[tuple, "CommuteResult"] = {}


def clear_request_commute_cache() -> None:
  """Smaže in-process cache — volat na začátku každého recomputu."""
  global _request_commute_cache
  _request_commute_cache = {}
_base_provider = os.getenv("ROUTING_PROVIDER", "osrm").lower()
COMMUTE_PROVIDER_NAME = (
  f"{_base_provider}+here" if (_base_provider not in ("mock", "otp") and HERE_API_KEY)
  else _base_provider
)


def get_travel_time_minutes(
  origin_lat: float,
  origin_lng: float,
  dest_lat: float,
  dest_lng: float,
  mode: str,
  arrival_time: str | None = None,
) -> float | None:
  """Low-level provider call without caching."""
  return _provider.get_travel_time_minutes(origin_lat, origin_lng, dest_lat, dest_lng, mode, arrival_time)


def get_cached_commute_result(
  db: Session,
  project: Project,
  commute_point: dict,
) -> CommuteResult | None:
  """Return CommuteResult (minutes + itinerary) using commute_cache with 30-day TTL."""
  if project.gps_latitude is None or project.gps_longitude is None:
    return None

  try:
    raw_lat = float(commute_point.get("lat"))
    raw_lng = float(commute_point.get("lng"))
  except Exception:
    return None

  dest_lat = round(raw_lat, 6)
  dest_lng = round(raw_lng, 6)
  mode = str(commute_point.get("mode") or "drive").lower()
  arrival_time: str | None = commute_point.get("arrival_time") or None

  # Encode arrival_time into mode cache key to avoid collision
  # e.g. "transit" vs "transit@09:00"
  cache_mode = f"{mode}@{arrival_time}" if arrival_time else mode

  # In-process cache — pro scoring loop (stejný projekt, tisíce jednotek)
  _req_key = (project.id, dest_lat, dest_lng, cache_mode, COMMUTE_PROVIDER_NAME)
  if _req_key in _request_commute_cache:
    return _request_commute_cache[_req_key]

  ttl = timedelta(days=COMMUTE_CACHE_TTL_DAYS)
  now = datetime.now(timezone.utc)

  try:
    row = (
      db.execute(
        select(CommuteCache).where(
          CommuteCache.project_id == project.id,
          CommuteCache.dest_lat == dest_lat,
          CommuteCache.dest_lng == dest_lng,
          CommuteCache.mode == cache_mode,
          CommuteCache.provider == COMMUTE_PROVIDER_NAME,
        )
      )
      .scalars()
      .first()
    )
    from . import here_metrics

    if row and (now - row.updated_at) <= ttl:
      # is_estimated: provider "mock" nebo chybí itinerář (OTP selhal, uložen mock výsledek)
      _is_est = row.provider == "mock" or row.itinerary_json is None
      _cached = CommuteResult(minutes=row.minutes, itinerary=row.itinerary_json, is_estimated=_is_est)
      _request_commute_cache[_req_key] = _cached
      if "here" in (row.provider or ""):
        here_metrics.incr("transit.cache_hit")
      return _cached

    # Cache miss — compute via provider
    if "here" in COMMUTE_PROVIDER_NAME:
      here_metrics.incr("transit.here_call")
    result: CommuteResult | None = None
    if hasattr(_provider, "get_commute_result"):
      result = _provider.get_commute_result(  # type: ignore[attr-defined]
        float(project.gps_latitude), float(project.gps_longitude),
        dest_lat, dest_lng, mode, arrival_time,
      )
    else:
      minutes = _provider.get_travel_time_minutes(
        float(project.gps_latitude), float(project.gps_longitude),
        dest_lat, dest_lng, mode, arrival_time,
      )
      result = CommuteResult(minutes=minutes) if minutes is not None else None

    if result is None:
      return None

    if row:
      row.minutes = result.minutes
      row.itinerary_json = result.itinerary
      row.provider = COMMUTE_PROVIDER_NAME
      row.updated_at = now
      db.add(row)
    else:
      db.add(CommuteCache(
        project_id=project.id,
        dest_lat=dest_lat,
        dest_lng=dest_lng,
        mode=cache_mode,
        minutes=result.minutes,
        itinerary_json=result.itinerary,
        provider=COMMUTE_PROVIDER_NAME,
        updated_at=now,
      ))
    _request_commute_cache[_req_key] = result
    return result
  except Exception:
    minutes = get_travel_time_minutes(
      float(project.gps_latitude), float(project.gps_longitude),
      dest_lat, dest_lng, mode, arrival_time,
    )
    return CommuteResult(minutes=minutes) if minutes is not None else None


def get_cached_travel_time_minutes(
  db: Session,
  project: Project,
  commute_point: dict,
) -> float | None:
  """Return travel time using commute_cache with 30-day TTL.

  Thin wrapper over get_cached_commute_result — also stores itinerary.
  """
  r = get_cached_commute_result(db, project, commute_point)
  return r.minutes if r is not None else None

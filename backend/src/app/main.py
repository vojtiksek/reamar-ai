from __future__ import annotations

import os
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any

# ---------------------------------------------------------------------------
# In-memory recompute progress — keyed by client_id
# ---------------------------------------------------------------------------
_recompute_progress: dict[int, dict] = {}
_progress_lock = threading.Lock()

from decimal import Decimal
import json

from fastapi import Depends, FastAPI, File, HTTPException, Query, Header, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import asc, case, desc, func, or_, and_, select, text
import sqlalchemy as sa
from sqlalchemy.sql.functions import coalesce
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, aliased, selectinload

from .column_catalog import get_columns as get_column_definitions
from .db import check_db_connection, get_db_session
from .filter_catalog import get_filter_groups
from .import_semantics import (
    canonical_ilike_clauses,
    CANONICAL_HEATING_PATTERNS,
    CANONICAL_WINDOWS_PATTERNS,
    CANONICAL_PARTITION_WALLS_PATTERNS,
)
from .models import (
    Project,
    ProjectAggregates,
    Unit,
    UnitApiPending,
    UnitOverride,
    UnitPriceHistory,
    ProjectOverride,
    Broker,
    Client,
    ClientProfile,
    ClientRecommendation,
    ClientRecommendationFeedback,
    ClientUnitMatch,
    ClientNote,
    UnitEvent,
    ScoringConfig,
    FutureProject,
    FutureProjectInterest,
    ClientMagicLink,
    ClientPortalSession,
    ErrorLog,
)
from .overrides import (
    OVERRIDEABLE_FIELDS,
    PROJECT_OVERRIDEABLE_FIELDS,
    build_override_map,
    build_project_override_map,
    unit_to_response_dict,
    apply_project_overrides_to_item,
    compute_equivalent_price_per_m2,
)
from .aggregates import recompute_project_aggregates, _haversine_m, _layout_group, SOLD_DATE_MAX_DAYS_FOR_COMPARABLE
from .project_catalog import (
    COMPUTED_COLUMN_KEYS,
    PROJECT_CATALOG_TO_ATTR,
    get_allowed_sort_keys as get_projects_sort_keys,
    get_project_columns,
)
from .project_location_metrics import (
    LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS,
    enrich_project_location_metrics,
    recompute_all_project_location_metrics,
)
from .location_sources import (
    refresh_all_location_sources_and_recompute,
    download_osm_sources_and_recompute,
)
from .walkability import (
    WALKABILITY_POI_CATEGORIES,
    get_project_walkability_poi_list,
    get_project_walkability_poi_overview,
    compute_personalized_walkability_score,
    project_to_raw_metrics,
)
from .routing_provider import get_cached_travel_time_minutes, get_cached_commute_result, clear_request_commute_cache
from .scoring import compute_full_score, compute_eligibility, resolve_weights, resolve_thresholds, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, resolve_groups, resolve_field_rules, resolve_eligibility_rules, resolve_flat_weights, FLAT_WEIGHT_DEFAULTS, FLAT_WEIGHT_LABELS, FLAT_WEIGHT_CATEGORIES, derive_flat_weights_from_wizard, merge_broker_weight_overrides, normalize_wizard, build_structured_wizard, _admin_area_soft_adjustment, SCORING_V2_CONFIG, SCORING_V2_LABELS
from .client_mode import (
    base_profile_to_working_filters,
    build_client_mode_state,
    compute_modified_keys,
    sanitize_working_filters,
    wizard_to_base_profile,
    working_filters_overrides_for_recompute,
)
from .walkability_sources import (
    refresh_walkability_sources_and_recompute,
    recompute_all_project_walkability as recompute_all_walkability,
)


app = FastAPI(title="Reamar AI Backend")

# CORS — origins read from ALLOWED_ORIGINS env var (comma-separated).
# Dev defaults cover local + Tailscale. In production set ALLOWED_ORIGINS to Vercel URL.
from .settings import settings as _cors_settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .error_logging import ErrorLoggingMiddleware  # noqa: E402

app.add_middleware(ErrorLoggingMiddleware)


# Lightweight per-request timing. Emits a single log line per request and
# returns the elapsed time as the X-Process-Time response header so the
# frontend / browser DevTools can see it without re-instrumenting.
# Logs go to stdout — visible in Railway logs and locally.
import logging as _t_logging
import time as _t_time

_perf_logger = _t_logging.getLogger("reamar.perf")
if not _perf_logger.handlers:
    _ph = _t_logging.StreamHandler()
    _ph.setFormatter(_t_logging.Formatter("%(asctime)s perf %(message)s"))
    _perf_logger.addHandler(_ph)
    _perf_logger.setLevel(_t_logging.INFO)


@app.middleware("http")
async def _timing_middleware(request, call_next):
    start = _t_time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (_t_time.perf_counter() - start) * 1000.0
    # Skip noisy health-check pings so Railway logs stay readable.
    if request.url.path not in ("/health", "/"):
        _perf_logger.info(
            "%s %s -> %d in %.0fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
    response.headers["X-Process-Time"] = f"{elapsed_ms:.0f}"
    return response


class ProjectInfo(BaseModel):
    developer: str | None
    name: str
    address: str | None
    city: str | None = None
    municipality: str | None = None
    district: str | None = None
    postal_code: str | None = None
    cadastral_area_iga: str | None = None
    administrative_district_iga: str | None = None
    region_iga: str | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    ride_to_center_min: float | None = None
    public_transport_to_center_min: float | None = None
    permit_regular: bool | None = None
    renovation: bool | None = None
    overall_quality: str | None = None
    windows: str | None = None
    heating: str | None = None
    partition_walls: str | None = None
    amenities: str | None = None


class PriceHistoryEntry(BaseModel):
    captured_at: datetime
    price_czk: int | None
    price_per_m2_czk: int | None
    availability_status: str | None
    available: bool


class OverrideValueBody(BaseModel):
    value: str


class PendingApiUpdate(BaseModel):
    field: str
    api_value: str


class PendingApiActionBody(BaseModel):
    field: str


class WalkabilityPreferences(BaseModel):
    """Client preferences for personalized walkability: high (2.0), normal (1.0), ignore (0.0)."""
    supermarket: str = "normal"
    pharmacy: str = "normal"
    park: str = "normal"
    restaurant: str = "normal"
    cafe: str = "normal"
    fitness: str = "normal"
    playground: str = "normal"
    kindergarten: str = "normal"
    primary_school: str = "normal"
    metro: str = "normal"
    tram: str = "normal"
    bus: str = "normal"


class PersonalizedWalkabilityBatchRequest(BaseModel):
    project_ids: list[int]
    preferences: WalkabilityPreferences


class UnitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    external_id: str
    project_id: int
    unit_name: str | None
    layout: str | None
    floor: int | None
    availability_status: str | None
    available: bool
    price_czk: int | None
    price_per_m2_czk: int | None
    floor_area_m2: float | None
    equivalent_area_m2: float | None
    exterior_area_m2: float | None
    balcony_area_m2: float | None
    terrace_area_m2: float | None
    garden_area_m2: float | None
    municipality: str | None
    city: str | None
    postal_code: str | None
    ride_to_center_min: float | None
    public_transport_to_center_min: float | None
    url: str | None
    project: ProjectInfo
    data: dict[str, Any]
    pending_api_updates: list[PendingApiUpdate] = []


class UnitsListResponse(BaseModel):
    items: list[UnitResponse]
    total: int
    limit: int
    offset: int
    average_price_czk: float | None = None
    average_price_per_m2_czk: float | None = None
    available_count: int | None = None
    average_local_price_diff_1000m: float | None = None
    average_local_price_diff_2000m: float | None = None


class LocalPriceDiffComparable(BaseModel):
    external_id: str
    project_name: str | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    price_per_m2_czk: float | None = None
    floor_area_m2: float | None = None
    total_price_czk: float | None = None
    exterior_area_m2: float | None = None
    layout: str | None = None
    floor: int | None = None
    last_seen: date | None = None
    sold_date: date | None = None
    distance_m: float
    availability_status: str | None = None
    available: bool
    renovation: bool | None = None


class LocalPriceDiffDebugResponse(BaseModel):
    unit_external_id: str
    radius_m: float
    unit_gps_latitude: float | None = None
    unit_gps_longitude: float | None = None
    group: str | None = None
    bucket_label: str | None = None
    bucket_min_area_m2: float | None = None
    bucket_max_area_m2: float | None = None
    unit_price_per_m2_czk: float | None = None
    unit_total_price_czk: float | None = None
    unit_layout: str | None = None
    unit_floor_area_m2: float | None = None
    unit_exterior_area_m2: float | None = None
    unit_floor: int | None = None
    ref_avg_price_per_m2_czk: float | None = None
    diff_percent: float | None = None
    unit_renovation: bool | None = None  # Rekonstrukce posuzované jednotky (porovnáváme jen se stejným typem)
    comparables: list[LocalPriceDiffComparable] = []


class ProjectsOverviewResponse(BaseModel):
    """Projects list: flat dict per item (catalog keys + aggregate keys)."""
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class ProjectsListResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


class AreaMarketAnalysisResponse(BaseModel):
    client_id: int
    projects_count: int
    active_units_count: int
    matching_units_count: int
    avg_price_czk: float | None
    avg_price_per_m2_czk: float | None
    min_price_czk: int | None
    max_price_czk: int | None
    avg_floor_area_m2: float | None
    layout_distribution: dict[str, int]
    budget_fit_units_count: int
    area_fit_units_count: int


class ClientSummary(BaseModel):
    id: int
    name: str
    email: str | None = None
    phone: str | None = None
    status: str
    broker_id: int
    created_at: datetime
    updated_at: datetime
    recommendations_count: int = 0
    notes: str | None = None
    profile_updated_at: datetime | None = None
    recommendations_computed_at: datetime | None = None
    recommendations_stale: bool = False


class ClientCreateBody(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    status: str = "new"
    notes: str | None = None


class ClientUpdateBody(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    status: str | None = None
    notes: str | None = None


class ClientProfileBody(BaseModel):
    budget_min: int | None = None
    budget_max: int | None = None
    area_min: float | None = None
    area_max: float | None = None
    layouts: dict | None = None
    property_type: str | None = None
    purchase_purpose: str | None = None
    walkability_preferences_json: dict | None = None
    filter_json: dict | None = None
    polygon_geojson: str | None = None
    commute_points_json: dict | None = None
    scoring_weights_json: dict | None = None


class ClientModeStateBody(BaseModel):
    """Full client-mode state returned by /clients/{id}/client-mode."""

    baseProfile: dict[str, Any]
    workingFilters: dict[str, Any]
    modifiedKeys: list[str]
    filtersUpdatedAt: str | None = None


class WorkingFiltersBody(BaseModel):
    """Partial update of workingFilters.

    ``modifiedKeys`` is accepted for backward compatibility but is silently
    ignored — the server always recomputes it from the frozen base + incoming
    workingFilters.
    """

    workingFilters: dict[str, Any]
    modifiedKeys: list[str] | None = None  # ignored; kept for client compat


class ClientRecommendationItem(BaseModel):
    rec_id: int
    pinned_by_broker: bool
    unit_external_id: str | None = None
    project_id: int | None = None
    project_name: str | None = None
    layout: str | None = None
    floor_area_m2: float | None = None
    exterior_area_m2: float | None = None
    price_czk: int | None = None
    price_per_m2_czk: int | None = None
    floor: int | None = None
    layout_label: str | None = None
    district: str | None = None
    score: float
    budget_fit: float
    walkability_fit: float
    location_fit: float
    layout_fit: float
    area_fit: float
    outdoor_fit: float = 50.0
    commute_fit: float = 0.0
    eligibility: str = "pass"
    eligibility_reasons: list[str] = []
    confidence: float = 100.0
    confidence_label: str = "high"
    confidence_reasons: list[str] = []
    top_strengths: list[str] = []
    top_compromises: list[str] = []
    project_lat: float | None = None
    project_lng: float | None = None
    distance_to_tram_stop_m: float | None = None
    distance_to_metro_station_m: float | None = None
    distance_to_bus_stop_m: float | None = None
    distance_to_train_station_m: float | None = None
    reason: dict[str, Any] | None = None
    broker_note: str | None = None
    shortlist_role: str | None = None
    shortlist_reason: str | None = None
    shortlist_risks: str | None = None
    shortlist_order: int | None = None
    feedback: "RecommendationFeedbackOut | None" = None
    construction_completion: str | None = None
    noise_label: str | None = None
    noise_day_db: float | None = None
    noise_night_db: float | None = None
    distance_to_tram_tracks_m: float | None = None
    distance_to_primary_road_m: float | None = None
    distance_to_railway_m: float | None = None
    price_diff_pct: float | None = None
    poi_counts: dict[str, int] = {}
    poi_distances: dict[str, float] = {}


ALLOWED_FEEDBACK_TYPES = {"liked", "saved", "disliked"}
ALLOWED_DISLIKE_REASONS = {
    "price", "location", "layout", "small_area",
    "standard_or_project", "noise_or_surroundings", "accessibility", "other",
}


class RecommendationFeedbackOut(BaseModel):
    feedback_type: str
    dislike_reason: str | None = None
    note: str | None = None
    updated_at: datetime


class RecommendationFeedbackIn(BaseModel):
    feedback_type: str
    dislike_reason: str | None = None
    note: str | None = None


class BrokerMatchItem(BaseModel):
    id: int
    client_id: int
    client_name: str
    unit_external_id: str
    project_name: str | None = None
    layout_label: str | None = None
    price_czk: int | None = None
    score: float
    event_type: str | None = None
    price_old: int | None = None
    price_new: int | None = None


class MarketFitBlocker(BaseModel):
    key: str
    label: str
    blocked_count: int
    blocked_percentage: float


class RelaxationSuggestion(BaseModel):
    label: str
    matching_units_count: int
    delta_vs_current: int


class MarketFitAnalysisResponse(BaseModel):
    client_id: int
    matching_units_count: int
    available_units_count: int
    top_blockers: list[MarketFitBlocker]
    relaxation_suggestions: list[RelaxationSuggestion]


class ClientWithoutInventoryItem(BaseModel):
    client_id: int
    client_name: str
    budget_max: int | None = None
    layouts: list[str] = []
    area_min: float | None = None
    area_max: float | None = None
    matching_units: int
    available_units: int


DbSession = Annotated[Session, Depends(get_db_session)]

VALID_OVERRIDE_FIELDS = OVERRIDEABLE_FIELDS
VALID_PROJECT_OVERRIDE_FIELDS = PROJECT_OVERRIDEABLE_FIELDS
PENDING_API_FIELDS = frozenset({"price_czk", "price_per_m2_czk", "availability_status"})

# Pole jejichž změna v unit override mění hodnoty v ProjectAggregates
# (counts, ceny, plochy, parking, payment, derived floors). Po PUT/DELETE
# těchto fields voláme recompute_project_aggregates([project_id]) — jinak
# /projects list zobrazuje staré počty, dokud neproběhne denní ops_runner.
# Když field NENÍ v této sadě (např. floorplan_url, notes), recompute by
# byl zbytečný a jen by zatížil DB.
AGGREGATE_AFFECTING_FIELDS = frozenset({
    "price_czk",
    "price_per_m2_czk",
    "available",
    "availability_status",  # přepnutí na sold/reserved → změní available_units
    "floor_area_m2",
    "floor",  # derived_total_floors
    "parking_indoor_price_czk",
    "parking_outdoor_price_czk",
    "payment_contract",
    "payment_construction",
    "payment_occupancy",
})


# ---------------------------------------------------------------------------
# Broker auth (MVP): email+password with SHA256 hashing and opaque session token.
# ---------------------------------------------------------------------------

AUTH_HEADER = "Authorization"


def _hash_password(password: str) -> str:
    import hashlib
    salt = "reamar_broker_salt_v1"
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def _generate_session_token() -> str:
    import secrets
    return secrets.token_urlsafe(32)


class BrokerLoginBody(BaseModel):
    email: str
    password: str


class BrokerInfo(BaseModel):
    id: int
    name: str
    email: str
    role: str
    token: str


from .settings import settings as _settings

_SUPABASE_JWT_SECRET = _settings.supabase_jwt_secret or os.getenv("SUPABASE_JWT_SECRET")
_SUPABASE_JWKS_URL = _settings.supabase_jwks_url or os.getenv("SUPABASE_JWKS_URL")

# Lazy singleton — fetched on first use, caches keys internally, refreshes on rotation.
_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client
    if not _SUPABASE_JWKS_URL:
        return None
    try:
        import jwt  # PyJWT
        # cache_keys=True: avoid a fetch per token. lifespan handled by PyJWKClient (default 300 s).
        _jwks_client = jwt.PyJWKClient(_SUPABASE_JWKS_URL, cache_keys=True)
        return _jwks_client
    except Exception:
        return None


def _try_verify_supabase_jwt(token: str) -> tuple[str, str | None] | None:
    """Return (sub, email) if token is a valid Supabase JWT, else None.

    Prefers asymmetric verification via JWKS (ES256/RS256).
    Falls back to HS256 with shared secret if JWKS not configured but SUPABASE_JWT_SECRET is.

    Email is returned so `get_current_broker` can email-fallback and self-heal
    brokers whose supabase_user_id drifted (e.g. manually reset Supabase user).
    """
    try:
        import jwt  # PyJWT
    except Exception:
        return None

    payload = None

    # Asymmetric path — new Supabase projects.
    jwks = _get_jwks_client()
    if jwks is not None:
        try:
            signing_key = jwks.get_signing_key_from_jwt(token).key
            payload = jwt.decode(
                token,
                signing_key,
                algorithms=["ES256", "RS256", "EdDSA"],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
            )
        except Exception:
            payload = None

    # Legacy HS256 path — kept for projects still on the old signing scheme.
    if payload is None and _SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                _SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
            )
        except Exception:
            payload = None

    if not payload:
        return None

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        return None
    email = payload.get("email")
    if not isinstance(email, str) or not email:
        email = None
    return sub, email


def get_current_broker(
    db: DbSession,
    authorization: str | None = Header(default=None, alias=AUTH_HEADER),
) -> Broker:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1].strip()

    # Preferred path: Supabase JWT.
    verified = _try_verify_supabase_jwt(token)
    if verified:
        sub, email = verified

        # 1) Primary match: supabase_user_id == sub.
        broker = db.execute(
            select(Broker).where(Broker.supabase_user_id == sub)
        ).scalars().first()
        if broker:
            return broker

        # 2) Self-heal by email (case-insensitive). Handles the case where a
        #    broker row exists but its supabase_user_id is null/stale (e.g.
        #    Supabase user was re-created or the link was never set).
        if email:
            broker = db.execute(
                select(Broker).where(func.lower(Broker.email) == email.lower())
            ).scalars().first()
            if broker:
                if broker.supabase_user_id != sub:
                    broker.supabase_user_id = sub
                    db.add(broker)
                    db.commit()
                    db.refresh(broker)
                return broker

        # Valid JWT but no broker row — do not fall back silently.
        raise HTTPException(status_code=401, detail="Broker not provisioned")

    # Legacy path: opaque session token (kept during migration, will be removed).
    broker = db.execute(
        select(Broker).where(Broker.session_token == token)
    ).scalars().first()
    if broker:
        return broker

    raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Admin routers — mounted here so they can wire `get_current_broker` as the
# auth dependency. See backend/src/app/admin_brokers.py.
# ---------------------------------------------------------------------------
from .admin_brokers import build_routes as _build_admin_broker_routes

app.include_router(_build_admin_broker_routes(get_current_broker))


def _get_unit_or_404(db: Session, external_id: str) -> Unit:
    result = db.execute(
        select(Unit)
        .where(Unit.external_id == external_id)
        .options(selectinload(Unit.project))
    )
    unit = result.scalars().first()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = (
        db.execute(select(Project).where(Project.id == project_id))
        .scalars()
        .first()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _point_in_polygon(lat: float, lon: float, polygon: list[tuple[float, float]]) -> bool:
    """Ray casting algorithm for point in polygon (lat,lon vs [(lat,lon),...])."""
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    x, y = lon, lat
    for i in range(n):
        x1, y1 = polygon[i - 1][1], polygon[i - 1][0]
        x2, y2 = polygon[i][1], polygon[i][0]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-9) + x1):
            inside = not inside
    return inside


def _build_market_filter(not_seen_max_days: int = 180, hide_stale: bool = True):
    """Return a SQLAlchemy condition for "on market" units.

    Includes:
    - available / reserved  (minus stale reservations when hide_stale=True)
    - not_seen units whose last_seen is within not_seen_max_days (0 = exclude all)

    Excludes:
    - sold units (not in the in_ list)
    - not_seen units that have a sold_date (already sold)
    - not_seen units on projects with 0 available_units (dead projects)
    """
    # Base: available or reserved
    base = func.lower(Unit.availability_status).in_(["available", "reserved"])
    if hide_stale:
        base = and_(
            base,
            or_(Unit.is_stale_reservation.is_(None), Unit.is_stale_reservation.is_(False)),
        )

    if not_seen_max_days > 0:
        cutoff = date.today() - timedelta(days=not_seen_max_days)
        # not_seen qualifies only if: recent last_seen, no sold_date,
        # and parent project still has available units (or no aggregates yet).
        dead_project = (
            select(ProjectAggregates.project_id)
            .where(ProjectAggregates.available_units == 0)
            .correlate_except(ProjectAggregates)
        )
        not_seen_cond = and_(
            func.lower(Unit.availability_status) == "not_seen",
            Unit.last_seen.isnot(None),
            Unit.last_seen >= cutoff,
            Unit.sold_date.is_(None),
            ~Unit.project_id.in_(dead_project),
        )
        return or_(base, not_seen_cond)

    return base


def _market_filter_from_config(thresholds: dict):
    """Build market filter from a resolved thresholds dict."""
    return _build_market_filter(
        not_seen_max_days=int(thresholds.get("not_seen_max_days", 180)),
        hide_stale=bool(thresholds.get("hide_stale_reservations", 1)),
    )


def _parse_polygon_geojson(polygon_geojson: str | None) -> list[tuple[float, float]] | None:
    if not polygon_geojson:
        return None
    try:
        data = json.loads(polygon_geojson)
        coords = None
        if data.get("type") == "Polygon":
            coords = data.get("coordinates", [])[0]
        elif data.get("type") == "Feature" and data.get("geometry", {}).get("type") == "Polygon":
            coords = data["geometry"].get("coordinates", [])[0]
        if not coords:
            return None
        pts: list[tuple[float, float]] = []
        for lng, lat in coords:
            pts.append((float(lat), float(lng)))
        return pts
    except Exception:
        return None


def _parse_polygon_or_multipolygon_geojson(
    polygon_geojson: str | None,
) -> list[list[tuple[float, float]]]:
    if not polygon_geojson:
        return []
    try:
        data = json.loads(polygon_geojson)
        polygons: list[list[tuple[float, float]]] = []

        def _ring_to_pts(ring: list[list[float]]) -> list[tuple[float, float]]:
            pts: list[tuple[float, float]] = []
            for lng, lat in ring:
                pts.append((float(lat), float(lng)))
            return pts

        if data.get("type") == "Polygon":
            ring = (data.get("coordinates") or [])[0] or []
            pts = _ring_to_pts(ring)
            if len(pts) >= 3:
                polygons.append(pts)
        elif data.get("type") == "MultiPolygon":
            for poly in data.get("coordinates") or []:
                ring = (poly or [])[0] or []
                pts = _ring_to_pts(ring)
                if len(pts) >= 3:
                    polygons.append(pts)
        elif data.get("type") == "Feature":
            geom = data.get("geometry") or {}
            gtype = geom.get("type")
            if gtype == "Polygon":
                ring = (geom.get("coordinates") or [])[0] or []
                pts = _ring_to_pts(ring)
                if len(pts) >= 3:
                    polygons.append(pts)
            elif gtype == "MultiPolygon":
                for poly in geom.get("coordinates") or []:
                    ring = (poly or [])[0] or []
                    pts = _ring_to_pts(ring)
                    if len(pts) >= 3:
                        polygons.append(pts)

        return polygons
    except Exception:
        return []


def _point_in_any_polygon(
    lat: float,
    lon: float,
    polygons: list[list[tuple[float, float]]],
) -> bool:
    for poly in polygons:
        if _point_in_polygon(lat, lon, poly):
            return True
    return False


# ---------------------------------------------------------------------------
# Auth & Brokers / Clients API
# ---------------------------------------------------------------------------


@app.post("/auth/login", response_model=BrokerInfo)
def broker_login(body: BrokerLoginBody, db: DbSession) -> BrokerInfo:
    broker = db.execute(
        select(Broker).where(Broker.email == body.email)
    ).scalars().first()
    if not broker or broker.password_hash != _hash_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not broker.session_token:
        broker.session_token = _generate_session_token()
        db.add(broker)
        db.commit()
        db.refresh(broker)
    return BrokerInfo(
        id=broker.id,
        name=broker.name,
        email=broker.email,
        role=broker.role,
        token=broker.session_token,
    )


@app.get("/clients", response_model=list[ClientSummary])
def list_clients(
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[ClientSummary]:
    rows = (
        db.execute(
            select(Client, func.count(ClientRecommendation.id))
            .outerjoin(ClientRecommendation, ClientRecommendation.client_id == Client.id)
            .where(Client.broker_id == broker.id)
            .group_by(Client.id)
        )
        .all()
    )
    out: list[ClientSummary] = []
    for client, rec_count in rows:
        out.append(
            ClientSummary(
                id=client.id,
                name=client.name,
                email=client.email,
                phone=client.phone,
                status=client.status,
                broker_id=client.broker_id,
                created_at=client.created_at,
                updated_at=client.updated_at,
                recommendations_count=int(rec_count or 0),
                notes=client.notes,
            )
        )
    return out


# ── Global search ──────────────────────────────────────────────────────

class SearchResultClient(BaseModel):
    id: int
    name: str
    email: str | None = None
    phone: str | None = None
    status: str

class SearchResultProject(BaseModel):
    id: int
    name: str
    district: str | None = None

class SearchResultUnit(BaseModel):
    id: int
    external_id: str
    project_id: int | None = None
    project_name: str | None = None
    floor: int | None = None
    price_czk: int | None = None

class SearchResults(BaseModel):
    clients: list[SearchResultClient] = []
    projects: list[SearchResultProject] = []
    units: list[SearchResultUnit] = []


@app.get("/search", response_model=SearchResults)
def global_search(
    q: str,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
    limit: int = 5,
) -> SearchResults:
    """Global search across clients (broker-scoped), projects, and units."""
    q = q.strip()
    if len(q) < 2:
        return SearchResults()

    pattern = f"%{q}%"

    clients = db.execute(
        select(Client)
        .where(Client.broker_id == broker.id)
        .where(or_(
            Client.name.ilike(pattern),
            Client.email.ilike(pattern),
            Client.phone.ilike(pattern),
        ))
        .limit(limit)
    ).scalars().all()

    projects = db.execute(
        select(Project)
        .where(or_(
            Project.name.ilike(pattern),
            Project.district.ilike(pattern),
        ))
        .order_by(Project.name)
        .limit(limit)
    ).scalars().all()

    unit_rows = db.execute(
        select(Unit, Project.name)
        .outerjoin(Project, Unit.project_id == Project.id)
        .where(or_(
            Unit.external_id.ilike(pattern),
            Unit.unit_name.ilike(pattern),
        ))
        .limit(limit)
    ).all()

    return SearchResults(
        clients=[
            SearchResultClient(id=c.id, name=c.name, email=c.email, phone=c.phone, status=c.status)
            for c in clients
        ],
        projects=[
            SearchResultProject(id=p.id, name=p.name, district=p.district)
            for p in projects
        ],
        units=[
            SearchResultUnit(
                id=u.id,
                external_id=u.external_id,
                project_id=u.project_id,
                project_name=pname,
                floor=u.floor,
                price_czk=u.price_czk,
            )
            for u, pname in unit_rows
        ],
    )


class ClientDashboardItem(BaseModel):
    id: int
    name: str
    email: str | None = None
    phone: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    recommendations_count: int = 0
    unseen_matches: int = 0
    last_note_at: datetime | None = None
    days_since_last_note: int | None = None
    has_profile: bool = False
    priority: str = "normal"  # 'high' | 'medium' | 'normal'


@app.get("/clients/dashboard", response_model=list[ClientDashboardItem])
def client_dashboard(
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[ClientDashboardItem]:
    """Enriched client list with priority signals for the broker dashboard."""
    from datetime import timezone
    now = datetime.now(timezone.utc)

    clients = db.execute(
        select(Client).where(Client.broker_id == broker.id)
    ).scalars().all()

    if not clients:
        return []

    client_ids = [c.id for c in clients]

    # Recommendation counts
    rec_counts = dict(
        db.execute(
            select(ClientRecommendation.client_id, func.count(ClientRecommendation.id))
            .where(ClientRecommendation.client_id.in_(client_ids))
            .group_by(ClientRecommendation.client_id)
        ).all()
    )

    # Unseen match counts
    unseen_counts = dict(
        db.execute(
            select(ClientUnitMatch.client_id, func.count(ClientUnitMatch.id))
            .where(
                ClientUnitMatch.client_id.in_(client_ids),
                ClientUnitMatch.seen == False,  # noqa: E712
            )
            .group_by(ClientUnitMatch.client_id)
        ).all()
    )

    # Last note per client
    last_notes = dict(
        db.execute(
            select(ClientNote.client_id, func.max(ClientNote.created_at))
            .where(ClientNote.client_id.in_(client_ids))
            .group_by(ClientNote.client_id)
        ).all()
    )

    # Profile existence
    profile_ids = set(
        r[0]
        for r in db.execute(
            select(ClientProfile.client_id).where(ClientProfile.client_id.in_(client_ids))
        ).all()
    )

    out: list[ClientDashboardItem] = []
    for c in clients:
        unseen = unseen_counts.get(c.id, 0)
        last_note_at = last_notes.get(c.id)
        days_since = (now - last_note_at).days if last_note_at else None
        has_profile = c.id in profile_ids

        # Priority calculation
        # high   = klient nemá brief → broker musí vyplnit zadání
        # medium = má profil ale 0 doporučení, nebo žádná aktivita > 14 dní
        # normal = má profil, má doporučení, nedávná aktivita
        rec_count = rec_counts.get(c.id, 0)
        priority = "normal"
        if not has_profile:
            priority = "high"
        elif rec_count == 0 or (days_since is not None and days_since > 14):
            priority = "medium"

        out.append(ClientDashboardItem(
            id=c.id,
            name=c.name,
            email=c.email,
            phone=c.phone,
            status=c.status,
            created_at=c.created_at,
            updated_at=c.updated_at,
            recommendations_count=rec_counts.get(c.id, 0),
            unseen_matches=unseen,
            last_note_at=last_note_at,
            days_since_last_note=days_since,
            has_profile=has_profile,
            priority=priority,
        ))

    # Sort: high first, then medium, then normal; within same priority by updated_at desc
    priority_order = {"high": 0, "medium": 1, "normal": 2}
    out.sort(key=lambda x: (priority_order.get(x.priority, 2), -x.updated_at.timestamp()))
    return out


@app.post("/clients", response_model=ClientSummary)
def create_client(
    body: ClientCreateBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientSummary:
    client = Client(
        broker_id=broker.id,
        name=body.name,
        email=body.email,
        phone=body.phone,
        status=body.status,
        notes=body.notes,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return ClientSummary(
        id=client.id,
        name=client.name,
        email=client.email,
        phone=client.phone,
        status=client.status,
        broker_id=client.broker_id,
        created_at=client.created_at,
        updated_at=client.updated_at,
        recommendations_count=0,
        notes=client.notes,
    )


def _get_client_for_broker(db: Session, client_id: int, broker: Broker) -> Client:
    client = db.get(Client, client_id)
    if not client or client.broker_id != broker.id:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@app.get("/clients/{client_id}", response_model=ClientSummary)
def get_client(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientSummary:
    client = _get_client_for_broker(db, client_id, broker)
    rec_count = db.execute(
        select(func.count(ClientRecommendation.id)).where(ClientRecommendation.client_id == client.id)
    ).scalar_one()
    freshness = _compute_recommendations_freshness(db, client.id)
    return ClientSummary(
        id=client.id,
        name=client.name,
        email=client.email,
        phone=client.phone,
        status=client.status,
        broker_id=client.broker_id,
        created_at=client.created_at,
        updated_at=client.updated_at,
        recommendations_count=int(rec_count or 0),
        notes=client.notes,
        profile_updated_at=freshness["profile_updated_at"],
        recommendations_computed_at=freshness["recommendations_computed_at"],
        recommendations_stale=freshness["stale"],
    )


def _compute_recommendations_freshness(db: Any, client_id: int) -> dict[str, Any]:
    """Detect whether recommendations are older than the latest brief change.

    Stale = profile.updated_at > max(ClientRecommendation.created_at) by at
    least a small tolerance (to ignore sub-second clock skew during recompute).
    """
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client_id)
    ).scalar_one_or_none()
    latest_rec_at = db.execute(
        select(func.max(ClientRecommendation.created_at)).where(
            ClientRecommendation.client_id == client_id
        )
    ).scalar_one_or_none()
    profile_at = profile.updated_at if profile else None
    stale = False
    if profile_at and latest_rec_at:
        # 60-second tolerance — a fresh recompute updates profile/recs close in time.
        stale = (profile_at - latest_rec_at).total_seconds() > 60
    elif profile_at and not latest_rec_at:
        # Profile exists but no recs yet — not stale, just empty.
        stale = False
    return {
        "profile_updated_at": profile_at,
        "recommendations_computed_at": latest_rec_at,
        "stale": stale,
    }


@app.patch("/clients/{client_id}", response_model=ClientSummary)
def update_client(
    client_id: int,
    body: ClientUpdateBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientSummary:
    client = _get_client_for_broker(db, client_id, broker)
    if body.name is not None:
        client.name = body.name
    if body.email is not None:
        client.email = body.email
    if body.phone is not None:
        client.phone = body.phone
    if body.status is not None:
        client.status = body.status
    if body.notes is not None:
        client.notes = body.notes
    db.add(client)
    db.commit()
    db.refresh(client)
    rec_count = db.execute(
        select(func.count(ClientRecommendation.id)).where(ClientRecommendation.client_id == client.id)
    ).scalar_one()
    return ClientSummary(
        id=client.id,
        name=client.name,
        email=client.email,
        phone=client.phone,
        status=client.status,
        broker_id=client.broker_id,
        created_at=client.created_at,
        updated_at=client.updated_at,
        recommendations_count=int(rec_count or 0),
        notes=client.notes,
    )


@app.delete("/clients/{client_id}", status_code=204)
def delete_client(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    client = _get_client_for_broker(db, client_id, broker)
    db.delete(client)
    db.commit()


# ── Client Notes ────────────────────────────────────────────────────────────


class ClientNoteCreate(BaseModel):
    note_type: str = "internal"  # 'meeting' | 'call' | 'internal'
    body: str


class ClientNoteItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_id: int
    broker_id: int
    note_type: str
    body: str
    created_at: datetime


@app.get("/clients/{client_id}/notes", response_model=list[ClientNoteItem])
def list_client_notes(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[ClientNoteItem]:
    _get_client_for_broker(db, client_id, broker)
    notes = (
        db.execute(
            select(ClientNote)
            .where(ClientNote.client_id == client_id)
            .order_by(ClientNote.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [ClientNoteItem.model_validate(n) for n in notes]


@app.post("/clients/{client_id}/notes", response_model=ClientNoteItem, status_code=201)
def create_client_note(
    client_id: int,
    payload: ClientNoteCreate,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientNoteItem:
    _get_client_for_broker(db, client_id, broker)
    if payload.note_type not in ("meeting", "call", "internal"):
        raise HTTPException(status_code=422, detail="note_type must be meeting, call, or internal")
    note = ClientNote(
        client_id=client_id,
        broker_id=broker.id,
        note_type=payload.note_type,
        body=payload.body,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return ClientNoteItem.model_validate(note)


@app.delete("/clients/{client_id}/notes/{note_id}", status_code=204)
def delete_client_note(
    client_id: int,
    note_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    note = db.execute(
        select(ClientNote).where(ClientNote.id == note_id, ClientNote.client_id == client_id)
    ).scalars().first()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()



@app.get("/clients/{client_id}/profile", response_model=ClientProfileBody | None)
def get_client_profile(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientProfileBody | None:
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if not profile:
        return None
    return ClientProfileBody(
        budget_min=profile.budget_min,
        budget_max=profile.budget_max,
        area_min=profile.area_min,
        area_max=profile.area_max,
        layouts=profile.layouts,
        property_type=profile.property_type,
        purchase_purpose=profile.purchase_purpose,
        walkability_preferences_json=profile.walkability_preferences_json,
        filter_json=profile.filter_json,
        polygon_geojson=profile.polygon_geojson,
        commute_points_json=profile.commute_points_json,
        scoring_weights_json=profile.scoring_weights_json,
    )


@app.get(
    "/clients/{client_id}/profile/structured",
    summary="Structured wizard output (hard_filters / preferences / metadata)",
)
def get_structured_wizard(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Return the wizard output split into hard_filters, preferences, and metadata.

    Useful for debugging how the wizard state maps to scoring decisions.
    """
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    sw = build_structured_wizard(profile)
    return sw.to_dict()


@app.post("/clients/{client_id}/profile", response_model=ClientProfileBody)
@app.patch("/clients/{client_id}/profile", response_model=ClientProfileBody)
def upsert_client_profile(
    client_id: int,
    body: ClientProfileBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientProfileBody:
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if not profile:
        profile = ClientProfile(client_id=client.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return ClientProfileBody(
        budget_min=profile.budget_min,
        budget_max=profile.budget_max,
        area_min=profile.area_min,
        area_max=profile.area_max,
        layouts=profile.layouts,
        property_type=profile.property_type,
        purchase_purpose=profile.purchase_purpose,
        walkability_preferences_json=profile.walkability_preferences_json,
        filter_json=profile.filter_json,
        polygon_geojson=profile.polygon_geojson,
        commute_points_json=profile.commute_points_json,
        scoring_weights_json=profile.scoring_weights_json,
    )


# ─── Client Mode ────────────────────────────────────────────────────────────
# Phase 1 foundation: base profile derived from the wizard, working filters
# the broker can diverge to, and metadata tracking which filters were
# manually modified.


def _ensure_client_profile(db: Session, client: Client) -> ClientProfile:
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if not profile:
        profile = ClientProfile(client_id=client.id)
        db.add(profile)
        db.flush()
    return profile


def _get_or_init_frozen_base(profile: ClientProfile) -> dict[str, Any]:
    """Return the stored frozen base snapshot, or derive+freeze it now."""
    stored = getattr(profile, "base_profile_json", None)
    if isinstance(stored, dict) and stored:
        return stored
    return wizard_to_base_profile(profile)


def _get_utc():
    from datetime import timezone
    return timezone.utc


@app.get(
    "/clients/{client_id}/client-mode",
    response_model=ClientModeStateBody,
    summary="Get Client Mode state (baseProfile + workingFilters + modifiedKeys)",
)
def get_client_mode_state(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientModeStateBody:
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()

    # On first access (no stored base yet) freeze the wizard snapshot.
    if profile is not None and not (
        isinstance(getattr(profile, "base_profile_json", None), dict)
        and profile.base_profile_json
    ):
        profile = _ensure_client_profile(db, client)
        base = wizard_to_base_profile(profile)
        profile.base_profile_json = base
        if not (isinstance(getattr(profile, "working_filters_json", None), dict) and profile.working_filters_json):
            profile.working_filters_json = base_profile_to_working_filters(base)
        profile.modified_keys_json = compute_modified_keys(base, profile.working_filters_json or {})
        db.add(profile)
        db.commit()
        db.refresh(profile)

    state = build_client_mode_state(profile)
    return ClientModeStateBody(**state)


@app.put(
    "/clients/{client_id}/client-mode/working-filters",
    response_model=ClientModeStateBody,
    summary="Update working filters (manual broker edits)",
)
def update_working_filters(
    client_id: int,
    body: WorkingFiltersBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientModeStateBody:
    client = _get_client_for_broker(db, client_id, broker)
    profile = _ensure_client_profile(db, client)

    base = _get_or_init_frozen_base(profile)
    working = sanitize_working_filters(body.workingFilters)
    modified_keys = compute_modified_keys(base, working)

    profile.base_profile_json = base
    profile.working_filters_json = working
    profile.modified_keys_json = modified_keys
    profile.client_mode_updated_at = datetime.now(tz=_get_utc())
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return ClientModeStateBody(**build_client_mode_state(profile))


@app.post(
    "/clients/{client_id}/client-mode/working-filters/reset",
    response_model=ClientModeStateBody,
    summary="Reset working filters to the frozen base profile",
)
def reset_working_filters(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientModeStateBody:
    client = _get_client_for_broker(db, client_id, broker)
    profile = _ensure_client_profile(db, client)

    base = _get_or_init_frozen_base(profile)

    profile.base_profile_json = base
    profile.working_filters_json = base_profile_to_working_filters(base)
    profile.modified_keys_json = []
    profile.client_mode_updated_at = datetime.now(tz=_get_utc())
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return ClientModeStateBody(**build_client_mode_state(profile))


# ─── Client Mode: location profile proxy ────────────────────────────────────

def _build_location_profile_proxy(profile: ClientProfile, location_overrides: dict) -> Any:
    """Return a profile-like object that applies location working-filter overrides.

    Wraps ``profile`` and overrides ``polygon_geojson`` and ``filter_json``
    so scoring sees updated location data. Returns the original profile
    unchanged when no relevant override keys are present.
    """
    import copy as _copy

    _LOC_KEYS = frozenset({"polygon_geojson", "location_admin_area", "method_admin"})
    if not any(k in location_overrides for k in _LOC_KEYS):
        return profile

    _new_polygon = location_overrides.get("polygon_geojson", profile.polygon_geojson)
    _admin_areas = location_overrides.get("location_admin_area")
    _method_admin = location_overrides.get("method_admin")

    orig = profile.filter_json or {}
    patched = _copy.deepcopy(orig)

    sw = patched.get("structured_wizard")
    if isinstance(sw, dict):
        hf = sw.setdefault("hard_filters", {})
        if _admin_areas is not None:
            hf["location_admin_area"] = _admin_areas
        if _method_admin is not None:
            hf["method_admin"] = _method_admin

    wizard = patched.setdefault("wizard", {})
    location = dict(wizard.get("location") or {})
    if _admin_areas is not None:
        location["administrative_area"] = _admin_areas
    if _method_admin is not None:
        location["method_admin"] = _method_admin
    wizard["location"] = location

    _patched_filter_json = patched

    class _LocationProxy:
        """Thin proxy: delegates everything to the real profile except
        location-related attributes overridden for this recompute pass."""

        def __getattr__(self, name: str) -> Any:
            return getattr(profile, name)

        @property
        def polygon_geojson(self) -> str | None:  # type: ignore[override]
            return _new_polygon

        @property
        def filter_json(self) -> dict | None:  # type: ignore[override]
            return _patched_filter_json

    return _LocationProxy()


def _wizard_preferences_adjustment(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
) -> float:
    """Return a bonus/penalty adjustment (points, capped externally to ±20/+15)
    based on StructuredWizard preferences and hard-filter intensity levels.

    Reads from StructuredWizard (hard_filters + preferences) — no raw wizard dict.

    Convention:
      "prefer" → mild signal  (±3–5 pts)
      "must"   → strong signal (±8–12 pts)
    Data absent for a given project/unit → 0 (neutral, no penalty for missing data).
    """
    if not profile:
        return 0.0

    sw = build_structured_wizard(profile)
    hf = sw.hard_filters
    pref = sw.preferences

    adj = 0.0

    # Helper: derive intensity from split must/prefer booleans.
    # "must" takes precedence (stronger signal) when both are somehow True.
    def _intensity(must: bool, prefer: bool) -> str | None:
        if must:
            return "must"
        if prefer:
            return "prefer"
        return None

    # ── Noise sensitivity ─────────────────────────────────────────────────────
    qa = _intensity(hf.must_quiet_area, pref.prefer_quiet_area)
    if qa:
        nl = project.noise_label
        if nl is not None:
            nl_low = nl.lower()
            if "nízk" in nl_low:
                adj += 5.0 if qa == "must" else 4.0
            elif "vyšší" in nl_low or "vysoký" in nl_low or "vysoká" in nl_low:
                adj += -12.0 if qa == "must" else -5.0

    # (intensity, distance, close_thresh, mid_thresh, close_must, close_prefer, mid_must, mid_prefer, far_must, far_prefer)
    _noise_dist_checks = [
        (_intensity(hf.must_no_main_road, pref.prefer_no_main_road),
         project.distance_to_primary_road_m, 150.0, 400.0, -12.0, -5.0, -6.0, -2.0, 4.0, 3.0),
        (_intensity(hf.must_no_tram, pref.prefer_no_tram),
         project.distance_to_tram_tracks_m, 100.0, 300.0, -10.0, -4.0, -5.0, -2.0, 3.0, 2.0),
        (_intensity(hf.must_no_railway, pref.prefer_no_railway),
         project.distance_to_railway_m, 300.0, 700.0, -10.0, -4.0, -5.0, -2.0, 3.0, 2.0),
        (_intensity(hf.must_no_airport, pref.prefer_no_airport),
         project.distance_to_airport_m, 5_000.0, 10_000.0, -10.0, -4.0, -4.0, -2.0, 3.0, 2.0),
    ]
    for intensity, dist, close, mid, cm, cp, mm, mp, fm, fp in _noise_dist_checks:
        if not intensity or dist is None:
            continue
        is_must = intensity == "must"
        if dist < close:
            adj += cm if is_must else cp
        elif dist < mid:
            adj += mm if is_must else mp
        else:
            adj += fm if is_must else fp

    # ── Floor preference ──────────────────────────────────────────────────────
    unit_floor = unit.floor

    # ground_floor_sensitive: client dislikes being on ground floor (floor <= 0)
    gfs = _intensity(hf.exclude_ground_floor, pref.ground_floor_sensitive)
    if gfs and unit_floor is not None:
        if unit_floor <= 0:
            adj += -15.0 if gfs == "must" else -6.0

    # preferred_floor: "ground" | "low" | "middle" | "high" | "ignore"
    pf = pref.preferred_floor
    if pf and pf != "ignore" and unit_floor is not None:
        floor_match = (
            (pf == "ground" and unit_floor <= 0)
            or (pf == "low" and 1 <= unit_floor <= 3)
            or (pf == "middle" and 4 <= unit_floor <= 7)
            or (pf == "high" and unit_floor >= 8)
        )
        if floor_match:
            adj += 5.0
        elif pf == "ground" and unit_floor > 3:
            adj += -4.0
        elif pf == "high" and unit_floor <= 1:
            adj += -4.0

    # ── Orientation preference ────────────────────────────────────────────────
    orient_prefs = pref.outdoor_orientation or {}
    if orient_prefs and unit.orientation:
        unit_dirs: set[str] = {ch for ch in unit.orientation.upper() if ch in "NSEW"}
        dir_map = {"south": "S", "north": "N", "east": "E", "west": "W"}
        for direction, letter in dir_map.items():
            dir_pref = orient_prefs.get(direction)
            if dir_pref not in ("prefer", "must"):
                continue
            if letter in unit_dirs:
                adj += 5.0 if dir_pref == "must" else 3.0
            else:
                adj += -8.0 if dir_pref == "must" else -3.0

    # ── Outdoor space (unified) ─────────────────────────────────────────────
    outdoor_int = _intensity(hf.must_outdoor_space, pref.prefer_outdoor_space)
    if outdoor_int:
        is_must = outdoor_int == "must"
        ext = unit.exterior_area_m2
        if ext is not None and float(ext) > 0:
            adj += 5.0 if is_must else 3.0
            if hf.outdoor_area_min is not None and float(ext) >= float(hf.outdoor_area_min):
                adj += 3.0
            elif hf.outdoor_area_min is not None:
                adj += -2.0
        else:
            adj += -10.0 if is_must else -4.0

    # ── Energy class ─────────────────────────────────────────────────────────
    if hf.energy_class:
        unit_ec = getattr(project, "energy_class", None)
        if unit_ec:
            ec_order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6}
            req_rank = ec_order.get(hf.energy_class.upper()[:1], 99)
            unit_rank = ec_order.get(str(unit_ec).strip().upper()[:1], 99)
            if unit_rank <= req_rank:
                adj += 5.0
            elif unit_rank == req_rank + 1:
                adj += -3.0

    # ── Developer preference ─────────────────────────────────────────────────
    if pref.preferred_developer and pref.preferred_developer.strip():
        proj_dev = getattr(project, "developer", None) or ""
        if pref.preferred_developer.strip().lower() in proj_dev.lower():
            adj += 8.0
        else:
            adj += -2.0

    # ── Completion date proximity ────────────────────────────────────────────
    if hf.latest_move_in:
        from datetime import date as _date
        try:
            max_date = _date.fromisoformat(str(hf.latest_move_in))
            proj_date = getattr(project, "completion_date", None)
            if proj_date is not None:
                if isinstance(proj_date, str):
                    proj_date = _date.fromisoformat(proj_date)
                if hasattr(proj_date, "date"):
                    proj_date = proj_date.date()
                if proj_date <= max_date:
                    adj += 4.0
        except (ValueError, TypeError):
            pass

    # ── Renovation / new-build preference ──────────────────────────────────
    if unit.renovation is not None:
        is_new_build = unit.renovation is False
        if pref.prefer_new:
            adj += 4.0 if is_new_build else -3.0
        elif pref.prefer_renovation:
            adj += 4.0 if unit.renovation else -3.0

    # ── Administrative area — soft location preference ────────────────────
    # Active only when method_admin == False (opt-in hard filter handles
    # the must-have case separately in compute_eligibility).
    adj += _admin_area_soft_adjustment(project, hf)

    return adj


def _compute_unit_match_score(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
    db: Session | None = None,
) -> tuple[float, dict[str, float]]:
    """MVP matching: combine budget, walkability, location, layout, area, commute."""

    # ── Hard filters for "musí být" / "must" constraints ──────────────────
    # If a constraint is set to "must" and the unit/project doesn't satisfy it,
    # return score 0 immediately (hard exclusion).
    if profile and profile.filter_json:
        wizard = (profile.filter_json or {}).get("wizard") or {}

        # Standards: recuperation, air_conditioning, floor_heating, exterior_blinds
        standards = wizard.get("standards") or {}
        if standards.get("recuperation") == "must" and getattr(project, "recuperation", None) != "true":
            return 0.0, {"hard_filter": "recuperation"}
        if standards.get("air_conditioning") == "must" and not getattr(unit, "air_conditioning", None):
            return 0.0, {"hard_filter": "air_conditioning"}
        if standards.get("floor_heating") == "must":
            h = getattr(unit, "heating", None) or getattr(project, "heating", None) or ""
            if "podlah" not in str(h).lower():
                return 0.0, {"hard_filter": "floor_heating"}
        if standards.get("exterior_blinds") == "must":
            eb = getattr(unit, "exterior_blinds", None)
            if eb is None or str(eb).lower() in ("false", "0", ""):
                return 0.0, {"hard_filter": "exterior_blinds"}

        # Building amenities: parking, cellar, bike_room, stroller_room, fitness, courtyard_garden, reception
        amenities = wizard.get("house_amenities") or {}
        amenity_map = {
            "parking": None,  # parking checked via parking price fields
            "bike_room": "bike_room",
            "stroller_room": "stroller_room",
            "fitness": "fitness",
            "courtyard_garden": "courtyard_garden",
            "reception": "reception",
            "concierge": "concierge",
        }
        for pref_key, project_attr in amenity_map.items():
            if amenities.get(pref_key) == "must" and project_attr:
                if not getattr(project, project_attr, None):
                    return 0.0, {"hard_filter": pref_key}

        # Noise: "must" = must avoid (distance too close → exclude)
        noise = wizard.get("noise") or {}
        if noise.get("quiet_area") == "must":
            nl = getattr(project, "noise_label", None)
            if nl and ("vyšší" in nl.lower() or "vysoký" in nl.lower() or "vysoká" in nl.lower()):
                return 0.0, {"hard_filter": "quiet_area"}
        if noise.get("main_road") == "must":
            d = getattr(project, "distance_to_primary_road_m", None)
            if d is not None and d < 150:
                return 0.0, {"hard_filter": "main_road"}
        if noise.get("tram") == "must":
            d = getattr(project, "distance_to_tram_tracks_m", None)
            if d is not None and d < 100:
                return 0.0, {"hard_filter": "tram_noise"}
        if noise.get("railway") == "must":
            d = getattr(project, "distance_to_railway_m", None)
            if d is not None and d < 300:
                return 0.0, {"hard_filter": "railway_noise"}
        if noise.get("airport") == "must":
            d = getattr(project, "distance_to_airport_m", None)
            if d is not None and d < 5000:
                return 0.0, {"hard_filter": "airport_noise"}

        # Outdoor: unified outdoor_space preference
        outdoor = wizard.get("outdoor") or {}
        if outdoor.get("outdoor_space") == "must":
            ext = unit.exterior_area_m2
            if ext is None or float(ext) <= 0:
                return 0.0, {"hard_filter": "outdoor_space"}
            min_out = outdoor.get("min_outdoor_area_m2")
            if min_out is not None and float(ext) < float(min_out):
                return 0.0, {"hard_filter": "outdoor_space_too_small"}
        # Legacy: keep old balcony/terrace/garden hard filters for backwards compat
        for outdoor_key in ("balcony", "terrace", "garden"):
            if outdoor.get(outdoor_key) == "must":
                val = getattr(unit, f"{outdoor_key}_area_m2", None)
                if val is None or float(val) <= 0:
                    return 0.0, {"hard_filter": outdoor_key}

        # Energy class: hard filter if set
        energy_pref = wizard.get("energy_class")
        if energy_pref and energy_pref != "ignore":
            unit_ec = getattr(project, "energy_class", None)
            if unit_ec:
                ec_order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6}
                req_rank = ec_order.get(energy_pref.upper(), 99)
                unit_rank = ec_order.get(str(unit_ec).strip().upper()[:1], 99)
                if unit_rank > req_rank + 1:  # allow 1 grade tolerance
                    return 0.0, {"hard_filter": "energy_class"}

        # Completion date: hard filter
        completion_pref = wizard.get("completion_date")
        if completion_pref:
            from datetime import date as _date
            try:
                max_date = _date.fromisoformat(str(completion_pref))
                proj_date = getattr(project, "completion_date", None)
                if proj_date is not None:
                    if isinstance(proj_date, str):
                        proj_date = _date.fromisoformat(proj_date)
                    if hasattr(proj_date, "date"):
                        proj_date = proj_date.date()
                    if proj_date > max_date:
                        return 0.0, {"hard_filter": "completion_date"}
            except (ValueError, TypeError):
                pass

        # Developer preference: soft filter (no hard exclusion, handled in adjustment)

        # Days on market: hard filter
        budget_prefs = wizard.get("budget") or {}
        max_dom = budget_prefs.get("max_days_on_market")
        if max_dom is not None:
            proj_dom = getattr(project, "max_days_on_market", None)
            if proj_dom is not None and int(proj_dom) > int(max_dom):
                return 0.0, {"hard_filter": "days_on_market"}

        # Payment contract: hard filter
        max_pct = budget_prefs.get("max_payment_contract_pct")
        if max_pct is not None:
            proj_pc = getattr(project, "payment_contract", None)
            if proj_pc is not None:
                # DB stores as fraction 0-1, wizard stores as percent 0-100
                pct_val = float(proj_pc) * 100 if float(proj_pc) <= 1 else float(proj_pc)
                if pct_val > float(max_pct):
                    return 0.0, {"hard_filter": "payment_contract"}

        # Renovation preference: "only_new" / "only_renovation" as hard filter
        reno_pref = wizard.get("renovation_preference")
        if reno_pref == "only_new" and unit.renovation is True:
            return 0.0, {"hard_filter": "only_new"}
        if reno_pref == "only_renovation" and unit.renovation is False:
            return 0.0, {"hard_filter": "only_renovation"}

    price = unit.price_czk
    area = float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None
    budget_fit = 0.0
    if profile and price is not None:
        if profile.budget_min is None and profile.budget_max is None:
            budget_fit = 100.0
        else:
            lo = profile.budget_min or 0
            hi = profile.budget_max or price
            if lo <= price <= hi:
                budget_fit = 100.0
            else:
                # linear decay up to 50 % outside range
                center = (lo + hi) / 2 if hi > lo else hi or lo or 1
                diff_ratio = abs(price - center) / max(center, 1)
                budget_fit = max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))

    # Walkability: use personalized scoring if preferences present,
    # otherwise fallback to project's general walkability_score.
    walk_fit = 0.0
    try:
        prefs = (profile.walkability_preferences_json if profile else None) or {}
        if prefs and any(v != "normal" for v in prefs.values()):
            raw = project_to_raw_metrics(project)
            result = compute_personalized_walkability_score(raw, prefs)
            if result.get("score") is not None:
                walk_fit = float(result["score"])
        elif project.walkability_score is not None:
            walk_fit = float(project.walkability_score)
        else:
            walk_fit = 50.0  # neutral fallback instead of 0
    except Exception:
        walk_fit = 50.0

    # Location fit: inside polygon bonus
    loc_fit = 0.0
    if project.gps_latitude is not None and project.gps_longitude is not None and profile:
        poly = _parse_polygon_geojson(profile.polygon_geojson)
        if poly:
            inside = _point_in_polygon(
                float(project.gps_latitude),
                float(project.gps_longitude),
                poly,
            )
            loc_fit = 100.0 if inside else 60.0
        else:
            loc_fit = 70.0

    # Layout fit – compare normalized layout bucket (e.g. "1kk", "2kk") with profile preferences.
    layout_fit = 0.0
    if profile and profile.layouts and "values" in profile.layouts and unit.layout:
        pref_values = [str(v).strip().lower() for v in (profile.layouts.get("values") or [])]
        unit_bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
        layout_fit = 100.0 if unit_bucket in pref_values else 50.0

    # Area fit
    # Neutral default: 50 (no opinion expressed), not 100.
    area_fit = 50.0
    if profile and area is not None:
        has_lo = profile.area_min is not None
        has_hi = profile.area_max is not None
        if has_lo or has_hi:
            # Explicit hard bounds set — use them as before.
            lo = profile.area_min or 0.0
            hi = profile.area_max or area
            if lo <= area <= hi:
                area_fit = 100.0
            else:
                center = (lo + hi) / 2 if hi > lo else hi or lo or 1.0
                diff_ratio = abs(area - center) / max(center, 1.0)
                area_fit = max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))
        else:
            pass  # No area range → neutral 50

    # Outdoor fit
    outdoor_fit = 50.0  # neutral when no preference
    if profile and profile.filter_json:
        wizard_outdoor = (
            ((profile.filter_json or {}).get("wizard") or {}).get("outdoor") or {}
        )
        min_outdoor = wizard_outdoor.get("min_outdoor_area_m2")
        if min_outdoor is not None:
            try:
                min_outdoor = float(min_outdoor)
                if unit.exterior_area_m2 is not None:
                    unit_outdoor = float(unit.exterior_area_m2)
                else:
                    unit_outdoor = (
                        (unit.balcony_area_m2 or 0.0)
                        + (unit.terrace_area_m2 or 0.0)
                        + (unit.garden_area_m2 or 0.0)
                    )
                if min_outdoor <= 0:
                    outdoor_fit = 100.0
                elif unit_outdoor >= min_outdoor:
                    outdoor_fit = 100.0
                else:
                    outdoor_fit = max(0.0, 100.0 * unit_outdoor / min_outdoor)
            except (TypeError, ValueError):
                pass  # malformed value → keep neutral 50

    # Commute fit – based on client commute_points_json.
    commute_fit = 0.0
    commute_details: list[dict[str, Any]] = []
    if (
        profile
        and profile.commute_points_json
        and project.gps_latitude is not None
        and project.gps_longitude is not None
        and db is not None
    ):
        points = profile.commute_points_json or []
        if isinstance(points, dict):
            # allow wrapper like {"points": [...]}
            points = points.get("points") or []
        hard_failed = False
        per_point_scores: list[float] = []
        for cp in points:
            try:
                label = str(cp.get("label") or "")
                dest_lat = float(cp.get("lat"))
                dest_lng = float(cp.get("lng"))
                mode = str(cp.get("mode") or "drive")
                max_minutes = float(cp.get("max_minutes"))
            except Exception:
                continue
            priority = str(cp.get("priority") or "ignore")
            tol = cp.get("tolerance_minutes")
            tolerance_minutes = float(tol) if tol is not None else 0.0
            commute_result = get_cached_commute_result(db, project, cp)
            if commute_result is None:
                continue
            travel_min = commute_result.minutes
            limit = max_minutes + tolerance_minutes
            if priority == "must_have" and travel_min > limit:
                # Hard fail – jednotka nevyhovuje klíčovému dojezdu.
                commute_details.append(
                    {
                        "label": label,
                        "mode": mode,
                        "minutes": travel_min,
                        "max_minutes": max_minutes,
                        "priority": priority,
                        "passed": False,
                        "itinerary": commute_result.itinerary,
                    }
                )
                hard_failed = True
                break
            if priority in ("must_have", "prefer"):
                if travel_min <= max_minutes:
                    score = 100.0
                elif travel_min > limit and limit > 0:
                    score = 0.0
                elif limit > max_minutes:
                    ratio = (travel_min - max_minutes) / max(1.0, limit - max_minutes)
                    score = max(0.0, 100.0 * (1.0 - ratio))
                else:
                    score = 0.0
                per_point_scores.append(score)
                commute_details.append(
                    {
                        "label": label,
                        "mode": mode,
                        "minutes": travel_min,
                        "max_minutes": max_minutes,
                        "priority": priority,
                        "passed": travel_min <= limit,
                        "itinerary": commute_result.itinerary,
                    }
                )
        if hard_failed:
            return 0.0, {
                "budget_fit": budget_fit,
                "walkability_fit": walk_fit,
                "location_fit": loc_fit,
                "layout_fit": layout_fit,
                "area_fit": area_fit,
                "outdoor_fit": outdoor_fit,
                "commute_fit": 0.0,
                "commute_details": commute_details,
            }
        if per_point_scores:
            # Use the worst (min) point score so jeden špatný dojezd nezanikne v průměru.
            commute_fit = min(per_point_scores)

    # Aggregate score (weights)
    total = (
        0.30 * budget_fit
        + 0.20 * walk_fit
        + 0.20 * loc_fit
        + 0.10 * layout_fit
        + 0.10 * area_fit
        + 0.05 * outdoor_fit
        + 0.05 * commute_fit
    )

    # Wizard preferences adjustment: noise sensitivity, floor, orientation.
    # Capped to ±20 so no single preference can dominate the final score.
    pref_adj = _wizard_preferences_adjustment(unit, project, profile)
    pref_adj = max(-20.0, min(15.0, pref_adj))
    total = max(0.0, min(100.0, total + pref_adj))

    return total, {
        "budget_fit": budget_fit,
        "walkability_fit": walk_fit,
        "location_fit": loc_fit,
        "layout_fit": layout_fit,
        "area_fit": area_fit,
        "outdoor_fit": outdoor_fit,
        "commute_fit": commute_fit,
        "commute_details": commute_details,
        "pref_adj": pref_adj,
    }


def _build_recompute_funnel(
    *,
    funnel_total: int,
    funnel_after_budget: int,
    funnel_after_area: int,
    funnel_after_type: int,
    funnel_after_layout: int,
    funnel_after_outdoor: int,
    funnel_after_movein: int,
    has_budget_filter: bool,
    has_area_filter: bool,
    has_type_filter: bool,
    has_layout_filter: bool,
    has_outdoor_filter: bool,
    has_movein_filter: bool,
    dropped_location: int,
    dropped_other: int,
    scored_before_threshold: int,
    scored_after_threshold: int,
    dropped_score: int,
    dropped_limit: int,
    final_count: int,
) -> dict[str, Any]:
    """Build the filter-funnel diagnostics response.

    All SQL-level filters (budget, area, type, layout, outdoor, movein) are
    represented by their own step. Per-unit Python drops (location, other)
    follow. Steps are emitted only when the filter was actually applied or
    when it dropped at least one unit.
    """
    steps: list[dict[str, Any]] = []
    prev = funnel_total

    def _sql_step(key: str, label: str, after: int, active: bool) -> None:
        nonlocal prev
        if active:
            steps.append({"key": key, "label": label, "removed": max(0, prev - after), "remaining": after})
            prev = after

    _sql_step("budget", "Rozpočet", funnel_after_budget, has_budget_filter)
    _sql_step("area", "Plocha", funnel_after_area, has_area_filter)
    _sql_step("property_type", "Typ nemovitosti", funnel_after_type, has_type_filter)
    _sql_step("layout", "Dispozice", funnel_after_layout, has_layout_filter)
    _sql_step("outdoor", "Venkovní plocha", funnel_after_outdoor, has_outdoor_filter)
    _sql_step("movein", "Nastěhování", funnel_after_movein, has_movein_filter)

    if dropped_location > 0:
        after_loc = max(0, prev - dropped_location)
        steps.append({"key": "location", "label": "Lokalita", "removed": dropped_location, "remaining": after_loc})
        prev = after_loc
    if dropped_other > 0:
        steps.append({"key": "other", "label": "Ostatní požadavky", "removed": dropped_other, "remaining": scored_before_threshold})
    if dropped_score > 0:
        steps.append({"key": "scoring", "label": "Skóre pod prahem", "removed": dropped_score, "remaining": scored_after_threshold})
    if dropped_limit > 0:
        steps.append({"key": "visible_limit", "label": "Limit zobrazení", "removed": dropped_limit, "remaining": final_count})
    return {
        "total": funnel_total,
        "steps": steps,
        "final": final_count,
    }


@app.get("/clients/{client_id}/recommendations/recompute/progress")
def get_recompute_progress(
    client_id: int,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Vrací aktuální stav pre-warmingu dojezdových časů pro daného klienta."""
    with _progress_lock:
        prog = _recompute_progress.get(client_id)
        if prog is None:
            return {"total": 0, "done": 0, "status": "idle"}
        return {"total": prog["total"], "done": prog["done"], "status": prog["status"]}


@app.post("/clients/{client_id}/recommendations/recompute")
def recompute_client_recommendations(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    import time as _T; _t0 = _T.perf_counter(); _tl = _t0
    def _tp(label):
        nonlocal _tl; n = _T.perf_counter(); print(f"[RECOMPUTE] {label}: {n-_tl:.2f}s (total {n-_t0:.1f}s)", flush=True); _tl = n
    clear_request_commute_cache()
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()

    # Load scoring config early — needed for market filter thresholds.
    global_cfg = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    _thresholds_early = resolve_thresholds(global_cfg.thresholds_json if global_cfg else None)

    # Build filter conditions separately so we can compute stepwise funnel counts
    # without duplicating the filtering logic.
    base_conditions: list = [
        _market_filter_from_config(_thresholds_early)
    ]
    budget_conditions: list = []
    area_conditions: list = []
    type_conditions: list = []
    layout_conditions: list = []
    outdoor_conditions: list = []
    movein_conditions: list = []

    # Client Mode: resolve working-filter overrides once, use effective values below.
    _effective_profile = profile
    _wf_overrides: dict[str, Any] = {}
    if profile:
        _wf_overrides = working_filters_overrides_for_recompute(
            profile.working_filters_json,
            profile.modified_keys_json,
        )
        _effective_budget_min = _wf_overrides.get("budget_min", profile.budget_min)
        _effective_budget_max = _wf_overrides.get("budget_max", profile.budget_max)
        _effective_area_min = _wf_overrides.get("area_min", profile.area_min)
        _effective_area_max = _wf_overrides.get("area_max", profile.area_max)
        _effective_property_type = _wf_overrides.get("property_type", profile.property_type)
        _effective_layouts = _wf_overrides.get("layouts", profile.layouts)

        # Build location proxy if location overrides are present
        _loc_keys = {"polygon_geojson", "location_admin_area", "method_admin"}
        if any(k in _wf_overrides for k in _loc_keys):
            _effective_profile = _build_location_profile_proxy(profile, _wf_overrides)

    if profile:
        # Apply tolerance from wizard to widen the SQL filter window.
        # Scoring still penalizes units beyond the ideal; this just ensures
        # they enter the candidate pool instead of being silently excluded.
        wiz_budget = ((profile.filter_json or {}).get("wizard", {}).get("budget", {}))
        price_tol_pct = wiz_budget.get("max_price_tolerance_pct", 0) or 0
        area_tol_pct = wiz_budget.get("max_area_tolerance_pct", 0) or 0

        if _effective_budget_min is not None:
            budget_conditions.append(Unit.price_czk >= _effective_budget_min)
        if _effective_budget_max is not None:
            effective_budget_max = int(_effective_budget_max * (1 + price_tol_pct / 100))
            budget_conditions.append(Unit.price_czk <= effective_budget_max)
        if _effective_area_min is not None:
            effective_area_min = _effective_area_min * (1 - area_tol_pct / 100)
            area_conditions.append(Unit.floor_area_m2 >= effective_area_min)
        if _effective_area_max is not None:
            area_conditions.append(Unit.floor_area_m2 <= _effective_area_max)
        # Property type hard filter
        prop_type = _effective_property_type
        if prop_type == "flat":
            type_conditions.append(
                func.lower(Unit.category).notin_(["house", "dům", "rodinný dům", "řadový dům"])
            )
        elif prop_type == "house":
            type_conditions.append(
                func.lower(Unit.category).in_(["house", "dům", "rodinný dům", "řadový dům"])
            )

    # Layout SQL filter — reverse-map bucket names ("2kk") to DB values ("layout_2").
    # 5kk/6kk/7kk arrive in the DB via the URL/unit_name detection in
    # import_units (BuiltMind only natively produces layout_1..layout_4).
    _BUCKET_TO_DB_LAYOUT: dict[str, str] = {
        "1kk": "layout_1", "2kk": "layout_2", "3kk": "layout_3", "4kk": "layout_4",
        "5kk": "layout_5", "6kk": "layout_6", "7kk": "layout_7",
        "1.5kk": "layout_1_5",
    }
    pref_layout_buckets: list[str] = []
    if profile:
        _layout_src = _effective_layouts if isinstance(_effective_layouts, dict) else None
        if _layout_src is None and profile.layouts:
            _layout_src = profile.layouts
        if _layout_src and "values" in _layout_src:
            pref_layout_buckets = [str(v).strip().lower() for v in (_layout_src.get("values") or [])]
        if pref_layout_buckets:
            _db_layouts = [_BUCKET_TO_DB_LAYOUT[b] for b in pref_layout_buckets if b in _BUCKET_TO_DB_LAYOUT]
            if _db_layouts:
                layout_conditions.append(Unit.layout.in_(_db_layouts))

    # Outdoor area SQL filter (wizard.outdoor.min_outdoor_area_m2 or wizard.budget.min_outdoor_area_m2)
    if profile:
        _wiz = (profile.filter_json or {}).get("wizard", {})
        _outdoor_min = (
            (_wiz.get("outdoor") or {}).get("min_outdoor_area_m2")
            or (_wiz.get("budget") or {}).get("min_outdoor_area_m2")
        )
        if _outdoor_min is not None:
            try:
                _outdoor_min_f = float(_outdoor_min)
                if _outdoor_min_f > 0:
                    _outdoor_tol = float((_wiz.get("budget") or {}).get("max_outdoor_tolerance_pct") or 0)
                    _eff_outdoor_min = _outdoor_min_f * (1 - _outdoor_tol / 100)
                    outdoor_conditions.append(Unit.exterior_area_m2 >= _eff_outdoor_min)
            except (TypeError, ValueError):
                pass

    # Move-in deadline SQL filter (wizard.latest_move_in or wizard.completion_date)
    if profile:
        _wiz = (profile.filter_json or {}).get("wizard", {})
        _latest_move_in = _wiz.get("latest_move_in") or _wiz.get("completion_date")
        if _latest_move_in:
            try:
                _move_in_date = date.fromisoformat(str(_latest_move_in))
                movein_conditions.append(
                    or_(Project.completion_date.is_(None), Project.completion_date <= _move_in_date)
                )
            except (ValueError, TypeError):
                pass

    # -- Funnel step 1: cumulative COUNTs for SQL-level filters --
    # Cheap index-backed COUNT queries. Used only for the diagnostics response.
    def _funnel_count(conds: list) -> int:
        if not conds:
            return 0
        return int(
            db.execute(
                select(func.count())
                .select_from(Unit)
                .join(Project, Unit.project_id == Project.id)
                .where(and_(*conds))
            ).scalar_one()
            or 0
        )

    _tp("conditions built")
    _sql_base = base_conditions + budget_conditions + area_conditions + type_conditions
    funnel_total = _funnel_count(base_conditions)
    funnel_after_budget = _funnel_count(base_conditions + budget_conditions)
    funnel_after_area = _funnel_count(base_conditions + budget_conditions + area_conditions)
    funnel_after_type = _funnel_count(_sql_base)
    funnel_after_layout = _funnel_count(_sql_base + layout_conditions)
    funnel_after_outdoor = _funnel_count(_sql_base + layout_conditions + outdoor_conditions)
    funnel_after_movein = _funnel_count(_sql_base + layout_conditions + outdoor_conditions + movein_conditions)
    _tp(f"7x funnel COUNT (total={funnel_total}, after_movein={funnel_after_movein})")

    _all_sql = _sql_base + layout_conditions + outdoor_conditions + movein_conditions
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(and_(*_all_sql))
    )

    rows = db.execute(q.order_by(Unit.id)).all()
    _tp(f"main SELECT ({len(rows)} rows)")

    # Load derived_total_floors for floor-based hard filters (penthouse, ground floor)
    _row_project_ids = list({row[1].id for row in rows})
    _dtf_map: dict[int, int | None] = {}
    if _row_project_ids:
        _dtf_rows = db.execute(
            select(ProjectAggregates.project_id, ProjectAggregates.derived_total_floors)
            .where(ProjectAggregates.project_id.in_(_row_project_ids))
        ).all()
        _dtf_map = {r[0]: r[1] for r in _dtf_rows}

    # Resolve scoring weights: global (DB) → per-client override → normalize
    # (global_cfg already loaded above for market filter thresholds)
    global_w = global_cfg.config_json if global_cfg else None
    client_w = profile.scoring_weights_json if profile else None
    weights = resolve_weights(global_w, client_w)

    # Resolve flat scoring weights from wizard + broker overrides
    flat_w = resolve_flat_weights(profile)

    # Resolve recommendation visibility thresholds
    thresholds = resolve_thresholds(global_cfg.thresholds_json if global_cfg else None)
    hide_below = float(thresholds["hide_below_score"])
    strong_min = float(thresholds["strong_pick_min_score"])
    visible_limit = int(thresholds["default_visible_limit"]) or 100

    # -- Pre-warm commute cache in parallel (avoids sequential OTP calls) --
    # Collects unique (project_id → Project) pairs × commute points and fires
    # all routing queries concurrently.  Each thread owns its own DB session so
    # SQLAlchemy session state is never shared across threads.
    _commute_points: list[dict] = []
    if profile and getattr(profile, "commute_points_json", None):
        _cp_raw = profile.commute_points_json or []
        if isinstance(_cp_raw, dict):
            _cp_raw = _cp_raw.get("points") or []
        _commute_points = [
            cp for cp in _cp_raw
            if cp.get("lat") is not None and cp.get("lng") is not None
        ]

    if _commute_points:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        from .db import SessionLocal
        from .routing_provider import get_cached_travel_time_minutes as _get_tt

        _unique_projects: dict[int, Project] = {
            proj.id: proj for _, proj in rows
            if proj.gps_latitude is not None and proj.gps_longitude is not None
        }

        # Inicializuj progress
        _total_projects = len(_unique_projects)
        with _progress_lock:
            _recompute_progress[client.id] = {
                "total": _total_projects,
                "done": 0,
                "_done_ids": set(),
                "status": "warming",
            }

        # Každý worker dostane vlastní session, ale sdílíme pool — max 5 workerů
        # aby se nepřetížil PostgreSQL connection pool.
        def _prewarm(project_snapshot: dict, cp: dict) -> None:
            session = SessionLocal()
            try:
                _p = type("_P", (), project_snapshot)()
                _get_tt(session, _p, cp)
                session.commit()
            except Exception:
                session.rollback()
            finally:
                session.close()
            # Aktualizuj progress po dokončení projektu
            pid = project_snapshot["id"]
            with _progress_lock:
                prog = _recompute_progress.get(client.id)
                if prog:
                    prog["_done_ids"].add(pid)
                    prog["done"] = len(prog["_done_ids"])

        _tasks: list[tuple[dict, dict]] = []
        for proj_id, proj in _unique_projects.items():
            snap = {
                "id": proj.id,
                "gps_latitude": proj.gps_latitude,
                "gps_longitude": proj.gps_longitude,
            }
            for cp in _commute_points:
                _tasks.append((snap, cp))

        with ThreadPoolExecutor(max_workers=5) as _executor:
            _futures = [_executor.submit(_prewarm, snap, cp) for snap, cp in _tasks]
            for _f in as_completed(_futures):
                pass

        with _progress_lock:
            if client.id in _recompute_progress:
                _recompute_progress[client.id]["status"] = "done"
        _tp("prewarm done")

    _tp("pre-scoring setup")
    # -- Funnel step 2: classify per-unit drops (location / other) --
    # Layout, outdoor, and move-in are now SQL-level filters (see above).
    _LOCATION_REASON_KEYS = (
        "outside_polygon",
        "polygon_location",
        "outside_admin_area",
        "admin_area",
    )
    funnel_dropped_location = 0
    funnel_dropped_other = 0

    scored: list[tuple[float, Unit, Project, dict[str, float]]] = []
    # Collect strong matches here; bulk-upsert after the loop to avoid
    # SQLAlchemy insertmanyvalues batching stripping ON CONFLICT clause.
    strong_match_scores: dict[int, float] = {}  # unit_id → score

    for unit, project in rows:
        scoring_config = {
                "groups": global_cfg.groups_json if global_cfg else None,
                "field_rules": global_cfg.field_rules_json if global_cfg else None,
                "eligibility_rules": global_cfg.eligibility_rules_json if global_cfg else None,
            }
        _agg_proxy = type("_AggProxy", (), {"derived_total_floors": _dtf_map.get(project.id)})()
        result = compute_full_score(unit, project, _effective_profile, weights=weights, db=db, scoring_config=scoring_config, flat_weights=flat_w, aggregates=_agg_proxy)
        score = result["score"]
        if result.get("eligibility") == "fail":
            # Classify the hard-filter failure for funnel diagnostics
            _reasons = result.get("eligibility_reasons") or []
            _first = str(_reasons[0]) if _reasons else ""
            if any(k in _first for k in _LOCATION_REASON_KEYS):
                funnel_dropped_location += 1
            else:
                funnel_dropped_other += 1
            continue
        if score <= 0:
            # Non-fail eligibility but zero score — rare edge case
            funnel_dropped_other += 1
            continue
        scored.append((score, unit, project, result))
        if score >= strong_min:
            strong_match_scores[unit.id] = score

    _tp(f"scoring loop ({len(rows)} units, {len(scored)} scored)")

    # Bulk upsert strong matches — single raw SQL to avoid SQLAlchemy
    # insertmanyvalues batching which drops the ON CONFLICT clause.
    if strong_match_scores:
        from sqlalchemy.dialects.postgresql import insert as _pg_insert
        db.execute(
            _pg_insert(ClientUnitMatch)
            .values([
                {"client_id": client.id, "unit_id": uid, "score": sc}
                for uid, sc in strong_match_scores.items()
            ])
            .on_conflict_do_update(
                index_elements=["client_id", "unit_id"],
                set_={"score": sa.literal_column("EXCLUDED.score")},
            )
        )

    scored.sort(key=lambda t: t[0], reverse=True)
    _scored_before_threshold = len(scored)
    # Apply hide_below_score: units below threshold are not stored as recommendations
    scored = [(s, u, p, r) for s, u, p, r in scored if s >= hide_below]
    funnel_dropped_score = _scored_before_threshold - len(scored)
    top = scored[:visible_limit]
    funnel_dropped_limit = max(0, len(scored) - len(top))

    # Preserve feedback from existing recs before deleting them
    old_recs = db.execute(
        select(ClientRecommendation)
        .options(selectinload(ClientRecommendation.feedback))
        .where(
            ClientRecommendation.client_id == client.id,
            ClientRecommendation.pinned_by_broker.is_(False),
            ClientRecommendation.hidden_by_broker.is_(False),
        )
    ).scalars().all()
    saved_feedback: dict[int, dict] = {}  # unit_id → {feedback_type, dislike_reason, note}
    for old_rec in old_recs:
        if old_rec.feedback:
            saved_feedback[old_rec.unit_id] = {
                "feedback_type": old_rec.feedback.feedback_type,
                "dislike_reason": old_rec.feedback.dislike_reason,
                "note": old_rec.feedback.note,
            }

    # Delete existing non-pinned, non-hidden suggestions
    db.execute(
        sa.delete(ClientRecommendation).where(
            ClientRecommendation.client_id == client.id,
            ClientRecommendation.pinned_by_broker.is_(False),
            ClientRecommendation.hidden_by_broker.is_(False),
        )
    )

    # Collect unit_ids the broker has already hidden — don't re-insert them.
    hidden_unit_ids: set[int] = set(
        db.execute(
            select(ClientRecommendation.unit_id).where(
                ClientRecommendation.client_id == client.id,
                ClientRecommendation.hidden_by_broker.is_(True),
            )
        ).scalars().all()
    )

    for score, unit, project, result in top:
        if unit.id in hidden_unit_ids:
            continue
        # Assign recommendation bucket
        bucket = "hidden"
        if score >= strong_min:
            bucket = "strong"
        elif score >= float(thresholds["review_pick_min_score"]):
            bucket = "review"
        else:
            bucket = "fallback"
        result["recommendation_bucket"] = bucket
        # Assign recommendation bucket
        bucket = "hidden"
        if score >= strong_min:
            bucket = "strong"
        elif score >= float(thresholds["review_pick_min_score"]):
            bucket = "review"
        else:
            bucket = "fallback"
        result["recommendation_bucket"] = bucket
        rec = ClientRecommendation(
            client_id=client.id,
            unit_id=unit.id,
            project_id=project.id,
            score=score,
            reason_json=result,
        )
        db.add(rec)
        # Re-attach preserved feedback if this unit had feedback before recompute
        if unit.id in saved_feedback:
            db.flush()  # ensure rec.id is assigned
            fb = saved_feedback[unit.id]
            db.add(ClientRecommendationFeedback(
                recommendation_id=rec.id,
                feedback_type=fb["feedback_type"],
                dislike_reason=fb["dislike_reason"],
                note=fb["note"],
            ))
    # Re-validate pinned recommendations against current eligibility.
    # Pinned recs survive the delete above, but may now fail hard filters
    # (e.g. client changed to "only_new" after pinning a renovation unit).
    pinned_recs = db.execute(
        select(ClientRecommendation)
        .where(
            ClientRecommendation.client_id == client.id,
            ClientRecommendation.pinned_by_broker.is_(True),
        )
    ).scalars().all()

    unpinned_count = 0
    for prec in pinned_recs:
        pinned_unit = db.get(Unit, prec.unit_id)
        pinned_project = db.get(Project, prec.project_id) if prec.project_id else None
        if pinned_unit and pinned_project and profile:
            elig = compute_eligibility(pinned_unit, pinned_project, profile)
            if elig["status"] == "fail":
                prec.pinned_by_broker = False
                prec.hidden_by_broker = True
                unpinned_count += 1

    db.commit()

    funnel = _build_recompute_funnel(
        funnel_total=funnel_total,
        funnel_after_budget=funnel_after_budget,
        funnel_after_area=funnel_after_area,
        funnel_after_type=funnel_after_type,
        funnel_after_layout=funnel_after_layout,
        funnel_after_outdoor=funnel_after_outdoor,
        funnel_after_movein=funnel_after_movein,
        has_budget_filter=bool(budget_conditions),
        has_area_filter=bool(area_conditions),
        has_type_filter=bool(type_conditions),
        has_layout_filter=bool(layout_conditions),
        has_outdoor_filter=bool(outdoor_conditions),
        has_movein_filter=bool(movein_conditions),
        dropped_location=funnel_dropped_location,
        dropped_other=funnel_dropped_other,
        scored_before_threshold=_scored_before_threshold,
        scored_after_threshold=len(scored),
        dropped_score=funnel_dropped_score,
        dropped_limit=funnel_dropped_limit,
        final_count=len(top),
    )

    _tp(f"DB commit + funnel (created={len(top)})")

    return {
        "client_id": client.id,
        "total_candidates": len(rows),
        "created": len(top),
        "pinned_failed_eligibility": unpinned_count,
        "funnel": funnel,
    }


@app.get(
    "/clients/{client_id}/market-fit-analysis",
    response_model=MarketFitAnalysisResponse,
)
def market_fit_analysis(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> MarketFitAnalysisResponse:
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()

    # Base set: on-market units (respects stale/not_seen thresholds from config)
    _mf_cfg = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    _mf_thresholds = resolve_thresholds(_mf_cfg.thresholds_json if _mf_cfg else None)
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(_market_filter_from_config(_mf_thresholds))
    )
    rows_all = db.execute(q.order_by(Unit.id.asc())).all()

    # Pre-filter by polygon when available so "Na trhu" reflects the client's area
    poly_prefilter = _parse_polygon_geojson(profile.polygon_geojson) if profile else None
    if poly_prefilter:
        rows = [
            (u, p) for u, p in rows_all
            if p.gps_latitude is not None and p.gps_longitude is not None
            and _point_in_polygon(float(p.gps_latitude), float(p.gps_longitude), poly_prefilter)
        ]
    else:
        rows = rows_all

    available_units_count = len(rows)

    if not profile or available_units_count == 0:
        return MarketFitAnalysisResponse(
            client_id=client.id,
            matching_units_count=0,
            available_units_count=available_units_count,
            top_blockers=[],
            relaxation_suggestions=[],
        )

    # Precompute layout buckets
    pref_layout_buckets: list[str] = []
    if profile.layouts and "values" in profile.layouts:
        pref_layout_buckets = [
            str(v).strip().lower() for v in (profile.layouts.get("values") or [])
        ]

    def eval_constraints(
        prof: ClientProfile,
    ) -> tuple[int, dict[str, int]]:
        """Return (matching_count, blocked_by_key)."""
        blocked_by = {
            "budget": 0,
            "area": 0,
            "layout": 0,
            "location": 0,
            "commute": 0,
            "standards": 0,
        }
        matching = 0

        # Pre-parse polygon once
        poly = _parse_polygon_geojson(prof.polygon_geojson)

        for unit, project in rows:
            price = unit.price_czk
            area = (
                float(unit.floor_area_m2)
                if unit.floor_area_m2 is not None
                else None
            )

            passes_budget = True
            if price is not None:
                if prof.budget_min is not None and price < prof.budget_min:
                    passes_budget = False
                if prof.budget_max is not None and price > prof.budget_max:
                    passes_budget = False

            passes_area = True
            if area is not None:
                if prof.area_min is not None and area < prof.area_min:
                    passes_area = False
                if prof.area_max is not None and area > prof.area_max:
                    passes_area = False

            passes_layout = True
            if pref_layout_buckets:
                if unit.layout is None:
                    passes_layout = False
                else:
                    unit_bucket = _layout_group(str(unit.layout)) or str(
                        unit.layout
                    ).strip().lower()
                    passes_layout = unit_bucket in pref_layout_buckets

            passes_location = True
            if poly and project.gps_latitude is not None and project.gps_longitude is not None:
                inside = _point_in_polygon(
                    float(project.gps_latitude),
                    float(project.gps_longitude),
                    poly,
                )
                passes_location = inside

            # Commute: check ONLY from in-process cache (no OTP calls).
            # market_fit_analysis is advisory — it should never block on OTP.
            passes_commute = True
            if (
                prof.commute_points_json
                and project.gps_latitude is not None
                and project.gps_longitude is not None
            ):
                from .routing_provider import _request_commute_cache, COMMUTE_PROVIDER_NAME
                points = prof.commute_points_json or []
                if isinstance(points, dict):
                    points = points.get("points") or []
                for cp in points:
                    try:
                        max_minutes = float(cp.get("max_minutes"))
                    except Exception:
                        continue
                    priority = str(cp.get("priority") or "ignore")
                    tol = cp.get("tolerance_minutes")
                    tolerance_minutes = float(tol) if tol is not None else 0.0
                    # Use in-process cache only — never call OTP/OSRM here
                    _dest_lat = round(float(cp.get("lat")), 6)
                    _dest_lng = round(float(cp.get("lng")), 6)
                    _mode = str(cp.get("mode") or "drive").lower()
                    _at = cp.get("arrival_time") or None
                    _cm = f"{_mode}@{_at}" if _at else _mode
                    _ck = (project.id, _dest_lat, _dest_lng, _cm, COMMUTE_PROVIDER_NAME)
                    commute_result = _request_commute_cache.get(_ck)
                    if commute_result is None:
                        continue  # no cached data — skip, don't block on OTP
                    travel_min = commute_result.minutes
                    limit = max_minutes + tolerance_minutes
                    if priority == "must_have" and travel_min > limit:
                        passes_commute = False
                        break

            passes_standards = True  # MVP – zatím bez tvrdého filtru

            passes_all = (
                passes_budget
                and passes_area
                and passes_layout
                and passes_location
                and passes_commute
                and passes_standards
            )

            if passes_all:
                matching += 1
                continue

            # Attribute units to the first blocking constraint where others pass.
            if not passes_budget and all(
                [passes_area, passes_layout, passes_location, passes_commute, passes_standards]
            ):
                blocked_by["budget"] += 1
            elif not passes_area and all(
                [passes_budget, passes_layout, passes_location, passes_commute, passes_standards]
            ):
                blocked_by["area"] += 1
            elif not passes_layout and all(
                [passes_budget, passes_area, passes_location, passes_commute, passes_standards]
            ):
                blocked_by["layout"] += 1
            elif not passes_location and all(
                [passes_budget, passes_area, passes_layout, passes_commute, passes_standards]
            ):
                blocked_by["location"] += 1
            elif not passes_commute and all(
                [passes_budget, passes_area, passes_layout, passes_location, passes_standards]
            ):
                blocked_by["commute"] += 1
            elif not passes_standards and all(
                [passes_budget, passes_area, passes_layout, passes_location, passes_commute]
            ):
                blocked_by["standards"] += 1

        return matching, blocked_by

    matching_units_count, blocked_by = eval_constraints(profile)

    # Build blockers list with percentages
    labels = {
        "budget": "Rozpočet",
        "area": "Plocha",
        "layout": "Dispozice",
        "location": "Lokalita (polygon)",
        "commute": "Dojíždění",
        "standards": "Standardy",
    }
    top_blockers: list[MarketFitBlocker] = []
    for key, count in blocked_by.items():
        if count <= 0:
            continue
        top_blockers.append(
            MarketFitBlocker(
                key=key,
                label=labels.get(key, key),
                blocked_count=count,
                blocked_percentage=float(count) / float(max(1, available_units_count)),
            )
        )
    top_blockers.sort(key=lambda b: b.blocked_percentage, reverse=True)

    # Relaxation suggestions (simple scenarios)
    suggestions: list[RelaxationSuggestion] = []

    def add_suggestion(label: str, prof_mutator: callable):
        new_profile = ClientProfile(
            client_id=profile.client_id,
            budget_min=profile.budget_min,
            budget_max=profile.budget_max,
            area_min=profile.area_min,
            area_max=profile.area_max,
            layouts=profile.layouts.copy() if profile.layouts else None,
            property_type=profile.property_type,
            purchase_purpose=profile.purchase_purpose,
            walkability_preferences_json=profile.walkability_preferences_json,
            filter_json=profile.filter_json,
            polygon_geojson=profile.polygon_geojson,
            commute_points_json=profile.commute_points_json,
        )
        prof_mutator(new_profile)
        new_matching, _ = eval_constraints(new_profile)
        suggestions.append(
            RelaxationSuggestion(
                label=label,
                matching_units_count=new_matching,
                delta_vs_current=new_matching - matching_units_count,
            )
        )

    # Budget relaxations
    if profile.budget_max:
        add_suggestion(
            "Navýšit budget o 5 %",
            lambda p: setattr(p, "budget_max", int(profile.budget_max * 1.05)),
        )
        add_suggestion(
            "Navýšit budget o 10 %",
            lambda p: setattr(p, "budget_max", int(profile.budget_max * 1.10)),
        )

    # Area relaxation
    if profile.area_min:
        add_suggestion(
            "Snížit min. plochu o 5 %",
            lambda p: setattr(p, "area_min", float(profile.area_min) * 0.95),
        )

    # Layout relaxation – allow 2kk if not already selected
    if profile.layouts and "values" in profile.layouts:
        current = [str(v) for v in (profile.layouts.get("values") or [])]
        if "2kk" not in current:
            def _add_2kk(p: ClientProfile) -> None:
                vals = list((p.layouts or {}).get("values") or [])
                vals.append("2kk")
                p.layouts = {"values": vals}

            add_suggestion("Zahrnout i dispozici 2kk", _add_2kk)

    # Commute relaxation – +10 minutes on all points
    if profile.commute_points_json:
        def _relax_commute(p: ClientProfile) -> None:
            points = p.commute_points_json or {}
            if isinstance(points, dict):
                arr = points.get("points") or []
                for cp in arr:
                    try:
                        cp["max_minutes"] = float(cp.get("max_minutes") or 0.0) + 10.0
                    except Exception:
                        continue
                p.commute_points_json = {"points": arr}

        add_suggestion("Uvolnit dojíždění o +10 min", _relax_commute)

    # Sort suggestions by delta, descending
    suggestions.sort(key=lambda s: s.delta_vs_current, reverse=True)

    return MarketFitAnalysisResponse(
        client_id=client.id,
        matching_units_count=matching_units_count,
        available_units_count=available_units_count,
        top_blockers=top_blockers,
        relaxation_suggestions=suggestions,
    )


@app.get("/clients/{client_id}/market-simulate")
def market_simulate(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
    budget_max: int | None = Query(default=None),
    area_min: float | None = Query(default=None),
    area_max: float | None = Query(default=None),
) -> dict[str, int]:
    """Quick simulation: how many units match with modified budget/area?"""
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if not profile:
        return {"matching_units": 0}

    _ms_cfg = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    _ms_thresholds = resolve_thresholds(_ms_cfg.thresholds_json if _ms_cfg else None)
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(_market_filter_from_config(_ms_thresholds))
    )
    rows = db.execute(q.order_by(Unit.id).limit(1000)).all()

    eff_budget_max = budget_max if budget_max is not None else profile.budget_max
    eff_area_min = area_min if area_min is not None else profile.area_min
    eff_area_max = area_max if area_max is not None else profile.area_max

    pref_layout_buckets: list[str] = []
    if profile.layouts and "values" in profile.layouts:
        pref_layout_buckets = [str(v).strip().lower() for v in (profile.layouts.get("values") or [])]

    poly = _parse_polygon_geojson(profile.polygon_geojson)
    count = 0
    for unit, project in rows:
        price = unit.price_czk
        area = float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None
        if price is not None and eff_budget_max is not None and price > eff_budget_max:
            continue
        if area is not None and eff_area_min is not None and area < eff_area_min:
            continue
        if area is not None and eff_area_max is not None and area > eff_area_max:
            continue
        if pref_layout_buckets and unit.layout:
            bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
            if bucket not in pref_layout_buckets:
                continue
        if poly and project.gps_latitude is not None and project.gps_longitude is not None:
            if not _point_in_polygon(float(project.gps_latitude), float(project.gps_longitude), poly):
                continue
        count += 1

    return {"matching_units": count}


@app.get(
    "/clients/{client_id}/area-market-analysis",
    response_model=AreaMarketAnalysisResponse,
)
def area_market_analysis(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> AreaMarketAnalysisResponse:
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()

    if not profile:
        return AreaMarketAnalysisResponse(
            client_id=client.id,
            projects_count=0,
            active_units_count=0,
            matching_units_count=0,
            avg_price_czk=None,
            avg_price_per_m2_czk=None,
            min_price_czk=None,
            max_price_czk=None,
            avg_floor_area_m2=None,
            layout_distribution={},
            budget_fit_units_count=0,
            area_fit_units_count=0,
        )

    polygons = _parse_polygon_or_multipolygon_geojson(profile.polygon_geojson)

    _poly_cfg = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    _poly_thresholds = resolve_thresholds(_poly_cfg.thresholds_json if _poly_cfg else None)
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(_market_filter_from_config(_poly_thresholds))
    )

    rows_raw: list[tuple[Unit, Project]] = db.execute(q.order_by(Unit.id.asc())).all()

    rows: list[tuple[Unit, Project]] = []
    if polygons:
        for unit, project in rows_raw:
            if project.gps_latitude is None or project.gps_longitude is None:
                continue
            if _point_in_any_polygon(
                float(project.gps_latitude),
                float(project.gps_longitude),
                polygons,
            ):
                rows.append((unit, project))
    else:
        rows = rows_raw

    if not rows:
        return AreaMarketAnalysisResponse(
            client_id=client.id,
            projects_count=0,
            active_units_count=0,
            matching_units_count=0,
            avg_price_czk=None,
            avg_price_per_m2_czk=None,
            min_price_czk=None,
            max_price_czk=None,
            avg_floor_area_m2=None,
            layout_distribution={},
            budget_fit_units_count=0,
            area_fit_units_count=0,
        )

    projects: set[int] = set()
    prices: list[int] = []
    prices_per_m2: list[float] = []
    areas: list[float] = []
    layout_distribution: dict[str, int] = {}
    budget_fit_units_count = 0
    area_fit_units_count = 0
    matching_units_count = 0

    pref_layout_buckets: list[str] = []
    if profile.layouts and "values" in profile.layouts:
        pref_layout_buckets = [
            str(v).strip().lower() for v in (profile.layouts.get("values") or [])
        ]

    for unit, project in rows:
        projects.add(project.id)

        if unit.price_czk is not None:
            prices.append(int(unit.price_czk))
        if unit.price_per_m2_czk is not None:
            prices_per_m2.append(float(unit.price_per_m2_czk))
        if unit.floor_area_m2 is not None:
            areas.append(float(unit.floor_area_m2))

        layout_label = None
        if unit.layout is not None:
            layout_label = _layout_group(str(unit.layout)) or str(unit.layout).strip()
            layout_distribution[layout_label] = layout_distribution.get(layout_label, 0) + 1

        price = float(unit.price_czk) if unit.price_czk is not None else None
        area_val = float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None

        budget_ok = True
        if profile.budget_min is not None and (price is None or price < profile.budget_min):
            budget_ok = False
        if profile.budget_max is not None and (price is None or price > profile.budget_max):
            budget_ok = False

        area_ok = True
        if (profile.area_min is not None or profile.area_max is not None) and area_val is None:
            area_ok = False
        else:
            if profile.area_min is not None and area_val is not None and area_val < profile.area_min:
                area_ok = False
            if profile.area_max is not None and area_val is not None and area_val > profile.area_max:
                area_ok = False

        layout_ok = True
        if pref_layout_buckets:
            if unit.layout is None:
                layout_ok = False
            else:
                bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
                if bucket not in pref_layout_buckets:
                    layout_ok = False

        if budget_ok:
            budget_fit_units_count += 1
        if area_ok:
            area_fit_units_count += 1
        if budget_ok and area_ok and layout_ok:
            matching_units_count += 1

    active_units_count = len(rows)

    avg_price_czk = float(sum(prices) / len(prices)) if prices else None
    avg_price_per_m2_czk = (
        float(sum(prices_per_m2) / len(prices_per_m2)) if prices_per_m2 else None
    )
    min_price_czk = int(min(prices)) if prices else None
    max_price_czk = int(max(prices)) if prices else None
    avg_floor_area_m2 = float(sum(areas) / len(areas)) if areas else None

    return AreaMarketAnalysisResponse(
        client_id=client.id,
        projects_count=len(projects),
        active_units_count=active_units_count,
        matching_units_count=matching_units_count,
        avg_price_czk=avg_price_czk,
        avg_price_per_m2_czk=avg_price_per_m2_czk,
        min_price_czk=min_price_czk,
        max_price_czk=max_price_czk,
        avg_floor_area_m2=avg_floor_area_m2,
        layout_distribution=layout_distribution,
        budget_fit_units_count=budget_fit_units_count,
        area_fit_units_count=area_fit_units_count,
    )


@app.get("/clients/{client_id}/recommendations", response_model=list[ClientRecommendationItem])
def list_client_recommendations(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[ClientRecommendationItem]:
    client = _get_client_for_broker(db, client_id, broker)
    recs = (
        db.execute(
            select(ClientRecommendation, Unit, Project)
            .join(Unit, ClientRecommendation.unit_id == Unit.id)
            .join(Project, ClientRecommendation.project_id == Project.id)
            .outerjoin(ClientRecommendationFeedback)
            .options(selectinload(ClientRecommendation.feedback))
            .where(
                ClientRecommendation.client_id == client.id,
                ClientRecommendation.hidden_by_broker.is_(False),
            )
            .order_by(ClientRecommendation.score.desc())
        )
        .all()
    )
    items: list[ClientRecommendationItem] = []
    for rec, unit, project in recs:
        reason = rec.reason_json or {}
        raw_layout = str(unit.layout) if unit.layout is not None else None
        layout_label = _layout_group(raw_layout) or (raw_layout if raw_layout is not None else None)
        items.append(
            ClientRecommendationItem(
                rec_id=rec.id,
                pinned_by_broker=rec.pinned_by_broker,
                unit_external_id=unit.external_id,
                project_id=project.id,
                project_name=project.name,
                layout=unit.layout,
                floor_area_m2=float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None,
                exterior_area_m2=float(unit.exterior_area_m2) if unit.exterior_area_m2 is not None else None,
                price_czk=unit.price_czk,
                price_per_m2_czk=unit.price_per_m2_czk,
                floor=unit.floor,
                layout_label=layout_label,
                district=project.district,
                project_lat=float(project.gps_latitude) if project.gps_latitude is not None else None,
                project_lng=float(project.gps_longitude) if project.gps_longitude is not None else None,
                score=rec.score,
                budget_fit=float(reason.get("budget_fit", 0.0)),
                walkability_fit=float(reason.get("walkability_fit", 0.0)),
                location_fit=float(reason.get("location_fit", 0.0)),
                layout_fit=float(reason.get("layout_fit", 0.0)),
                area_fit=float(reason.get("area_fit", 0.0)),
                outdoor_fit=float(reason.get("outdoor_fit", 50.0)),
                commute_fit=float(reason.get("commute_fit", 0.0)),
                eligibility=str(reason.get("eligibility", "pass")),
                eligibility_reasons=reason.get("eligibility_reasons") or [],
                confidence=float(reason.get("confidence", 100.0)),
                confidence_label=str(reason.get("confidence_label", "high")),
                confidence_reasons=reason.get("confidence_reasons") or [],
                top_strengths=reason.get("top_strengths") or [],
                top_compromises=reason.get("top_compromises") or [],
                distance_to_tram_stop_m=project.distance_to_tram_stop_m,
                distance_to_metro_station_m=project.distance_to_metro_station_m,
                distance_to_bus_stop_m=project.distance_to_bus_stop_m,
                distance_to_train_station_m=project.distance_to_train_station_m,
                reason=reason,
                broker_note=rec.broker_note,
                shortlist_role=rec.shortlist_role,
                shortlist_reason=rec.shortlist_reason,
                shortlist_risks=rec.shortlist_risks,
                shortlist_order=rec.shortlist_order,
                feedback=RecommendationFeedbackOut(
                    feedback_type=rec.feedback.feedback_type,
                    dislike_reason=rec.feedback.dislike_reason,
                    note=rec.feedback.note,
                    updated_at=rec.feedback.updated_at,
                ) if rec.feedback else None,
                construction_completion=project.construction_completion,
                noise_label=project.noise_label,
                noise_day_db=float(project.noise_day_db) if project.noise_day_db is not None else None,
                noise_night_db=float(project.noise_night_db) if project.noise_night_db is not None else None,
                distance_to_tram_tracks_m=float(project.distance_to_tram_tracks_m) if project.distance_to_tram_tracks_m is not None else None,
                distance_to_primary_road_m=float(project.distance_to_primary_road_m) if project.distance_to_primary_road_m is not None else None,
                distance_to_railway_m=float(project.distance_to_railway_m) if project.distance_to_railway_m is not None else None,
                price_diff_pct=float(unit.local_price_diff_2000m) if unit.local_price_diff_2000m is not None else None,
                poi_counts={
                    k: int(v)
                    for k in ("supermarket", "park", "cafe", "restaurant", "fitness", "playground", "kindergarten", "primary_school")
                    if (v := getattr(project, f"count_{k}_500m", None)) is not None
                },
                poi_distances={
                    k: round(float(v))
                    for k in ("supermarket", "drugstore", "pharmacy", "atm", "post_office",
                              "tram_stop", "bus_stop", "metro_station", "train_station",
                              "restaurant", "cafe", "park", "fitness", "playground",
                              "kindergarten", "primary_school", "pediatrician")
                    if (v := getattr(project, f"distance_to_{k}_m", None)) is not None
                },
            )
        )
    return items


class HiddenRecItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    rec_id: int
    unit_id: int
    unit_external_id: str | None
    project_id: int
    project_name: str
    layout: str | None
    floor_area_m2: float | None
    price_czk: int | None
    score: float
    floor: int | None


@app.get("/clients/{client_id}/recommendations/hidden", response_model=list[HiddenRecItem])
def list_hidden_recommendations(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[HiddenRecItem]:
    client = _get_client_for_broker(db, client_id, broker)
    recs = db.execute(
        select(ClientRecommendation, Unit, Project)
        .join(Unit, ClientRecommendation.unit_id == Unit.id)
        .join(Project, ClientRecommendation.project_id == Project.id)
        .where(
            ClientRecommendation.client_id == client.id,
            ClientRecommendation.hidden_by_broker.is_(True),
        )
        .order_by(ClientRecommendation.score.desc())
    ).all()
    return [
        HiddenRecItem(
            rec_id=rec.id,
            unit_id=unit.id,
            unit_external_id=unit.external_id,
            project_id=project.id,
            project_name=project.name,
            layout=unit.layout,
            floor_area_m2=float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None,
            price_czk=unit.price_czk,
            score=rec.score,
            floor=unit.floor,
        )
        for rec, unit, project in recs
    ]


class ManualAddRequest(BaseModel):
    unit_external_id: str


@app.post("/clients/{client_id}/recommendations/manual-add", response_model=ClientRecommendationItem)
def manual_add_recommendation(
    client_id: int,
    body: ManualAddRequest,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ClientRecommendationItem:
    client = _get_client_for_broker(db, client_id, broker)
    unit = db.execute(select(Unit).where(Unit.external_id == body.unit_external_id)).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    project = db.get(Project, unit.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Check if already exists (including hidden ones)
    existing = db.execute(
        select(ClientRecommendation).where(
            ClientRecommendation.client_id == client.id,
            ClientRecommendation.unit_id == unit.id,
        )
    ).scalar_one_or_none()
    if existing:
        if existing.hidden_by_broker:
            existing.hidden_by_broker = False
            db.add(existing)
            db.commit()
            db.refresh(existing)
        rec = existing
    else:
        rec = ClientRecommendation(
            client_id=client.id,
            unit_id=unit.id,
            project_id=project.id,
            score=0.0,
            pinned_by_broker=False,
            hidden_by_broker=False,
            reason_json={},
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
    raw_layout = str(unit.layout) if unit.layout is not None else None
    layout_label = _layout_group(raw_layout) or (raw_layout if raw_layout is not None else None)
    return ClientRecommendationItem(
        rec_id=rec.id,
        pinned_by_broker=rec.pinned_by_broker,
        unit_external_id=unit.external_id,
        project_id=project.id,
        project_name=project.name,
        layout=unit.layout,
        floor_area_m2=float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None,
        exterior_area_m2=float(unit.exterior_area_m2) if unit.exterior_area_m2 is not None else None,
        price_czk=unit.price_czk,
        price_per_m2_czk=unit.price_per_m2_czk,
        floor=unit.floor,
        layout_label=layout_label,
        district=project.district,
        score=0.0,
        budget_fit=0.0,
        walkability_fit=0.0,
        location_fit=0.0,
        layout_fit=0.0,
        area_fit=0.0,
        outdoor_fit=50.0,
        distance_to_tram_stop_m=project.distance_to_tram_stop_m,
        distance_to_metro_station_m=project.distance_to_metro_station_m,
        distance_to_bus_stop_m=project.distance_to_bus_stop_m,
        distance_to_train_station_m=project.distance_to_train_station_m,
    )


@app.patch("/clients/{client_id}/recommendations/{rec_id}/pin", status_code=204)
def pin_recommendation(
    client_id: int,
    rec_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.pinned_by_broker = True
    db.add(rec)
    db.commit()


@app.delete("/clients/{client_id}/recommendations/{rec_id}/pin", status_code=204)
def unpin_recommendation(
    client_id: int,
    rec_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.pinned_by_broker = False
    db.add(rec)
    db.commit()


@app.patch("/clients/{client_id}/recommendations/{rec_id}/hide", status_code=204)
def hide_recommendation(
    client_id: int,
    rec_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.hidden_by_broker = True
    db.add(rec)
    db.commit()


@app.delete("/clients/{client_id}/recommendations/{rec_id}/hide", status_code=204)
def unhide_recommendation(
    client_id: int,
    rec_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.hidden_by_broker = False
    db.add(rec)
    db.commit()


class RecNoteBody(BaseModel):
    broker_note: str | None = None


@app.patch("/clients/{client_id}/recommendations/{rec_id}/note", status_code=200)
def update_recommendation_note(
    client_id: int,
    rec_id: int,
    body: RecNoteBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, str | None]:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    rec.broker_note = body.broker_note
    db.add(rec)
    db.commit()
    return {"broker_note": rec.broker_note}


ALLOWED_SHORTLIST_ROLES = {"top_pick", "alternative", "fallback", "wild_card"}


class ShortlistMetaBody(BaseModel):
    shortlist_role: str | None = None
    shortlist_reason: str | None = None
    shortlist_risks: str | None = None
    shortlist_order: int | None = None


@app.patch("/clients/{client_id}/recommendations/{rec_id}/shortlist", status_code=200)
def update_shortlist_meta(
    client_id: int,
    rec_id: int,
    body: ShortlistMetaBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Persist shortlist curation metadata: role, reason text, and display order.

    Only updates fields that are explicitly present in the request body.
    Passing null clears the field.
    """
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if body.shortlist_role is not None and body.shortlist_role not in ALLOWED_SHORTLIST_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid shortlist_role: {body.shortlist_role}")
    # Patch only supplied fields; explicit None clears the field.
    if "shortlist_role" in body.model_fields_set or body.shortlist_role is not None:
        rec.shortlist_role = body.shortlist_role
    if "shortlist_reason" in body.model_fields_set or body.shortlist_reason is not None:
        rec.shortlist_reason = body.shortlist_reason
    if "shortlist_risks" in body.model_fields_set or body.shortlist_risks is not None:
        rec.shortlist_risks = body.shortlist_risks
    if "shortlist_order" in body.model_fields_set or body.shortlist_order is not None:
        rec.shortlist_order = body.shortlist_order
    db.add(rec)
    db.commit()
    return {
        "shortlist_role": rec.shortlist_role,
        "shortlist_reason": rec.shortlist_reason,
        "shortlist_risks": rec.shortlist_risks,
        "shortlist_order": rec.shortlist_order,
    }


@app.delete("/clients/{client_id}/recommendations/{rec_id}", status_code=204)
def delete_recommendation(
    client_id: int,
    rec_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    db.delete(rec)
    db.commit()


@app.put(
    "/clients/{client_id}/recommendations/{rec_id}/feedback",
    response_model=RecommendationFeedbackOut,
)
def upsert_recommendation_feedback(
    client_id: int,
    rec_id: int,
    body: RecommendationFeedbackIn,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> RecommendationFeedbackOut:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if body.feedback_type not in ALLOWED_FEEDBACK_TYPES:
        raise HTTPException(status_code=422, detail=f"feedback_type must be one of {sorted(ALLOWED_FEEDBACK_TYPES)}")
    if body.feedback_type == "disliked" and body.dislike_reason and body.dislike_reason not in ALLOWED_DISLIKE_REASONS:
        raise HTTPException(status_code=422, detail=f"dislike_reason must be one of {sorted(ALLOWED_DISLIKE_REASONS)}")
    if body.feedback_type != "disliked":
        body.dislike_reason = None
    fb = db.execute(
        select(ClientRecommendationFeedback).where(
            ClientRecommendationFeedback.recommendation_id == rec_id
        )
    ).scalar_one_or_none()
    if fb:
        fb.feedback_type = body.feedback_type
        fb.dislike_reason = body.dislike_reason
        fb.note = body.note
    else:
        fb = ClientRecommendationFeedback(
            recommendation_id=rec_id,
            feedback_type=body.feedback_type,
            dislike_reason=body.dislike_reason,
            note=body.note,
        )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    return RecommendationFeedbackOut(
        feedback_type=fb.feedback_type,
        dislike_reason=fb.dislike_reason,
        note=fb.note,
        updated_at=fb.updated_at,
    )


@app.delete("/clients/{client_id}/recommendations/{rec_id}/feedback", status_code=204)
def delete_recommendation_feedback(
    client_id: int,
    rec_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    _get_client_for_broker(db, client_id, broker)
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client_id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    fb = db.execute(
        select(ClientRecommendationFeedback).where(
            ClientRecommendationFeedback.recommendation_id == rec_id
        )
    ).scalar_one_or_none()
    if fb:
        db.delete(fb)
        db.commit()


@app.get("/brokers/match-feed", response_model=dict[int, list[BrokerMatchItem]])
def broker_match_feed(
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[int, list[BrokerMatchItem]]:
    """
    Return latest unseen matches grouped by client_id for the current broker.
    Response shape: { client_id: [BrokerMatchItem, ...], ... } for easier consumption.
    """
    try:
        subq = (
            select(UnitEvent)
            .where(UnitEvent.unit_id == ClientUnitMatch.unit_id)
            .order_by(UnitEvent.created_at.desc(), UnitEvent.id.desc())
            .limit(1)
            .subquery()
        )
        rows = (
            db.execute(
                select(ClientUnitMatch, Client, Unit, Project, subq.c.old_value, subq.c.new_value)
                .join(Client, ClientUnitMatch.client_id == Client.id)
                .join(Unit, ClientUnitMatch.unit_id == Unit.id)
                .join(Project, Unit.project_id == Project.id)
                .outerjoin(subq, subq.c.unit_id == Unit.id)
                .where(
                    Client.broker_id == broker.id,
                    ClientUnitMatch.seen.is_(False),
                )
                .order_by(ClientUnitMatch.created_at.desc())
            )
            .all()
        )
    except Exception:
        # When match tables are not yet migrated/seeded, return empty feed instead of 500.
        return {}
    grouped: dict[int, list[BrokerMatchItem]] = {}
    for match, client, unit, project, old_value, new_value in rows:
        raw_layout = str(unit.layout) if unit.layout is not None else None
        layout_label = _layout_group(raw_layout) or (raw_layout if raw_layout is not None else None)
        price_old_int: int | None = None
        price_new_int: int | None = None
        try:
            if old_value is not None:
                price_old_int = int(old_value)
        except (TypeError, ValueError):
            price_old_int = None
        try:
            if new_value is not None:
                price_new_int = int(new_value)
        except (TypeError, ValueError):
            price_new_int = None
        item = BrokerMatchItem(
            id=match.id,
            client_id=client.id,
            client_name=client.name,
            unit_external_id=unit.external_id,
            project_name=project.name,
            layout_label=layout_label,
            price_czk=unit.price_czk,
            score=match.score,
            event_type=match.event_type,
            price_old=price_old_int,
            price_new=price_new_int,
        )
        grouped.setdefault(client.id, []).append(item)
    return grouped


@app.post("/brokers/match-feed/{match_id}/seen", status_code=204)
def mark_match_seen(
    match_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    match = db.get(ClientUnitMatch, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    # Ensure the match belongs to a client of this broker
    client = db.get(Client, match.client_id)
    if not client or client.broker_id != broker.id:
        raise HTTPException(status_code=404, detail="Match not found")
    match.seen = True
    db.add(match)
    db.commit()


# ── Broker Notifications ────────────────────────────────────────────────────


class BrokerNotification(BaseModel):
    id: int
    type: str  # 'price_change' | 'availability_change' | 'new_project'
    unit_external_id: str | None = None
    project_id: int | None = None
    project_name: str | None = None
    old_value: str | None = None
    new_value: str | None = None
    affected_clients: list[str] = []  # client names
    created_at: datetime


@app.get("/brokers/notifications", response_model=list[BrokerNotification])
def broker_notifications(
    db: DbSession,
    days: int = Query(default=7, ge=1, le=30),
    broker: Broker = Depends(get_current_broker),
) -> list[BrokerNotification]:
    """Recent events relevant to the broker's clients' recommended units."""
    since = datetime.utcnow() - timedelta(days=days)

    # Get all client IDs for this broker
    client_rows = db.execute(
        select(Client.id, Client.name).where(Client.broker_id == broker.id)
    ).all()
    if not client_rows:
        return []
    client_map = {r[0]: r[1] for r in client_rows}
    client_ids = list(client_map.keys())

    # Get recommended unit IDs per client
    rec_rows = db.execute(
        select(ClientRecommendation.client_id, ClientRecommendation.unit_id)
        .where(ClientRecommendation.client_id.in_(client_ids))
    ).all()
    # unit_id -> list of client names
    unit_to_clients: dict[int, list[str]] = {}
    for cid, uid in rec_rows:
        unit_to_clients.setdefault(uid, []).append(client_map[cid])

    notifications: list[BrokerNotification] = []

    if unit_to_clients:
        # Get recent events for recommended units
        events = db.execute(
            select(UnitEvent)
            .where(
                UnitEvent.unit_id.in_(list(unit_to_clients.keys())),
                UnitEvent.created_at >= since,
                UnitEvent.event_type.in_(["price_change", "availability_change"]),
            )
            .order_by(UnitEvent.created_at.desc())
            .limit(100)
        ).scalars().all()

        # Batch-fetch units for names
        event_unit_ids = list({e.unit_id for e in events})
        units_map: dict[int, Unit] = {}
        if event_unit_ids:
            units_map = {
                u.id: u
                for u in db.execute(
                    select(Unit).where(Unit.id.in_(event_unit_ids))
                ).scalars().all()
            }

        for ev in events:
            unit = units_map.get(ev.unit_id)
            notifications.append(BrokerNotification(
                id=ev.id,
                type=ev.event_type,
                unit_external_id=unit.external_id if unit else None,
                project_id=unit.project_id if unit else None,
                project_name=None,  # filled below
                old_value=ev.old_value,
                new_value=ev.new_value,
                affected_clients=unit_to_clients.get(ev.unit_id, []),
                created_at=ev.created_at,
            ))

    # New projects (added recently). Compute the actual project_first_seen
    # (= min of its units' first_seen) so the notification's timestamp reflects
    # when the project actually appeared in the DB instead of "now".
    new_project_rows = db.execute(
        select(
            Project.id,
            Project.name,
            func.min(Unit.first_seen).label("project_first_seen"),
        )
        .join(Unit, Unit.project_id == Project.id)
        .where(Unit.first_seen >= since.date())
        .group_by(Project.id, Project.name)
        .having(func.min(Unit.first_seen) >= since.date())
        .order_by(func.min(Unit.first_seen).desc())
        .limit(20)
    ).all()

    for proj_id, proj_name, proj_first_seen in new_project_rows:
        ts = (
            datetime.combine(proj_first_seen, datetime.min.time(), tzinfo=timezone.utc)
            if proj_first_seen is not None
            else datetime.now(timezone.utc)
        )
        notifications.append(BrokerNotification(
            id=-proj_id,  # negative to distinguish
            type="new_project",
            project_id=proj_id,
            project_name=proj_name,
            new_value=proj_name,
            affected_clients=[],
            created_at=ts,
        ))

    # Fill project names
    proj_ids = [n.project_id for n in notifications if n.project_id and not n.project_name]
    if proj_ids:
        proj_map = {
            p.id: p.name
            for p in db.execute(
                select(Project).where(Project.id.in_(set(proj_ids)))
            ).scalars().all()
        }
        for n in notifications:
            if n.project_id and not n.project_name:
                n.project_name = proj_map.get(n.project_id)

    notifications.sort(key=lambda x: x.created_at, reverse=True)
    return notifications


@app.get("/analytics/clients-without-units", response_model=list[ClientWithoutInventoryItem])
def analytics_clients_without_units(
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[ClientWithoutInventoryItem]:
    """
    Find clients whose profiles have very few matching units in current inventory.
    Uses the same base filters as client recommendations: budget, area, layout, polygon.
    """
    # Load clients + profiles for this broker
    clients = (
        db.execute(
            select(Client, ClientProfile)
            .join(ClientProfile, ClientProfile.client_id == Client.id)
            .where(Client.broker_id == broker.id)
        )
        .all()
    )
    if not clients:
        return []

    _bulk_cfg = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    _bulk_thresholds = resolve_thresholds(_bulk_cfg.thresholds_json if _bulk_cfg else None)
    _bulk_market_filter = _market_filter_from_config(_bulk_thresholds)

    results: list[ClientWithoutInventoryItem] = []

    for client, profile in clients:
        # Base query: on-market units (respects stale/not_seen thresholds from config)
        q = (
            select(Unit, Project)
            .join(Project, Unit.project_id == Project.id)
            .where(_bulk_market_filter)
        )

        # Budget + area filters (with wizard tolerance)
        wiz_budget = ((profile.filter_json or {}).get("wizard", {}).get("budget", {}))
        price_tol_pct = wiz_budget.get("max_price_tolerance_pct", 0) or 0
        area_tol_pct = wiz_budget.get("max_area_tolerance_pct", 0) or 0
        if profile.budget_min is not None:
            q = q.where(Unit.price_czk >= profile.budget_min)
        if profile.budget_max is not None:
            effective_budget_max = int(profile.budget_max * (1 + price_tol_pct / 100))
            q = q.where(Unit.price_czk <= effective_budget_max)
        if profile.area_min is not None:
            effective_area_min = profile.area_min * (1 - area_tol_pct / 100)
            q = q.where(Unit.floor_area_m2 >= effective_area_min)
        if profile.area_max is not None:
            q = q.where(Unit.floor_area_m2 <= profile.area_max)

        # Polygon / location filter – reuse simple inside-polygon logic from matching
        poly = _parse_polygon_geojson(profile.polygon_geojson)
        rows: list[tuple[Unit, Project]] = []
        if poly:
            # We need project GPS to apply polygon; fetch candidates in a reasonable cap.
            base_rows = db.execute(q.limit(1000)).all()
            for unit, project in base_rows:
                if project.gps_latitude is None or project.gps_longitude is None:
                    continue
                inside = _point_in_polygon(
                    float(project.gps_latitude),
                    float(project.gps_longitude),
                    poly,
                )
                if inside:
                    rows.append((unit, project))
        else:
            rows = db.execute(q.limit(1000)).all()

        # Layout hard filter identical to recommendations
        pref_layout_buckets: list[str] = []
        if profile.layouts and "values" in profile.layouts:
            pref_layout_buckets = [
                str(v).strip().lower() for v in (profile.layouts.get("values") or [])
            ]

        matching_units = 0
        for unit, _project in rows:
            if pref_layout_buckets:
                if unit.layout is None:
                    continue
                unit_bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
                if unit_bucket not in pref_layout_buckets:
                    continue
            matching_units += 1

        available_units = matching_units  # currently we only consider available units

        if matching_units <= 2:
            layouts_values: list[str] = []
            if profile.layouts and "values" in profile.layouts:
                layouts_values = [str(v) for v in (profile.layouts.get("values") or [])]
            results.append(
                ClientWithoutInventoryItem(
                    client_id=client.id,
                    client_name=client.name,
                    budget_max=profile.budget_max,
                    layouts=layouts_values,
                    area_min=profile.area_min,
                    area_max=profile.area_max,
                    matching_units=matching_units,
                    available_units=available_units,
                )
            )

    # Order by ascending number of matches (fewest inventory first)
    results.sort(key=lambda r: (r.matching_units, r.client_name.lower()))
    return results


def _effective_unit_response(db: Session, unit: Unit) -> UnitResponse:
    """Load overrides for unit and return UnitResponse with overrides applied.
    Injects project aggregates (total_units, available_units, etc.) into data when available.
    Aplikuje i project overrides – úpravy na stránce projektu se promítnou do jednotky.
    """
    override_rows = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id == unit.id,
                UnitOverride.field.in_(OVERRIDEABLE_FIELDS),
            )
        )
        .scalars().all()
    )
    override_map = build_override_map(override_rows)
    d = unit_to_response_dict(unit, override_map)
    # Doplnit projektové agregáty do data (stejně jako v list_units), aby v detailu jednotky
    # byly vidět total_units, available_units, project_first_seen, max_days_on_market atd.
    from .models import ProjectAggregates  # local import to avoid circular

    agg_row = (
        db.execute(
            select(ProjectAggregates).where(ProjectAggregates.project_id == unit.project_id)
        )
        .scalars()
        .first()
    )
    if agg_row is not None:
        data = dict(d.get("data") or {})

        def _dec_agg(val: Any) -> Any:
            if val is None:
                return None
            if hasattr(val, "__float__"):
                try:
                    return float(val)
                except (TypeError, ValueError):
                    return val
            return val

        data["total_units"] = agg_row.total_units
        data["available_units"] = agg_row.available_units
        data["availability_ratio"] = _dec_agg(agg_row.availability_ratio)
        data["avg_price_czk"] = _dec_agg(agg_row.avg_price_czk)
        data["min_price_czk"] = agg_row.min_price_czk
        data["max_price_czk"] = agg_row.max_price_czk
        data["avg_price_per_m2_czk"] = _dec_agg(agg_row.avg_price_per_m2_czk)
        data["avg_floor_area_m2"] = _dec_agg(agg_row.avg_floor_area_m2)
        data["project_first_seen"] = agg_row.project_first_seen
        data["project_last_seen"] = agg_row.project_last_seen
        data["max_days_on_market"] = agg_row.max_days_on_market
        # Agregované datum prodeje projektu – max(sold_date) přes všechny jednotky v projektu
        sold_date_agg = db.execute(
            select(func.max(Unit.sold_date)).where(Unit.project_id == unit.project_id)
        ).scalar_one_or_none()
        data["sold_date"] = sold_date_agg
        d["data"] = data

    # Aplikovat project overrides – úpravy na stránce projektu se promítnou do jednotky
    proj_override_rows = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == unit.project_id,
                ProjectOverride.field.in_(PROJECT_OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    project_override_map = build_project_override_map(proj_override_rows)
    apply_project_overrides_to_item(unit.project_id, d["data"], project_override_map, attr_keyed=False)
    apply_project_overrides_to_item(unit.project_id, d["project"], project_override_map, attr_keyed=True)

    pending_rows = (
        db.execute(
            select(UnitApiPending).where(UnitApiPending.unit_id == unit.id)
        )
        .scalars().all()
    )
    d["pending_api_updates"] = [
        PendingApiUpdate(field=p.field, api_value=p.value) for p in pending_rows
    ]

    return UnitResponse.model_validate(d)


@app.get("/health")
def health() -> JSONResponse:
    try:
        check_db_connection()
    except SQLAlchemyError as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "detail": "database unavailable", "error": str(exc)},
        )

    return JSONResponse(content={"status": "ok"})


_local_price_diffs_state: dict[str, Any] = {"status": "idle"}


def _run_local_price_diffs_job() -> None:
    from .aggregates import recompute_local_price_diffs
    from .db import SessionLocal as _SessionLocal

    started = datetime.now(timezone.utc)
    _local_price_diffs_state.update(status="running", started_at=started.isoformat(), finished_at=None, error=None)
    db = _SessionLocal()
    try:
        recompute_local_price_diffs(db)
        db.commit()
        _local_price_diffs_state.update(
            status="done",
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:  # noqa: BLE001
        _local_price_diffs_state.update(
            status="error",
            finished_at=datetime.now(timezone.utc).isoformat(),
            error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        db.close()


@app.post(
    "/units/local-price-diffs/recompute",
    summary="Recompute local price differences for all units (background)",
    description=(
        "Fire-and-forget recompute. Spawns a background thread, returns 202 "
        "immediately. Synchronous version would exceed Railway's ~60s edge "
        "proxy timeout (this job typically runs ~130s) so the browser would "
        "see 'Load failed' even though the work succeeds server-side. Poll "
        "GET /units/local-price-diffs/recompute/status for state."
    ),
    status_code=202,
)
def recompute_units_local_price_diffs() -> dict[str, Any]:
    import threading

    if _local_price_diffs_state.get("status") == "running":
        raise HTTPException(status_code=409, detail="Recompute already running")
    t = threading.Thread(
        target=_run_local_price_diffs_job, daemon=True, name="local-price-diffs"
    )
    t.start()
    return {"ok": True, "status": "started"}


@app.get(
    "/units/local-price-diffs/recompute/status",
    summary="Poll status of last local price diffs recompute",
)
def get_local_price_diffs_status() -> dict[str, Any]:
    return dict(_local_price_diffs_state)


@app.get(
    "/units/{external_id}/local-price-diff-debug",
    response_model=LocalPriceDiffDebugResponse,
    summary="Debug: show comparables used for local price diff",
)
def get_unit_local_price_diff_debug(
    db: DbSession,
    external_id: str,
    radius_m: Annotated[
        float,
        Query(
            description="Radius in metres (500, 1000, 2000)",
        ),
    ] = 500.0,
) -> LocalPriceDiffDebugResponse:
    if radius_m not in (500.0, 1000.0, 2000.0):
        raise HTTPException(status_code=422, detail="radius_m must be one of 500, 1000, 2000")

    # Load all units with GPS + price_per_m2 + floor_area, including project, and apply overrides
    units = (
        db.execute(
            select(Unit)
            .options(selectinload(Unit.project))
            .where(
                Unit.gps_latitude.isnot(None),
                Unit.gps_longitude.isnot(None),
                Unit.price_per_m2_czk.isnot(None),
                Unit.floor_area_m2.isnot(None),
            )
        )
        .scalars()
        .all()
    )
    if not units:
        raise HTTPException(status_code=404, detail="No units with GPS/price data found")

    unit_ids = [u.id for u in units]
    override_rows = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id.in_(unit_ids),
                UnitOverride.field.in_(OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map = build_override_map(override_rows)

    infos: list[dict[str, Any]] = []
    target: dict[str, Any] | None = None

    for u in units:
        lat = u.gps_latitude
        lon = u.gps_longitude
        if lat is None or lon is None:
            continue
        data = unit_to_response_dict(u, override_map)
        price_pm2 = data.get("price_per_m2_czk")
        area = data.get("floor_area_m2")
        layout = data.get("layout")
        if price_pm2 is None or area is None or layout is None:
            continue
        try:
            price_pm2_f = float(price_pm2)
            area_f = float(area)
        except (TypeError, ValueError):
            continue
        group = _layout_group(str(layout))
        if group is None:
            continue

        renovation_val = data.get("renovation") if isinstance(data, dict) else getattr(u, "renovation", None)
        if renovation_val is not None and not isinstance(renovation_val, bool):
            try:
                renovation_val = bool(renovation_val)
            except (TypeError, ValueError):
                renovation_val = None

        status_raw = data.get("availability_status") or getattr(u, "availability_status", None) or ""
        status = str(status_raw).strip().lower()
        on_market = bool(data.get("available", False)) or status in {"available", "reserved"}
        last_seen_val = getattr(u, "last_seen", None)

        total_price = data.get("price_czk", None)
        if total_price is None:
            total_price = u.price_czk
        try:
            total_price_f = float(total_price) if total_price is not None else None
        except (TypeError, ValueError):
            total_price_f = None

        exterior_area = data.get("exterior_area_m2", None)
        if exterior_area is None:
            exterior_area = getattr(u, "exterior_area_m2", None)
        try:
            exterior_area_f = float(exterior_area) if exterior_area is not None else None
        except (TypeError, ValueError):
            exterior_area_f = None

        layout_val = data.get("layout") or getattr(u, "layout", None)
        floor_val = data.get("floor") if isinstance(data.get("floor"), int) else getattr(u, "floor", None)
        if floor_val is not None and not isinstance(floor_val, int):
            try:
                floor_val = int(floor_val)
            except (TypeError, ValueError):
                floor_val = None

        info: dict[str, Any] = {
            "unit": u,
            "id": u.id,
            "project_id": u.project_id,
            "external_id": u.external_id,
            "lat": float(lat),
            "lon": float(lon),
            "price_pm2": price_pm2_f,
            "area": area_f,
            "group": group,
            "renovation": renovation_val,
            "on_market": on_market,
            "last_seen": last_seen_val,
            "sold_date": getattr(u, "sold_date", None),
            "total_price_czk": total_price_f,
            "exterior_area_m2": exterior_area_f,
            "layout": str(layout_val) if layout_val is not None else None,
            "floor": floor_val,
            "availability_status": data.get("availability_status"),
            "available": bool(data.get("available", False)),
            "project_name": (data.get("project") or {}).get("name") if isinstance(data.get("project"), dict) else getattr(u.project, "name", None),
        }
        infos.append(info)
        if u.external_id == external_id:
            target = info

    if target is None:
        raise HTTPException(status_code=404, detail="Unit not found or missing data for local diff")

    def in_area_bucket(group: str, area: float, target_group: str) -> bool:
        if group != target_group:
            return False
        if target_group == "1kk":
            return 20.0 <= area <= 35.0
        if target_group == "2kk":
            return 40.0 <= area <= 60.0
        if target_group == "3kk":
            return 60.0 <= area <= 80.0
        if target_group == "4kk":
            return 80.0 <= area <= 120.0
        return False

    def avg(values: list[float]) -> float | None:
        if not values:
            return None
        return float(sum(values) / len(values))

    lat1 = target["lat"]
    lon1 = target["lon"]
    group = target["group"]
    price_pm2 = target["price_pm2"]

    bucket_1_prices: list[float] = []
    bucket_2_prices: list[float] = []
    bucket_3_prices: list[float] = []
    bucket_4_prices: list[float] = []

    bucket_1_infos: list[tuple[dict[str, Any], float]] = []
    bucket_2_infos: list[tuple[dict[str, Any], float]] = []
    bucket_3_infos: list[tuple[dict[str, Any], float]] = []
    bucket_4_infos: list[tuple[dict[str, Any], float]] = []

    for other in infos:
        if other["id"] == target["id"]:
            continue
        # Ignorujeme jednotky ze stejného projektu – chceme srovnání s trhem v okolí,
        # ne s ostatními byty v témže projektu.
        if other.get("project_id") == target.get("project_id"):
            continue
        # A stejně tak nechceme porovnávat mezi řádky, které mají stejné jméno projektu
        # (marketingový projekt), i když jsou v DB jako jiné Project ID.
        if other.get("project_name") and target.get("project_name") and other.get("project_name") == target.get("project_name"):
            continue
        # Porovnávame jen jednotky se stejným typem rekonstrukce (novostavba s novostavbou, rekonstrukce s rekonstrukcí).
        if other.get("renovation") != target.get("renovation"):
            continue
        # Pro účely lokálního průměru bereme:
        # - jednotky "na trhu" (available / reserved) vždy
        # - prodané jednotky (sold) jen pokud mají sold_date mladší než 6 měsíců.
        if not other.get("on_market"):
            status_other = str(other.get("availability_status") or "").strip().lower()
            sold_date = other.get("sold_date")
            if status_other != "sold" or sold_date is None or (date.today() - sold_date).days > SOLD_DATE_MAX_DAYS_FOR_COMPARABLE:
                continue
        d = _haversine_m(lat1, lon1, other["lat"], other["lon"])
        if d > radius_m:
            continue
        g2 = other["group"]
        a2 = other["area"]
        p2 = other["price_pm2"]
        if in_area_bucket(g2, a2, "1kk"):
            bucket_1_prices.append(p2)
            bucket_1_infos.append((other, d))
        if in_area_bucket(g2, a2, "2kk"):
            bucket_2_prices.append(p2)
            bucket_2_infos.append((other, d))
        if in_area_bucket(g2, a2, "3kk"):
            bucket_3_prices.append(p2)
            bucket_3_infos.append((other, d))
        if in_area_bucket(g2, a2, "4kk"):
            bucket_4_prices.append(p2)
            bucket_4_infos.append((other, d))

    def avg_of_project_avgs(infos_with_dist: list[tuple[dict[str, Any], float]]) -> float | None:
        """Průměr průměrů po projektech (každý projekt jeden hlas)."""
        by_project: dict[tuple[Any, Any], list[float]] = {}
        for other, _ in infos_with_dist:
            proj_key = (other.get("project_id"), other.get("project_name") or "")
            by_project.setdefault(proj_key, []).append(other["price_pm2"])
        project_avgs = [avg(prices) for prices in by_project.values() if prices]
        return avg(project_avgs) if project_avgs else None

    ref_avg: float | None = None
    comparables_raw: list[tuple[dict[str, Any], float]] = []
    if group == "1kk":
        ref_avg = avg_of_project_avgs(bucket_1_infos)
        comparables_raw = bucket_1_infos
    elif group == "2kk":
        ref_avg = avg_of_project_avgs(bucket_2_infos)
        comparables_raw = bucket_2_infos
    elif group == "3kk":
        ref_avg = avg_of_project_avgs(bucket_3_infos)
        comparables_raw = bucket_3_infos
    elif group == "4kk":
        ref_avg = avg_of_project_avgs(bucket_4_infos)
        comparables_raw = bucket_4_infos
    elif group == "1.5kk":
        r1 = avg_of_project_avgs(bucket_1_infos)
        r2 = avg_of_project_avgs(bucket_2_infos)
        if r1 is not None and r2 is not None:
            ref_avg = (r1 + r2) / 2.0
        elif r1 is not None:
            ref_avg = r1
        elif r2 is not None:
            ref_avg = r2
        comparables_raw = bucket_1_infos + bucket_2_infos

    diff_percent: float | None
    if ref_avg is None or ref_avg <= 0:
        diff_percent = None
    else:
        diff_percent = (price_pm2 - ref_avg) / ref_avg * 100.0

    def bucket_bounds_for_group(gr: str | None) -> tuple[float | None, float | None, str | None]:
        if gr == "1kk":
            return 20.0, 35.0, "1kk (20–35 m²)"
        if gr == "2kk":
            return 40.0, 60.0, "2kk (40–60 m²)"
        if gr == "3kk":
            return 60.0, 80.0, "3kk (60–80 m²)"
        if gr == "4kk":
            return 80.0, 120.0, "4kk (80–120 m²)"
        if gr == "1.5kk":
            return 20.0, 60.0, "1,5kk (1kk 20–35 m² + 2kk 40–60 m²)"
        return None, None, None

    min_area, max_area, bucket_label = bucket_bounds_for_group(group)

    comparables: list[LocalPriceDiffComparable] = []
    for other, dist in comparables_raw:
        comparables.append(
            LocalPriceDiffComparable(
                external_id=other["external_id"],
                project_name=other.get("project_name"),
                gps_latitude=other.get("lat"),
                gps_longitude=other.get("lon"),
                price_per_m2_czk=other["price_pm2"],
                floor_area_m2=other["area"],
                total_price_czk=other.get("total_price_czk"),
                exterior_area_m2=other.get("exterior_area_m2"),
                layout=other.get("layout"),
                floor=other.get("floor"),
                last_seen=other.get("last_seen"),
                sold_date=other.get("sold_date"),
                distance_m=dist,
                availability_status=other.get("availability_status"),
                available=bool(other.get("available", False)),
                renovation=other.get("renovation"),
            )
        )

    return LocalPriceDiffDebugResponse(
        unit_external_id=external_id,
        radius_m=radius_m,
        unit_gps_latitude=lat1,
        unit_gps_longitude=lon1,
        group=group,
        bucket_label=bucket_label,
        bucket_min_area_m2=min_area,
        bucket_max_area_m2=max_area,
        unit_price_per_m2_czk=price_pm2,
        unit_total_price_czk=target.get("total_price_czk"),
        unit_layout=target.get("layout"),
        unit_floor_area_m2=target.get("area"),
        unit_exterior_area_m2=target.get("exterior_area_m2"),
        unit_floor=target.get("floor"),
        ref_avg_price_per_m2_czk=ref_avg,
        diff_percent=diff_percent,
        unit_renovation=target.get("renovation"),
        comparables=comparables,
    )


@app.get("/wizard-metadata")
def get_wizard_metadata_endpoint():
    """Return wizard field metadata — canonical options, labels, types.

    Frontend uses this to populate wizard field options instead of hardcoded values.
    Static data, no DB needed — safe to cache aggressively.
    """
    from .wizard_metadata import get_wizard_metadata
    return get_wizard_metadata()


@app.get("/filters")
def get_filters(db: DbSession):
    """Return filter definitions from field_catalog.csv (Filterable == ANO). Cached in memory; options from DB for enum."""
    return get_filter_groups(db)


@app.get(
    "/projects/search",
    summary="Search project names (typeahead)",
    description="Returns project names matching q (case-insensitive partial match). For use in filter typeahead.",
)
def search_projects(
    db: DbSession,
    q: Annotated[str, Query(description="Search string")] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[str]:
    if not (q or "").strip():
        return []
    term = f"%{(q or '').strip()}%"
    stmt = (
        select(Project.name)
        .distinct()
        .where(Project.name.ilike(term))
        .order_by(Project.name)
        .limit(limit)
    )
    rows = db.execute(stmt).scalars().all()
    return [r for r in rows if r]


@app.get(
    "/locations/suggest",
    summary="Location autocomplete for wizard admin_area / admin_region",
    description=(
        "Returns distinct location values from the projects table for use as "
        "wizard autocomplete.  scope=area unions administrative_district_iga "
        "(Prague admin districts) and district (okres names); scope=region "
        "returns distinct region_iga values.  Empty q returns top-N by "
        "project count (quick-pick on focus).  This is purely a suggestion "
        "source — the wizard still accepts free-text values so the data "
        "model contract is unchanged."
    ),
)
def suggest_locations(
    db: DbSession,
    scope: Annotated[str, Query(description="area | region")],
    q: Annotated[str, Query(description="Optional prefix/substring filter")] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[dict]:
    if scope not in ("area", "region"):
        raise HTTPException(status_code=422, detail="scope must be 'area' or 'region'")

    term = (q or "").strip()
    like = f"%{term}%" if term else None

    # Pick the columns to union for each scope.  Both scopes read from
    # projects only — brokers think in projects, and admin labels are
    # carried on the project row, not the unit row.
    if scope == "region":
        columns = [Project.region_iga]
    else:  # area — union across all geographic granularities so broker can
        # type "Beroun", "Smíchov", "Praha 8" or "Praha-západ" and get hits
        columns = [
            Project.neighborhood,                  # Karlín, Vinohrady, Holešovice…
            Project.administrative_district_iga,  # Praha 8 (správní obvod)
            Project.municipality,                  # Praha 8, Praha 4, Beroun…
            Project.cadastral_area_iga,            # Smíchov, Žižkov, Stodůlky…
            Project.city,                          # Praha, Beroun, Kladno…
            Project.district,                      # okres: Praha-západ, Beroun…
        ]

    # Aggregate (value, count) across the selected columns in a single
    # pass per column, then merge in Python.  Two small queries are
    # cheaper and more readable than a SQL UNION + GROUP BY here.
    merged: dict[str, int] = {}
    for col in columns:
        stmt = select(col, func.count()).where(col.is_not(None))
        if like is not None:
            stmt = stmt.where(col.ilike(like))
        stmt = stmt.group_by(col)
        for value, count in db.execute(stmt).all():
            if not value:
                continue
            merged[value] = merged.get(value, 0) + int(count or 0)

    # Sort by count desc, then alphabetically for stable ordering within
    # the same frequency bucket.
    ordered = sorted(merged.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    return [{"value": v, "count": c} for v, c in ordered[:limit]]


@app.get(
    "/locations/hierarchy",
    summary="Hierarchical location picker data",
    description=(
        "Returns location tree for 3-level drill-down: district → municipality → neighborhood. "
        "Without params returns all districts. With district= returns municipalities in that district. "
        "With municipality= returns neighborhoods in that municipality."
    ),
)
def location_hierarchy(
    db: DbSession,
    district: Annotated[str | None, Query()] = None,
    municipality: Annotated[str | None, Query()] = None,
) -> list[dict]:
    if municipality is not None:
        # Level 3: neighborhoods within a municipality
        rows = db.execute(
            select(Project.neighborhood, func.count().label("cnt"))
            .where(Project.municipality == municipality, Project.neighborhood.is_not(None))
            .group_by(Project.neighborhood)
            .order_by(func.count().desc(), Project.neighborhood)
        ).all()
        return [{"value": r.neighborhood, "count": r.cnt} for r in rows]

    if district is not None:
        # Level 2: municipalities within a district
        rows = db.execute(
            select(Project.municipality, func.count().label("cnt"))
            .where(Project.district == district, Project.municipality.is_not(None))
            .group_by(Project.municipality)
            .order_by(func.count().desc(), Project.municipality)
        ).all()
        return [{"value": r.municipality, "count": r.cnt} for r in rows]

    # Level 1: all districts
    rows = db.execute(
        select(Project.district, func.count().label("cnt"))
        .where(Project.district.is_not(None))
        .group_by(Project.district)
        .order_by(func.count().desc(), Project.district)
    ).all()
    return [{"value": r.district, "count": r.cnt} for r in rows]


@app.get(
    "/columns",
    summary="Column definitions for table views",
    description="Returns columns from field_catalog.csv where 'Zobrazit na webu' == ANO. view=units: unit and project columns; view=projects: project only. Ordered by web_order if present, else by label.",
)
def get_columns(
    view: Annotated[str, Query(description="Table view: units or projects")] = "units",
) -> list[dict]:
    if view not in ("units", "projects"):
        raise HTTPException(status_code=422, detail="view must be 'units' or 'projects'")
    return get_column_definitions(view)


@app.get(
    "/projects/columns",
    summary="Project column definitions (alias for GET /columns?view=projects)",
    description="Returns same as GET /columns?view=projects. Kept for frontend compatibility.",
)
def get_projects_columns() -> list[dict]:
    return get_column_definitions("projects")


ALLOWED_SORT_BY = (
    # Unit-level sortable fields
    "price_per_m2_czk",
    "price_czk",
    "price_change",
    "original_price_czk",
    "original_price_per_m2_czk",
    "ride_to_center_min",
    "public_transport_to_center_min",
    "ride_to_center",  # alias pro jednotky (sloupec z projektu)
    "public_transport_to_center",
    "floor_area_m2",
    "total_area_m2",
    "exterior_area_m2",
    "balcony_area_m2",
    "terrace_area_m2",
    "garden_area_m2",
    "days_on_market",
    "first_seen",
    "last_seen",
    "sold_date",
    "updated_at",
    "layout",
    "floor",
    "floors",
    "orientation",
    "category",
    "availability_status",
    "renovation",
    "overall_quality",
    "heating",
    "air_conditioning",
    "cooling_ceilings",
    "exterior_blinds",
    "smart_home",
    "windows",
    "partition_walls",
    "amenities",
    "city",
    "municipality",
    "district",
    "cadastral_area_iga",
    "municipal_district_iga",
    "administrative_district_iga",
    "region_iga",
    "address",
    "developer",
    # Project name (column "Projekt" v tabulce jednotek)
    "name",
    # Jednotkové financování
    "payment_contract",
    "payment_construction",
    "payment_occupancy",
    # Lokální cenová odchylka vs. trh (500 m sloupec již nepoužíváme)
    "local_price_diff_1000m",
    "local_price_diff_2000m",
    # Project-level aggregate fields injected into unit.data (via ProjectAggregates)
    "total_units",
    "available_units",
    "availability_ratio",
    "avg_price_czk",
    "min_price_czk",
    "max_price_czk",
    "avg_price_per_m2_czk",
    "avg_floor_area_m2",
    "min_parking_indoor_price_czk",
    "max_parking_indoor_price_czk",
    "min_parking_outdoor_price_czk",
    "max_parking_outdoor_price_czk",
    "project_first_seen",
    "project_last_seen",
    "max_days_on_market",
    "min_payment_contract",
    "max_payment_contract",
    "min_payment_construction",
    "max_payment_construction",
    "min_payment_occupancy",
    "max_payment_occupancy",
    "noise_day_db",
    "noise_night_db",
    "noise_label",
    "distance_to_primary_road_m",
    "distance_to_tram_tracks_m",
    "distance_to_railway_m",
    "distance_to_airport_m",
    "micro_location_score",
    "micro_location_label",
)
ALLOWED_SORT_DIR = ("asc", "desc")


def _build_units_query(
    *,
    available: bool | None = None,
    availability: list[str] | None = None,
    min_price: int | None = None,
    max_price: int | None = None,
    min_price_change: float | None = None,
    max_price_change: float | None = None,
    min_original_price: int | None = None,
    max_original_price: int | None = None,
    min_original_price_per_m2: int | None = None,
    max_original_price_per_m2: int | None = None,
    min_price_per_m2: int | None = None,
    max_price_per_m2: int | None = None,
    layout: list[str] | None = None,
    district: list[str] | None = None,
    municipality: list[str] | None = None,
    heating: list[str] | None = None,
    windows: list[str] | None = None,
    permit_regular: bool | None = None,
    renovation: bool | None = None,
    air_conditioning: bool | None = None,
    cooling_ceilings: bool | None = None,
    smart_home: bool | None = None,
    exterior_blinds: str | None = None,
    min_floor_area: float | None = None,
    max_floor_area: float | None = None,
    min_total_area: float | None = None,
    max_total_area: float | None = None,
    min_exterior_area: float | None = None,
    max_exterior_area: float | None = None,
    min_balcony_area: float | None = None,
    max_balcony_area: float | None = None,
    min_terrace_area: float | None = None,
    max_terrace_area: float | None = None,
    min_garden_area: float | None = None,
    max_garden_area: float | None = None,
    min_days_on_market: int | None = None,
    max_days_on_market: int | None = None,
    min_floor: int | None = None,
    max_floor: int | None = None,
    orientation: list[str] | None = None,
    category: list[str] | None = None,
    overall_quality: list[str] | None = None,
    partition_walls: list[str] | None = None,
    city: list[str] | None = None,
    cadastral_area_iga: list[str] | None = None,
    municipal_district_iga: list[str] | None = None,
    administrative_district_iga: list[str] | None = None,
    region_iga: list[str] | None = None,
    developer: list[str] | None = None,
    building: list[str] | None = None,
    project_names: list[str] | None = None,
    min_latitude: float | None = None,
    max_latitude: float | None = None,
    min_longitude: float | None = None,
    max_longitude: float | None = None,
    min_ride_to_center_min: float | None = None,
    max_ride_to_center_min: float | None = None,
    min_public_transport_to_center_min: float | None = None,
    max_public_transport_to_center_min: float | None = None,
    min_payment_contract: float | None = None,
    max_payment_contract: float | None = None,
    min_payment_construction: float | None = None,
    max_payment_construction: float | None = None,
    min_payment_occupancy: float | None = None,
    max_payment_occupancy: float | None = None,
    recuperation: list[str] | None = None,
    max_distance_to_metro_station_m: float | None = None,
    max_distance_to_tram_stop_m: float | None = None,
    max_distance_to_bus_stop_m: float | None = None,
    max_distance_to_train_station_m: float | None = None,
    min_completion_date: date | None = None,
    max_completion_date: date | None = None,
):
    """Build base select(Unit) with filters applied only when param is not None.
    Primárně filtruje na Unit, volitelně se přidávají joiny na Project.
    """
    base = select(Unit)
    if available is not None:
        base = base.where(Unit.available.is_(available))
    if availability is not None and len(availability) > 0:
        base = base.where(Unit.availability_status.in_(availability))
    if min_price is not None:
        base = base.where(Unit.price_czk >= min_price)
    if max_price is not None:
        base = base.where(Unit.price_czk <= max_price)
    if min_price_change is not None:
        base = base.where(Unit.price_change >= min_price_change)
    if max_price_change is not None:
        base = base.where(Unit.price_change <= max_price_change)
    if min_original_price is not None:
        base = base.where(Unit.original_price_czk >= min_original_price)
    if max_original_price is not None:
        base = base.where(Unit.original_price_czk <= max_original_price)
    if min_original_price_per_m2 is not None:
        base = base.where(Unit.original_price_per_m2_czk >= min_original_price_per_m2)
    if max_original_price_per_m2 is not None:
        base = base.where(Unit.original_price_per_m2_czk <= max_original_price_per_m2)
    if min_price_per_m2 is not None:
        base = base.where(Unit.price_per_m2_czk >= min_price_per_m2)
    if max_price_per_m2 is not None:
        base = base.where(Unit.price_per_m2_czk <= max_price_per_m2)
    if layout is not None and len(layout) > 0:
        base = base.where(Unit.layout.in_(layout))
    if district is not None and len(district) > 0:
        po_district = aliased(ProjectOverride)
        base = base.outerjoin(
            po_district,
            (po_district.project_id == Unit.project_id) & (po_district.field == "district"),
        )
        base = base.where(coalesce(po_district.value, Unit.district).in_(district))
    if municipality is not None and len(municipality) > 0:
        po_municipality = aliased(ProjectOverride)
        base = base.outerjoin(
            po_municipality,
            (po_municipality.project_id == Unit.project_id) & (po_municipality.field == "municipality"),
        )
        base = base.where(coalesce(po_municipality.value, Unit.municipality).in_(municipality))
    if heating is not None and len(heating) > 0:
        po_heating = aliased(ProjectOverride)
        base = base.outerjoin(
            po_heating,
            (po_heating.project_id == Unit.project_id) & (po_heating.field == "heating"),
        )
        eff_heating = coalesce(po_heating.value, Unit.heating)
        heating_clauses = canonical_ilike_clauses(eff_heating, heating, CANONICAL_HEATING_PATTERNS)
        if heating_clauses:
            base = base.where(or_(*heating_clauses))
    if windows is not None and len(windows) > 0:
        po_windows = aliased(ProjectOverride)
        base = base.outerjoin(
            po_windows,
            (po_windows.project_id == Unit.project_id) & (po_windows.field == "windows"),
        )
        eff_windows = coalesce(po_windows.value, Unit.windows)
        windows_clauses = canonical_ilike_clauses(eff_windows, windows, CANONICAL_WINDOWS_PATTERNS)
        if windows_clauses:
            base = base.where(or_(*windows_clauses))
    if permit_regular is not None:
        po_permit = aliased(ProjectOverride)
        base = base.outerjoin(
            po_permit,
            (po_permit.project_id == Unit.project_id) & (po_permit.field == "permit_regular"),
        )
        eff_permit = case(
            (po_permit.value.isnot(None), func.lower(po_permit.value) == "true"),
            else_=Unit.permit_regular,
        )
        base = base.where(eff_permit.is_(permit_regular))
    if renovation is not None:
        po_renovation = aliased(ProjectOverride)
        base = base.outerjoin(
            po_renovation,
            (po_renovation.project_id == Unit.project_id) & (po_renovation.field == "renovation"),
        )
        eff_renovation = case(
            (po_renovation.value.isnot(None), func.lower(po_renovation.value) == "true"),
            else_=Unit.renovation,
        )
        base = base.where(eff_renovation.is_(renovation))
    if air_conditioning is not None:
        base = base.where(Unit.air_conditioning.is_(air_conditioning))
    if cooling_ceilings is not None:
        base = base.where(Unit.cooling_ceilings.is_(cooling_ceilings))
    if smart_home is not None:
        base = base.where(Unit.smart_home.is_(smart_home))
    if exterior_blinds is not None:
        base = base.where(Unit.exterior_blinds == exterior_blinds)
    if min_floor_area is not None:
        base = base.where(Unit.floor_area_m2 >= min_floor_area)
    if max_floor_area is not None:
        base = base.where(Unit.floor_area_m2 <= max_floor_area)
    if min_total_area is not None:
        base = base.where(Unit.total_area_m2 >= min_total_area)
    if max_total_area is not None:
        base = base.where(Unit.total_area_m2 <= max_total_area)
    if min_exterior_area is not None:
        base = base.where(Unit.exterior_area_m2 >= min_exterior_area)
    if max_exterior_area is not None:
        base = base.where(Unit.exterior_area_m2 <= max_exterior_area)
    if min_balcony_area is not None:
        base = base.where(Unit.balcony_area_m2 >= min_balcony_area)
    if max_balcony_area is not None:
        base = base.where(Unit.balcony_area_m2 <= max_balcony_area)
    if min_terrace_area is not None:
        base = base.where(Unit.terrace_area_m2 >= min_terrace_area)
    if max_terrace_area is not None:
        base = base.where(Unit.terrace_area_m2 <= max_terrace_area)
    if min_garden_area is not None:
        base = base.where(Unit.garden_area_m2 >= min_garden_area)
    if max_garden_area is not None:
        base = base.where(Unit.garden_area_m2 <= max_garden_area)
    if min_days_on_market is not None:
        base = base.where(Unit.days_on_market >= min_days_on_market)
    if max_days_on_market is not None:
        base = base.where(Unit.days_on_market <= max_days_on_market)
    if min_floor is not None:
        base = base.where(Unit.floor >= min_floor)
    if max_floor is not None:
        base = base.where(Unit.floor <= max_floor)
    if orientation is not None and len(orientation) > 0:
        # Orientace: hodnoty jako "E", "N", "S", "W" nebo kombinace "E,N,S".
        # Filtr má význam "alespoň jedna z vybraných světových stran".
        clauses = []
        for d in orientation:
            if not d:
                continue
            token = str(d).strip().upper()
            if not token:
                continue
            clauses.append(Unit.orientation.ilike(f"%{token}%"))
        if clauses:
            base = base.where(or_(*clauses))
    if category is not None and len(category) > 0:
        base = base.where(Unit.category.in_(category))
    if overall_quality is not None and len(overall_quality) > 0:
        po_overall_quality = aliased(ProjectOverride)
        base = base.outerjoin(
            po_overall_quality,
            (po_overall_quality.project_id == Unit.project_id) & (po_overall_quality.field == "overall_quality"),
        )
        base = base.where(coalesce(po_overall_quality.value, Unit.overall_quality).in_(overall_quality))
    if partition_walls is not None and len(partition_walls) > 0:
        po_partition_walls = aliased(ProjectOverride)
        base = base.outerjoin(
            po_partition_walls,
            (po_partition_walls.project_id == Unit.project_id) & (po_partition_walls.field == "partition_walls"),
        )
        eff_pw = coalesce(po_partition_walls.value, Unit.partition_walls)
        pw_clauses = canonical_ilike_clauses(eff_pw, partition_walls, CANONICAL_PARTITION_WALLS_PATTERNS)
        if pw_clauses:
            base = base.where(or_(*pw_clauses))
    if recuperation is not None and len(recuperation) > 0:
        po_recup = aliased(ProjectOverride)
        proj_recup = aliased(Project)
        base = base.outerjoin(
            po_recup,
            (po_recup.project_id == Unit.project_id) & (po_recup.field == "recuperation"),
        )
        base = base.outerjoin(proj_recup, proj_recup.id == Unit.project_id)
        eff_recup = coalesce(po_recup.value, proj_recup.recuperation)
        recup_clauses = []
        for rv in recuperation:
            if rv == 'true':
                recup_clauses.append(func.lower(eff_recup) == 'true')
            elif rv == 'false':
                recup_clauses.append(func.lower(eff_recup) == 'false')
            elif rv == 'unknown':
                recup_clauses.append(or_(
                    eff_recup.is_(None),
                    func.lower(eff_recup).notin_(['true', 'false']),
                ))
        if recup_clauses:
            base = base.where(or_(*recup_clauses))
    if city is not None and len(city) > 0:
        po_city = aliased(ProjectOverride)
        base = base.outerjoin(
            po_city,
            (po_city.project_id == Unit.project_id) & (po_city.field == "city"),
        )
        base = base.where(coalesce(po_city.value, Unit.city).in_(city))
    if cadastral_area_iga is not None and len(cadastral_area_iga) > 0:
        po_cadastral = aliased(ProjectOverride)
        base = base.outerjoin(
            po_cadastral,
            (po_cadastral.project_id == Unit.project_id) & (po_cadastral.field == "cadastral_area_iga"),
        )
        base = base.where(coalesce(po_cadastral.value, Unit.cadastral_area_iga).in_(cadastral_area_iga))
    if municipal_district_iga is not None and len(municipal_district_iga) > 0:
        po_municipal_district = aliased(ProjectOverride)
        base = base.outerjoin(
            po_municipal_district,
            (po_municipal_district.project_id == Unit.project_id) & (po_municipal_district.field == "municipal_district_iga"),
        )
        base = base.where(coalesce(po_municipal_district.value, Unit.municipal_district_iga).in_(municipal_district_iga))
    if administrative_district_iga is not None and len(administrative_district_iga) > 0:
        po_admin_district = aliased(ProjectOverride)
        base = base.outerjoin(
            po_admin_district,
            (po_admin_district.project_id == Unit.project_id) & (po_admin_district.field == "administrative_district_iga"),
        )
        base = base.where(coalesce(po_admin_district.value, Unit.administrative_district_iga).in_(administrative_district_iga))
    if region_iga is not None and len(region_iga) > 0:
        po_region = aliased(ProjectOverride)
        base = base.outerjoin(
            po_region,
            (po_region.project_id == Unit.project_id) & (po_region.field == "region_iga"),
        )
        base = base.where(coalesce(po_region.value, Unit.region_iga).in_(region_iga))
    if developer is not None and len(developer) > 0:
        po_developer = aliased(ProjectOverride)
        base = base.outerjoin(
            po_developer,
            (po_developer.project_id == Unit.project_id) & (po_developer.field == "developer"),
        )
        base = base.where(coalesce(po_developer.value, Unit.developer).in_(developer))
    if building is not None and len(building) > 0:
        base = base.where(Unit.building.in_(building))
    if project_names is not None and len(project_names) > 0:
        # Filtrování podle názvu projektu – join na Project a case-insensitive partial match
        # (umožní najít projekt i při drobných rozdílech v názvu typu
        # "Rezidence Klamovka Park" vs. "Klamovka Park").
        names = [str(p).strip() for p in project_names if p]
        if names:
            clauses = [Project.name.ilike(f"%{n}%") for n in names if n]
            if clauses:
                base = base.join(Project, Project.id == Unit.project_id).where(or_(*clauses))

    # Datum dokončení projektu — Project.completion_date. Vyžaduje join.
    if min_completion_date is not None or max_completion_date is not None:
        base = base.join(Project, Project.id == Unit.project_id)
        if min_completion_date is not None:
            base = base.where(Project.completion_date >= min_completion_date)
        if max_completion_date is not None:
            base = base.where(Project.completion_date <= max_completion_date)
    if min_latitude is not None:
        base = base.where(Unit.gps_latitude >= min_latitude)
    if max_latitude is not None:
        base = base.where(Unit.gps_latitude <= max_latitude)
    if min_longitude is not None:
        base = base.where(Unit.gps_longitude >= min_longitude)
    if max_longitude is not None:
        base = base.where(Unit.gps_longitude <= max_longitude)
    if min_ride_to_center_min is not None:
        base = base.where(Unit.ride_to_center_min >= min_ride_to_center_min)
    if max_ride_to_center_min is not None:
        base = base.where(Unit.ride_to_center_min <= max_ride_to_center_min)
    if min_public_transport_to_center_min is not None:
        base = base.where(Unit.public_transport_to_center_min >= min_public_transport_to_center_min)
    if max_public_transport_to_center_min is not None:
        base = base.where(Unit.public_transport_to_center_min <= max_public_transport_to_center_min)
    # Financování: jednotky bez údaje (NULL nebo 0 = nevyplněno) filtrem projdou – „—" = jako by bylo v rozsahu
    if min_payment_contract is not None:
        base = base.where(
            or_(
                Unit.payment_contract.is_(None),
                Unit.payment_contract == 0,
                Unit.payment_contract >= min_payment_contract,
            )
        )
    if max_payment_contract is not None:
        base = base.where(
            or_(
                Unit.payment_contract.is_(None),
                Unit.payment_contract == 0,
                Unit.payment_contract <= max_payment_contract,
            )
        )
    if min_payment_construction is not None:
        base = base.where(
            or_(
                Unit.payment_construction.is_(None),
                Unit.payment_construction == 0,
                Unit.payment_construction >= min_payment_construction,
            )
        )
    if max_payment_construction is not None:
        base = base.where(
            or_(
                Unit.payment_construction.is_(None),
                Unit.payment_construction == 0,
                Unit.payment_construction <= max_payment_construction,
            )
        )
    if min_payment_occupancy is not None:
        base = base.where(
            or_(
                Unit.payment_occupancy.is_(None),
                Unit.payment_occupancy == 0,
                Unit.payment_occupancy >= min_payment_occupancy,
            )
        )
    if max_payment_occupancy is not None:
        base = base.where(
            or_(
                Unit.payment_occupancy.is_(None),
                Unit.payment_occupancy == 0,
                Unit.payment_occupancy <= max_payment_occupancy,
            )
        )
    # Vzdálenosti k zastávkám MHD / vlaku (Project-level, filtr „blízko X")
    _distance_filters = [
        (max_distance_to_metro_station_m, "distance_to_metro_station_m"),
        (max_distance_to_tram_stop_m, "distance_to_tram_stop_m"),
        (max_distance_to_bus_stop_m, "distance_to_bus_stop_m"),
        (max_distance_to_train_station_m, "distance_to_train_station_m"),
    ]
    if any(v is not None for v, _ in _distance_filters):
        proj_dist = aliased(Project)
        base = base.outerjoin(proj_dist, proj_dist.id == Unit.project_id)
        for max_val, field_name in _distance_filters:
            if max_val is None:
                continue
            col = getattr(proj_dist, field_name)
            base = base.where(col.isnot(None)).where(col <= max_val)
    return base


def _get_units_filter_metadata(db: Session) -> dict:
    """Compute filter metadata from Unit table: range min/max and distinct select values. Ignores nulls."""
    result: dict = {}

    # Range fields: (Unit column,) -> use func.min, func.max
    range_columns = [
        (Unit.price_czk, "price_czk"),
        (Unit.price_per_m2_czk, "price_per_m2_czk"),
        (Unit.floor_area_m2, "floor_area_m2"),
    ]
    for col, key in range_columns:
        row = db.execute(
            select(func.min(col), func.max(col)).where(col.isnot(None))
        ).first()
        if row is None:
            result[key] = {"type": "range", "min": None, "max": None}
        else:
            min_val, max_val = row[0], row[1]
            result[key] = {
                "type": "range",
                "min": float(min_val) if min_val is not None else None,
                "max": float(max_val) if max_val is not None else None,
            }

    # Select fields: distinct non-null, sorted
    select_columns = [
        (Unit.layout, "layout"),
        (Unit.district, "district"),
        (Unit.heating, "heating"),
        (Unit.windows, "windows"),
    ]
    for col, key in select_columns:
        rows = db.execute(
            select(col).where(col.isnot(None)).distinct().order_by(col)
        ).all()
        values = [str(r[0]) for r in rows if r[0] is not None]
        values = sorted(set(values), key=str.casefold)
        result[key] = {"type": "select", "values": values}

    # Boolean fields: no aggregation
    result["permit_regular"] = {"type": "boolean"}
    result["renovation"] = {"type": "boolean"}

    return result


@app.get(
    "/units/filters",
    summary="Unit filter metadata",
    description="Returns metadata to build frontend filters: range (min/max) for numeric fields, distinct values for select fields, and type for booleans. All from Unit model, nulls ignored.",
)
def get_units_filters(db: DbSession) -> dict:
    return _get_units_filter_metadata(db)


@app.get(
    "/units",
    summary="List units with pagination and filters",
    description="Returns a paginated list of units. Optional query params: limit (1–1000, default 100), offset, available, min_price, max_price, min_price_per_m2, max_price_per_m2, layout, district, heating, windows, permit_regular, renovation, min_floor_area, max_floor_area, sort_by, sort_dir, mode, with_summary. Response: total (count before pagination), items (UnitResponse with overrides applied). With mode=map returns a slim payload (~20× smaller) suitable for map markers; with with_summary=false skips the global avg/sum aggregates query (saves ~0.5–2s on large filter sets).",
)
def list_units(
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=1000, description="Page size (1–1000)")] = 100,
    offset: Annotated[int, Query(ge=0, description="Skip N items")] = 0,
    mode: Annotated[str, Query(description="Response shape. 'full' = UnitResponse with overrides + project enrichment (default). 'map' = id, external_id, project_id, project_name, gps, price, layout, status, area — ~20× smaller payload, no overrides applied.")] = "full",
    with_summary: Annotated[bool, Query(description="Compute global avg/sum aggregates over all matching units (across pages). Skip when caller doesn't need the summary panel — saves a heavy aggregate query.")] = True,
    with_count: Annotated[bool, Query(description="Compute total row count (COUNT(*) over the filtered base). Skip when caller fetches count separately in a parallel request — saves the slowest query of the endpoint.")] = True,
    available: Annotated[bool | None, Query(description="Filter by available")] = None,
    availability: Annotated[list[str] | None, Query(description="Filter by availability_status (any of)")] = None,
    min_price: Annotated[int | None, Query(ge=0)] = None,
    max_price: Annotated[int | None, Query(ge=0)] = None,
    min_price_change: Annotated[float | None, Query(description="Filter by price_change >= value")] = None,
    max_price_change: Annotated[float | None, Query(description="Filter by price_change <= value")] = None,
    min_original_price: Annotated[int | None, Query(ge=0)] = None,
    max_original_price: Annotated[int | None, Query(ge=0)] = None,
    min_original_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    max_original_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    min_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    max_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    layout: Annotated[list[str] | None, Query(description="Filter by layout (any of)")] = None,
    district: Annotated[list[str] | None, Query(description="Filter by district (any of)")] = None,
    municipality: Annotated[list[str] | None, Query(description="Filter by municipality (any of)")] = None,
    heating: Annotated[list[str] | None, Query(description="Filter by heating (any of)")] = None,
    windows: Annotated[list[str] | None, Query(description="Filter by windows (any of)")] = None,
    permit_regular: Annotated[bool | None, Query(description="Filter by permit_regular")] = None,
    renovation: Annotated[bool | None, Query(description="Filter by renovation")] = None,
    air_conditioning: Annotated[bool | None, Query(description="Filter by air_conditioning")] = None,
    cooling_ceilings: Annotated[bool | None, Query(description="Filter by cooling_ceilings")] = None,
    smart_home: Annotated[bool | None, Query(description="Filter by smart_home")] = None,
    exterior_blinds: Annotated[str | None, Query(description="Filter by exterior_blinds (true/false/preparation)")] = None,
    min_floor_area: Annotated[float | None, Query(ge=0)] = None,
    max_floor_area: Annotated[float | None, Query(ge=0)] = None,
    min_total_area: Annotated[float | None, Query(ge=0)] = None,
    max_total_area: Annotated[float | None, Query(ge=0)] = None,
    min_exterior_area: Annotated[float | None, Query(ge=0)] = None,
    max_exterior_area: Annotated[float | None, Query(ge=0)] = None,
    min_balcony_area: Annotated[float | None, Query(ge=0)] = None,
    max_balcony_area: Annotated[float | None, Query(ge=0)] = None,
    min_terrace_area: Annotated[float | None, Query(ge=0)] = None,
    max_terrace_area: Annotated[float | None, Query(ge=0)] = None,
    min_garden_area: Annotated[float | None, Query(ge=0)] = None,
    max_garden_area: Annotated[float | None, Query(ge=0)] = None,
    min_days_on_market: Annotated[int | None, Query(ge=0)] = None,
    max_days_on_market: Annotated[int | None, Query(ge=0)] = None,
    min_floor: Annotated[int | None, Query()] = None,
    max_floor: Annotated[int | None, Query()] = None,
    orientation: Annotated[list[str] | None, Query(description="Filter by orientation (any of)")] = None,
    category: Annotated[list[str] | None, Query(description="Filter by category (any of)")] = None,
    overall_quality: Annotated[list[str] | None, Query(description="Filter by overall_quality (any of)")] = None,
    partition_walls: Annotated[list[str] | None, Query(description="Filter by partition_walls (any of)")] = None,
    recuperation: Annotated[list[str] | None, Query(description="Filter by recuperation (true/false/unknown)")] = None,
    city: Annotated[list[str] | None, Query(description="Filter by city (any of)")] = None,
    cadastral_area_iga: Annotated[list[str] | None, Query(description="Filter by cadastral_area_iga (any of)")] = None,
    municipal_district_iga: Annotated[list[str] | None, Query(description="Filter by municipal_district_iga (any of)")] = None,
    administrative_district_iga: Annotated[
        list[str] | None, Query(description="Filter by administrative_district_iga (any of)")
    ] = None,
    region_iga: Annotated[list[str] | None, Query(description="Filter by region_iga (any of)")] = None,
    developer: Annotated[list[str] | None, Query(description="Filter by developer (any of)")] = None,
    building: Annotated[list[str] | None, Query(description="Filter by building (any of)")] = None,
    project: Annotated[list[str] | None, Query(description="Filter by project name (any of)")] = None,
    min_latitude: Annotated[float | None, Query(description="Filter by Unit.gps_latitude >= value")] = None,
    max_latitude: Annotated[float | None, Query(description="Filter by Unit.gps_latitude <= value")] = None,
    min_longitude: Annotated[float | None, Query(description="Filter by Unit.gps_longitude >= value")] = None,
    max_longitude: Annotated[float | None, Query(description="Filter by Unit.gps_longitude <= value")] = None,
    min_ride_to_center_min: Annotated[float | None, Query(ge=0, description="Filter by ride_to_center_min >= value (min)")] = None,
    max_ride_to_center_min: Annotated[float | None, Query(ge=0, description="Filter by ride_to_center_min <= value (min)")] = None,
    min_public_transport_to_center_min: Annotated[float | None, Query(ge=0, description="Filter by public_transport_to_center_min >= value (min)")] = None,
    max_public_transport_to_center_min: Annotated[float | None, Query(ge=0, description="Filter by public_transport_to_center_min <= value (min)")] = None,
    min_payment_contract: Annotated[float | None, Query(ge=0, le=1, description="Filter by payment_contract >= value (0–1)")] = None,
    max_payment_contract: Annotated[float | None, Query(ge=0, le=1, description="Filter by payment_contract <= value (0–1)")] = None,
    min_payment_construction: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_payment_construction: Annotated[float | None, Query(ge=0, le=1)] = None,
    min_payment_occupancy: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_payment_occupancy: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_distance_to_metro_station_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_metro_station_m <= value (m)")] = None,
    max_distance_to_tram_stop_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_tram_stop_m <= value (m)")] = None,
    max_distance_to_bus_stop_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_bus_stop_m <= value (m)")] = None,
    max_distance_to_train_station_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_train_station_m <= value (m)")] = None,
    min_completion_date: Annotated[date | None, Query(description="Filter units whose project completion_date >= value (YYYY-MM-DD)")] = None,
    max_completion_date: Annotated[date | None, Query(description="Filter units whose project completion_date <= value (YYYY-MM-DD)")] = None,
    include_archived: Annotated[bool, Query(description="Include units from fully sold projects older than 6 months")] = False,
    pending_api: Annotated[bool, Query(description="Return only units that have pending API update proposals")] = False,
    sort_by: Annotated[str, Query(description="Sort field")] = "price_per_m2_czk",
    sort_dir: Annotated[str, Query(description="Sort direction")] = "asc",
) -> Any:
    if sort_by not in ALLOWED_SORT_BY:
        raise HTTPException(
            status_code=422,
            detail=f"sort_by must be one of {', '.join(ALLOWED_SORT_BY)}",
        )
    sort_dir = sort_dir.strip().lower() or "asc"
    if sort_dir not in ALLOWED_SORT_DIR:
        raise HTTPException(
            status_code=422,
            detail="sort_dir must be asc or desc",
        )
    if mode not in ("full", "map"):
        raise HTTPException(status_code=422, detail="mode must be 'full' or 'map'")

    base = _build_units_query(
        available=available,
        availability=availability,
        min_price=min_price,
        max_price=max_price,
        min_price_change=min_price_change,
        max_price_change=max_price_change,
        min_original_price=min_original_price,
        max_original_price=max_original_price,
        min_original_price_per_m2=min_original_price_per_m2,
        max_original_price_per_m2=max_original_price_per_m2,
        min_price_per_m2=min_price_per_m2,
        max_price_per_m2=max_price_per_m2,
        layout=layout,
        district=district,
        municipality=municipality,
        heating=heating,
        windows=windows,
        permit_regular=permit_regular,
        renovation=renovation,
        air_conditioning=air_conditioning,
        cooling_ceilings=cooling_ceilings,
        smart_home=smart_home,
        exterior_blinds=exterior_blinds,
        min_floor_area=min_floor_area,
        max_floor_area=max_floor_area,
        min_total_area=min_total_area,
        max_total_area=max_total_area,
        min_exterior_area=min_exterior_area,
        max_exterior_area=max_exterior_area,
        min_balcony_area=min_balcony_area,
        max_balcony_area=max_balcony_area,
        min_terrace_area=min_terrace_area,
        max_terrace_area=max_terrace_area,
        min_garden_area=min_garden_area,
        max_garden_area=max_garden_area,
        min_days_on_market=min_days_on_market,
        max_days_on_market=max_days_on_market,
        min_floor=min_floor,
        max_floor=max_floor,
        orientation=orientation,
        category=category,
        overall_quality=overall_quality,
        partition_walls=partition_walls,
        city=city,
        cadastral_area_iga=cadastral_area_iga,
        municipal_district_iga=municipal_district_iga,
        administrative_district_iga=administrative_district_iga,
        region_iga=region_iga,
        developer=developer,
        building=building,
        project_names=project,
        min_latitude=min_latitude,
        max_latitude=max_latitude,
        min_longitude=min_longitude,
        max_longitude=max_longitude,
        min_ride_to_center_min=min_ride_to_center_min,
        max_ride_to_center_min=max_ride_to_center_min,
        min_public_transport_to_center_min=min_public_transport_to_center_min,
        max_public_transport_to_center_min=max_public_transport_to_center_min,
        min_payment_contract=min_payment_contract,
        max_payment_contract=max_payment_contract,
        min_payment_construction=min_payment_construction,
        max_payment_construction=max_payment_construction,
        min_payment_occupancy=min_payment_occupancy,
        max_payment_occupancy=max_payment_occupancy,
        recuperation=recuperation,
        max_distance_to_metro_station_m=max_distance_to_metro_station_m,
        max_distance_to_tram_stop_m=max_distance_to_tram_stop_m,
        max_distance_to_bus_stop_m=max_distance_to_bus_stop_m,
        max_distance_to_train_station_m=max_distance_to_train_station_m,
        min_completion_date=min_completion_date,
        max_completion_date=max_completion_date,
    )
    if pending_api:
        pending_subq = select(UnitApiPending.unit_id).where(UnitApiPending.unit_id == Unit.id)
        base = base.where(sa.exists(pending_subq))
    if not include_archived:
        recent_sold_cutoff = date.today() - timedelta(days=183)
        first_seen_cutoff = date.today() - timedelta(days=365 * 2)
        # Cached subquery místo live GROUP BY 40 k řádků — refreshovaná denně
        # ops_runnerem a po každém override skrz AGGREGATE_AFFECTING_FIELDS hook.
        agg = _project_agg_cached_subquery()
        active_projects_subq = (
            select(agg.c.project_id)
            .where(
                or_(
                    agg.c.units_available > 0,
                    and_(
                        agg.c.sold_date.is_(None),
                        or_(
                            agg.c.project_first_seen.is_(None),
                            agg.c.project_first_seen >= first_seen_cutoff,
                        ),
                    ),
                    and_(
                        agg.c.sold_date.is_not(None),
                        agg.c.sold_date >= recent_sold_cutoff,
                    ),
                )
            )
        )
        base = base.where(Unit.project_id.in_(active_projects_subq.subquery()))
    base_subq = base.subquery()
    # COUNT(*) přes filtrovanou base je nejpomalejší část endpointu (full scan
    # po LEFT JOINech projekt/overrides). Volající, který count zná z paralelního
    # requestu nebo ho nepotřebuje (mapa, infinite scroll), ho vypne přes
    # `with_count=false` a dostane total=-1.
    if with_count:
        total = db.execute(select(func.count()).select_from(base_subq)).scalar_one()
    else:
        total = -1

    # Globální agregace pro všechny jednotky odpovídající filtrům (bez limit/offset).
    # Vyžaduje agregaci přes celou base_subq (může jít o desítky tisíc řádků), což
    # je zdaleka nejdražší část endpointu pro plné filtry. Volající, který panel
    # se souhrnem nepotřebuje (mapa, infinite scroll, mode=map), ji vypne přes
    # `with_summary=false`.
    avg_price_czk: float | None = None
    avg_price_per_m2_czk: float | None = None
    available_count: int = 0
    avg_local_1000: float | None = None
    avg_local_2000: float | None = None
    if with_summary and mode == "full":
        summary_row = db.execute(
            select(
                func.avg(base_subq.c.price_czk),
                func.avg(base_subq.c.price_per_m2_czk),
                func.sum(case((base_subq.c.available.is_(True), 1), else_=0)),
                # Průměrná lokální odchylka (počítaná jen z jednotek na trhu) – používáme 1 km a 2 km.
                func.avg(
                    case(
                        (
                            or_(
                                base_subq.c.available.is_(True),
                                base_subq.c.availability_status.in_(["available", "reserved"]),
                            ),
                            base_subq.c.local_price_diff_1000m,
                        ),
                        else_=None,
                    )
                ),
                func.avg(
                    case(
                        (
                            or_(
                                base_subq.c.available.is_(True),
                                base_subq.c.availability_status.in_(["available", "reserved"]),
                            ),
                            base_subq.c.local_price_diff_2000m,
                        ),
                        else_=None,
                    )
                ),
            )
        ).first()
        avg_price_czk = float(summary_row[0]) if summary_row and summary_row[0] is not None else None
        avg_price_per_m2_czk = float(summary_row[1]) if summary_row and summary_row[1] is not None else None
        available_count = int(summary_row[2]) if summary_row and summary_row[2] is not None else 0
        avg_local_1000 = float(summary_row[3]) if summary_row and summary_row[3] is not None else None
        avg_local_2000 = float(summary_row[4]) if summary_row and summary_row[4] is not None else None

    # Fast-path: mode=map vrací slim payload pro mapové markery — bez overrides,
    # bez project enrichmentu, bez pending_api. ~20× menší a bez post-fetch SELECTů.
    if mode == "map":
        slim_stmt = (
            select(
                Unit.id,
                Unit.external_id,
                Unit.project_id,
                Unit.gps_latitude,
                Unit.gps_longitude,
                Unit.layout,
                Unit.availability_status,
                Unit.available,
                Unit.price_czk,
                Unit.price_per_m2_czk,
                Unit.floor_area_m2,
                Unit.exterior_area_m2,
                Unit.floor,
                Project.name.label("project_name"),
                Project.gps_latitude.label("project_gps_latitude"),
                Project.gps_longitude.label("project_gps_longitude"),
            )
            .select_from(base_subq)
            .join(Unit, Unit.id == base_subq.c.id)
            .join(Project, Project.id == Unit.project_id)
            .order_by(Unit.id.asc())
            .offset(offset)
            .limit(limit)
        )
        rows = db.execute(slim_stmt).mappings().all()
        items_payload = [
            {
                "id": r["id"],
                "external_id": r["external_id"],
                "project_id": r["project_id"],
                "project_name": r["project_name"],
                "gps_latitude": float(r["gps_latitude"]) if r["gps_latitude"] is not None else (
                    float(r["project_gps_latitude"]) if r["project_gps_latitude"] is not None else None
                ),
                "gps_longitude": float(r["gps_longitude"]) if r["gps_longitude"] is not None else (
                    float(r["project_gps_longitude"]) if r["project_gps_longitude"] is not None else None
                ),
                "layout": r["layout"],
                "availability_status": r["availability_status"],
                "available": bool(r["available"]),
                "price_czk": int(r["price_czk"]) if r["price_czk"] is not None else None,
                "price_per_m2_czk": int(r["price_per_m2_czk"]) if r["price_per_m2_czk"] is not None else None,
                "floor_area_m2": float(r["floor_area_m2"]) if r["floor_area_m2"] is not None else None,
                "exterior_area_m2": float(r["exterior_area_m2"]) if r["exterior_area_m2"] is not None else None,
                "floor": r["floor"],
            }
            for r in rows
        ]
        return JSONResponse(content={
            "items": items_payload,
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    # Řazení: část polí je přímo na Unit, část jsou projektové atributy (Project)
    # a část jsou projektové agregáty (ProjectAggregates).
    unit_sort_columns: dict[str, Any] = {
        "price_per_m2_czk": Unit.price_per_m2_czk,
        "price_czk": Unit.price_czk,
        "price_change": Unit.price_change,
        "original_price_czk": Unit.original_price_czk,
        "original_price_per_m2_czk": Unit.original_price_per_m2_czk,
        "ride_to_center_min": Unit.ride_to_center_min,
        "public_transport_to_center_min": Unit.public_transport_to_center_min,
        "ride_to_center": Unit.ride_to_center_min,
        "public_transport_to_center": Unit.public_transport_to_center_min,
        "floor_area_m2": Unit.floor_area_m2,
        "total_area_m2": Unit.total_area_m2,
        "exterior_area_m2": Unit.exterior_area_m2,
        "balcony_area_m2": Unit.balcony_area_m2,
        "terrace_area_m2": Unit.terrace_area_m2,
        "garden_area_m2": Unit.garden_area_m2,
        "days_on_market": Unit.days_on_market,
        "first_seen": Unit.first_seen,
        "last_seen": Unit.last_seen,
        "sold_date": Unit.sold_date,
        "updated_at": Unit.updated_at,
        "layout": Unit.layout,
        "floor": Unit.floor,
        "floors": Unit.floors,
        "orientation": Unit.orientation,
        "category": Unit.category,
        "availability_status": Unit.availability_status,
        "renovation": Unit.renovation,
        "overall_quality": Unit.overall_quality,
        "heating": Unit.heating,
        "air_conditioning": Unit.air_conditioning,
        "cooling_ceilings": Unit.cooling_ceilings,
        "exterior_blinds": Unit.exterior_blinds,
        "smart_home": Unit.smart_home,
        "windows": Unit.windows,
        "partition_walls": Unit.partition_walls,
        "amenities": Unit.amenities,
        "city": Unit.city,
        "municipality": Unit.municipality,
        "district": Unit.district,
        "cadastral_area_iga": Unit.cadastral_area_iga,
        "municipal_district_iga": Unit.municipal_district_iga,
        "administrative_district_iga": Unit.administrative_district_iga,
        "region_iga": Unit.region_iga,
        "address": Unit.address,
        "developer": Unit.developer,
        # Jednotkové financování
        "payment_contract": Unit.payment_contract,
        "payment_construction": Unit.payment_construction,
        "payment_occupancy": Unit.payment_occupancy,
        # Lokální cenová odchylka vs. trh (bez 500 m)
        "local_price_diff_1000m": Unit.local_price_diff_1000m,
        "local_price_diff_2000m": Unit.local_price_diff_2000m,
    }

    # Projektové atributy (sloupce typu "Projekt", které mají accessor project.*)
    project_sort_columns: dict[str, Any] = {
        # Column "Projekt" v jednotkách -> Project.name
        "name": Project.name,
        "noise_day_db": Project.noise_day_db,
        "noise_night_db": Project.noise_night_db,
        "noise_label": Project.noise_label,
        "distance_to_primary_road_m": Project.distance_to_primary_road_m,
        "distance_to_tram_tracks_m": Project.distance_to_tram_tracks_m,
        "distance_to_railway_m": Project.distance_to_railway_m,
        "distance_to_airport_m": Project.distance_to_airport_m,
        "micro_location_score": Project.micro_location_score,
        "micro_location_label": Project.micro_location_label,
        "walkability_score": Project.walkability_score,
        "walkability_daily_needs_score": Project.walkability_daily_needs_score,
        "walkability_transport_score": Project.walkability_transport_score,
        "walkability_leisure_score": Project.walkability_leisure_score,
        "walkability_family_score": Project.walkability_family_score,
    }

    order_fn = asc if sort_dir == "asc" else desc

    # Autem/MHD do centra: řadit podle zobrazené hodnoty (unit nebo fallback z projektu).
    # Jako u projektů: nejdřív získáme seřazená ID (subquery + jeden join na Project, ORDER BY coalesce),
    # pak načteme jednotky a v Pythonu je seřadíme podle tohoto pořadí – tím je řazení vždy deterministické.
    # Přijímáme i ride_to_center_min / public_transport_to_center_min (frontend může posílat obojí).
    _center_sort = (
        "ride_to_center" if sort_by in ("ride_to_center", "ride_to_center_min") else None,
        "public_transport_to_center" if sort_by in ("public_transport_to_center", "public_transport_to_center_min") else None,
    )
    if _center_sort[0] or _center_sort[1]:
        _by = _center_sort[0] or _center_sort[1]
        unit_subq = base.subquery()
        col_unit = unit_subq.c.ride_to_center_min if _by == "ride_to_center" else unit_subq.c.public_transport_to_center_min
        col_proj = Project.ride_to_center_min if _by == "ride_to_center" else Project.public_transport_to_center_min
        order_clause = order_fn(coalesce(col_unit, col_proj)).nulls_last()
        id_order_stmt = (
            select(unit_subq.c.id)
            .select_from(unit_subq)
            .join(Project, Project.id == unit_subq.c.project_id)
            .order_by(order_clause, unit_subq.c.external_id.asc())
            .offset(offset)
            .limit(limit)
        )
        id_rows = db.execute(id_order_stmt).all()
        ordered_ids = [r[0] for r in id_rows]
        if not ordered_ids:
            return UnitsListResponse(items=[], total=total, limit=limit, offset=offset)
        id_to_index = {uid: i for i, uid in enumerate(ordered_ids)}
        units_stmt = (
            select(Unit)
            .where(Unit.id.in_(ordered_ids))
            .options(selectinload(Unit.project))
        )
        units = db.execute(units_stmt).scalars().all()
        units = sorted(units, key=lambda u: id_to_index[u.id])
    else:
        if sort_by in unit_sort_columns:
            sort_column = unit_sort_columns[sort_by]
            order_clause = order_fn(sort_column).nulls_last()
            stmt = (
                base.options(selectinload(Unit.project))
                .order_by(order_clause, Unit.external_id.asc())
                .offset(offset)
                .limit(limit)
            )
        elif sort_by in project_sort_columns:
            sort_column = project_sort_columns[sort_by]
            order_clause = order_fn(sort_column).nulls_last()
            stmt = (
                base.join(Project, Project.id == Unit.project_id)
                .options(selectinload(Unit.project))
                .order_by(order_clause, Unit.external_id.asc())
                .offset(offset)
                .limit(limit)
            )
        else:
            # Projektové agregáty – join na ProjectAggregates a řazení podle jejich sloupců.
            from .models import ProjectAggregates  # local import to avoid circular

            agg_sort_columns: dict[str, Any] = {
                "total_units": ProjectAggregates.total_units,
                "available_units": ProjectAggregates.available_units,
                "availability_ratio": ProjectAggregates.availability_ratio,
                "avg_price_czk": ProjectAggregates.avg_price_czk,
                "min_price_czk": ProjectAggregates.min_price_czk,
                "max_price_czk": ProjectAggregates.max_price_czk,
                "avg_price_per_m2_czk": ProjectAggregates.avg_price_per_m2_czk,
                "avg_floor_area_m2": ProjectAggregates.avg_floor_area_m2,
                "min_parking_indoor_price_czk": ProjectAggregates.min_parking_indoor_price_czk,
                "max_parking_indoor_price_czk": ProjectAggregates.max_parking_indoor_price_czk,
                "min_parking_outdoor_price_czk": ProjectAggregates.min_parking_outdoor_price_czk,
                "max_parking_outdoor_price_czk": ProjectAggregates.max_parking_outdoor_price_czk,
                "project_first_seen": ProjectAggregates.project_first_seen,
                "project_last_seen": ProjectAggregates.project_last_seen,
                "max_days_on_market": ProjectAggregates.max_days_on_market,
                "min_payment_contract": ProjectAggregates.min_payment_contract,
                "max_payment_contract": ProjectAggregates.max_payment_contract,
                "min_payment_construction": ProjectAggregates.min_payment_construction,
                "max_payment_construction": ProjectAggregates.max_payment_construction,
                "min_payment_occupancy": ProjectAggregates.min_payment_occupancy,
                "max_payment_occupancy": ProjectAggregates.max_payment_occupancy,
            }

            sort_column = agg_sort_columns[sort_by]
            order_clause = order_fn(sort_column).nulls_last()
            stmt = (
                base.outerjoin(ProjectAggregates, ProjectAggregates.project_id == Unit.project_id)
                .options(selectinload(Unit.project))
                .order_by(order_clause, Unit.external_id.asc())
                .offset(offset)
                .limit(limit)
            )
        units = db.execute(stmt).scalars().all()

    if not units:
        return UnitsListResponse(items=[], total=total, limit=limit, offset=offset)

    unit_ids = [u.id for u in units]
    override_rows = db.execute(
        select(UnitOverride).where(
            UnitOverride.unit_id.in_(unit_ids),
            UnitOverride.field.in_(OVERRIDEABLE_FIELDS),
        )
    ).scalars().all()
    override_map = build_override_map(override_rows)

    # Pending API updates (návrhy z importu) pro všechny jednotky na stránce
    pending_rows = db.execute(
        select(UnitApiPending).where(UnitApiPending.unit_id.in_(unit_ids))
    ).scalars().all()
    pending_by_unit: dict[int, list[PendingApiUpdate]] = {}
    for p in pending_rows:
        pending_by_unit.setdefault(p.unit_id, []).append(
            PendingApiUpdate(field=p.field, api_value=p.value)
        )

    # Load cached project aggregates and project overrides for all projects in this page
    project_ids = {u.project_id for u in units}
    agg_by_project_id: dict[int, Any] = {}
    project_override_map: dict[int, dict[str, str]] = {}
    if project_ids:
        from .models import ProjectAggregates  # local import to avoid circular

        agg_rows = (
            db.execute(
                select(ProjectAggregates).where(ProjectAggregates.project_id.in_(project_ids))
            )
            .scalars()
            .all()
        )
        agg_by_project_id = {row.project_id: row for row in agg_rows}

        proj_override_rows = (
            db.execute(
                select(ProjectOverride).where(
                    ProjectOverride.project_id.in_(project_ids),
                    ProjectOverride.field.in_(PROJECT_OVERRIDEABLE_FIELDS),
                )
            )
            .scalars()
            .all()
        )
        project_override_map = build_project_override_map(proj_override_rows)

    items: list[UnitResponse] = []
    for u in units:
        d = unit_to_response_dict(u, override_map)
        pending_list = pending_by_unit.get(u.id, [])
        if pending_list:
            d["pending_api_updates"] = pending_list
        agg = agg_by_project_id.get(u.project_id)
        if agg is not None:
            data = dict(d.get("data") or {})
            # Use catalog column keys so /columns?view=units works:
            # total_units, available_units, availability_ratio, avg_price_czk,
            # min_price_czk, max_price_czk, avg_price_per_m2_czk, avg_floor_area_m2
            def _dec(val: Any) -> Any:
                if val is None:
                    return None
                if hasattr(val, "__float__"):
                    try:
                        return float(val)
                    except (TypeError, ValueError):
                        return val
                return val

            data["total_units"] = agg.total_units
            data["available_units"] = agg.available_units
            data["availability_ratio"] = _dec(agg.availability_ratio)
            data["avg_price_czk"] = _dec(agg.avg_price_czk)
            data["min_price_czk"] = agg.min_price_czk
            data["max_price_czk"] = agg.max_price_czk
            data["avg_price_per_m2_czk"] = _dec(agg.avg_price_per_m2_czk)
            data["avg_floor_area_m2"] = _dec(agg.avg_floor_area_m2)
            # Parking price aggregates
            data["min_parking_indoor_price_czk"] = agg.min_parking_indoor_price_czk
            data["max_parking_indoor_price_czk"] = agg.max_parking_indoor_price_czk
            data["min_parking_outdoor_price_czk"] = agg.min_parking_outdoor_price_czk
            data["max_parking_outdoor_price_czk"] = agg.max_parking_outdoor_price_czk
            # Time/status aggregates
            data["project_first_seen"] = agg.project_first_seen
            data["project_last_seen"] = agg.project_last_seen
            data["max_days_on_market"] = agg.max_days_on_market
            # Payment scheme aggregates
            data["min_payment_contract"] = _dec(agg.min_payment_contract)
            data["max_payment_contract"] = _dec(agg.max_payment_contract)
            data["min_payment_construction"] = _dec(agg.min_payment_construction)
            data["max_payment_construction"] = _dec(agg.max_payment_construction)
            data["min_payment_occupancy"] = _dec(agg.min_payment_occupancy)
            data["max_payment_occupancy"] = _dec(agg.max_payment_occupancy)
            d["data"] = data

        # Aplikovat project overrides – úpravy na stránce projektu se promítnou do všech jednotek
        apply_project_overrides_to_item(u.project_id, d["data"], project_override_map, attr_keyed=False)
        apply_project_overrides_to_item(u.project_id, d["project"], project_override_map, attr_keyed=True)

        items.append(UnitResponse.model_validate(d))

    return UnitsListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        average_price_czk=avg_price_czk,
        average_price_per_m2_czk=avg_price_per_m2_czk,
        available_count=available_count,
        average_local_price_diff_1000m=avg_local_1000,
        average_local_price_diff_2000m=avg_local_2000,
    )


# Sort keys: catalog keys (project entity) + aggregate keys returned by overview
ALLOWED_PROJECT_OVERVIEW_SORT_BY = frozenset({
    "id",
    "name",
    "developer",
    "address",
    "city",
    "municipality",
    "district",
    "postal_code",
    "cadastral_area_iga",
    "administrative_district_iga",
    "region_iga",
    "gps_latitude",
    "gps_longitude",
    "ride_to_center",
    "public_transport_to_center",
    "permit_regular",
    "renovation",
    "overall_quality",
    "windows",
    "heating",
    "partition_walls",
    "amenities",
    "project",  # alias for name
    "total_units",
    "available_units",
    "availability_ratio",
    "avg_price_czk",
    "avg_price_per_m2_czk",
    "min_price_czk",
    "max_price_czk",
    "avg_floor_area_m2",
    "min_parking_indoor_price_czk",
    "max_parking_indoor_price_czk",
    "min_parking_outdoor_price_czk",
    "max_parking_outdoor_price_czk",
    "project_first_seen",
    "project_last_seen",
    "max_days_on_market",
    "min_payment_contract",
    "max_payment_contract",
    "min_payment_construction",
    "max_payment_construction",
    "min_payment_occupancy",
    "max_payment_occupancy",
    "project_url",
    "noise_day_db",
    "noise_night_db",
    "noise_label",
    "distance_to_primary_road_m",
    "distance_to_tram_tracks_m",
    "distance_to_railway_m",
    "distance_to_airport_m",
    "micro_location_score",
    "micro_location_label",
    "walkability_score",
    "walkability_label",
})
ALLOWED_PROJECT_OVERVIEW_SORT_DIR = ("asc", "desc")


@app.get(
    "/projects/overview",
    response_model=ProjectsOverviewResponse,
    summary="Projects overview with aggregates (paginated)",
    description="Returns one row per project (grouped by id) with aggregated unit stats. Supports limit (100|300|500), offset, sort_by, sort_dir. Accepts same unit-level filter params as GET /units.",
)
def get_projects_overview(
    db: DbSession,
    limit: Annotated[int, Query(description="Page size (100, 300, or 500)")] = 100,
    offset: Annotated[int, Query(ge=0, description="Skip N projects")] = 0,
    sort_by: Annotated[
        str,
        Query(
            description="Sort column: name, developer, address, total_units, available_units, availability_ratio, avg_price_czk, avg_price_per_m2_czk, min_price_czk, max_price_czk, avg_floor_area_m2"
        ),
    ] = "avg_price_per_m2_czk",
    sort_dir: Annotated[str, Query(description="asc or desc")] = "asc",
    available: Annotated[bool | None, Query(description="Filter by available")] = None,
    min_price: Annotated[int | None, Query(ge=0)] = None,
    max_price: Annotated[int | None, Query(ge=0)] = None,
    min_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    max_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    layout: Annotated[list[str] | None, Query(description="Filter by layout (any of)")] = None,
    district: Annotated[list[str] | None, Query(description="Filter by district (any of)")] = None,
    heating: Annotated[list[str] | None, Query(description="Filter by heating (any of)")] = None,
    windows: Annotated[list[str] | None, Query(description="Filter by windows (any of)")] = None,
    permit_regular: Annotated[bool | None, Query(description="Filter by permit_regular")] = None,
    renovation: Annotated[bool | None, Query(description="Filter by renovation")] = None,
    air_conditioning: Annotated[bool | None, Query(description="Filter by air_conditioning")] = None,
    cooling_ceilings: Annotated[bool | None, Query(description="Filter by cooling_ceilings")] = None,
    smart_home: Annotated[bool | None, Query(description="Filter by smart_home")] = None,
    min_floor_area: Annotated[float | None, Query(ge=0)] = None,
    max_floor_area: Annotated[float | None, Query(ge=0)] = None,
    municipality: Annotated[list[str] | None, Query(description="Filter by municipality (any of)")] = None,
) -> ProjectsOverviewResponse:
    if limit not in (100, 300, 500):
        raise HTTPException(
            status_code=422,
            detail="limit must be one of 100, 300, 500",
        )
    if sort_by not in ALLOWED_PROJECT_OVERVIEW_SORT_BY:
        raise HTTPException(
            status_code=422,
            detail=f"sort_by must be one of: {sorted(ALLOWED_PROJECT_OVERVIEW_SORT_BY)}",
        )
    sort_dir = sort_dir.strip().lower() or "asc"
    if sort_dir not in ALLOWED_PROJECT_OVERVIEW_SORT_DIR:
        raise HTTPException(
            status_code=422,
            detail="sort_dir must be asc or desc",
        )

    base = _build_units_query(
        available=available,
        availability=None,
        min_price=min_price,
        max_price=max_price,
        min_price_per_m2=min_price_per_m2,
        max_price_per_m2=max_price_per_m2,
        layout=layout,
        district=district,
        municipality=municipality,
        heating=heating,
        windows=windows,
        permit_regular=permit_regular,
        renovation=renovation,
        air_conditioning=air_conditioning,
        cooling_ceilings=cooling_ceilings,
        smart_home=smart_home,
        min_floor_area=min_floor_area,
        max_floor_area=max_floor_area,
    )
    unit_subq = base.subquery()
    total_units_expr = func.count(unit_subq.c.id).label("total_units")
    available_units_expr = func.sum(
        case((unit_subq.c.available.is_(True), 1), else_=0)
    ).label("available_units")
    availability_ratio_expr = (
        func.sum(case((unit_subq.c.available.is_(True), 1), else_=0))
        / func.nullif(func.count(unit_subq.c.id), 0)
    ).label("availability_ratio")
    avg_price = func.avg(unit_subq.c.price_czk).label("avg_price_czk")
    avg_price_per_m2 = func.avg(unit_subq.c.price_per_m2_czk).label("avg_price_per_m2_czk")

    # All Project columns that we output (catalog keys map to these attrs)
    project_cols = [
        Project.id,
        Project.name,
        Project.developer,
        Project.address,
        Project.city,
        Project.municipality,
        Project.district,
        Project.postal_code,
        Project.cadastral_area_iga,
        Project.administrative_district_iga,
        Project.region_iga,
        Project.gps_latitude,
        Project.gps_longitude,
        Project.ride_to_center_min,
        Project.public_transport_to_center_min,
        Project.permit_regular,
        Project.renovation,
        Project.overall_quality,
        Project.windows,
        Project.heating,
        Project.partition_walls,
        Project.amenities,
        # Noise and micro-location (computed on Project)
        Project.noise_day_db,
        Project.noise_night_db,
        Project.noise_label,
        Project.distance_to_primary_road_m,
        Project.distance_to_tram_tracks_m,
        Project.distance_to_railway_m,
        Project.distance_to_airport_m,
        Project.micro_location_score,
        Project.micro_location_label,
        Project.walkability_score,
        Project.walkability_label,
        Project.walkability_daily_needs_score,
        Project.walkability_transport_score,
        Project.walkability_leisure_score,
        Project.walkability_family_score,
        # BuiltMind March 2026 fields
        Project.project_url,
        Project.completion_date,
        Project.construction_completion,
        Project.builtmind_project_id,
        Project.builtmind_developer_id,
    ]
    agg_stmt = (
        select(
            *project_cols,
            total_units_expr,
            available_units_expr,
            availability_ratio_expr,
            avg_price,
            avg_price_per_m2,
            func.min(unit_subq.c.price_czk).label("min_price_czk"),
            func.max(unit_subq.c.price_czk).label("max_price_czk"),
            func.avg(unit_subq.c.floor_area_m2).label("avg_floor_area_m2"),
            # Autem / MHD do centra (z jednotek)
            func.min(unit_subq.c.ride_to_center_min).label("min_ride_to_center_min"),
            func.avg(unit_subq.c.ride_to_center_min).label("avg_ride_to_center_min"),
            func.min(unit_subq.c.public_transport_to_center_min).label("min_public_transport_to_center_min"),
            func.avg(unit_subq.c.public_transport_to_center_min).label("avg_public_transport_to_center_min"),
            # Parking price aggregates
            func.min(unit_subq.c.parking_indoor_price_czk).label("min_parking_indoor_price_czk"),
            func.max(unit_subq.c.parking_indoor_price_czk).label("max_parking_indoor_price_czk"),
            func.min(unit_subq.c.parking_outdoor_price_czk).label("min_parking_outdoor_price_czk"),
            func.max(unit_subq.c.parking_outdoor_price_czk).label("max_parking_outdoor_price_czk"),
            # Project-level time/status aggregates from units
            func.min(unit_subq.c.first_seen).label("project_first_seen"),
            func.max(unit_subq.c.last_seen).label("project_last_seen"),
            func.max(unit_subq.c.days_on_market).label("max_days_on_market"),
            # Payment scheme aggregates (fractions 0–1)
            func.min(unit_subq.c.payment_contract).label("min_payment_contract"),
            func.max(unit_subq.c.payment_contract).label("max_payment_contract"),
            func.min(unit_subq.c.payment_construction).label("min_payment_construction"),
            func.max(unit_subq.c.payment_construction).label("max_payment_construction"),
            func.min(unit_subq.c.payment_occupancy).label("min_payment_occupancy"),
            func.max(unit_subq.c.payment_occupancy).label("max_payment_occupancy"),
            func.max(unit_subq.c.sold_date).label("sold_date"),
            # Derived total floors (max unit floor)
            func.max(unit_subq.c.floor).label("derived_total_floors"),
        )
        .select_from(unit_subq)
        .join(Project, unit_subq.c.project_id == Project.id)
        .group_by(*project_cols)
    )
    agg_subq = agg_stmt.subquery()

    total = db.execute(select(func.count()).select_from(agg_subq)).scalar_one()

    # sort_by is catalog key; agg_subq uses DB attr names (e.g. ride_to_center_min)
    _sort_col_map = {"ride_to_center": "ride_to_center_min", "public_transport_to_center": "public_transport_to_center_min", "project": "name"}
    sort_col_name = _sort_col_map.get(sort_by, sort_by)
    sort_column = agg_subq.c[sort_col_name]
    order_fn = asc if sort_dir == "asc" else desc
    order_clause = order_fn(sort_column).nulls_last()
    stmt = (
        select(agg_subq)
        .order_by(order_clause, agg_subq.c.id.asc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.execute(stmt).all()

    # Load project-level overrides for all projects in this page
    project_ids = [ (row._mapping["id"] if hasattr(row, "_mapping") else row.id) for row in rows ]
    override_rows: list[ProjectOverride] = []
    if project_ids:
        override_rows = (
            db.execute(
                select(ProjectOverride).where(
                    ProjectOverride.project_id.in_(project_ids),
                    ProjectOverride.field.in_(PROJECT_OVERRIDEABLE_FIELDS),
                )
            )
            .scalars()
            .all()
        )
    project_override_map = build_project_override_map(override_rows)

    def _dec(v: Any) -> Any:
        if v is None:
            return None
        if hasattr(v, "__float__"):
            try:
                return float(v)
            except (TypeError, ValueError):
                return v
        return v

    # Build items with keys matching /columns?view=projects accessors (DB attr names:
    # ride_to_center_min, public_transport_to_center_min, name, municipality, etc.)
    result = []
    for row in rows:
        r = row._mapping if hasattr(row, "_mapping") else row
        item: dict[str, Any] = {}
        seen_attrs: set[str] = set()
        for _catalog_key, attr in PROJECT_CATALOG_TO_ATTR.items():
            if attr in seen_attrs:
                continue
            seen_attrs.add(attr)
            if attr in r:
                val = r[attr]
                item[attr] = _dec(val) if val is not None and hasattr(val, "__float__") else val
            else:
                item[attr] = None
        item["id"] = r.get("id")
        item["builtmind_project_id"] = r.get("builtmind_project_id")
        item["builtmind_developer_id"] = r.get("builtmind_developer_id")
        total_units = r.get("total_units") or 0
        available_units = int(r.get("available_units") or 0)
        av_ratio = r.get("availability_ratio")
        if av_ratio is not None:
            try:
                item["availability_ratio"] = float(av_ratio)
            except (TypeError, ValueError):
                item["availability_ratio"] = (available_units / total_units) if total_units else 0.0
        else:
            item["availability_ratio"] = (available_units / total_units) if total_units else 0.0
        item["total_units"] = total_units
        item["available_units"] = available_units
        item["avg_price_czk"] = _dec(r.get("avg_price_czk"))
        item["avg_price_per_m2_czk"] = _dec(r.get("avg_price_per_m2_czk"))
        item["min_price_czk"] = int(r["min_price_czk"]) if r.get("min_price_czk") is not None else None
        item["max_price_czk"] = int(r["max_price_czk"]) if r.get("max_price_czk") is not None else None
        item["avg_floor_area_m2"] = _dec(r.get("avg_floor_area_m2"))
        # Parking price aggregates
        item["min_parking_indoor_price_czk"] = (
            int(r["min_parking_indoor_price_czk"])
            if r.get("min_parking_indoor_price_czk") is not None
            else None
        )
        item["max_parking_indoor_price_czk"] = (
            int(r["max_parking_indoor_price_czk"])
            if r.get("max_parking_indoor_price_czk") is not None
            else None
        )
        item["min_parking_outdoor_price_czk"] = (
            int(r["min_parking_outdoor_price_czk"])
            if r.get("min_parking_outdoor_price_czk") is not None
            else None
        )
        item["max_parking_outdoor_price_czk"] = (
            int(r["max_parking_outdoor_price_czk"])
            if r.get("max_parking_outdoor_price_czk") is not None
            else None
        )
        # Project-level time/status aggregates
        item["project_first_seen"] = r.get("project_first_seen")
        item["project_last_seen"] = r.get("project_last_seen")
        item["max_days_on_market"] = (
            int(r["max_days_on_market"]) if r.get("max_days_on_market") is not None else None
        )
        # Derived total floors from units
        v_dtf = r.get("derived_total_floors")
        item["derived_total_floors"] = int(v_dtf) if v_dtf is not None else None
        # Payment scheme aggregates (fractions 0–1).
        # Keep raw min/max for potential debugging, but expose single-value
        # payment_* fields that are easier to work with in the UI.
        min_pay_contract = _dec(r.get("min_payment_contract"))
        max_pay_contract = _dec(r.get("max_payment_contract"))
        min_pay_construction = _dec(r.get("min_payment_construction"))
        max_pay_construction = _dec(r.get("max_payment_construction"))
        min_pay_occupancy = _dec(r.get("min_payment_occupancy"))
        max_pay_occupancy = _dec(r.get("max_payment_occupancy"))

        def _financing_or_none(v: Any) -> Any:
            if v is None or (isinstance(v, (int, float)) and v == 0):
                return None
            return float(v) if isinstance(v, Decimal) else v

        item["min_payment_contract"] = _financing_or_none(min_pay_contract)
        item["max_payment_contract"] = _financing_or_none(max_pay_contract)
        item["min_payment_construction"] = _financing_or_none(min_pay_construction)
        item["max_payment_construction"] = _financing_or_none(max_pay_construction)
        item["min_payment_occupancy"] = _financing_or_none(min_pay_occupancy)
        item["max_payment_occupancy"] = _financing_or_none(max_pay_occupancy)

        def _first_non_none(a: Any, b: Any) -> Any:
            return a if a is not None else b

        item["payment_contract"] = _first_non_none(
            _financing_or_none(min_pay_contract), _financing_or_none(max_pay_contract)
        )
        item["payment_construction"] = _first_non_none(
            _financing_or_none(min_pay_construction), _financing_or_none(max_pay_construction)
        )
        item["payment_occupancy"] = _first_non_none(
            _financing_or_none(min_pay_occupancy), _financing_or_none(max_pay_occupancy)
        )
        # Jedna hodnota „Autem do centra" / „MHD do centra" (klíč ride_to_center / public_transport_to_center)
        if item.get("ride_to_center_min") is None and r.get("avg_ride_to_center_min") is not None:
            item["ride_to_center_min"] = _dec(r["avg_ride_to_center_min"])
        if item.get("public_transport_to_center_min") is None and r.get("avg_public_transport_to_center_min") is not None:
            item["public_transport_to_center_min"] = _dec(r["avg_public_transport_to_center_min"])
        item["ride_to_center"] = item.get("ride_to_center_min")
        item["public_transport_to_center"] = item.get("public_transport_to_center_min")
        apply_project_overrides_to_item(
            project_id=item["id"],
            item=item,
            override_map=project_override_map,
            attr_keyed=True,
        )
        result.append(item)
    return ProjectsOverviewResponse(items=result, total=total, limit=limit, offset=offset)


@app.get(
    "/projects/filters",
    summary="Project list filter metadata",
    description="Filter definitions for project list (same unit-level filters as GET /filters; applied when aggregating units by project).",
)
def get_projects_filters(db: DbSession):
    return get_filter_groups(db)


def _equiv_price_per_m2_sql():
    """SQL expression for equivalent price per m² with degressive exterior weighting.

    Bands: 0-10m² × 0.50, 10-50m² × 0.33, 50-100m² × 0.20, 100+m² × 0.10
    """
    ext = func.coalesce(Unit.exterior_area_m2, 0)
    weighted_ext = (
        func.least(ext, 10) * 0.50
        + func.greatest(func.least(ext, 50) - 10, 0) * 0.33
        + func.greatest(func.least(ext, 100) - 50, 0) * 0.20
        + func.greatest(ext - 100, 0) * 0.10
    )
    equiv_area = Unit.floor_area_m2 + weighted_ext
    return (Unit.price_czk / func.nullif(equiv_area, 0)).cast(sa.Integer)


def _project_agg_cached_subquery():
    """Cached varianta `_project_agg_subquery` — čte z předpočítané tabulky
    `project_aggregates` (refreshovaná denním ops_runnerem v 5:00 CEST a
    automaticky po každém unit override skrz AGGREGATE_AFFECTING_FIELDS hook).

    Vrací stejné aliasy jako live subquery (units_total, units_available,
    avg_price_per_m2_czk, sold_date, project_first_seen…) — drop-in
    replacement pro hot-path WHERE/ORDER BY v list_projects a list_units.

    Co tu chybí oproti live subquery:
      - units_reserved, median_*, layouts, project_gps_*, derived_total_floors
        (kromě derived_total_floors, který v cache je) — používá se jen v
        map mode response, ne pro filter/sort, takže tam zůstává live cesta.

    Trade-off: data jsou freshná po overrideu (hook) nebo po nightly run.
    Manual import bez recompute by zobrazoval stará čísla — proto ops_runner
    recompute volá automaticky po každém imports kroku.
    """
    from .models import ProjectAggregates as PA

    return (
        select(
            PA.project_id.label("project_id"),
            PA.total_units.label("units_total"),
            PA.available_units.label("units_available"),
            PA.availability_ratio.label("availability_ratio"),
            PA.min_price_czk.label("min_price_czk"),
            PA.avg_price_czk.label("avg_price_czk"),
            PA.max_price_czk.label("max_price_czk"),
            PA.avg_price_per_m2_czk.label("avg_price_per_m2_czk"),
            PA.avg_floor_area_m2.label("avg_floor_area_m2"),
            PA.min_parking_indoor_price_czk.label("min_parking_indoor_price_czk"),
            PA.max_parking_indoor_price_czk.label("max_parking_indoor_price_czk"),
            PA.min_parking_outdoor_price_czk.label("min_parking_outdoor_price_czk"),
            PA.max_parking_outdoor_price_czk.label("max_parking_outdoor_price_czk"),
            PA.project_first_seen.label("project_first_seen"),
            PA.project_last_seen.label("project_last_seen"),
            PA.max_days_on_market.label("max_days_on_market"),
            PA.min_payment_contract.label("min_payment_contract"),
            PA.max_payment_contract.label("max_payment_contract"),
            PA.min_payment_construction.label("min_payment_construction"),
            PA.max_payment_construction.label("max_payment_construction"),
            PA.min_payment_occupancy.label("min_payment_occupancy"),
            PA.max_payment_occupancy.label("max_payment_occupancy"),
            PA.derived_total_floors.label("derived_total_floors"),
            PA.sold_date.label("sold_date"),
        )
        .subquery()
    )


def _project_agg_subquery():
    """Subquery: project_id + all computed aggregates from Unit. Group by project_id."""
    units_available = func.sum(case((Unit.available.is_(True), 1), else_=0)).label("units_available")
    units_reserved = func.sum(
        case((func.lower(Unit.availability_status) == "reserved", 1), else_=0)
    ).label("units_reserved")
    units_priced = func.sum(case((Unit.price_czk.isnot(None), 1), else_=0)).label("units_priced")
    units_total = func.count(Unit.id).label("units_total")
    availability_ratio_expr = (
        func.sum(case((Unit.available.is_(True), 1), else_=0)) / func.nullif(func.count(Unit.id), 0)
    ).label("availability_ratio")
    median_pm2 = func.percentile_cont(0.5).within_group(Unit.price_per_m2_czk.asc()).label(
        "median_price_per_m2_czk"
    )
    median_ride = func.percentile_cont(0.5).within_group(Unit.ride_to_center_min.asc()).label(
        "median_ride_to_center_min"
    )
    median_pt = func.percentile_cont(0.5).within_group(
        Unit.public_transport_to_center_min.asc()
    ).label("median_public_transport_to_center_min")
    layouts = func.array_agg(Unit.layout).filter(Unit.layout.isnot(None)).label("layouts_present_raw")
    # max_days_on_market: BuiltMind sometimes leaves Unit.days_on_market NULL on
    # brand-new units. Without a fallback those projects sort to the very end of
    # /projects by 'Dní na trhu' even though they are the freshest. Coalesce to
    # the gap between today and the project's earliest first_seen so we always
    # have a meaningful value.
    max_days_on_market_expr = func.coalesce(
        func.max(Unit.days_on_market),
        func.current_date() - func.min(Unit.first_seen),
    ).label("max_days_on_market")
    return (
        select(
            Unit.project_id,
            units_total,
            units_available,
            availability_ratio_expr,
            units_reserved,
            units_priced,
            func.min(Unit.price_czk).label("min_price_czk"),
            func.avg(Unit.price_czk).label("avg_price_czk"),
            func.max(Unit.price_czk).label("max_price_czk"),
            func.min(Unit.price_per_m2_czk).label("min_price_per_m2_czk"),
            func.avg(Unit.price_per_m2_czk).label("avg_price_per_m2_czk"),
            func.max(Unit.price_per_m2_czk).label("max_price_per_m2_czk"),
            median_pm2,
            func.min(Unit.ride_to_center_min).label("min_ride_to_center_min"),
            func.avg(Unit.ride_to_center_min).label("avg_ride_to_center_min"),
            median_ride,
            func.min(Unit.public_transport_to_center_min).label(
                "min_public_transport_to_center_min"
            ),
            func.avg(Unit.public_transport_to_center_min).label(
                "avg_public_transport_to_center_min"
            ),
            median_pt,
            func.avg(Unit.floor_area_m2).label("avg_floor_area_m2"),
            # Parking price aggregates (Kč)
            func.min(Unit.parking_indoor_price_czk).label("min_parking_indoor_price_czk"),
            func.max(Unit.parking_indoor_price_czk).label("max_parking_indoor_price_czk"),
            func.min(Unit.parking_outdoor_price_czk).label("min_parking_outdoor_price_czk"),
            func.max(Unit.parking_outdoor_price_czk).label("max_parking_outdoor_price_czk"),
            # Time / status
            func.min(Unit.first_seen).label("project_first_seen"),
            func.max(Unit.last_seen).label("project_last_seen"),
            max_days_on_market_expr,
            # Financing (fractions 0–1)
            func.min(Unit.payment_contract).label("min_payment_contract"),
            func.max(Unit.payment_contract).label("max_payment_contract"),
            func.min(Unit.payment_construction).label("min_payment_construction"),
            func.max(Unit.payment_construction).label("max_payment_construction"),
            func.min(Unit.payment_occupancy).label("min_payment_occupancy"),
            func.max(Unit.payment_occupancy).label("max_payment_occupancy"),
            func.max(Unit.sold_date).label("sold_date"),
            # Derived total floors (max unit floor)
            func.max(Unit.floor).label("derived_total_floors"),
            # Fallback GPS pro projekty – průměrná poloha jednotek v projektu
            func.avg(Unit.gps_latitude).label("project_gps_latitude"),
            func.avg(Unit.gps_longitude).label("project_gps_longitude"),
            layouts,
            # Standardy z jednotek (reprezentativní hodnota pro projekt)
            func.max(Unit.category).label("sample_category"),
            func.max(Unit.floors).label("sample_floors"),
            func.max(case((Unit.air_conditioning.is_(True), 1), else_=0)).label("sample_air_conditioning"),
            func.max(case((Unit.cooling_ceilings.is_(True), 1), else_=0)).label("sample_cooling_ceilings"),
            func.max(Unit.exterior_blinds).label("sample_exterior_blinds"),
            func.max(case((Unit.smart_home.is_(True), 1), else_=0)).label("sample_smart_home"),
        )
        .group_by(Unit.project_id)
        .subquery()
    )


def _project_row_to_item(project: Project, row: Any) -> dict[str, Any]:
    """Build one project item dict: id, catalog keys (from Project), computed keys."""
    out: dict[str, Any] = {"id": project.id}
    # Sloupec „Projekt" má v get_columns accessor „name" (z CATALOG_TO_DB), takže musíme vracet i name
    out["name"] = getattr(project, "name", None)
    # BuiltMind identifiers — not in display catalog but useful for debugging / frontend cross-referencing
    out["builtmind_project_id"] = getattr(project, "builtmind_project_id", None)
    out["builtmind_developer_id"] = getattr(project, "builtmind_developer_id", None)
    catalog_cols = get_project_columns()
    for col in catalog_cols:
        key = col["key"]
        attr = PROJECT_CATALOG_TO_ATTR.get(key)
        if attr and hasattr(project, attr):
            val = getattr(project, attr)
            if isinstance(val, Decimal):
                out[key] = float(val) if val is not None else None
            elif hasattr(val, "isoformat"):
                out[key] = val.isoformat() if val else None
            else:
                out[key] = val
        else:
            out[key] = None

    # Pole na projektu, která nejsou v katalogu (Entity=Projekt) – např. heating je v CSV u Jednotky
    if out.get("heating") is None and hasattr(project, "heating"):
        out["heating"] = getattr(project, "heating", None)

    # Agregovaná data: select(Project, agg_subq) vrací Row. V SQLAlchemy 2 _mapping obsahuje
    # sloupce z obou (Project + subquery s labely units_total, units_available, ...).
    agg = getattr(row, "_mapping", {}) or {}
    if not agg or "units_total" not in agg:
        if hasattr(row, "__len__") and len(row) > 1 and row[1] is not None:
            subq = getattr(row[1], "_mapping", {}) or {}
            if subq:
                agg = subq

    # Fallback GPS: pokud projekt sám nemá gps_latitude/longitude,
    # použij průměrnou polohu jednotek z agregátu.
    lat_agg = agg.get("project_gps_latitude")
    lon_agg = agg.get("project_gps_longitude")
    if out.get("gps_latitude") is None and lat_agg is not None:
        out["gps_latitude"] = float(lat_agg) if isinstance(lat_agg, Decimal) else lat_agg
    if out.get("gps_longitude") is None and lon_agg is not None:
        out["gps_longitude"] = float(lon_agg) if isinstance(lon_agg, Decimal) else lon_agg
    units_total = agg.get("units_total") or 0
    units_available = int(agg.get("units_available") or 0)
    units_reserved = int(agg.get("units_reserved") or 0)
    out["units_total"] = units_total
    out["units_available"] = units_available
    out["total_units"] = units_total  # frontend/column_catalog expects total_units
    out["available_units"] = units_available  # frontend/column_catalog expects available_units
    out["units_reserved"] = units_reserved
    out["units_priced"] = int(agg.get("units_priced") or 0)

    # Core aggregate metrics (včetně cen parkování)
    for k in (
        "min_price_czk",
        "avg_price_czk",
        "max_price_czk",
        "min_price_per_m2_czk",
        "avg_price_per_m2_czk",
        "max_price_per_m2_czk",
        "median_price_per_m2_czk",
        "min_ride_to_center_min",
        "avg_ride_to_center_min",
        "median_ride_to_center_min",
        "min_public_transport_to_center_min",
        "avg_public_transport_to_center_min",
        "median_public_transport_to_center_min",
        "avg_floor_area_m2",
        "min_parking_indoor_price_czk",
        "max_parking_indoor_price_czk",
        "min_parking_outdoor_price_czk",
        "max_parking_outdoor_price_czk",
    ):
        v = agg.get(k)
        if v is None:
            out[k] = None
        elif isinstance(v, Decimal):
            out[k] = float(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v

    # Jedna hodnota „Autem do centra" / „MHD do centra": klíč ride_to_center / public_transport_to_center.
    # Projekt je často nemá; doplníme z agregátu jednotek (průměr).
    if out.get("ride_to_center_min") is None and agg.get("avg_ride_to_center_min") is not None:
        v = agg["avg_ride_to_center_min"]
        out["ride_to_center_min"] = float(v) if isinstance(v, Decimal) else v
    if out.get("public_transport_to_center_min") is None and agg.get("avg_public_transport_to_center_min") is not None:
        v = agg["avg_public_transport_to_center_min"]
        out["public_transport_to_center_min"] = float(v) if isinstance(v, Decimal) else v
    out["ride_to_center"] = out.get("ride_to_center_min")
    out["public_transport_to_center"] = out.get("public_transport_to_center_min")

    # Časové údaje z agregátu (field_catalog: project_first_seen, project_last_seen, max_days_on_market)
    out["project_first_seen"] = agg.get("project_first_seen")
    if out["project_first_seen"] is not None and hasattr(out["project_first_seen"], "isoformat"):
        out["project_first_seen"] = out["project_first_seen"].isoformat()
    out["project_last_seen"] = agg.get("project_last_seen")
    if out["project_last_seen"] is not None and hasattr(out["project_last_seen"], "isoformat"):
        out["project_last_seen"] = out["project_last_seen"].isoformat()
    v_days = agg.get("max_days_on_market")
    out["max_days_on_market"] = int(v_days) if v_days is not None else None

    # Derived total floors from units
    v_floors = agg.get("derived_total_floors")
    out["derived_total_floors"] = int(v_floors) if v_floors is not None else None

    # Derived single-value financing fields (per project). 0 = nevyplněno, vracíme None.
    def _first_non_none(a, b):
        return a if a is not None else b

    def _financing_or_none(val: Any) -> float | None:
        if val is None or (isinstance(val, (int, float)) and val == 0):
            return None
        if isinstance(val, Decimal):
            return float(val)
        return val

    pay_contract = _first_non_none(agg.get("min_payment_contract"), agg.get("max_payment_contract"))
    out["payment_contract"] = _financing_or_none(pay_contract)

    pay_construction = _first_non_none(agg.get("min_payment_construction"), agg.get("max_payment_construction"))
    out["payment_construction"] = _financing_or_none(pay_construction)

    pay_occupancy = _first_non_none(agg.get("min_payment_occupancy"), agg.get("max_payment_occupancy"))
    out["payment_occupancy"] = _financing_or_none(pay_occupancy)

    out["available_ratio"] = (
        (units_available / units_total) if units_total else 0.0
    )
    out["availability_ratio"] = out["available_ratio"]  # frontend expects availability_ratio
    out["project"] = getattr(project, "name", None)  # frontend column "project" (název projektu)

    # Standardy z jednotek (reprezentativní hodnota) – chceme je brát z agregátů,
    # aby přehled projektu byl konzistentní s tím, co vidíme na jednotkách.
    # Projektové sloupce (Project.heating atd.) používáme jen tam, kde nemáme
    # žádnou informaci z jednotek; overrides zůstávají zachovány (aplikují se později).

    # Kategorie a podlaha – textové hodnoty
    v = agg.get("sample_category")
    if v is not None:
        out["category"] = str(v)
    v = agg.get("sample_floors")
    if v is not None:
        out["floors"] = str(v)

    # Klimatizace / chlazení / smart home – z agregátu bereme jen "Ano", nikdy "Ne".
    # sample_* je 1, pokud aspoň jedna jednotka má True; 0 jinak.
    v = agg.get("sample_air_conditioning")
    if v is not None:
        out["air_conditioning"] = bool(v) if int(v or 0) == 1 else None
    v = agg.get("sample_cooling_ceilings")
    if v is not None:
        out["cooling_ceilings"] = bool(v) if int(v or 0) == 1 else None
    v = agg.get("sample_smart_home")
    if v is not None:
        out["smart_home"] = bool(v) if int(v or 0) == 1 else None

    # Žaluzie – textová hodnota přímo ze sample_exterior_blinds (true/false/preparation/…)
    sample_blinds = agg.get("sample_exterior_blinds")
    if sample_blinds is not None:
        out["exterior_blinds"] = sample_blinds

    raw_layouts = agg.get("layouts_present_raw")
    if raw_layouts is not None and isinstance(raw_layouts, (list, tuple)):
        out["layouts_present"] = list(dict.fromkeys(x for x in raw_layouts if x is not None))
    else:
        out["layouts_present"] = []
    return out


def _projects_base_select(agg_subq):
    """Select Project + aggregate columns from Project left join agg_subq."""
    return (
        select(Project, agg_subq)
        .select_from(Project)
        .outerjoin(agg_subq, Project.id == agg_subq.c.project_id)
    )


# Sloupce, které jsou jen v agregátu (ne na Project) – řadíme podle agg_subq.c[...]
_AGG_ONLY_SORT_KEYS = frozenset({
    "min_parking_indoor_price_czk",
    "max_parking_indoor_price_czk",
    "min_parking_outdoor_price_czk",
    "max_parking_outdoor_price_czk",
    "project_first_seen",
    "project_last_seen",
    "max_days_on_market",
})


def _projects_order_clause(agg_subq, sort_by: str, sort_dir: str):
    """Order by expression for sort_by (catalog or computed key)."""
    allowed = get_projects_sort_keys()
    if sort_by not in allowed:
        return None
    dir_asc = sort_dir.strip().lower() != "desc"
    # Speciální case: řazení podle sloupců z agregátu (jiný název než v subdotazu).
    if sort_by == "project_url":
        col = Project.project_url
    elif sort_by == "availability_ratio":
        col = agg_subq.c.availability_ratio
    elif sort_by == "available_units":
        col = agg_subq.c.units_available
    elif sort_by == "total_units":
        col = agg_subq.c.units_total
    elif sort_by == "name" or sort_by == "project":
        col = Project.name
    elif sort_by in _AGG_ONLY_SORT_KEYS or sort_by in COMPUTED_COLUMN_KEYS:
        col = agg_subq.c[sort_by]
    else:
        attr = PROJECT_CATALOG_TO_ATTR.get(sort_by)
        if attr and hasattr(Project, attr):
            col = getattr(Project, attr)
        else:
            col = getattr(Project, sort_by, None)
    if col is None:
        return None
    return asc(col) if dir_asc else desc(col)


def _has_unit_filters(
    available,
    availability,
    min_price,
    max_price,
    min_price_change,
    max_price_change,
    min_original_price,
    max_original_price,
    min_original_price_per_m2,
    max_original_price_per_m2,
    min_price_per_m2,
    max_price_per_m2,
    layout,
    district,
    municipality,
    heating,
    windows,
    permit_regular,
    renovation,
    air_conditioning,
    cooling_ceilings,
    smart_home,
    exterior_blinds,
    min_floor_area,
    max_floor_area,
    min_total_area,
    max_total_area,
    min_exterior_area,
    max_exterior_area,
    min_balcony_area,
    max_balcony_area,
    min_terrace_area,
    max_terrace_area,
    min_garden_area,
    max_garden_area,
    min_days_on_market,
    max_days_on_market,
    min_floor,
    max_floor,
    orientation,
    category,
    overall_quality,
    partition_walls,
    recuperation,
    city,
    cadastral_area_iga,
    municipal_district_iga,
    administrative_district_iga,
    region_iga,
    developer,
    building,
    project,
    min_latitude,
    max_latitude,
    min_longitude,
    max_longitude,
    min_ride_to_center_min,
    max_ride_to_center_min,
    min_public_transport_to_center_min,
    max_public_transport_to_center_min,
    min_payment_contract,
    max_payment_contract,
    min_payment_construction,
    max_payment_construction,
    min_payment_occupancy,
    max_payment_occupancy,
    max_distance_to_metro_station_m=None,
    max_distance_to_tram_stop_m=None,
    max_distance_to_bus_stop_m=None,
    max_distance_to_train_station_m=None,
):
    """True if any unit-level filter is set (so we restrict projects to those that have matching units)."""
    if available is not None:
        return True
    if availability and len(availability) > 0:
        return True
    if min_price is not None or max_price is not None:
        return True
    if min_price_change is not None or max_price_change is not None:
        return True
    if min_original_price is not None or max_original_price is not None:
        return True
    if min_original_price_per_m2 is not None or max_original_price_per_m2 is not None:
        return True
    if min_price_per_m2 is not None or max_price_per_m2 is not None:
        return True
    if layout and len(layout) > 0:
        return True
    if district and len(district) > 0:
        return True
    if municipality and len(municipality) > 0:
        return True
    if heating and len(heating) > 0:
        return True
    if windows and len(windows) > 0:
        return True
    if permit_regular is not None:
        return True
    if renovation is not None:
        return True
    if air_conditioning is not None:
        return True
    if cooling_ceilings is not None:
        return True
    if smart_home is not None:
        return True
    if exterior_blinds is not None:
        return True
    if min_floor_area is not None or max_floor_area is not None:
        return True
    if min_total_area is not None or max_total_area is not None:
        return True
    if min_exterior_area is not None or max_exterior_area is not None:
        return True
    if min_balcony_area is not None or max_balcony_area is not None:
        return True
    if min_terrace_area is not None or max_terrace_area is not None:
        return True
    if min_garden_area is not None or max_garden_area is not None:
        return True
    if min_days_on_market is not None or max_days_on_market is not None:
        return True
    if min_floor is not None or max_floor is not None:
        return True
    if orientation and len(orientation) > 0:
        return True
    if category and len(category) > 0:
        return True
    if overall_quality and len(overall_quality) > 0:
        return True
    if partition_walls and len(partition_walls) > 0:
        return True
    if recuperation and len(recuperation) > 0:
        return True
    if city and len(city) > 0:
        return True
    if cadastral_area_iga and len(cadastral_area_iga) > 0:
        return True
    if municipal_district_iga and len(municipal_district_iga) > 0:
        return True
    if administrative_district_iga and len(administrative_district_iga) > 0:
        return True
    if region_iga and len(region_iga) > 0:
        return True
    if developer and len(developer) > 0:
        return True
    if building and len(building) > 0:
        return True
    if project and len(project) > 0:
        return True
    if min_latitude is not None or max_latitude is not None or min_longitude is not None or max_longitude is not None:
        return True
    if min_ride_to_center_min is not None or max_ride_to_center_min is not None:
        return True
    if min_public_transport_to_center_min is not None or max_public_transport_to_center_min is not None:
        return True
    if min_payment_contract is not None or max_payment_contract is not None:
        return True
    if min_payment_construction is not None or max_payment_construction is not None:
        return True
    if min_payment_occupancy is not None or max_payment_occupancy is not None:
        return True
    if (
        max_distance_to_metro_station_m is not None
        or max_distance_to_tram_stop_m is not None
        or max_distance_to_bus_stop_m is not None
        or max_distance_to_train_station_m is not None
    ):
        return True
    return False


@app.get(
    "/projects",
    response_model=ProjectsListResponse,
    summary="List projects (catalog + computed)",
    description="Paginated list of projects. Accepts same unit filters as GET /units; only projects that have at least one unit matching those filters are returned. Supports q (search), sort_by, sort_dir, limit, offset.",
)
def list_projects(
    db: DbSession,
    q: Annotated[str | None, Query(description="Search in name, developer, address")] = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_archived: Annotated[bool, Query(description="Include fully sold projects older than 6 months")] = False,
    with_count: Annotated[bool, Query(description="Compute total row count. Skip for map/scroll views to halve query time.")] = True,
    mode: Annotated[str, Query(description="Response shape. 'full' = all catalog + computed fields. 'map' = id, name, location, gps, units_available/reserved, avg_price — ~10× smaller payload, ~50% faster query.")] = "full",
    sort_by: Annotated[str, Query(description="Sort column key (catalog or computed)")] = "avg_price_per_m2_czk",
    sort_dir: Annotated[str, Query(description="asc or desc")] = "asc",
    min_latitude: Annotated[float | None, Query(description="Filter by Project.gps_latitude >= value")] = None,
    max_latitude: Annotated[float | None, Query(description="Filter by Project.gps_latitude <= value")] = None,
    min_longitude: Annotated[float | None, Query(description="Filter by Project.gps_longitude >= value")] = None,
    max_longitude: Annotated[float | None, Query(description="Filter by Project.gps_longitude <= value")] = None,
    # Unit-level filters: only projects that have at least one unit matching these are returned
    available: Annotated[bool | None, Query(description="Filter projects by units with available=")] = None,
    availability: Annotated[list[str] | None, Query(description="Filter by unit availability_status (any of)")] = None,
    min_price: Annotated[int | None, Query(ge=0)] = None,
    max_price: Annotated[int | None, Query(ge=0)] = None,
    min_price_change: Annotated[float | None, Query()] = None,
    max_price_change: Annotated[float | None, Query()] = None,
    min_original_price: Annotated[int | None, Query(ge=0)] = None,
    max_original_price: Annotated[int | None, Query(ge=0)] = None,
    min_original_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    max_original_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    min_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    max_price_per_m2: Annotated[int | None, Query(ge=0)] = None,
    layout: Annotated[list[str] | None, Query(description="Filter by unit layout (any of)")] = None,
    district: Annotated[list[str] | None, Query()] = None,
    municipality: Annotated[list[str] | None, Query()] = None,
    heating: Annotated[list[str] | None, Query()] = None,
    windows: Annotated[list[str] | None, Query()] = None,
    permit_regular: Annotated[bool | None, Query()] = None,
    renovation: Annotated[bool | None, Query()] = None,
    air_conditioning: Annotated[bool | None, Query()] = None,
    cooling_ceilings: Annotated[bool | None, Query()] = None,
    smart_home: Annotated[bool | None, Query()] = None,
    min_floor_area: Annotated[float | None, Query(ge=0)] = None,
    max_floor_area: Annotated[float | None, Query(ge=0)] = None,
    min_total_area: Annotated[float | None, Query(ge=0)] = None,
    max_total_area: Annotated[float | None, Query(ge=0)] = None,
    min_exterior_area: Annotated[float | None, Query(ge=0)] = None,
    max_exterior_area: Annotated[float | None, Query(ge=0)] = None,
    min_balcony_area: Annotated[float | None, Query(ge=0)] = None,
    max_balcony_area: Annotated[float | None, Query(ge=0)] = None,
    min_terrace_area: Annotated[float | None, Query(ge=0)] = None,
    max_terrace_area: Annotated[float | None, Query(ge=0)] = None,
    min_garden_area: Annotated[float | None, Query(ge=0)] = None,
    max_garden_area: Annotated[float | None, Query(ge=0)] = None,
    min_days_on_market: Annotated[int | None, Query(ge=0)] = None,
    max_days_on_market: Annotated[int | None, Query(ge=0)] = None,
    min_floor: Annotated[int | None, Query()] = None,
    max_floor: Annotated[int | None, Query()] = None,
    orientation: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    overall_quality: Annotated[list[str] | None, Query()] = None,
    partition_walls: Annotated[list[str] | None, Query()] = None,
    recuperation: Annotated[list[str] | None, Query(description="Filter by recuperation (true/false/unknown)")] = None,
    city: Annotated[list[str] | None, Query()] = None,
    cadastral_area_iga: Annotated[list[str] | None, Query()] = None,
    municipal_district_iga: Annotated[list[str] | None, Query()] = None,
    administrative_district_iga: Annotated[list[str] | None, Query()] = None,
    region_iga: Annotated[list[str] | None, Query()] = None,
    developer: Annotated[list[str] | None, Query()] = None,
    building: Annotated[list[str] | None, Query()] = None,
    project: Annotated[list[str] | None, Query(description="Filter by project name (any of)")] = None,
    exterior_blinds: Annotated[str | None, Query(description="Filter by exterior_blinds (true/false/preparation)")] = None,
    min_ride_to_center_min: Annotated[float | None, Query(ge=0)] = None,
    max_ride_to_center_min: Annotated[float | None, Query(ge=0)] = None,
    min_public_transport_to_center_min: Annotated[float | None, Query(ge=0)] = None,
    max_public_transport_to_center_min: Annotated[float | None, Query(ge=0)] = None,
    min_payment_contract: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_payment_contract: Annotated[float | None, Query(ge=0, le=1)] = None,
    min_payment_construction: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_payment_construction: Annotated[float | None, Query(ge=0, le=1)] = None,
    min_payment_occupancy: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_payment_occupancy: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_distance_to_metro_station_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_metro_station_m <= value (m)")] = None,
    max_distance_to_tram_stop_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_tram_stop_m <= value (m)")] = None,
    max_distance_to_bus_stop_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_bus_stop_m <= value (m)")] = None,
    max_distance_to_train_station_m: Annotated[float | None, Query(ge=0, description="Filter by project distance_to_train_station_m <= value (m)")] = None,
    min_completion_date: Annotated[date | None, Query(description="Filter projects with completion_date >= value (YYYY-MM-DD)")] = None,
    max_completion_date: Annotated[date | None, Query(description="Filter projects with completion_date <= value (YYYY-MM-DD)")] = None,
) -> ProjectsListResponse:
    allowed_sort = get_projects_sort_keys()
    if sort_by not in allowed_sort:
        raise HTTPException(
            status_code=422,
            detail=f"sort_by must be one of: {sorted(allowed_sort)}",
        )
    if sort_dir not in ("asc", "desc"):
        raise HTTPException(status_code=422, detail="sort_dir must be asc or desc")
    # Hot-path: tabulka projektů + filtry/sort. Cached agg JOIN je o 1-2
    # řády rychlejší než live GROUP BY (14.8 s → < 200 ms na produkci).
    # mode=map zatím sahá na units_reserved/project_gps_* které v cache
    # nejsou, takže pro mapu zůstává live cesta — payload tam není limitní.
    agg_subq = _project_agg_subquery() if mode == "map" else _project_agg_cached_subquery()
    stmt = _projects_base_select(agg_subq)
    if q and q.strip():
        qq = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Project.name.ilike(qq),
                Project.developer.ilike(qq),
                Project.address.ilike(qq),
            )
        )
    if min_latitude is not None:
        stmt = stmt.where(Project.gps_latitude >= min_latitude)
    if max_latitude is not None:
        stmt = stmt.where(Project.gps_latitude <= max_latitude)
    if min_longitude is not None:
        stmt = stmt.where(Project.gps_longitude >= min_longitude)
    if max_longitude is not None:
        stmt = stmt.where(Project.gps_longitude <= max_longitude)
    if min_completion_date is not None:
        stmt = stmt.where(Project.completion_date >= min_completion_date)
    if max_completion_date is not None:
        stmt = stmt.where(Project.completion_date <= max_completion_date)

    # Explicit project name filter applies directly at Project level so we
    # match the project even when it has zero on-market units (otherwise the
    # unit-EXISTS subquery below would filter it out).
    if project is not None and len(project) > 0:
        name_clauses = [Project.name.ilike(f"%{n.strip()}%") for n in project if n and n.strip()]
        if name_clauses:
            stmt = stmt.where(or_(*name_clauses))

    # Archivace: standardně skrýváme projekty, které nemají žádné dostupné jednotky
    # a jejich poslední sold_date je starší než 6 měsíců. Ale když broker ručně
    # filtruje podle jména/textu (q nebo project=…), explicitní volba má přednost
    # — chce ten konkrétní projekt vidět i kdyby byl archived.
    explicit_name_filter = bool(
        (q and q.strip())
        or (project is not None and len(project) > 0)
        or (developer is not None and len(developer) > 0)
        or (building is not None and len(building) > 0)
    )
    if not include_archived and not explicit_name_filter:
        recent_sold_cutoff = date.today() - timedelta(days=183)  # ~6 měsíců
        first_seen_cutoff = date.today() - timedelta(days=365 * 2)  # ~2 roky
        stmt = stmt.where(
            or_(
                # Projekt má alespoň jednu dostupnou jednotku => vždy aktivní
                agg_subq.c.units_available > 0,
                # Projekt bez sold_date: ponechat jen pokud není „starý"
                and_(
                    agg_subq.c.sold_date.is_(None),
                    or_(
                        agg_subq.c.project_first_seen.is_(None),
                        agg_subq.c.project_first_seen >= first_seen_cutoff,
                    ),
                ),
                # Projekt se sold_date: ponechat, pokud prodej není starší než 6 měsíců
                and_(
                    agg_subq.c.sold_date.is_not(None),
                    agg_subq.c.sold_date >= recent_sold_cutoff,
                ),
            )
        )

    # Pokud jsou nastaveny filtry na jednotky, zobrazíme jen projekty, které mají alespoň jednu jednotku vyhovující filtrům.
    # Výjimka: explicit filtr `project=` znamená „chci tenhle konkrétní projekt"
    # — neořezávat ho dále podle availability/price filtrů (často default
    # availability=['available','unseen','reserved'] by ho jinak schoval, např.
    # už-vyprodaný Triple House).
    project_explicit = project is not None and len(project) > 0
    if not project_explicit and _has_unit_filters(
        available, availability,
        min_price, max_price,
        min_price_change, max_price_change,
        min_original_price, max_original_price,
        min_original_price_per_m2, max_original_price_per_m2,
        min_price_per_m2, max_price_per_m2,
        layout, district, municipality, heating, windows,
        permit_regular, renovation, air_conditioning, cooling_ceilings, smart_home,
        exterior_blinds,
        min_floor_area, max_floor_area,
        min_total_area, max_total_area,
        min_exterior_area, max_exterior_area,
        min_balcony_area, max_balcony_area,
        min_terrace_area, max_terrace_area,
        min_garden_area, max_garden_area,
        min_days_on_market, max_days_on_market,
        min_floor, max_floor,
        orientation, category, overall_quality, partition_walls, recuperation,
        city, cadastral_area_iga, municipal_district_iga, administrative_district_iga, region_iga,
        developer, building, project,
        min_latitude, max_latitude, min_longitude, max_longitude,
        min_ride_to_center_min, max_ride_to_center_min,
        min_public_transport_to_center_min, max_public_transport_to_center_min,
        min_payment_contract, max_payment_contract,
        min_payment_construction, max_payment_construction,
        min_payment_occupancy, max_payment_occupancy,
        max_distance_to_metro_station_m=max_distance_to_metro_station_m,
        max_distance_to_tram_stop_m=max_distance_to_tram_stop_m,
        max_distance_to_bus_stop_m=max_distance_to_bus_stop_m,
        max_distance_to_train_station_m=max_distance_to_train_station_m,
    ):
        units_base = _build_units_query(
            available=available,
            availability=availability,
            min_price=min_price,
            max_price=max_price,
            min_price_change=min_price_change,
            max_price_change=max_price_change,
            min_original_price=min_original_price,
            max_original_price=max_original_price,
            min_original_price_per_m2=min_original_price_per_m2,
            max_original_price_per_m2=max_original_price_per_m2,
            min_price_per_m2=min_price_per_m2,
            max_price_per_m2=max_price_per_m2,
            layout=layout,
            district=district,
            municipality=municipality,
            heating=heating,
            windows=windows,
            permit_regular=permit_regular,
            renovation=renovation,
            air_conditioning=air_conditioning,
            cooling_ceilings=cooling_ceilings,
            smart_home=smart_home,
            exterior_blinds=exterior_blinds,
            min_floor_area=min_floor_area,
            max_floor_area=max_floor_area,
            min_total_area=min_total_area,
            max_total_area=max_total_area,
            min_exterior_area=min_exterior_area,
            max_exterior_area=max_exterior_area,
            min_balcony_area=min_balcony_area,
            max_balcony_area=max_balcony_area,
            min_terrace_area=min_terrace_area,
            max_terrace_area=max_terrace_area,
            min_garden_area=min_garden_area,
            max_garden_area=max_garden_area,
            min_days_on_market=min_days_on_market,
            max_days_on_market=max_days_on_market,
            min_floor=min_floor,
            max_floor=max_floor,
            orientation=orientation,
            category=category,
            overall_quality=overall_quality,
            partition_walls=partition_walls,
            city=city,
            cadastral_area_iga=cadastral_area_iga,
            municipal_district_iga=municipal_district_iga,
            administrative_district_iga=administrative_district_iga,
            region_iga=region_iga,
            developer=developer,
            building=building,
            project_names=project,
            min_latitude=min_latitude,
            max_latitude=max_latitude,
            min_longitude=min_longitude,
            max_longitude=max_longitude,
            min_ride_to_center_min=min_ride_to_center_min,
            max_ride_to_center_min=max_ride_to_center_min,
            min_public_transport_to_center_min=min_public_transport_to_center_min,
            max_public_transport_to_center_min=max_public_transport_to_center_min,
            min_payment_contract=min_payment_contract,
            max_payment_contract=max_payment_contract,
            min_payment_construction=min_payment_construction,
            max_payment_construction=max_payment_construction,
            min_payment_occupancy=min_payment_occupancy,
            max_payment_occupancy=max_payment_occupancy,
            recuperation=recuperation,
            max_distance_to_metro_station_m=max_distance_to_metro_station_m,
            max_distance_to_tram_stop_m=max_distance_to_tram_stop_m,
            max_distance_to_bus_stop_m=max_distance_to_bus_stop_m,
            max_distance_to_train_station_m=max_distance_to_train_station_m,
        )
        u_sub = units_base.subquery()
        # EXISTS short-circuits on first match per project — much faster than
        # materializing a DISTINCT subquery and checking `Project.id IN (...)`.
        stmt = stmt.where(
            select(1)
            .select_from(u_sub)
            .where(u_sub.c.project_id == Project.id)
            .exists()
        )
    order = _projects_order_clause(agg_subq, sort_by, sort_dir)
    if order is not None:
        # Secondary tiebreak: projects with available units bubble up over
        # archived zombies (often share max_days_on_market=1 from old imports).
        # Project.id keeps results deterministic when both prior keys match.
        stmt = stmt.order_by(
            order,
            agg_subq.c.units_available.desc().nullslast(),
            Project.id.asc(),
        )
    # Count: re-use WHERE/JOIN of `stmt` but replace the SELECT list with COUNT
    # and drop ORDER BY. Skip entirely when `with_count=false` — map view and
    # infinite-scroll callers don't need it and the count query is the slowest
    # part of /projects.
    if with_count:
        count_stmt = stmt.with_only_columns(func.count(Project.id)).order_by(None)
        total = db.execute(count_stmt).scalar_one()
    else:
        total = -1
    stmt = stmt.offset(offset).limit(limit)
    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []

    if mode == "map":
        # Slim path: skip per-project ProjectAggregates lookup and the heavy
        # _project_row_to_item (which iterates ~100 catalog columns). Map view
        # only needs identity, location, headline aggregates, and a per-layout
        # cheapest-available preview for the popup.
        page_project_ids = [row[0].id for row in rows]

        # One DISTINCT-ON query → cheapest available unit per (project, layout)
        # for the whole page. With ix_units_project_id_availability_status and
        # ix_units_project_id_price_per_m2 indexes this is a few ms.
        cheapest_by_project: dict[int, list[dict[str, Any]]] = {}
        if page_project_ids:
            cheapest_rows = db.execute(
                text(
                    """
                    SELECT DISTINCT ON (project_id, layout)
                           project_id, layout,
                           external_id AS unit_external_id,
                           price_czk, floor_area_m2, exterior_area_m2
                    FROM units
                    WHERE project_id = ANY(:pids)
                      AND lower(availability_status) = 'available'
                      AND price_czk IS NOT NULL
                      AND layout IS NOT NULL
                    ORDER BY project_id, layout, price_czk ASC NULLS LAST
                    """
                ),
                {"pids": page_project_ids},
            ).mappings().all()
            for r in cheapest_rows:
                cheapest_by_project.setdefault(r["project_id"], []).append({
                    "layout": r["layout"],
                    "unit_external_id": r["unit_external_id"],
                    "price_czk": int(r["price_czk"]) if r["price_czk"] is not None else None,
                    "floor_area_m2": float(r["floor_area_m2"]) if r["floor_area_m2"] is not None else None,
                    "exterior_area_m2": float(r["exterior_area_m2"]) if r["exterior_area_m2"] is not None else None,
                })

        for row in rows:
            project = row[0]
            agg = getattr(row, "_mapping", {}) or {}
            if "units_total" not in agg and len(row) > 1 and row[1] is not None:
                agg = getattr(row[1], "_mapping", {}) or {}
            lat = project.gps_latitude or agg.get("project_gps_latitude")
            lon = project.gps_longitude or agg.get("project_gps_longitude")
            avg_pm2 = agg.get("avg_price_per_m2_czk")
            cheapest = cheapest_by_project.get(project.id, [])
            # Stable layout ordering: 1+kk, 2+kk, …, by leading number then label.
            cheapest.sort(key=lambda u: (
                int("".join(ch for ch in (u["layout"] or "") if ch.isdigit()) or "99"),
                u["layout"] or "",
            ))
            min_p = agg.get("min_price_czk")
            max_p = agg.get("max_price_czk")
            max_dom = agg.get("max_days_on_market")
            items.append({
                "id": project.id,
                "project": project.name,
                "developer": project.developer,
                "address": project.address,
                "municipality": project.municipality,
                "city": project.city,
                "district": project.district,
                "gps_latitude": float(lat) if lat is not None else None,
                "gps_longitude": float(lon) if lon is not None else None,
                "avg_price_per_m2_czk": float(avg_pm2) if avg_pm2 is not None else None,
                "min_price_czk": int(min_p) if min_p is not None else None,
                "max_price_czk": int(max_p) if max_p is not None else None,
                "units_total": agg.get("units_total"),
                "units_available": agg.get("units_available"),
                "units_reserved": agg.get("units_reserved"),
                "max_days_on_market": int(max_dom) if max_dom is not None else None,
                # Meta for popup
                "completion_date": project.completion_date.isoformat() if project.completion_date else None,
                "construction_completion": getattr(project, "construction_completion", None),
                "ride_to_center_min": float(project.ride_to_center_min) if project.ride_to_center_min is not None else None,
                "public_transport_to_center_min": float(project.public_transport_to_center_min) if project.public_transport_to_center_min is not None else None,
                "walkability_score": project.walkability_score,
                "walkability_label": project.walkability_label,
                "distance_to_metro_station_m": project.distance_to_metro_station_m,
                "distance_to_tram_stop_m": project.distance_to_tram_stop_m,
                "energy_class": getattr(project, "energy_class", None),
                "project_url": getattr(project, "project_url", None),
                "cheapest_units_by_layout": cheapest,
            })
        return ProjectsListResponse(items=items, total=total, limit=limit, offset=offset)

    # Načti cached project_aggregates pro všechny projekty na této stránce,
    # abychom pro přehled /projects používali stejné hodnoty jako units list.
    from .models import ProjectAggregates  # local import to avoid circular

    project_ids = [row[0].id for row in rows]
    agg_by_project_id: dict[int, ProjectAggregates] = {}
    if project_ids:
        agg_rows = (
            db.execute(
                select(ProjectAggregates).where(ProjectAggregates.project_id.in_(project_ids))
            )
            .scalars()
            .all()
        )
        agg_by_project_id = {agg.project_id: agg for agg in agg_rows}

    for row in rows:
        project = row[0]
        item = _project_row_to_item(project, row)
        agg = agg_by_project_id.get(project.id)
        if agg is not None:
            # Přepiš ceny stání/garáže v přehledu projeků hodnotami z project_aggregates,
            # aby odpovídaly tomu, co vidíme v units tabulce.
            item["min_parking_indoor_price_czk"] = agg.min_parking_indoor_price_czk
            item["min_parking_outdoor_price_czk"] = agg.min_parking_outdoor_price_czk
        items.append(item)
    return ProjectsListResponse(items=items, total=total, limit=limit, offset=offset)


@app.get(
    "/projects/{project_id}",
    summary="Get one project by id (catalog + computed)",
    description="Single project with all catalog fields and computed aggregates.",
)
def get_project(
    project_id: int,
    db: DbSession,
) -> dict[str, Any]:
    project = db.execute(select(Project).where(Project.id == project_id)).scalars().first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    agg_subq = _project_agg_subquery()
    stmt = (
        _projects_base_select(agg_subq)
        .where(Project.id == project_id)
    )
    row = db.execute(stmt).first()
    if row is None:
        base_item = _project_row_to_item(project, type("Row", (), {"_mapping": {}})())
    else:
        base_item = _project_row_to_item(row[0], row)

    # Ensure noise and micro_location fields are always propagated directly from the Project model
    # even if catalog mapping/filtering misses them for any reason.
    base_item["noise_day_db"] = getattr(project, "noise_day_db", None)
    base_item["noise_night_db"] = getattr(project, "noise_night_db", None)
    base_item["noise_label"] = getattr(project, "noise_label", None)
    base_item["distance_to_primary_road_m"] = getattr(project, "distance_to_primary_road_m", None)
    base_item["distance_to_tram_tracks_m"] = getattr(project, "distance_to_tram_tracks_m", None)
    base_item["distance_to_railway_m"] = getattr(project, "distance_to_railway_m", None)
    base_item["distance_to_airport_m"] = getattr(project, "distance_to_airport_m", None)
    base_item["micro_location_score"] = getattr(project, "micro_location_score", None)
    base_item["micro_location_label"] = getattr(project, "micro_location_label", None)
    # Walkability (separate from micro_location)
    for attr in (
        "walkability_score",
        "walkability_label",
        "walkability_daily_needs_score",
        "walkability_transport_score",
        "walkability_leisure_score",
        "walkability_family_score",
        "distance_to_supermarket_m",
        "distance_to_pharmacy_m",
        "distance_to_tram_stop_m",
        "distance_to_bus_stop_m",
        "distance_to_metro_station_m",
        "walking_distance_to_tram_stop_m",
        "walking_distance_to_bus_stop_m",
        "walking_distance_to_metro_station_m",
        "distance_to_park_m",
        "distance_to_restaurant_m",
        "distance_to_cafe_m",
        "distance_to_fitness_m",
        "distance_to_playground_m",
        "distance_to_kindergarten_m",
        "distance_to_primary_school_m",
        "count_supermarket_500m",
        "count_pharmacy_500m",
        "count_restaurant_500m",
        "count_cafe_500m",
        "count_park_500m",
        "count_fitness_500m",
        "count_playground_500m",
        "count_kindergarten_500m",
        "count_primary_school_500m",
    ):
        base_item[attr] = getattr(project, attr, None)

    # Apply project-level overrides so detail matches list/overview behaviour.
    override_rows = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == project.id,
                ProjectOverride.field.in_(PROJECT_OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map = build_project_override_map(override_rows)
    final_item = apply_project_overrides_to_item(project.id, dict(base_item), override_map)
    return final_item


@app.get("/projects/{project_id}/walkability-poi")
def get_project_walkability_poi(
    project_id: int,
    db: DbSession,
    category: Annotated[str, Query(description="POI category")],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, Any]:
    """List POI of a category near the project (name, distance_m, lat, lon). For detail popup and map."""
    if category not in WALKABILITY_POI_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Unknown category. Allowed: {list(WALKABILITY_POI_CATEGORIES.keys())}")
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    items = get_project_walkability_poi_list(db, project_id, category, limit=limit)
    return {"items": items, "category": category}


@app.get("/projects/{project_id}/walkability-poi-overview")
def get_project_walkability_poi_overview_endpoint(
    project_id: int,
    db: DbSession,
    categories: Annotated[
        str,
        Query(description="Comma-separated category slugs, e.g. supermarkets,pharmacies,parks,restaurants,tram_stops,bus_stops,metro_stations"),
    ] = "supermarkets,pharmacies,parks,restaurants,tram_stops,bus_stops,metro_stations",
    per_category: Annotated[int, Query(ge=1, le=10)] = 2,
) -> dict[str, Any]:
    """Project lat/lon and nearest N POIs per category for map widgets."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    category_list = [c.strip() for c in categories.split(",") if c.strip()]
    return get_project_walkability_poi_overview(db, project_id, categories=category_list, per_category=per_category)


@app.post("/projects/{project_id}/walkability/personalized-score")
def project_personalized_walkability_score(
    project_id: int,
    prefs: WalkabilityPreferences,
    db: DbSession,
) -> dict[str, Any]:
    """Compute personalized walkability score for one project (no DB write)."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.gps_latitude is None or project.gps_longitude is None:
        raise HTTPException(status_code=422, detail="Project has no GPS")
    raw = project_to_raw_metrics(project)
    result = compute_personalized_walkability_score(raw, prefs.model_dump())
    return {"project_id": project_id, **result}


@app.post("/projects/walkability/personalized-scores")
def projects_personalized_walkability_scores(
    body: PersonalizedWalkabilityBatchRequest,
    db: DbSession,
) -> dict[str, Any]:
    """Batch: compute personalized walkability for given project_ids (no DB write)."""
    if not body.project_ids:
        return {"items": []}
    projects = db.execute(select(Project).where(Project.id.in_(body.project_ids))).scalars().all()
    projects = [p for p in projects if p.gps_latitude is not None and p.gps_longitude is not None]
    prefs = body.preferences.model_dump()
    items: list[dict[str, Any]] = []
    for p in projects:
        raw = project_to_raw_metrics(p)
        result = compute_personalized_walkability_score(raw, prefs)
        items.append({"project_id": p.id, **result})
    return {"items": items}


@app.get("/units/{external_id}", response_model=UnitResponse)
def get_unit(external_id: str, db: DbSession) -> UnitResponse:
    """Get a single unit by external_id. Returns same schema as GET /units with overrides applied."""
    unit = _get_unit_or_404(db, external_id)
    return _effective_unit_response(db, unit)


@app.get("/units/{external_id}/price-history", response_model=list[PriceHistoryEntry])
def get_unit_price_history(
    external_id: str,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> list[PriceHistoryEntry]:
    unit = db.execute(select(Unit).where(Unit.external_id == external_id)).scalars().first()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")

    stmt = (
        select(UnitPriceHistory)
        .where(UnitPriceHistory.unit_id == unit.id)
        .order_by(desc(UnitPriceHistory.captured_at), desc(UnitPriceHistory.id))
        .limit(limit)
    )
    rows = db.execute(stmt).scalars().all()

    return [
        PriceHistoryEntry(
            captured_at=r.captured_at,
            price_czk=r.price_czk,
            price_per_m2_czk=r.price_per_m2_czk,
            availability_status=r.availability_status,
            available=r.available,
        )
        for r in rows
    ]


@app.put("/units/{external_id}/overrides/{field}", response_model=UnitResponse)
def put_unit_override(
    external_id: str,
    field: str,
    body: OverrideValueBody,
    db: DbSession,
) -> UnitResponse:
    if field not in VALID_OVERRIDE_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid override field. Allowed: {sorted(VALID_OVERRIDE_FIELDS)}",
        )
    unit = _get_unit_or_404(db, external_id)
    existing = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id == unit.id,
                UnitOverride.field == field,
            )
        )
        .scalars().first()
    )
    if existing:
        existing.value = body.value
    else:
        db.add(UnitOverride(unit_id=unit.id, field=field, value=body.value))

    db.flush()
    # Recompute cached aggregates for this unit's project when relevant fields change
    if field in AGGREGATE_AFFECTING_FIELDS:
        recompute_project_aggregates(db, [unit.project_id])

    db.commit()
    db.refresh(unit)
    return _effective_unit_response(db, unit)


@app.delete("/units/{external_id}/overrides/{field}", response_model=UnitResponse)
def delete_unit_override(
    external_id: str,
    field: str,
    db: DbSession,
) -> UnitResponse:
    if field not in VALID_OVERRIDE_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid override field. Allowed: {sorted(VALID_OVERRIDE_FIELDS)}",
        )
    unit = _get_unit_or_404(db, external_id)
    existing = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id == unit.id,
                UnitOverride.field == field,
            )
        )
        .scalars().first()
    )
    if existing:
        db.delete(existing)

    db.flush()
    if field in AGGREGATE_AFFECTING_FIELDS:
        recompute_project_aggregates(db, [unit.project_id])

    db.commit()
    db.refresh(unit)
    return _effective_unit_response(db, unit)


@app.post("/units/{external_id}/accept-api", response_model=UnitResponse)
def accept_pending_api(
    external_id: str,
    body: PendingApiActionBody,
    db: DbSession,
) -> UnitResponse:
    """Použít čekající hodnotu z API jako override (pole: price_czk, price_per_m2_czk, availability_status)."""
    if body.field not in PENDING_API_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid field for accept-api. Allowed: {sorted(PENDING_API_FIELDS)}",
        )
    unit = _get_unit_or_404(db, external_id)
    pending = (
        db.execute(
            select(UnitApiPending).where(
                UnitApiPending.unit_id == unit.id,
                UnitApiPending.field == body.field,
            )
        )
        .scalars().first()
    )
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending API value for this field")
    existing = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id == unit.id,
                UnitOverride.field == body.field,
            )
        )
        .scalars().first()
    )
    if existing:
        existing.value = pending.value
    else:
        db.add(UnitOverride(unit_id=unit.id, field=body.field, value=pending.value))
    if body.field == "availability_status":
        available_val = (pending.value or "").strip().lower() == "available"
        existing_av = (
            db.execute(
                select(UnitOverride).where(
                    UnitOverride.unit_id == unit.id,
                    UnitOverride.field == "available",
                )
            )
            .scalars().first()
        )
        if existing_av:
            existing_av.value = "true" if available_val else "false"
        else:
            db.add(UnitOverride(unit_id=unit.id, field="available", value="true" if available_val else "false"))
    db.delete(pending)
    db.flush()
    if body.field in AGGREGATE_AFFECTING_FIELDS:
        recompute_project_aggregates(db, [unit.project_id])
    db.commit()
    db.refresh(unit)
    return _effective_unit_response(db, unit)


@app.post("/units/{external_id}/dismiss-api", response_model=UnitResponse)
def dismiss_pending_api(
    external_id: str,
    body: PendingApiActionBody,
    db: DbSession,
) -> UnitResponse:
    """Zamítnout čekající hodnotu z API a ponechat aktuální (ruční nebo z DB)."""
    if body.field not in PENDING_API_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid field for dismiss-api. Allowed: {sorted(PENDING_API_FIELDS)}",
        )
    unit = _get_unit_or_404(db, external_id)
    pending = (
        db.execute(
            select(UnitApiPending).where(
                UnitApiPending.unit_id == unit.id,
                UnitApiPending.field == body.field,
            )
        )
        .scalars().first()
    )
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending API value for this field")
    db.delete(pending)
    db.commit()
    db.refresh(unit)
    return _effective_unit_response(db, unit)


@app.put("/projects/{project_id}/overrides/{field}")
def put_project_override(
    project_id: int,
    field: str,
    body: OverrideValueBody,
    db: DbSession,
) -> dict[str, Any]:
    """Create or update a project-level override for a catalog field."""
    if field not in VALID_PROJECT_OVERRIDE_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid project override field. Allowed: {sorted(VALID_PROJECT_OVERRIDE_FIELDS)}",
        )
    project = _get_project_or_404(db, project_id)
    existing = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == project.id,
                ProjectOverride.field == field,
            )
        )
        .scalars()
        .first()
    )
    if existing:
        existing.value = body.value
    else:
        db.add(ProjectOverride(project_id=project.id, field=field, value=body.value))
    db.commit()

    if field in LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS:
        enrich_project_location_metrics(db, project_id)
        db.commit()

    override_rows = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == project.id,
                ProjectOverride.field.in_(PROJECT_OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map = build_project_override_map(override_rows)
    base_item = get_project(project_id=project.id, db=db)
    return apply_project_overrides_to_item(project.id, dict(base_item), override_map)


@app.delete("/projects/{project_id}/overrides/{field}")
def delete_project_override(
    project_id: int,
    field: str,
    db: DbSession,
) -> dict[str, Any]:
    """Delete a project-level override and return updated project row."""
    if field not in VALID_PROJECT_OVERRIDE_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid project override field. Allowed: {sorted(VALID_PROJECT_OVERRIDE_FIELDS)}",
        )
    project = _get_project_or_404(db, project_id)
    existing = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == project.id,
                ProjectOverride.field == field,
            )
        )
        .scalars()
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()

    if field in LOCATION_METRICS_ENRICHMENT_TRIGGER_FIELDS:
        enrich_project_location_metrics(db, project_id)
        db.commit()

    override_rows = (
        db.execute(
            select(ProjectOverride).where(
                ProjectOverride.project_id == project.id,
                ProjectOverride.field.in_(PROJECT_OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map = build_project_override_map(override_rows)
    base_item = get_project(project_id=project.id, db=db)
    return apply_project_overrides_to_item(project.id, dict(base_item), override_map)


# ---------------------------------------------------------------------------
# Location metrics: per-project enrichment and full recompute (scheduler-ready)
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/location-metrics/recompute")
def recompute_project_location_metrics(
    project_id: int,
    db: DbSession,
) -> dict[str, Any]:
    """Recompute noise + micro-location for this project only. Use after manual edit of GPS/region."""
    _get_project_or_404(db, project_id)
    computed = enrich_project_location_metrics(db, project_id)
    db.commit()
    return {"project_id": project_id, "computed": computed}


@app.post("/admin/location-metrics/recompute-all")
def admin_recompute_all_location_metrics(db: DbSession) -> dict[str, Any]:
    """Recompute noise + micro-location for all projects with GPS. Use after source data refresh or manual run."""
    result = recompute_all_project_location_metrics(db)
    return result


@app.post("/admin/location-sources/refresh-and-recompute")
def admin_refresh_sources_and_recompute(db: DbSession) -> dict[str, Any]:
    """Refresh noise + OSM source data from configured paths (if set), then full recompute. For weekly/monthly scheduler."""
    from pathlib import Path
    from .settings import settings
    noise_day = Path(settings.location_source_noise_day_path) if settings.location_source_noise_day_path else None
    noise_night = Path(settings.location_source_noise_night_path) if settings.location_source_noise_night_path else None
    osm_paths: dict[str, Path] = {}
    if settings.location_source_osm_primary_roads_path:
        osm_paths["primary_roads"] = Path(settings.location_source_osm_primary_roads_path)
    if settings.location_source_osm_tram_tracks_path:
        osm_paths["tram_tracks"] = Path(settings.location_source_osm_tram_tracks_path)
    if settings.location_source_osm_railway_path:
        osm_paths["railway"] = Path(settings.location_source_osm_railway_path)
    if settings.location_source_osm_airports_path:
        osm_paths["airports"] = Path(settings.location_source_osm_airports_path)
    result = refresh_all_location_sources_and_recompute(
        db,
        noise_day_path=noise_day,
        noise_night_path=noise_night,
        osm_paths=osm_paths if osm_paths else None,
    )
    return result


@app.post("/admin/location-sources/download-osm-and-recompute")
def admin_download_osm_and_recompute(db: DbSession) -> dict[str, Any]:
    """
    Download OSM data from Overpass API (primary roads, tram, railway, airports) for Praha,
    fill osm_* tables, then run full recompute of project location metrics.
    No env or file paths required. Suitable for cron and UI button.
    Can take 1–2 minutes; frontend should use a long timeout.
    """
    try:
        result = download_osm_sources_and_recompute(db)
        return result
    except Exception as e:
        import logging
        logging.exception("OSM download failed")
        msg = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=503, detail=f"OSM download failed: {msg}")


@app.post("/admin/walkability-sources/refresh-and-recompute")
def admin_walkability_refresh_and_recompute(db: DbSession) -> dict[str, Any]:
    """
    One-click: (1) Refresh all walkability POI tables from Overpass, (2) recompute all project walkability.
    Categories are taken from WALKABILITY_DOWNLOADERS (single source of truth); new categories are included automatically.
    Returns walkability_poi.source_counts, recompute stats, total_elapsed_seconds, and warnings (e.g. empty tables).
    Scheduler-ready; can take several minutes.
    """
    try:
        return refresh_walkability_sources_and_recompute(db)
    except Exception as e:
        import logging
        logging.exception("Walkability refresh failed")
        msg = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=503, detail=f"Walkability refresh failed: {msg}")


@app.post("/admin/walkability/recompute-all")
def admin_walkability_recompute_all(db: DbSession) -> dict[str, Any]:
    """Recompute walkability for all projects with GPS (uses existing POI data)."""
    return recompute_all_walkability(db)


@app.post("/admin/aggregates/recompute-floors")
def admin_recompute_derived_floors(db: DbSession) -> dict[str, Any]:
    """Recompute derived_total_floors (max unit.floor) for all projects."""
    import time as _time
    t0 = _time.monotonic()

    all_project_ids = [
        pid for (pid,) in db.execute(select(Project.id)).all()
    ]
    if not all_project_ids:
        return {"processed": 0, "elapsed_seconds": 0}

    recompute_project_aggregates(db, all_project_ids)
    db.commit()

    # Collect results for response
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
    elapsed = round(_time.monotonic() - t0, 2)
    return {
        "processed": len(all_project_ids),
        "with_derived_floors": with_floors,
        "elapsed_seconds": elapsed,
    }


# ---------------------------------------------------------------------------
# BuiltMind API import
# ---------------------------------------------------------------------------

# Paměťový stav posledního běhu BuiltMind importu. Přepisuje se při každém spuštění.
# Struktura: {status, started_at, finished_at, error, stats, recompute}
_builtmind_import_state: dict[str, Any] = {"status": "idle"}


def _run_builtmind_import_job() -> None:
    """Background job: fetch + import + recompute. Updates _builtmind_import_state."""
    import tempfile
    import traceback
    import json as _json
    from datetime import datetime, timezone
    from pathlib import Path as _Path
    from .fetch_builtmind import fetch_from_api
    from .import_units import import_units as _import_units
    from .settings import settings

    _builtmind_import_state.update(
        {
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "error": None,
            "stats": None,
            "recompute": None,
        }
    )
    try:
        api_key = (settings.builtmind_api_key or os.environ.get("BUILTMIND_API_KEY", "")).strip()
        if not api_key:
            raise RuntimeError("BUILTMIND_API_KEY not set in environment")

        print("[import] fetching from BuiltMind API…", flush=True)
        units = fetch_from_api(api_key)
        print(f"[import] fetched {len(units)} units", flush=True)

        fd, tmp_path_str = tempfile.mkstemp(suffix=".json", prefix="builtmind_")
        tmp_path = _Path(tmp_path_str)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                _json.dump(units, f, ensure_ascii=False)
            # chunk_size=500 místo defaultu 2000 → 4× menší memory špičky uvnitř chunku
            # = robustnější proti Railway OOM killu.
            stats = _import_units(tmp_path, source="api", chunk_size=500)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

        print("[import] recomputing client recommendations…", flush=True)
        recompute_stats = _recompute_all_client_recommendations()
        _builtmind_import_state.update(
            {
                "status": "done",
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "stats": stats,
                "recompute": recompute_stats,
            }
        )
        print("[import] DONE", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[import] FAILED: {exc}", flush=True)
        traceback.print_exc()
        _builtmind_import_state.update(
            {
                "status": "error",
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error": f"{type(exc).__name__}: {exc}",
            }
        )


@app.post("/admin/imports/builtmind/run")
def run_builtmind_import() -> dict[str, Any]:
    """Spustí BuiltMind import v background threadu a hned vrátí 202.

    Pokud už job běží, vrátí 409. Stav si zjisti přes GET /admin/imports/builtmind/status.
    """
    import threading

    if _builtmind_import_state.get("status") == "running":
        raise HTTPException(status_code=409, detail="Import already running")

    t = threading.Thread(target=_run_builtmind_import_job, daemon=True, name="builtmind-import")
    t.start()
    return {"ok": True, "status": "started"}


@app.get("/admin/imports/builtmind/status")
def get_builtmind_import_status() -> dict[str, Any]:
    """Poll stav posledního BuiltMind importu."""
    return dict(_builtmind_import_state)


# ---------------------------------------------------------------------------
# Daily ops pipeline (cron + manual) + audit log
# ---------------------------------------------------------------------------

def _is_cron_request(request: Request) -> bool:
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()
    if not cron_secret:
        return False
    supplied = request.headers.get("x-cron-secret") or ""
    if not supplied:
        # Vercel Cron sends Authorization: Bearer $CRON_SECRET by default.
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            supplied = auth[7:]
    return bool(supplied) and supplied == cron_secret


_PROBE_ENDPOINTS = [
    "/filters",
    "/projects?limit=10&offset=0&sort_by=avg_price_per_m2_czk&sort_dir=asc",
    "/units?limit=10&offset=0",
    "/columns?view=projects",
    "/columns?view=units",
]


@app.post("/admin/probe/run")
def admin_probe_run(
    request: Request,
    db: DbSession,
    authorization: str | None = Header(default=None, alias=AUTH_HEADER),
) -> dict[str, Any]:
    """Hit critical endpoints and log any 4xx/5xx as 'probe' errors.

    Triggered by Vercel cron every 5 minutes (or manually by a broker).
    """
    from .error_logging import run_endpoint_probe

    if not _is_cron_request(request):
        # Manual trigger — require broker auth.
        get_current_broker(db=db, authorization=authorization)

    base_url = (os.environ.get("PROBE_BASE_URL") or "").strip()
    if not base_url:
        # Hit ourselves on localhost (Railway internal).
        port = os.environ.get("PORT") or "8001"
        base_url = f"http://127.0.0.1:{port}"

    summary = run_endpoint_probe(db, base_url=base_url, endpoints=_PROBE_ENDPOINTS)
    return {"ok": True, **summary}


@app.post("/admin/ops/daily-run")
def admin_ops_daily_run(
    request: Request,
    db: DbSession,
    authorization: str | None = Header(default=None, alias=AUTH_HEADER),
) -> dict[str, Any]:
    """Kick off the nightly data pipeline (import + recomputes). Returns run_id.

    Auth: either `x-cron-secret: $CRON_SECRET` header / `Authorization: Bearer
    $CRON_SECRET` (for Vercel cron) or a logged-in broker (manual trigger).
    """
    from .ops_runner import start_pipeline

    if _is_cron_request(request):
        trigger = "cron"
    else:
        # Regular broker auth — reuse the existing dependency logic.
        broker = get_current_broker(db=db, authorization=authorization)
        trigger = f"manual:{broker.email}" if broker else "manual"

    try:
        run_id = start_pipeline(trigger=trigger)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"ok": True, "run_id": run_id, "trigger": trigger}


@app.get("/admin/ops/runs")
def admin_ops_list_runs(
    db: DbSession,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Recent ops runs, newest first."""
    from .models import OpsRun
    rows = (
        db.execute(
            select(OpsRun).order_by(OpsRun.started_at.desc()).limit(max(1, min(limit, 200)))
        )
        .scalars()
        .all()
    )
    return [_serialize_ops_run(r, include_steps=False) for r in rows]


@app.get("/admin/ops/runs/{run_id}")
def admin_ops_get_run(run_id: int, db: DbSession) -> dict[str, Any]:
    from .models import OpsRun
    run = db.get(OpsRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return _serialize_ops_run(run, include_steps=True)


@app.get("/admin/ops/summary")
def admin_ops_summary(db: DbSession) -> dict[str, Any]:
    """Aggregate counters for the dashboard (today / 7d / 30d)."""
    from datetime import timedelta
    from .models import OpsRun

    now = datetime.now(timezone.utc)
    windows = {
        "day": now - timedelta(days=1),
        "week": now - timedelta(days=7),
        "month": now - timedelta(days=30),
    }

    rows = (
        db.execute(
            select(OpsRun).where(OpsRun.started_at >= windows["month"]).order_by(OpsRun.started_at.desc())
        )
        .scalars()
        .all()
    )

    def _bucket(rows_in: list[OpsRun]) -> dict[str, Any]:
        total = len(rows_in)
        ok = sum(1 for r in rows_in if r.status == "done")
        err = sum(1 for r in rows_in if r.status in ("error", "partial"))
        running = sum(1 for r in rows_in if r.status == "running")
        units_created = 0
        units_updated = 0
        projects_created = 0
        for r in rows_in:
            s = r.summary_json or {}
            units_created += int(s.get("units_created") or 0)
            units_updated += int(s.get("units_updated") or 0)
            projects_created += int(s.get("projects_created") or 0)
        return {
            "runs_total": total,
            "runs_ok": ok,
            "runs_err": err,
            "runs_running": running,
            "units_created": units_created,
            "units_updated": units_updated,
            "projects_created": projects_created,
        }

    return {
        "day": _bucket([r for r in rows if r.started_at >= windows["day"]]),
        "week": _bucket([r for r in rows if r.started_at >= windows["week"]]),
        "month": _bucket(list(rows)),
        "last_run": _serialize_ops_run(rows[0], include_steps=False) if rows else None,
    }


def _serialize_ops_run(run: Any, include_steps: bool) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": run.id,
        "trigger": run.trigger,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "summary": run.summary_json,
        "error": run.error,
    }
    if include_steps:
        out["steps"] = run.steps_json or []
    else:
        steps = run.steps_json or []
        out["steps_count"] = len(steps)
        out["steps_ok"] = sum(1 for s in steps if s.get("status") == "done")
        out["steps_err"] = sum(1 for s in steps if s.get("status") == "error")
    return out


# ----------------------------------------------------------------------
# Error logs (server / client / probe) — used by /admin/errors dashboard.
# ----------------------------------------------------------------------


class ClientErrorPayload(BaseModel):
    """Payload from frontend errorReporter. All fields optional except message."""
    message: str
    source: str | None = None  # 'window' | 'unhandledrejection' | 'fetch' | 'react'
    stack: str | None = None
    url: str | None = None  # full window.location at time of error
    method: str | None = None  # for fetch errors
    status: int | None = None  # for fetch errors
    user_agent: str | None = None
    extra: dict[str, Any] | None = None


@app.post("/admin/client-errors")
def post_client_error(
    payload: ClientErrorPayload,
    request: Request,
    db: DbSession,
) -> dict[str, Any]:
    """Receive a single client-side error report. No auth (anonymous reporting)."""
    from .error_logging import write_error

    # Parse path/query out of the reported URL if present.
    path: str | None = None
    query: str | None = None
    if payload.url:
        try:
            from urllib.parse import urlparse
            u = urlparse(payload.url)
            path = u.path or None
            query = u.query or None
        except Exception:
            path = payload.url[:1000]

    extra: dict[str, Any] = {}
    if payload.source:
        extra["source"] = payload.source
    if payload.extra:
        extra.update(payload.extra)

    err_id = write_error(
        db,
        source="client",
        message=payload.message or "(empty)",
        status=payload.status,
        method=payload.method,
        path=path,
        query=query,
        traceback=payload.stack,
        user_agent=payload.user_agent or request.headers.get("user-agent"),
        extra=extra or None,
    )
    return {"ok": True, "id": err_id}


@app.get("/admin/errors")
def admin_list_errors(
    db: DbSession,
    broker: Annotated[Broker, Depends(get_current_broker)],
    since_hours: Annotated[int, Query(ge=1, le=24 * 14)] = 24,
    source: Annotated[str | None, Query()] = None,  # 'server' | 'client' | 'probe'
    status: Annotated[int | None, Query()] = None,
    only_unresolved: Annotated[bool, Query()] = True,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> dict[str, Any]:
    """Recent error_logs rows for the admin dashboard."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    stmt = select(ErrorLog).where(ErrorLog.ts >= cutoff)
    if source:
        stmt = stmt.where(ErrorLog.source == source)
    if status is not None:
        stmt = stmt.where(ErrorLog.status == status)
    if only_unresolved:
        stmt = stmt.where(ErrorLog.resolved_at.is_(None))
    stmt = stmt.order_by(ErrorLog.ts.desc()).limit(limit)
    rows = db.execute(stmt).scalars().all()

    items = [
        {
            "id": r.id,
            "ts": r.ts.isoformat() if r.ts else None,
            "source": r.source,
            "level": r.level,
            "status": r.status,
            "method": r.method,
            "path": r.path,
            "query": r.query,
            "message": r.message,
            "user_agent": r.user_agent,
            "request_id": r.request_id,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        }
        for r in rows
    ]

    # Aggregate counts (so the page can show buckets without a 2nd request).
    from sqlalchemy import func as _f
    counts_stmt = (
        select(ErrorLog.source, _f.count(ErrorLog.id))
        .where(ErrorLog.ts >= cutoff)
        .group_by(ErrorLog.source)
    )
    counts = {row[0]: row[1] for row in db.execute(counts_stmt).all()}
    unresolved_count = db.execute(
        select(_f.count(ErrorLog.id)).where(
            ErrorLog.ts >= cutoff, ErrorLog.resolved_at.is_(None)
        )
    ).scalar_one()

    return {
        "items": items,
        "counts": counts,
        "unresolved": unresolved_count,
        "since_hours": since_hours,
    }


@app.get("/admin/errors/{error_id}")
def admin_get_error(
    error_id: int,
    db: DbSession,
    broker: Annotated[Broker, Depends(get_current_broker)],
) -> dict[str, Any]:
    row = db.get(ErrorLog, error_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Error not found")
    return {
        "id": row.id,
        "ts": row.ts.isoformat() if row.ts else None,
        "source": row.source,
        "level": row.level,
        "status": row.status,
        "method": row.method,
        "path": row.path,
        "query": row.query,
        "message": row.message,
        "traceback": row.traceback,
        "user_agent": row.user_agent,
        "request_id": row.request_id,
        "broker_id": row.broker_id,
        "extra": row.extra_json,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
    }


@app.post("/admin/errors/{error_id}/resolve")
def admin_resolve_error(
    error_id: int,
    db: DbSession,
    broker: Annotated[Broker, Depends(get_current_broker)],
) -> dict[str, Any]:
    row = db.get(ErrorLog, error_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Error not found")
    row.resolved_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@app.post("/admin/errors/resolve-bulk")
def admin_resolve_errors_bulk(
    request: Request,
    db: DbSession,
    broker: Annotated[Broker, Depends(get_current_broker)],
    since_hours: Annotated[int, Query(ge=1, le=24 * 14)] = 24,
    source: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    """Mark all unresolved errors in the window as resolved (one-click cleanup)."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    from sqlalchemy import update as _update
    stmt = _update(ErrorLog).where(
        ErrorLog.ts >= cutoff, ErrorLog.resolved_at.is_(None)
    )
    if source:
        stmt = stmt.where(ErrorLog.source == source)
    stmt = stmt.values(resolved_at=datetime.now(timezone.utc))
    res = db.execute(stmt)
    db.commit()
    return {"ok": True, "resolved": res.rowcount or 0}


def _recompute_all_client_recommendations() -> dict[str, Any]:
    """Recompute recommendations for all clients that have a profile with recommendations.

    Runs in a fresh DB session per client to avoid long-lived transactions.
    Called automatically after import and available via admin endpoint.
    """
    import time as _time
    from .db import SessionLocal

    db = SessionLocal()
    try:
        # Find all clients that have at least one recommendation
        client_ids = [
            row[0] for row in db.execute(
                select(ClientRecommendation.client_id)
                .distinct()
            ).all()
        ]
    finally:
        db.close()

    if not client_ids:
        return {"clients": 0, "ok": True}

    t0 = _time.perf_counter()
    succeeded = 0
    failed = 0
    for cid in client_ids:
        db2 = SessionLocal()
        try:
            client = db2.execute(select(Client).where(Client.id == cid)).scalars().first()
            if not client:
                continue
            profile = db2.execute(
                select(ClientProfile).where(ClientProfile.client_id == cid)
            ).scalars().first()
            if not profile:
                continue

            # Resolve scoring config
            global_cfg = db2.execute(
                select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
            ).scalars().first()
            _thresholds = resolve_thresholds(global_cfg.thresholds_json if global_cfg else None)

            # Build market filter and SQL conditions
            _all_sql = [_market_filter_from_config(_thresholds)]

            # Budget + area SQL filters (same as recompute endpoint)
            wiz_budget = ((profile.filter_json or {}).get("wizard", {}).get("budget", {}))
            price_tol_pct = wiz_budget.get("max_price_tolerance_pct", 0) or 0
            area_tol_pct = wiz_budget.get("max_area_tolerance_pct", 0) or 0

            if profile.budget_max is not None:
                eff_max = int(profile.budget_max * (1 + price_tol_pct / 100))
                _all_sql.append(Unit.price_czk <= eff_max)
            if profile.area_min is not None:
                eff_min = profile.area_min * (1 - area_tol_pct / 100)
                _all_sql.append(Unit.floor_area_m2 >= eff_min)

            # Fetch candidate units
            q = (
                select(Unit, Project)
                .join(Project, Unit.project_id == Project.id)
                .where(and_(*_all_sql))
            )
            rows = db2.execute(q).all()

            # Resolve weights
            global_w = global_cfg.config_json if global_cfg else None
            client_w = profile.scoring_weights_json if profile else None
            weights = resolve_weights(global_w, client_w)
            flat_weights = resolve_flat_weights(profile)

            # Score each unit — use savepoints so commute-cache conflicts
            # don't abort the whole client session.
            scored: list[tuple] = []
            for unit, project in rows:
                nested = db2.begin_nested()
                try:
                    result = compute_full_score(
                        unit, project, profile, weights,
                        db=db2,
                        flat_weights=flat_weights,
                    )
                    nested.commit()
                except Exception:
                    nested.rollback()
                    # Retry without db (no commute caching)
                    result = compute_full_score(
                        unit, project, profile, weights,
                        flat_weights=flat_weights,
                    )
                if result["score"] > 0:
                    scored.append((unit, project, result))

            scored.sort(key=lambda x: x[2]["score"], reverse=True)

            # Persist — delete old, insert new
            db2.execute(
                ClientRecommendation.__table__.delete().where(
                    and_(
                        ClientRecommendation.client_id == cid,
                        ClientRecommendation.pinned_by_broker.is_(False),
                        ClientRecommendation.hidden_by_broker.is_(False),
                    )
                )
            )

            for unit, project, result in scored:
                # Check if pinned rec exists
                existing = db2.execute(
                    select(ClientRecommendation).where(
                        ClientRecommendation.client_id == cid,
                        ClientRecommendation.unit_id == unit.id,
                    )
                ).scalars().first()
                if existing:
                    existing.score = round(result["score"], 2)
                    existing.reason_json = result
                else:
                    db2.add(ClientRecommendation(
                        client_id=cid,
                        unit_id=unit.id,
                        project_id=project.id,
                        score=round(result["score"], 2),
                        reason_json=result,
                    ))

            db2.commit()
            succeeded += 1
        except Exception as exc:
            db2.rollback()
            failed += 1
            print(f"[BULK-RECOMPUTE] Client {cid} failed: {exc}")
        finally:
            db2.close()

    elapsed = _time.perf_counter() - t0
    print(f"[BULK-RECOMPUTE] {succeeded}/{len(client_ids)} clients in {elapsed:.1f}s ({failed} failed)")
    return {"clients": succeeded, "failed": failed, "elapsed_seconds": round(elapsed, 1)}


@app.post("/admin/recompute-all-recommendations")
def admin_recompute_all_recommendations(
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Recompute recommendations for all clients. Admin action."""
    return _recompute_all_client_recommendations()


# ---------------------------------------------------------------------------
# Scoring weights — global + per-client
# ---------------------------------------------------------------------------

@app.get("/admin/scoring-weights")
def get_global_scoring_weights(db: DbSession) -> dict[str, Any]:
    """Return the current global scoring weights."""
    row = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    if not row:
        return {"weights": DEFAULT_WEIGHTS}
    return {"weights": row.config_json}


@app.put("/admin/scoring-weights")
def set_global_scoring_weights(body: dict[str, Any], db: DbSession) -> dict[str, Any]:
    """Set global scoring weights. Body: {budget: 0.3, ...}."""
    row = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    if row:
        row.config_json = body
    else:
        row = ScoringConfig(config_json=body)
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"weights": row.config_json}


@app.get("/clients/{client_id}/scoring-weights")
def get_client_scoring_weights(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Return effective weights for a client (per-client override merged on top of global)."""
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    global_row = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    global_w = global_row.config_json if global_row else None
    client_w = profile.scoring_weights_json if profile else None
    return {
        "weights": resolve_weights(global_w, client_w),
        "source": "client" if client_w else "global",
    }


@app.put("/clients/{client_id}/scoring-weights")
def set_client_scoring_weights(
    client_id: int,
    body: dict[str, Any],
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Set per-client scoring weight overrides."""
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if not profile:
        profile = ClientProfile(client_id=client.id)
    profile.scoring_weights_json = body
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return {"weights": profile.scoring_weights_json}


@app.delete("/clients/{client_id}/scoring-weights")
def delete_client_scoring_weights(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Remove per-client override, falling back to global weights."""
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if profile and profile.scoring_weights_json is not None:
        profile.scoring_weights_json = None
        db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Flat scoring weights — wizard-derived + broker overrides
# ---------------------------------------------------------------------------

@app.get("/clients/{client_id}/flat-weights")
def get_client_flat_weights(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Return effective flat weights for a client.

    Shows wizard-derived weights, broker overrides, and final effective weights.
    """
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()

    sw = build_structured_wizard(profile)
    wizard_weights = derive_flat_weights_from_wizard(sw)
    broker_overrides = profile.broker_weight_overrides_json if profile else None
    effective = merge_broker_weight_overrides(wizard_weights, broker_overrides)
    pref = sw.preferences
    skip_categories = {
        "standards": pref.skip_standards,
        "amenities": pref.skip_amenities,
        "noise": pref.skip_noise,
        "walkability": pref.skip_walkability,
    }

    return {
        "wizard_weights": wizard_weights,
        "broker_overrides": broker_overrides,
        "effective_weights": effective,
        "skip_categories": skip_categories,
        "defaults": FLAT_WEIGHT_DEFAULTS,
        "labels": FLAT_WEIGHT_LABELS,
        "categories": FLAT_WEIGHT_CATEGORIES,
    }


@app.put("/clients/{client_id}/flat-weights/broker-overrides")
def set_client_broker_weight_overrides(
    client_id: int,
    body: dict[str, Any],
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Set broker's manual weight overrides for a client.

    Body: {"price_distance": 20, "walkability": 5, ...}
    Only include keys you want to override.
    """
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if not profile:
        profile = ClientProfile(client_id=client.id)
        db.add(profile)

    # Validate: only accept known flat weight keys, numeric values
    clean: dict[str, float] = {}
    for k, v in body.items():
        if k in FLAT_WEIGHT_DEFAULTS and v is not None:
            clean[k] = float(v)

    profile.broker_weight_overrides_json = clean if clean else None
    db.commit()
    db.refresh(profile)

    # Return effective weights
    sw = build_structured_wizard(profile)
    wizard_weights = derive_flat_weights_from_wizard(sw)
    effective = merge_broker_weight_overrides(wizard_weights, profile.broker_weight_overrides_json)

    return {
        "broker_overrides": profile.broker_weight_overrides_json,
        "effective_weights": effective,
    }


@app.delete("/clients/{client_id}/flat-weights/broker-overrides")
def delete_client_broker_weight_overrides(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Remove broker's weight overrides, reverting to wizard-derived weights."""
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()
    if profile and profile.broker_weight_overrides_json is not None:
        profile.broker_weight_overrides_json = None
        db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Scoring thresholds — recommendation visibility config
# ---------------------------------------------------------------------------

@app.get("/admin/scoring-thresholds")
def get_scoring_thresholds(db: DbSession) -> dict[str, Any]:
    """Return the current recommendation visibility thresholds."""
    row = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    stored = row.thresholds_json if row else None
    return {"thresholds": resolve_thresholds(stored)}


@app.put("/admin/scoring-thresholds")
def set_scoring_thresholds(body: dict[str, Any], db: DbSession) -> dict[str, Any]:
    """Set recommendation visibility thresholds."""
    row = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    # Validate: only accept known keys, preserve int type for integer-valued keys
    _int_keys = {"not_seen_max_days", "hide_stale_reservations"}
    clean: dict[str, int | float] = {}
    for k in DEFAULT_THRESHOLDS:
        if k in body and body[k] is not None:
            clean[k] = int(body[k]) if k in _int_keys else float(body[k])
    if row:
        row.thresholds_json = clean
    else:
        row = ScoringConfig(config_json=DEFAULT_WEIGHTS, thresholds_json=clean)
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"thresholds": resolve_thresholds(row.thresholds_json)}


# ---------------------------------------------------------------------------
# Scoring Studio — unified config API
# ---------------------------------------------------------------------------

@app.get("/admin/scoring-studio")
def get_scoring_studio_config(db: DbSession) -> dict[str, Any]:
    """Return the complete resolved scoring studio config."""
    config = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    return {
        "weights": resolve_weights(config.config_json if config else None, None),
        "thresholds": resolve_thresholds(config.thresholds_json if config else None),
        "groups": resolve_groups(config.groups_json if config else None),
        "field_rules": resolve_field_rules(config.field_rules_json if config else None),
        "eligibility_rules": resolve_eligibility_rules(config.eligibility_rules_json if config else None),
    }


@app.put("/admin/scoring-studio")
def update_scoring_studio_config(payload: dict[str, Any], db: DbSession) -> dict[str, Any]:
    """Save the complete scoring studio config."""
    config = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    if not config:
        config = ScoringConfig(config_json=DEFAULT_WEIGHTS)
        db.add(config)
    if "weights" in payload:
        config.config_json = payload["weights"]
    if "thresholds" in payload:
        config.thresholds_json = payload["thresholds"]
    if "groups" in payload:
        config.groups_json = payload["groups"]
    if "field_rules" in payload:
        config.field_rules_json = payload["field_rules"]
    if "eligibility_rules" in payload:
        config.eligibility_rules_json = payload["eligibility_rules"]
    db.commit()
    db.refresh(config)
    return {"status": "ok", "updated_at": str(config.updated_at)}


@app.post("/admin/scoring-studio/preview")
def preview_scoring_studio(payload: dict[str, Any], db: DbSession) -> dict[str, Any]:
    """Dry-run scoring comparison: active config vs draft config for a client."""
    client_id = payload.get("client_id")
    draft_config = payload.get("draft_config") or {}
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")

    # 1. Load client + profile
    client = db.execute(select(Client).where(Client.id == client_id)).scalars().first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client_id)
    ).scalars().first()

    # 2. Load active scoring config from DB
    active_cfg = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()

    active_weights = resolve_weights(
        active_cfg.config_json if active_cfg else None,
        profile.scoring_weights_json if profile else None,
    )
    active_thresholds = resolve_thresholds(
        active_cfg.thresholds_json if active_cfg else None
    )
    active_scoring_config = {
        "groups": active_cfg.groups_json if active_cfg else None,
        "field_rules": active_cfg.field_rules_json if active_cfg else None,
    }

    # 3. Build draft scoring config
    draft_weights = resolve_weights(
        draft_config.get("weights", active_cfg.config_json if active_cfg else None),
        profile.scoring_weights_json if profile else None,
    )
    draft_thresholds_raw = draft_config.get(
        "thresholds", active_cfg.thresholds_json if active_cfg else None
    )
    draft_thresholds = resolve_thresholds(draft_thresholds_raw)
    draft_scoring_config = {
        "groups": draft_config.get("groups", active_cfg.groups_json if active_cfg else None),
        "field_rules": draft_config.get("field_rules", active_cfg.field_rules_json if active_cfg else None),
    }

    # 4. Get all candidate units (same query as recompute)
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(_market_filter_from_config(draft_thresholds))
    )
    if profile:
        wiz_budget = ((profile.filter_json or {}).get("wizard", {}).get("budget", {}))
        price_tol_pct = wiz_budget.get("max_price_tolerance_pct", 0) or 0
        area_tol_pct = wiz_budget.get("max_area_tolerance_pct", 0) or 0
        if profile.budget_min is not None:
            q = q.where(Unit.price_czk >= profile.budget_min)
        if profile.budget_max is not None:
            effective_budget_max = int(profile.budget_max * (1 + price_tol_pct / 100))
            q = q.where(Unit.price_czk <= effective_budget_max)
        if profile.area_min is not None:
            effective_area_min = profile.area_min * (1 - area_tol_pct / 100)
            q = q.where(Unit.floor_area_m2 >= effective_area_min)
        if profile.area_max is not None:
            q = q.where(Unit.floor_area_m2 <= profile.area_max)
        prop_type = profile.property_type
        if prop_type == "flat":
            q = q.where(func.lower(Unit.category).notin_(["house", "dům", "rodinný dům", "řadový dům"]))
        elif prop_type == "house":
            q = q.where(func.lower(Unit.category).in_(["house", "dům", "rodinný dům", "řadový dům"]))

    rows = db.execute(q.order_by(Unit.id)).all()

    # Layout filter
    pref_layout_buckets: list[str] = []
    if profile and profile.layouts and "values" in profile.layouts:
        pref_layout_buckets = [str(v).strip().lower() for v in (profile.layouts.get("values") or [])]

    # Thresholds
    active_hide = float(active_thresholds["hide_below_score"])
    active_strong = float(active_thresholds["strong_pick_min_score"])
    active_review = float(active_thresholds["review_pick_min_score"])
    active_limit = int(active_thresholds["default_visible_limit"]) or 100

    draft_hide = float(draft_thresholds["hide_below_score"])
    draft_strong = float(draft_thresholds["strong_pick_min_score"])
    draft_review = float(draft_thresholds["review_pick_min_score"])
    draft_limit = int(draft_thresholds["default_visible_limit"]) or 100

    def _bucket(score: float, strong: float, review: float, hide: float) -> str:
        if score < hide:
            return "hidden"
        if score >= strong:
            return "strong"
        if score >= review:
            return "review"
        return "fallback"

    # 5. Score all units with both configs
    active_scored: list[tuple[float, int, str, str, str]] = []  # (score, unit_id, project_name, unit_name, bucket)
    draft_scored: list[tuple[float, int, str, str, str]] = []

    for unit, project in rows:
        if pref_layout_buckets:
            if unit.layout is None:
                continue
            unit_bucket = str(unit.layout).strip().lower()
            if unit_bucket not in pref_layout_buckets:
                continue

        # Active score
        active_result = compute_full_score(
            unit, project, profile, weights=active_weights, db=db,
            scoring_config=active_scoring_config,
        )
        active_score = active_result["score"]

        # Draft score
        draft_result = compute_full_score(
            unit, project, profile, weights=draft_weights, db=db,
            scoring_config=draft_scoring_config,
        )
        draft_score = draft_result["score"]

        unit_name = unit.name or f"#{unit.id}"
        project_name = project.name or f"P#{project.id}"

        ab = _bucket(active_score, active_strong, active_review, active_hide)
        db_ = _bucket(draft_score, draft_strong, draft_review, draft_hide)

        active_scored.append((active_score, unit.id, project_name, unit_name, ab))
        draft_scored.append((draft_score, unit.id, project_name, unit_name, db_))

    # Build lookup maps
    active_map: dict[int, tuple[float, str, str, str]] = {}
    for s, uid, pn, un, b in active_scored:
        active_map[uid] = (s, pn, un, b)

    draft_map: dict[int, tuple[float, str, str, str]] = {}
    for s, uid, pn, un, b in draft_scored:
        draft_map[uid] = (s, pn, un, b)

    # Active visible = score >= hide, sorted, limited
    active_visible_ids = set()
    active_sorted = sorted(active_scored, key=lambda t: t[0], reverse=True)
    active_eligible = [(s, uid, pn, un, b) for s, uid, pn, un, b in active_sorted if b != "hidden"]
    for i, (s, uid, pn, un, b) in enumerate(active_eligible[:active_limit]):
        active_visible_ids.add(uid)

    draft_visible_ids = set()
    draft_sorted = sorted(draft_scored, key=lambda t: t[0], reverse=True)
    draft_eligible = [(s, uid, pn, un, b) for s, uid, pn, un, b in draft_sorted if b != "hidden"]
    for i, (s, uid, pn, un, b) in enumerate(draft_eligible[:draft_limit]):
        draft_visible_ids.add(uid)

    # Summaries
    def _summary(eligible_list):
        counts = {"strong": 0, "review": 0, "fallback": 0}
        for s, uid, pn, un, b in eligible_list:
            if b in counts:
                counts[b] += 1
        return {"total": len(eligible_list), **counts}

    active_summary = _summary(active_eligible[:active_limit])
    draft_summary = _summary(draft_eligible[:draft_limit])

    # 6. Build comparison for all units in either visible set
    all_unit_ids = active_visible_ids | draft_visible_ids
    comparison = []
    for uid in all_unit_ids:
        a = active_map.get(uid)
        d = draft_map.get(uid)
        old_score = round(a[0], 1) if a else 0
        new_score = round(d[0], 1) if d else 0
        project_name = (a or d)[1]
        unit_name = (a or d)[2]
        old_bucket = a[3] if a else "hidden"
        new_bucket = d[3] if d else "hidden"
        delta = round(new_score - old_score, 1)
        comparison.append({
            "unit_id": uid,
            "project_name": project_name,
            "unit_name": unit_name,
            "old_score": old_score,
            "new_score": new_score,
            "old_bucket": old_bucket,
            "new_bucket": new_bucket,
            "delta": delta,
        })

    # Sort by absolute delta descending
    comparison.sort(key=lambda x: abs(x["delta"]), reverse=True)

    # Top movers
    top_movers_up = sorted(
        [c for c in comparison if c["delta"] > 0],
        key=lambda x: x["delta"], reverse=True,
    )[:10]
    top_movers_down = sorted(
        [c for c in comparison if c["delta"] < 0],
        key=lambda x: x["delta"],
    )[:10]

    # Newly visible / hidden
    newly_visible = [
        c for c in comparison
        if c["unit_id"] in draft_visible_ids and c["unit_id"] not in active_visible_ids
    ]
    newly_hidden = [
        c for c in comparison
        if c["unit_id"] in active_visible_ids and c["unit_id"] not in draft_visible_ids
    ]

    return {
        "client_id": client_id,
        "active_summary": active_summary,
        "draft_summary": draft_summary,
        "comparison": comparison[:50],  # limit response size
        "top_movers_up": top_movers_up,
        "top_movers_down": top_movers_down,
        "newly_visible": newly_visible,
        "newly_hidden": newly_hidden,
    }


# ---------------------------------------------------------------------------
# Future Projects
# ---------------------------------------------------------------------------

class FutureProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str
    is_visible: bool
    sort_order: int
    # Core fields
    developer: str | None = None
    address: str | None = None
    stage: str | None = None
    total_units: int | None = None
    date_sale_start: str | None = None
    construction_completion: str | None = None
    project_type: str | None = None
    url: str | None = None
    renovation: bool | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    city: str | None = None
    municipal_district: str | None = None
    region: str | None = None
    # JSON fields
    public_data_json: dict | None = None
    internal_data_json: dict | None = None
    interest_count: int = 0
    created_at: datetime
    updated_at: datetime


class FutureProjectCreateBody(BaseModel):
    name: str
    slug: str | None = None
    is_visible: bool = True
    sort_order: int = 0
    developer: str | None = None
    address: str | None = None
    stage: str | None = None
    total_units: int | None = None
    date_sale_start: str | None = None
    construction_completion: str | None = None
    project_type: str | None = None
    url: str | None = None
    renovation: bool | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    city: str | None = None
    municipal_district: str | None = None
    region: str | None = None
    public_data_json: dict | None = None
    internal_data_json: dict | None = None


class FutureProjectUpdateBody(BaseModel):
    name: str | None = None
    slug: str | None = None
    is_visible: bool | None = None
    sort_order: int | None = None
    developer: str | None = None
    address: str | None = None
    stage: str | None = None
    total_units: int | None = None
    date_sale_start: str | None = None
    construction_completion: str | None = None
    project_type: str | None = None
    url: str | None = None
    renovation: bool | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    city: str | None = None
    municipal_district: str | None = None
    region: str | None = None
    public_data_json: dict | None = None
    internal_data_json: dict | None = None


def _slugify(name: str) -> str:
    import re, unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[-\s]+", "-", s)


def _fp_summary(fp: FutureProject, interest_count: int = 0) -> FutureProjectSummary:
    return FutureProjectSummary(
        id=fp.id, name=fp.name, slug=fp.slug, is_visible=fp.is_visible,
        sort_order=fp.sort_order,
        developer=fp.developer, address=fp.address, stage=fp.stage,
        total_units=fp.total_units, date_sale_start=fp.date_sale_start,
        construction_completion=fp.construction_completion,
        project_type=fp.project_type, url=fp.url, renovation=fp.renovation,
        gps_latitude=float(fp.gps_latitude) if fp.gps_latitude is not None else None,
        gps_longitude=float(fp.gps_longitude) if fp.gps_longitude is not None else None,
        city=fp.city, municipal_district=fp.municipal_district, region=fp.region,
        public_data_json=fp.public_data_json,
        internal_data_json=fp.internal_data_json, interest_count=interest_count,
        created_at=fp.created_at, updated_at=fp.updated_at,
    )


@app.get("/future-projects", response_model=list[FutureProjectSummary])
def list_future_projects(
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
    include_hidden: bool = False,
) -> list[FutureProjectSummary]:
    q = select(FutureProject)
    if not include_hidden:
        q = q.where(FutureProject.is_visible.is_(True))
    fps = db.execute(q.order_by(FutureProject.sort_order, FutureProject.name)).scalars().all()
    counts: dict[int, int] = {}
    if fps:
        rows = db.execute(
            select(FutureProjectInterest.future_project_id, func.count())
            .where(FutureProjectInterest.future_project_id.in_([f.id for f in fps]))
            .group_by(FutureProjectInterest.future_project_id)
        ).all()
        counts = {r[0]: r[1] for r in rows}
    return [_fp_summary(fp, counts.get(fp.id, 0)) for fp in fps]


@app.get("/future-projects/by-slug/{slug}", response_model=FutureProjectSummary)
def get_future_project_by_slug(
    slug: str,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> FutureProjectSummary:
    fp = db.execute(
        select(FutureProject).where(FutureProject.slug == slug, FutureProject.is_visible.is_(True))
    ).scalar_one_or_none()
    if not fp:
        raise HTTPException(status_code=404, detail="Future project not found")
    count = db.execute(
        select(func.count()).where(FutureProjectInterest.future_project_id == fp.id)
    ).scalar_one()
    return _fp_summary(fp, count)


@app.get("/future-projects/{fp_id:int}", response_model=FutureProjectSummary)
def get_future_project(
    fp_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> FutureProjectSummary:
    fp = db.get(FutureProject, fp_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Future project not found")
    count = db.execute(
        select(func.count()).where(FutureProjectInterest.future_project_id == fp.id)
    ).scalar_one()
    return _fp_summary(fp, count)


@app.post("/future-projects", response_model=FutureProjectSummary, status_code=201)
def create_future_project(
    body: FutureProjectCreateBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> FutureProjectSummary:
    slug = body.slug or _slugify(body.name)
    fp = FutureProject(
        name=body.name, slug=slug, is_visible=body.is_visible,
        sort_order=body.sort_order,
        developer=body.developer, address=body.address, stage=body.stage,
        total_units=body.total_units, date_sale_start=body.date_sale_start,
        construction_completion=body.construction_completion,
        project_type=body.project_type, url=body.url, renovation=body.renovation,
        gps_latitude=body.gps_latitude, gps_longitude=body.gps_longitude,
        city=body.city, municipal_district=body.municipal_district, region=body.region,
        public_data_json=body.public_data_json,
        internal_data_json=body.internal_data_json,
    )
    db.add(fp)
    db.commit()
    db.refresh(fp)
    return _fp_summary(fp)


@app.patch("/future-projects/{fp_id:int}", response_model=FutureProjectSummary)
def update_future_project(
    fp_id: int,
    body: FutureProjectUpdateBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> FutureProjectSummary:
    fp = db.get(FutureProject, fp_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Future project not found")
    for field in [
        "name", "slug", "is_visible", "sort_order",
        "developer", "address", "stage", "total_units",
        "date_sale_start", "construction_completion", "project_type", "url",
        "renovation", "gps_latitude", "gps_longitude",
        "city", "municipal_district", "region",
        "public_data_json", "internal_data_json",
    ]:
        val = getattr(body, field)
        if val is not None:
            setattr(fp, field, val)
    db.add(fp)
    db.commit()
    db.refresh(fp)
    count = db.execute(
        select(func.count()).where(FutureProjectInterest.future_project_id == fp.id)
    ).scalar_one()
    return _fp_summary(fp, count)


@app.delete("/future-projects/{fp_id:int}", status_code=204)
def delete_future_project(
    fp_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    fp = db.get(FutureProject, fp_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Future project not found")
    db.delete(fp)
    db.commit()


# --- Future Project CSV Import ---

FUTURE_PROJECT_CORE_FIELDS: dict[str, str] = {
    "name": "str",
    "developer": "str",
    "address": "str",
    "city": "str",
    "municipal_district": "str",
    "region": "str",
    "stage": "str",
    "total_units": "int",
    "date_sale_start": "str",
    "construction_completion": "str",
    "project_type": "str",
    "url": "str",
    "renovation": "bool",
    "gps_latitude": "float",
    "gps_longitude": "float",
}


class CsvPreviewResponse(BaseModel):
    headers: list[str]
    sample_rows: list[list[str]]
    total_rows: int


class CsvImportMapping(BaseModel):
    csv_header: str
    target_field: str  # core field name, "public_data_json.<key>", "internal_data_json.<key>", or "__skip__"


class CsvImportRequest(BaseModel):
    headers: list[str]
    rows: list[list[str]]
    mapping: list[CsvImportMapping]


class CsvImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]


# --- One-shot CSV upsert (preferred — used by /admin/future-projects/import) ---
#
# CSV header → FutureProject column mapping. Anything not listed here goes to
# public_data_json[<csv_header>] verbatim. Empty cells are skipped (don't
# overwrite existing values with blanks).
_FP_COLUMN_ALIASES: dict[str, str] = {
    "project": "name",
    "name": "name",
    "developer": "developer",
    "address": "address",
    "city": "city",
    "region": "region",
    "stage": "stage",
    "total_number_of_units": "total_units",
    "total_units": "total_units",
    "date_sale_start": "date_sale_start",
    "construction_completion": "construction_completion",
    "type": "project_type",
    "project_type": "project_type",
    "url": "url",
    "renovation": "renovation",
    "gps_latitude": "gps_latitude",
    "gps_longitude": "gps_longitude",
    "municipal_district": "municipal_district",
}

_FP_BOOL_TRUE = {"true", "1", "yes", "ano", "y"}
_FP_BOOL_FALSE = {"false", "0", "no", "ne", "n"}


def _coerce_fp_value(target: str, raw: str) -> Any:
    """Coerce a CSV cell to the FutureProject column's expected python type."""
    s = (raw or "").strip()
    if s == "":
        return None
    if target == "total_units":
        try:
            return int(float(s))
        except ValueError:
            return None
    if target in ("gps_latitude", "gps_longitude"):
        try:
            return float(s)
        except ValueError:
            return None
    if target == "renovation":
        low = s.lower()
        if low in _FP_BOOL_TRUE:
            return True
        if low in _FP_BOOL_FALSE:
            return False
        # Source CSV has values like 'newly_built' / 'renovation' — treat
        # 'renovation' as True, anything else (when set) as False so the bool
        # column is informative rather than null.
        if low == "renovation":
            return True
        return False
    return s


@app.post("/future-projects/import-csv", response_model=CsvImportResult)
async def fp_import_csv(
    db: DbSession,
    file: UploadFile = File(...),
    broker: Any = Depends(get_current_broker),
):
    """Single-step upsert: upload one CSV and the backend handles the rest.

    - Header columns are auto-mapped via _FP_COLUMN_ALIASES; the rest are
      stored under public_data_json[<header>].
    - Match by case-insensitive trimmed `name`. If the project exists we
      update non-empty cells (existing values preserved when CSV cell is empty).
    - public_data_json is merged shallowly (new keys overwrite, untouched keys
      preserved).
    """
    import csv as _csv
    import io as _io

    raw = await file.read()
    text = raw.decode("utf-8-sig", errors="replace")
    sample = text[:2000]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = _csv.reader(_io.StringIO(text), delimiter=delimiter)
    all_rows = list(reader)
    if not all_rows:
        raise HTTPException(status_code=400, detail="CSV is empty")
    headers = [(h or "").strip() for h in all_rows[0]]
    data_rows = all_rows[1:]

    # Find name column index — required.
    name_col_idx: int | None = None
    for i, h in enumerate(headers):
        if h.lower() in ("name", "project"):
            name_col_idx = i
            break
    if name_col_idx is None:
        raise HTTPException(status_code=400, detail="CSV must have a 'project' or 'name' column")

    created = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for row_num, row in enumerate(data_rows, start=2):
        try:
            # Normalize row length.
            if len(row) < len(headers):
                row = row + [""] * (len(headers) - len(row))
            name = (row[name_col_idx] or "").strip()
            if not name:
                skipped += 1
                continue

            core_updates: dict[str, Any] = {}
            public_updates: dict[str, Any] = {}

            for i, h in enumerate(headers):
                if i == name_col_idx:
                    continue
                val_raw = row[i] if i < len(row) else ""
                cell = (val_raw or "").strip()
                if cell == "":
                    continue
                target = _FP_COLUMN_ALIASES.get(h.lower())
                if target is not None:
                    coerced = _coerce_fp_value(target, cell)
                    if coerced is not None:
                        core_updates[target] = coerced
                else:
                    # Goes to public_data_json under the original CSV header key.
                    public_updates[h] = cell

            # Match existing by case-insensitive name.
            existing = db.execute(
                select(FutureProject).where(func.lower(FutureProject.name) == name.lower())
            ).scalars().first()

            if existing is not None:
                for k, v in core_updates.items():
                    setattr(existing, k, v)
                # Always keep authoritative `name` exactly as CSV (handles case fixes).
                existing.name = name
                if public_updates:
                    merged = dict(existing.public_data_json or {})
                    merged.update(public_updates)
                    existing.public_data_json = merged
                db.add(existing)
                updated += 1
            else:
                base_slug = _slugify(name) or f"project-{row_num}"
                slug = base_slug
                # Resolve slug collisions deterministically.
                n = 2
                while db.execute(select(FutureProject.id).where(FutureProject.slug == slug)).first() is not None:
                    slug = f"{base_slug}-{n}"
                    n += 1
                fp = FutureProject(
                    name=name,
                    slug=slug,
                    is_visible=True,
                    sort_order=0,
                    public_data_json=public_updates or None,
                    **core_updates,
                )
                db.add(fp)
                created += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Řádek {row_num}: {exc.__class__.__name__}: {exc}")

    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        errors.append(f"Commit failed: {exc.__class__.__name__}: {exc}")

    return CsvImportResult(created=created, updated=updated, skipped=skipped, errors=errors)


@app.post("/future-projects/import-preview", response_model=CsvPreviewResponse)
async def fp_import_preview(
    file: UploadFile = File(...),
    broker: Any = Depends(get_current_broker),
):
    import csv, io
    content = (await file.read()).decode("utf-8-sig")
    # Auto-detect delimiter
    sample = content[:2000]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.reader(io.StringIO(content), delimiter=delimiter)
    all_rows = list(reader)
    if not all_rows:
        raise HTTPException(status_code=400, detail="CSV is empty")
    headers = all_rows[0]
    data_rows = all_rows[1:]
    sample_rows = data_rows[:10]
    return CsvPreviewResponse(headers=headers, sample_rows=sample_rows, total_rows=len(data_rows))


@app.post("/future-projects/import", response_model=CsvImportResult)
def fp_import(
    body: CsvImportRequest,
    db: DbSession,
    broker: Any = Depends(get_current_broker),
):
    # Build header→index map
    h_idx = {h: i for i, h in enumerate(body.headers)}
    # Build mapping instructions
    mappings: list[tuple[int, str, str]] = []  # (csv_col_index, target, type)
    for m in body.mapping:
        if m.target_field == "__skip__" or m.csv_header not in h_idx:
            continue
        mappings.append((h_idx[m.csv_header], m.target_field, ""))

    created = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for row_num, row in enumerate(body.rows, start=2):  # row 1 = header
        core: dict[str, Any] = {}
        public_data: dict[str, Any] = {}
        internal_data: dict[str, Any] = {}

        for col_idx, target, _ in mappings:
            if col_idx >= len(row):
                continue
            val = row[col_idx].strip()
            if not val:
                continue

            if target.startswith("public_data_json."):
                key = target[len("public_data_json."):]
                public_data[key] = val
            elif target.startswith("internal_data_json."):
                key = target[len("internal_data_json."):]
                internal_data[key] = val
            elif target in FUTURE_PROJECT_CORE_FIELDS:
                ftype = FUTURE_PROJECT_CORE_FIELDS[target]
                try:
                    if ftype == "int":
                        core[target] = int(float(val))
                    elif ftype == "float":
                        core[target] = float(val.replace(",", "."))
                    elif ftype == "bool":
                        core[target] = val.lower() in ("true", "1", "ano", "yes")
                    else:
                        core[target] = val
                except (ValueError, TypeError):
                    errors.append(f"Row {row_num}: invalid value '{val}' for {target}")
                    continue

        if "name" not in core or not core["name"]:
            errors.append(f"Row {row_num}: missing required field 'name'")
            continue

        # Duplicate check: first by slug, then by name
        slug = _slugify(core["name"])
        existing = db.execute(
            select(FutureProject).where(FutureProject.slug == slug)
        ).scalar_one_or_none()
        if not existing:
            existing = db.execute(
                select(FutureProject).where(FutureProject.name == core["name"])
            ).scalar_one_or_none()

        if existing:
            # Update existing project with new values
            changed = False
            for field in FUTURE_PROJECT_CORE_FIELDS:
                if field in core and field != "name":
                    old_val = getattr(existing, field, None)
                    new_val = core[field]
                    if old_val != new_val:
                        setattr(existing, field, new_val)
                        changed = True
            if public_data:
                merged = dict(existing.public_data_json or {})
                merged.update(public_data)
                if merged != (existing.public_data_json or {}):
                    existing.public_data_json = merged
                    changed = True
            if internal_data:
                merged = dict(existing.internal_data_json or {})
                merged.update(internal_data)
                if merged != (existing.internal_data_json or {}):
                    existing.internal_data_json = merged
                    changed = True
            if changed:
                db.add(existing)
                updated += 1
            else:
                skipped += 1
            continue

        fp = FutureProject(
            name=core["name"],
            slug=slug,
            developer=core.get("developer"),
            address=core.get("address"),
            city=core.get("city"),
            municipal_district=core.get("municipal_district"),
            region=core.get("region"),
            stage=core.get("stage"),
            total_units=core.get("total_units"),
            date_sale_start=core.get("date_sale_start"),
            construction_completion=core.get("construction_completion"),
            project_type=core.get("project_type"),
            url=core.get("url"),
            renovation=core.get("renovation"),
            gps_latitude=core.get("gps_latitude"),
            gps_longitude=core.get("gps_longitude"),
            public_data_json=public_data or None,
            internal_data_json=internal_data or None,
        )
        db.add(fp)
        created += 1

    if created > 0:
        db.commit()

    return CsvImportResult(created=created, updated=updated, skipped=skipped, errors=errors)


# --- Future Project Interests ---

class InterestItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    future_project_id: int
    client_id: int | None
    client_name: str | None = None
    broker_id: int
    status: str
    note: str | None
    created_at: datetime


class InterestCreateBody(BaseModel):
    client_id: int | None = None
    status: str = "interested"
    note: str | None = None


@app.get("/future-projects/{fp_id:int}/interests", response_model=list[InterestItem])
def list_interests(
    fp_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> list[InterestItem]:
    fp = db.get(FutureProject, fp_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Future project not found")
    rows = db.execute(
        select(FutureProjectInterest, Client)
        .outerjoin(Client, FutureProjectInterest.client_id == Client.id)
        .where(FutureProjectInterest.future_project_id == fp_id)
        .order_by(FutureProjectInterest.created_at.desc())
    ).all()
    return [
        InterestItem(
            id=i.id, future_project_id=i.future_project_id,
            client_id=i.client_id, client_name=c.name if c else None,
            broker_id=i.broker_id, status=i.status, note=i.note,
            created_at=i.created_at,
        )
        for i, c in rows
    ]


@app.post("/future-projects/{fp_id:int}/interests", response_model=InterestItem, status_code=201)
def create_interest(
    fp_id: int,
    body: InterestCreateBody,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> InterestItem:
    fp = db.get(FutureProject, fp_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Future project not found")
    interest = FutureProjectInterest(
        future_project_id=fp_id, client_id=body.client_id,
        broker_id=broker.id, status=body.status, note=body.note,
    )
    db.add(interest)
    db.commit()
    db.refresh(interest)
    client_name = None
    if interest.client_id:
        cl = db.get(Client, interest.client_id)
        client_name = cl.name if cl else None
    return InterestItem(
        id=interest.id, future_project_id=interest.future_project_id,
        client_id=interest.client_id, client_name=client_name,
        broker_id=interest.broker_id, status=interest.status,
        note=interest.note, created_at=interest.created_at,
    )


@app.delete("/future-projects/{fp_id:int}/interests/{interest_id:int}", status_code=204)
def delete_interest(
    fp_id: int,
    interest_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> None:
    interest = db.get(FutureProjectInterest, interest_id)
    if not interest or interest.future_project_id != fp_id:
        raise HTTPException(status_code=404, detail="Interest not found")
    db.delete(interest)
    db.commit()


# ===========================================================================
# Client Portal Auth
# ===========================================================================

def get_current_portal_client(
    db: DbSession,
    authorization: str = Header(default=""),
) -> Client:
    """Authenticate a portal client via session token."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    session = db.execute(
        select(ClientPortalSession).where(ClientPortalSession.token == token)
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=401, detail="Invalid token")
    from datetime import timezone as _tz
    if session.expires_at < datetime.now(_tz.utc):
        raise HTTPException(status_code=401, detail="Token expired")
    client = db.get(Client, session.client_id)
    if not client:
        raise HTTPException(status_code=401, detail="Client not found")
    return client


class PortalInviteResponse(BaseModel):
    magic_link_url: str
    token: str
    expires_at: datetime


@app.post("/clients/{client_id}/portal-invite", response_model=PortalInviteResponse)
def create_portal_invite(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> PortalInviteResponse:
    """Broker generates a magic link for a client to access the portal."""
    client = db.get(Client, client_id)
    if not client or client.broker_id != broker.id:
        raise HTTPException(status_code=404, detail="Client not found")
    if not client.email:
        raise HTTPException(status_code=400, detail="Client has no email address")

    import secrets
    from datetime import timezone as _tz
    from .settings import settings

    # Invalidate any existing unused magic links for this client
    for old in db.execute(
        select(ClientMagicLink).where(
            ClientMagicLink.client_id == client.id,
            ClientMagicLink.used_at.is_(None),
        )
    ).scalars().all():
        old.used_at = datetime.now(_tz.utc)

    token = secrets.token_urlsafe(32)
    expires = datetime.now(_tz.utc) + timedelta(hours=24)
    link = ClientMagicLink(
        client_id=client.id, token=token, expires_at=expires,
    )
    db.add(link)
    db.commit()

    magic_url = f"{settings.frontend_url.rstrip('/')}/portal/login?token={token}"
    return PortalInviteResponse(magic_link_url=magic_url, token=token, expires_at=expires)


class PortalAuthRequest(BaseModel):
    token: str


class PortalAuthResponse(BaseModel):
    session_token: str
    client_id: int
    client_name: str
    expires_at: datetime


@app.post("/portal/auth", response_model=PortalAuthResponse)
def portal_auth(
    body: PortalAuthRequest,
    db: DbSession,
) -> PortalAuthResponse:
    """Exchange a magic link token for a portal session."""
    link = db.execute(
        select(ClientMagicLink).where(ClientMagicLink.token == body.token)
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=401, detail="Invalid token")
    if link.used_at is not None:
        raise HTTPException(status_code=401, detail="Token already used")
    from datetime import timezone as _tz
    if link.expires_at < datetime.now(_tz.utc):
        raise HTTPException(status_code=401, detail="Token expired")

    # Mark magic link as used
    link.used_at = datetime.now(_tz.utc)

    # Create portal session (30 days)
    import secrets
    session_token = secrets.token_urlsafe(32)
    session_expires = datetime.now(_tz.utc) + timedelta(days=30)
    session = ClientPortalSession(
        client_id=link.client_id, token=session_token, expires_at=session_expires,
    )
    db.add(session)
    db.commit()

    client = db.get(Client, link.client_id)
    return PortalAuthResponse(
        session_token=session_token,
        client_id=client.id,
        client_name=client.name,
        expires_at=session_expires,
    )


class PortalMeResponse(BaseModel):
    id: int
    name: str
    email: str | None
    broker_name: str | None


@app.get("/portal/me", response_model=PortalMeResponse)
def portal_me(
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
) -> PortalMeResponse:
    broker = db.get(Broker, client.broker_id)
    return PortalMeResponse(
        id=client.id,
        name=client.name,
        email=client.email,
        broker_name=broker.name if broker else None,
    )


# --- Portal: My Preferences ---


class PortalPreferenceItem(BaseModel):
    key: str
    label: str
    value: str  # human-readable value
    filter_type: str  # "max" | "min" | "in" | "bool" | "exclude_floor"
    raw_value: float | None = None  # numeric value for filtering


class PortalCommutePoint(BaseModel):
    label: str
    mode: str | None = None

class PortalPreferencesResponse(BaseModel):
    items: list[PortalPreferenceItem]
    active_poi_prefs: list[str] = []
    commute_points: list[PortalCommutePoint] = []
    commute_mode: str | None = None
    commute_primary_index: int | None = None


@app.get("/portal/my-preferences", response_model=PortalPreferencesResponse)
def portal_my_preferences(
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
) -> PortalPreferencesResponse:
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalar_one_or_none()
    if not profile:
        return PortalPreferencesResponse(items=[])

    sw = build_structured_wizard(profile)
    hf = sw.hard_filters
    pref = sw.preferences
    items: list[PortalPreferenceItem] = []

    if hf.budget_max:
        label_val = f"do {hf.budget_max / 1_000_000:.1f} mil. K\u010d"
        if hf.budget_max_tolerance_pct:
            label_val += f" (\u00b1{int(hf.budget_max_tolerance_pct)}%)"
        effective = hf.budget_max
        if hf.budget_max_tolerance_pct:
            effective = int(hf.budget_max * (1 + hf.budget_max_tolerance_pct / 100))
        items.append(PortalPreferenceItem(
            key="budget_max", label="Rozpo\u010det", value=label_val,
            filter_type="max", raw_value=float(effective),
        ))

    if hf.area_min:
        label_val = f"od {hf.area_min:.0f} m\u00b2"
        if hf.area_min_tolerance_pct:
            label_val += f" (\u00b1{int(hf.area_min_tolerance_pct)}%)"
        effective = hf.area_min
        if hf.area_min_tolerance_pct:
            effective = hf.area_min * (1 - hf.area_min_tolerance_pct / 100)
        items.append(PortalPreferenceItem(
            key="area_min", label="Min. plocha", value=label_val,
            filter_type="min", raw_value=float(effective),
        ))

    if hf.layouts:
        items.append(PortalPreferenceItem(
            key="layouts", label="Dispozice", value=", ".join(hf.layouts),
            filter_type="in", raw_value=None,
        ))

    if hf.outdoor_area_min:
        label_val = f"od {hf.outdoor_area_min:.0f} m\u00b2"
        effective = hf.outdoor_area_min
        if hf.outdoor_area_min_tolerance_pct:
            effective = hf.outdoor_area_min * (1 - hf.outdoor_area_min_tolerance_pct / 100)
            label_val += f" (\u00b1{int(hf.outdoor_area_min_tolerance_pct)}%)"
        items.append(PortalPreferenceItem(
            key="outdoor_area_min", label="Min. venkovn\u00ed plocha", value=label_val,
            filter_type="min", raw_value=float(effective),
        ))

    if hf.exclude_ground_floor:
        items.append(PortalPreferenceItem(
            key="exclude_ground_floor", label="Bez p\u0159\u00edzem\u00ed", value="ano",
            filter_type="exclude_floor", raw_value=1.0,
        ))

    if hf.penthouse_only:
        items.append(PortalPreferenceItem(
            key="penthouse_only", label="Jen penthouse", value="ano",
            filter_type="bool", raw_value=None,
        ))

    if pref.ground_floor_sensitive and not hf.exclude_ground_floor:
        items.append(PortalPreferenceItem(
            key="prefer_no_ground", label="Raději bez přízemí", value="preference",
            filter_type="exclude_floor", raw_value=1.0,
        ))

    if hf.renovation_preference == "only_new":
        items.append(PortalPreferenceItem(
            key="only_new", label="Pouze novostavby", value="ano",
            filter_type="bool", raw_value=None,
        ))
    elif hf.renovation_preference == "only_renovation":
        items.append(PortalPreferenceItem(
            key="only_renovation", label="Pouze rekonstrukce", value="ano",
            filter_type="bool", raw_value=None,
        ))

    # ── Standards ──
    if hf.must_recuperation or pref.prefer_recuperation:
        level = "vy\u017eadov\u00e1no" if hf.must_recuperation else "preference"
        items.append(PortalPreferenceItem(
            key="recuperation", label="Rekuperace", value=level,
            filter_type="feature", raw_value=None,
        ))

    if hf.must_air_conditioning or pref.prefer_air_conditioning:
        level = "vy\u017eadov\u00e1no" if hf.must_air_conditioning else "preference"
        items.append(PortalPreferenceItem(
            key="air_conditioning", label="Klimatizace", value=level,
            filter_type="feature", raw_value=None,
        ))

    if hf.must_floor_heating or pref.prefer_floor_heating:
        level = "vy\u017eadov\u00e1no" if hf.must_floor_heating else "preference"
        items.append(PortalPreferenceItem(
            key="floor_heating", label="Podlahov\u00e9 topen\u00ed", value=level,
            filter_type="feature", raw_value=None,
        ))

    if hf.must_exterior_blinds or pref.prefer_exterior_blinds:
        level = "vy\u017eadov\u00e1no" if hf.must_exterior_blinds else "preference"
        items.append(PortalPreferenceItem(
            key="exterior_blinds", label="Venkovn\u00ed \u017ealuzie", value=level,
            filter_type="feature", raw_value=None,
        ))

    # ── Noise ──
    if hf.must_no_main_road or pref.prefer_no_main_road:
        level = "vy\u017eadov\u00e1no" if hf.must_no_main_road else "preference"
        items.append(PortalPreferenceItem(
            key="no_main_road", label="Bez hlavn\u00ed silnice", value=level,
            filter_type="noise_distance", raw_value=150.0,
        ))

    if hf.must_no_tram or pref.prefer_no_tram:
        level = "vy\u017eadov\u00e1no" if hf.must_no_tram else "preference"
        items.append(PortalPreferenceItem(
            key="no_tram", label="Bez tramvaje", value=level,
            filter_type="noise_distance", raw_value=100.0,
        ))

    if hf.must_no_railway or pref.prefer_no_railway:
        level = "vyžadováno" if hf.must_no_railway else "preference"
        items.append(PortalPreferenceItem(
            key="no_railway", label="Bez železnice", value=level,
            filter_type="noise_distance", raw_value=300.0,
        ))

    # ── Amenities ──
    _amenity_prefs = [
        ("bike_room", hf.must_bike_room, None, "Kolárna"),
        ("stroller_room", hf.must_stroller_room, None, "Kočárkárna"),
        ("fitness", hf.must_fitness, pref.prefer_fitness, "Fitness"),
        ("courtyard_garden", hf.must_courtyard_garden, pref.prefer_courtyard_garden, "Vnitroblok / zahrada"),
        ("reception", hf.must_reception, pref.prefer_reception, "Recepce"),
        ("concierge", hf.must_concierge, None, "Concierge"),
    ]
    for key, must, prefer_val, label in _amenity_prefs:
        if must:
            items.append(PortalPreferenceItem(
                key=key, label=label, value="vyžadováno",
                filter_type="amenity", raw_value=None,
            ))
        elif prefer_val and prefer_val == "prefer":
            items.append(PortalPreferenceItem(
                key=key, label=label, value="preference",
                filter_type="amenity", raw_value=None,
            ))

    # ── Attribute enums ──
    _enum_prefs = [
        ("windows", "Okna", pref.window_material),
        ("heating", "Topení", pref.heating_type),
        ("heating_source", "Zdroj vytápění", pref.heating_source),
        ("partition_walls", "Příčky", pref.partition_type),
        ("flooring", "Podlahy", pref.flooring),
    ]
    for key, label, val in _enum_prefs:
        if val:
            items.append(PortalPreferenceItem(
                key=key, label=label, value=val,
                filter_type="enum", raw_value=None,
            ))

    if pref.prefer_smart_home:
        items.append(PortalPreferenceItem(
            key="smart_home", label="Smart home", value="preference",
            filter_type="feature", raw_value=None,
        ))

    # ── Active POI preferences ──
    wprefs = profile.walkability_preferences_json or {}
    active_poi_prefs = [k for k, v in wprefs.items() if v in ("normal", "high", "required")]

    # ── Commute points & mode ──
    commute_points: list[PortalCommutePoint] = []
    cp_raw = profile.commute_points_json or {}
    cp_arr = cp_raw.get("points", []) if isinstance(cp_raw, dict) else cp_raw
    for pt in cp_arr:
        if isinstance(pt, dict) and pt.get("label"):
            commute_points.append(PortalCommutePoint(
                label=pt["label"],
                mode=pt.get("mode"),
            ))

    overrides = profile.portal_overrides_json or {}
    commute_mode = overrides.get("commute_mode")
    commute_primary_index = overrides.get("commute_primary_index")

    return PortalPreferencesResponse(
        items=items,
        active_poi_prefs=active_poi_prefs,
        commute_points=commute_points,
        commute_mode=commute_mode,
        commute_primary_index=commute_primary_index,
    )


# --- Portal: Future Projects ---

class PortalFutureProjectItem(BaseModel):
    id: int
    name: str
    slug: str
    developer: str | None = None
    city: str | None = None
    municipal_district: str | None = None
    stage: str | None = None
    total_units: int | None = None
    date_sale_start: str | None = None
    construction_completion: str | None = None
    project_type: str | None = None
    url: str | None = None
    renovation: bool | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    public_data_json: dict | None = None
    my_interest: bool = False


@app.get("/portal/future-projects", response_model=list[PortalFutureProjectItem])
def portal_list_future_projects(
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
) -> list[PortalFutureProjectItem]:
    fps = db.execute(
        select(FutureProject)
        .where(FutureProject.is_visible.is_(True))
        .order_by(FutureProject.sort_order, FutureProject.name)
    ).scalars().all()
    # Check which projects the client already expressed interest in
    interested_ids: set[int] = set()
    if fps:
        rows = db.execute(
            select(FutureProjectInterest.future_project_id).where(
                FutureProjectInterest.client_id == client.id,
                FutureProjectInterest.future_project_id.in_([f.id for f in fps]),
            )
        ).scalars().all()
        interested_ids = set(rows)
    return [
        PortalFutureProjectItem(
            id=fp.id, name=fp.name, slug=fp.slug,
            developer=fp.developer, city=fp.city,
            municipal_district=fp.municipal_district,
            stage=fp.stage, total_units=fp.total_units,
            date_sale_start=fp.date_sale_start,
            construction_completion=fp.construction_completion,
            project_type=fp.project_type, url=fp.url,
            renovation=fp.renovation,
            gps_latitude=float(fp.gps_latitude) if fp.gps_latitude is not None else None,
            gps_longitude=float(fp.gps_longitude) if fp.gps_longitude is not None else None,
            public_data_json=fp.public_data_json,
            my_interest=fp.id in interested_ids,
        )
        for fp in fps
    ]


class PortalInterestResponse(BaseModel):
    status: str  # "created" | "already_exists"
    interest_id: int


@app.post("/portal/future-projects/{fp_id}/interest", response_model=PortalInterestResponse)
def portal_create_interest(
    fp_id: int,
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
) -> PortalInterestResponse:
    fp = db.get(FutureProject, fp_id)
    if not fp or not fp.is_visible:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check for existing interest (anti-duplicate)
    existing = db.execute(
        select(FutureProjectInterest).where(
            FutureProjectInterest.future_project_id == fp_id,
            FutureProjectInterest.client_id == client.id,
        )
    ).scalar_one_or_none()
    if existing:
        return PortalInterestResponse(status="already_exists", interest_id=existing.id)

    interest = FutureProjectInterest(
        future_project_id=fp_id,
        client_id=client.id,
        broker_id=client.broker_id,
        status="interested",
    )
    db.add(interest)
    db.commit()
    db.refresh(interest)
    return PortalInterestResponse(status="created", interest_id=interest.id)


# ── Portal: Recommendations ────────────────────────────────────────────


class PortalRecommendationItem(BaseModel):
    rec_id: int
    project_id: int | None = None
    project_name: str | None = None
    unit_external_id: str | None = None
    layout: str | None = None
    layout_label: str | None = None
    floor_area_m2: float | None = None
    exterior_area_m2: float | None = None
    price_czk: int | None = None
    price_per_m2_czk: int | None = None
    floor: int | None = None
    score: float | None = None
    top_strengths: list[str] = []
    top_compromises: list[str] = []
    district: str | None = None
    project_lat: float | None = None
    project_lng: float | None = None
    # Standards / features (booleans)
    has_recuperation: bool = False
    has_air_conditioning: bool = False
    has_floor_heating: bool = False
    has_exterior_blinds: bool = False
    has_parking: bool = False
    has_smart_home: bool = False
    # Standards / features (enum values)
    heating: str | None = None
    heating_source: str | None = None
    windows: str | None = None
    partition_walls: str | None = None
    flooring: str | None = None
    orientation: str | None = None
    cooling: str | None = None
    energy_class: str | None = None
    # Project amenities
    has_bike_room: bool = False
    has_stroller_room: bool = False
    has_fitness: bool = False
    has_courtyard_garden: bool = False
    has_reception: bool = False
    has_concierge: bool = False
    # Noise distances (meters)
    distance_to_primary_road_m: float | None = None
    distance_to_tram_tracks_m: float | None = None
    distance_to_railway_m: float | None = None
    # MHD stop distances (meters)
    distance_to_tram_stop_m: float | None = None
    distance_to_metro_station_m: float | None = None
    distance_to_bus_stop_m: float | None = None
    distance_to_train_station_m: float | None = None
    feedback: RecommendationFeedbackOut | None = None
    # Broker curation metadata
    pinned_by_broker: bool = False
    shortlist_order: int | None = None
    shortlist_reason: str | None = None
    shortlist_role: str | None = None
    # Project metadata for display
    construction_completion: str | None = None
    project_url: str | None = None
    noise_label: str | None = None
    price_diff_pct: float | None = None
    poi_counts: dict[str, int] = {}
    poi_distances: dict[str, float] = {}


def _check_recuperation(project: Project) -> bool:
    val = getattr(project, "recuperation", None)
    return bool(val) and str(val).lower() not in ("false", "0", "ne", "no", "")


def _check_floor_heating(unit: Unit, project: Project) -> bool:
    h = getattr(unit, "heating", None) or getattr(project, "heating", None)
    if not h:
        return False
    return any(k in str(h).lower() for k in ("podlah", "underfloor", "floor"))


def _check_exterior_blinds(unit: Unit) -> bool:
    eb = getattr(unit, "exterior_blinds", None)
    if not eb:
        return False
    return str(eb).lower() not in ("false", "0", "")


@app.get("/portal/recommendations", response_model=list[PortalRecommendationItem])
def portal_list_recommendations(
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
) -> list[PortalRecommendationItem]:
    recs = db.execute(
        select(ClientRecommendation, Unit, Project)
        .join(Unit, ClientRecommendation.unit_id == Unit.id)
        .join(Project, ClientRecommendation.project_id == Project.id)
        .outerjoin(ClientRecommendationFeedback)
        .options(selectinload(ClientRecommendation.feedback))
        .where(
            ClientRecommendation.client_id == client.id,
            ClientRecommendation.hidden_by_broker.is_(False),
        )
        .order_by(
            ClientRecommendation.shortlist_order.asc().nulls_last(),
            ClientRecommendation.score.desc(),
        )
    ).all()
    items: list[PortalRecommendationItem] = []
    for rec, unit, project in recs:
        reason = rec.reason_json or {}
        raw_layout = str(unit.layout) if unit.layout is not None else None
        layout_label = _layout_group(raw_layout) or (raw_layout if raw_layout is not None else None)
        items.append(
            PortalRecommendationItem(
                rec_id=rec.id,
                project_id=project.id,
                project_name=project.name,
                unit_external_id=unit.external_id,
                layout=unit.layout,
                layout_label=layout_label,
                floor_area_m2=float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None,
                exterior_area_m2=float(unit.exterior_area_m2) if unit.exterior_area_m2 is not None else None,
                price_czk=unit.price_czk,
                price_per_m2_czk=unit.price_per_m2_czk,
                floor=unit.floor,
                score=rec.score,
                top_strengths=reason.get("top_strengths") or [],
                top_compromises=reason.get("top_compromises") or [],
                district=project.district,
                project_lat=float(project.gps_latitude) if project.gps_latitude is not None else None,
                project_lng=float(project.gps_longitude) if project.gps_longitude is not None else None,
                has_recuperation=_check_recuperation(project),
                has_air_conditioning=bool(getattr(unit, "air_conditioning", None)),
                has_floor_heating=_check_floor_heating(unit, project),
                has_exterior_blinds=_check_exterior_blinds(unit),
                has_parking=bool(getattr(unit, "parking_indoor_price_czk", None) or getattr(unit, "parking_outdoor_price_czk", None)),
                has_smart_home=bool(getattr(unit, "smart_home", None)),
                # Enum attributes (unit-level overrides project-level)
                heating=getattr(unit, "heating", None) or getattr(project, "heating", None),
                heating_source=getattr(project, "heating_source", None),
                windows=getattr(unit, "windows", None) or getattr(project, "windows", None),
                partition_walls=getattr(unit, "partition_walls", None) or getattr(project, "partition_walls", None),
                flooring=getattr(unit, "floors", None),
                orientation=getattr(unit, "orientation", None),
                cooling=getattr(project, "cooling", None),
                energy_class=getattr(project, "energy_class", None),
                # Project amenities
                has_bike_room=bool(getattr(project, "bike_room", None)),
                has_stroller_room=bool(getattr(project, "stroller_room", None)),
                has_fitness=bool(getattr(project, "fitness", None)),
                has_courtyard_garden=bool(getattr(project, "courtyard_garden", None)),
                has_reception=bool(getattr(project, "reception", None)),
                has_concierge=bool(getattr(project, "concierge", None)),
                distance_to_primary_road_m=getattr(project, "distance_to_primary_road_m", None),
                distance_to_tram_tracks_m=getattr(project, "distance_to_tram_tracks_m", None),
                distance_to_railway_m=getattr(project, "distance_to_railway_m", None),
                distance_to_tram_stop_m=project.distance_to_tram_stop_m,
                distance_to_metro_station_m=project.distance_to_metro_station_m,
                distance_to_bus_stop_m=project.distance_to_bus_stop_m,
                distance_to_train_station_m=project.distance_to_train_station_m,
                feedback=RecommendationFeedbackOut(
                    feedback_type=rec.feedback.feedback_type,
                    dislike_reason=rec.feedback.dislike_reason,
                    note=rec.feedback.note,
                    updated_at=rec.feedback.updated_at,
                ) if rec.feedback else None,
                pinned_by_broker=rec.pinned_by_broker,
                shortlist_order=rec.shortlist_order,
                shortlist_reason=rec.shortlist_reason,
                shortlist_role=rec.shortlist_role,
                construction_completion=project.construction_completion,
                project_url=project.project_url,
                noise_label=project.noise_label,
                price_diff_pct=float(unit.local_price_diff_2000m) if unit.local_price_diff_2000m is not None else None,
                poi_counts={
                    k: int(v)
                    for k in ("supermarket", "park", "cafe", "restaurant", "fitness", "playground", "kindergarten", "primary_school")
                    if (v := getattr(project, f"count_{k}_500m", None)) is not None
                },
                poi_distances={
                    k: round(float(v))
                    for k in ("supermarket", "drugstore", "pharmacy", "atm", "post_office",
                              "tram_stop", "bus_stop", "metro_station", "train_station",
                              "restaurant", "cafe", "park", "fitness", "playground",
                              "kindergarten", "primary_school", "pediatrician")
                    if (v := getattr(project, f"distance_to_{k}_m", None)) is not None
                },
            )
        )
    return items


@app.put("/portal/recommendations/{rec_id}/feedback", response_model=RecommendationFeedbackOut)
def portal_upsert_recommendation_feedback(
    rec_id: int,
    body: RecommendationFeedbackIn,
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
) -> RecommendationFeedbackOut:
    rec = db.get(ClientRecommendation, rec_id)
    if not rec or rec.client_id != client.id:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if body.feedback_type not in ALLOWED_FEEDBACK_TYPES:
        raise HTTPException(status_code=422, detail=f"feedback_type must be one of {sorted(ALLOWED_FEEDBACK_TYPES)}")
    if body.feedback_type != "disliked":
        body.dislike_reason = None
    fb = db.execute(
        select(ClientRecommendationFeedback).where(
            ClientRecommendationFeedback.recommendation_id == rec_id
        )
    ).scalar_one_or_none()
    if fb:
        fb.feedback_type = body.feedback_type
        fb.dislike_reason = body.dislike_reason
        fb.note = body.note
    else:
        fb = ClientRecommendationFeedback(
            recommendation_id=rec_id,
            feedback_type=body.feedback_type,
            dislike_reason=body.dislike_reason,
            note=body.note,
        )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    return RecommendationFeedbackOut(
        feedback_type=fb.feedback_type,
        dislike_reason=fb.dislike_reason,
        note=fb.note,
        updated_at=fb.updated_at,
    )


# ---------------------------------------------------------------------------
# Portal — profile overrides (client toggles must↔prefer, commute mode, etc.)
# ---------------------------------------------------------------------------

@app.patch("/portal/profile/overrides")
def portal_update_overrides(
    body: dict,
    db: DbSession,
    client: Client = Depends(get_current_portal_client),
):
    """Update client portal overrides (standards/amenities mode toggles, commute mode, etc.).

    Body is a partial update — only provided keys are updated, others remain.
    Example:
        {"standards": {"recuperation": {"mode": "prefer"}}, "commute_mode": "sum"}
    """
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    existing = dict(profile.portal_overrides_json or {})

    # Merge sections
    for section in ("standards", "amenities", "poi"):
        if section in body:
            existing.setdefault(section, {})
            for key, val in body[section].items():
                existing[section][key] = val

    # Top-level scalar keys
    for key in ("commute_mode", "commute_primary_index"):
        if key in body:
            existing[key] = body[key]

    profile.portal_overrides_json = existing
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return {"status": "ok", "portal_overrides": profile.portal_overrides_json}


# ---------------------------------------------------------------------------
# Scoring V2 Config — persistent admin API
#
# Storage: ScoringConfig.scoring_v2_json (JSONB column).
# Loaded at process startup via _load_scoring_v2_config_from_db() (below),
# updated in-place on PATCH. Keeps SCORING_V2_CONFIG as the single runtime
# source of truth for compute_flat_match(), while DB provides persistence.
# ---------------------------------------------------------------------------


def _apply_v2_overrides(overrides: dict[str, Any]) -> None:
    """Apply overrides dict onto SCORING_V2_CONFIG in-place, preserving types."""
    for key, value in overrides.items():
        if key not in SCORING_V2_CONFIG:
            continue
        current = SCORING_V2_CONFIG[key]
        if isinstance(current, dict) and isinstance(value, dict):
            current.update(value)
        elif isinstance(current, list):
            SCORING_V2_CONFIG[key] = value
        else:
            try:
                SCORING_V2_CONFIG[key] = type(current)(value)
            except (TypeError, ValueError):
                SCORING_V2_CONFIG[key] = value


def _load_scoring_v2_config_from_db() -> None:
    """On startup: overlay DB-persisted V2 config onto in-memory defaults."""
    import logging
    from .db import SessionLocal
    try:
        with SessionLocal() as db:
            row = db.execute(
                select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
            ).scalars().first()
            if row and row.scoring_v2_json:
                _apply_v2_overrides(row.scoring_v2_json)
    except Exception as exc:
        # Don't crash startup — log and continue with defaults.
        logging.getLogger(__name__).warning(
            "Failed to load scoring_v2_json from DB: %s", exc
        )


# Load persisted config at import time (uvicorn worker startup).
_load_scoring_v2_config_from_db()


@app.get("/admin/scoring-v2-config")
def get_scoring_v2_config() -> dict[str, Any]:
    """Return current SCORING_V2_CONFIG with labels."""
    return {"config": SCORING_V2_CONFIG, "labels": SCORING_V2_LABELS}


@app.patch("/admin/scoring-v2-config")
def update_scoring_v2_config(body: dict[str, Any], db: DbSession) -> dict[str, Any]:
    """Update SCORING_V2_CONFIG in memory and persist to DB.

    Writes the merged overrides to ScoringConfig.scoring_v2_json so values
    survive backend restarts. If no ScoringConfig row exists, one is created
    with the defaults from SCORING_V2_CONFIG keys.
    """
    _apply_v2_overrides(body)

    # Persist: load latest row (create if missing) and update scoring_v2_json.
    row = db.execute(
        select(ScoringConfig).order_by(ScoringConfig.id.desc()).limit(1)
    ).scalars().first()
    if not row:
        row = ScoringConfig(config_json=DEFAULT_WEIGHTS)
        db.add(row)
        db.flush()
    existing = dict(row.scoring_v2_json or {})
    for key, value in body.items():
        if key in SCORING_V2_CONFIG:
            existing[key] = SCORING_V2_CONFIG[key]
    row.scoring_v2_json = existing
    db.commit()

    return {"config": SCORING_V2_CONFIG}


@app.get("/geocode")
def geocode_address(
    q: str,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    """Forward to HERE Geocoding API. Returns top results with lat/lng + label.
    Used by the map page's address search — broker types "Vinohradská 50" and
    the map flies to the result. Czechia-only to avoid bleed from similarly
    named streets abroad."""
    import os
    import requests as _requests

    api_key = os.environ.get("HERE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="Geocoding not configured (HERE_API_KEY missing)")
    query = (q or "").strip()
    if not query:
        return {"results": []}
    try:
        resp = _requests.get(
            "https://geocode.search.hereapi.com/v1/geocode",
            params={
                "q": query,
                "in": "countryCode:CZE",
                "limit": 5,
                "apiKey": api_key,
            },
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
    except _requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Geocoding upstream failed: {exc}") from exc
    items = data.get("items") or []
    results: list[dict[str, Any]] = []
    for item in items:
        pos = item.get("position") or {}
        lat = pos.get("lat")
        lng = pos.get("lng")
        if lat is None or lng is None:
            continue
        results.append({
            "label": item.get("title") or (item.get("address") or {}).get("label"),
            "lat": float(lat),
            "lng": float(lng),
            "result_type": item.get("resultType"),
        })
    return {"results": results}

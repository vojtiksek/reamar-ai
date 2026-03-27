from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Any

from decimal import Decimal
from urllib.parse import urlparse
import json

from fastapi import Depends, FastAPI, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import asc, case, desc, func, or_, and_, select
import sqlalchemy as sa
from sqlalchemy.sql.functions import coalesce
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, aliased, selectinload

from .column_catalog import get_columns as get_column_definitions
from .db import check_db_connection, get_db_session
from .filter_catalog import get_filter_groups
from .models import (
    Project,
    Unit,
    UnitApiPending,
    UnitOverride,
    UnitPriceHistory,
    ProjectOverride,
    Broker,
    Client,
    ClientProfile,
    ClientRecommendation,
    ClientUnitMatch,
    ClientShareLink,
    ClientNote,
    UnitEvent,
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
from .routing_provider import get_cached_travel_time_minutes
from .walkability_sources import (
    refresh_walkability_sources_and_recompute,
    recompute_all_project_walkability as recompute_all_walkability,
)


app = FastAPI(title="Reamar AI Backend")

# CORS for local Next.js frontend (localhost:3000 / 3001)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    distance_to_tram_stop_m: float | None = None
    distance_to_metro_station_m: float | None = None
    distance_to_bus_stop_m: float | None = None
    reason: dict[str, Any] | None = None
    broker_note: str | None = None


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


def get_current_broker(
    db: DbSession,
    authorization: str | None = Header(default=None, alias=AUTH_HEADER),
) -> Broker:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    broker = db.execute(
        select(Broker).where(Broker.session_token == token)
    ).scalars().first()
    if not broker:
        raise HTTPException(status_code=401, detail="Invalid token")
    return broker


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
            )
        )
    return out


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
    share_link_expires_at: datetime | None = None
    share_link_expired: bool = False
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

    # Active share links
    share_links = dict(
        db.execute(
            select(ClientShareLink.client_id, ClientShareLink.expires_at)
            .where(ClientShareLink.client_id.in_(client_ids))
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
        share_exp = share_links.get(c.id)
        share_expired = bool(share_exp and share_exp < now)
        has_profile = c.id in profile_ids

        # Priority calculation
        priority = "normal"
        if unseen > 0:
            priority = "high"
        elif days_since is not None and days_since > 14:
            priority = "medium"
        elif share_expired:
            priority = "medium"
        elif c.status == "new" and not has_profile:
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
            share_link_expires_at=share_exp,
            share_link_expired=share_expired,
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
    )


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
    )


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
    )


def _wizard_preferences_adjustment(
    unit: Unit,
    project: Project,
    profile: ClientProfile | None,
) -> float:
    """Return a bonus/penalty adjustment (points, capped externally to ±20/+15)
    based on wizard fields that are not part of the main weighted scoring:
    noise sensitivity, floor preference, ground_floor_sensitive, orientation.

    Convention:
      "prefer" → mild signal  (±3–5 pts)
      "must"   → strong signal (±8–12 pts)
    Data absent for a given project/unit → 0 (neutral, no penalty for missing data).
    """
    if not profile or not profile.filter_json:
        return 0.0

    wizard = (profile.filter_json or {}).get("wizard") or {}
    wizard_noise = wizard.get("noise") or {}
    wizard_outdoor = wizard.get("outdoor") or {}

    adj = 0.0

    # ── Noise sensitivity ─────────────────────────────────────────────────────
    # quiet_area: client prefers a quiet neighbourhood.
    # noise_label values in DB: 'Nízký' (quiet), 'Střední' (medium),
    #                           'Vyšší' / 'Vysoký' (noisy)
    qa_pref = wizard_noise.get("quiet_area")
    if qa_pref in ("prefer", "must"):
        nl = project.noise_label
        if nl is not None:
            nl_low = nl.lower()
            if "nízk" in nl_low:  # 'Nízký' → quiet ✓
                adj += 5.0 if qa_pref == "must" else 4.0
            elif "vyšší" in nl_low or "vysoký" in nl_low or "vysoká" in nl_low:
                adj += -12.0 if qa_pref == "must" else -5.0
            # 'Střední' → neutral, no adjustment

    # main_road sensitivity: distance_to_primary_road_m (metres)
    mr_pref = wizard_noise.get("main_road")
    if mr_pref in ("prefer", "must"):
        dist = project.distance_to_primary_road_m
        if dist is not None:
            if dist < 150.0:
                adj += -12.0 if mr_pref == "must" else -5.0
            elif dist < 400.0:
                adj += -6.0 if mr_pref == "must" else -2.0
            else:  # comfortably far
                adj += 4.0 if mr_pref == "must" else 3.0

    # tram sensitivity: distance_to_tram_tracks_m
    tram_pref = wizard_noise.get("tram")
    if tram_pref in ("prefer", "must"):
        dist = project.distance_to_tram_tracks_m
        if dist is not None:
            if dist < 100.0:
                adj += -10.0 if tram_pref == "must" else -4.0
            elif dist < 300.0:
                adj += -5.0 if tram_pref == "must" else -2.0
            else:
                adj += 3.0 if tram_pref == "must" else 2.0

    # railway sensitivity: distance_to_railway_m
    rail_pref = wizard_noise.get("railway")
    if rail_pref in ("prefer", "must"):
        dist = project.distance_to_railway_m
        if dist is not None:
            if dist < 300.0:
                adj += -10.0 if rail_pref == "must" else -4.0
            elif dist < 700.0:
                adj += -5.0 if rail_pref == "must" else -2.0
            else:
                adj += 3.0 if rail_pref == "must" else 2.0

    # airport sensitivity: distance_to_airport_m
    airport_pref = wizard_noise.get("airport")
    if airport_pref in ("prefer", "must"):
        dist = project.distance_to_airport_m
        if dist is not None:
            if dist < 5_000.0:
                adj += -10.0 if airport_pref == "must" else -4.0
            elif dist < 10_000.0:
                adj += -4.0 if airport_pref == "must" else -2.0
            else:
                adj += 3.0 if airport_pref == "must" else 2.0

    # ── Floor preference ──────────────────────────────────────────────────────
    # Czech floor convention in DB: 0 = přízemí (ground), 1 = 1st floor above ground, etc.
    unit_floor = unit.floor  # int | None

    # ground_floor_sensitive: client dislikes being on ground floor (floor <= 0)
    gfs = wizard_outdoor.get("ground_floor_sensitive")
    if gfs in ("prefer", "must") and unit_floor is not None:
        if unit_floor <= 0:
            adj += -15.0 if gfs == "must" else -6.0

    # preferred_floor: "ground" | "low" | "middle" | "high" | "ignore"
    pf = wizard_outdoor.get("preferred_floor")
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
            adj += -4.0  # clearly not ground-level
        elif pf == "high" and unit_floor <= 1:
            adj += -4.0  # clearly not high

    # ── Orientation preference ────────────────────────────────────────────────
    # unit.orientation format: "SW", "N,E", "NE,W", "N,S,E,W" etc.
    # Parse by scanning for compass letters N/S/E/W (commas and spaces are separators).
    orient_prefs = wizard_outdoor.get("orientation") or {}
    if orient_prefs and unit.orientation:
        unit_dirs: set[str] = {ch for ch in unit.orientation.upper() if ch in "NSEW"}
        dir_map = {"south": "S", "north": "N", "east": "E", "west": "W"}
        for direction, letter in dir_map.items():
            pref = orient_prefs.get(direction)
            if pref not in ("prefer", "must"):
                continue
            if letter in unit_dirs:
                adj += 5.0 if pref == "must" else 3.0
            else:
                adj += -8.0 if pref == "must" else -3.0

    # ── Outdoor space (unified) ─────────────────────────────────────────────
    outdoor_pref = wizard_outdoor.get("outdoor_space")
    if outdoor_pref in ("prefer", "must"):
        ext = unit.exterior_area_m2
        min_out = wizard_outdoor.get("min_outdoor_area_m2")
        if ext is not None and float(ext) > 0:
            adj += 5.0 if outdoor_pref == "must" else 3.0
            if min_out is not None and float(ext) >= float(min_out):
                adj += 3.0  # meets minimum
            elif min_out is not None:
                adj += -2.0  # has outdoor but below minimum
        else:
            adj += -10.0 if outdoor_pref == "must" else -4.0

    # ── Energy class ─────────────────────────────────────────────────────────
    energy_pref = wizard.get("energy_class")
    if energy_pref and energy_pref != "ignore":
        unit_ec = getattr(project, "energy_class", None)
        if unit_ec:
            ec_order = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6}
            req_rank = ec_order.get(str(energy_pref).upper()[:1], 99)
            unit_rank = ec_order.get(str(unit_ec).strip().upper()[:1], 99)
            if unit_rank <= req_rank:
                adj += 5.0  # meets or exceeds requirement
            elif unit_rank == req_rank + 1:
                adj += -3.0  # one grade below
            # worse → handled by hard filter

    # ── Developer preference ─────────────────────────────────────────────────
    dev_pref = wizard.get("preferred_developer")
    if dev_pref and isinstance(dev_pref, str) and dev_pref.strip():
        proj_dev = getattr(project, "developer", None) or ""
        if dev_pref.strip().lower() in proj_dev.lower():
            adj += 8.0  # developer match
        else:
            adj += -2.0  # mild penalty for non-preferred developer

    # ── Completion date proximity ────────────────────────────────────────────
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
                if proj_date <= max_date:
                    adj += 4.0  # on time
                # past max_date → handled by hard filter
        except (ValueError, TypeError):
            pass

    # ── Renovation / new-build preference ──────────────────────────────────
    # renovation_preference values:
    #   "any"               → no adjustment
    #   "prefer_new"        → mild bonus for new build, mild penalty for renovation
    #   "only_new"          → handled by hard filter in frontend, no scoring needed
    #   "prefer_renovation" → mild bonus for renovation, mild penalty for new build
    #   "only_renovation"   → handled by hard filter in frontend, no scoring needed
    #
    # Data field: unit.renovation (bool | None)
    #   True  = renovation/reconstruction
    #   False = new build
    #   None  = unknown → neutral (no adjustment)
    reno_pref = wizard.get("renovation_preference")
    if reno_pref in ("prefer_new", "prefer_renovation") and unit.renovation is not None:
        is_new_build = unit.renovation is False
        if reno_pref == "prefer_new":
            adj += 4.0 if is_new_build else -3.0
        else:  # prefer_renovation
            adj += 4.0 if unit.renovation else -3.0

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

        # Standards: rekuperace, air_conditioning, floor_heating, external_blinds
        standards = wizard.get("standards") or {}
        if standards.get("rekuperace") == "must" and not getattr(project, "recuperation", None):
            return 0.0, {"hard_filter": "rekuperace"}
        if standards.get("air_conditioning") == "must" and not getattr(unit, "air_conditioning", None):
            return 0.0, {"hard_filter": "air_conditioning"}
        if standards.get("floor_heating") == "must":
            h = getattr(unit, "heating", None) or getattr(project, "heating", None) or ""
            if "podlah" not in str(h).lower():
                return 0.0, {"hard_filter": "floor_heating"}
        if standards.get("external_blinds") == "must":
            eb = getattr(unit, "exterior_blinds", None)
            if eb is None or str(eb).lower() in ("false", "0", ""):
                return 0.0, {"hard_filter": "external_blinds"}

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
            # No explicit bounds — fall back to ideal_area from wizard if present.
            wizard_budget = (
                ((profile.filter_json or {}).get("wizard") or {}).get("budget") or {}
                if profile.filter_json
                else {}
            )
            ideal_area = wizard_budget.get("ideal_area")
            if ideal_area is not None:
                try:
                    ideal_area = float(ideal_area)
                    # ±30 % soft window around ideal; same decay formula as before.
                    center = ideal_area
                    diff_ratio = abs(area - center) / max(center, 1.0)
                    area_fit = max(0.0, 100.0 * (1.0 - min(diff_ratio, 0.5) / 0.5))
                except (TypeError, ValueError):
                    pass  # malformed value → keep neutral 50

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
            travel_min = get_cached_travel_time_minutes(db, project, cp)
            if travel_min is None:
                continue
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


@app.post("/clients/{client_id}/recommendations/recompute")
def recompute_client_recommendations(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> dict[str, Any]:
    client = _get_client_for_broker(db, client_id, broker)
    profile = db.execute(
        select(ClientProfile).where(ClientProfile.client_id == client.id)
    ).scalars().first()

    # Base query: only active units (available + reserved) with price and floor area
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(func.lower(Unit.availability_status).in_(["available", "reserved"]))
    )
    if profile:
        if profile.budget_min is not None:
            q = q.where(Unit.price_czk >= profile.budget_min)
        if profile.budget_max is not None:
            q = q.where(Unit.price_czk <= profile.budget_max)
        if profile.area_min is not None:
            q = q.where(Unit.floor_area_m2 >= profile.area_min)
        if profile.area_max is not None:
            q = q.where(Unit.floor_area_m2 <= profile.area_max)
        # Property type hard filter
        prop_type = profile.property_type
        if prop_type == "flat":
            q = q.where(func.lower(Unit.category).notin_(["house", "dům", "rodinný dům", "řadový dům"]))
        elif prop_type == "house":
            q = q.where(func.lower(Unit.category).in_(["house", "dům", "rodinný dům", "řadový dům"]))

    rows = db.execute(q.order_by(Unit.id).limit(500)).all()

    # If client has explicit layout preferences, compute preferred buckets once.
    pref_layout_buckets: list[str] = []
    if profile and profile.layouts and "values" in profile.layouts:
        pref_layout_buckets = [str(v).strip().lower() for v in (profile.layouts.get("values") or [])]

    scored: list[tuple[float, Unit, Project, dict[str, float]]] = []
    for unit, project in rows:
        # Optional hard filter by layout: keep only units whose bucket matches profile preferences.
        if pref_layout_buckets:
            if unit.layout is None:
                continue
            unit_bucket = _layout_group(str(unit.layout)) or str(unit.layout).strip().lower()
            if unit_bucket not in pref_layout_buckets:
                continue
        score, parts = _compute_unit_match_score(unit, project, profile, db)
        if score <= 0:
            continue
        scored.append((score, unit, project, parts))

        # For strong matches (score >= 80), record client-unit match (if not already present).
        if score >= 80.0:
            existing = db.execute(
                select(ClientUnitMatch).where(
                    ClientUnitMatch.client_id == client.id,
                    ClientUnitMatch.unit_id == unit.id,
                )
            ).scalars().first()
            if not existing:
                match = ClientUnitMatch(
                    client_id=client.id,
                    unit_id=unit.id,
                    score=score,
                )
                db.add(match)

    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[:100]

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

    for score, unit, project, parts in top:
        if unit.id in hidden_unit_ids:
            continue
        rec = ClientRecommendation(
            client_id=client.id,
            unit_id=unit.id,
            project_id=project.id,
            score=score,
            reason_json=parts,
        )
        db.add(rec)
    db.commit()

    return {
        "client_id": client.id,
        "total_candidates": len(rows),
        "created": len(top),
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

    # Base set: only active units (available + reserved) for this broker's market
    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(func.lower(Unit.availability_status).in_(["available", "reserved"]))
    )
    rows = db.execute(q.limit(1000)).all()
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

            # Commute: reuse hard-filter semantics from scoring.
            passes_commute = True
            if (
                prof.commute_points_json
                and project.gps_latitude is not None
                and project.gps_longitude is not None
            ):
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
                    travel_min = get_cached_travel_time_minutes(db, project, cp)
                    if travel_min is None:
                        continue
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

    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(func.lower(Unit.availability_status).in_(["available", "reserved"]))
    )
    rows = db.execute(q.limit(1000)).all()

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

    q = (
        select(Unit, Project)
        .join(Project, Unit.project_id == Project.id)
        .where(func.lower(Unit.availability_status).in_(["available", "reserved"]))
    )

    rows_raw: list[tuple[Unit, Project]] = db.execute(q.limit(5000)).all()

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
                score=rec.score,
                budget_fit=float(reason.get("budget_fit", 0.0)),
                walkability_fit=float(reason.get("walkability_fit", 0.0)),
                location_fit=float(reason.get("location_fit", 0.0)),
                layout_fit=float(reason.get("layout_fit", 0.0)),
                area_fit=float(reason.get("area_fit", 0.0)),
                outdoor_fit=float(reason.get("outdoor_fit", 50.0)),
                distance_to_tram_stop_m=project.distance_to_tram_stop_m,
                distance_to_metro_station_m=project.distance_to_metro_station_m,
                distance_to_bus_stop_m=project.distance_to_bus_stop_m,
                reason=reason,
                broker_note=rec.broker_note,
            )
        )
    return items


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

    # New projects (added recently)
    new_projects = db.execute(
        select(Project)
        .where(Project.id.in_(
            select(Unit.project_id).where(
                Unit.first_seen >= since.date(),
            ).group_by(Unit.project_id)
            .having(func.min(Unit.first_seen) >= since.date())
        ))
        .limit(20)
    ).scalars().all()

    for p in new_projects:
        notifications.append(BrokerNotification(
            id=-p.id,  # negative to distinguish
            type="new_project",
            project_id=p.id,
            project_name=p.name,
            new_value=p.name,
            affected_clients=[],
            created_at=datetime.utcnow(),
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

    results: list[ClientWithoutInventoryItem] = []

    for client, profile in clients:
        # Base query: only active units (available + reserved) with project join for polygon/location
        q = (
            select(Unit, Project)
            .join(Project, Unit.project_id == Project.id)
            .where(func.lower(Unit.availability_status).in_(["available", "reserved"]))
        )

        # Budget + area filters
        if profile.budget_min is not None:
            q = q.where(Unit.price_czk >= profile.budget_min)
        if profile.budget_max is not None:
            q = q.where(Unit.price_czk <= profile.budget_max)
        if profile.area_min is not None:
            q = q.where(Unit.floor_area_m2 >= profile.area_min)
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


@app.post(
    "/units/local-price-diffs/recompute",
    summary="Recompute local price differences for all units",
    description="Offline-style recompute of local_price_diff_* fields for all units. Intended for cron/manual use; may take several seconds on larger datasets.",
)
def recompute_units_local_price_diffs(db: DbSession) -> dict[str, Any]:
    from .aggregates import recompute_local_price_diffs

    recompute_local_price_diffs(db)
    db.commit()
    return {"status": "ok"}


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
    min_floors: int | None = None,
    max_floors: int | None = None,
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
        base = base.where(coalesce(po_heating.value, Unit.heating).in_(heating))
    if windows is not None and len(windows) > 0:
        po_windows = aliased(ProjectOverride)
        base = base.outerjoin(
            po_windows,
            (po_windows.project_id == Unit.project_id) & (po_windows.field == "windows"),
        )
        base = base.where(coalesce(po_windows.value, Unit.windows).in_(windows))
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
    if min_floors is not None:
        base = base.where(Unit.floors >= min_floors)
    if max_floors is not None:
        base = base.where(Unit.floors <= max_floors)
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
        base = base.where(coalesce(po_partition_walls.value, Unit.partition_walls).in_(partition_walls))
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
    response_model=UnitsListResponse,
    summary="List units with pagination and filters",
    description="Returns a paginated list of units. Optional query params: limit (1–1000, default 100), offset, available, min_price, max_price, min_price_per_m2, max_price_per_m2, layout, district, heating, windows, permit_regular, renovation, min_floor_area, max_floor_area, sort_by, sort_dir. Response: total (count before pagination), items (UnitResponse with overrides applied).",
)
def list_units(
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=1000, description="Page size (1–1000)")] = 100,
    offset: Annotated[int, Query(ge=0, description="Skip N items")] = 0,
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
    min_floors: Annotated[int | None, Query()] = None,
    max_floors: Annotated[int | None, Query()] = None,
    orientation: Annotated[list[str] | None, Query(description="Filter by orientation (any of)")] = None,
    category: Annotated[list[str] | None, Query(description="Filter by category (any of)")] = None,
    overall_quality: Annotated[list[str] | None, Query(description="Filter by overall_quality (any of)")] = None,
    partition_walls: Annotated[list[str] | None, Query(description="Filter by partition_walls (any of)")] = None,
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
    include_archived: Annotated[bool, Query(description="Include units from fully sold projects older than 6 months")] = False,
    pending_api: Annotated[bool, Query(description="Return only units that have pending API update proposals")] = False,
    sort_by: Annotated[str, Query(description="Sort field")] = "price_per_m2_czk",
    sort_dir: Annotated[str, Query(description="Sort direction")] = "asc",
) -> UnitsListResponse:
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
        min_floors=min_floors,
        max_floors=max_floors,
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
    )
    if pending_api:
        pending_subq = select(UnitApiPending.unit_id).where(UnitApiPending.unit_id == Unit.id)
        base = base.where(sa.exists(pending_subq))
    if not include_archived:
        recent_sold_cutoff = date.today() - timedelta(days=183)
        first_seen_cutoff = date.today() - timedelta(days=365 * 2)
        agg = _project_agg_subquery()
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
    total = db.execute(select(func.count()).select_from(base_subq)).scalar_one()

    # Globální agregace pro všechny jednotky odpovídající filtrům (bez limit/offset).
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
            func.max(Unit.days_on_market).label("max_days_on_market"),
            # Financing (fractions 0–1)
            func.min(Unit.payment_contract).label("min_payment_contract"),
            func.max(Unit.payment_contract).label("max_payment_contract"),
            func.min(Unit.payment_construction).label("min_payment_construction"),
            func.max(Unit.payment_construction).label("max_payment_construction"),
            func.min(Unit.payment_occupancy).label("min_payment_occupancy"),
            func.max(Unit.payment_occupancy).label("max_payment_occupancy"),
            func.max(Unit.sold_date).label("sold_date"),
            # Fallback GPS pro projekty – průměrná poloha jednotek v projektu
            func.avg(Unit.gps_latitude).label("project_gps_latitude"),
            func.avg(Unit.gps_longitude).label("project_gps_longitude"),
            # Sample unit URL (for deriving project_url)
            func.min(Unit.url).label("unit_url_sample"),
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

    # Derive project_url from either explicit Project.project_url or a sample unit URL.
    if not out.get("project_url"):
        raw_url = agg.get("unit_url_sample") or getattr(project, "project_url", None)
        project_url: str | None = None
        if raw_url:
            s = str(raw_url)
            try:
                parsed = urlparse(s)
                if parsed.scheme and parsed.netloc:
                    project_url = f"{parsed.scheme}://{parsed.netloc}"
                else:
                    project_url = None
            except Exception:
                project_url = None
            # Fallback for common .cz/ pattern (e.g. https://www.domanavinici.cz/projekty/...):
            if not project_url and ".cz/" in s:
                base = s.split(".cz/", 1)[0] + ".cz"
                project_url = base
        if project_url:
            out["project_url"] = project_url

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
        col = agg_subq.c.unit_url_sample
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
    min_floors,
    max_floors,
    orientation,
    category,
    overall_quality,
    partition_walls,
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
    if min_floors is not None or max_floors is not None:
        return True
    if orientation and len(orientation) > 0:
        return True
    if category and len(category) > 0:
        return True
    if overall_quality and len(overall_quality) > 0:
        return True
    if partition_walls and len(partition_walls) > 0:
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
    min_floors: Annotated[int | None, Query()] = None,
    max_floors: Annotated[int | None, Query()] = None,
    orientation: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    overall_quality: Annotated[list[str] | None, Query()] = None,
    partition_walls: Annotated[list[str] | None, Query()] = None,
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
) -> ProjectsListResponse:
    allowed_sort = get_projects_sort_keys()
    if sort_by not in allowed_sort:
        raise HTTPException(
            status_code=422,
            detail=f"sort_by must be one of: {sorted(allowed_sort)}",
        )
    if sort_dir not in ("asc", "desc"):
        raise HTTPException(status_code=422, detail="sort_dir must be asc or desc")
    agg_subq = _project_agg_subquery()
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

    # Archivace: standardně skrýváme projekty, které nemají žádné dostupné jednotky
    # a jejich poslední sold_date je starší než 6 měsíců.
    if not include_archived:
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
    if _has_unit_filters(
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
        min_floor, max_floor, min_floors, max_floors,
        orientation, category, overall_quality, partition_walls,
        city, cadastral_area_iga, municipal_district_iga, administrative_district_iga, region_iga,
        developer, building, project,
        min_latitude, max_latitude, min_longitude, max_longitude,
        min_ride_to_center_min, max_ride_to_center_min,
        min_public_transport_to_center_min, max_public_transport_to_center_min,
        min_payment_contract, max_payment_contract,
        min_payment_construction, max_payment_construction,
        min_payment_occupancy, max_payment_occupancy,
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
            min_floors=min_floors,
            max_floors=max_floors,
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
        )
        u_sub = units_base.subquery()
        matching_project_ids = select(u_sub.c.project_id).distinct()
        stmt = stmt.where(Project.id.in_(matching_project_ids))
    order = _projects_order_clause(agg_subq, sort_by, sort_dir)
    if order is not None:
        stmt = stmt.order_by(order, Project.id.asc())
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.execute(count_stmt).scalar_one()
    stmt = stmt.offset(offset).limit(limit)
    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []

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
    if field in ("price_czk", "price_per_m2_czk", "available", "floor_area_m2"):
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
    if field in ("price_czk", "price_per_m2_czk", "available", "floor_area_m2"):
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
    if body.field in ("price_czk", "price_per_m2_czk", "availability_status"):
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


# ── Share-link models ────────────────────────────────────────────────────────

class ShareLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    url: str
    expires_at: datetime


class ShareUnitItem(BaseModel):
    """Sanitised unit record for client-facing share view. No broker internals."""
    model_config = ConfigDict(from_attributes=True)
    project_name: str
    developer: str | None
    layout: str | None
    floor_area_m2: float | None
    exterior_area_m2: float | None
    floor: int | None
    price_czk: int | None
    price_per_m2_czk: int | None
    original_price_czk: int | None
    availability_status: str | None
    ride_to_center_min: float | None
    public_transport_to_center_min: float | None
    gps_latitude: float | None
    gps_longitude: float | None
    url: str | None
    broker_note: str | None = None


class SharePayload(BaseModel):
    """Public payload returned by GET /share/{token}."""
    model_config = ConfigDict(from_attributes=True)
    client_name: str
    broker_name: str | None = None
    broker_phone: str | None = None
    broker_email: str | None = None
    units: list[ShareUnitItem]
    expires_at: datetime


_SHARE_LINK_TTL_DAYS = 30


@app.post("/clients/{client_id}/share-link", response_model=ShareLinkResponse)
def create_share_link(
    client_id: int,
    db: DbSession,
    broker: Broker = Depends(get_current_broker),
) -> ShareLinkResponse:
    """Create or replace the share link for this client+broker pair."""
    import secrets as _secrets
    _get_client_for_broker(db, client_id, broker)

    now = datetime.utcnow().replace(tzinfo=None)
    expires = now + timedelta(days=_SHARE_LINK_TTL_DAYS)
    token = _secrets.token_urlsafe(32)

    # Delete any existing link for this client+broker (replace semantics)
    db.execute(
        sa.delete(ClientShareLink).where(
            ClientShareLink.client_id == client_id,
            ClientShareLink.broker_id == broker.id,
        )
    )
    link = ClientShareLink(
        client_id=client_id,
        broker_id=broker.id,
        token=token,
        expires_at=expires,
    )
    db.add(link)
    db.commit()

    from .settings import settings
    base_url = settings.frontend_url
    return ShareLinkResponse(url=f"{base_url}/share/{token}", expires_at=expires)


@app.get("/share/{token}", response_model=SharePayload)
def get_share_payload(token: str, db: DbSession) -> SharePayload:
    """Public endpoint — no broker auth. Validates token and returns sanitised shortlist."""
    link = db.execute(
        select(ClientShareLink).where(ClientShareLink.token == token)
    ).scalar_one_or_none()

    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")

    now = datetime.utcnow().replace(tzinfo=None)
    # expires_at may be tz-aware from DB; strip tz for comparison
    exp = link.expires_at.replace(tzinfo=None) if link.expires_at.tzinfo else link.expires_at
    if now > exp:
        raise HTTPException(status_code=410, detail="Link expired")

    client = db.get(Client, link.client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Link not found")

    # Fetch pinned recs with unit+project
    recs = db.execute(
        select(ClientRecommendation, Unit, Project)
        .join(Unit, ClientRecommendation.unit_id == Unit.id)
        .join(Project, Unit.project_id == Project.id)
        .where(
            ClientRecommendation.client_id == link.client_id,
            ClientRecommendation.pinned_by_broker.is_(True),
            ClientRecommendation.hidden_by_broker.is_(False),
        )
        .order_by(ClientRecommendation.id)
    ).all()

    # Get broker info for contact details
    broker = db.get(Broker, link.broker_id)

    units: list[ShareUnitItem] = []
    for _rec, unit, project in recs:
        developer = unit.developer or project.developer
        # Effective GPS: unit-level first, fall back to project
        lat = float(unit.gps_latitude) if unit.gps_latitude is not None else (
            float(project.gps_latitude) if project.gps_latitude is not None else None
        )
        lng = float(unit.gps_longitude) if unit.gps_longitude is not None else (
            float(project.gps_longitude) if project.gps_longitude is not None else None
        )
        ride = float(unit.ride_to_center_min) if unit.ride_to_center_min is not None else (
            float(project.ride_to_center_min) if project.ride_to_center_min is not None else None
        )
        pt = float(unit.public_transport_to_center_min) if unit.public_transport_to_center_min is not None else (
            float(project.public_transport_to_center_min) if project.public_transport_to_center_min is not None else None
        )
        units.append(ShareUnitItem(
            project_name=project.name,
            developer=developer,
            layout=unit.layout,
            floor_area_m2=float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None,
            exterior_area_m2=float(unit.exterior_area_m2) if unit.exterior_area_m2 is not None else None,
            floor=unit.floor,
            price_czk=unit.price_czk,
            price_per_m2_czk=unit.price_per_m2_czk,
            original_price_czk=int(unit.original_price_czk) if unit.original_price_czk is not None else None,
            availability_status=unit.availability_status,
            ride_to_center_min=ride,
            public_transport_to_center_min=pt,
            gps_latitude=lat,
            gps_longitude=lng,
            url=unit.url,
            broker_note=_rec.broker_note,
        ))

    return SharePayload(
        client_name=client.name,
        broker_name=broker.name if broker else None,
        broker_phone=None,  # TODO: add phone to Broker model
        broker_email=broker.email if broker else None,
        units=units,
        expires_at=link.expires_at,
    )


class ShareFeedbackBody(BaseModel):
    unit_index: int
    feedback: str  # 'interested' | 'not_interested'


@app.post("/share/{token}/feedback", status_code=204)
def share_feedback(token: str, body: ShareFeedbackBody, db: DbSession) -> None:
    """Public endpoint — client submits feedback on a shared unit."""
    link = db.execute(
        select(ClientShareLink).where(ClientShareLink.token == token)
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")

    # Find the rec by index
    recs = db.execute(
        select(ClientRecommendation)
        .where(
            ClientRecommendation.client_id == link.client_id,
            ClientRecommendation.pinned_by_broker.is_(True),
            ClientRecommendation.hidden_by_broker.is_(False),
        )
        .order_by(ClientRecommendation.id)
    ).scalars().all()

    if body.unit_index < 0 or body.unit_index >= len(recs):
        raise HTTPException(status_code=422, detail="Invalid unit index")

    rec = recs[body.unit_index]
    # Store feedback in status field
    rec.status = body.feedback  # 'interested' | 'not_interested'
    db.add(rec)
    db.commit()


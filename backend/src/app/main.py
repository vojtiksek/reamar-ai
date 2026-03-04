from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from decimal import Decimal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import asc, case, desc, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from .column_catalog import get_columns as get_column_definitions
from .db import check_db_connection, get_db_session
from .filter_catalog import get_filter_groups
from .models import Project, Unit, UnitOverride, UnitPriceHistory, ProjectOverride
from .overrides import (
    OVERRIDEABLE_FIELDS,
    PROJECT_OVERRIDEABLE_FIELDS,
    build_override_map,
    build_project_override_map,
    unit_to_response_dict,
    apply_project_overrides_to_item,
)
from .aggregates import recompute_project_aggregates
from .project_catalog import (
    COMPUTED_COLUMN_KEYS,
    PROJECT_CATALOG_TO_ATTR,
    get_allowed_sort_keys as get_projects_sort_keys,
    get_project_columns,
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


class UnitsListResponse(BaseModel):
    items: list[UnitResponse]
    total: int
    limit: int
    offset: int
    average_price_czk: float | None = None
    average_price_per_m2_czk: float | None = None
    available_count: int | None = None


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


DbSession = Annotated[Session, Depends(get_db_session)]

VALID_OVERRIDE_FIELDS = OVERRIDEABLE_FIELDS
VALID_PROJECT_OVERRIDE_FIELDS = PROJECT_OVERRIDEABLE_FIELDS


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


def _effective_unit_response(db: Session, unit: Unit) -> UnitResponse:
    """Load overrides for unit and return UnitResponse with overrides applied."""
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
    return UnitResponse.model_validate(unit_to_response_dict(unit, override_map))


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


@app.get("/filters")
def get_filters(db: DbSession):
    """Return filter definitions from field_catalog.csv (Filterable == ANO). Cached in memory; options from DB for enum."""
    return get_filter_groups(db)


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
        base = base.where(Unit.district.in_(district))
    if municipality is not None and len(municipality) > 0:
        base = base.where(Unit.municipality.in_(municipality))
    if heating is not None and len(heating) > 0:
        base = base.where(Unit.heating.in_(heating))
    if windows is not None and len(windows) > 0:
        base = base.where(Unit.windows.in_(windows))
    if permit_regular is not None:
        base = base.where(Unit.permit_regular.is_(permit_regular))
    if renovation is not None:
        base = base.where(Unit.renovation.is_(renovation))
    if air_conditioning is not None:
        base = base.where(Unit.air_conditioning.is_(air_conditioning))
    if cooling_ceilings is not None:
        base = base.where(Unit.cooling_ceilings.is_(cooling_ceilings))
    if smart_home is not None:
        base = base.where(Unit.smart_home.is_(smart_home))
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
        base = base.where(Unit.overall_quality.in_(overall_quality))
    if partition_walls is not None and len(partition_walls) > 0:
        base = base.where(Unit.partition_walls.in_(partition_walls))
    if city is not None and len(city) > 0:
        base = base.where(Unit.city.in_(city))
    if cadastral_area_iga is not None and len(cadastral_area_iga) > 0:
        base = base.where(Unit.cadastral_area_iga.in_(cadastral_area_iga))
    if municipal_district_iga is not None and len(municipal_district_iga) > 0:
        base = base.where(Unit.municipal_district_iga.in_(municipal_district_iga))
    if administrative_district_iga is not None and len(administrative_district_iga) > 0:
        base = base.where(Unit.administrative_district_iga.in_(administrative_district_iga))
    if region_iga is not None and len(region_iga) > 0:
        base = base.where(Unit.region_iga.in_(region_iga))
    if developer is not None and len(developer) > 0:
        base = base.where(Unit.developer.in_(developer))
    if building is not None and len(building) > 0:
        base = base.where(Unit.building.in_(building))
    if project_names is not None and len(project_names) > 0:
        # Filtrování podle názvu projektu – join na Project a where Project.name IN (…)
        base = base.join(Project, Project.id == Unit.project_id).where(
            Project.name.in_([str(p) for p in project_names if p])
        )
    if min_latitude is not None:
        base = base.where(Unit.gps_latitude >= min_latitude)
    if max_latitude is not None:
        base = base.where(Unit.gps_latitude <= max_latitude)
    if min_longitude is not None:
        base = base.where(Unit.gps_longitude >= min_longitude)
    if max_longitude is not None:
        base = base.where(Unit.gps_longitude <= max_longitude)
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
    )
    base_subq = base.subquery()
    total = db.execute(select(func.count()).select_from(base_subq)).scalar_one()

    # Globální agregace pro všechny jednotky odpovídající filtrům (bez limit/offset).
    summary_row = db.execute(
        select(
            func.avg(base_subq.c.price_czk),
            func.avg(base_subq.c.price_per_m2_czk),
            func.sum(case((base_subq.c.available.is_(True), 1), else_=0)),
        )
    ).first()
    avg_price_czk = float(summary_row[0]) if summary_row and summary_row[0] is not None else None
    avg_price_per_m2_czk = float(summary_row[1]) if summary_row and summary_row[1] is not None else None
    available_count = int(summary_row[2]) if summary_row and summary_row[2] is not None else 0

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
    }

    # Projektové atributy (sloupce typu "Projekt", které mají accessor project.*)
    project_sort_columns: dict[str, Any] = {
        # Column "Projekt" v jednotkách -> Project.name
        "name": Project.name,
    }

    order_fn = asc if sort_dir == "asc" else desc

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

    # Load cached project aggregates for all projects present in this page
    project_ids = {u.project_id for u in units}
    agg_by_project_id: dict[int, Any] = {}
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

    items: list[UnitResponse] = []
    for u in units:
        d = unit_to_response_dict(u, override_map)
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

        items.append(UnitResponse.model_validate(d))

    return UnitsListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        average_price_czk=avg_price_czk,
        average_price_per_m2_czk=avg_price_per_m2_czk,
        available_count=available_count,
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

        item["min_payment_contract"] = min_pay_contract
        item["max_payment_contract"] = max_pay_contract
        item["min_payment_construction"] = min_pay_construction
        item["max_payment_construction"] = max_pay_construction
        item["min_payment_occupancy"] = min_pay_occupancy
        item["max_payment_occupancy"] = max_pay_occupancy

        def _first_non_none(a: Any, b: Any) -> Any:
            return a if a is not None else b

        item["payment_contract"] = _first_non_none(min_pay_contract, max_pay_contract)
        item["payment_construction"] = _first_non_none(min_pay_construction, max_pay_construction)
        item["payment_occupancy"] = _first_non_none(min_pay_occupancy, max_pay_occupancy)
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


def _project_agg_subquery():
    """Subquery: project_id + all computed aggregates from Unit. Group by project_id."""
    units_available = func.sum(case((Unit.available.is_(True), 1), else_=0)).label("units_available")
    units_reserved = func.sum(
        case((func.lower(Unit.availability_status) == "reserved", 1), else_=0)
    ).label("units_reserved")
    units_priced = func.sum(case((Unit.price_czk.isnot(None), 1), else_=0)).label("units_priced")
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
            func.count(Unit.id).label("units_total"),
            units_available,
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
            # Fallback GPS pro projekty – průměrná poloha jednotek v projektu
            func.avg(Unit.gps_latitude).label("project_gps_latitude"),
            func.avg(Unit.gps_longitude).label("project_gps_longitude"),
            # Sample unit URL (for deriving project_url)
            func.min(Unit.url).label("unit_url_sample"),
            layouts,
        )
        .group_by(Unit.project_id)
        .subquery()
    )


def _project_row_to_item(project: Project, row: Any) -> dict[str, Any]:
    """Build one project item dict: id, catalog keys (from Project), computed keys."""
    out: dict[str, Any] = {"id": project.id}
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

    # Computed from aggregate row (use row._mapping or positional)
    agg = row._mapping if hasattr(row, "_mapping") else {}

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
    out["units_reserved"] = units_reserved
    out["units_priced"] = int(agg.get("units_priced") or 0)

    # Core aggregate metrics
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

    # Derived single-value financing fields (per project).
    def _first_non_none(a, b):
        return a if a is not None else b

    pay_contract = _first_non_none(agg.get("min_payment_contract"), agg.get("max_payment_contract"))
    if isinstance(pay_contract, Decimal):
        pay_contract = float(pay_contract)
    out["payment_contract"] = pay_contract

    pay_construction = _first_non_none(agg.get("min_payment_construction"), agg.get("max_payment_construction"))
    if isinstance(pay_construction, Decimal):
        pay_construction = float(pay_construction)
    out["payment_construction"] = pay_construction

    pay_occupancy = _first_non_none(agg.get("min_payment_occupancy"), agg.get("max_payment_occupancy"))
    if isinstance(pay_occupancy, Decimal):
        pay_occupancy = float(pay_occupancy)
    out["payment_occupancy"] = pay_occupancy

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


def _projects_order_clause(agg_subq, sort_by: str, sort_dir: str):
    """Order by expression for sort_by (catalog or computed key)."""
    allowed = get_projects_sort_keys()
    if sort_by not in allowed:
        return None
    dir_asc = sort_dir.strip().lower() != "desc"
    # Speciální case: řazení podle odkazu na projekt – používáme sample URL z agregátu.
    if sort_by == "project_url":
        col = agg_subq.c.unit_url_sample
    elif sort_by in COMPUTED_COLUMN_KEYS:
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


@app.get(
    "/projects",
    response_model=ProjectsListResponse,
    summary="List projects (catalog + computed)",
    description="Paginated list of projects with all catalog project fields and computed aggregates. Supports q (search name/developer/address), sort_by, sort_dir, limit, offset.",
)
def list_projects(
    db: DbSession,
    q: Annotated[str | None, Query(description="Search in name, developer, address")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort_by: Annotated[str, Query(description="Sort column key (catalog or computed)")] = "avg_price_per_m2_czk",
    sort_dir: Annotated[str, Query(description="asc or desc")] = "asc",
    min_latitude: Annotated[float | None, Query(description="Filter by Project.gps_latitude >= value")] = None,
    max_latitude: Annotated[float | None, Query(description="Filter by Project.gps_latitude <= value")] = None,
    min_longitude: Annotated[float | None, Query(description="Filter by Project.gps_longitude >= value")] = None,
    max_longitude: Annotated[float | None, Query(description="Filter by Project.gps_longitude <= value")] = None,
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
    return apply_project_overrides_to_item(project.id, dict(base_item), override_map)


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


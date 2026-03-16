"""Filter definitions from field_catalog.csv. Only Filterable == ANO. Cached in memory."""

from __future__ import annotations

import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Project, Unit

# Module-level cache for parsed CSV rows (filterable only).
_cached_specs: list[dict] | None = None

RANGE_FORMATS = frozenset({
    "currency", "currency_per_m2", "area_m2", "duration_minutes", "integer", "percent",
})
ENUM_FORMAT = "enum"
ENUM_SEARCH_FORMAT = "enum_search"
BOOLEAN_FORMAT = "boolean"
# Max. počet distinct hodnot pro enum/enum_search filtry.
# 200 bylo málo pro projekty (dlouhé seznamy developerů/projektů),
# rozšíříme limit, aby se do nabídky vešly i „dlouhé“ ocasy jako Klamovka Park.
OPTIONS_LIMIT = 2000

# Catalog column (CSV "column") -> (entity, db_attr). entity is "Unit" or "Project".
# Full API schema: backend_supported=true for all columns that exist; enum options from Unit where stored.
CATALOG_TO_DB: dict[str, tuple[str, str]] = {
    # Unit – Cena, Dispozice, Stav, Standardy, Jednotka
    "price": ("Unit", "price_czk"),
    "price_per_sm": ("Unit", "price_per_m2_czk"),
    "price_change": ("Unit", "price_change"),
    "original_price": ("Unit", "original_price_czk"),
    "original_price_per_sm": ("Unit", "original_price_per_m2_czk"),
    "parking_outdoor_price": ("Unit", "parking_outdoor_price_czk"),
    "parking_indoor_price": ("Unit", "parking_indoor_price_czk"),
    "layout": ("Unit", "layout"),
    "floor_area": ("Unit", "floor_area_m2"),
    "total_area": ("Unit", "total_area_m2"),
    "equivalent_area": ("Unit", "equivalent_area_m2"),
    "exterior_area": ("Unit", "exterior_area_m2"),
    "balcony_area": ("Unit", "balcony_area_m2"),
    "terrace_area": ("Unit", "terrace_area_m2"),
    "garden_area": ("Unit", "garden_area_m2"),
    "floor": ("Unit", "floor"),
    "floors": ("Unit", "floors"),
    "orientation": ("Unit", "orientation"),
    "category": ("Unit", "category"),
    "availability": ("Unit", "availability_status"),
    "unit_name": ("Unit", "unit_name"),
    "external_id": ("Unit", "external_id"),
    "postal_code": ("Unit", "postal_code"),
    "ride_to_center": ("Unit", "ride_to_center_min"),
    "public_transport_to_center": ("Unit", "public_transport_to_center_min"),
    "permit_regular": ("Unit", "permit_regular"),
    "renovation": ("Unit", "renovation"),
    "available": ("Unit", "available"),
    "air_conditioning": ("Unit", "air_conditioning"),
    "cooling_ceilings": ("Unit", "cooling_ceilings"),
    "exterior_blinds": ("Unit", "exterior_blinds"),
    "smart_home": ("Unit", "smart_home"),
    "heating": ("Unit", "heating"),
    "windows": ("Unit", "windows"),
    "partition_walls": ("Unit", "partition_walls"),
    "overall_quality": ("Unit", "overall_quality"),
    "days_on_market": ("Unit", "days_on_market"),
    "first_seen": ("Unit", "first_seen"),
    "last_seen": ("Unit", "last_seen"),
    "sold_date": ("Unit", "sold_date"),
    "payment_contract": ("Unit", "payment_contract"),
    "payment_construction": ("Unit", "payment_construction"),
    "payment_occupancy": ("Unit", "payment_occupancy"),
    "building": ("Unit", "building"),
    # URL jednotky – v katalogu je jako unit_url, v DB jako Unit.url
    "url": ("Unit", "url"),
    "unit_url": ("Unit", "url"),
    "id": ("Unit", "id"),
    "address": ("Unit", "address"),
    "city": ("Unit", "city"),
    "municipality": ("Unit", "municipality"),
    "district": ("Unit", "district"),
    "developer": ("Unit", "developer"),
    "cadastral_area_iga": ("Unit", "cadastral_area_iga"),
    "city_iga": ("Unit", "city_iga"),
    "municipal_district_iga": ("Unit", "municipal_district_iga"),
    "administrative_district_iga": ("Unit", "administrative_district_iga"),
    "region_iga": ("Unit", "region_iga"),
    "district_okres_iga": ("Unit", "district_okres_iga"),
    # Project – used when filter is explicitly project-scoped (project name, developer for project)
    "project": ("Project", "name"),
    "ceiling_height": ("Project", "ceiling_height"),
    "recuperation": ("Project", "recuperation"),
    "cooling": ("Project", "cooling"),
    "concierge": ("Project", "concierge"),
    "reception": ("Project", "reception"),
    "bike_room": ("Project", "bike_room"),
    "stroller_room": ("Project", "stroller_room"),
    "fitness": ("Project", "fitness"),
    "courtyard_garden": ("Project", "courtyard_garden"),
    "noise_day_db": ("Project", "noise_day_db"),
    "noise_night_db": ("Project", "noise_night_db"),
    "noise_label": ("Project", "noise_label"),
    "distance_to_primary_road_m": ("Project", "distance_to_primary_road_m"),
    "distance_to_tram_tracks_m": ("Project", "distance_to_tram_tracks_m"),
    "distance_to_railway_m": ("Project", "distance_to_railway_m"),
    "distance_to_airport_m": ("Project", "distance_to_airport_m"),
    "micro_location_score": ("Project", "micro_location_score"),
    "micro_location_label": ("Project", "micro_location_label"),
    "walkability_score": ("Project", "walkability_score"),
    "walkability_label": ("Project", "walkability_label"),
    "walkability_daily_needs_score": ("Project", "walkability_daily_needs_score"),
    "walkability_transport_score": ("Project", "walkability_transport_score"),
    "walkability_leisure_score": ("Project", "walkability_leisure_score"),
    "walkability_family_score": ("Project", "walkability_family_score"),
    # Walkability distances (Project-level)
    "distance_to_supermarket_m": ("Project", "distance_to_supermarket_m"),
    "distance_to_pharmacy_m": ("Project", "distance_to_pharmacy_m"),
    "distance_to_restaurant_m": ("Project", "distance_to_restaurant_m"),
    "distance_to_cafe_m": ("Project", "distance_to_cafe_m"),
    "distance_to_park_m": ("Project", "distance_to_park_m"),
    "distance_to_fitness_m": ("Project", "distance_to_fitness_m"),
    "distance_to_playground_m": ("Project", "distance_to_playground_m"),
    "distance_to_kindergarten_m": ("Project", "distance_to_kindergarten_m"),
    "distance_to_primary_school_m": ("Project", "distance_to_primary_school_m"),
    "distance_to_tram_stop_m": ("Project", "distance_to_tram_stop_m"),
    "distance_to_bus_stop_m": ("Project", "distance_to_bus_stop_m"),
    "distance_to_metro_station_m": ("Project", "distance_to_metro_station_m"),
    # Walkability counts in 500 m (Project-level)
    "count_supermarket_500m": ("Project", "count_supermarket_500m"),
    "count_pharmacy_500m": ("Project", "count_pharmacy_500m"),
    "count_restaurant_500m": ("Project", "count_restaurant_500m"),
    "count_cafe_500m": ("Project", "count_cafe_500m"),
    "count_park_500m": ("Project", "count_park_500m"),
    "count_fitness_500m": ("Project", "count_fitness_500m"),
    "count_playground_500m": ("Project", "count_playground_500m"),
    "count_kindergarten_500m": ("Project", "count_kindergarten_500m"),
    "count_primary_school_500m": ("Project", "count_primary_school_500m"),
    # Lokální cenová odchylka (p.b., vypočtená offline)
    "local_price_diff_500m": ("Unit", "local_price_diff_500m"),
    "local_price_diff_1000m": ("Unit", "local_price_diff_1000m"),
    "local_price_diff_2000m": ("Unit", "local_price_diff_2000m"),
}


def _normalize(s: str) -> str:
    return (s or "").strip()


def _parse_decimals(s: str) -> int | None:
    s = _normalize(s)
    if not s:
        return None
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


def _entity_normalized(raw: str) -> str:
    """Map CSV Entity to Unit | Project."""
    r = _normalize(raw)
    if r == "Jednotka":
        return "Unit"
    if r == "Projekt":
        return "Project"
    return r or "Unit"


def _display_format_to_type(display_format: str) -> str:
    if display_format in RANGE_FORMATS:
        return "range"
    if display_format == ENUM_FORMAT:
        return "enum"
    if display_format == ENUM_SEARCH_FORMAT:
        return "enum_search"
    if display_format == BOOLEAN_FORMAT:
        return "boolean"
    return "range"


def _load_specs() -> list[dict]:
    """Parse CSV; return only rows with Filterable == ANO. Uses and fills module cache."""
    global _cached_specs
    if _cached_specs is not None:
        return _cached_specs
    path = Path(__file__).resolve().parent / "field_catalog.csv"
    specs: list[dict] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if _normalize(row.get("Filterable", "")).upper() != "ANO":
                continue
            try:
                sort_priority = int(_normalize(row.get("sort_priority", "")) or 0)
            except (TypeError, ValueError):
                sort_priority = 0
            column = _normalize(row.get("column", ""))
            display_format = _normalize(row.get("display_format", ""))
            unit_raw = row.get("unit_label") or row.get("Unit") or ""
            unit = _normalize(unit_raw) or None
            if unit == "":
                unit = None
            specs.append({
                "group": _normalize(row.get("Group", "")),
                "entity_raw": _normalize(row.get("Entity", "")),
                "column": column,
                "alias": _normalize(row.get("Alias", "")),
                "unit": unit,
                "decimals": _parse_decimals(row.get("decimals", "")),
                "display_format": display_format,
                "sort_priority": sort_priority,
            })
    _cached_specs = specs
    return specs


def get_filter_specs() -> list[dict]:
    """Return list of filter specs (Filterable == ANO). Uses cached CSV."""
    return _load_specs()


def _get_enum_options(db: Session, entity: str, attr: str) -> list[str]:
    """Query distinct non-null values; full string values; exclude nulls; sort case-insensitive; limit OPTIONS_LIMIT."""
    if entity == "Unit":
        col = getattr(Unit, attr, None)
        if col is None:
            return []
        stmt = (
            select(col)
            .distinct()
            .select_from(Unit)
            .where(col.isnot(None))
            .limit(OPTIONS_LIMIT)
        )
    else:
        col = getattr(Project, attr, None)
        if col is None:
            return []
        stmt = (
            select(col)
            .distinct()
            .select_from(Unit)
            .join(Unit.project)
            .where(col.isnot(None))
            .limit(OPTIONS_LIMIT)
        )
    rows = db.execute(stmt).scalars().all()
    values = [str(r) for r in rows if r is not None]
    return sorted(set(values), key=str.casefold)


def get_filter_groups(db: Session) -> dict:
    """Return grouped filter definitions for GET /filters. Options filled for enum/boolean when backend_supported."""
    specs = _load_specs()
    groups: dict[str, list[dict]] = {}
    for s in sorted(specs, key=lambda x: (x["group"], x["sort_priority"])):
        group_name = s["group"] or "Other"
        if group_name not in groups:
            groups[group_name] = []
        key = s["column"]
        display_format = s["display_format"]
        filter_type = _display_format_to_type(display_format)
        backend_supported = key in CATALOG_TO_DB
        entity = _entity_normalized(s["entity_raw"])
        out = {
            "key": key,
            "alias": s["alias"],
            "entity": entity,
            "display_format": display_format,
            "unit": s["unit"],
            "decimals": s["decimals"],
            "type": filter_type,
            "backend_supported": backend_supported,
            "options": [],
        }
        if not backend_supported:
            groups[group_name].append(out)
            continue
        if filter_type == "boolean":
            out["options"] = [True, False]
        elif filter_type in ("enum", "enum_search"):
            # Pro enum i enum_search vracíme seznam možných hodnot,
            # aby UI mohlo nabídnout našeptávání i vícenásobný výběr.
            entity_db, attr = CATALOG_TO_DB[key]
            out["options"] = _get_enum_options(db, entity_db, attr)
        groups[group_name].append(out)

    def _group_sort_key(item: tuple[str, list[dict]]) -> tuple[int, str]:
        name, _ = item
        # „Stav“ chceme vždy jako první box ve filtrech (nad Cenou atd.).
        if name == "Stav":
            return (0, name)
        return (1, name)

    ordered_groups = [ {"name": name, "filters": flt} for name, flt in sorted(groups.items(), key=_group_sort_key) ]
    return {"groups": ordered_groups}


# Legacy exports for list_units dynamic filters
ENUM_FORMATS = frozenset({ENUM_FORMAT, ENUM_SEARCH_FORMAT})


def display_format_to_type(display_format: str) -> str:
    return _display_format_to_type(display_format)

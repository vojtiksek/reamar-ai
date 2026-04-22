#!/usr/bin/env python3
"""Import units from JSON into PostgreSQL database."""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from sqlalchemy import delete, desc, select, text, tuple_
from sqlalchemy.orm import Session

from .db import get_db
from .overrides import compute_equivalent_price_per_m2
from .models import (
    Project,
    Unit,
    UnitApiPending,
    UnitOverride,
    UnitPriceHistory,
    UnitSnapshot,
    UnitEvent,
    Client,
    ClientProfile,
    ClientUnitMatch,
    CommuteCache,
)
from .overrides import OVERRIDEABLE_FIELDS, apply_override, build_override_map
from .aggregates import recompute_local_price_diffs, recompute_project_aggregates
from .project_location_metrics import (
    enrich_project_location_metrics,
    should_enrich_after_project_change,
)
from .main import _compute_unit_match_score

# Pole, u kterých při rozdílu API vs. aktuální neukládáme přímo, ale do pending (uživatel zvolí).
API_CONFLICT_FIELDS = frozenset({"price_czk", "availability_status"})  # price_per_m2_czk je počítaná, ne importovaná

# Canonical mapping: API JSON key -> Unit DB attribute. No duplicate columns; renames only.
# Keys not listed use _key_to_attr(key) if that column exists. Skip: unique_id, id, project, availability.
JSON_KEY_TO_DB_ATTR: dict[str, str] = {
    "price": "price_czk",
    "price_per_sm": "price_per_m2_czk",
    "original_price": "original_price_czk",
    "original_price_per_sm": "original_price_per_m2_czk",
    "parking_indoor_price": "parking_indoor_price_czk",
    "parking_outdoor_price": "parking_outdoor_price_czk",
    "floor_area": "floor_area_m2",
    "total_area": "total_area_m2",
    "equivalent_area": "equivalent_area_m2",
    "exterior_area": "exterior_area_m2",
    "balcony_area": "balcony_area_m2",
    "terrace_area": "terrace_area_m2",
    "garden_area": "garden_area_m2",
    "ride_to_center": "ride_to_center_min",
    "public_transport_to_center": "public_transport_to_center_min",
    "unit_url": "url",
    # March 2026: usage renamed to use_type in API
    "use_type": "use_type",
}

# Unit columns that are safe to set from JSON (persisted columns, not relationships).
_UNIT_DATA_COLUMNS: frozenset[str] | None = None


def _get_unit_data_columns() -> frozenset[str]:
    global _UNIT_DATA_COLUMNS
    if _UNIT_DATA_COLUMNS is None:
        _UNIT_DATA_COLUMNS = frozenset(Unit.__table__.c.keys())  # type: ignore[union-attr]
    return _UNIT_DATA_COLUMNS


def _key_to_attr(key: str) -> str:
    """Normalize JSON key to valid Python attribute name (snake_case)."""
    s = re.sub(r"[\s\-]+", "_", key)
    s = re.sub(r"[^a-zA-Z0-9_]", "", s)
    s = s.strip("_").lower()
    if not s:
        s = "field_" + key[:50].replace(" ", "_")
    if s and s[0].isdigit():
        s = "_" + s
    return s or "unknown"


def _get_attr_for_json_key(key: str) -> str | None:
    """Return Unit attribute name for JSON key, or None if not a data column."""
    # Excluded: identity/routing keys, and project-level fields that must not land on Unit.
    if key in (
        "unique_id", "id", "project",
        # Project-level fields (handled in apply_project_data):
        "builtmind_project_id", "builtmind_developer_id",
        "project_url", "construction_completion",
    ):
        return None
    attr = JSON_KEY_TO_DB_ATTR.get(key) or _key_to_attr(key)
    if attr in _get_unit_data_columns():
        return attr
    return None


def _attrs_tracked_from_unit_data(unit_data: dict[str, Any]) -> set[str]:
    """Set of Unit attribute names that may be updated from this unit_data (for change report)."""
    attrs: set[str] = set()
    for key in unit_data:
        if key == "availability":
            attrs.add("availability_status")
            attrs.add("available")
        elif key not in ("unique_id", "id"):
            attr = _get_attr_for_json_key(key)
            if attr:
                attrs.add(attr)
    return attrs


def _normalize_value_for_column(value: Any, column_type: Any = None) -> Any:
    """Normalize a JSON value for storage in a Unit column. Uses column_type if provided."""
    if value is None:
        return None
    type_name = type(column_type).__name__ if column_type is not None else ""
    if "Integer" in type_name:
        return normalize_int(value)
    if "Numeric" in type_name or "Float" in type_name:
        return normalize_decimal(value, 4)
    if "Boolean" in type_name:
        return normalize_bool(value)
    if "Date" in type_name and "Time" not in type_name:
        return normalize_date(value)
    if "TIMESTAMP" in type_name or "DateTime" in type_name:
        if isinstance(value, datetime):
            return value
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, datetime.min.time())
        s = str(value).strip()
        if len(s) >= 19:
            try:
                return datetime.strptime(s[:19].replace(" ", "T"), "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                pass
        d = normalize_date(value)
        return datetime.combine(d, datetime.min.time()) if d else None
    if "Text" in type_name:
        return normalize_str(value, 65535)
    if "String" in type_name:
        return normalize_str(value, 255)
    # Infer from value
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, (float, Decimal)):
        return normalize_decimal(value, 4)
    if isinstance(value, datetime):
        return value
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    s = str(value).strip()
    if not s:
        return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            if "T" in s or (" " in s and len(s) > 10):
                return datetime.strptime(s[:19].replace(" ", "T"), "%Y-%m-%dT%H:%M:%S")
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    return s


def normalize_decimal(value: Any, precision: int) -> Decimal | None:
    """Convert value to Decimal with specified precision, or None if invalid."""
    if value is None:
        return None
    try:
        dec = Decimal(str(value))
        quantize_str = f"0.{'0' * precision}"
        return dec.quantize(Decimal(quantize_str), rounding=ROUND_HALF_UP)
    except (ValueError, TypeError):
        return None


def normalize_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (ValueError, TypeError):
        return None


def normalize_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("true", "1", "yes", "on")
    try:
        return bool(value)
    except (ValueError, TypeError):
        return None


def normalize_exterior_blinds(value: Any) -> str | None:
    """Store API value as 'true' | 'false' | 'preparation'."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    s = str(value).strip().lower()
    if s in ("true", "1", "yes", "on"):
        return "true"
    if s in ("false", "0", "no", "off"):
        return "false"
    if s == "preparation":
        return "preparation"
    return s if s else None


def normalize_project_standard_state(value: Any) -> str | None:
    """Normalize project-level standard state (recuperation, cooling) to 'true' | 'false' | 'preparation'.

    Ensures string 'false' is stored as 'false', not coerced to a truthy non-empty string.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    s = str(value).strip().lower()
    if s in ("true", "1", "yes", "on"):
        return "true"
    if s in ("false", "0", "no", "off"):
        return "false"
    if s == "preparation":
        return "preparation"
    return s if s else None


def normalize_str(value: Any, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if max_length and len(s) > max_length:
        return s[:max_length]
    return s


def normalize_date(value: Any) -> date | None:
    """Parse date from string (YYYY-MM-DD) or date/datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        s = str(value).strip()[:10]
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        pass
    return None


def _parse_completion_date(raw: str) -> date | None:
    """Derive a sortable DATE from a construction_completion string.

    Formats from BuiltMind API:
      "YYYY-MM"  → first day of that month (exact hand-over month known)
      "YYYY"     → Dec 31 of that year (conservative: latest possible within year)
    Any year < 2000 or unrecognised format → None (legacy / bad data, leave unset).
    """
    s = str(raw).strip()[:7]
    try:
        if len(s) == 7 and s[4] == "-":          # "YYYY-MM"
            y, m = int(s[:4]), int(s[5:7])
            if y >= 2000:
                return date(y, m, 1)
        elif len(s) >= 4 and s[:4].isdigit():    # bare "YYYY"
            y = int(s[:4])
            if y >= 2000:
                return date(y, 12, 31)
    except (ValueError, TypeError):
        pass
    return None


def apply_unit_data_mapped(
    unit: Unit,
    unit_data: dict[str, Any],
    *,
    only_if_present: bool = False,
) -> None:
    """Store full JSON in raw_json and set every mapped column from unit_data. Do not overwrite with None when only_if_present."""
    unit.raw_json = dict(unit_data)
    columns = _get_unit_data_columns()
    table = Unit.__table__
    for key, value in unit_data.items():
        if key == "availability":
            if not only_if_present or value is not None:
                unit.availability_status = normalize_str(value, 50)
                unit.available = (normalize_str(value, 50) or "").lower() == "available"
            continue
        if key in ("unique_id", "id"):
            continue
        attr = _get_attr_for_json_key(key)
        if not attr:
            continue
        if only_if_present and value is None:
            continue
        col = table.c.get(attr)
        column_type = col.type if col is not None else None
        normalized = _normalize_value_for_column(value, column_type)
        setattr(unit, attr, normalized)
    # Pokud má jednotka vyplněné sold_date, vždy nastavíme status na "sold"
    if unit.sold_date is not None:
        unit.availability_status = "sold"
        unit.available = False


def apply_project_data(
    project: Project,
    unit_data: dict[str, Any],
    *,
    only_if_present: bool = False,
) -> None:
    """Set project fields from unit_data (project-level fields). When only_if_present=True, do not overwrite with None."""
    # March 2026: city/district/municipality removed from API; fall back to IGA fields.
    _city = unit_data.get("city") or unit_data.get("city_iga")
    if not only_if_present or _city is not None:
        project.city = normalize_str(_city, 255)
    _municipality = unit_data.get("municipality") or unit_data.get("municipality_iga")
    if not only_if_present or _municipality is not None:
        project.municipality = normalize_str(_municipality, 255)
    _district = unit_data.get("district") or unit_data.get("district_dzielnica_iga")
    if not only_if_present or _district is not None:
        project.district = normalize_str(_district, 255)

    if not only_if_present or unit_data.get("postal_code") is not None:
        project.postal_code = normalize_str(unit_data.get("postal_code"), 32)
    if not only_if_present or unit_data.get("cadastral_area_iga") is not None:
        project.cadastral_area_iga = normalize_str(unit_data.get("cadastral_area_iga"), 255)
    if not only_if_present or unit_data.get("administrative_district_iga") is not None:
        project.administrative_district_iga = normalize_str(unit_data.get("administrative_district_iga"), 255)
    if not only_if_present or unit_data.get("region_iga") is not None:
        project.region_iga = normalize_str(unit_data.get("region_iga"), 255)
    if not only_if_present or unit_data.get("gps_latitude") is not None:
        project.gps_latitude = normalize_decimal(unit_data.get("gps_latitude"), 8)
    if not only_if_present or unit_data.get("gps_longitude") is not None:
        project.gps_longitude = normalize_decimal(unit_data.get("gps_longitude"), 8)
    if not only_if_present or unit_data.get("ride_to_center") is not None:
        project.ride_to_center_min = normalize_decimal(unit_data.get("ride_to_center"), 1)
    if not only_if_present or unit_data.get("public_transport_to_center") is not None:
        project.public_transport_to_center_min = normalize_decimal(
            unit_data.get("public_transport_to_center"), 1
        )
    if not only_if_present or unit_data.get("permit_regular") is not None:
        project.permit_regular = normalize_bool(unit_data.get("permit_regular"))
    if not only_if_present or unit_data.get("renovation") is not None:
        project.renovation = normalize_bool(unit_data.get("renovation"))
    if not only_if_present or unit_data.get("overall_quality") is not None:
        project.overall_quality = normalize_str(unit_data.get("overall_quality"), 255)
    if not only_if_present or unit_data.get("windows") is not None:
        project.windows = normalize_str(unit_data.get("windows"), 255)
    if not only_if_present or unit_data.get("heating") is not None:
        project.heating = normalize_str(unit_data.get("heating"), 255)
    if not only_if_present or unit_data.get("partition_walls") is not None:
        project.partition_walls = normalize_str(unit_data.get("partition_walls"), 255)
    if not only_if_present or unit_data.get("amenities") is not None:
        project.amenities = normalize_str(unit_data.get("amenities"), 65535)

    # March 2026: new project-level fields from API
    if not only_if_present or unit_data.get("project_url") is not None:
        project.project_url = normalize_str(unit_data.get("project_url"), 1024)

    # Extrahuj čtvrť z adresy formátu "... Praha N-Čtvrť, ..."
    # Příklady: "186 00 Praha 8-Karlín" → "Karlín", "120 00 Praha 2-Vinohrady" → "Vinohrady"
    _address = normalize_str(unit_data.get("address"), 255)
    if _address:
        import re as _re
        m = _re.search(r"Praha \d+-([^,]+)", _address)
        project.neighborhood = m.group(1).strip() if m else None
    elif not only_if_present:
        project.neighborhood = None

    raw_cc = unit_data.get("construction_completion")
    if not only_if_present or raw_cc is not None:
        project.construction_completion = normalize_str(raw_cc, 20)
        # Derive a sortable completion_date from the raw string so scoring/filtering work.
        if raw_cc:
            project.completion_date = _parse_completion_date(str(raw_cc))
        elif not only_if_present:
            project.completion_date = None

    # BuiltMind IDs: always record when present (never clear, never guard with only_if_present).
    _bm_pid = normalize_int(unit_data.get("builtmind_project_id"))
    if _bm_pid is not None:
        project.builtmind_project_id = _bm_pid
    _bm_did = normalize_int(unit_data.get("builtmind_developer_id"))
    if _bm_did is not None:
        project.builtmind_developer_id = _bm_did

    # recuperation / cooling: project-level standards (string, not boolean)
    if not only_if_present or unit_data.get("recuperation") is not None:
        project.recuperation = normalize_project_standard_state(unit_data.get("recuperation"))
    if not only_if_present or unit_data.get("cooling") is not None:
        project.cooling = normalize_project_standard_state(unit_data.get("cooling"))


def project_key(developer: Any, name: Any, address: Any) -> tuple[str | None, str, str | None]:
    """Normalized (developer, name, address) for deduplication and DB lookup."""
    return (
        normalize_str(developer, 255),
        normalize_str(name, 255) or "",
        normalize_str(address, 255),
    )


def load_json_units(file_path: Path) -> list[dict[str, Any]]:
    """Load units from JSON file. Handles list or wrapped formats."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if "units" in data:
            return data["units"]
        if "data" in data:
            return data["data"]
        raise ValueError(f"JSON object must contain 'units' or 'data' key, got: {list(data.keys())}")
    raise ValueError(f"JSON must be a list or object, got: {type(data)}")


def batch_load_projects(
    db: Session,
    keys: list[tuple[str | None, str, str | None]],
) -> dict[tuple[str | None, str, str | None], Project]:
    """Load projects by (developer, name, address) keys. Returns key -> Project."""
    if not keys:
        return {}
    unique_keys = list(dict.fromkeys(keys))
    # WHERE (developer, name, address) IN ((...), (...))
    stmt = select(Project).where(
        tuple_(Project.developer, Project.name, Project.address).in_(unique_keys)
    )
    rows = db.execute(stmt).scalars().all()
    return {(p.developer, p.name, p.address): p for p in rows}


def batch_load_projects_by_builtmind_id(
    db: Session,
    builtmind_ids: list[int],
) -> dict[int, Project]:
    """Load projects by builtmind_project_id. Returns builtmind_project_id -> Project."""
    if not builtmind_ids:
        return {}
    unique_ids = list(dict.fromkeys(bid for bid in builtmind_ids if bid is not None))
    if not unique_ids:
        return {}
    stmt = select(Project).where(Project.builtmind_project_id.in_(unique_ids))
    rows = db.execute(stmt).scalars().all()
    return {p.builtmind_project_id: p for p in rows}


def batch_load_units_by_external_id(
    db: Session,
    external_ids: list[str],
) -> dict[str, Unit]:
    """Load units by external_id. Returns external_id -> Unit."""
    if not external_ids:
        return {}
    unique_ids = list(dict.fromkeys(external_ids))
    stmt = select(Unit).where(Unit.external_id.in_(unique_ids))
    rows = db.execute(stmt).scalars().all()
    return {u.external_id: u for u in rows}


def batch_load_latest_price_history(
    db: Session,
    unit_ids: list[int],
) -> dict[int, UnitPriceHistory]:
    """Load latest price history row per unit (captured_at desc, id desc). Returns unit_id -> row."""
    if not unit_ids:
        return {}
    unique_ids = list(dict.fromkeys(unit_ids))
    # DISTINCT ON (unit_id) ... ORDER BY unit_id, captured_at DESC, id DESC
    subq = (
        select(UnitPriceHistory)
        .where(UnitPriceHistory.unit_id.in_(unique_ids))
        .order_by(
            UnitPriceHistory.unit_id,
            desc(UnitPriceHistory.captured_at),
            desc(UnitPriceHistory.id),
        )
        .distinct(UnitPriceHistory.unit_id)
    )
    rows = db.execute(subq).scalars().all()
    return {r.unit_id: r for r in rows}


def batch_load_unit_overrides(
    db: Session,
    unit_ids: list[int],
) -> dict[int, dict[str, str]]:
    """Load unit overrides for given unit IDs. Returns unit_id -> {field: value}."""
    if not unit_ids:
        return {}
    unique_ids = list(dict.fromkeys(unit_ids))
    stmt = select(UnitOverride).where(UnitOverride.unit_id.in_(unique_ids))
    rows = db.execute(stmt).scalars().all()
    return build_override_map([r for r in rows])


def _effective_value(unit: Unit, overrides: dict[str, str], field: str) -> Any:
    """Aktuální efektivní hodnota pole (override nebo hodnota na jednotce)."""
    base = getattr(unit, field, None)
    if field not in overrides:
        return base
    return apply_override(field, overrides[field], base, unit.id)


def apply_unit_data_respecting_overrides(
    unit: Unit,
    unit_data: dict[str, Any],
    overrides: dict[str, str],
    pending_list: list[tuple[int, str, str]],
    *,
    only_if_present: bool = False,
) -> None:
    """Jako apply_unit_data_mapped, ale:
    - u override polí (UnitOverride) nepřepisujeme základní hodnoty z API
    - u price_czk, price_per_m2_czk, availability_status:
        * pokud je na poli override → rozdíl API vs. efektivní ukládáme do pending_list
        * pokud override není → hodnotu z API normálně zapíšeme (bez pending)
    """
    unit.raw_json = dict(unit_data)
    table = Unit.__table__

    for key, value in unit_data.items():
        if key == "availability":
            new_status = normalize_str(value, 50)
            new_available = (new_status or "").lower() == "available"
            # Pokud existuje override na availability_status, API do pole přímo nezapisujeme
            # a případný rozdíl ukládáme jen jako pending návrh.
            if overrides.get("availability_status") is not None:
                effective = _effective_value(unit, overrides, "availability_status")
                if str(new_status or "") != str(effective or ""):
                    pending_list.append((unit.id, "availability_status", new_status or ""))
                continue
            # Bez override zapisujeme hodnotu z API přímo (bez pending).
            if not only_if_present or value is not None:
                unit.availability_status = new_status
                unit.available = new_available
            continue
        if key in ("unique_id", "id"):
            continue
        attr = _get_attr_for_json_key(key)
        if not attr:
            continue
        if only_if_present and value is None:
            continue
        # Pole s overrides na jednotce nikdy nepřepisujeme přímo – override má přednost.
        if attr in OVERRIDEABLE_FIELDS and attr in overrides:
            # U konfliktních polí (cena, cena/m2, stav) chceme návrhy z API (pending),
            # u ostatních override polí API ignorujeme úplně.
            if attr in API_CONFLICT_FIELDS:
                effective = _effective_value(unit, overrides, attr)
                col = table.c.get(attr)
                column_type = col.type if col is not None else None
                normalized = _normalize_value_for_column(value, column_type)
                if normalized != effective:
                    pending_list.append(
                        (unit.id, attr, str(normalized) if normalized is not None else "")
                    )
            # Ať už konflikt byl nebo ne, základní hodnotu na jednotce neměníme.
            continue
        col = table.c.get(attr)
        column_type = col.type if col is not None else None
        normalized = _normalize_value_for_column(value, column_type)
        setattr(unit, attr, normalized)


def apply_unit_data(
    unit: Unit,
    unit_data: dict[str, Any],
    *,
    only_if_present: bool = False,
) -> None:
    """Set unit fields from normalized unit_data. When only_if_present=True, do not overwrite with None."""
    if not only_if_present or unit_data.get("unit_name") is not None:
        unit.unit_name = normalize_str(unit_data.get("unit_name"), 255)
    if not only_if_present or unit_data.get("layout") is not None:
        unit.layout = normalize_str(unit_data.get("layout"), 255)
    if not only_if_present or unit_data.get("floor") is not None:
        unit.floor = normalize_int(unit_data.get("floor"))
    availability = unit_data.get("availability")
    if not only_if_present or availability is not None:
        unit.availability_status = normalize_str(availability, 50)
        unit.available = (normalize_str(availability, 50) or "").lower() == "available"
    if not only_if_present or unit_data.get("price") is not None:
        unit.price_czk = normalize_int(unit_data.get("price"))
    # price_per_m2_czk: ignorujeme API hodnotu, počítáme ekvivalentní cenu z ploch
    # (přepočet se provede na konci funkce po nastavení všech ploch)
    if not only_if_present or unit_data.get("price_change") is not None:
        unit.price_change = normalize_decimal(unit_data.get("price_change"), 4)
    if not only_if_present or unit_data.get("original_price") is not None:
        unit.original_price_czk = normalize_int(unit_data.get("original_price"))
    if not only_if_present or unit_data.get("original_price_per_sm") is not None:
        unit.original_price_per_m2_czk = normalize_int(unit_data.get("original_price_per_sm"))
    if not only_if_present or unit_data.get("parking_indoor_price") is not None:
        unit.parking_indoor_price_czk = normalize_int(unit_data.get("parking_indoor_price"))
    if not only_if_present or unit_data.get("parking_outdoor_price") is not None:
        unit.parking_outdoor_price_czk = normalize_int(unit_data.get("parking_outdoor_price"))
    if not only_if_present or unit_data.get("floor_area") is not None:
        unit.floor_area_m2 = normalize_decimal(unit_data.get("floor_area"), 1)
    if not only_if_present or unit_data.get("total_area") is not None:
        unit.total_area_m2 = normalize_decimal(unit_data.get("total_area"), 1)
    if not only_if_present or unit_data.get("equivalent_area") is not None:
        unit.equivalent_area_m2 = normalize_decimal(unit_data.get("equivalent_area"), 1)
    if not only_if_present or unit_data.get("exterior_area") is not None:
        unit.exterior_area_m2 = normalize_decimal(unit_data.get("exterior_area"), 1)
    if not only_if_present or unit_data.get("balcony_area") is not None:
        unit.balcony_area_m2 = normalize_decimal(unit_data.get("balcony_area"), 1)
    if not only_if_present or unit_data.get("terrace_area") is not None:
        unit.terrace_area_m2 = normalize_decimal(unit_data.get("terrace_area"), 1)
    if not only_if_present or unit_data.get("garden_area") is not None:
        unit.garden_area_m2 = normalize_decimal(unit_data.get("garden_area"), 1)
    if not only_if_present or unit_data.get("gps_latitude") is not None:
        unit.gps_latitude = normalize_decimal(unit_data.get("gps_latitude"), 8)
    if not only_if_present or unit_data.get("gps_longitude") is not None:
        unit.gps_longitude = normalize_decimal(unit_data.get("gps_longitude"), 8)
    if not only_if_present or unit_data.get("ride_to_center") is not None:
        unit.ride_to_center_min = normalize_decimal(unit_data.get("ride_to_center"), 1)
    if not only_if_present or unit_data.get("public_transport_to_center") is not None:
        unit.public_transport_to_center_min = normalize_decimal(
            unit_data.get("public_transport_to_center"), 1
        )
    if not only_if_present or unit_data.get("days_on_market") is not None:
        unit.days_on_market = normalize_int(unit_data.get("days_on_market"))
    if not only_if_present or unit_data.get("payment_contract") is not None:
        unit.payment_contract = normalize_decimal(unit_data.get("payment_contract"), 4)
    if not only_if_present or unit_data.get("payment_construction") is not None:
        unit.payment_construction = normalize_decimal(unit_data.get("payment_construction"), 4)
    if not only_if_present or unit_data.get("payment_occupancy") is not None:
        unit.payment_occupancy = normalize_decimal(unit_data.get("payment_occupancy"), 4)
    if not only_if_present or unit_data.get("first_seen") is not None:
        unit.first_seen = normalize_date(unit_data.get("first_seen"))
    if not only_if_present or unit_data.get("last_seen") is not None:
        unit.last_seen = normalize_date(unit_data.get("last_seen"))
    if not only_if_present or unit_data.get("sold_date") is not None:
        unit.sold_date = normalize_date(unit_data.get("sold_date"))
    if not only_if_present or unit_data.get("permit_regular") is not None:
        unit.permit_regular = normalize_bool(unit_data.get("permit_regular"))
    if not only_if_present or unit_data.get("renovation") is not None:
        unit.renovation = normalize_bool(unit_data.get("renovation"))
    if not only_if_present or unit_data.get("air_conditioning") is not None:
        unit.air_conditioning = normalize_bool(unit_data.get("air_conditioning"))
    if not only_if_present or unit_data.get("cooling_ceilings") is not None:
        unit.cooling_ceilings = normalize_bool(unit_data.get("cooling_ceilings"))
    if not only_if_present or unit_data.get("exterior_blinds") is not None:
        unit.exterior_blinds = normalize_exterior_blinds(unit_data.get("exterior_blinds"))
    if not only_if_present or unit_data.get("smart_home") is not None:
        unit.smart_home = normalize_bool(unit_data.get("smart_home"))
    if not only_if_present or unit_data.get("category") is not None:
        unit.category = normalize_str(unit_data.get("category"), 255)
    if not only_if_present or unit_data.get("orientation") is not None:
        unit.orientation = normalize_str(unit_data.get("orientation"), 255)
    if not only_if_present or unit_data.get("sale_type") is not None:
        unit.sale_type = normalize_str(unit_data.get("sale_type"), 255)
    if not only_if_present or unit_data.get("building") is not None:
        unit.building = normalize_str(unit_data.get("building"), 255)
    if not only_if_present or unit_data.get("amenities") is not None:
        unit.amenities = normalize_str(unit_data.get("amenities"), 65535)
    # March 2026: API renamed usage -> use_type; read either key.
    _use_type = unit_data.get("use_type") or unit_data.get("usage")
    if not only_if_present or _use_type is not None:
        unit.use_type = normalize_str(_use_type, 255)
    if not only_if_present or unit_data.get("building_use") is not None:
        unit.building_use = normalize_str(unit_data.get("building_use"), 255)
    if not only_if_present or unit_data.get("windows") is not None:
        unit.windows = normalize_str(unit_data.get("windows"), 255)
    if not only_if_present or unit_data.get("heating") is not None:
        unit.heating = normalize_str(unit_data.get("heating"), 255)
    if not only_if_present or unit_data.get("partition_walls") is not None:
        unit.partition_walls = normalize_str(unit_data.get("partition_walls"), 255)
    if not only_if_present or unit_data.get("overall_quality") is not None:
        unit.overall_quality = normalize_str(unit_data.get("overall_quality"), 255)
    if not only_if_present or unit_data.get("cadastral_area_iga") is not None:
        unit.cadastral_area_iga = normalize_str(unit_data.get("cadastral_area_iga"), 255)
    if not only_if_present or unit_data.get("city_iga") is not None:
        unit.city_iga = normalize_str(unit_data.get("city_iga"), 255)
    if not only_if_present or unit_data.get("municipal_district_iga") is not None:
        unit.municipal_district_iga = normalize_str(unit_data.get("municipal_district_iga"), 255)
    if not only_if_present or unit_data.get("administrative_district_iga") is not None:
        unit.administrative_district_iga = normalize_str(unit_data.get("administrative_district_iga"), 255)
    if not only_if_present or unit_data.get("region_iga") is not None:
        unit.region_iga = normalize_str(unit_data.get("region_iga"), 255)
    if not only_if_present or unit_data.get("district_okres_iga") is not None:
        unit.district_okres_iga = normalize_str(unit_data.get("district_okres_iga"), 255)
    # March 2026: city/district/municipality removed from API; fall back to IGA fields.
    _district = unit_data.get("district") or unit_data.get("district_dzielnica_iga")
    if not only_if_present or _district is not None:
        unit.district = normalize_str(_district, 255)
    if not only_if_present or unit_data.get("address") is not None:
        unit.address = normalize_str(unit_data.get("address"), 255)
    _city = unit_data.get("city") or unit_data.get("city_iga")
    if not only_if_present or _city is not None:
        unit.city = normalize_str(_city, 255)
    _municipality = unit_data.get("municipality") or unit_data.get("municipality_iga")
    if not only_if_present or _municipality is not None:
        unit.municipality = normalize_str(_municipality, 255)
    if not only_if_present or unit_data.get("postal_code") is not None:
        unit.postal_code = normalize_str(unit_data.get("postal_code"), 32)
    if not only_if_present or unit_data.get("developer") is not None:
        unit.developer = normalize_str(unit_data.get("developer"), 255)
    if not only_if_present or unit_data.get("url") is not None:
        unit.url = normalize_str(unit_data.get("url"), 1024)
    # March 2026: new unit-level reservation fields
    if not only_if_present or unit_data.get("reserved_date") is not None:
        unit.reserved_date = normalize_date(unit_data.get("reserved_date"))
    if not only_if_present or unit_data.get("reservation_duration_days") is not None:
        unit.reservation_duration_days = normalize_int(unit_data.get("reservation_duration_days"))
    if not only_if_present or unit_data.get("is_stale_reservation") is not None:
        unit.is_stale_reservation = normalize_bool(unit_data.get("is_stale_reservation"))

    # Pokud má jednotka vyplněné sold_date, vždy nastavíme status na "sold"
    if unit.sold_date is not None:
        unit.availability_status = "sold"
        unit.available = False

    # Vždy přepočítat ekvivalentní cenu za m² z aktuálních ploch
    unit.price_per_m2_czk = compute_equivalent_price_per_m2(
        unit.price_czk,
        float(unit.floor_area_m2) if unit.floor_area_m2 is not None else None,
        float(unit.exterior_area_m2) if unit.exterior_area_m2 is not None else None,
    )


def should_insert_history(
    last: UnitPriceHistory | None,
    price_czk: int | None,
    price_per_m2_czk: int | None,
    availability_status: str | None,
    available: bool,
) -> bool:
    if last is None:
        return True
    return (
        last.price_czk != price_czk
        or last.price_per_m2_czk != price_per_m2_czk
        or last.availability_status != availability_status
        or last.available != available
    )


def cleanup_not_seen_in_dead_projects(session: Session, dead_project_days: int = 180) -> int:
    """Označí not_seen jednotky bez sold_date jako sold, pokud jsou v projektu kde:
    - žádná jednotka není available
    - projekt je v DB déle než dead_project_days dní (dle min first_seen jednotek)

    Vrací počet opravených jednotek.
    """
    result = session.execute(text("""
        WITH project_stats AS (
            SELECT
                project_id,
                min(first_seen) AS project_first_seen,
                count(*) FILTER (WHERE lower(availability_status) = 'available') AS available_count
            FROM units
            GROUP BY project_id
        )
        UPDATE units u
        SET availability_status = 'sold',
            available = false
        FROM project_stats ps
        WHERE u.project_id = ps.project_id
          AND lower(u.availability_status) = 'not_seen'
          AND u.sold_date IS NULL
          AND ps.project_first_seen <= NOW() - CAST(:days || ' days' AS INTERVAL)
          AND ps.available_count = 0
    """), {"days": dead_project_days})
    return result.rowcount


def import_units(
    json_path: Path,
    source: str | None,
    dry_run: bool = False,
    chunk_size: int = 2000,
) -> dict:
    """Main import function. Uses one session and one transaction (commit at end unless dry_run).

    Returns a dict with keys: projects_created, projects_reused, units_created,
    units_updated, history_inserted, elapsed_seconds.
    """
    print(f"Loading JSON from: {json_path}")
    load_start = time.perf_counter()
    units_data = load_json_units(json_path)
    load_elapsed = time.perf_counter() - load_start
    print(f"Found {len(units_data)} units in JSON (load: {load_elapsed:.2f}s)")

    # Filter valid rows and build project keys
    valid: list[tuple[dict[str, Any], tuple[str | None, str, str | None], str]] = []
    for idx, unit_data in enumerate(units_data, 1):
        unique_id = unit_data.get("unique_id")
        if not unique_id:
            print(f"Warning: Unit {idx} missing unique_id, skipping")
            continue
        project_name = unit_data.get("project")
        if not project_name:
            print(f"Warning: Unit {idx} (unique_id={unique_id}) missing project name, skipping")
            continue
        key = project_key(
            unit_data.get("developer"),
            project_name,
            unit_data.get("address"),
        )
        valid.append((unit_data, key, str(unique_id)))

    total_start = time.perf_counter()
    projects_created = 0
    projects_reused = 0
    units_created = 0
    units_updated = 0
    history_inserted = 0
    snapshot_id: int | None = None
    changes_by_field: dict[str, int] = {}

    with get_db() as db:
        if not dry_run:
            snapshot = UnitSnapshot(source=normalize_str(source, 255))
            db.add(snapshot)
            db.flush()
            snapshot_id = snapshot.id
            captured_at = snapshot.imported_at
            print(f"Created UnitSnapshot id={snapshot_id} (source={source})")
        else:
            from datetime import timezone
            captured_at = datetime.now(timezone.utc)

        touched_project_ids: set[int] = set()
        total_chunks = (len(valid) + chunk_size - 1) // chunk_size

        for chunk_start in range(0, len(valid), chunk_size):
            chunk_idx = chunk_start // chunk_size + 1
            chunk_t0 = time.perf_counter()
            chunk = valid[chunk_start : chunk_start + chunk_size]
            project_keys = [k for _, k, _ in chunk]
            external_ids = [eid for _, _, eid in chunk]
            print(
                f"[chunk {chunk_idx}/{total_chunks}] start: {len(chunk)} units "
                f"({chunk_start}-{chunk_start + len(chunk)})",
                flush=True,
            )

            # Batch load existing projects and units
            projects_map = batch_load_projects(db, project_keys)

            # Phase 2 project-id matching: prefer builtmind_project_id over name-key.
            # Build key -> builtmind_project_id from first unit in chunk with that key.
            key_to_builtmind_id: dict[tuple, int | None] = {}
            for ud, k, _ in chunk:
                if k not in key_to_builtmind_id:
                    key_to_builtmind_id[k] = normalize_int(ud.get("builtmind_project_id"))
            bm_ids = [bid for bid in key_to_builtmind_id.values() if bid is not None]
            builtmind_id_map = batch_load_projects_by_builtmind_id(db, bm_ids)

            units_map = batch_load_units_by_external_id(db, external_ids)

            # Resolve or create projects (unique keys per chunk).
            # Priority: 1) builtmind_project_id match, 2) name-key match, 3) create new.
            project_key_to_project: dict[tuple[str | None, str, str | None], Project] = {}
            for key in project_keys:
                if key in project_key_to_project:
                    continue
                bm_id = key_to_builtmind_id.get(key)
                if bm_id is not None and bm_id in builtmind_id_map:
                    # Found existing project via stable BuiltMind ID (survives renames).
                    project_key_to_project[key] = builtmind_id_map[bm_id]
                    projects_reused += 1
                elif key in projects_map:
                    project_key_to_project[key] = projects_map[key]
                    projects_reused += 1
                else:
                    proj = Project(developer=key[0], name=key[1], address=key[2])
                    if not dry_run:
                        db.add(proj)
                        db.flush()
                    project_key_to_project[key] = proj
                    projects_created += 1

            existing_unit_ids = [u.id for u in units_map.values()]
            latest_history = batch_load_latest_price_history(db, existing_unit_ids) if existing_unit_ids else {}
            override_map = batch_load_unit_overrides(db, existing_unit_ids)
            pending_list: list[tuple[int, str, str]] = []

            # Track which projects need location-metrics enrichment (new or gps/region changed)
            old_project_location: dict[tuple[str | None, str, str | None], tuple[Any, Any, Any]] = {}
            for key in project_key_to_project:
                if key in projects_map:
                    p = project_key_to_project[key]
                    old_project_location[key] = (p.gps_latitude, p.gps_longitude, p.region_iga)
            enrich_project_ids: set[int] = set()
            for key in project_key_to_project:
                if key not in projects_map and project_key_to_project[key].id is not None:
                    enrich_project_ids.add(project_key_to_project[key].id)

            for unit_data, key, external_id in chunk:
                project = project_key_to_project[key]
                project_id = project.id  # None in dry-run for new projects; we don't persist then
                if project_id is not None:
                    touched_project_ids.add(project_id)
                apply_project_data(project, unit_data, only_if_present=(key in projects_map))
                unit = units_map.get(external_id)
                is_new = unit is None

                if is_new:
                    unit = Unit(external_id=external_id, project_id=project_id or 0)
                    apply_unit_data_mapped(unit, unit_data, only_if_present=False)
                else:
                    attrs_tracked = _attrs_tracked_from_unit_data(unit_data)
                    old_vals = {a: getattr(unit, a, None) for a in attrs_tracked}
                    apply_unit_data_respecting_overrides(
                        unit,
                        unit_data,
                        override_map.get(unit.id, {}),
                        pending_list,
                        only_if_present=True,
                    )
                    for a in attrs_tracked:
                        new_v = getattr(unit, a, None)
                        old_v = old_vals.get(a)
                        if old_v != new_v:
                            changes_by_field[a] = changes_by_field.get(a, 0) + 1

                    # Detect unit events based on changes in price and availability/status.
                    old_price = old_vals.get("price_czk")
                    new_price = getattr(unit, "price_czk", None)
                    if old_price is not None and new_price is not None and old_price != new_price:
                        ev_type = "price_drop" if new_price < old_price else "price_increase"
                        if not dry_run:
                            db.add(
                                UnitEvent(
                                    unit_id=unit.id,
                                    event_type=ev_type,
                                    old_value=str(old_price),
                                    new_value=str(new_price),
                                )
                            )

                    old_available = old_vals.get("available")
                    new_available = getattr(unit, "available", None)
                    if old_available is not None and new_available is not None and old_available != new_available:
                        if old_available is False and new_available is True:
                            ev_type = "status_available"
                        elif old_available is True and new_available is False:
                            ev_type = "status_reserved"
                        else:
                            ev_type = None
                        if ev_type and not dry_run:
                            db.add(
                                UnitEvent(
                                    unit_id=unit.id,
                                    event_type=ev_type,
                                    old_value=str(old_available),
                                    new_value=str(new_available),
                                )
                            )

                if is_new:
                    if dry_run:
                        units_created += 1
                        history_inserted += 1  # first row per new unit
                        continue
                    unit.project_id = project_id
                    db.add(unit)
                    db.flush()
                    units_created += 1
                    # Record new unit event
                    if not dry_run:
                        db.add(
                            UnitEvent(
                                unit_id=unit.id,
                                event_type="new_unit",
                                old_value=None,
                                new_value=None,
                            )
                        )
                    last = None
                else:
                    units_updated += 1
                    last = latest_history.get(unit.id)

                if should_insert_history(
                    last,
                    unit.price_czk,
                    unit.price_per_m2_czk,
                    unit.availability_status,
                    unit.available,
                ):
                    history_inserted += 1
                    if not dry_run:
                        db.add(
                            UnitPriceHistory(
                                unit_id=unit.id,
                                captured_at=captured_at,
                                price_czk=unit.price_czk,
                                price_per_m2_czk=unit.price_per_m2_czk,
                                availability_status=unit.availability_status,
                                available=unit.available,
                            )
                        )

            if not dry_run and pending_list:
                for (uid, field, value) in pending_list:
                    db.execute(
                        delete(UnitApiPending).where(
                            UnitApiPending.unit_id == uid,
                            UnitApiPending.field == field,
                        )
                    )
                    db.add(UnitApiPending(unit_id=uid, field=field, value=value))

            # Mark existing projects for enrichment when gps or region changed
            for key in project_key_to_project:
                if key in projects_map:
                    p = project_key_to_project[key]
                    old = old_project_location.get(key)
                    if old is not None and p.id is not None and should_enrich_after_project_change(
                        is_new_project=False,
                        old_lat=old[0],
                        old_lon=old[1],
                        old_region=old[2],
                        new_lat=p.gps_latitude,
                        new_lon=p.gps_longitude,
                        new_region=p.region_iga,
                    ):
                        enrich_project_ids.add(p.id)

            if not dry_run:
                db.flush()
                for pid in sorted(enrich_project_ids):
                    enrich_project_location_metrics(db, pid)

                # Invalidate commute cache for projects whose GPS changed.
                if enrich_project_ids:
                    db.execute(delete(CommuteCache).where(CommuteCache.project_id.in_(enrich_project_ids)))

            # After flushing unit changes and potential events, generate client alerts for new events.
            if not dry_run:
                # Load recent events for units touched in this chunk
                unit_ids = [u.id for u in units_map.values()]
                if unit_ids:
                    events = (
                        db.execute(
                            select(UnitEvent)
                            .where(UnitEvent.unit_id.in_(unit_ids))
                            .order_by(UnitEvent.created_at.desc(), UnitEvent.id.desc())
                        )
                        .scalars()
                        .all()
                    )
                    # Map unit_id -> latest event per type (simple last-seen)
                    events_by_unit: dict[int, list[UnitEvent]] = {}
                    for ev in events:
                        events_by_unit.setdefault(ev.unit_id, []).append(ev)

                    if events_by_unit:
                        # Build reverse map: project_id -> Project for unit lookup
                        project_id_to_project = {
                            p.id: p for p in project_key_to_project.values() if p.id is not None
                        }
                        # Load clients + profiles once (simple approach: all clients)
                        clients = db.execute(select(Client)).scalars().all()
                        profiles_map: dict[int, ClientProfile | None] = {}
                        if clients:
                            prof_rows = db.execute(
                                select(ClientProfile).where(
                                    ClientProfile.client_id.in_([c.id for c in clients])
                                )
                            ).scalars().all()
                            for p in prof_rows:
                                profiles_map[p.client_id] = p

                        for unit in units_map.values():
                            unit_events = events_by_unit.get(unit.id)
                            if not unit_events:
                                continue
                            # For alerting, we don't care which exact event, we just use latest.
                            latest_event = unit_events[0]
                            project = project_id_to_project.get(unit.project_id)
                            if project is None:
                                continue
                            for client in clients:
                                profile = profiles_map.get(client.id)
                                score, _parts = _compute_unit_match_score(unit, project, profile)
                                if score >= 80.0:
                                    exists = db.execute(
                                        select(ClientUnitMatch).where(
                                            ClientUnitMatch.client_id == client.id,
                                            ClientUnitMatch.unit_id == unit.id,
                                        )
                                    ).scalars().first()
                                    if not exists:
                                        db.add(
                                            ClientUnitMatch(
                                                client_id=client.id,
                                                unit_id=unit.id,
                                                score=score,
                                                event_type=latest_event.event_type,
                                            )
                                        )

            # Commit + expunge po každém chunku — drží paměť session nízko
            # a zaručuje, že OOM kill neztratí už importované chunky.
            if not dry_run:
                db.commit()
                db.expunge_all()

            chunk_elapsed = time.perf_counter() - chunk_t0
            print(
                f"[chunk {chunk_idx}/{total_chunks}] done in {chunk_elapsed:.2f}s "
                f"(committed)",
                flush=True,
            )

        if not dry_run:
            print(
                f"[import] all chunks done, committing units before recompute "
                f"(touched_projects={len(touched_project_ids)})",
                flush=True,
            )
            # Commit units first — recompute can OOM / be killed, but raw import must survive.
            db.commit()
            print("[import] units committed; starting recompute", flush=True)
            # Recompute cached project aggregates for all affected projects in this import
            if touched_project_ids:
                recompute_project_aggregates(db, sorted(touched_project_ids))
                db.commit()
                print("[import] project aggregates recomputed & committed", flush=True)
            # Recompute local price diffs (vs. market) for all units
            recompute_local_price_diffs(db)
            db.commit()
            print("[import] local price diffs recomputed & committed", flush=True)
            # Cleanup: not_seen jednotky v mrtvých projektech (0 available, first_seen > 180d) → sold
            dead_fixed = cleanup_not_seen_in_dead_projects(db)
            if dead_fixed > 0:
                print(f"Cleanup: {dead_fixed} not_seen jednotek v mrtvých projektech označeno jako sold")
            db.commit()

    total_elapsed = time.perf_counter() - total_start
    n = len(valid)
    rate = n / total_elapsed if total_elapsed > 0 else 0

    print("\n=== Import Summary ===")
    print(f"Projects created: {projects_created}")
    print(f"Projects reused: {projects_reused}")
    print(f"Units created: {units_created}")
    print(f"Units updated: {units_updated}")
    print(f"Price history rows inserted: {history_inserted}")
    if snapshot_id is not None:
        print(f"Snapshot id: {snapshot_id}")
    if dry_run:
        print("(dry-run: no changes written)")
    print(f"Total time: {total_elapsed:.2f}s | {rate:.1f} units/s")

    return {
        "projects_created": projects_created,
        "projects_reused": projects_reused,
        "units_created": units_created,
        "units_updated": units_updated,
        "history_inserted": history_inserted,
        "elapsed_seconds": round(total_elapsed, 1),
    }

    if changes_by_field and units_updated > 0:
        print("\n--- Changes by field (updated units) ---")
        bulk_threshold = max(500, int(0.5 * units_updated))
        for attr in sorted(changes_by_field.keys()):
            count = changes_by_field[attr]
            if count >= bulk_threshold:
                print(f"  {attr}: {count} units (bulk)")
            else:
                print(f"  {attr}: {count} units")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import units from JSON into PostgreSQL")
    parser.add_argument("json_file", type=Path, help="Path to JSON file with units")
    parser.add_argument("--source", type=str, help="Source identifier for this import (e.g., 'api')")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Compute counts but do not write anything to the database",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=2000,
        metavar="N",
        help="Process input in chunks of N units (default: 2000)",
    )
    args = parser.parse_args()

    if not args.json_file.exists():
        parser.error(f"JSON file not found: {args.json_file}")
    if args.chunk_size < 1:
        parser.error("--chunk-size must be >= 1")

    import_units(
        args.json_file,
        args.source,
        dry_run=args.dry_run,
        chunk_size=args.chunk_size,
    )


if __name__ == "__main__":
    main()

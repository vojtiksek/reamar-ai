"""UnitOverride parsing and application logic."""

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from .filter_catalog import CATALOG_TO_DB
from .models import Project, Unit, UnitOverride

logger = logging.getLogger(__name__)

OVERRIDEABLE_FIELDS = frozenset(
    {
        "price_czk",
        "price_per_m2_czk",
        "available",
        "availability_status",
        "floor_area_m2",
        "equivalent_area_m2",
        "exterior_area_m2",
    }
)

_INT_FIELDS = frozenset({"price_czk", "price_per_m2_czk"})
_BOOL_FIELDS = frozenset({"available"})
_DECIMAL_FIELDS = frozenset(
    {
        "floor_area_m2",
        "equivalent_area_m2",
        "exterior_area_m2",
    }
)
_STR_FIELDS = frozenset({"availability_status"})


def _parse_int(value: str) -> int | None:
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return None


def _parse_bool(value: str) -> bool | None:
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in ("true", "1", "yes", "on"):
        return True
    if s in ("false", "0", "no", "off"):
        return False
    return None


def _parse_decimal(value: str) -> Decimal | None:
    try:
        d = Decimal(str(value).strip())
        return d.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    except (ValueError, TypeError, ArithmeticError):
        return None


def apply_override(
    field: str,
    value: str,
    base: Any,
    unit_id: int,
) -> Any:
    """Parse override value and return it, or base on parse failure."""
    if field in _INT_FIELDS:
        parsed = _parse_int(value)
        if parsed is None:
            logger.warning(
                "Override parse failed for unit_id=%s field=%s value=%r",
                unit_id,
                field,
                value,
            )
            return base
        return parsed

    if field in _BOOL_FIELDS:
        parsed = _parse_bool(value)
        if parsed is None:
            logger.warning(
                "Override parse failed for unit_id=%s field=%s value=%r",
                unit_id,
                field,
                value,
            )
            return base
        return parsed

    if field in _DECIMAL_FIELDS:
        parsed = _parse_decimal(value)
        if parsed is None:
            logger.warning(
                "Override parse failed for unit_id=%s field=%s value=%r",
                unit_id,
                field,
                value,
            )
            return base
        return float(parsed)

    if field in _STR_FIELDS:
        return str(value).strip()

    return base


def build_override_map(overrides: list[UnitOverride]) -> dict[int, dict[str, str]]:
    """Build unit_id -> {field: value} from override rows."""
    result: dict[int, dict[str, str]] = {}
    for o in overrides:
        if o.field not in OVERRIDEABLE_FIELDS:
            continue
        if o.unit_id not in result:
            result[o.unit_id] = {}
        result[o.unit_id][o.field] = o.value
    return result


def unit_to_response_dict(unit: Unit, override_map: dict[int, dict[str, str]]) -> dict[str, Any]:
    """Build a dict for UnitResponse with overrides applied (highest priority)."""
    overrides = override_map.get(unit.id) or {}
    base = unit

    def _get(field: str, base_val: Any) -> Any:
        if field in overrides:
            return apply_override(field, overrides[field], base_val, unit.id)
        return base_val

    def _dec(v: Any) -> float | None:
        # Convert Decimal (and numerics) to float for JSON
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return v

    project_info = {
        "developer": base.project.developer,
        "name": base.project.name,
        "address": base.project.address,
        "city": base.project.city,
        "municipality": base.project.municipality,
        "district": base.project.district,
        "postal_code": base.project.postal_code,
        "cadastral_area_iga": base.project.cadastral_area_iga,
        "administrative_district_iga": base.project.administrative_district_iga,
        "region_iga": base.project.region_iga,
        "gps_latitude": _dec(base.project.gps_latitude),
        "gps_longitude": _dec(base.project.gps_longitude),
        "ride_to_center_min": _dec(base.project.ride_to_center_min),
        "public_transport_to_center_min": _dec(base.project.public_transport_to_center_min),
        "permit_regular": base.project.permit_regular,
        "renovation": base.project.renovation,
        "overall_quality": base.project.overall_quality,
        "windows": base.project.windows,
        "heating": base.project.heating,
        "partition_walls": base.project.partition_walls,
        "amenities": base.project.amenities,
    }

    # Build flat data dict keyed by field_catalog "column" names from CATALOG_TO_DB
    data: dict[str, Any] = {}
    for column, (entity_type, attr) in CATALOG_TO_DB.items():
        if entity_type == "Unit":
            base_val = getattr(base, attr, None)
            if attr in OVERRIDEABLE_FIELDS:
                value = _get(attr, base_val)
            else:
                value = base_val
            value = _dec(value)
        else:  # "Project"
            proj: Project | None = base.project
            value = getattr(proj, attr, None) if proj is not None else None
            value = _dec(value)
        data[column] = value

    return {
        "external_id": base.external_id,
        "unit_name": base.unit_name,
        "layout": base.layout,
        "floor": base.floor,
        "availability_status": _get("availability_status", base.availability_status),
        "available": _get("available", base.available),
        "price_czk": _get("price_czk", base.price_czk),
        "price_per_m2_czk": _get("price_per_m2_czk", base.price_per_m2_czk),
        "floor_area_m2": _dec(_get("floor_area_m2", base.floor_area_m2)),
        "equivalent_area_m2": _dec(_get("equivalent_area_m2", base.equivalent_area_m2)),
        "exterior_area_m2": _dec(_get("exterior_area_m2", base.exterior_area_m2)),
        "balcony_area_m2": _dec(base.balcony_area_m2),
        "terrace_area_m2": _dec(base.terrace_area_m2),
        "garden_area_m2": _dec(base.garden_area_m2),
        "municipality": base.municipality,
        "city": base.city,
        "postal_code": base.postal_code,
        "ride_to_center_min": _dec(base.ride_to_center_min),
        "public_transport_to_center_min": _dec(base.public_transport_to_center_min),
        "url": base.url,
        "project": project_info,
        "data": data,
    }
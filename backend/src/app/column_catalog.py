"""Column definitions from field_catalog.csv for GET /columns. Only 'Zobrazit na webu' == ANO. Cached in memory."""

from __future__ import annotations

import csv
from pathlib import Path

from .filter_catalog import CATALOG_TO_DB


def _normalize(s: str) -> str:
    return (s or "").strip()


def _entity_to_view(raw: str) -> str:
    """Map CSV Entity to 'unit' | 'project'."""
    r = _normalize(raw).lower()
    if r == "jednotka":
        return "unit"
    if r == "projekt":
        return "project"
    return "unit"


def _display_format_to_data_type(display_format: str) -> str:
    """Map CSV display_format to data_type: number | bool | text | date | enum."""
    df = _normalize(display_format).lower()
    if df in ("currency", "currency_per_m2", "percent", "area_m2", "duration_minutes", "integer"):
        return "number"
    if df == "boolean":
        return "bool"
    if df == "date":
        return "date"
    if df in ("enum", "enum_search"):
        return "enum"
    return "text"


def _infer_sortable(display_format: str) -> bool:
    """Infer sortable when not in CSV: true for number, date, text, enum, bool."""
    df = _normalize(display_format).lower()
    if df in ("currency", "currency_per_m2", "percent", "area_m2", "duration_minutes", "integer"):
        return True
    if df in ("boolean", "date", "text", "url", "enum", "enum_search"):
        return True
    return True


# Cache: list of dicts with keys from CSV + normalized entity
_cached_web_rows: list[dict] | None = None


def _load_web_columns() -> list[dict]:
    """Load all rows where 'Zobrazit na webu' == ANO. Cached in memory."""
    global _cached_web_rows
    if _cached_web_rows is not None:
        return _cached_web_rows
    path = Path(__file__).resolve().parent / "field_catalog.csv"
    rows: list[dict] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            show = _normalize(row.get("Zobrazit na webu", "")).upper()
            if show != "ANO":
                continue
            column = _normalize(row.get("column", ""))
            if not column:
                continue
            entity_raw = _normalize(row.get("Entity", ""))
            entity = _entity_to_view(entity_raw)
            try:
                sort_priority = int(_normalize(row.get("sort_priority", "")) or 0)
            except (TypeError, ValueError):
                sort_priority = 0
            web_order = row.get("web_order")
            try:
                web_order = int(_normalize(str(web_order))) if web_order else None
            except (TypeError, ValueError):
                web_order = None
            rows.append({
                "column": column,
                "alias": _normalize(row.get("Alias", "")) or column,
                "entity": entity,
                "entity_raw": entity_raw,
                "display_format": _normalize(row.get("display_format", "")),
                "filterable": _normalize(row.get("Filterable", "")).upper() == "ANO",
                "editable": _normalize(row.get("Editable", "")).upper() == "ANO",
                "sort_priority": sort_priority,
                "web_order": web_order,
            })
    _cached_web_rows = rows
    return rows


def _key_and_accessor(column: str, entity: str) -> tuple[str, str]:
    """Return (key, accessor) for stable id and frontend path. Prefer DB column name."""
    catalog_key = column
    if catalog_key in CATALOG_TO_DB:
        entity_type, db_attr = CATALOG_TO_DB[catalog_key]
        if entity_type == "Unit":
            return (db_attr, db_attr)
        return (f"project.{db_attr}", f"project.{db_attr}")
    if entity == "project":
        return (f"project.{column}", f"project.{column}")
    return (column, column)


# Exact keys returned by GET /projects/overview (flat item keys). For view=projects we only
# return columns whose accessor is in this set so the table never shows empty/stale columns.
PROJECTS_OVERVIEW_KEYS: frozenset[str] = frozenset({
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
    "ride_to_center_min",
    "public_transport_to_center_min",
    "permit_regular",
    "renovation",
    "overall_quality",
    "windows",
    "heating",
    "partition_walls",
    "amenities",
    "project_url",
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
    # Single-value financing fields per project (computed from units or overrides)
    "payment_contract",
    "payment_construction",
    "payment_occupancy",
})


def get_columns(view: str) -> list[dict]:
    """
    Return column definitions for GET /columns.
    view: 'units' -> entity in ('unit', 'project'); 'projects' -> entity == 'project'.
    Ordered by web_order if present, else by sort_priority, then by label.
    """
    rows = _load_web_columns()
    if view == "projects":
        rows = [r for r in rows if r["entity"] == "project"]
    elif view == "units":
        rows = [r for r in rows if r["entity"] in ("unit", "project")]
    else:
        return []

    def row_sort_key(r: dict) -> tuple:
        wo = r.get("web_order")
        if wo is not None:
            return (0, wo, r["alias"])
        return (1, r["sort_priority"], r["alias"])

    rows_sorted = sorted(rows, key=row_sort_key)
    out = []
    for r in rows_sorted:
        key, accessor = _key_and_accessor(r["column"], r["entity"])
        # For the projects view we expose a flat row (no nested project.* object),
        # so strip the "project." prefix from key/accessor.
        if view == "projects" and accessor.startswith("project."):
            accessor = accessor.split(".", 1)[1]
            if key.startswith("project."):
                key = key.split(".", 1)[1]
        # For view=projects only: include only columns that exist on overview items (no dots).
        if view == "projects":
            if accessor not in PROJECTS_OVERVIEW_KEYS:
                continue
        display_format = r["display_format"]
        data_type = _display_format_to_data_type(display_format)
        sortable = _infer_sortable(display_format)
        out.append({
            "key": key,
            "label": r["alias"],
            "entity": r["entity"],
            "data_type": data_type,
            "display_format": display_format,
            "sortable": sortable,
            "filterable": r["filterable"],
            "editable": r.get("editable", False),
            "accessor": accessor,
        })
    if view == "projects":
        # Dev assertion: projects view must not expose nested accessors.
        assert all("." not in c["accessor"] for c in out), "projects view columns must have flat accessors"
    return out

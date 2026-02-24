"""Project column definitions from field_catalog.csv + computed aggregates. Used by GET /projects/columns and GET /projects."""

from __future__ import annotations

import csv
from pathlib import Path

# CSV column (catalog key) -> Project overview item key (flat, no dots).
# Used when building GET /projects/overview items; keys must match /columns?view=projects accessors.
PROJECT_CATALOG_TO_ATTR: dict[str, str] = {
    "developer": "developer",
    "name": "name",
    "address": "address",
    "city": "city",
    "municipality": "municipality",
    "district": "district",
    "postal_code": "postal_code",
    "cadastral_area_iga": "cadastral_area_iga",
    "administrative_district_iga": "administrative_district_iga",
    "region_iga": "region_iga",
    "gps_latitude": "gps_latitude",
    "gps_longitude": "gps_longitude",
    "ride_to_center": "ride_to_center_min",
    "public_transport_to_center": "public_transport_to_center_min",
    "permit_regular": "permit_regular",
    "renovation": "renovation",
    "overall_quality": "overall_quality",
    "windows": "windows",
    "heating": "heating",
    "partition_walls": "partition_walls",
    "amenities": "amenities",
    "project_url": "project_url",  # from overrides when set
    "project": "name",  # alias for name
}

# Computed column keys (kind="computed") in display order.
COMPUTED_COLUMN_KEYS: list[str] = [
    "units_total",
    "units_available",
    "units_priced",
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
    "available_ratio",
    "layouts_present",
]

# Computed column definitions: key -> { label, data_type }
COMPUTED_COLUMN_DEFS: dict[str, dict] = {
    "units_total": {"label": "Počet jednotek", "data_type": "number"},
    "units_available": {"label": "Dostupných jednotek", "data_type": "number"},
    "units_priced": {"label": "Jednotek s cenou", "data_type": "number"},
    "min_price_czk": {"label": "Min. cena", "data_type": "number"},
    "avg_price_czk": {"label": "Prům. cena", "data_type": "number"},
    "max_price_czk": {"label": "Max. cena", "data_type": "number"},
    "min_price_per_m2_czk": {"label": "Min. cena za m²", "data_type": "number"},
    "avg_price_per_m2_czk": {"label": "Prům. cena za m²", "data_type": "number"},
    "max_price_per_m2_czk": {"label": "Max. cena za m²", "data_type": "number"},
    "median_price_per_m2_czk": {"label": "Medián cena za m²", "data_type": "number"},
    "min_ride_to_center_min": {"label": "Min. autem do centra (min)", "data_type": "number"},
    "avg_ride_to_center_min": {"label": "Prům. autem do centra (min)", "data_type": "number"},
    "median_ride_to_center_min": {"label": "Medián autem do centra (min)", "data_type": "number"},
    "min_public_transport_to_center_min": {"label": "Min. MHD do centra (min)", "data_type": "number"},
    "avg_public_transport_to_center_min": {"label": "Prům. MHD do centra (min)", "data_type": "number"},
    "median_public_transport_to_center_min": {"label": "Medián MHD do centra (min)", "data_type": "number"},
    "avg_floor_area_m2": {"label": "Prům. plocha m²", "data_type": "number"},
    "available_ratio": {"label": "Podíl dostupných", "data_type": "number"},
    "layouts_present": {"label": "Dispozice", "data_type": "enum"},
}

_cached_project_columns: list[dict] | None = None


def _normalize(s: str) -> str:
    return (s or "").strip()


def _display_format_to_data_type(display_format: str) -> str:
    df = _normalize(display_format).lower()
    if df in ("currency", "currency_per_m2", "percent", "area_m2", "duration_minutes", "integer"):
        return "number"
    if df == "boolean":
        return "bool"
    if df == "date":
        return "date"
    if df in ("enum", "enum_search"):
        return "enum"
    if df == "url":
        return "text"
    return "text"


def _load_project_catalog_rows() -> list[dict]:
    """Load rows from field_catalog where Entity == Projekt and Zobrazit na webu == ANO. Cached."""
    global _cached_project_columns
    if _cached_project_columns is not None:
        return _cached_project_columns
    path = Path(__file__).resolve().parent / "field_catalog.csv"
    rows: list[dict] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            show = _normalize(row.get("Zobrazit na webu", "")).upper()
            if show != "ANO":
                continue
            entity_raw = _normalize(row.get("Entity", ""))
            if entity_raw.lower() != "projekt":
                continue
            column = _normalize(row.get("column", ""))
            if not column:
                continue
            try:
                sort_priority = int(_normalize(row.get("sort_priority", "")) or 0)
            except (TypeError, ValueError):
                sort_priority = 0
            editable = _normalize(row.get("Editable", "")).upper() == "ANO"
            rows.append({
                "column": column,
                "alias": _normalize(row.get("Alias", "")) or column,
                "display_format": _normalize(row.get("display_format", "")),
                "unit_label": _normalize(row.get("unit_label", "")),
                "sort_priority": sort_priority,
                "editable": editable,
            })
    rows.sort(key=lambda r: (r["sort_priority"], r["alias"]))
    _cached_project_columns = rows
    return rows


def get_project_columns() -> list[dict]:
    """
    Return column definitions for entity=project where "Zobrazit na webu" == ANO.
    Each item: { key, label, data_type, unit, kind }.
    key = CSV "column", label = CSV "Alias" (fallback key), kind = "catalog".
    """
    rows = _load_project_catalog_rows()
    out = []
    for r in rows:
        key = r["column"]
        display_format = r["display_format"]
        data_type = _display_format_to_data_type(display_format)
        unit = r["unit_label"] or None
        out.append({
            "key": key,
            "label": r["alias"],
            "data_type": data_type,
            "unit": unit,
            "kind": "catalog",
            "editable": r.get("editable", False),
        })
    return out


def get_project_overrideable_fields() -> set[str]:
    """
    Return catalog column keys for project fields that are editable (Editable == ANO)
    and visible on web (Zobrazit na webu == ANO).
    """
    rows = _load_project_catalog_rows()
    return {r["column"] for r in rows if r.get("editable")}


def get_projects_columns_with_computed() -> list[dict]:
    """
    Combined column list: catalog project columns (CSV order) then computed columns.
    Used by GET /projects/columns.
    """
    catalog = get_project_columns()
    computed = []
    for key in COMPUTED_COLUMN_KEYS:
        defn = COMPUTED_COLUMN_DEFS.get(key, {})
        computed.append({
            "key": key,
            "label": defn.get("label", key),
            "data_type": defn.get("data_type", "number"),
            "unit": None,
            "kind": "computed",
        })
    return catalog + computed


def get_allowed_sort_keys() -> set[str]:
    """Keys that are valid for sort_by (catalog + computed)."""
    catalog_keys = {c["key"] for c in get_project_columns()}
    return catalog_keys | set(COMPUTED_COLUMN_KEYS)

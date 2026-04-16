"""Client Mode — Phase 1 foundation.

Pure helpers that derive the base profile / working filters from a
ClientProfile row.  Mirrors `frontend/src/lib/clientMode.ts`.

The wizard defines the initial client profile (``base_profile_json``).
The broker can diverge via ``working_filters_json``; changes are tracked
in ``modified_keys_json`` so we can (a) show what was manually edited
and (b) reset everything back to the base.

Contract:
  * Functions must be pure — no DB access, no side effects.
  * JSON shape is the single source of truth (frontend and backend must
    stay in sync).  Do not rename fields without updating both sides.
"""
from __future__ import annotations

import json
from typing import Any, Iterable


# Keys that live in WorkingFilters (camelCase to match frontend shape).
WORKING_FILTER_KEYS: tuple[str, ...] = (
    "budgetMax",
    "areaMin",
    "propertyTypes",
    "layouts",
    "locationMode",
    "polygon",
    "adminAreas",
    "renovationPreference",
    "hideBelowScore",
    "visibleLimit",
)

# Keys that are shared between BaseProfile and WorkingFilters (the rest
# are UI-only and never live in BaseProfile).
_BASE_KEYS: frozenset[str] = frozenset(
    {
        "budgetMax",
        "areaMin",
        "propertyTypes",
        "layouts",
        "locationMode",
        "polygon",
        "adminAreas",
        "renovationPreference",
    }
)


def _normalize_admin_area_list(raw: Any) -> list[str]:
    """Deduplicated list of admin-area strings; tolerates legacy string shape."""
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else [raw]
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item is None:
            continue
        s = str(item).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _normalize_renovation(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in ("any", "ignore"):
        return None
    return s


def _derive_location_mode(wizard: dict[str, Any], polygon_geojson: str | None) -> str:
    location = wizard.get("location") or {}
    has_polygon = isinstance(polygon_geojson, str) and polygon_geojson.strip() != ""
    if location.get("method_polygon") and has_polygon:
        return "polygon"
    if has_polygon:
        return "polygon"
    if location.get("method_admin"):
        return "admin_area"
    return "none"


def wizard_to_base_profile(profile: Any) -> dict[str, Any]:
    """Deterministic wizard-derived snapshot used as the reset target.

    ``profile`` is an ORM ClientProfile instance (or any duck-typed object
    with the same attributes).  Returns a JSON-serializable dict.
    """
    if profile is None:
        return {}

    filter_json = getattr(profile, "filter_json", None) or {}
    wizard = (filter_json.get("wizard") if isinstance(filter_json, dict) else None) or {}

    property_types: list[str] = []
    prop_type = getattr(profile, "property_type", None)
    if prop_type and prop_type != "any":
        property_types.append(str(prop_type))

    layouts_field = getattr(profile, "layouts", None) or {}
    layouts_values = []
    if isinstance(layouts_field, dict):
        raw = layouts_field.get("values") or []
        if isinstance(raw, list):
            layouts_values = [str(v) for v in raw if v]

    admin_areas = _normalize_admin_area_list(
        (wizard.get("location") or {}).get("administrative_area")
    )

    polygon_geojson = getattr(profile, "polygon_geojson", None)
    location_mode = _derive_location_mode(wizard, polygon_geojson)

    polygon: Any = None
    if location_mode == "polygon" and polygon_geojson:
        try:
            polygon = json.loads(polygon_geojson)
        except (ValueError, TypeError):
            polygon = polygon_geojson  # raw string fallback

    return {
        "budgetMax": getattr(profile, "budget_max", None),
        "areaMin": getattr(profile, "area_min", None),
        "propertyTypes": property_types or None,
        "layouts": layouts_values or None,
        "locationMode": location_mode,
        "polygon": polygon,
        "adminAreas": admin_areas or None,
        "renovationPreference": _normalize_renovation(wizard.get("renovation_preference")),
    }


def base_profile_to_working_filters(base: dict[str, Any]) -> dict[str, Any]:
    """Initial working filters are a copy of the base profile + UI extras."""
    return {
        "budgetMax": base.get("budgetMax"),
        "areaMin": base.get("areaMin"),
        "propertyTypes": list(base["propertyTypes"]) if base.get("propertyTypes") else None,
        "layouts": list(base["layouts"]) if base.get("layouts") else None,
        "locationMode": base.get("locationMode"),
        "polygon": base.get("polygon"),
        "adminAreas": list(base["adminAreas"]) if base.get("adminAreas") else None,
        "renovationPreference": base.get("renovationPreference"),
        "hideBelowScore": None,
        "visibleLimit": None,
    }


def _values_equal(a: Any, b: Any) -> bool:
    if a == b:
        return True
    if a is None and b is None:
        return True
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        try:
            return sorted(map(str, a)) == sorted(map(str, b))
        except TypeError:
            return False
    if isinstance(a, dict) and isinstance(b, dict):
        try:
            return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
        except TypeError:
            return False
    return False


def compute_modified_keys(
    base: dict[str, Any], working: dict[str, Any]
) -> list[str]:
    """Keys whose value in working_filters differs from the base profile."""
    modified: list[str] = []
    for key in WORKING_FILTER_KEYS:
        base_val = base.get(key) if key in _BASE_KEYS else None
        work_val = working.get(key)
        if not _values_equal(base_val, work_val):
            modified.append(key)
    return modified


def sanitize_working_filters(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only recognized keys; used on PUT to avoid storing arbitrary junk."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key in WORKING_FILTER_KEYS:
        if key in raw:
            out[key] = raw[key]
    return out


def build_client_mode_state(profile: Any) -> dict[str, Any]:
    """Assemble the full ClientModeState from an ORM profile row.

    baseProfile: read from stored ``base_profile_json`` when available;
    fall back to a live ``wizard_to_base_profile`` derivation only when
    no frozen snapshot exists yet.  This prevents the baseline from
    drifting silently after later wizard edits.

    workingFilters: restored from ``working_filters_json`` when present.

    modifiedKeys: always recomputed server-side from base + working so the
    server is the sole source of truth — client-supplied values are never
    trusted for persistence.

    filtersUpdatedAt: timestamp of the last working-filters save (renamed
    from the misleading ``lastRecomputedAt``).
    """
    if profile is None:
        return {
            "baseProfile": {},
            "workingFilters": base_profile_to_working_filters({}),
            "modifiedKeys": [],
            "filtersUpdatedAt": None,
        }

    # Use the frozen snapshot when available; fall back to live derivation
    # only for records that pre-date client-mode initialisation.
    stored_base = getattr(profile, "base_profile_json", None)
    if isinstance(stored_base, dict) and stored_base:
        base = stored_base
    else:
        base = wizard_to_base_profile(profile)

    stored_working = getattr(profile, "working_filters_json", None)
    if isinstance(stored_working, dict) and stored_working:
        working = sanitize_working_filters(stored_working)
    else:
        working = base_profile_to_working_filters(base)

    # Always derive modifiedKeys from base + working; never trust stored/client value.
    modified_keys = compute_modified_keys(base, working)

    updated_at = getattr(profile, "client_mode_updated_at", None)
    filters_updated_at = updated_at.isoformat() if updated_at is not None else None

    return {
        "baseProfile": base,
        "workingFilters": working,
        "modifiedKeys": modified_keys,
        "filtersUpdatedAt": filters_updated_at,
    }


def working_filters_overrides_for_recompute(
    working_filters: dict[str, Any] | None,
    modified_keys: list[str] | None = None,
) -> dict[str, Any]:
    """Extract the subset of working filters that influences recompute.

    Returned dict uses snake_case keys that map to ClientProfile attributes
    (and internal scoring helpers) so callers can overlay them directly.
    Only keys present in ``working_filters`` are returned — absent keys leave
    the profile value untouched.

    ``modified_keys`` is the server-computed list of keys the broker has
    explicitly changed from the base profile.  A null value in working_filters
    is only treated as an intentional "remove this filter" override when the
    key appears in modified_keys; otherwise null means "not set at
    initialisation time — fall back to profile value".  This prevents stale
    null initialisations from silently disabling profile filters (e.g. a
    profile that later gains an area_min via the wizard would have its filter
    bypassed if the frozen working_filters still contains areaMin=null).

    Location keys (``locationMode``, ``polygon``, ``adminAreas``) are only
    extracted when ``locationMode`` is explicitly present in *modified_keys*
    so that an initialisation-time "none" never strips a polygon that was
    drawn after the working-filter snapshot was frozen.

    * ``"polygon"``     — use ``polygon`` GeoJSON; clear admin-area filter
    * ``"admin_area"``  — use ``adminAreas`` as a **hard** filter; clear polygon
    * ``"none"``        — remove all location filtering
    """
    if not isinstance(working_filters, dict) or not working_filters:
        return {}

    _modified: frozenset[str] = frozenset(modified_keys or [])

    # Only fields the broker has EXPLICITLY modified (present in modified_keys)
    # should override the profile.  All other working_filter values are stale
    # copies from base_profile initialisation and must be ignored — the
    # profile is the source of truth for unmodified fields.
    out: dict[str, Any] = {}
    if "budgetMax" in _modified:
        out["budget_max"] = working_filters.get("budgetMax")
    if "areaMin" in _modified:
        out["area_min"] = working_filters.get("areaMin")
    if "propertyTypes" in _modified:
        pts = working_filters.get("propertyTypes") or []
        if isinstance(pts, list) and len(pts) == 1:
            out["property_type"] = pts[0]
        else:
            out["property_type"] = "any"
    if "layouts" in _modified:
        layouts = working_filters.get("layouts")
        if isinstance(layouts, list) and layouts:
            out["layouts"] = {"values": list(layouts)}
        else:
            out["layouts"] = None

    # Location overrides — only when locationMode is in modified_keys AND has
    # a non-null value.  A null locationMode is never an intentional broker
    # choice (the UI always sets an explicit string: "polygon", "admin_area",
    # or "none").  Null appears when working_filters were initialised before
    # the polygon was drawn; treating it as "none" would silently disable the
    # polygon hard filter.
    _raw_loc_mode = working_filters.get("locationMode")
    if "locationMode" in working_filters and "locationMode" in _modified and _raw_loc_mode is not None:
        mode = str(_raw_loc_mode)

        if mode == "polygon":
            raw_poly = working_filters.get("polygon")
            if isinstance(raw_poly, dict):
                out["polygon_geojson"] = json.dumps(raw_poly)
            elif isinstance(raw_poly, str) and raw_poly.strip():
                out["polygon_geojson"] = raw_poly
            else:
                out["polygon_geojson"] = None
            # Polygon mode: admin-area filter is inactive
            out["location_admin_area"] = []
            out["method_admin"] = False

        elif mode == "admin_area":
            raw_areas = working_filters.get("adminAreas")
            out["location_admin_area"] = (
                [str(a) for a in raw_areas if a]
                if isinstance(raw_areas, list)
                else []
            )
            # In client-mode context an explicit admin-area selection is a
            # hard filter — unmatched projects are excluded, not just penalised.
            out["method_admin"] = True
            out["polygon_geojson"] = None

        else:  # "none" or unrecognised value
            out["polygon_geojson"] = None
            out["location_admin_area"] = []
            out["method_admin"] = False

    return out

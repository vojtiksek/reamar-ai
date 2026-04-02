from __future__ import annotations

from typing import Iterable


def _split_tokens(value: str | None) -> list[str]:
    if value is None:
        return []
    s = str(value).strip().lower()
    if not s:
        return []
    for ch in [";", "|", "/"]:
        s = s.replace(ch, ",")
    s = s.replace(" - ", "-")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return parts


def _normalize_tokens(tokens: Iterable[str], mapping: dict[str, str]) -> list[str]:
    out: list[str] = []
    for token in tokens:
        key = token.strip().lower()
        if not key:
            continue
        norm = mapping.get(key, key)
        if norm not in out:
            out.append(norm)
    return out


def canonicalize_windows(value: str | None) -> list[str]:
    mapping = {
        "pvc": "pvc",
        "wood": "wood",
        "dřevo": "wood",
        "aluminum": "aluminum",
        "aluminium": "aluminum",
        "aluminum-wood": "aluminum_wood",
        "aluminium-wood": "aluminum_wood",
        "aluminum-pvc": "aluminum_pvc",
        "aluminium-pvc": "aluminum_pvc",
    }
    return _normalize_tokens(_split_tokens(value), mapping)


def canonicalize_partition_walls(value: str | None) -> list[str]:
    mapping = {
        "brick": "brick",
        "sdk": "drywall",
        "concrete": "concrete",
        "beton": "concrete",
    }
    return _normalize_tokens(_split_tokens(value), mapping)


def canonicalize_heating(value: str | None) -> list[str]:
    mapping = {
        "radiators": "radiators",
        "underfloor": "underfloor",
        "ceiling": "ceiling",
        "central": "central",
        "conventional": "conventional",
    }
    return _normalize_tokens(_split_tokens(value), mapping)


# Canonical option lists for filter UI
CANONICAL_WINDOWS_OPTIONS = ['pvc', 'wood', 'aluminum', 'aluminum_wood', 'aluminum_pvc']
CANONICAL_HEATING_OPTIONS = ['radiators', 'underfloor', 'ceiling', 'central', 'conventional']
CANONICAL_PARTITION_WALLS_OPTIONS = ['brick', 'drywall', 'concrete']
CANONICAL_RECUPERATION_OPTIONS = ['true', 'false', 'unknown']

# Mapping canonical value → ILIKE patterns for DB matching.
# Each canonical token maps to a list of raw substrings that should match (case-insensitive).
CANONICAL_WINDOWS_PATTERNS: dict[str, list[str]] = {
    'pvc': ['pvc'],
    'wood': ['wood', 'dřevo'],
    'aluminum': ['aluminum', 'aluminium'],
    'aluminum_wood': ['aluminum-wood', 'aluminium-wood', 'aluminum_wood', 'aluminium_wood'],
    'aluminum_pvc': ['aluminum-pvc', 'aluminium-pvc', 'aluminum_pvc', 'aluminium_pvc'],
}

CANONICAL_HEATING_PATTERNS: dict[str, list[str]] = {
    'radiators': ['radiator'],
    'underfloor': ['underfloor'],
    'ceiling': ['ceiling'],
    'central': ['central'],
    'conventional': ['conventional'],
}

CANONICAL_PARTITION_WALLS_PATTERNS: dict[str, list[str]] = {
    'brick': ['brick'],
    'drywall': ['drywall', 'sdk'],
    'concrete': ['concrete', 'beton'],
}


def canonical_ilike_clauses(column, canonical_values: list[str], patterns: dict[str, list[str]]):
    """Build a list of ILIKE clauses for canonical filter values against a DB column.

    Returns a list of SQLAlchemy ILIKE expressions (to be combined with or_()).
    """
    clauses = []
    for cv in canonical_values:
        raw_patterns = patterns.get(cv, [cv])
        for pat in raw_patterns:
            clauses.append(column.ilike(f"%{pat}%"))
    return clauses


def canonicalize_floor_materials(value: str | None) -> list[str]:
    mapping = {
        "hardwood": "hardwood",
        "wood": "hardwood",
        "laminate": "laminate",
        "vinyl": "vinyl",
        "carpet": "carpet",
        "tile": "tile",
        "pvc": "pvc",
    }
    return _normalize_tokens(_split_tokens(value), mapping)

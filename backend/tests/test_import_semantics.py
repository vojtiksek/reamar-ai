from app.import_semantics import (
    canonicalize_floor_materials,
    canonicalize_heating,
    canonicalize_partition_walls,
    canonicalize_windows,
    CANONICAL_WINDOWS_OPTIONS,
    CANONICAL_HEATING_OPTIONS,
    CANONICAL_PARTITION_WALLS_OPTIONS,
    CANONICAL_RECUPERATION_OPTIONS,
    CANONICAL_WINDOWS_PATTERNS,
    CANONICAL_HEATING_PATTERNS,
    CANONICAL_PARTITION_WALLS_PATTERNS,
    canonical_ilike_clauses,
)


def test_canonicalize_windows_normalizes_aliases_and_combos():
    assert canonicalize_windows("PVC, aluminum") == ["pvc", "aluminum"]
    assert canonicalize_windows("aluminium - wood") == ["aluminum_wood"]


def test_canonicalize_partition_walls_normalizes_synonyms():
    assert canonicalize_partition_walls("beton, brick") == ["concrete", "brick"]
    assert canonicalize_partition_walls("SDK") == ["drywall"]


def test_canonicalize_heating_keeps_known_tags():
    assert canonicalize_heating("radiators, underfloor") == ["radiators", "underfloor"]
    assert canonicalize_heating("ceiling") == ["ceiling"]


def test_canonicalize_floor_materials_treats_floors_as_materials():
    assert canonicalize_floor_materials("hardwood, vinyl") == ["hardwood", "vinyl"]
    assert canonicalize_floor_materials("laminate") == ["laminate"]


def test_canonical_options_are_complete():
    """Every canonical option must have a corresponding pattern entry."""
    for opt in CANONICAL_WINDOWS_OPTIONS:
        assert opt in CANONICAL_WINDOWS_PATTERNS, f"missing pattern for windows option '{opt}'"
    for opt in CANONICAL_HEATING_OPTIONS:
        assert opt in CANONICAL_HEATING_PATTERNS, f"missing pattern for heating option '{opt}'"
    for opt in CANONICAL_PARTITION_WALLS_OPTIONS:
        assert opt in CANONICAL_PARTITION_WALLS_PATTERNS, f"missing pattern for partition_walls option '{opt}'"


def test_canonical_recuperation_options():
    assert CANONICAL_RECUPERATION_OPTIONS == ['true', 'false', 'unknown']


def test_canonical_windows_patterns_cover_aliases():
    """aluminum_wood pattern should match both aluminum-wood and aluminium-wood."""
    pats = CANONICAL_WINDOWS_PATTERNS['aluminum_wood']
    assert any('aluminium' in p for p in pats)
    assert any('aluminum' in p for p in pats)


def test_canonical_ilike_clauses_returns_clauses():
    """canonical_ilike_clauses should return one clause per raw pattern."""
    from sqlalchemy import Column, String
    col = Column("test", String)
    clauses = canonical_ilike_clauses(col, ['pvc'], CANONICAL_WINDOWS_PATTERNS)
    assert len(clauses) == 1  # 'pvc' has one pattern
    clauses = canonical_ilike_clauses(col, ['aluminum_wood'], CANONICAL_WINDOWS_PATTERNS)
    assert len(clauses) == 4  # aluminum-wood, aluminium-wood, aluminum_wood, aluminium_wood
    clauses = canonical_ilike_clauses(col, ['drywall'], CANONICAL_PARTITION_WALLS_PATTERNS)
    assert len(clauses) == 2  # drywall, sdk

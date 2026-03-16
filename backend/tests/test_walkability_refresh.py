"""
Tests to ensure walkability source refresh uses all configured POI categories.
Prevents regressions where a new category is added to the model/walkability compute
but not to the Overpass downloaders, leaving tables empty.
"""

import pytest

from app.osm_walkability_overpass import WALKABILITY_DOWNLOADERS
from app.walkability import TABLE_TO_COUNT_FIELD, TABLE_TO_DISTANCE_FIELD


# All 17 walkability POI tables (single source of truth for test expectation)
EXPECTED_WALKABILITY_TABLES = frozenset({
    "osm_supermarkets",
    "osm_drugstores",
    "osm_pharmacies",
    "osm_atms",
    "osm_post_offices",
    "osm_tram_stops",
    "osm_bus_stops",
    "osm_metro_stations",
    "osm_train_stations",
    "osm_restaurants",
    "osm_cafes",
    "osm_parks",
    "osm_fitness",
    "osm_playgrounds",
    "osm_kindergartens",
    "osm_primary_schools",
    "osm_pediatricians",
})


def test_walkability_downloaders_contain_all_expected_tables():
    """Refresh uses WALKABILITY_DOWNLOADERS; it must include every expected POI table."""
    tables = frozenset(WALKABILITY_DOWNLOADERS.keys())
    assert tables == EXPECTED_WALKABILITY_TABLES, (
        f"WALKABILITY_DOWNLOADERS should match expected tables. "
        f"Missing: {EXPECTED_WALKABILITY_TABLES - tables}. "
        f"Extra: {tables - EXPECTED_WALKABILITY_TABLES}."
    )


def test_every_count_table_has_a_downloader():
    """Every table used for count_*_500m in walkability compute must have a downloader in refresh."""
    count_tables = frozenset(TABLE_TO_COUNT_FIELD.keys())
    downloader_tables = frozenset(WALKABILITY_DOWNLOADERS.keys())
    missing = count_tables - downloader_tables
    assert not missing, (
        f"Tables used in walkability compute (TABLE_TO_COUNT_FIELD) must be in WALKABILITY_DOWNLOADERS "
        f"so refresh populates them. Missing downloaders for: {missing}."
    )


def test_every_distance_table_has_a_downloader():
    """Every table used for distance_to_* in walkability compute must have a downloader in refresh."""
    distance_tables = frozenset(TABLE_TO_DISTANCE_FIELD.keys())
    downloader_tables = frozenset(WALKABILITY_DOWNLOADERS.keys())
    missing = distance_tables - downloader_tables
    assert not missing, (
        f"Tables used in walkability compute (TABLE_TO_DISTANCE_FIELD) must be in WALKABILITY_DOWNLOADERS "
        f"so refresh populates them. Missing downloaders for: {missing}."
    )

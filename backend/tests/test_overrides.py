"""Unit tests for UnitOverride parsing and application."""

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.db import get_db
from app.main import get_project, get_unit
from app.overrides import apply_override, build_override_map, unit_to_response_dict
from app.project_catalog import PROJECT_CATALOG_TO_ATTR, get_project_columns
from app.models import Project, ProjectOverride, Unit, UnitOverride


def test_override_parse_int():
    assert apply_override("price_czk", "12345", None, 1) == 12345
    assert apply_override("price_czk", "  99  ", 100, 1) == 99
    assert apply_override("price_per_m2_czk", "50000", 0, 1) == 50000


def test_override_parse_int_fallback(caplog):
    assert apply_override("price_czk", "not-a-number", 42, 1) == 42
    assert "Override parse failed" in caplog.text


def test_override_parse_bool():
    for v in ("true", "TRUE", "1", "yes", "on"):
        assert apply_override("available", v, False, 1) is True
    for v in ("false", "FALSE", "0", "no", "off"):
        assert apply_override("available", v, True, 1) is False


def test_override_parse_bool_fallback(caplog):
    assert apply_override("available", "nope", True, 1) is True
    assert "Override parse failed" in caplog.text


def test_override_parse_decimal():
    assert apply_override("floor_area_m2", "45.67", None, 1) == 45.7
    assert apply_override("equivalent_area_m2", "50", None, 1) == 50.0
    assert apply_override("exterior_area_m2", "12.345", 10.0, 1) == 12.3


def test_override_parse_decimal_fallback(caplog):
    assert apply_override("floor_area_m2", "invalid", 33.3, 1) == 33.3
    assert "Override parse failed" in caplog.text


def test_override_parse_availability_status():
    assert apply_override("availability_status", " available ", "old", 1) == "available"


def test_build_override_map():
    o1 = MagicMock(spec=UnitOverride)
    o1.unit_id = 1
    o1.field = "price_czk"
    o1.value = "100000"
    o2 = MagicMock(spec=UnitOverride)
    o2.unit_id = 1
    o2.field = "available"
    o2.value = "true"
    o3 = MagicMock(spec=UnitOverride)
    o3.unit_id = 2
    o3.field = "unknown_field"
    o3.value = "x"
    m = build_override_map([o1, o2, o3])
    assert m == {1: {"price_czk": "100000", "available": "true"}}


def test_unit_to_response_dict_applies_overrides():
    unit = MagicMock(spec=Unit)
    unit.id = 1
    unit.external_id = "ext-1"
    unit.unit_name = "1+1"
    unit.layout = "1+1"
    unit.floor = 2
    unit.availability_status = "sold"
    unit.available = False
    unit.price_czk = 5000000
    unit.price_per_m2_czk = 80000
    unit.floor_area_m2 = Decimal("62.5")
    unit.equivalent_area_m2 = Decimal("70")
    unit.exterior_area_m2 = None
    unit.balcony_area_m2 = Decimal("10")
    unit.terrace_area_m2 = None
    unit.garden_area_m2 = None
    unit.municipality = "Praha"
    unit.city = "Praha"
    unit.postal_code = "11000"
    unit.ride_to_center_min = Decimal("15")
    unit.public_transport_to_center_min = Decimal("20")
    unit.url = "https://example.com"
    unit.project = MagicMock()
    unit.project.developer = "Dev"
    unit.project.name = "Project A"
    unit.project.address = "Street 1"

    override_map = {
        1: {"price_czk": "4500000", "available": "true", "floor_area_m2": "65.2"},
    }

    d = unit_to_response_dict(unit, override_map)
    assert d["price_czk"] == 4500000
    assert d["available"] is True
    assert d["floor_area_m2"] == 65.2
    assert d["equivalent_area_m2"] == 70.0
    assert d["external_id"] == "ext-1"
    assert d["project"]["name"] == "Project A"


def test_get_project_applies_project_overrides():
    # Pick an editable text-like project column from catalog
    cols = get_project_columns()
    editable_text_cols = [c for c in cols if c.get("editable") and c.get("data_type") == "text"]
    if not editable_text_cols:
        pytest.skip("No editable text project columns configured")
    col = editable_text_cols[0]
    field_key = col["key"]
    attr = PROJECT_CATALOG_TO_ATTR.get(field_key)
    assert attr is not None

    with get_db() as db:
        # Create a project with default/base values
        project = Project(developer="Dev", name="Proj", address="Addr")
        db.add(project)
        db.commit()
        db.refresh(project)

        # Create a project override for the chosen field
        override = ProjectOverride(project_id=project.id, field=field_key, value="manual-value")
        db.add(override)
        db.commit()

        item = get_project(project_id=project.id, db=db)

        # Effective project representation must include the override value
        assert item[field_key] == "manual-value"


def test_get_unit_applies_unit_overrides():
    with get_db() as db:
        project = Project(developer="Dev", name="Proj", address="Addr")
        db.add(project)
        db.commit()
        db.refresh(project)

        unit = Unit(external_id="u-1", project_id=project.id)
        db.add(unit)
        db.commit()
        db.refresh(unit)

        override = UnitOverride(unit_id=unit.id, field="price_czk", value="123456")
        db.add(override)
        db.commit()

        resp = get_unit(external_id="u-1", db=db)
        assert resp.price_czk == 123456

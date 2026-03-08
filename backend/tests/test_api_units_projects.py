"""Integration tests for GET /units and GET /projects with filters."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_get_units_returns_200_and_shape(client: TestClient):
    r = client.get("/units")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)
    assert data["limit"] >= 0
    assert data["offset"] >= 0


def test_get_units_with_limit_offset(client: TestClient):
    r = client.get("/units?limit=10&offset=0")
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) <= 10
    assert data["limit"] == 10
    assert data["offset"] == 0


def test_get_units_with_filter_min_price_per_m2(client: TestClient):
    r = client.get("/units?min_price_per_m2=10000&max_price_per_m2=500000")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    for u in data["items"]:
        if u.get("price_per_m2_czk") is not None:
            assert 10000 <= u["price_per_m2_czk"] <= 500000


def test_get_units_with_sort(client: TestClient):
    r = client.get("/units?sort_by=price_per_m2_czk&sort_dir=asc&limit=5")
    assert r.status_code == 200
    data = r.json()
    prices = [u.get("price_per_m2_czk") for u in data["items"] if u.get("price_per_m2_czk") is not None]
    assert prices == sorted(prices)


def test_get_projects_returns_200_and_shape(client: TestClient):
    r = client.get("/projects")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)


def test_get_projects_with_limit(client: TestClient):
    r = client.get("/projects?limit=5&offset=0")
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) <= 5
    assert data["limit"] == 5


def test_get_projects_with_filter_project_name(client: TestClient):
    # Filter by project name (partial match) – should not error
    r = client.get("/projects?project=NonExistentProjectName123")
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["total"] == 0


def test_get_projects_search_returns_list(client: TestClient):
    r = client.get("/projects/search?q=a&limit=10")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert all(isinstance(x, str) for x in data)


def test_get_projects_search_empty_q_returns_empty(client: TestClient):
    r = client.get("/projects/search?q=")
    assert r.status_code == 200
    assert r.json() == []


def test_get_filters_returns_groups(client: TestClient):
    r = client.get("/filters")
    assert r.status_code == 200
    data = r.json()
    assert "groups" in data
    assert isinstance(data["groups"], list)

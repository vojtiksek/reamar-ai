"""
Walkability score for projects: POI distances, counts in 500 m, and composite scores.

Separate from micro_location_score. Uses OSM POI tables (osm_supermarkets, etc.),
optional OSRM for walking distance to tram/bus/metro. Parks use polygon geometry:
distance_to_park_m is to nearest edge of park polygon, not centroid.
Scoring is configurable and personalization-ready (custom weights passed to compute_walkability_score).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from .models import Project
from .routing import air_distance_m, get_walking_distance_m

# ---------------------------------------------------------------------------
# Config: category weights (0–1), sub-score weights, and distance/count scoring
# Personalization: pass custom weights dict to compute_walkability_score();
# default weights below.
# ---------------------------------------------------------------------------

WALKABILITY_LABEL_THRESHOLDS = [
    (80, "Výborná"),
    (65, "Dobrá"),
    (45, "Průměrná"),
    (25, "Slabší"),
]
# below 25 => "Velmi slabá"

# Category weights for final score (must sum to 1.0)
DEFAULT_CATEGORY_WEIGHTS = {
    "walkability_daily_needs_score": 0.30,
    "walkability_transport_score": 0.30,
    "walkability_leisure_score": 0.20,
    "walkability_family_score": 0.20,
}

# Sub-score config: for each category, (distance_bands, count_bands).
# Distance: (max_m, score_0_100) — nearest POI; linear interpolation between bands.
# Count: (min_count_500m, bonus) — add bonus to sub-score (capped so sub-score <= 100).
WALKABILITY_SCORE_CONFIG = {
    "daily_needs": {
        "distance_bands": [(200, 100), (500, 70), (1000, 40), (2000, 20), (float("inf"), 5)],
        "count_bonus_per_poi": 2,  # +2 per POI in 500 m, max +20
        "fields_distance": [
            "distance_to_supermarket_m",
            "distance_to_drugstore_m",
            "distance_to_pharmacy_m",
            "distance_to_atm_m",
            "distance_to_post_office_m",
        ],
        "fields_count": [
            "count_supermarket_500m",
            "count_drugstore_500m",
            "count_pharmacy_500m",
            "count_atm_500m",
            "count_post_office_500m",
        ],
    },
    "transport": {
        "use_walking": True,
        "distance_bands": [(100, 100), (300, 75), (600, 50), (1000, 25), (float("inf"), 5)],
        "fields_distance": [
            "walking_distance_to_tram_stop_m",
            "walking_distance_to_bus_stop_m",
            "walking_distance_to_metro_station_m",
        ],
        "fields_train": ["distance_to_train_station_m"],
        "train_weight": 0.2,
    },
    "leisure": {
        "distance_bands": [(300, 100), (600, 70), (1000, 45), (1500, 25), (float("inf"), 5)],
        "count_bonus_per_poi": 3,
        "fields_distance": [
            "distance_to_restaurant_m",
            "distance_to_cafe_m",
            "distance_to_park_m",
            "distance_to_fitness_m",
            "distance_to_playground_m",
        ],
        "fields_count": [
            "count_restaurant_500m",
            "count_cafe_500m",
            "count_park_500m",
            "count_fitness_500m",
            "count_playground_500m",
        ],
    },
    "family": {
        "distance_bands": [(400, 100), (800, 65), (1500, 35), (3000, 15), (float("inf"), 5)],
        "count_bonus_per_poi": 5,
        "fields_distance": [
            "distance_to_kindergarten_m",
            "distance_to_primary_school_m",
            "distance_to_pediatrician_m",
        ],
        "fields_count": [
            "count_kindergarten_500m",
            "count_primary_school_500m",
            "count_pediatrician_500m",
        ],
    },
}

# Table name -> project field name for nearest distance (air)
TABLE_TO_DISTANCE_FIELD: dict[str, str] = {
    "osm_supermarkets": "distance_to_supermarket_m",
    "osm_drugstores": "distance_to_drugstore_m",
    "osm_pharmacies": "distance_to_pharmacy_m",
    "osm_atms": "distance_to_atm_m",
    "osm_post_offices": "distance_to_post_office_m",
    "osm_tram_stops": "distance_to_tram_stop_m",
    "osm_bus_stops": "distance_to_bus_stop_m",
    "osm_metro_stations": "distance_to_metro_station_m",
    "osm_train_stations": "distance_to_train_station_m",
    "osm_restaurants": "distance_to_restaurant_m",
    "osm_cafes": "distance_to_cafe_m",
    "osm_parks": "distance_to_park_m",
    "osm_fitness": "distance_to_fitness_m",
    "osm_playgrounds": "distance_to_playground_m",
    "osm_kindergartens": "distance_to_kindergarten_m",
    "osm_primary_schools": "distance_to_primary_school_m",
    "osm_pediatricians": "distance_to_pediatrician_m",
}

TABLE_TO_COUNT_FIELD: dict[str, str] = {
    "osm_supermarkets": "count_supermarket_500m",
    "osm_drugstores": "count_drugstore_500m",
    "osm_pharmacies": "count_pharmacy_500m",
    "osm_atms": "count_atm_500m",
    "osm_post_offices": "count_post_office_500m",
    "osm_restaurants": "count_restaurant_500m",
    "osm_cafes": "count_cafe_500m",
    "osm_parks": "count_park_500m",
    "osm_fitness": "count_fitness_500m",
    "osm_playgrounds": "count_playground_500m",
    "osm_kindergartens": "count_kindergarten_500m",
    "osm_primary_schools": "count_primary_school_500m",
    "osm_pediatricians": "count_pediatrician_500m",
}

RADIUS_500_M = 500.0

# Category slug (API/frontend) -> (table_name, display label)
WALKABILITY_POI_CATEGORIES: dict[str, tuple[str, str]] = {
    "restaurants": ("osm_restaurants", "Restaurace"),
    "cafes": ("osm_cafes", "Kavárny"),
    "supermarkets": ("osm_supermarkets", "Supermarkety"),
    "pharmacies": ("osm_pharmacies", "Lékárny"),
    "parks": ("osm_parks", "Parky"),
    "fitness": ("osm_fitness", "Fitness"),
    "playgrounds": ("osm_playgrounds", "Hřiště"),
    "kindergartens": ("osm_kindergartens", "Školky"),
    "primary_schools": ("osm_primary_schools", "Základní školy"),
    "tram_stops": ("osm_tram_stops", "Tram zastávky"),
    "bus_stops": ("osm_bus_stops", "Bus zastávky"),
    "metro_stations": ("osm_metro_stations", "Metro"),
}


def _nearest_distance_m(
    db: Session,
    table_name: str,
    lon: float,
    lat: float,
    limit_m: float = 15_000,
) -> Optional[float]:
    """Nearest distance in m from (lon, lat) to points in table. Returns None if empty or error."""
    sql = text(
        f"""
        SELECT MIN(
            ST_Distance(
                geom::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
            )
        ) AS d
        FROM {table_name}
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :limit_m
        )
        """
    )
    try:
        row = db.execute(sql, {"lon": lon, "lat": lat, "limit_m": limit_m}).first()
    except DBAPIError:
        return None
    if row is None or row[0] is None:
        return None
    return float(row[0])


def _count_within_m(
    db: Session,
    table_name: str,
    lon: float,
    lat: float,
    radius_m: float = RADIUS_500_M,
) -> int:
    """Count rows in table within radius_m of (lon, lat)."""
    sql = text(
        f"""
        SELECT COUNT(*) FROM {table_name}
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :radius_m
        )
        """
    )
    try:
        row = db.execute(sql, {"lon": lon, "lat": lat, "radius_m": radius_m}).first()
    except DBAPIError:
        return 0
    return int(row[0]) if row and row[0] is not None else 0


def _nearest_point_lat_lon(
    db: Session,
    table_name: str,
    lon: float,
    lat: float,
    limit_m: float = 2000,
) -> Optional[tuple[float, float]]:
    """Return (lat, lon) of nearest point in table, or None."""
    sql = text(
        f"""
        SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
        FROM {table_name}
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :limit_m
        )
        ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
        LIMIT 1
        """
    )
    try:
        row = db.execute(sql, {"lon": lon, "lat": lat, "limit_m": limit_m}).first()
    except DBAPIError:
        return None
    if row is None or row[0] is None:
        return None
    return (float(row[0]), float(row[1]))


def _linear_score(value: Optional[float], points: list[tuple[float, float]]) -> float:
    """Generic piecewise-linear interpolation for (x, score) points."""
    if value is None:
        return 0.0
    try:
        x = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not points:
        return 0.0
    if x <= points[0][0]:
        return points[0][1]
    for i in range(1, len(points)):
        x0, y0 = points[i - 1]
        x1, y1 = points[i]
        if x <= x1:
            if x1 == x0:
                return y1
            t = (x - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return points[-1][1]


def distance_score(distance_m: Optional[float]) -> float:
    """
    Score distance 0–100 using piecewise-linear thresholds:
    0–100 m -> ~100, 200 -> 85, 300 -> 70, 500 -> 45, 800 -> 20, 1000+ -> 0.
    """
    points = [
        (0.0, 100.0),
        (100.0, 100.0),
        (200.0, 85.0),
        (300.0, 70.0),
        (500.0, 45.0),
        (800.0, 20.0),
        (1000.0, 0.0),
    ]
    return max(0.0, min(100.0, _linear_score(distance_m, points)))


def count_score(count: Optional[float]) -> float:
    """
    Score count in 500 m radius:
    0 -> 0, 1 -> 20, 2 -> 35, 3 -> 50, 5 -> 70, 10+ -> 100.
    """
    points = [
        (0.0, 0.0),
        (1.0, 20.0),
        (2.0, 35.0),
        (3.0, 50.0),
        (5.0, 70.0),
        (10.0, 100.0),
    ]
    return max(0.0, min(100.0, _linear_score(count, points)))


def compute_walkability_score(
    raw_metrics: dict[str, Any],
    weights: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    """
    Compute sub-scores and final walkability_score from raw_metrics.

    raw_metrics: dict with keys like distance_to_supermarket_m, count_supermarket_500m,
                 walking_distance_to_tram_stop_m, etc. (values can be None).
    weights: optional dict overriding DEFAULT_CATEGORY_WEIGHTS for personalization.
             Keys: walkability_daily_needs_score, walkability_transport_score,
                   walkability_leisure_score, walkability_family_score.
             Example: client prefers metro and park: increase transport and leisure weights.
             No DB for client preferences yet; a future endpoint can accept weights in the body
             and call this with custom weights.

    Returns dict with:
      walkability_daily_needs_score, walkability_transport_score,
      walkability_leisure_score, walkability_family_score,
      walkability_score (0–100), walkability_label.
    """
    w = weights if weights is not None else DEFAULT_CATEGORY_WEIGHTS
    out: dict[str, Any] = {}

    def get_num(key: str) -> Optional[float]:
        v = raw_metrics.get(key)
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------
    # Category scores
    # ------------------------------------------------------------------
    # Daily needs: supermarket & pharmacy
    supermarket_dist = distance_score(get_num("distance_to_supermarket_m"))
    supermarket_cnt = count_score(get_num("count_supermarket_500m"))
    supermarket_score = 0.85 * supermarket_dist + 0.15 * supermarket_cnt

    pharmacy_dist = distance_score(get_num("distance_to_pharmacy_m"))
    pharmacy_cnt = count_score(get_num("count_pharmacy_500m"))
    pharmacy_score = 0.85 * pharmacy_dist + 0.15 * pharmacy_cnt

    # Transport: use walking distance if present, else air distance
    def _effective_distance(walking_key: str, air_key: str) -> Optional[float]:
        d_walk = get_num(walking_key)
        if d_walk is not None:
            return d_walk
        return get_num(air_key)

    metro = distance_score(_effective_distance("walking_distance_to_metro_station_m", "distance_to_metro_station_m"))
    tram = distance_score(_effective_distance("walking_distance_to_tram_stop_m", "distance_to_tram_stop_m"))
    bus = distance_score(_effective_distance("walking_distance_to_bus_stop_m", "distance_to_bus_stop_m"))
    transport_components = [v for v in (metro, tram, bus) if v is not None]
    transport_components.sort(reverse=True)
    if not transport_components:
        transport_score = 0.0
    else:
        best = transport_components[0]
        second = transport_components[1] if len(transport_components) > 1 else 0.0
        third = transport_components[2] if len(transport_components) > 2 else 0.0
        transport_score = 0.5 * best + 0.3 * second + 0.2 * third

    # Leisure
    restaurant_score = 0.70 * distance_score(get_num("distance_to_restaurant_m")) + 0.30 * count_score(
        get_num("count_restaurant_500m")
    )
    cafe_score = 0.70 * distance_score(get_num("distance_to_cafe_m")) + 0.30 * count_score(
        get_num("count_cafe_500m")
    )
    park_score = 0.75 * distance_score(get_num("distance_to_park_m")) + 0.25 * count_score(
        get_num("count_park_500m")
    )
    fitness_score = 0.70 * distance_score(get_num("distance_to_fitness_m")) + 0.30 * count_score(
        get_num("count_fitness_500m")
    )

    # Family
    kindergarten_score = 0.80 * distance_score(get_num("distance_to_kindergarten_m")) + 0.20 * count_score(
        get_num("count_kindergarten_500m")
    )
    primary_school_score = 0.80 * distance_score(get_num("distance_to_primary_school_m")) + 0.20 * count_score(
        get_num("count_primary_school_500m")
    )
    playground_score = 0.75 * distance_score(get_num("distance_to_playground_m")) + 0.25 * count_score(
        get_num("count_playground_500m")
    )
    family_park_score = park_score

    # ------------------------------------------------------------------
    # Subscores (0–100)
    # ------------------------------------------------------------------
    daily_needs_score = (
        0.60 * supermarket_score +
        0.40 * pharmacy_score
    )
    leisure_score = (
        0.30 * park_score +
        0.25 * restaurant_score +
        0.20 * cafe_score +
        0.25 * fitness_score
    )
    family_score = (
        0.25 * kindergarten_score +
        0.35 * primary_school_score +
        0.20 * family_park_score +
        0.20 * playground_score
    )

    out["walkability_daily_needs_score"] = int(round(max(0.0, min(100.0, daily_needs_score))))
    out["walkability_transport_score"] = int(round(max(0.0, min(100.0, transport_score))))
    out["walkability_leisure_score"] = int(round(max(0.0, min(100.0, leisure_score))))
    out["walkability_family_score"] = int(round(max(0.0, min(100.0, family_score))))

    # ------------------------------------------------------------------
    # Final weighted score and label
    # ------------------------------------------------------------------
    total = (
        out["walkability_daily_needs_score"] * w.get("walkability_daily_needs_score", 0.30)
        + out["walkability_transport_score"] * w.get("walkability_transport_score", 0.30)
        + out["walkability_leisure_score"] * w.get("walkability_leisure_score", 0.20)
        + out["walkability_family_score"] * w.get("walkability_family_score", 0.20)
    )
    total_clamped = max(0.0, min(100.0, total))
    out["walkability_score"] = int(round(total_clamped))

    score_val = out["walkability_score"]
    if score_val >= 80:
        out["walkability_label"] = "Výborná"
    elif score_val >= 65:
        out["walkability_label"] = "Dobrá"
    elif score_val >= 45:
        out["walkability_label"] = "Průměrná"
    elif score_val >= 25:
        out["walkability_label"] = "Slabší"
    else:
        out["walkability_label"] = "Velmi slabá"

    return out


# ---------------------------------------------------------------------------
# Personalized walkability: same category formulas, client weights, no double-count.
# Total = weighted average of each category at most once (park counts once in total).
# Subscores (for UI) may reuse park in leisure and family.
# ---------------------------------------------------------------------------

PERSONALIZED_PRIORITY_WEIGHTS = {"high": 2.0, "normal": 1.0, "ignore": 0.0}

# All categories that can be weighted; each contributes at most once to total score.
PERSONALIZED_CATEGORIES = [
    "supermarket",
    "pharmacy",
    "restaurant",
    "cafe",
    "park",
    "fitness",
    "playground",
    "kindergarten",
    "primary_school",
    "metro",
    "tram",
    "bus",
]

# Subscore groups for UI (park reused in leisure and family; total still uses park once).
PERSONALIZED_DAILY_NEEDS = ["supermarket", "pharmacy"]
PERSONALIZED_TRANSPORT = ["metro", "tram", "bus"]
PERSONALIZED_LEISURE = ["restaurant", "cafe", "park", "fitness"]
PERSONALIZED_FAMILY = ["kindergarten", "primary_school", "park", "playground"]

# Default subscore structure: same weights as compute_walkability_score, so that
# when all preferences are "normal", personalized score == default score.
DEFAULT_DAILY_NEEDS_WEIGHTS = {"supermarket": 0.60, "pharmacy": 0.40}
DEFAULT_LEISURE_WEIGHTS = {"park": 0.30, "restaurant": 0.25, "cafe": 0.20, "fitness": 0.25}
DEFAULT_FAMILY_WEIGHTS = {"kindergarten": 0.25, "primary_school": 0.35, "park": 0.20, "playground": 0.20}
DEFAULT_TRANSPORT_POSITION_WEIGHTS = (0.5, 0.3, 0.2)  # best, second, third
DEFAULT_TOTAL_WEIGHTS = {"daily_needs": 0.30, "transport": 0.30, "leisure": 0.20, "family": 0.20}


def _compute_category_scores(raw_metrics: dict[str, Any]) -> dict[str, float]:
    """
    Compute per-category scores 0–100 using same formulas and raw field names as default scoring.
    Uses distance_score, count_score, and effective distance (walking_* with fallback to distance_to_*) for MHD.
    """
    def get_num(key: str) -> Optional[float]:
        v = raw_metrics.get(key)
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def _effective_distance(walking_key: str, air_key: str) -> Optional[float]:
        d_walk = get_num(walking_key)
        if d_walk is not None:
            return d_walk
        return get_num(air_key)

    scores: dict[str, float] = {}
    # Daily needs
    scores["supermarket"] = 0.85 * distance_score(get_num("distance_to_supermarket_m")) + 0.15 * count_score(get_num("count_supermarket_500m"))
    scores["pharmacy"] = 0.85 * distance_score(get_num("distance_to_pharmacy_m")) + 0.15 * count_score(get_num("count_pharmacy_500m"))
    # Transport (effective = walking then air)
    scores["metro"] = distance_score(_effective_distance("walking_distance_to_metro_station_m", "distance_to_metro_station_m"))
    scores["tram"] = distance_score(_effective_distance("walking_distance_to_tram_stop_m", "distance_to_tram_stop_m"))
    scores["bus"] = distance_score(_effective_distance("walking_distance_to_bus_stop_m", "distance_to_bus_stop_m"))
    # Leisure
    scores["restaurant"] = 0.70 * distance_score(get_num("distance_to_restaurant_m")) + 0.30 * count_score(get_num("count_restaurant_500m"))
    scores["cafe"] = 0.70 * distance_score(get_num("distance_to_cafe_m")) + 0.30 * count_score(get_num("count_cafe_500m"))
    scores["park"] = 0.75 * distance_score(get_num("distance_to_park_m")) + 0.25 * count_score(get_num("count_park_500m"))
    scores["fitness"] = 0.70 * distance_score(get_num("distance_to_fitness_m")) + 0.30 * count_score(get_num("count_fitness_500m"))
    # Family
    scores["playground"] = 0.75 * distance_score(get_num("distance_to_playground_m")) + 0.25 * count_score(get_num("count_playground_500m"))
    scores["kindergarten"] = 0.80 * distance_score(get_num("distance_to_kindergarten_m")) + 0.20 * count_score(get_num("count_kindergarten_500m"))
    scores["primary_school"] = 0.80 * distance_score(get_num("distance_to_primary_school_m")) + 0.20 * count_score(get_num("count_primary_school_500m"))

    for k, v in scores.items():
        scores[k] = max(0.0, min(100.0, v))
    return scores


def compute_personalized_walkability_score(
    raw_metrics: dict[str, Any],
    preferences: dict[str, str],
) -> dict[str, Any]:
    """
    Compute personalized score from raw_metrics and client preferences.
    Uses the SAME subscore structure and weights as default scoring; preference
    weights only scale category contributions within each group. When all
    preferences are "normal", result matches default walkability_score (invariant).
    """
    category_scores = _compute_category_scores(raw_metrics)
    weights_used: dict[str, float] = {}
    for cat in PERSONALIZED_CATEGORIES:
        pref = (preferences.get(cat) or "normal").strip().lower()
        weights_used[cat] = PERSONALIZED_PRIORITY_WEIGHTS.get(pref, 1.0)

    def _subscore_with_default_weights(
        cat_weights: dict[str, float],
    ) -> Optional[float]:
        num = sum(
            cat_weights[c] * weights_used.get(c, 0) * category_scores.get(c, 0.0)
            for c in cat_weights
            if weights_used.get(c, 0) > 0
        )
        den = sum(cat_weights[c] * weights_used.get(c, 0) for c in cat_weights if weights_used.get(c, 0) > 0)
        if den <= 0:
            return None
        return max(0.0, min(100.0, num / den))

    # Daily needs: same structure as default (0.60 supermarket + 0.40 pharmacy)
    daily_needs = _subscore_with_default_weights(DEFAULT_DAILY_NEEDS_WEIGHTS)

    # Transport: same as default — sort metro/tram/bus by score desc, then 0.5*best + 0.3*second + 0.2*third
    transport_vals = [
        (category_scores.get(c, 0.0), weights_used.get(c, 0)) for c in PERSONALIZED_TRANSPORT
    ]
    transport_vals = [(s, w) for s, w in transport_vals if w > 0]
    transport_vals.sort(key=lambda x: x[0], reverse=True)
    if not transport_vals:
        transport = None
    else:
        pos_w = DEFAULT_TRANSPORT_POSITION_WEIGHTS
        num = sum(
            (pos_w[i] if i < len(pos_w) else 0.0) * transport_vals[i][0] * transport_vals[i][1]
            for i in range(len(transport_vals))
        )
        den = sum(
            (pos_w[i] if i < len(pos_w) else 0.0) * transport_vals[i][1]
            for i in range(len(transport_vals))
        )
        transport = max(0.0, min(100.0, num / den)) if den > 0 else None

    # Leisure: same structure as default (0.30 park + 0.25 restaurant + 0.20 cafe + 0.25 fitness)
    leisure = _subscore_with_default_weights(DEFAULT_LEISURE_WEIGHTS)

    # Family: same structure as default (0.25 kindergarten + 0.35 primary_school + 0.20 park + 0.20 playground)
    family = _subscore_with_default_weights(DEFAULT_FAMILY_WEIGHTS)

    # Total: same as default — 0.30*daily + 0.30*transport + 0.20*leisure + 0.20*family
    # Renormalize if a subscore is None (all categories in that group ignored)
    total_w = DEFAULT_TOTAL_WEIGHTS
    parts: list[tuple[float, float]] = []
    if daily_needs is not None:
        parts.append((total_w["daily_needs"], daily_needs))
    if transport is not None:
        parts.append((total_w["transport"], transport))
    if leisure is not None:
        parts.append((total_w["leisure"], leisure))
    if family is not None:
        parts.append((total_w["family"], family))
    if not parts:
        total_score = 0.0
    else:
        w_sum = sum(p[0] for p in parts)
        total_score = sum(p[0] * p[1] for p in parts) / w_sum if w_sum > 0 else 0.0
    total_score = max(0.0, min(100.0, total_score))

    if total_score >= 80:
        label = "Výborná"
    elif total_score >= 65:
        label = "Dobrá"
    elif total_score >= 45:
        label = "Průměrná"
    elif total_score >= 25:
        label = "Slabší"
    else:
        label = "Velmi slabá"

    return {
        "score": round(total_score, 1),
        "label": label,
        "daily_needs_score": round(daily_needs, 1) if daily_needs is not None else None,
        "transport_score": round(transport, 1) if transport is not None else None,
        "leisure_score": round(leisure, 1) if leisure is not None else None,
        "family_score": round(family, 1) if family is not None else None,
        "category_scores": category_scores,
        "weights_used": weights_used,
    }


def project_to_raw_metrics(project: Project) -> dict[str, Any]:
    """Build raw_metrics dict from Project using same field names as compute_project_walkability."""
    raw: dict[str, Any] = {}
    for attr in (
        "distance_to_supermarket_m",
        "distance_to_drugstore_m",
        "distance_to_pharmacy_m",
        "distance_to_atm_m",
        "distance_to_post_office_m",
        "distance_to_tram_stop_m",
        "distance_to_bus_stop_m",
        "distance_to_metro_station_m",
        "distance_to_train_station_m",
        "distance_to_restaurant_m",
        "distance_to_cafe_m",
        "distance_to_park_m",
        "distance_to_fitness_m",
        "distance_to_playground_m",
        "distance_to_kindergarten_m",
        "distance_to_primary_school_m",
        "distance_to_pediatrician_m",
        "walking_distance_to_tram_stop_m",
        "walking_distance_to_bus_stop_m",
        "walking_distance_to_metro_station_m",
    ):
        if hasattr(project, attr):
            v = getattr(project, attr)
            raw[attr] = float(v) if v is not None else None
    for attr in (
        "count_supermarket_500m",
        "count_drugstore_500m",
        "count_pharmacy_500m",
        "count_atm_500m",
        "count_post_office_500m",
        "count_restaurant_500m",
        "count_cafe_500m",
        "count_park_500m",
        "count_fitness_500m",
        "count_playground_500m",
        "count_kindergarten_500m",
        "count_primary_school_500m",
        "count_pediatrician_500m",
    ):
        if hasattr(project, attr):
            v = getattr(project, attr)
            raw[attr] = int(v) if v is not None else None
    return raw


def compute_project_walkability(db: Session, project: Project) -> None:
    """
    Fill all walkability fields on project: distances, counts, walking distances (tram/bus/metro),
    sub-scores and walkability_score/label. Uses OSM POI tables and optional OSRM.
    """
    lat = project.gps_latitude
    lon = project.gps_longitude
    if lat is None or lon is None:
        _clear_walkability(project)
        return

    lat_f, lon_f = float(lat), float(lon)
    raw: dict[str, Any] = {}
    walking_fallback = False

    # Air distances and counts for all POI tables
    for table_name, dist_field in TABLE_TO_DISTANCE_FIELD.items():
        d = _nearest_distance_m(db, table_name, lon_f, lat_f)
        raw[dist_field] = d
    for table_name, count_field in TABLE_TO_COUNT_FIELD.items():
        c = _count_within_m(db, table_name, lon_f, lat_f, RADIUS_500_M)
        raw[count_field] = c

    # Walking distance for tram, bus, metro (OSRM or fallback to air)
    WALKING_TABLE_MAP = {
        "walking_distance_to_tram_stop_m": "osm_tram_stops",
        "walking_distance_to_bus_stop_m": "osm_bus_stops",
        "walking_distance_to_metro_station_m": "osm_metro_stations",
    }
    for walking_key, table_name in WALKING_TABLE_MAP.items():
        nearest = _nearest_point_lat_lon(db, table_name, lon_f, lat_f)
        if nearest is not None:
            dest_lat, dest_lon = nearest
            dist_m, used_fallback = get_walking_distance_m(lat_f, lon_f, dest_lat, dest_lon)
            if used_fallback:
                walking_fallback = True
                dist_m = air_distance_m(lat_f, lon_f, dest_lat, dest_lon)
            raw[walking_key] = dist_m
        else:
            raw[walking_key] = raw.get(
                {"walking_distance_to_tram_stop_m": "distance_to_tram_stop_m", "walking_distance_to_bus_stop_m": "distance_to_bus_stop_m", "walking_distance_to_metro_station_m": "distance_to_metro_station_m"}[walking_key]
            )

    # Persist raw fields on project (distances + counts)
    for k, v in raw.items():
        if hasattr(project, k):
            setattr(project, k, v)
    project.walkability_walking_fallback_used = walking_fallback

    # Scores
    result = compute_walkability_score(raw)
    project.walkability_daily_needs_score = result["walkability_daily_needs_score"]
    project.walkability_transport_score = result["walkability_transport_score"]
    project.walkability_leisure_score = result["walkability_leisure_score"]
    project.walkability_family_score = result["walkability_family_score"]
    project.walkability_score = result["walkability_score"]
    project.walkability_label = result["walkability_label"]
    project.walkability_updated_at = datetime.now(timezone.utc)
    project.walkability_source = "osm_geometry"
    project.walkability_method = "st_distance_geography" + ("_air_fallback" if walking_fallback else "")


def _clear_walkability(project: Project) -> None:
    for key in list(TABLE_TO_DISTANCE_FIELD.values()) + list(TABLE_TO_COUNT_FIELD.values()):
        if hasattr(project, key):
            setattr(project, key, None)
    for key in (
        "walking_distance_to_tram_stop_m",
        "walking_distance_to_bus_stop_m",
        "walking_distance_to_metro_station_m",
        "walkability_walking_fallback_used",
        "walkability_daily_needs_score",
        "walkability_transport_score",
        "walkability_leisure_score",
        "walkability_family_score",
        "walkability_score",
        "walkability_label",
        "walkability_updated_at",
        "walkability_source",
        "walkability_method",
    ):
        if hasattr(project, key):
            setattr(project, key, None)


def get_project_walkability_poi_list(
    db: Session,
    project_id: int,
    category: str,
    limit: int = 50,
    within_m: float = 2000,
) -> list[dict[str, Any]]:
    """
    List POI of a given category near the project. Returns name, category label, distance_m, lat, lon.
    For parks (polygon), distance is to nearest edge; lat/lon is centroid for display.
    """
    if category not in WALKABILITY_POI_CATEGORIES:
        return []
    table_name, category_label = WALKABILITY_POI_CATEGORIES[category]
    project = db.get(Project, project_id)
    if not project or project.gps_latitude is None or project.gps_longitude is None:
        return []
    lat_f, lon_f = float(project.gps_latitude), float(project.gps_longitude)
    sql = text(
        f"""
        SELECT
            name,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance_m,
            ST_Y(ST_Centroid(geom)::geometry) AS lat,
            ST_X(ST_Centroid(geom)::geometry) AS lon
        FROM {table_name}
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :within_m
        )
        ORDER BY distance_m
        LIMIT :limit
        """
    )
    try:
        rows = db.execute(
            sql,
            {"lon": lon_f, "lat": lat_f, "within_m": within_m, "limit": limit},
        ).all()
    except DBAPIError:
        return []
    return [
        {
            "name": (r[0] or "").strip() or None,
            "category": category_label,
            "distance_m": round(float(r[1]), 0) if r[1] is not None else None,
            "lat": float(r[2]) if r[2] is not None else None,
            "lon": float(r[3]) if r[3] is not None else None,
        }
        for r in rows
    ]


def get_project_walkability_poi_overview(
    db: Session,
    project_id: int,
    categories: list[str],
    per_category: int = 2,
    within_m: float = 2000,
) -> dict[str, Any]:
    """
    Return project lat/lon and per-category POI lists (nearest N per category).
    For map widgets: limit=per_category keeps payload small.
    """
    project = db.get(Project, project_id)
    if not project or project.gps_latitude is None or project.gps_longitude is None:
        return {"project": None, "categories": {}}
    out_categories: dict[str, list[dict[str, Any]]] = {}
    for cat in categories:
        if cat not in WALKABILITY_POI_CATEGORIES:
            continue
        items = get_project_walkability_poi_list(db, project_id, cat, limit=per_category, within_m=within_m)
        out_categories[cat] = items
    return {
        "project": {"lat": float(project.gps_latitude), "lon": float(project.gps_longitude)},
        "categories": out_categories,
    }

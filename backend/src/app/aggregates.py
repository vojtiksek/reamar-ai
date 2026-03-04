from __future__ import annotations

from decimal import Decimal
from datetime import date
from typing import Iterable, Sequence, Any

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProjectAggregates, Unit, UnitOverride
from .overrides import OVERRIDEABLE_FIELDS, build_override_map, unit_to_response_dict


AGGREGATE_RELEVANT_FIELDS: frozenset[str] = frozenset(
    {
        "price_czk",
        "price_per_m2_czk",
        "available",
        "floor_area_m2",
    }
)


def recompute_project_aggregates(db: Session, project_ids: Sequence[int]) -> None:
    """
    Recompute cached project aggregates for the given project_ids.

    Aggregates are computed from EFFECTIVE unit values (base + unit overrides),
    reusing the same override application logic as /units (unit_to_response_dict).
    """
    ids = [int(pid) for pid in project_ids if pid is not None]
    if not ids:
        return

    # Load units for all projects in one query
    units = (
        db.execute(
            select(Unit).where(Unit.project_id.in_(ids))
        )
        .scalars()
        .all()
    )
    if not units:
        # Nothing to do; ensure any existing aggregates for these projects are cleared
        db.query(ProjectAggregates).filter(ProjectAggregates.project_id.in_(ids)).delete(
            synchronize_session=False
        )
        return

    unit_ids = [u.id for u in units]
    override_rows = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id.in_(unit_ids),
                UnitOverride.field.in_(OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map = build_override_map(override_rows)

    # Build effective unit dicts (same shape as UnitResponse)
    per_project: dict[int, list[dict]] = {}
    for u in units:
        data = unit_to_response_dict(u, override_map)
        per_project.setdefault(u.project_id, []).append(data)

    for project_id, unit_dicts in per_project.items():
        if project_id not in ids:
            continue

        total_units = len(unit_dicts)
        if total_units == 0:
            agg = db.get(ProjectAggregates, project_id) or ProjectAggregates(project_id=project_id)
            agg.total_units = 0
            agg.available_units = 0
            agg.availability_ratio = Decimal("0") if hasattr(Decimal, "__call__") else None
            agg.avg_price_czk = None
            agg.min_price_czk = None
            agg.max_price_czk = None
            agg.avg_price_per_m2_czk = None
            agg.avg_floor_area_m2 = None
            db.merge(agg)
            continue

        # Effective values from unit_to_response_dict (top-level fields)
        prices = [d.get("price_czk") for d in unit_dicts if d.get("price_czk") is not None]
        prices_per_m2 = [
            d.get("price_per_m2_czk") for d in unit_dicts if d.get("price_per_m2_czk") is not None
        ]
        areas = [d.get("floor_area_m2") for d in unit_dicts if d.get("floor_area_m2") is not None]
        available_units = sum(1 for d in unit_dicts if bool(d.get("available")))

        # Extra metrics are stored in the nested data dict keyed by catalog column
        parking_indoor_vals: list[int] = []
        parking_outdoor_vals: list[int] = []
        payment_contract_vals: list[Decimal] = []
        payment_construction_vals: list[Decimal] = []
        payment_occupancy_vals: list[Decimal] = []
        first_seen_vals: list[date] = []
        last_seen_vals: list[date] = []
        days_on_market_vals: list[int] = []

        for d in unit_dicts:
            extra: dict[str, Any] = d.get("data") or {}

            def _as_int(val: Any) -> int | None:
                if val is None:
                    return None
                try:
                    return int(val)
                except Exception:
                    return None

            def _as_decimal(val: Any) -> Decimal | None:
                if val is None:
                    return None
                try:
                    return Decimal(str(val))
                except Exception:
                    return None

            def _as_date(val: Any) -> date | None:
                if val is None:
                    return None
                if isinstance(val, date):
                    return val
                try:
                    return date.fromisoformat(str(val))
                except Exception:
                    return None

            pi = _as_int(extra.get("parking_indoor_price"))
            if pi is not None:
                parking_indoor_vals.append(pi)
            po = _as_int(extra.get("parking_outdoor_price"))
            if po is not None:
                parking_outdoor_vals.append(po)

            pc = _as_decimal(extra.get("payment_contract"))
            if pc is not None:
                payment_contract_vals.append(pc)
            pcon = _as_decimal(extra.get("payment_construction"))
            if pcon is not None:
                payment_construction_vals.append(pcon)
            pocc = _as_decimal(extra.get("payment_occupancy"))
            if pocc is not None:
                payment_occupancy_vals.append(pocc)

            fs = _as_date(extra.get("first_seen"))
            if fs is not None:
                first_seen_vals.append(fs)
            ls = _as_date(extra.get("last_seen"))
            if ls is not None:
                last_seen_vals.append(ls)

            dom = _as_int(extra.get("days_on_market"))
            if dom is not None:
                days_on_market_vals.append(dom)

        def _avg(values: Iterable[object]) -> Decimal | None:
            nums: list[Decimal] = []
            for v in values:
                try:
                    nums.append(Decimal(str(v)))
                except Exception:
                    continue
            if not nums:
                return None
            return sum(nums) / Decimal(len(nums))

        avg_price = _avg(prices)
        avg_price_per_m2 = _avg(prices_per_m2)
        avg_floor_area = _avg(areas)

        min_price = None
        max_price = None
        if prices:
            try:
                ints = [int(p) for p in prices]
                min_price = min(ints)
                max_price = max(ints)
            except Exception:
                min_price = None
                max_price = None

        availability_ratio: Decimal | None
        try:
            availability_ratio = (
                Decimal(available_units) / Decimal(total_units) if total_units > 0 else None
            )
        except Exception:
            availability_ratio = None

        agg = db.get(ProjectAggregates, project_id) or ProjectAggregates(project_id=project_id)
        agg.total_units = total_units
        agg.available_units = available_units
        agg.availability_ratio = availability_ratio
        agg.avg_price_czk = avg_price
        agg.min_price_czk = min_price
        agg.max_price_czk = max_price
        agg.avg_price_per_m2_czk = avg_price_per_m2
        agg.avg_floor_area_m2 = avg_floor_area

        # Parking price aggregates
        agg.min_parking_indoor_price_czk = min(parking_indoor_vals) if parking_indoor_vals else None
        agg.max_parking_indoor_price_czk = max(parking_indoor_vals) if parking_indoor_vals else None
        agg.min_parking_outdoor_price_czk = min(parking_outdoor_vals) if parking_outdoor_vals else None
        agg.max_parking_outdoor_price_czk = max(parking_outdoor_vals) if parking_outdoor_vals else None

        # Time/status aggregates
        agg.project_first_seen = min(first_seen_vals) if first_seen_vals else None
        agg.project_last_seen = max(last_seen_vals) if last_seen_vals else None
        agg.max_days_on_market = max(days_on_market_vals) if days_on_market_vals else None

        # Payment scheme aggregates
        agg.min_payment_contract = min(payment_contract_vals) if payment_contract_vals else None
        agg.max_payment_contract = max(payment_contract_vals) if payment_contract_vals else None
        agg.min_payment_construction = min(payment_construction_vals) if payment_construction_vals else None
        agg.max_payment_construction = max(payment_construction_vals) if payment_construction_vals else None
        agg.min_payment_occupancy = min(payment_occupancy_vals) if payment_occupancy_vals else None
        agg.max_payment_occupancy = max(payment_occupancy_vals) if payment_occupancy_vals else None

        db.merge(agg)

    db.flush()


EARTH_RADIUS_M = 6371000.0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in metres."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(
        d_lambda / 2
    ) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_M * c


def _layout_group(layout: str | None) -> str | None:
    """Map raw layout like 'layout_1', 'layout_1_5' to bucket name."""
    if not layout:
        return None
    s = str(layout).strip().lower()
    if s.startswith("layout_"):
        parts = s.split("_")
        if len(parts) == 2:
            # layout_1 -> 1kk, layout_2 -> 2kk, ...
            try:
                n = int(parts[1])
            except ValueError:
                return None
            if n in (1, 2, 3, 4):
                return f"{n}kk"
            return None
        if len(parts) == 3 and parts[1] == "1" and parts[2] == "5":
            # layout_1_5 -> 1,5kk
            return "1.5kk"
    # Fallback for values typu "1+kk", "2+kk"
    if s.endswith("+kk"):
        try:
            n = int(s.split("+", 1)[0])
        except ValueError:
            return None
        if n in (1, 2, 3, 4):
            return f"{n}kk"
    return None


def recompute_local_price_diffs(db: Session) -> None:
    """
    Recompute local price differences (vs. market) for all units.

    For each unit with GPS + price_per_m2 + floor_area + layout bucket, we compute
    percentage difference between its price_per_m2 and the average price_per_m2 of
    comparable units in a radius of 500m / 1km / 2km. Do průměru se berou všechny
    jednotky v bucketu (včetně prodaných), aby dvě stejné jednotky měly stejnou
    odchylku (konzistence znaménka).

    Comparable = same layout bucket + area range:
    - 1kk: layout group '1kk' AND 20–35 m²
    - 2kk: '2kk' AND 40–60 m²
    - 3kk: '3kk' AND 60–80 m²
    - 4kk: '4kk' AND 80–120 m²
    - 1,5kk: průměr průměrů (bucket 1kk a bucket 2kk) v daném okruhu.
    """
    # Load all units that have GPS and price_per_m2 & floor area.
    units = (
        db.execute(
            select(Unit).where(
                Unit.gps_latitude.isnot(None),
                Unit.gps_longitude.isnot(None),
                Unit.price_per_m2_czk.isnot(None),
                Unit.floor_area_m2.isnot(None),
            )
        )
        .scalars()
        .all()
    )
    if not units:
        return

    unit_ids = [u.id for u in units]
    override_rows = (
        db.execute(
            select(UnitOverride).where(
                UnitOverride.unit_id.in_(unit_ids),
                UnitOverride.field.in_(OVERRIDEABLE_FIELDS),
            )
        )
        .scalars()
        .all()
    )
    override_map = build_override_map(override_rows)

    # Prepare effective data per unit.
    infos: list[dict[str, Any]] = []
    for u in units:
        lat = u.gps_latitude
        lon = u.gps_longitude
        if lat is None or lon is None:
            continue
        data = unit_to_response_dict(u, override_map)
        price_pm2 = data.get("price_per_m2_czk")
        area = data.get("floor_area_m2")
        layout = data.get("layout")
        if price_pm2 is None or area is None or layout is None:
            continue
        try:
            price_pm2_f = float(price_pm2)
            area_f = float(area)
        except (TypeError, ValueError):
            continue
        group = _layout_group(str(layout))
        if group is None:
            continue

        # Rekonstrukce: porovnávame jen jednotky se stejným stavem (novostavba s novostavbou, rekonstrukce s rekonstrukcí).
        renovation_val = data.get("renovation") if isinstance(data, dict) else getattr(u, "renovation", None)
        if renovation_val is not None and not isinstance(renovation_val, bool):
            try:
                renovation_val = bool(renovation_val)
            except (TypeError, ValueError):
                renovation_val = None

        # Zjisti, zda je jednotka aktuálně "na trhu".
        # Bereme jednotky, které jsou dostupné (available) NEBO mají stav "available"/"reserved".
        # Prodané ("sold") nechceme, aby neovlivňovaly průměr.
        if isinstance(data, dict):
            avail_flag = data.get("available")
            status_raw = data.get("availability_status") or u.availability_status or ""
        else:
            avail_flag = u.available
            status_raw = u.availability_status or ""
        status = str(status_raw).strip().lower()
        is_available_flag = bool(avail_flag)
        on_market = is_available_flag or status in {"available", "reserved"}

        infos.append(
            {
                "unit": u,
                "id": u.id,
                "lat": float(lat),
                "lon": float(lon),
                "price_pm2": price_pm2_f,
                "area": area_f,
                "group": group,
                "on_market": on_market,
                "renovation": renovation_val,
                "last_seen": getattr(u, "last_seen", None),
            }
        )

    if not infos:
        return

    # Build a simple spatial index (grid) in lat/lon to avoid O(N^2) neighbour search.
    # Cell size ~250 m; still use exact haversine for final radius check, so results stay identical.
    avg_lat = sum(info["lat"] for info in infos) / len(infos)
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lng = 111_320.0 * math.cos(math.radians(avg_lat))
    if meters_per_deg_lng <= 0:
        meters_per_deg_lng = 111_320.0
    cell_size_m = 250.0
    cell_deg_lat = cell_size_m / meters_per_deg_lat
    cell_deg_lng = cell_size_m / meters_per_deg_lng

    def _cell_coords(lat: float, lon: float) -> tuple[int, int]:
        return (
            int(math.floor(lat / cell_deg_lat)),
            int(math.floor(lon / cell_deg_lng)),
        )

    grid: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for info in infos:
        cx, cy = _cell_coords(info["lat"], info["lon"])
        info["cell"] = (cx, cy)
        grid.setdefault((cx, cy), []).append(info)

    def in_area_bucket(group: str, area: float, target_group: str) -> bool:
        """Check if unit with (group, area) belongs to bucket for target_group."""
        # Buckets defined strictly by group + area.
        if group != target_group:
            return False
        if target_group == "1kk":
            return 20.0 <= area <= 35.0
        if target_group == "2kk":
            return 40.0 <= area <= 60.0
        if target_group == "3kk":
            return 60.0 <= area <= 80.0
        if target_group == "4kk":
            return 80.0 <= area <= 120.0
        return False

    def avg(values: list[float]) -> float | None:
        if not values:
            return None
        return float(sum(values) / len(values))

    radii = (500.0, 1000.0, 2000.0)

    # For each unit compute diffs for each radius.
    for info in infos:
        u = info["unit"]
        lat1 = info["lat"]
        lon1 = info["lon"]
        price_pm2 = info["price_pm2"]
        area = info["area"]
        group = info["group"]

        diffs: dict[float, float | None] = {r: None for r in radii}

        for radius in radii:
            bucket_1_prices: list[float] = []
            bucket_2_prices: list[float] = []
            bucket_3_prices: list[float] = []
            bucket_4_prices: list[float] = []

            # Determine how many grid cells around the current cell we need
            # to cover the given radius in both directions.
            max_dlat = radius / meters_per_deg_lat
            max_dlon = radius / meters_per_deg_lng
            max_cx_offset = int(math.ceil(max_dlat / cell_deg_lat))
            max_cy_offset = int(math.ceil(max_dlon / cell_deg_lng))
            cx, cy = info["cell"]

            for dx in range(-max_cx_offset, max_cx_offset + 1):
                for dy in range(-max_cy_offset, max_cy_offset + 1):
                    cell_infos = grid.get((cx + dx, cy + dy))
                    if not cell_infos:
                        continue
                    for other in cell_infos:
                        if other["id"] == info["id"]:
                            continue
                        # Porovnávame jen jednotky se stejným typem rekonstrukce (novostavba s novostavbou, rekonstrukce s rekonstrukcí).
                        if other.get("renovation") != info.get("renovation"):
                            continue
                        # Prodané jednotky (SOLD) zahrnujeme jen pokud byly last_seen nejvýše 90 dní od dneška.
                        if not other.get("on_market"):
                            ls = other.get("last_seen")
                            if ls is None or (date.today() - ls).days > 90:
                                continue
                        # Do průměru bereme všechny jednotky v bucketu (včetně prodaných), aby
                        # dvě stejné jednotky ve stejném projektu měly stejný ref_avg a tedy
                        # stejnou odchylku. (Pouze „on_market“ by u prodané vs dostupné dvojčete
                        # dávalo opačná znaménka.)
                        d = _haversine_m(lat1, lon1, other["lat"], other["lon"])
                        if d > radius:
                            continue
                        g2 = other["group"]
                        a2 = other["area"]
                        p2 = other["price_pm2"]
                        if in_area_bucket(g2, a2, "1kk"):
                            bucket_1_prices.append(p2)
                        if in_area_bucket(g2, a2, "2kk"):
                            bucket_2_prices.append(p2)
                        if in_area_bucket(g2, a2, "3kk"):
                            bucket_3_prices.append(p2)
                        if in_area_bucket(g2, a2, "4kk"):
                            bucket_4_prices.append(p2)

            ref_avg: float | None = None
            if group == "1kk":
                ref_avg = avg(bucket_1_prices)
            elif group == "2kk":
                ref_avg = avg(bucket_2_prices)
            elif group == "3kk":
                ref_avg = avg(bucket_3_prices)
            elif group == "4kk":
                ref_avg = avg(bucket_4_prices)
            elif group == "1.5kk":
                ref1 = avg(bucket_1_prices)
                ref2 = avg(bucket_2_prices)
                if ref1 is not None and ref2 is not None:
                    ref_avg = (ref1 + ref2) / 2.0
                elif ref1 is not None:
                    ref_avg = ref1
                elif ref2 is not None:
                    ref_avg = ref2

            if ref_avg is None or ref_avg <= 0:
                diffs[radius] = None
            else:
                diffs[radius] = (price_pm2 - ref_avg) / ref_avg * 100.0

        # Assign back to ORM model (as Decimal-compatible values).
        def _as_decimal(v: float | None) -> Decimal | None:
            if v is None:
                return None
            try:
                return Decimal(str(round(v, 2)))
            except Exception:
                return None

        u.local_price_diff_500m = _as_decimal(diffs[500.0])
        u.local_price_diff_1000m = _as_decimal(diffs[1000.0])
        u.local_price_diff_2000m = _as_decimal(diffs[2000.0])

    db.flush()


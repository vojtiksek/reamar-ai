from __future__ import annotations

from decimal import Decimal
from typing import Iterable, Sequence

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

        # Effective values from unit_to_response_dict
        prices = [d.get("price_czk") for d in unit_dicts if d.get("price_czk") is not None]
        prices_per_m2 = [
            d.get("price_per_m2_czk") for d in unit_dicts if d.get("price_per_m2_czk") is not None
        ]
        areas = [d.get("floor_area_m2") for d in unit_dicts if d.get("floor_area_m2") is not None]
        available_units = sum(1 for d in unit_dicts if bool(d.get("available")))

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
        db.merge(agg)

    db.flush()


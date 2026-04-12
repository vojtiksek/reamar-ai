#!/usr/bin/env python3
"""Persist parsed unit-card data into the ``unit_scrape_enrichment`` table.

Milestone 3 of the scraping pipeline. Combines:

    scrape_units.discover_units / fetch_unit_detail  →  raw HTML
    parse_units.parse_unit_html                       →  ParsedUnit
    persist_scrape.upsert_enrichment_for_unit_url     →  DB row

Matching rules (strict, never fuzzy):

    * ``unit_url`` is the primary matching key.
    * Looks for an existing ``Unit`` with ``units.url = :unit_url``.
    * Exactly 1 match  → upsert (unique by ``unit_id``) and return OK.
    * 0 matches        → report ``no_unit_match`` and DO NOT create a row.
    * >1 matches       → report ``ambiguous_unit_match``, skip, log each id.

Auditability:
    * Full parsed dict stored verbatim in ``parsed_json``.
    * ``first_parsed_at`` preserved on update; ``last_parsed_at`` bumped.
    * ``parse_run_count`` increments on every successful upsert.
    * Failed scrapes/parses are surfaced in stdout and the return payload,
      and (when a unit match exists) can still be persisted with a non-OK
      ``scrape_status`` / ``parse_status`` + ``error`` message so the broker
      can see what happened.

Non-goals (milestone 3):
    * No mass scraping — each invocation is one project or one unit.
    * No DB writes for units that don't match by URL.
    * No fuzzy name matching.
    * No PDF / SVG handling (parser short-circuits those cleanly).

Usage (from ``backend/`` with venv active):

    # Persist enrichment for ONE unit URL
    python -m app.persist_scrape \\
        --unit-url "https://www.city-home.cz/.../byt-a24"

    # Persist enrichment for the first N discovered units of a project
    python -m app.persist_scrape \\
        --project-url "https://www.city-home.cz/.../nabidka-nemovitosti1" \\
        --fetch 5

    # Dry-run: fetch + parse + match + print what *would* be written, no commit
    python -m app.persist_scrape --unit-url "..." --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Unit, UnitScrapeEnrichment
from .parse_units import ParsedUnit, parse_unit_html
from .scrape_units import (
    DiscoveredUnit,
    FetchResult,
    _make_session,
    discover_units,
    fetch_unit_detail,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Matching
# --------------------------------------------------------------------------- #

@dataclass
class MatchResult:
    outcome: str  # "matched" | "no_unit_match" | "ambiguous_unit_match"
    unit_ids: list[int]
    unit_url: str

    @property
    def ok(self) -> bool:
        return self.outcome == "matched"


def find_unit_by_url(db: Session, unit_url: str) -> MatchResult:
    """Strict, URL-only unit match.

    Returns a :class:`MatchResult` whose ``outcome`` is one of
    ``"matched"``, ``"no_unit_match"``, ``"ambiguous_unit_match"``.
    Never falls back to name-based matching.
    """
    if not unit_url:
        return MatchResult(outcome="no_unit_match", unit_ids=[], unit_url=unit_url)
    rows = db.execute(
        select(Unit.id).where(Unit.url == unit_url)
    ).all()
    ids = [r[0] for r in rows]
    if len(ids) == 1:
        return MatchResult(outcome="matched", unit_ids=ids, unit_url=unit_url)
    if len(ids) == 0:
        return MatchResult(outcome="no_unit_match", unit_ids=[], unit_url=unit_url)
    return MatchResult(outcome="ambiguous_unit_match", unit_ids=ids, unit_url=unit_url)


# --------------------------------------------------------------------------- #
# Scrape + parse wrapper
# --------------------------------------------------------------------------- #

@dataclass
class ScrapeParseResult:
    """What the scrape + parse pipeline produced for a single unit URL."""
    unit_url: str
    fetch: FetchResult
    parsed: ParsedUnit
    scrape_status: str
    parse_status: str
    error: str | None


def scrape_and_parse_unit(
    unit_url: str,
    *,
    session,
    allow_playwright: bool = True,
) -> ScrapeParseResult:
    """Run the full scrape + parse pipeline for a single unit URL.

    Never raises: any error is returned as a :class:`ScrapeParseResult` with
    a non-OK ``scrape_status`` or ``parse_status``.
    """
    fetch_result = fetch_unit_detail(
        unit_url,
        session=session,
        allow_playwright=allow_playwright,
    )

    error: str | None = fetch_result.error
    if not fetch_result.ok or not fetch_result.html:
        scrape_status = "fetch_failed"
        parsed = parse_unit_html("", unit_url=unit_url)
        return ScrapeParseResult(
            unit_url=unit_url,
            fetch=fetch_result,
            parsed=parsed,
            scrape_status=scrape_status,
            parse_status="no_html",
            error=error,
        )

    parsed = parse_unit_html(fetch_result.html, unit_url=unit_url)

    # Derive status codes
    if parsed.content_type == "pdf":
        scrape_status = "ok"
        parse_status = "pdf_skipped"
    elif parsed.content_type == "unknown":
        scrape_status = "ok"
        parse_status = "empty"
    elif not parsed.room_areas and not parsed.raw_label_value_pairs:
        scrape_status = "ok"
        parse_status = "empty"
    elif not parsed.room_areas:
        scrape_status = "ok"
        parse_status = "no_room_data"
    else:
        scrape_status = "ok"
        parse_status = "ok"

    return ScrapeParseResult(
        unit_url=unit_url,
        fetch=fetch_result,
        parsed=parsed,
        scrape_status=scrape_status,
        parse_status=parse_status,
        error=error,
    )


# --------------------------------------------------------------------------- #
# Upsert
# --------------------------------------------------------------------------- #

def _to_decimal(value: float | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _extracted_fields(parsed: ParsedUnit) -> dict:
    return {
        "scraped_layout": parsed.layout,
        "scraped_total_area_m2": _to_decimal(parsed.total_area_m2),
        "has_pantry": parsed.has_pantry,
        "has_wardrobe": parsed.has_wardrobe,
        "has_cellar": parsed.has_cellar,
        "outdoor_kind": parsed.outdoor_kind,
        "outdoor_area_m2": _to_decimal(parsed.outdoor_area_m2),
    }


@dataclass
class PersistOutcome:
    unit_url: str
    outcome: str          # "created" | "updated" | "skipped_no_match"
                          # | "skipped_ambiguous_match" | "dry_run" | "error"
    unit_id: int | None
    enrichment_id: int | None
    scrape_status: str
    parse_status: str
    match_result: MatchResult
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "unit_url": self.unit_url,
            "outcome": self.outcome,
            "unit_id": self.unit_id,
            "enrichment_id": self.enrichment_id,
            "scrape_status": self.scrape_status,
            "parse_status": self.parse_status,
            "match_outcome": self.match_result.outcome,
            "match_unit_ids": self.match_result.unit_ids,
            "error": self.error,
        }


def upsert_enrichment_for_unit_url(
    db: Session,
    sp: ScrapeParseResult,
    *,
    dry_run: bool = False,
) -> PersistOutcome:
    """Persist (or update) a ``unit_scrape_enrichment`` row for ``sp``.

    Returns a :class:`PersistOutcome` describing exactly what happened.
    When ``dry_run`` is True, does NOT commit — outcome will be ``"dry_run"``.
    """
    match = find_unit_by_url(db, sp.unit_url)

    if match.outcome == "no_unit_match":
        logger.warning(
            "no_unit_match: URL has no matching Unit in DB — NOT persisting: %s",
            sp.unit_url,
        )
        return PersistOutcome(
            unit_url=sp.unit_url,
            outcome="skipped_no_match",
            unit_id=None,
            enrichment_id=None,
            scrape_status=sp.scrape_status,
            parse_status=sp.parse_status,
            match_result=match,
            error="no Unit with matching url",
        )

    if match.outcome == "ambiguous_unit_match":
        logger.warning(
            "ambiguous_unit_match: URL matches multiple Units %s — NOT persisting: %s",
            match.unit_ids,
            sp.unit_url,
        )
        return PersistOutcome(
            unit_url=sp.unit_url,
            outcome="skipped_ambiguous_match",
            unit_id=None,
            enrichment_id=None,
            scrape_status=sp.scrape_status,
            parse_status=sp.parse_status,
            match_result=match,
            error=f"multiple Units match url: {match.unit_ids}",
        )

    unit_id = match.unit_ids[0]

    existing = db.execute(
        select(UnitScrapeEnrichment).where(UnitScrapeEnrichment.unit_id == unit_id)
    ).scalar_one_or_none()

    parsed_json = sp.parsed.to_dict()
    extracted = _extracted_fields(sp.parsed)

    now = datetime.now(timezone.utc)
    created = False

    if existing is None:
        row = UnitScrapeEnrichment(
            unit_id=unit_id,
            unit_url=sp.unit_url,
            scrape_status=sp.scrape_status,
            fetch_method=sp.fetch.method,
            fetch_status_code=sp.fetch.status,
            html_length=len(sp.fetch.html) if sp.fetch.html else None,
            parse_status=sp.parse_status,
            error=sp.error,
            first_parsed_at=now,
            last_parsed_at=now,
            parse_run_count=1,
            parsed_json=parsed_json,
            **extracted,
        )
        db.add(row)
        created = True
    else:
        existing.unit_url = sp.unit_url
        existing.scrape_status = sp.scrape_status
        existing.fetch_method = sp.fetch.method
        existing.fetch_status_code = sp.fetch.status
        existing.html_length = len(sp.fetch.html) if sp.fetch.html else None
        existing.parse_status = sp.parse_status
        existing.error = sp.error
        existing.last_parsed_at = now
        existing.parse_run_count = (existing.parse_run_count or 0) + 1
        existing.parsed_json = parsed_json
        for k, v in extracted.items():
            setattr(existing, k, v)
        row = existing

    if dry_run:
        logger.info("dry_run: not committing (%s)", sp.unit_url)
        db.expunge_all()
        return PersistOutcome(
            unit_url=sp.unit_url,
            outcome="dry_run",
            unit_id=unit_id,
            enrichment_id=None,
            scrape_status=sp.scrape_status,
            parse_status=sp.parse_status,
            match_result=match,
            error=sp.error,
        )

    db.flush()  # populate row.id
    db.commit()

    return PersistOutcome(
        unit_url=sp.unit_url,
        outcome="created" if created else "updated",
        unit_id=unit_id,
        enrichment_id=row.id,
        scrape_status=sp.scrape_status,
        parse_status=sp.parse_status,
        match_result=match,
        error=sp.error,
    )


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def persist_one_unit_url(
    db: Session,
    unit_url: str,
    *,
    http_session,
    allow_playwright: bool = True,
    dry_run: bool = False,
) -> PersistOutcome:
    sp = scrape_and_parse_unit(
        unit_url,
        session=http_session,
        allow_playwright=allow_playwright,
    )
    return upsert_enrichment_for_unit_url(db, sp, dry_run=dry_run)


def persist_units_from_project_url(
    db: Session,
    project_url: str,
    *,
    fetch_limit: int,
    allow_playwright: bool = True,
    dry_run: bool = False,
) -> list[PersistOutcome]:
    http_session = _make_session()
    discovery = discover_units(
        project_url,
        allow_playwright=allow_playwright,
        session=http_session,
    )
    if not discovery.unit_urls:
        logger.warning(
            "discovery found no unit URLs under %s (errors=%s)",
            project_url,
            discovery.errors,
        )
        return []

    outcomes: list[PersistOutcome] = []
    for unit in discovery.unit_urls[:fetch_limit]:
        outcome = persist_one_unit_url(
            db,
            unit.url,
            http_session=http_session,
            allow_playwright=allow_playwright,
            dry_run=dry_run,
        )
        outcomes.append(outcome)
    return outcomes


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _print_outcome(o: PersistOutcome) -> None:
    label = {
        "created": "CREATED",
        "updated": "UPDATED",
        "dry_run": "DRY-RUN",
        "skipped_no_match": "NO MATCH",
        "skipped_ambiguous_match": "AMBIGUOUS",
        "error": "ERROR",
    }.get(o.outcome, o.outcome.upper())
    print(
        f"  [{label:9}] unit_id={o.unit_id} "
        f"enrichment_id={o.enrichment_id} "
        f"scrape={o.scrape_status} parse={o.parse_status}  "
        f"{o.unit_url}"
    )
    if o.match_result.outcome == "ambiguous_unit_match":
        print(f"           ! matched unit ids: {o.match_result.unit_ids}")
    if o.error:
        print(f"           ! error: {o.error}")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch + parse + persist parsed unit-card data into "
            "unit_scrape_enrichment. Strict unit_url matching."
        )
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--unit-url", help="Single unit URL to persist.")
    src.add_argument(
        "--project-url",
        help="Project URL — discover first N units and persist each.",
    )
    parser.add_argument(
        "--fetch",
        type=int,
        default=5,
        help="Max units to fetch/persist when using --project-url (default 5).",
    )
    parser.add_argument(
        "--no-playwright",
        action="store_true",
        help="Disable Playwright fallback in scraper.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do everything except commit. Prints what would be written.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON summary.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    db = SessionLocal()
    outcomes: list[PersistOutcome] = []
    try:
        if args.unit_url:
            http_session = _make_session()
            outcomes.append(
                persist_one_unit_url(
                    db,
                    args.unit_url,
                    http_session=http_session,
                    allow_playwright=not args.no_playwright,
                    dry_run=args.dry_run,
                )
            )
        else:
            outcomes.extend(
                persist_units_from_project_url(
                    db,
                    args.project_url,
                    fetch_limit=args.fetch,
                    allow_playwright=not args.no_playwright,
                    dry_run=args.dry_run,
                )
            )
    finally:
        db.close()

    if args.json:
        print(json.dumps([o.to_dict() for o in outcomes], indent=2, ensure_ascii=False))
    else:
        if not outcomes:
            print("No outcomes — discovery returned zero unit URLs.")
        else:
            print(f"Persist summary ({len(outcomes)} unit(s)):")
            for o in outcomes:
                _print_outcome(o)

    # Exit non-zero if nothing was actually persisted (useful for CI / scripts)
    any_ok = any(o.outcome in ("created", "updated", "dry_run") for o in outcomes)
    return 0 if any_ok else 6


if __name__ == "__main__":
    sys.exit(main())

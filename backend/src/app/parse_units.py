#!/usr/bin/env python3
"""Unit-card HTML parser (scraping milestone 2).

Takes a fetched unit-detail HTML page (from ``app.scrape_units``) and extracts
a first pass of structured attributes that matter for broker decisions:

    * title / layout / total area
    * a room-by-room area list, each classified into a canonical kind
      (living_room, bedroom, kitchen, bathroom, wc, hallway, pantry,
      wardrobe, cellar, balcony, terrace, loggia, garden)
    * boolean presence flags for pantry / wardrobe / cellar
    * the first sensible outdoor area (balkon / terasa / lodžie / zahrada)
    * a dump of the raw label→value pairs we found so failures can be audited

Explicit non-goals:
    * no DB writes — this is a parsing milestone, not an import milestone
    * no full schema normalization
    * no PDF/OCR pipeline (PDFs are detected and skipped cleanly)
    * no per-provider adapters — single generic heuristic layer

Usage (from ``backend/`` with venv active):

    # Parse a single URL (fetches via scrape_units.fetch_unit_detail)
    python -m app.parse_units --unit-url "https://.../byt-a24"

    # Parse a previously-saved HTML file
    python -m app.parse_units --html-file data/scrape/city-home-cz/002_byt-a24.html

    # End-to-end: discover + fetch + parse first N units of a project
    python -m app.parse_units \\
        --project-url "https://www.city-home.cz/.../nabidka-nemovitosti1" \\
        --fetch 3 --out data/scrape --json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .scrape_units import (
    _host,
    _make_session,
    _slugify,
    discover_units,
    fetch_unit_detail,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Canonical room kinds + keyword buckets
# --------------------------------------------------------------------------- #

# Keyword lists are matched against accent-stripped, lower-cased labels so
# "Obývací pokoj" and "obyvaci pokoj" both hit the same bucket.
# ORDER MATTERS: more specific patterns first — e.g. "obyvaci pokoj" must win
# over a bare "pokoj" which is classified as bedroom.
ROOM_KIND_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("living_room", ("obyvaci pokoj", "obyvak", "living room", "living-room")),
    ("kitchen", ("kuchyne", "kuchyn", "kitchen", "kk ", " kk", "kuchynsky kout")),
    ("bathroom", ("koupelna", "bathroom")),
    ("wc", ("wc", "toaleta", "toilet")),
    ("hallway", ("chodba", "predsin", "hall", "vstup")),
    ("pantry", ("komora", "spiz", "pantry", "storage room", "ulozna")),
    ("wardrobe", ("satna", "wardrobe", "walk-in closet", "walk in closet", "satnik")),
    ("cellar", ("sklep", "sklepni", "sklepni koje", "pivnice", "cellar", "storage unit")),
    ("balcony", ("balkon", "balcony")),
    ("terrace", ("terasa", "terrace")),
    ("loggia", ("lodzie", "lodzia", "loggia")),
    ("garden", ("zahrada", "predzahradka", "garden")),
    # Bedroom LAST so "obyvaci pokoj" doesn't fall through into bedroom.
    ("bedroom", ("loznice", "bedroom", "pokoj")),
]

# Labels that look room-like but are actually meta rows — we still expose them
# in raw_label_value_pairs but don't treat them as rooms.
META_LABEL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*(celkov[aá]|ob[yi]tn[aá]|uzitn[aá]|podlahov[aá]|plocha)\b"),
    re.compile(r"pricky|sloupy|sachty"),  # "Příčky, sloupy a šachty"
    re.compile(r"^\s*dispozice\s*$"),
)

# Inside room labels we want to drop a leading order number like "01 Chodba".
ROOM_LABEL_PREFIX_RE = re.compile(r"^\s*\d{1,3}[.)\s]+")

# Area value: "44 m²", "4.4 m 2", "12,1 m2", "28,4 m^2".
AREA_VALUE_RE = re.compile(
    r"(?P<num>\d{1,4}(?:[.,]\d{1,3})?)\s*m\s*(?:²|2|\^2)\b",
    re.IGNORECASE,
)

# Price value (bonus, only used when a label screams "cena"/"price"):
PRICE_VALUE_RE = re.compile(r"(\d[\d\s]{2,})\s*(?:kč|czk|,-)", re.IGNORECASE)

# Layout value: "2+kk", "3 + 1", "1+1", "4 + kk"
LAYOUT_VALUE_RE = re.compile(r"\b(\d\s*\+\s*(?:kk|\d|1))\b", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def _norm(s: str) -> str:
    """Accent-stripped, whitespace-collapsed, lower-case form of *s*."""
    s = _strip_accents(s or "")
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _clean_room_label(label: str) -> str:
    return ROOM_LABEL_PREFIX_RE.sub("", (label or "").strip()).strip()


def _is_meta_label(label: str) -> bool:
    norm = _norm(label)
    if any(p.search(norm) for p in META_LABEL_PATTERNS):
        return True
    # A bare disposition string like "2+kk" or "3+1" is not a room name.
    if LAYOUT_VALUE_RE.fullmatch(norm.replace(" ", "")):
        return True
    return False


def _parse_area_m2(value: str) -> float | None:
    """Extract the first numeric area in m² from *value*. ``None`` on failure."""
    if not value:
        return None
    # Replace non-breaking spaces with regular spaces before matching.
    v = value.replace("\xa0", " ")
    m = AREA_VALUE_RE.search(v)
    if not m:
        return None
    num = m.group("num").replace(",", ".")
    try:
        out = float(num)
    except ValueError:
        return None
    # Filter implausible values — > 2000 m² is never a single room area on a card.
    if out < 0 or out > 2000:
        return None
    return out


def _classify_room(label: str) -> str | None:
    norm = " " + _norm(label) + " "
    for kind, keywords in ROOM_KIND_RULES:
        for kw in keywords:
            needle = " " + kw.strip() + " "
            # Substring match, accent-insensitive.
            if needle.strip() in norm:
                return kind
    return None


# --------------------------------------------------------------------------- #
# Structured output types
# --------------------------------------------------------------------------- #

@dataclass
class RoomArea:
    raw_label: str
    label: str
    kind: str | None
    area_m2: float | None
    raw_value: str
    source: str  # "table" | "dl" | "li" | "text"


@dataclass
class LabelValuePair:
    label: str
    value: str
    source: str  # "table" | "dl" | "li" | "text"


@dataclass
class ParsedUnit:
    unit_url: str
    title: str | None
    content_type: str  # "html" | "pdf" | "unknown"
    layout: str | None
    total_area_m2: float | None
    room_areas: list[RoomArea]
    has_pantry: bool | None
    has_wardrobe: bool | None
    has_cellar: bool | None
    outdoor_kind: str | None
    outdoor_area_m2: float | None
    all_outdoor_areas: list[RoomArea]
    raw_label_value_pairs: list[LabelValuePair]
    raw_features: list[str]
    raw_text_excerpt: str | None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "unit_url": self.unit_url,
            "title": self.title,
            "content_type": self.content_type,
            "layout": self.layout,
            "total_area_m2": self.total_area_m2,
            "room_areas": [asdict(r) for r in self.room_areas],
            "has_pantry": self.has_pantry,
            "has_wardrobe": self.has_wardrobe,
            "has_cellar": self.has_cellar,
            "outdoor_kind": self.outdoor_kind,
            "outdoor_area_m2": self.outdoor_area_m2,
            "all_outdoor_areas": [asdict(r) for r in self.all_outdoor_areas],
            "raw_label_value_pairs": [asdict(p) for p in self.raw_label_value_pairs],
            "raw_features": list(self.raw_features),
            "raw_text_excerpt": self.raw_text_excerpt,
            "notes": list(self.notes),
        }


# --------------------------------------------------------------------------- #
# Label→value extraction from HTML
# --------------------------------------------------------------------------- #

def _text(el) -> str:
    return " ".join((el.get_text(" ", strip=True) or "").split())


def _extract_pairs_from_tables(soup: BeautifulSoup) -> list[LabelValuePair]:
    """Collect label→value pairs from HTML tables.

    Two shapes are handled:

    1. *Narrow* tables (2 columns or the first cell is a <th>) — classic
       label/value rows. Emitted as ``(first_cell, last_cell)``.

    2. *Wide* tables (multi-column data rows under a header row) — for each
       data row we emit one pair per header cell, so ``dispozice | plocha |
       ...`` + ``2+kk | 51 m² | ...`` yields ``(dispozice, 2+kk)``,
       ``(plocha, 51 m²)`` and so on.
    """
    out: list[LabelValuePair] = []
    for tab in soup.find_all("table"):
        rows = tab.find_all("tr")
        if not rows:
            continue

        # Detect a header row: first row where every cell is a <th>.
        headers: list[str] | None = None
        header_row_idx: int | None = None
        for idx, tr in enumerate(rows[:3]):
            cells = tr.find_all(["td", "th"])
            if cells and all(c.name == "th" for c in cells):
                headers = [_text(c) for c in cells]
                header_row_idx = idx
                break

        for idx, tr in enumerate(rows):
            if idx == header_row_idx:
                continue
            cells = tr.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            # Header-mapped table row: if we spotted a <th> header row above,
            # prefer pairing each cell to its column header. Applies to both
            # 2-column header tables (dispozice | plocha) and wider ones.
            if headers and len(headers) == len(cells):
                for header, cell in zip(headers, cells):
                    if not header:
                        continue
                    out.append(
                        LabelValuePair(
                            label=header,
                            value=_text(cell),
                            source="table",
                        )
                    )
                continue
            # Narrow label/value row fallback (first vs last cell)
            label = _text(cells[0])
            value = _text(cells[-1])
            if not label:
                continue
            out.append(LabelValuePair(label=label, value=value, source="table"))
    return out


def _extract_pairs_from_dls(soup: BeautifulSoup) -> list[LabelValuePair]:
    out: list[LabelValuePair] = []
    for dl in soup.find_all("dl"):
        dts = dl.find_all("dt")
        dds = dl.find_all("dd")
        for dt, dd in zip(dts, dds):
            label = _text(dt)
            value = _text(dd)
            if label:
                out.append(LabelValuePair(label=label, value=value, source="dl"))
    return out


_COLON_PAIR_RE = re.compile(r"^([^:–—]{1,60})[:–—]\s*(.{1,200})$")


def _extract_pairs_from_lists(soup: BeautifulSoup) -> list[LabelValuePair]:
    """Label: value pairs inside <li> bullets (common in feature lists)."""
    out: list[LabelValuePair] = []
    for li in soup.find_all("li"):
        text = _text(li)
        if not text or len(text) > 250:
            continue
        m = _COLON_PAIR_RE.match(text)
        if m:
            label = m.group(1).strip()
            value = m.group(2).strip()
            out.append(LabelValuePair(label=label, value=value, source="li"))
    return out


def _extract_raw_features(soup: BeautifulSoup) -> list[str]:
    """Short bullet-like strings that look like feature flags.

    These are <li> items that do NOT contain a colon/value — e.g. "Klimatizace",
    "Vestavěné skříně", "Parkovací stání v suterénu". Useful for the broker
    to scan features even when we can't pair them to values.
    """
    out: list[str] = []
    seen: set[str] = set()
    for li in soup.find_all("li"):
        text = _text(li)
        if not text:
            continue
        if len(text) > 120 or ":" in text or "–" in text or "—" in text:
            continue
        if re.search(r"\d", text):
            # Likely a value, not a boolean feature.
            continue
        if text in seen:
            continue
        seen.add(text)
        out.append(text)
        if len(out) >= 40:
            break
    return out


# --------------------------------------------------------------------------- #
# Fallback: text-based rescue when no structured pairs exist
# --------------------------------------------------------------------------- #

_TEXT_ROOM_RE = re.compile(
    r"(?P<label>"
    r"obývací\s+pokoj(?:\s*\+?\s*kk)?|obývák|ložnice|koupelna|kuchy(?:ně|ň)"
    r"|chodba|předsíň|wc|toaleta|komora|spíž|šatna|sklep|pivnice"
    r"|balkón|balkon|terasa|lodžie|zahrada|pokoj(?:\s*\d)?"
    r")"
    r"[^\n]{0,40}?"
    r"(?P<value>\d{1,3}(?:[.,]\d{1,2})?)\s*m\s*(?:²|2|\^2)\b",
    re.IGNORECASE,
)


def _extract_pairs_from_text(full_text: str) -> list[LabelValuePair]:
    """Last-resort regex rescue. Low confidence, tagged with source='text'."""
    out: list[LabelValuePair] = []
    for m in _TEXT_ROOM_RE.finditer(full_text):
        label = m.group("label").strip()
        value = f"{m.group('value')} m²"
        out.append(LabelValuePair(label=label, value=value, source="text"))
    return out


# --------------------------------------------------------------------------- #
# Main parse routine
# --------------------------------------------------------------------------- #

def _looks_like_pdf(html: str) -> bool:
    # scrape_units stores PDFs as text with the %PDF- header at offset 0.
    return bool(html) and html.lstrip()[:8].startswith("%PDF-")


def parse_unit_html(html: str, *, unit_url: str) -> ParsedUnit:
    """Parse a single unit-detail HTML blob into a :class:`ParsedUnit`."""
    notes: list[str] = []

    if html is None or not html.strip():
        return ParsedUnit(
            unit_url=unit_url,
            title=None,
            content_type="unknown",
            layout=None,
            total_area_m2=None,
            room_areas=[],
            has_pantry=None,
            has_wardrobe=None,
            has_cellar=None,
            outdoor_kind=None,
            outdoor_area_m2=None,
            all_outdoor_areas=[],
            raw_label_value_pairs=[],
            raw_features=[],
            raw_text_excerpt=None,
            notes=["empty html"],
        )

    if _looks_like_pdf(html):
        notes.append("content appears to be a PDF — skipping HTML parse (milestone 2 is HTML-only)")
        return ParsedUnit(
            unit_url=unit_url,
            title=None,
            content_type="pdf",
            layout=None,
            total_area_m2=None,
            room_areas=[],
            has_pantry=None,
            has_wardrobe=None,
            has_cellar=None,
            outdoor_kind=None,
            outdoor_area_m2=None,
            all_outdoor_areas=[],
            raw_label_value_pairs=[],
            raw_features=[],
            raw_text_excerpt=None,
            notes=notes,
        )

    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()

    title = _text(soup.title) if soup.title else None

    # --- 1) Structured label→value pairs (table / dl / li)
    pairs: list[LabelValuePair] = []
    pairs.extend(_extract_pairs_from_tables(soup))
    pairs.extend(_extract_pairs_from_dls(soup))
    pairs.extend(_extract_pairs_from_lists(soup))

    # --- 2) Text-fallback if nothing structured found
    full_text = soup.get_text("\n", strip=True)
    if not pairs:
        fallback = _extract_pairs_from_text(full_text)
        if fallback:
            notes.append(f"fallback: text-regex extracted {len(fallback)} pairs (low confidence)")
            pairs.extend(fallback)

    # --- 3) Derive layout + total area from label→value pairs
    layout: str | None = None
    total_area_m2: float | None = None
    for p in pairs:
        norm_label = _norm(p.label)
        if layout is None and ("dispozice" in norm_label or norm_label == "layout"):
            m = LAYOUT_VALUE_RE.search(p.value or "")
            if m:
                layout = re.sub(r"\s+", "", m.group(1)).lower()
        if total_area_m2 is None and re.search(r"\b(celkova|obytna|uzitna|plocha)\b", norm_label):
            total_area_m2 = _parse_area_m2(p.value)
    if layout is None:
        # Try any value cell (dispositions like "2+kk" often appear bare)
        for p in pairs:
            m = LAYOUT_VALUE_RE.search(p.value or "")
            if m:
                layout = re.sub(r"\s+", "", m.group(1)).lower()
                break

    # --- 4) Build room_areas: every pair whose label looks like a room AND
    #        whose value has an m² number.
    room_areas: list[RoomArea] = []
    for p in pairs:
        if _is_meta_label(p.label):
            continue
        area = _parse_area_m2(p.value)
        if area is None:
            continue
        cleaned_label = _clean_room_label(p.label)
        kind = _classify_room(cleaned_label) or _classify_room(p.label)
        if kind is None:
            # Not a recognizable room — skip (but it stays in raw pairs).
            continue
        room_areas.append(
            RoomArea(
                raw_label=p.label,
                label=cleaned_label or p.label,
                kind=kind,
                area_m2=area,
                raw_value=p.value,
                source=p.source,
            )
        )

    # --- 5) Presence flags
    kinds_seen = {r.kind for r in room_areas}
    have_room_data = bool(room_areas)

    def _flag(kind: str) -> bool | None:
        if not have_room_data:
            return None
        return kind in kinds_seen

    has_pantry = _flag("pantry")
    has_wardrobe = _flag("wardrobe")
    has_cellar = _flag("cellar")

    # If we didn't find a structured room list, try a softer text scan for the
    # flags so we can still give the broker a "yes/no" when text mentions it.
    if not have_room_data:
        norm_text = _norm(full_text)
        if any(kw in norm_text for kw in ("komora", "spiz", "pantry")):
            has_pantry = True
            notes.append("has_pantry inferred from free-text (low confidence)")
        if any(kw in norm_text for kw in ("satna", "wardrobe", "walk-in closet")):
            has_wardrobe = True
            notes.append("has_wardrobe inferred from free-text (low confidence)")
        if any(kw in norm_text for kw in ("sklep", "cellar", "pivnice")):
            has_cellar = True
            notes.append("has_cellar inferred from free-text (low confidence)")

    # --- 6) Outdoor area: first sensible hit among balcony/terrace/loggia/garden.
    outdoor_priority = ("terrace", "balcony", "loggia", "garden")
    all_outdoor = [r for r in room_areas if r.kind in outdoor_priority]
    outdoor_kind: str | None = None
    outdoor_area_m2: float | None = None
    for kind in outdoor_priority:
        match = [r for r in all_outdoor if r.kind == kind and r.area_m2]
        if match:
            # Largest among same-kind (some cards list multiple balconies)
            best = max(match, key=lambda r: r.area_m2 or 0)
            outdoor_kind = kind
            outdoor_area_m2 = best.area_m2
            break

    # --- 7) Feature flag bullets (useful for broker scan even if we can't parse values)
    raw_features = _extract_raw_features(soup)

    excerpt = full_text[:1200] if full_text else None

    return ParsedUnit(
        unit_url=unit_url,
        title=title,
        content_type="html",
        layout=layout,
        total_area_m2=total_area_m2,
        room_areas=room_areas,
        has_pantry=has_pantry,
        has_wardrobe=has_wardrobe,
        has_cellar=has_cellar,
        outdoor_kind=outdoor_kind,
        outdoor_area_m2=outdoor_area_m2,
        all_outdoor_areas=all_outdoor,
        raw_label_value_pairs=pairs,
        raw_features=raw_features,
        raw_text_excerpt=excerpt,
        notes=notes,
    )


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _print_text_report(parsed: ParsedUnit) -> None:
    print("=" * 72)
    print(f"Unit URL:       {parsed.unit_url}")
    print(f"Title:          {parsed.title}")
    print(f"Content type:   {parsed.content_type}")
    print(f"Layout:         {parsed.layout}")
    print(f"Total area m²:  {parsed.total_area_m2}")
    print(
        f"Flags:          pantry={parsed.has_pantry}  "
        f"wardrobe={parsed.has_wardrobe}  cellar={parsed.has_cellar}"
    )
    if parsed.outdoor_kind:
        print(f"Outdoor:        {parsed.outdoor_kind} — {parsed.outdoor_area_m2} m²")
    else:
        print("Outdoor:        (none found)")

    print()
    print(f"Room areas ({len(parsed.room_areas)}):")
    for r in parsed.room_areas:
        print(
            f"  - [{r.kind or '?':<11}] {r.label:<30} "
            f"{r.area_m2 if r.area_m2 is not None else '?':>6} m²   "
            f"(raw={r.raw_label!r} / {r.raw_value!r}, {r.source})"
        )

    if parsed.raw_features:
        print()
        print(f"Raw features ({len(parsed.raw_features)}):")
        for f in parsed.raw_features[:15]:
            print(f"  • {f}")
        if len(parsed.raw_features) > 15:
            print(f"  … (+{len(parsed.raw_features) - 15} more)")

    if parsed.notes:
        print()
        print("Notes:")
        for n in parsed.notes:
            print(f"  ! {n}")

    print()
    print(
        f"Raw label→value pairs extracted: {len(parsed.raw_label_value_pairs)} "
        f"(source mix: "
        + ", ".join(
            f"{src}={sum(1 for p in parsed.raw_label_value_pairs if p.source == src)}"
            for src in ("table", "dl", "li", "text")
        )
        + ")"
    )
    print("=" * 72)


def _resolve_inputs(args: argparse.Namespace) -> list[tuple[str, str]]:
    """Return ``[(unit_url, html), ...]`` for whatever the CLI was given."""
    items: list[tuple[str, str]] = []

    if args.html_file:
        for path in args.html_file:
            p = Path(path)
            html = p.read_text(encoding="utf-8", errors="replace")
            items.append((args.unit_url or f"file://{p.resolve()}", html))
        return items

    if args.unit_url:
        session = _make_session()
        result = fetch_unit_detail(
            args.unit_url,
            session=session,
            allow_playwright=not args.no_playwright,
        )
        if not result.html:
            print(f"ERROR: fetch failed for {args.unit_url}: {result.error}", file=sys.stderr)
            sys.exit(3)
        items.append((args.unit_url, result.html))
        return items

    if args.project_url:
        session = _make_session()
        discovery = discover_units(
            args.project_url,
            allow_playwright=not args.no_playwright,
            session=session,
        )
        if not discovery.unit_urls:
            print(
                f"ERROR: discovery found no unit URLs under {args.project_url}",
                file=sys.stderr,
            )
            for e in discovery.errors:
                print(f"  ! {e}", file=sys.stderr)
            sys.exit(4)
        for unit in discovery.unit_urls[: args.fetch]:
            result = fetch_unit_detail(
                unit.url,
                session=session,
                allow_playwright=not args.no_playwright,
            )
            if result.html:
                items.append((unit.url, result.html))
            else:
                print(f"WARN: fetch failed for {unit.url}: {result.error}", file=sys.stderr)
        return items

    print("ERROR: specify one of --unit-url, --html-file, or --project-url", file=sys.stderr)
    sys.exit(2)


def _save_parsed(parsed: ParsedUnit, out_dir: Path, idx: int) -> Path:
    host = _host(parsed.unit_url) or "unit"
    dir_path = out_dir / _slugify(host)
    dir_path.mkdir(parents=True, exist_ok=True)
    last = urlparse(parsed.unit_url).path.rstrip("/").rsplit("/", 1)[-1] or "unit"
    filename = f"{idx:03d}_{_slugify(last)}.parsed.json"
    path = dir_path / filename
    path.write_text(
        json.dumps(parsed.to_dict(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Parse a fetched unit-detail HTML page into structured fields "
            "(room areas, pantry/wardrobe/cellar flags, outdoor area). "
            "Read-only — no DB writes."
        )
    )
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--unit-url", help="Unit detail URL to fetch + parse.")
    src.add_argument(
        "--html-file",
        nargs="+",
        help="Path(s) to previously-saved unit HTML files to parse offline.",
    )
    src.add_argument(
        "--project-url",
        help="Project URL — discover units, fetch first N, parse each.",
    )
    parser.add_argument(
        "--fetch",
        type=int,
        default=3,
        help="How many discovered units to fetch when using --project-url (default 3).",
    )
    parser.add_argument(
        "--no-playwright",
        action="store_true",
        help="Disable Playwright fallback during discovery/fetch.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    parser.add_argument(
        "--out",
        default=None,
        help="Directory to save <host>/<file>.parsed.json files for inspection.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    inputs = _resolve_inputs(args)
    parsed_list = [parse_unit_html(html, unit_url=url) for url, html in inputs]

    out_dir = Path(args.out) if args.out else None
    saved: list[str] = []
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, parsed in enumerate(parsed_list, start=1):
            saved.append(str(_save_parsed(parsed, out_dir, i)))

    if args.json:
        print(
            json.dumps(
                {
                    "parsed": [p.to_dict() for p in parsed_list],
                    "saved_to": saved,
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        for p in parsed_list:
            _print_text_report(p)
        if saved:
            print()
            print("Saved parsed JSON files:")
            for s in saved:
                print(f"  - {s}")

    # Exit non-zero only if every parse was empty (unknown/pdf or no rooms + no pairs)
    useful = any(
        p.content_type == "html" and (p.room_areas or p.raw_label_value_pairs)
        for p in parsed_list
    )
    return 0 if useful else 5


if __name__ == "__main__":
    sys.exit(main())

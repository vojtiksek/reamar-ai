#!/usr/bin/env python3
"""Unit discovery + raw HTML fetch pipeline (milestone 1).

Two explicit stages:

    Stage A — discovery
        input:  a project homepage URL (as stored in Project.project_url)
        output: candidate listing / price-list URLs + a list of unit detail URLs

    Stage B — detail fetch
        input:  a unit detail URL
        output: the raw HTML content + basic metadata (status, length, method)

Goals for this milestone:
  * reliable URL discovery + raw HTML fetch
  * no parsing of per-unit attributes (room sizes, pantry, etc.)
  * runnable from the CLI for a single project URL

Design notes:
  * Try lightweight requests + BeautifulSoup first (fast, cheap).
  * If the initial HTML yields nothing, fall back to Playwright (rendered JS).
  * Playwright is an optional dependency — imported lazily; missing install
    degrades gracefully with a clear error in the report.
  * Heuristics are deliberately generic: many different developer sites exist,
    and a shared first pass is more useful right now than per-provider adapters.

Usage (from backend dir, after `source .venv/bin/activate`):

    # Discovery + fetch first 3 unit pages, save raw HTML under backend/data/scrape/
    python -m app.scrape_units \
        --project-url "https://www.finep.cz/cs/byty-maly-haj-xi" \
        --fetch 3 \
        --save-dir backend/data/scrape

    # Discovery only, as JSON
    python -m app.scrape_units \
        --project-url "https://rezidencesobin.cz/" --fetch 0 --json

    # Skip Playwright even if installed
    python -m app.scrape_units \
        --project-url "https://example.cz/" --no-playwright
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0 Safari/537.36 ReamarScraper/0.1"
)
DEFAULT_TIMEOUT = 20

# Keywords suggesting a URL/link text points at a listing / price-list page.
# Czech first (this is the primary market), English as a safety net.
LISTING_KEYWORDS: tuple[str, ...] = (
    "nabidka", "nabídka", "nabídku",
    "byty", "byty-na-prodej", "byty-k-prodeji",
    "cenik", "ceník", "cenik-bytu", "ceník-bytů",
    "ceny", "ceny-bytu", "ceny-bytů",
    "volne-byty", "volné-byty", "dostupnost", "dostupné",
    "dispozice", "seznam",
    "prodej", "nemovitosti",
    "apartments", "units", "pricelist", "price-list",
    "flats", "available",
)

# Patterns suggesting a URL path segment points at a SINGLE unit detail page.
# Must be anchored at a path/segment boundary AND contain a digit close to the
# keyword root — this rejects marketing/plural forms like "flats-maly-haj" or
# "byty-harfa-park" while still matching "byt-12", "byt-a1-04", "apartment-3b".
UNIT_PATH_RE = re.compile(
    r"(?:^|[/_\-])"
    r"(?:"
    r"byt(?:[-_][a-z]?\d[\w\-.]*|\d[\w\-.]*)"
    r"|apartment(?:[-_][a-z]?\d[\w\-.]*|\d[\w\-.]*)"
    r"|unit(?:[-_][a-z]?\d[\w\-.]*|\d[\w\-.]*)"
    r"|flat(?:[-_][a-z]?\d[\w\-.]*|\d[\w\-.]*)"
    r"|jednotka[-_]?[a-z]?\d[\w\-.]*"
    r"|dum[-_]?[a-z]?\d[\w\-.]*"
    r"|rd[-_]?\d[\w\-.]*"
    r")",
    re.IGNORECASE,
)

UNIT_QUERY_KEYS: tuple[str, ...] = (
    "unit", "unit_id", "unitid", "byt", "byt_id", "bytid", "apt", "apartment",
)

# Very short label like "A1", "1.04", "B.2.3" often means a unit cell link
UNIT_LABEL_RE = re.compile(r"^\s*[a-z]?\d{1,4}(?:[.\-]\d{1,4}){0,3}\s*$", re.IGNORECASE)

# Anchors / link text that are definitely NOT unit-like and we shouldn't
# waste the listing fallback on.
BORING_PATH_SEGMENTS: tuple[str, ...] = (
    "/kontakt", "/kontakty", "/contact", "/about",
    "/o-nas", "/o-spolecnosti", "/developer",
    "/novinky", "/blog", "/news",
    "/cookies", "/ochrana-osobnich-udaju", "/gdpr", "/privacy",
    "/obchodni-podminky", "/terms",
)


# --------------------------------------------------------------------------- #
# URL helpers
# --------------------------------------------------------------------------- #

def _normalize_url(base: str, href: str) -> str | None:
    if not href:
        return None
    href = href.strip()
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
        return None
    abs_url = urljoin(base, href)
    abs_url, _ = urldefrag(abs_url)
    return abs_url


def _host(url: str) -> str:
    h = (urlparse(url).hostname or "").lower()
    if h.startswith("www."):
        h = h[4:]
    return h


def _same_host(a: str, b: str) -> bool:
    ha, hb = _host(a), _host(b)
    if not ha or not hb:
        return False
    return ha == hb or ha.endswith("." + hb) or hb.endswith("." + ha)


def _is_boring(url: str) -> bool:
    path = unquote(urlparse(url).path).lower()
    return any(seg in path for seg in BORING_PATH_SEGMENTS)


def _looks_like_unit_url(url: str, text: str = "") -> bool:
    parsed = urlparse(url)
    path = unquote(parsed.path).lower()
    if UNIT_PATH_RE.search(path):
        return True
    qs = parsed.query.lower()
    for key in UNIT_QUERY_KEYS:
        if f"{key}=" in qs:
            return True
    if text and UNIT_LABEL_RE.match(text):
        return True
    return False


def _looks_like_listing_url(url: str, text: str) -> bool:
    combined = unquote(url).lower() + " " + (text or "").lower()
    return any(kw in combined for kw in LISTING_KEYWORDS)


# --------------------------------------------------------------------------- #
# Fetch primitives
# --------------------------------------------------------------------------- #

@dataclass
class FetchResult:
    url: str
    status: int | None
    ok: bool
    method: str  # "static" | "playwright"
    html: str | None
    error: str | None = None
    elapsed_ms: int | None = None

    @property
    def length(self) -> int:
        return len(self.html or "")


def _make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    return s


def fetch_static(
    url: str,
    *,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> FetchResult:
    sess = session or _make_session()
    start = time.time()
    try:
        resp = sess.get(url, timeout=timeout, allow_redirects=True)
        elapsed_ms = int((time.time() - start) * 1000)
        # Some sites return 200 with tiny body when they need JS; caller decides.
        return FetchResult(
            url=url,
            status=resp.status_code,
            ok=resp.ok,
            method="static",
            html=resp.text if resp.ok else None,
            elapsed_ms=elapsed_ms,
        )
    except requests.RequestException as exc:  # network / ssl / timeout
        return FetchResult(
            url=url,
            status=None,
            ok=False,
            method="static",
            html=None,
            error=str(exc),
            elapsed_ms=int((time.time() - start) * 1000),
        )


def fetch_playwright(
    url: str,
    *,
    wait_ms: int = 2000,
    timeout_ms: int = 30000,
) -> FetchResult:
    """Render *url* with headless Chromium via Playwright.

    Optional dependency: if Playwright is not installed we return a failed
    FetchResult with a clear error message. The static-only path keeps working.
    """
    start = time.time()
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError as exc:
        return FetchResult(
            url=url,
            status=None,
            ok=False,
            method="playwright",
            html=None,
            error=(
                f"playwright not installed ({exc}). "
                f"To enable JS rendering: pip install playwright && python -m playwright install chromium"
            ),
            elapsed_ms=int((time.time() - start) * 1000),
        )
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(
                    user_agent=DEFAULT_USER_AGENT,
                    locale="cs-CZ",
                )
                page = ctx.new_page()
                resp = page.goto(url, wait_until="networkidle", timeout=timeout_ms)
                page.wait_for_timeout(wait_ms)
                html = page.content()
                status = resp.status if resp else None
            finally:
                browser.close()
        return FetchResult(
            url=url,
            status=status,
            ok=bool(status and 200 <= status < 400),
            method="playwright",
            html=html,
            elapsed_ms=int((time.time() - start) * 1000),
        )
    except Exception as exc:  # noqa: BLE001 — surface playwright errors verbatim
        return FetchResult(
            url=url,
            status=None,
            ok=False,
            method="playwright",
            html=None,
            error=f"{type(exc).__name__}: {exc}",
            elapsed_ms=int((time.time() - start) * 1000),
        )


# --------------------------------------------------------------------------- #
# Link extraction / classification
# --------------------------------------------------------------------------- #

def extract_links(html: str, base_url: str) -> list[tuple[str, str]]:
    """Return list of (absolute_url, link_text) for all same-host anchors."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        abs_url = _normalize_url(base_url, a.get("href", ""))
        if not abs_url or not _same_host(abs_url, base_url):
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        text = " ".join(a.get_text(separator=" ", strip=True).split())
        out.append((abs_url, text[:200]))
    return out


@dataclass
class DiscoveredUnit:
    url: str
    label: str | None
    source_page: str
    method: str  # "static" | "playwright"


def classify_links(
    links: list[tuple[str, str]],
    source_page: str,
    *,
    method: str = "static",
) -> tuple[list[DiscoveredUnit], list[str]]:
    units: list[DiscoveredUnit] = []
    listing: list[str] = []
    seen_units: set[str] = set()
    seen_listing: set[str] = set()
    for url, text in links:
        if _is_boring(url):
            continue
        if _looks_like_unit_url(url, text):
            if url not in seen_units:
                seen_units.add(url)
                units.append(
                    DiscoveredUnit(
                        url=url,
                        label=text or None,
                        source_page=source_page,
                        method=method,
                    )
                )
        elif _looks_like_listing_url(url, text):
            if url not in seen_listing and url != source_page:
                seen_listing.add(url)
                listing.append(url)
    return units, listing


# --------------------------------------------------------------------------- #
# Stage A: discovery
# --------------------------------------------------------------------------- #

@dataclass
class DiscoveryResult:
    project_url: str
    listing_urls: list[str]
    unit_urls: list[DiscoveredUnit]
    used_playwright: bool
    pages_fetched: list[str]
    errors: list[str] = field(default_factory=list)


def discover_units(
    project_url: str,
    *,
    allow_playwright: bool = True,
    max_listing_pages: int = 3,
    session: requests.Session | None = None,
) -> DiscoveryResult:
    """Walk the project page (and a few listing candidates) to find unit URLs.

    Pipeline:
      1. Fetch `project_url` statically.
      2. Extract + classify same-host links into listing candidates and unit
         candidates.
      3. If no unit candidates, follow up to `max_listing_pages` listing
         candidates and repeat classification.
      4. If still nothing and Playwright is allowed, render the project page
         with headless Chromium and classify again.
    """
    sess = session or _make_session()
    pages_fetched: list[str] = []
    errors: list[str] = []

    project_fetch = fetch_static(project_url, session=sess)
    pages_fetched.append(project_url)
    if not project_fetch.ok or project_fetch.html is None:
        err = project_fetch.error or f"HTTP {project_fetch.status}"
        errors.append(f"fetch project_url failed: {err}")

    unit_urls: list[DiscoveredUnit] = []
    listing_urls: list[str] = []
    used_playwright = False

    if project_fetch.html:
        links = extract_links(project_fetch.html, project_url)
        u, l = classify_links(links, project_url, method="static")
        unit_urls.extend(u)
        listing_urls.extend(l)

    # Follow listing-candidate pages if we found no units on the homepage.
    if not unit_urls and listing_urls:
        visited = {project_url}
        for listing_url in listing_urls[:max_listing_pages]:
            if listing_url in visited:
                continue
            visited.add(listing_url)
            lf = fetch_static(listing_url, session=sess)
            pages_fetched.append(listing_url)
            if not lf.ok or not lf.html:
                if lf.error:
                    errors.append(f"fetch listing {listing_url} failed: {lf.error}")
                continue
            links = extract_links(lf.html, listing_url)
            more_units, more_listing = classify_links(links, listing_url, method="static")
            existing = {u.url for u in unit_urls}
            for u in more_units:
                if u.url not in existing:
                    existing.add(u.url)
                    unit_urls.append(u)
            for cand in more_listing:
                if cand not in listing_urls:
                    listing_urls.append(cand)

    # Playwright fallback for JS-only sites.
    if not unit_urls and allow_playwright:
        pw = fetch_playwright(project_url)
        used_playwright = True
        pages_fetched.append(f"{project_url} [playwright]")
        if pw.ok and pw.html:
            links = extract_links(pw.html, project_url)
            u, l = classify_links(links, project_url, method="playwright")
            unit_urls.extend(u)
            for cand in l:
                if cand not in listing_urls:
                    listing_urls.append(cand)
        elif pw.error:
            errors.append(f"playwright fallback failed: {pw.error}")

    return DiscoveryResult(
        project_url=project_url,
        listing_urls=listing_urls,
        unit_urls=unit_urls,
        used_playwright=used_playwright,
        pages_fetched=pages_fetched,
        errors=errors,
    )


# --------------------------------------------------------------------------- #
# Stage B: detail fetch
# --------------------------------------------------------------------------- #

def fetch_unit_detail(
    unit_url: str,
    *,
    session: requests.Session | None = None,
    allow_playwright: bool = True,
    static_min_length: int = 800,
) -> FetchResult:
    """Fetch the raw HTML of a unit detail page.

    Tries static first. If the response is OK but suspiciously short
    (< `static_min_length` bytes — a strong hint the page relies on JS),
    and Playwright is allowed, render with Chromium and keep whichever
    result has more content.
    """
    sess = session or _make_session()
    static = fetch_static(unit_url, session=sess)
    if not allow_playwright:
        return static
    needs_js = (not static.ok) or (static.length < static_min_length)
    if not needs_js:
        return static
    pw = fetch_playwright(unit_url)
    if pw.ok and pw.length > static.length:
        return pw
    return static


# --------------------------------------------------------------------------- #
# Saving raw HTML for debugging
# --------------------------------------------------------------------------- #

def _slugify(text: str) -> str:
    text = (text or "").lower()
    text = re.sub(r"[^\w\-]+", "-", text, flags=re.UNICODE)
    text = text.strip("-")
    return text[:80] or "page"


def _unit_filename(url: str, idx: int) -> str:
    parsed = urlparse(url)
    last = parsed.path.rstrip("/").rsplit("/", 1)[-1] or parsed.hostname or "unit"
    return f"{idx:03d}_{_slugify(last)}.html"


def save_raw_html(html: str, save_dir: Path, filename: str) -> Path:
    save_dir.mkdir(parents=True, exist_ok=True)
    path = save_dir / filename
    path.write_text(html, encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _print_text_report(report: dict) -> None:
    print("=" * 72)
    print(f"Project URL: {report['project_url']}")
    print(f"Pages fetched during discovery: {len(report['pages_fetched_during_discovery'])}")
    for p in report["pages_fetched_during_discovery"]:
        print(f"  - {p}")
    print(f"Used Playwright for discovery: {report['used_playwright_for_discovery']}")
    if report["discovery_errors"]:
        print("Discovery errors:")
        for e in report["discovery_errors"]:
            print(f"  ! {e}")
    print()
    print(f"Listing / price-list candidates ({len(report['listing_urls'])}):")
    for u in report["listing_urls"]:
        print(f"  - {u}")
    print()
    print(f"Discovered unit URLs ({len(report['unit_urls_discovered'])}):")
    for u in report["unit_urls_discovered"]:
        label = u.get("label") or ""
        suffix = f" — {label}" if label else ""
        print(f"  [{u.get('method')}] {u['url']}{suffix}")
    print()
    fetched = report["unit_pages_fetched"]
    if fetched:
        print(f"Fetched unit detail pages ({len(fetched)}):")
        for f in fetched:
            ok = "OK" if f.get("ok") else "FAIL"
            print(
                f"  #{f['index']:03d} [{f['fetch_method']}] {ok} "
                f"http={f.get('status')} {f.get('html_length')} bytes "
                f"in {f.get('elapsed_ms')} ms"
            )
            print(f"        url:   {f['unit_url']}")
            if f.get("saved_to"):
                print(f"        saved: {f['saved_to']}")
            if f.get("error"):
                print(f"        error: {f['error']}")
    print("=" * 72)


def run(args: argparse.Namespace) -> dict:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    session = _make_session()
    discovery = discover_units(
        args.project_url,
        allow_playwright=not args.no_playwright,
        max_listing_pages=args.max_listing_pages,
        session=session,
    )

    save_dir: Path | None = None
    if args.save_dir:
        host = _host(args.project_url) or "project"
        save_dir = Path(args.save_dir) / _slugify(host)
        save_dir.mkdir(parents=True, exist_ok=True)

    fetched: list[dict] = []
    for idx, unit in enumerate(discovery.unit_urls[: args.fetch], start=1):
        result = fetch_unit_detail(
            unit.url,
            session=session,
            allow_playwright=not args.no_playwright,
        )
        saved_path: Path | None = None
        if save_dir and result.html:
            saved_path = save_raw_html(
                result.html, save_dir, _unit_filename(unit.url, idx)
            )
        fetched.append(
            {
                "index": idx,
                "unit_url": unit.url,
                "label": unit.label,
                "source_project_url": args.project_url,
                "discovered_via": unit.method,
                "fetch_method": result.method,
                "status": result.status,
                "ok": result.ok,
                "html_length": result.length,
                "elapsed_ms": result.elapsed_ms,
                "error": result.error,
                "saved_to": str(saved_path) if saved_path else None,
            }
        )

    report = {
        "project_url": args.project_url,
        "pages_fetched_during_discovery": discovery.pages_fetched,
        "listing_urls": discovery.listing_urls,
        "unit_urls_discovered": [asdict(u) for u in discovery.unit_urls],
        "used_playwright_for_discovery": discovery.used_playwright,
        "discovery_errors": discovery.errors,
        "unit_pages_fetched": fetched,
    }

    if save_dir:
        (save_dir / "_discovery.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    return report


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Discover and fetch unit detail pages from a real-estate project URL. "
            "Stage A = discover listing + unit URLs; stage B = download raw HTML."
        )
    )
    parser.add_argument("--project-url", required=True, help="Project homepage URL")
    parser.add_argument(
        "--fetch",
        type=int,
        default=3,
        help="How many discovered unit pages to fetch (default 3; 0 = discovery only).",
    )
    parser.add_argument(
        "--save-dir",
        default=None,
        help="Directory where raw HTML + _discovery.json should be written.",
    )
    parser.add_argument(
        "--no-playwright",
        action="store_true",
        help="Disable the Playwright (headless Chromium) fallback entirely.",
    )
    parser.add_argument(
        "--max-listing-pages",
        type=int,
        default=3,
        help="Max number of listing-candidate pages to follow during discovery.",
    )
    parser.add_argument("--json", action="store_true", help="Emit a JSON report instead of text.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    report = run(args)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_text_report(report)
    return 0 if report["unit_urls_discovered"] else 2


if __name__ == "__main__":
    sys.exit(main())

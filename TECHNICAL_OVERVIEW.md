# Reamar AI — Technical Overview

> This document is the authoritative reference for any external agent (OpenClaw or other)
> that needs to understand, extend, or operate the Reamar AI system.

---

## 1. System Overview

### What It Actually Does

Reamar AI is an **internal decision-support tool** for a Prague real estate consultant. It is NOT a public product. It is NOT a listing portal.

Its job: from ~44,000 residential units across ~1,050 Prague new-development projects, **filter and rank the best ~10 apartments** for each client, then present them as a curated shortlist.

### How It Works in Practice (Two Modes)

**Mode 1 — Manual Mode (current primary usage)**
The consultant manually sets filters in the UI (price range, layout, location, walkability, standards). The system behaves as an advanced filtering/comparison tool. The consultant eyeballs results, picks the best ones, and sends them to the client.

**Mode 2 — Client Mode (partially implemented)**
A client profile is created with preferences. The system automatically applies filters + scoring, ranks all units, and surfaces top matches. This mode exists in code but is not yet the primary workflow.

### Who Uses It

- **The consultant** (single user) — logs in as broker, manages client profiles, applies filters, curates shortlists, triggers imports
- **Clients** — never use the system directly. They receive a **final output**: a curated interactive web page (`/share/[token]`) with ~10 recommended apartments. They can provide feedback via that page.

### What the Client Gets

The client does NOT configure anything. The workflow is:
1. Client describes what they want (meeting, email, call)
2. Consultant (or AI agent) creates/adjusts a client profile
3. System runs analysis + scoring
4. Client receives a share link with a curated shortlist

---

## 2. Architecture

### Backend

**Stack**: FastAPI (Python 3.11), SQLAlchemy 2.0, Alembic, PostgreSQL 16 + PostGIS

**Entry point**: `backend/src/app/main.py` (~5700 lines) — contains ALL routes, Pydantic schemas, and query builders in one file.

**Key modules:**

| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | ~5700 | All API routes + query logic + scoring |
| `models.py` | ~500 | 17 SQLAlchemy ORM models |
| `import_units.py` | ~1100 | BuiltMind data import pipeline |
| `fetch_builtmind.py` | ~200 | API client for BuiltMind |
| `overrides.py` | ~380 | Override system + `unit_to_response_dict()` |
| `filter_catalog.py` | ~310 | `CATALOG_TO_DB` mapping + filter generation |
| `column_catalog.py` | ~230 | Column definitions for UI tables |
| `project_catalog.py` | ~230 | Project-specific column/sort config |
| `field_catalog.csv` | ~140 rows | Single source of truth for all field metadata |
| `walkability.py` | ~640 | Walkability scoring (4 sub-scores) |
| `micro_location.py` | ~130 | Micro-location penalties |
| `aggregates.py` | ~570 | Local price diff + project aggregates |
| `project_location_metrics.py` | ~100 | Enrichment orchestrator |
| `settings.py` | ~40 | Pydantic settings (env + .env) |
| `db.py` | ~40 | Engine, session, connection |

### Database Schema (17 tables)

```
Project (projects)
  ├─ Unit (units)                          — 1:N, the core entity
  │   ├─ UnitOverride (unit_overrides)     — per-field manual corrections
  │   ├─ UnitApiPending (unit_api_pending) — proposed API values (accept/dismiss)
  │   ├─ UnitPriceHistory (unit_price_history) — price snapshots over time
  │   └─ UnitEvent (unit_events)           — change events (price_drop, status_change, etc.)
  ├─ ProjectOverride (project_overrides)   — per-field project corrections
  └─ ProjectAggregates (project_aggregates) — denormalized stats (avg price, unit counts)

Broker (brokers)                           — single consultant account
  └─ Client (clients)
      ├─ ClientProfile (client_profiles)   — 1:1, preferences (budget, area, polygon, etc.)
      ├─ ClientRecommendation              — scored unit suggestions
      ├─ ClientUnitMatch                   — auto-detected matches (score >= 80)
      ├─ ClientNote                        — meeting/call logs
      └─ ClientShareLink                   — public share links (with expiry)

UnitSnapshot (unit_snapshots)              — import run metadata
CommuteCache (commute_cache)               — cached travel times
```

**Key Project fields** (~80 columns): developer, name, address, GPS, walkability_score (+ 4 sub-scores), 17 `distance_to_*` fields, 13 `count_*_500m` fields, noise_day_db/night_db, micro_location_score, construction_completion, project_url, builtmind_project_id, energy_class, amenities booleans (concierge, reception, fitness, bike_room, etc.)

**Key Unit fields** (~50 columns): external_id, layout, floor, price_czk, price_per_m2_czk, original_price, floor/total/equivalent/exterior/balcony/terrace/garden areas, availability_status, use_type, reserved_date, days_on_market, local_price_diff_1000m/2000m, payment fractions, raw_json

### Frontend

**Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4

**All pages are client-side rendered** (`"use client"`). Czech language throughout. Glass-morphism design theme.

**Key pages:**

| Route | Purpose | Notes |
|-------|---------|-------|
| `/projects` | Projects table — filter, sort, paginate | Drag-reorder columns, 100/300/500 rows |
| `/projects/[id]` | Project detail — units, walkability, POI | Edit mode for overrides |
| `/projects/map` | Leaflet map — markers, polygon drawing, POI | Color by avg price/m2 |
| `/units` | Units table — 80+ filters, sort any column | Main filtering workspace |
| `/units/[external_id]` | Unit detail — price history, map, payment | Recharts price chart |
| `/clients` | Client dashboard — priority badges | |
| `/clients/[id]` | Client profile — multi-step wizard | Budget/area/layout/standards/walkability/location |
| `/clients/[id]/report` | PDF report generation | html2pdf.js |
| `/matches` | Broker match feed — new unit opportunities | Per-client grouping |
| `/share/[token]` | **Client-facing output** — curated shortlist | Public, with expiry |
| `/analytics/demand` | Clients without matching units | |

**Key frontend patterns:**
- Data fetching: plain `fetch()` to `http://127.0.0.1:8001`
- Auth: JWT token in `localStorage`
- Client activation: `ActiveClientContext` in `sessionStorage` — when active, auto-applies client's filters/preferences to all views
- Filter state: URL search params (persistent, shareable)
- Column config: `localStorage` (drag-reorder, visibility toggle)
- Walkability prefs: `localStorage` with presets (family, city, calm)

### Infrastructure

- PostgreSQL 16 + PostGIS in Docker (OrbStack), port 5433
- Backend: uvicorn `--reload`, port 8001
- Frontend: Next.js dev server, port 3001
- Mac mini is primary machine, launchd autostart
- Scripts: `scripts/start_stack.sh`, `stop_stack.sh`, `dev_check.sh`, `backup_db.sh`

---

## 3. Data Pipeline

### End-to-End Flow

```
BuiltMind API (sole data source)
    │ GET /api (country=czechia, market_data_dashboard)
    │ Returns presigned S3 URL → download full JSON (~44K units)
    ▼
fetch_builtmind.py
    │ Remap field names (BUILTMIND_TO_IMPORT dict)
    │   project_id → builtmind_project_id
    │   developer_id → builtmind_developer_id
    │   use_type (was: usage)
    │ Unmapped keys pass through as-is
    ▼
import_units.py (chunked, 2000 units/batch)
    │
    ├─ Project Resolution (3-tier priority):
    │   1. Match by builtmind_project_id (stable, survives renames)
    │   2. Match by (developer, name, address) tuple
    │   3. Create new project
    │
    ├─ Unit Processing:
    │   • New → create + price history + "new_unit" event
    │   • Existing → update ONLY changed fields
    │     - Never overwrites manual overrides
    │     - For price/availability with overrides: store diff in UnitApiPending
    │     - Generate events: price_drop, price_increase, status_change
    │     - Insert price history if price/status changed
    │
    ├─ Post-chunk:
    │   • Enrich project location metrics (if GPS changed)
    │   • Client alerting: score vs all clients (match >= 80 → ClientUnitMatch)
    │   • Recompute project aggregates
    │   • Recompute local price diffs
    ▼
PostgreSQL (projects, units, events, history, overrides)
    ▼
API Endpoints (main.py)
    │ Overrides applied via unit_to_response_dict()
    │ Filters applied via _build_units_query()
    ▼
Frontend → Consultant → Client (via share link)
```

### Field Mapping Chain (4 hops)

```
BuiltMind API key
  → fetch_builtmind.py (BUILTMIND_TO_IMPORT)
    → import JSON key
      → import_units.py (JSON_KEY_TO_DB_ATTR)
        → DB column
          → filter_catalog.py (CATALOG_TO_DB)
            → catalog key
              → field_catalog.csv
                → Czech label, filter type, display format
```

### Override Priority (highest wins)

```
1. UnitOverride / ProjectOverride (manual correction by consultant)
2. DB value (from latest import)
3. Project fallback (ride_to_center, public_transport_to_center)
```

For conflict fields (price_czk, availability_status): if override exists, new API value is stored as `UnitApiPending` — consultant can accept or dismiss in UI.

### Data Completeness Reality

**Many fields are NOT fully populated yet.** BuiltMind provides the core data, but:
- Some project-level fields (amenities, standards, energy class) come from manual enrichment
- Walkability/noise/micro-location scores require GPS + OSM data (computed, not imported)
- Payment schedule data is sparse
- This week: manual enrichment of missing data from developer websites

The system MUST handle incomplete data gracefully — null values, missing fields, partial scores.

---

## 4. Filtering System

### How Filters Are Defined

**Single source of truth**: `field_catalog.csv` (~140 rows)

Each row: `sort_priority;Group;Entity;column;Alias;Zobrazit;Filterable;Editable;unit;decimals;display_format`

Example rows:
```
1001;Cena;Jednotka;price;Cena;ANO;ANO;NE;Kč;0;currency
3002;Dispozice;Jednotka;floor_area;Podlahová plocha;ANO;ANO;NE;m²;1;area_m2
2002;Lokalita;Projekt;city;Město;ANO;ANO;NE;;;enum_search
5002;Standardy;Jednotka;heating;Topení;ANO;ANO;ANO;;;enum
```

**Mapping layer**: `CATALOG_TO_DB` dict in `filter_catalog.py` maps ~100 catalog keys → `(entity, db_attribute)`:
```python
"price": ("Unit", "price_czk"),
"floor_area": ("Unit", "floor_area_m2"),
"walkability_score": ("Project", "walkability_score"),
```

**Filter types** (derived from `display_format`):
- **range** (currency, area_m2, integer, percent, duration) → min/max inputs
- **enum** (heating, layout, windows, orientation) → multi-select, options from distinct DB values
- **enum_search** (city, municipality, district) → searchable multi-select
- **boolean** (available, renovation, air_conditioning) → checkbox

**API flow**: `GET /filters` returns grouped metadata → frontend renders filter drawer → user sets values → `GET /units?min_price=X&layout=2kk,3kk` applies them via `_build_units_query()` in `main.py`.

### Manual Mode vs Client Mode Filtering

**Manual mode**: Consultant sets filters directly in the UI. Filters are URL params. No scoring — just pure inclusion/exclusion.

**Client mode**: `ActiveClientContext` (frontend) converts `ClientProfile` → filter state via `profileToFilters()`:
- `budget_min/max` → `min_price/max_price`
- `area_min/max` → `min_floor_area/max_floor_area`
- `layouts` → `layout` filter
- Standards (must-haves) → boolean filters
- Default: `available=true` always applied

**The gap**: Client mode currently just applies hard filters. It does NOT yet apply soft scoring in the filter view. The scoring only runs when you explicitly call `POST /clients/{id}/recommendations/recompute`. There is no continuous "ranked view" that blends filtering + scoring.

---

## 5. Scoring System (BETA — Critical Section)

### Current Implementation

Located in `_compute_unit_match_score()` in `main.py` (~350 lines, around line 1190).

Returns a **0–100 score** with component breakdown.

#### Hard Filters (instant 0 if violated)

These are binary — if the unit violates any, score = 0:
- Required standards: recuperation, AC, floor heating, external blinds
- Required amenities: parking, bike_room, fitness, courtyard_garden
- Noise sensitivity: quiet_area flag, proximity to road (<150m) / tram (<100m) / rail (<300m) / airport (<5km)
- Energy class (±1 grade tolerance)
- Completion deadline (hard cutoff)
- Max days on market
- Max payment_contract percentage
- Renovation: only_new or only_renovation

#### Soft Score (weighted 0–100 components)

| Component | Weight | How it works |
|-----------|--------|--------------|
| **Budget fit** | 30% | In range → 100; outside → linear decay (hits 0 at ±50% deviation) |
| **Walkability fit** | 20% | Uses personalized walkability if prefs set, else project `walkability_score`; fallback 50 |
| **Location fit** | 20% | Inside polygon → 100; outside → 60; no polygon → 70 |
| **Layout fit** | 10% | Matches preference → 100; doesn't match → 50; no pref → 50 |
| **Area fit** | 10% | In range → 100; outside → linear decay; or ideal_area ±30% window |
| **Outdoor fit** | 5% | Proportional to min_outdoor_area_m2 if set |
| **Commute fit** | 5% | Per point: ≤max → 100, decays; must_have priority = hard fail if exceeded |

Plus **preference adjustments** (±15 cap): renovation preference, floor preference.

**Final**: `total = weighted_sum + pref_adjustment`, clamped 0–100.

### What Is Missing (Important)

1. **Price-vs-market scoring**: `local_price_diff_1000m/2000m` exists in DB but is NOT used in scoring. A unit that is 10% below market should score higher — this is not implemented.

2. **Quality scoring**: `overall_quality`, `energy_class`, `ceiling_height` exist but don't contribute to score. A premium-quality building should score higher for clients who care.

3. **Investment scoring**: `purchase_purpose` field exists ('own_use' vs 'investment') but scoring doesn't differentiate. Investment clients care about price/m2 relative to market, rental yield potential, area growth — none of this is scored.

4. **Price trend scoring**: `UnitPriceHistory` tracks prices over time, `price_change` field exists, but there's no "is this unit's price trending down?" score component.

5. **Developer reputation**: No scoring on developer quality/reliability. The `developer` field exists but is just a string for filtering.

6. **Floor/orientation scoring**: `_wizard_preferences_adjustment()` adds ±15 for floor preferences, but it's crude. No orientation-based sunlight scoring.

7. **Smart guidance / constraint analysis**: The system should detect "your constraints eliminate 85% of the market" and suggest "increase price by 5% → 40% more options". This exists partially as `GET /clients/{id}/market-simulate` but is not integrated into the main workflow.

8. **Scoring weights are hardcoded**: The 30/20/20/10/10/5/5 weights are fixed in code. Different clients (family vs investor) should have different weight profiles.

### How to Extend Scoring

In `main.py`, function `_compute_unit_match_score()`:

1. Add a new component (e.g., `price_vs_market_fit`):
```python
# After existing components
if unit.local_price_diff_1000m is not None:
    diff = float(unit.local_price_diff_1000m)
    # Negative diff = cheaper than market = good
    price_market_fit = max(0, min(100, 50 - diff * 2))
else:
    price_market_fit = 50.0  # neutral if no data
```

2. Add weight in the final aggregation (adjust other weights to sum to 1.0)

3. Include in `reason_json` for transparency:
```python
parts["price_market_fit"] = price_market_fit
```

4. Add to `ClientRecommendationItem` Pydantic model for API exposure

**Design principle**: Scoring MUST be easily extendable because the logic is still evolving. Each component should be independent, return 0–100, and have a clear neutral fallback for missing data.

---

## 6. Client Mode

### Current State

**What exists:**
- `ClientProfile` model with: budget, area, layouts, property_type, purchase_purpose, walkability_preferences, filter_json (wizard state), polygon_geojson, commute_points
- `_compute_unit_match_score()` — full scoring function with 7 components
- `POST /clients/{id}/recommendations/recompute` — triggers scoring for all units
- `ClientRecommendation` table — stores scored results with `reason_json` breakdown
- `ClientUnitMatch` — auto-created during import for score >= 80
- `GET /clients/{id}/recommendations` — returns ranked list
- `/share/[token]` — public client-facing page with curated recommendations
- `/clients/[id]` — wizard UI for profile creation (multi-step: budget → area → layout → standards → walkability → location polygon)
- `ActiveClientContext` — session-based client activation that applies filters globally

**What works end-to-end:**
1. Create client → fill profile via wizard → recompute recommendations → view ranked results → generate share link → client sees shortlist

### What Is Missing for Production-Ready Client Mode

1. **First Meeting Wizard UX**: Current wizard exists but is functional, not beautiful. Need: full-screen, polished design, progressive disclosure. Currently at `/clients/[id]` as a multi-step form — needs redesign into a standalone experience.

2. **Smart Guidance System**: The system should detect restrictive constraints and recommend relaxation. `GET /clients/{id}/market-simulate` exists (returns blockers + relaxation suggestions) but is not integrated into the wizard flow or displayed prominently.

3. **Continuous Ranked View**: Currently you must explicitly call recompute. No live "ranked units" view that updates as you adjust profile. The manual filter view and the scored recommendations are disconnected experiences.

4. **Soft vs Hard constraint distinction in UI**: The wizard collects preferences but doesn't clearly distinguish "must have" from "nice to have". The `filter_json` JSONB stores this distinction, but the UX doesn't make it obvious.

5. **AI-driven profile adjustment**: When a client says "ideally 3kk but 2kk acceptable" — this should be captured as a layout preference with tolerance, not a hard filter. Currently the system treats layout as hard filter (match → 100, no match → 50 in scoring, but 50 is already a significant penalty). Need finer tolerance modeling.

6. **Notification / alerting UX**: `ClientUnitMatch` records are created during import, visible at `/matches`, but there's no email/push notification. The broker must manually check.

7. **Share link output quality**: `/share/[token]` exists but the presentation needs design work to feel like a premium curated shortlist, not a data table.

---

## 7. Import System

### How BuiltMind Import Works

**Trigger**: `POST /admin/imports/builtmind/run` (button in "Akce" dropdown on `/projects` page) or CLI: `python -m app.fetch_builtmind`

**Step 1 — Fetch** (`fetch_builtmind.py`):
- Calls `https://1ki66xm0jc.execute-api.eu-central-1.amazonaws.com/Prod/api`
- Params: `country=czechia`, `export_type=market_data_dashboard`, `format=json`
- Auth: `Authorization: Bearer {BUILTMIND_API_KEY}` (stored in `.env`, loaded via `settings.builtmind_api_key`)
- Response: presigned S3 URL → downloads full JSON
- Retry: 429 (rate limit, waits Retry-After), 504 (gateway timeout, waits 30s)
- Remaps field names via `BUILTMIND_TO_IMPORT` dict

**Step 2 — Import** (`import_units.py`, chunked at 2000 units):

**Project identity** (3-tier, most stable first):
1. `builtmind_project_id` — integer from API, unique, survives renames
2. `(developer, name, address)` tuple — normalized, deduplicated
3. Create new project — when neither matches

**Unit processing** (keyed by `external_id`):
- **New unit**: Create + first price history row + `new_unit` event
- **Existing unit**: Compare each field, update only what changed
  - Respects overrides: never overwrites manual corrections
  - Conflict fields (price_czk, availability_status): if override exists, store API value as `UnitApiPending` suggestion
  - Events generated: `price_drop`, `price_increase`, `status_available`, `status_reserved`
  - Price history: new row only if price/status actually changed

**Post-chunk enrichment**:
- `enrich_project_location_metrics()` if GPS changed (noise, walkability, micro-location)
- Invalidate `CommuteCache` for affected projects
- Client alerting: score each touched unit vs all clients, create `ClientUnitMatch` if score >= 80
- Recompute `ProjectAggregates` (unit counts, avg prices)
- Recompute `local_price_diff` for affected units

### March 2026 Schema (current)

New project fields: `project_url`, `construction_completion`, `builtmind_project_id` (unique), `builtmind_developer_id`

New unit fields: `use_type` (renamed from `usage`), `reserved_date`, `reservation_duration_days`, `is_stale_reservation`

Type changes: `recuperation`/`cooling` from boolean → varchar(50) (stores "true"/"false"/"preparation")

Removed from API: `city`, `district`, `municipality` → uses IGA alternatives as fallback

### Re-import Behavior

- Same `external_id` → update (only changed fields)
- Same `builtmind_project_id` → reuse project (even if name changed)
- Dry-run mode: `--dry-run` flag computes everything, writes nothing
- Typical run: ~44K units, ~1,050 projects reused, 0–50 new projects, 20–40 seconds

---

## 8. UI / UX State (Critical)

### Current Reality

The UI is **functional but not polished**. It works as an internal tool for a technical user (the consultant), but is NOT suitable for:
- Client-facing experiences (the share link page needs redesign)
- Non-technical users
- First-impression moments (the wizard)

### Specific Issues

**1. Projects page** (`/projects/page.tsx`)
- Dense data table, functional but overwhelming
- Akce dropdown with BuiltMind import works but feels bolted on
- Column drag-reorder is nice but discovery is poor

**2. Units page** (`/units/page.tsx`)
- 80+ filters available — powerful but can feel like "configuring the system"
- No guided flow — just raw filter controls
- Large single-file component

**3. Client wizard** (`/clients/[id]/page.tsx`)
- Multi-step form exists (budget → area → layout → standards → walkability → location polygon)
- Functional but not "beautifully designed full-screen wizard" that clients should see
- Needs to feel premium, not like a config form

**4. Share link** (`/share/[token]/page.tsx`)
- Public client-facing page
- Currently just renders recommendations — needs to feel like a curated shortlist
- This is the ONE page clients see, so it must be exceptional

**5. Map views** (`/projects/map/page.tsx`, `ProjectsLeafletMap.tsx`)
- Leaflet maps work: markers, POI overlay, polygon drawing
- But: no clustering at zoom-out, performance degrades with 1000+ markers

**6. Overall design system**
- Glass-morphism theme with purple gradients
- `ReamarButton`, `ReamarCard`, `InfoBox` components exist (`frontend/src/components/ui/reamar-ui.tsx`)
- But inconsistent application across pages

### What Needs Redesign (Priority Order)

1. **Share link page** — the client's ONLY touchpoint. Must be exceptional.
2. **First meeting wizard** — full-screen, progressive, beautiful. Replaces current multi-step form.
3. **Smart guidance display** — "your constraints eliminate 85% of market" + relaxation suggestions. Market-simulate endpoint exists but UI doesn't surface it well.
4. **Units/projects tables** — need guided mode alongside power mode.
5. **Map experience** — clustering, better popup design, mobile-friendly.

---

## 9. Extensibility

### Add a New Field (API → DB → UI)

1. **DB**: Add column to `Unit` or `Project` in `models.py`. Create Alembic migration.
2. **Import**: If BuiltMind uses different name → add to `BUILTMIND_TO_IMPORT` in `fetch_builtmind.py`. If JSON key differs from DB column → add to `JSON_KEY_TO_DB_ATTR` in `import_units.py`.
3. **Catalog**: Add row to `field_catalog.csv` (group, entity, column key, Czech alias, display format, show/filter/edit flags).
4. **Filter mapping**: Add to `CATALOG_TO_DB` in `filter_catalog.py` → field becomes filterable AND appears in unit `data` dict automatically (via `unit_to_response_dict()` iteration).
5. **Project overview** (if project field): Add to `PROJECTS_OVERVIEW_KEYS` in `column_catalog.py`, add to `PROJECT_CATALOG_TO_ATTR` in `project_catalog.py`.
6. **Frontend**: Column and filter appear automatically. For special display on detail pages, add explicit rendering.

### Add a New Filter

1. Row in `field_catalog.csv` with `Filterable=ANO` + correct `display_format`
2. Entry in `CATALOG_TO_DB`
3. Appears in `GET /filters` and frontend filter drawer automatically
4. For non-standard query params: add handling in `_build_units_query()` in `main.py`

### Add a New Scoring Metric

1. Add computation in `_compute_unit_match_score()` (main.py ~line 1190)
2. Return 0–100, handle null data gracefully (return neutral 50)
3. Add weight in final aggregation (adjust others to sum to 1.0)
4. Add to `reason_json` dict for transparency
5. Add to `ClientRecommendationItem` Pydantic model for API exposure

### Plug In AI (OpenClaw)

**Available API surface for an AI agent:**

| Endpoint | What it does | AI use case |
|----------|-------------|-------------|
| `POST /clients` | Create client | After first meeting |
| `POST /clients/{id}/profile` | Set preferences | Translate client request → profile |
| `GET /filters` | Available filter options | Understand what's filterable |
| `GET /units?...filters` | Query units | Manual exploration |
| `POST /clients/{id}/recommendations/recompute` | Run scoring | After profile change |
| `GET /clients/{id}/recommendations` | Get ranked results | Build shortlist |
| `GET /clients/{id}/market-simulate` | Constraint analysis | "Your filters are too restrictive" |
| `POST /clients/{id}/share-link` | Generate share URL | Send to client |
| `PUT /units/{id}/overrides/{field}` | Correct data | Fix wrong prices/areas |
| `PUT /projects/{id}/overrides/{field}` | Correct project data | Fix project-level fields |
| `POST /admin/imports/builtmind/run` | Refresh data | Trigger before analysis |

**Integration pattern**: AI agent calls the REST API, never touches the DB directly. The API provides all necessary CRUD, filtering, scoring, and recommendation operations.

**Key workflow for AI**:
1. Client sends email/message describing what they want
2. AI parses → calls `POST /clients` + `POST /clients/{id}/profile`
3. AI calls `GET /clients/{id}/market-simulate` → checks if constraints are realistic
4. If too restrictive → AI suggests relaxation to consultant
5. AI calls `POST /clients/{id}/recommendations/recompute`
6. AI calls `GET /clients/{id}/recommendations` → reviews top 10
7. AI calls `POST /clients/{id}/share-link` → sends to client

### Add a New Data Source (Beyond BuiltMind)

1. Create a fetch module that returns `list[dict]` with canonical keys (`unique_id`, `project`, `developer`, `price`, etc.)
2. Map field names to `JSON_KEY_TO_DB_ATTR` conventions
3. Call `import_units(path, source="new_source")` — pipeline handles dedup, events, enrichment

---

## 10. Risks & Weak Points

### Architecture Risks

- **`main.py` is 5700 lines**: All routes, schemas, scoring, query logic in one file. Finding anything requires search. Should be split into routers.
- **`import_units.py` is 1100 lines**: Interleaves project resolution, unit updates, events, alerting, enrichment. Hard to test in isolation.
- **No background job system**: Import endpoint blocks for 20–40s synchronously. No Celery/Redis/task queue. Recomputation endpoints also synchronous.
- **Single-machine deployment**: Mac mini, no redundancy, no container orchestration.

### Performance

- **Offset-based pagination**: Degrades at high offsets (offset=40000).
- **No caching**: Every API call hits PostgreSQL. No Redis, no in-memory cache.
- **Local price diff recomputation**: Scans all 44K units with spatial grid after every import.
- **Client alerting during import**: O(units_changed * clients) — scales poorly as client count grows.
- **Frontend**: All pages are CSR, large single-file components. No SSR optimization.

### Data Quality

- **Single data source**: BuiltMind API is the only automated feed. No cross-validation.
- **Incomplete data**: Many fields (amenities, standards, energy class) require manual enrichment from developer websites. System must handle nulls everywhere.
- **IGA field fallback**: city/district/municipality removed from BuiltMind API in March 2026. IGA alternatives may be empty for some units.
- **Override divergence**: Manual overrides can drift from reality over time — no mechanism to flag stale overrides.

### Scoring Risks

- **Scoring is in beta**: Logic is still evolving. Weights are hardcoded. No A/B testing framework.
- **Missing data → neutral score**: When walkability/noise/commute data is missing, the system returns neutral (50). This means a unit with NO data looks "average" rather than "unknown". Could mislead.
- **No feedback loop**: Client reactions to recommendations are not fed back into scoring calibration.

### Coupling

- **CATALOG_TO_DB is the spine**: Adding a field requires touching `field_catalog.csv` + `filter_catalog.py` + `models.py` + migration + optionally `column_catalog.py` + `project_catalog.py`. Miss one → field silently missing.
- **`unit_to_response_dict()`** builds the entire unit response by iterating `CATALOG_TO_DB`. Any mapping error → field silently dropped.
- **Two override systems**: Unit overrides and project overrides have separate type-parsing paths. Easy to get out of sync.

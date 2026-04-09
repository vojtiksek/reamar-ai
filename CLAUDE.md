# Reamar AI — Claude Rules

---

## 1. Project Overview

Reamar AI is an **internal real estate decision engine** for new residential developments (primarily Prague).

**It is NOT a public listing portal.**

It is a data-driven tool used by a consultant (broker) to:
- collect client requirements via a structured wizard
- filter relevant units (apartments)
- rank them by fit
- prepare a shortlist and present it to the client

### Core entities
| Entity | Meaning |
|--------|---------|
| **Project** | A real estate development (building, complex) |
| **Unit** | A specific apartment within a project |
| **Case / Client** | A customer with preferences, budget, wizard answers |

### Stack
- **Backend**: FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL (PostGIS)
- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind)
- **DB**: PostgreSQL 16 + PostGIS, Docker on Mac mini, port 5433
- **Python**: 3.11, venv at `backend/.venv`
- JSONB columns carry wizard state, scoring config, and overrides
- Project-level overrides always take precedence over unit base data

---

## 2. Current System

### Wizard → Scoring flow
1. Broker fills 10-step wizard (`cases/[id]/brief/page.tsx`)
2. Answers stored in `ClientProfile.filter_json.wizard` (JSONB)
3. Profile also stores: `polygon_geojson`, `commute_points_json`, `walkability_preferences_json`
4. Backend scoring pipeline (`scoring.py`):
   - `normalize_wizard()` — translates new wizard field names to scoring field names
   - `compute_eligibility()` — hard "must" filters → score=0 if violated
   - `compute_flat_match()` — 22-aspect weighted scoring (0–100 per aspect)
   - `_wizard_preferences_adjustment()` — soft bonus/penalty (±20 pts)
5. Results stored as `ClientRecommendation` rows, ranked by score

### Known issues (as of 2026-04)
- UI not dense enough — hard to compare units side by side
- Weak project-level context in recommendation list
- Wizard ↔ backend field mismatches exist (partially fixed via `normalize_wizard`)
- Scoring sometimes unintuitive — commute_fit=0 when commute point has null lat/lng
- Polygon is a soft signal (60 vs 100), not a hard filter
- Stale recommendations possible if recompute not triggered after wizard changes

---

## 3. Target Product Direction

**We are NOT building a "magic AI top 10 picker".**

### How it should work:
1. Wizard defines **hard filters** + tolerances
2. System returns **all relevant units** that pass filters
3. Scoring is used **only for ranking**
4. UI helps **human decision-making** — broker curates, client decides

### Key paradigm shift: unit-first → project-first
- Broker works with units but **reasons in projects**
- Future client-facing view: **projects first**, then units inside
- Scoring should surface projects, not just sort a flat unit list

---

## 4. UX Principles

- **Dense, scannable layouts** — avoid large cards as primary list view
- **Comparison over aesthetics** — show more items, not fewer
- **Group by project** where useful (especially in recommendations)
- **Fast, low-friction interactions** — minimize clicks per task
- **Avoid unnecessary complexity** — every UI element must earn its place
- Broker's time is scarce — optimize for speed of insight, not visual richness

---

## 5. Engineering Rules

### Always
- Analyze before implementing
- Run `scripts/dev_check.sh` after backend changes
- Keep changes minimal and targeted — no unrelated refactors
- Read a file before editing it
- Reuse existing patterns and components
- First find the closest existing implementation, then extend

### Never
- Do not push without passing checks
- Do not run `alembic upgrade head` on shared DB without explicit confirmation
- Do not commit `.env`, `backups/`, `logs/`, `*.dump`, `*.egg-info/`
- Do not redesign entire systems in one step
- Do not change DB schema unless explicitly required
- Do not break existing API contracts
- Do not add error handling for impossible cases
- Do not add comments explaining obvious code
- Do not create new files when editing an existing one is sufficient
- Do not run `npm audit fix --force` unless explicitly asked

---

## 6. Scoring Philosophy

- Scoring is **not the source of truth** — hard filters are
- Scoring only **ranks** already-relevant results
- Do NOT hide valid units solely due to a low score
- The system must remain **explainable** — broker must understand why a unit ranked high
- `top_strengths` and `top_compromises` must reflect real signal, not noise
- When wizard data is sparse → scoring degrades gracefully, not silently

---

## 7. Development Workflow

For any task:
1. **Analyze** current implementation (read relevant files)
2. **Identify** the minimal viable change
3. **Propose** approach — explicit about scope, risks, tradeoffs
4. **Implement** smallest useful step
5. **Validate** — types, runtime, logic, `dev_check.sh`
6. **Explain** changes clearly

For UI tasks:
- Identify reference implementation first
- List exact file paths
- Explain reuse options
- Then propose minimal implementation

---

## 8. Machines

- **Mac mini** — primary coding, AI/Claude host, shared DB host, internal app server (`~/reamar-ai`)
- **MacBook** — secondary/mobile, review, fallback edits (`~/Desktop/reamar_ai`)

## Project layout
```
backend/src/app/     — FastAPI app (main.py, models.py, scoring.py, ...)
backend/alembic/     — DB migrations
frontend/src/app/    — Next.js pages and components
  cases/[id]/brief/  — New 10-step wizard (primary)
  clients/[id]/      — Legacy 7-step wizard (secondary)
scripts/             — dev/ops scripts
```

## Dev commands
```bash
# Backend (port 8001, auto-reload)
cd backend && bash dev

# Frontend (port 3001, auto-reload)
cd frontend && npm run dev

# Full stack
scripts/start_stack.sh / stop_stack.sh / restart_stack.sh

# Tests
cd backend && source .venv/bin/activate && python -m pytest tests/ -x -q

# Migrations
cd backend && source .venv/bin/activate && alembic upgrade head
```

## DATABASE_URL
- Mac mini (local): `postgresql+psycopg://reamar:reamar_password@localhost:5433/reamar`
- MacBook (Tailscale): `postgresql+psycopg://reamar:reamar_password@100.118.81.100:5433/reamar`

## DB migrations
- New migration = new file in `backend/alembic/versions/`
- Command: `alembic revision --autogenerate -m "describe_change"`
- Always review generated migration before applying
- Never run `alembic downgrade` on shared DB without explicit confirmation

## Git
- Commit often, push when checks pass
- Never force push to main
- If auto-pull skips due to local changes, commit or stash first

## Known baseline
- 1 pre-existing failing test: `tests/test_api_units_projects.py::test_get_units_with_sort` — sort order instability, not blocking
- 1 pre-existing failing test: `tests/test_overrides.py::test_get_unit_applies_unit_overrides` — SQLAlchemy issue, not blocking

---

## 9. Communication Style

- Be structured and precise
- Separate: **analysis** / **proposal** / **implementation**
- Highlight risks and tradeoffs explicitly
- State assumptions clearly
- Avoid unnecessary verbosity — one clear sentence beats three hedged ones

---

## 10. Final Principle

The goal is NOT to write the most code.

The goal is to:
- improve clarity
- reduce complexity
- increase predictability
- support real-world decision making by a real broker with real clients

**Always optimize for real usage, not theoretical perfection.**

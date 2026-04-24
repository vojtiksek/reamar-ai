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
- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind) — hostováno na **Vercel**
- **Backend**: FastAPI + SQLAlchemy 2.0 + Alembic — hostováno na **Railway**
- **DB**: PostgreSQL 16 + PostGIS — **Supabase** (managed)
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

### Known issues (as of 2026-04-24)
- Project-level context v recommendation listu lze dál zhušťovat
- Wizard ↔ backend field mismatches — částečně fixnuto přes `normalize_wizard`; občas najdeš nový
- `commute_fit=0` při null lat/lng commute bodu — graceful degradation chybí

### Known strengths (2026-04-24)
- Polygon je **hard filtr** (ne soft signal)
- Stale detekce v Recs (banner + auto timestamp porovnání)
- Comparison view (units table + checkbox + modal)
- Denní automatizace přes Vercel Cron → backend ops runner
- Keyboard shortcuts v Recs + quick-jump na posledního klienta

---

## 2.5 Automation & Deployment

### Produkce
- **Frontend**: Vercel (Next.js 16, `main` branch auto-deploy)
- **Backend**: Railway (FastAPI, auto-deploy z `main`)
- **DB**: Supabase (PostgreSQL 16 + PostGIS, managed)

### Daily automation (05:00 CEST / 04:00 CET)
- Vercel Cron `vercel.json`: `0 3 * * *` UTC
- Route: `frontend/src/app/api/cron/daily-ops/route.ts`
  - Ověří `Authorization: Bearer $CRON_SECRET`
  - Volá `POST $BACKEND_API_URL/admin/ops/daily-run` s `x-cron-secret`
- Backend: `backend/src/app/ops_runner.py` spouští 5 kroků:
  1. Import units
  2. Walkability recompute
  3. Microlocation recompute
  4. Market deviation recompute
  5. API suggestions
- Log: tabulka `ops_runs` (JSONB payload per step, duration, status)
- Dashboard: `/admin/operace` (day/week/month summary + log)

### Environment proměnné
- `CRON_SECRET` — Vercel project env (bearer token pro cron route)
- `BACKEND_API_URL` — veřejná URL Railway backendu (např. `https://…railway.app`)
- `DATABASE_URL` — Supabase connection string (pooler/direct)
- Backend na Railway musí mít stejný `CRON_SECRET` v env (main.py kontroluje `x-cron-secret` header)

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

Produkt má **dvě UX tváře** — různá pravidla pro různé části:

### A) Broker power-tool — `/explorer`, `/admin/*`
Optimalizuj pro **maximum dat na stránce**, rychlost a srovnatelnost.
- **Dense, scannable layouts** — avoid large cards as primary list view
- **Comparison over aesthetics** — show more items, not fewer
- **Fast, low-friction interactions** — minimize clicks per task
- Broker's time is scarce — optimize for speed of insight, not visual richness
- Estetika ustupuje hustotě dat

### B) Klientské & prezentační — `/clients`, `/cases/[id]/recommendations`, klientská zóna
Musí **fungovat rychle, ale taky vypadat dobře** — broker to ukazuje klientovi.
- Dense ale **čisté**; gridy místo stěn textu
- **Group by project** where useful (especially in recommendations)
- Jasná hierarchie, dost whitespace, čitelné fonty
- Obrázky, ikony a barvy jsou součást hodnoty, ne dekorace
- Klient má důvěřovat tomu, co vidí

### Společné
- **Avoid unnecessary complexity** — every UI element must earn its place
- Consistent design tokens (rv2 CSS vars, ReamarUI komponenty)

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

- Scoring je **not the source of truth** — hard filters are
- **Polygon je hard filter** (ne ranking signál)
- Scoring only **ranks** already-relevant results
- Do NOT hide valid units solely due to a low score
- The system must remain **explainable** — broker must understand why a unit ranked high
- `top_strengths` a `top_compromises` musí odrážet reálný signál, ne noise
- Při sparse wizard datech → scoring degraduje graceful, ne silently

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

## 8. Machines & hosting

**Dev prostředí:**
- **Mac mini** — primary coding, AI/Claude host (`~/reamar-ai`)
- **MacBook** — secondary/mobile, review, fallback edits (`~/Desktop/reamar_ai`)

**Produkce:**
- **Frontend** → Vercel (auto-deploy z `main`)
- **Backend** → Railway (auto-deploy z `main`)
- **DB** → Supabase (managed PostgreSQL + PostGIS)

## Project layout
```
backend/src/app/     — FastAPI app
  main.py            — endpoints + auth
  models.py          — SQLAlchemy
  scoring.py         — 22-aspect flat scoring
  ops_runner.py      — daily automation orchestrátor
backend/alembic/     — DB migrace
frontend/src/app/    — Next.js
  cases/[id]/brief/  — 10-step wizard (primary)
  cases/[id]/recommendations/  — Recs list, comparison modal, shortcuts
  admin/operace/     — Ops dashboard
  api/cron/daily-ops/ — Vercel cron route
frontend/vercel.json  — Cron schedule
scripts/             — dev/ops scripty
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
- **Produkce** (Railway backend → Supabase): Supabase connection string v Railway env
- **Dev** (local backend → Supabase): stejný Supabase string v `backend/.env`
- Pozor na pooler vs direct connection — pro Alembic migrace použij direct, pro app pooler

## DB migrations
- New migration = new file in `backend/alembic/versions/`
- Command: `alembic revision --autogenerate -m "describe_change"`
- Always review generated migration before applying
- Supabase = shared DB → **nikdy** `alembic upgrade head` ani `downgrade` bez explicitního potvrzení
- Produkční migrace se spouští cíleně, ne automaticky při Railway deploy

## Git
- Commit often, push when checks pass
- Never force push to main
- If auto-pull skips due to local changes, commit or stash first

## Keyboard shortcuts & UX fast paths

**Globální:**
- `⌘K` / `Ctrl+K` — vyhledávání (palette)
- `⌘⇧L` / `Ctrl⇧L` — skok na posledního navštíveného klienta

**V Recs (`/cases/[id]/recommendations`):**
- `j` / `↓` — další jednotka
- `k` / `↑` — předchozí jednotka
- `p` — pin / unpin
- `l` — líbí se
- `d` — nelíbí se
- `Enter` — otevřít detail jednotky
- `Esc` — zavřít drawer / dialog
- `?` — nápověda

**Comparison flow:**
- V Units view checkbox „⇌" u každé jednotky
- Plovoucí tlačítko „Porovnat (N)" po výběru ≥2 jednotek
- Tlačítko „⇌ Porovnat" v toolbaru přepne do units view

## Known baseline
- `tests/test_api_units_projects.py::test_get_units_with_sort` — known flaky, not blocking
- `tests/test_overrides.py::test_get_unit_applies_unit_overrides` — SQLAlchemy issue, not blocking

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

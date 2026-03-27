# Reamar AI — Claude Rules

## Behavior rules

For every task:
1. Do not scan the whole repository unless explicitly asked.
2. First find the closest existing implementation.
3. Prefer reusing existing patterns over inventing new ones.
4. Change as few files as possible.
5. Read a file before editing it.

When asked about UI features like maps, tables, filters, or detail pages:
- first identify the reference implementation
- list exact file paths
- explain reuse options
- then propose the minimal implementation

### Always do
- Run `scripts/dev_check.sh` after making backend changes
- Keep changes minimal and targeted — do not refactor unrelated code
- Use meaningful commit messages

### Never do
- Do not push directly without running checks
- Do not run `alembic upgrade head` on shared DB without explicit user confirmation
- Do not commit `.env`, `backups/`, `logs/`, `*.dump`, `*.egg-info/`
- Do not add error handling for impossible cases
- Do not add comments explaining obvious code
- Do not create new files when editing an existing file is sufficient
- Do not run `npm audit fix --force` unless explicitly asked

---

## Machines
- **Mac mini** — primary coding machine, AI/Claude host, shared DB host, internal app server (`~/reamar-ai`)
- **MacBook** — secondary/mobile machine for review, fallback edits, and testing (`~/Desktop/reamar_ai`)

## Stack
- **Backend**: FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL (PostGIS)
- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind)
- **DB**: PostgreSQL 16 + PostGIS, runs in Docker on Mac mini, port 5433
- **Python**: 3.11, venv at `backend/.venv`

## Project layout
```
backend/src/app/     — FastAPI app (main.py, models.py, settings.py, db.py, ...)
backend/alembic/     — DB migrations
frontend/src/app/    — Next.js pages and components
scripts/             — dev/ops scripts
logs/                — local logs (gitignored)
backups/             — DB backups (gitignored)
```

## Dev commands
```bash
# Backend (port 8001, auto-reload)
cd backend && bash dev

# Frontend (port 3001, auto-reload)
cd frontend && npm run dev

# Full stack
scripts/start_stack.sh
scripts/stop_stack.sh
scripts/restart_stack.sh

# Tests
cd backend && source .venv/bin/activate && python -m pytest tests/ -x -q

# Migrations
cd backend && source .venv/bin/activate && alembic upgrade head
```

## DATABASE_URL
Default (Mac mini local): `postgresql+psycopg://reamar:reamar_password@localhost:5433/reamar`
MacBook (over Tailscale): `postgresql+psycopg://reamar:reamar_password@100.118.81.100:5433/reamar`

## DB migrations
- New migration = new file in `backend/alembic/versions/`
- Command: `alembic revision --autogenerate -m "describe_change"`
- Always review generated migration before applying
- Never run `alembic downgrade` on shared DB without user confirmation

## Git
- Commit often, push when checks pass
- Never force push to main
- If auto-pull skips due to local changes, commit or stash first

## Known baseline
- 1 pre-existing failing test: `tests/test_overrides.py::test_get_unit_applies_unit_overrides` — SQLAlchemy issue, not blocking
- 20/21 tests pass normally

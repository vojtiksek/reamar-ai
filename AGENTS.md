# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

This is a real estate unit listing platform (Czech market) with:
- **Backend**: Python/FastAPI at `localhost:8001` (see `backend/`)
- **Frontend**: Next.js (React 19) at `localhost:3000` (see `frontend/`)
- **Database**: PostgreSQL 16 via Docker Compose at `localhost:5433`

### Quick Reference

| Task | Command |
|------|---------|
| Start DB | `sudo docker compose up -d db` (from repo root) |
| Run migrations | `cd backend && source .venv/bin/activate && alembic upgrade head` |
| Start backend | `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --app-dir src --port 8001 --reload-dir src` |
| Start frontend | `cd frontend && npm run dev` |
| Run backend tests | `cd backend && source .venv/bin/activate && pytest tests/ -v` |
| Run frontend lint | `cd frontend && npx eslint .` |
| Health check | `curl http://127.0.0.1:8001/health` |

### Non-obvious Caveats

- **Docker daemon must be started manually**: Run `sudo dockerd &>/tmp/dockerd.log &` before `docker compose up`. Wait ~3s for it to be ready.
- **The Docker setup uses `fuse-overlayfs`** storage driver and `iptables-legacy` because the VM kernel doesn't support all overlay2/nftables features.
- **No `.env` file is required**: The backend `settings.py` has a built-in default `DATABASE_URL` matching the docker-compose credentials (`reamar/reamar_password@localhost:5433/reamar`).
- **Python venv location**: `backend/.venv` — always activate before running backend commands.
- **`next build` has a pre-existing TypeScript error** in `src/app/projects/page.tsx:196` (type mismatch on `sortDir`). The dev server (`npm run dev`) works fine despite this.
- **ESLint has pre-existing warnings/errors** (unused vars, `setState` in effect). These are in the existing codebase.
- **Data import**: The DB starts empty. Use `python -m app.import_units <file.json> --source <name>` from `backend/` with venv active to populate data. No sample data file is committed to the repo.
- **The frontend hardcodes API URL** to `http://127.0.0.1:8001`. Both services must run simultaneously for the full stack to work.

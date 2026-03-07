## Reamar AI

Webová aplikace pro nemovitosti: jednotky (byty) a developerské projekty. Backend FastAPI + SQLAlchemy 2.0 + PostgreSQL, frontend Next.js.

### Requirements

- **Python**: 3.11+
- **Docker** and **Docker Compose**
- **macOS**: Tested with recent versions; should work on Linux/Windows with minor adjustments.

### Project Structure

- **backend**: Python backend project (FastAPI, SQLAlchemy, Alembic)
  - `pyproject.toml`: PEP 621 configuration, dependencies, and build system
  - `src/app/main.py`: FastAPI app with `/health` endpoint
  - `src/app/db.py`: SQLAlchemy engine, session factory, and DB health check
  - `src/app/settings.py`: Pydantic settings with `DATABASE_URL` default; loads `.env` from project root
  - `src/app/models.py`: Placeholder for future ORM models
  - `alembic.ini`, `alembic/`: Alembic configuration and environment
- **docker-compose.yml**: Local PostgreSQL service (localhost:5433)
- **.env.example**: Example environment file with `DATABASE_URL`

### 1. Start PostgreSQL with Docker Compose

From the project root (`reamar_ai`):

```bash
docker-compose up -d db
```

If you previously ran with different credentials (e.g. `postgres`/`postgres`), clear the volume and recreate:

```bash
docker-compose down -v
docker-compose up -d db
```

This starts PostgreSQL on `localhost:5433` with:

- **Database**: `reamar`
- **User**: `reamar`
- **Password**: `reamar_password`

You can stop it later with:

```bash
docker-compose down
```

### 2. (Optional) Create `.env` to Override Defaults

Settings use a built-in default `DATABASE_URL` that matches the docker-compose above. No `.env` is required to run.

To override, copy the example and edit:

```bash
cp .env.example .env
```

Default `DATABASE_URL`:

```text
postgresql+psycopg://reamar:reamar_password@localhost:5433/reamar
```

### 3. Set Up the Backend (Python Environment)

From the project root:

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate   # macOS
pip install --upgrade pip
pip install -e .
```

On macOS, ensure Python 3.11+ is installed (e.g. `brew install python@3.11`).

The editable install makes the `app` package importable. From `backend/` with venv active, verify with:

```bash
python -m app.main
python -m app.import_units --help
```

### 4. Run the FastAPI Application

From the `backend` directory, with your virtual environment active:

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --app-dir src --port 8001 --reload-dir src
```

> **Note**: Port 8000 may already be in use. This project uses port 8001 by default. Change `--port` if needed.  
> The `--reload-dir src` flag ensures only source code changes trigger reloads, ignoring `.venv` and other directories.

Alternatively, use the `dev` script:

```bash
cd backend
source .venv/bin/activate
./dev
```

The app will be available at `http://127.0.0.1:8001`.

#### Health Check Endpoint

Test the health check (runs `SELECT 1` against the database):

```bash
curl http://127.0.0.1:8001/health
```

Expected response when the DB is healthy:

```json
{"status":"ok"}
```

If the database is unavailable or misconfigured, the endpoint returns HTTP 503 with a JSON error payload.

#### Unit Overrides

The `/units` response applies **UnitOverride** values with highest priority. Overrides are stored as `(unit_id, field, value)` and never written back to the `units` table. The import script does not modify overrides.

**Overrideable fields**: `price_czk`, `price_per_m2_czk`, `available`, `availability_status`, `floor_area_m2`, `equivalent_area_m2`, `exterior_area_m2`.

**Example** — manually set an override:

```sql
INSERT INTO unit_overrides (unit_id, field, value)
VALUES (1, 'price_czk', '4200000'),
       (1, 'available', 'true');
```

Then `GET /units` will return that unit with `price_czk: 4200000` and `available: true` instead of the base values.

**Type conversion** (values are stored as strings): `int` for prices; `bool` (accepts true/false/1/0/yes/no); decimals rounded to 1 place. Invalid values log a warning and fall back to the base value.

**Override management (API)** — set or remove overrides and get the effective unit back:

```bash
# Set override (upsert by unit external_id + field). Replace UNIT_EXTERNAL_ID and FIELD.
curl -X PUT http://127.0.0.1:8001/units/UNIT_EXTERNAL_ID/overrides/price_czk \
  -H "Content-Type: application/json" \
  -d '{"value": "4200000"}'

# Delete override (idempotent). Returns effective unit.
curl -X DELETE http://127.0.0.1:8001/units/UNIT_EXTERNAL_ID/overrides/price_czk
```

Allowed `field` values: `price_czk`, `price_per_m2_czk`, `available`, `availability_status`, `floor_area_m2`, `equivalent_area_m2`, `exterior_area_m2`. Both endpoints return the effective unit (same schema as `GET /units`).

**Run override tests**:

```bash
cd backend
pip install -e ".[dev]"
pytest tests/test_overrides.py -v
```

### 5. Alembic Migrations

Alembic is configured to use the ORM metadata (`Base.metadata`) from `src/app/models.py`, so **autogenerate** works.

- Uses `.env` and `DATABASE_URL` via the shared `app.settings.Settings` class.
- Alembic scripts live under `backend/alembic/`.

To create and apply an initial schema migration (and for future schema changes):

```bash
cd backend
alembic revision --autogenerate -m "init schema"
alembic upgrade head
```

#### 5.1 Backfill cached project aggregates

The `project_aggregates` table stores cached per-project metrics computed from
effective unit values (base + overrides). If you add this feature to an
existing database, you should backfill aggregates once.

From the `backend` directory, with your virtual environment active:

```bash
cd backend
source .venv/bin/activate
python -m app.scripts.backfill_project_aggregates
```

This script will:

- find all distinct `project_id` values in the `units` table,
- recompute aggregates in batches of 200 projects,
- upsert rows into `project_aggregates`,
- print progress and total elapsed time.

To verify, you can inspect the table directly, for example:

```sql
SELECT COUNT(*) FROM project_aggregates;
SELECT * FROM project_aggregates LIMIT 10;
```

### 6. Import Units from JSON

The import script loads unit data from JSON files into the database.

**JSON Format**: The JSON file can be:
- A list of unit objects: `[{...}, {...}]`
- An object with `"units"` key: `{"units": [{...}, {...}]}`
- An object with `"data"` key: `{"data": [{...}, {...}]}`

**Place your JSON file** anywhere accessible (e.g., `data_sample.json` in the project root or `backend/`).

**Run the import** from the `backend` directory with your virtual environment active:

```bash
cd backend
source .venv/bin/activate
pip install -e .   # if not already installed
python -m app.import_units ../data_sample.json --source "api"
```

**Options:**
- `--source` — optional source identifier (e.g. `api`, `scraper`, `manual`)
- `--dry-run` — compute counts and timings without writing to the database
- `--chunk-size N` — process input in chunks of N units (default: 2000) to limit memory use

**Examples:**

```bash
# Preview: show what would be created/updated (no DB writes)
python -m app.import_units big.json --source api --dry-run

# Run import
python -m app.import_units big.json --source api

# Large file: process in smaller chunks
python -m app.import_units big.json --source api --chunk-size 5000
```

**What the import does:**
- Creates a `UnitSnapshot` record at the start of each (non–dry-run) run
- Upserts `Project` records by (developer, name, address) or (developer, name)
- Upserts `Unit` records by `external_id` (from `unique_id` in JSON)
- Normalizes all fields (prices, areas, GPS coordinates, booleans, etc.)
- Inserts `UnitPriceHistory` rows only when price/availability values change
- **After each import**, automatically runs **recompute of project aggregates** and **recompute of local price diffs** (odchylka od trhu)
- Prints counts (projects created/reused, units created/updated, history rows inserted), snapshot id, total time, and units/sec

### 7. Přepočet lokální odchylky od trhu

Sloupce `local_price_diff_1000m` a `local_price_diff_2000m` se po každém importu přepočítají automaticky. Pro ruční přepočet (např. po úpravě dat v DB) můžete zavolat:

```bash
curl -X POST http://127.0.0.1:8001/units/local-price-diffs/recompute
```

Nebo z UI na stránce Jednotky použijte tlačítko „Přepočítat“.

### 8. Frontend (Next.js)

Z kořene projektu:

```bash
cd frontend
npm install
npm run dev
```

Frontend běží na `http://localhost:3000`. Pro správnou komunikaci s API musí běžet backend na `http://127.0.0.1:8001` (viz `frontend/src/lib/api.ts` – `API_BASE`).

**Hlavní cesty:**
- `/units` — tabulka jednotek, filtry, řazení, export CSV
- `/projects` — přehled projektů, export CSV
- `/projects/map` — mapa projektů (barvy podle ceny m², výběr oblasti)
- `/units/[external_id]` — detail jednotky
- `/units/debug-compare` — srovnání ceny s trhem (lokální odchylka), mapa comparables
- `/projects/[id]` — detail projektu včetně seznamu jednotek

### 9. Stopping Services

- **Stop FastAPI**: Press `Ctrl+C` in the terminal where Uvicorn is running.
- **Stop Next.js**: Press `Ctrl+C` in the terminal where `npm run dev` is running.
- **Stop PostgreSQL**:

```bash
cd /path/to/reamar_ai
docker-compose down
```

### 10. Testy

```bash
cd backend
pip install -e ".[dev]"
pytest tests/ -v
```

Integrační testy v `tests/test_api_units_projects.py` volají GET `/units`, GET `/projects` a GET `/projects/search` včetně filtrů.


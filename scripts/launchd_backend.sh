#!/usr/bin/env bash
# launchd foreground wrapper for backend — run directly by com.reamar.backend.plist
# launchd keeps this process alive; no backgrounding needed

REPO="$HOME/reamar-ai"
DOCKER="$HOME/.orbstack/bin/docker"
UVICORN="$REPO/backend/.venv/bin/uvicorn"
LOG="$REPO/logs/autostart.log"

mkdir -p "$REPO/logs"
echo "[$(date)] launchd_backend: waiting for OrbStack + DB..." >> "$LOG"

# Wait up to 60s for docker + postgres
for i in $(seq 1 12); do
    if "$DOCKER" exec reamar_postgres pg_isready -U reamar -d reamar -q 2>/dev/null; then
        echo "[$(date)] launchd_backend: DB ready (attempt $i)" >> "$LOG"
        break
    fi
    sleep 5
done

if ! "$DOCKER" exec reamar_postgres pg_isready -U reamar -d reamar -q 2>/dev/null; then
    echo "[$(date)] launchd_backend: DB not ready after 60s — aborting" >> "$LOG"
    exit 1
fi

echo "[$(date)] launchd_backend: starting uvicorn on :8001" >> "$LOG"
cd "$REPO/backend"
exec "$UVICORN" app.main:app --reload --app-dir src --port 8001 --reload-dir src

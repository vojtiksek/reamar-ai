#!/usr/bin/env bash
# launchd entrypoint — waits for OrbStack to be ready, then starts the stack
# Called by ~/Library/LaunchAgents/com.reamar.stack.plist at login

REPO="$HOME/reamar-ai"
DOCKER="$HOME/.orbstack/bin/docker"
LOG="$REPO/logs/autostart.log"
LOGS="$REPO/logs"

mkdir -p "$LOGS"

echo "[$(date)] autostart: waiting for OrbStack..." >> "$LOG"

# Wait up to 60s for docker to become available
for i in $(seq 1 12); do
    if "$DOCKER" info > /dev/null 2>&1; then
        echo "[$(date)] autostart: OrbStack ready (attempt $i)" >> "$LOG"
        break
    fi
    sleep 5
done

if ! "$DOCKER" info > /dev/null 2>&1; then
    echo "[$(date)] autostart: OrbStack not available after 60s — aborting" >> "$LOG"
    exit 1
fi

# Skip if backend already running
if lsof -ti:8001 > /dev/null 2>&1; then
    echo "[$(date)] autostart: backend already running on 8001 — skipping" >> "$LOG"
    exit 0
fi

# --- DB ---
echo "[$(date)] autostart: starting DB..." >> "$LOG"
cd "$REPO"
"$DOCKER" compose up -d >> "$LOG" 2>&1
"$DOCKER" exec reamar_postgres pg_isready -U reamar -d reamar -q
echo "[$(date)] autostart: DB ready" >> "$LOG"

# --- Backend ---
UVICORN="$REPO/backend/.venv/bin/uvicorn"
NPM="/opt/homebrew/bin/npm"

echo "[$(date)] autostart: starting backend..." >> "$LOG"
echo "[$(date)] debug: UVICORN=$UVICORN, pwd=$(pwd), HOME=$HOME" >> "$LOG"
echo "[$(date)] debug: uvicorn exists=$(test -x "$UVICORN" && echo yes || echo NO)" >> "$LOG"
echo "[$(date)] debug: backend.log write test" >> "$LOGS/backend.log"
cd "$REPO/backend"
setsid "$UVICORN" app.main:app --reload --app-dir src --port 8001 --reload-dir src >> "$LOGS/backend.log" 2>&1 &
BACKEND_PID=$!
disown $BACKEND_PID
echo "[$(date)] debug: spawned PID=$BACKEND_PID" >> "$LOG"
echo $BACKEND_PID > "$LOGS/backend.pid"

# Wait up to 30s for backend to bind
for i in $(seq 1 10); do
    sleep 3
    if lsof -ti:8001 > /dev/null 2>&1; then
        echo "[$(date)] autostart: backend ready on :8001 (attempt $i)" >> "$LOG"
        break
    fi
done

if ! lsof -ti:8001 > /dev/null 2>&1; then
    echo "[$(date)] autostart: ERROR — backend failed to start, check $LOGS/backend.log" >> "$LOG"
    exit 1
fi

# --- Frontend ---
echo "[$(date)] autostart: starting frontend..." >> "$LOG"
cd "$REPO/frontend"
setsid "$NPM" run dev >> "$LOGS/frontend.log" 2>&1 &
FRONTEND_PID=$!
disown $FRONTEND_PID
echo $FRONTEND_PID > "$LOGS/frontend.pid"

# Wait up to 30s for frontend to bind
for i in $(seq 1 10); do
    sleep 3
    if lsof -ti:3001 > /dev/null 2>&1; then
        echo "[$(date)] autostart: frontend ready on :3001 (attempt $i)" >> "$LOG"
        break
    fi
done

if ! lsof -ti:3001 > /dev/null 2>&1; then
    echo "[$(date)] autostart: ERROR — frontend failed to start, check $LOGS/frontend.log" >> "$LOG"
    exit 1
fi

echo "[$(date)] autostart: stack running — backend :8001, frontend :3001" >> "$LOG"

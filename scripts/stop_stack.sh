#!/usr/bin/env bash

REPO="$HOME/reamar-ai"
LOGS="$REPO/logs"
DOCKER="$HOME/.orbstack/bin/docker"

echo "[$(date)] === Stopping Reamar stack ==="

# --- Frontend ---
if [ -f "$LOGS/frontend.pid" ]; then
    PID=$(cat "$LOGS/frontend.pid")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null && echo "[$(date)] Frontend stopped (PID $PID)"
    fi
    rm -f "$LOGS/frontend.pid"
fi
# Kill any remaining next dev on port 3001
lsof -ti:3001 | xargs kill -9 2>/dev/null && echo "[$(date)] Killed remaining processes on port 3001" || true

# --- Backend ---
if [ -f "$LOGS/backend.pid" ]; then
    PID=$(cat "$LOGS/backend.pid")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null && echo "[$(date)] Backend stopped (PID $PID)"
    fi
    rm -f "$LOGS/backend.pid"
fi
# Kill any remaining uvicorn on port 8001
lsof -ti:8001 | xargs kill -9 2>/dev/null && echo "[$(date)] Killed remaining processes on port 8001" || true

# --- DB (keep running by default) ---
echo "[$(date)] DB left running (use 'docker compose stop' to stop DB manually)"

echo "[$(date)] Stack stopped."

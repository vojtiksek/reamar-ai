#!/usr/bin/env bash
set -euo pipefail

REPO="$HOME/reamar-ai"
LOGS="$REPO/logs"
DOCKER="$HOME/.orbstack/bin/docker"

mkdir -p "$LOGS"

echo "[$(date)] === Starting Reamar stack ==="

# --- DB ---
echo "[$(date)] Starting DB..."
cd "$REPO"
$DOCKER compose up -d
$DOCKER exec reamar_postgres pg_isready -U reamar -d reamar -q
echo "[$(date)] DB ready on port 5433"

# --- Backend ---
if lsof -ti:8001 > /dev/null 2>&1; then
    echo "[$(date)] Backend already running on port 8001, skipping"
else
    echo "[$(date)] Starting backend..."
    cd "$REPO/backend"
    nohup bash dev >> "$LOGS/backend.log" 2>&1 &
    echo $! > "$LOGS/backend.pid"
    sleep 4
    if lsof -ti:8001 > /dev/null 2>&1; then
        echo "[$(date)] Backend running on http://127.0.0.1:8001"
    else
        echo "[$(date)] ERROR: backend failed to start — check $LOGS/backend.log"
        exit 1
    fi
fi

# --- Frontend ---
if lsof -ti:3001 > /dev/null 2>&1; then
    echo "[$(date)] Frontend already running on port 3001, skipping"
else
    echo "[$(date)] Starting frontend..."
    cd "$REPO/frontend"
    nohup npm run dev >> "$LOGS/frontend.log" 2>&1 &
    echo $! > "$LOGS/frontend.pid"
    sleep 6
    if lsof -ti:3001 > /dev/null 2>&1; then
        echo "[$(date)] Frontend running on http://localhost:3001"
    else
        echo "[$(date)] ERROR: frontend failed to start — check $LOGS/frontend.log"
        exit 1
    fi
fi

echo ""
echo "  Backend:  http://127.0.0.1:8001"
echo "  Frontend: http://localhost:3001"
echo "  Logs:     $LOGS/"
echo ""

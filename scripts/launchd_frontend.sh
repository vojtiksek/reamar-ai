#!/usr/bin/env bash
# launchd foreground wrapper for frontend — run directly by com.reamar.frontend.plist
# launchd keeps this process alive; no backgrounding needed

REPO="$HOME/reamar-ai"
NPM="/opt/homebrew/bin/npm"
LOG="$REPO/logs/autostart.log"

mkdir -p "$REPO/logs"
echo "[$(date)] launchd_frontend: starting Next.js on :3001" >> "$LOG"

cd "$REPO/frontend"
exec "$NPM" run dev

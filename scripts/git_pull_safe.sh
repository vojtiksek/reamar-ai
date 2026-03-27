#!/usr/bin/env bash
set -euo pipefail

REPO="$HOME/reamar-ai"
LOG="$REPO/logs/git_pull.log"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

cd "$REPO"

if git diff --quiet && git diff --cached --quiet; then
    OUTPUT=$(git pull origin main 2>&1)
    echo "[$TIMESTAMP] pulled: $OUTPUT" >> "$LOG"
else
    echo "[$TIMESTAMP] skipped (local changes)" >> "$LOG"
fi

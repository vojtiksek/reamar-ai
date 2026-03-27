#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(dirname "$0")"

echo "[$(date)] === Restarting Reamar stack ==="
bash "$SCRIPTS/stop_stack.sh"
sleep 2
bash "$SCRIPTS/start_stack.sh"

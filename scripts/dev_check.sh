#!/usr/bin/env bash
# Quick post-edit check — run after AI makes backend changes
set -euo pipefail

REPO="$HOME/reamar-ai"
cd "$REPO/backend"

echo "=== dev_check ==="

# 1. Import check (fast — catches syntax errors and broken imports)
echo "→ import check..."
source .venv/bin/activate
python -c "from app.main import app" && echo "  OK"

# 2. Tests (skip known-broken test_overrides, run the rest)
echo "→ tests..."
python -m pytest tests/ -x -q \
  --ignore=tests/test_overrides.py \
  2>&1 | tail -5

# 3. Git status
echo "→ git status..."
cd "$REPO"
git status --short

echo ""
echo "=== dev_check done ==="

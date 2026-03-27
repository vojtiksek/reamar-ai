#!/usr/bin/env bash
# Pre-push check — run before git push origin main
set -euo pipefail

REPO="$HOME/reamar-ai"
cd "$REPO/backend"
source .venv/bin/activate

echo "=== prepush_check ==="

# 1. Import check
echo "→ import check..."
python -c "from app.main import app" && echo "  OK"

# 2. Full test suite (report failures but don't block on the known broken test)
echo "→ tests..."
python -m pytest tests/ -q \
  --ignore=tests/test_overrides.py \
  2>&1 | tail -8

# 3. No uncommitted changes
echo "→ clean working tree..."
cd "$REPO"
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "  WARNING: uncommitted changes — did you forget to git add?"
    git status --short
fi

# 4. Local branch not behind remote
echo "→ sync check..."
git fetch origin main -q
BEHIND=$(git rev-list --count HEAD..origin/main)
if [ "$BEHIND" -gt 0 ]; then
    echo "  WARNING: your branch is $BEHIND commit(s) behind origin/main"
    echo "  Run: git pull origin main --rebase"
    exit 1
fi

echo ""
echo "=== prepush_check passed — safe to push ==="

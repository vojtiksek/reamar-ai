#!/usr/bin/env bash
# Probe Reamar AI backend endpoints and dump 4xx/5xx with response body.
# Usage:
#   BACKEND_API_URL=https://your-backend.railway.app BROKER_TOKEN=... scripts/probe_endpoints.sh
# Without BACKEND_API_URL falls back to http://localhost:8001.

set -u

BASE="${BACKEND_API_URL:-http://localhost:8001}"
TOKEN="${BROKER_TOKEN:-}"
AUTH_HDR=()
if [[ -n "$TOKEN" ]]; then AUTH_HDR=(-H "Authorization: Bearer $TOKEN"); fi

ENDPOINTS=(
  "/filters"
  "/notifications?days=7"
  "/projects?limit=500&offset=0&sort_by=avg_price_per_m2_czk&sort_dir=asc&availability=unseen&availability=reserved"
  "/projects?limit=50&offset=0"
  "/units?limit=50&offset=0"
  "/columns?view=projects"
  "/columns?view=units"
)

errors=0
echo "Probing $BASE"
echo "================================================================"
for path in "${ENDPOINTS[@]}"; do
  url="${BASE}${path}"
  resp=$(curl -sS -o /tmp/probe_body.$$ -w "%{http_code} %{time_total}" "${AUTH_HDR[@]}" "$url" 2>&1)
  code="${resp%% *}"
  time="${resp##* }"
  if [[ "$code" =~ ^[45] ]]; then
    errors=$((errors+1))
    echo "FAIL  $code  ${time}s  $path"
    echo "----- response body (first 80 lines) -----"
    head -n 80 /tmp/probe_body.$$
    echo
    echo "----- end body -----"
    echo
  else
    echo "OK    $code  ${time}s  $path"
  fi
done
rm -f /tmp/probe_body.$$
echo "================================================================"
echo "Failed: $errors / ${#ENDPOINTS[@]}"
exit $errors

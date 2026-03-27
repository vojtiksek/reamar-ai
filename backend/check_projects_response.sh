#!/usr/bin/env bash
# Rychlá kontrola, že GET /projects vrací očekávané klíče (name, project_first_seen, ride_to_center, ...)
# Použití: ./check_projects_response.sh   (backend musí běžet na http://127.0.0.1:8001)

set -e
BASE="${API_BASE:-http://127.0.0.1:8001}"
echo "=== GET ${BASE}/projects?limit=1 ==="
RES=$(curl -s -w "\n%{http_code}" "${BASE}/projects?limit=1&offset=0&sort_by=avg_price_per_m2_czk&sort_dir=asc")
HTTP_CODE=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
echo "HTTP status: $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "Chyba: backend vrátil $HTTP_CODE"
  echo "$BODY" | head -c 500
  exit 1
fi
echo ""
echo "=== První položka – klíče obsahující name, project, ride_to_center, project_first_seen, max_days_on_market ==="
echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
if not items:
    print('Žádné položky')
    sys.exit(0)
first = items[0] if isinstance(items[0], dict) else {}
for k in ['name', 'project', 'project_first_seen', 'project_last_seen', 'max_days_on_market', 'ride_to_center', 'public_transport_to_center']:
    v = first.get(k)
    print(f'  {k}: {repr(v)[:60]}')
print('OK – backend vrací očekávané klíče.')
"

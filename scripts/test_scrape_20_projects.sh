#!/usr/bin/env bash
# Real scraping test across ~20 projects that currently have available units.
# Picked from the shared DB on 2026-04-11, diversified by developer (max 2 per host).
# See the conversation log / selection table for id → url provenance.

set -u

cd /Users/vojta/Desktop/reamar_ai/backend
source .venv/bin/activate

# The editable install's .pth file isn't being honoured by this Python
# build, so point PYTHONPATH at the src layout explicitly. This matches
# the dev server (uvicorn --app-dir src).
export PYTHONPATH=src

# Where parsed JSON + discovery reports land (per-host subdirs).
OUT_DIR="data/scrape"
mkdir -p "$OUT_DIR"

# How many discovered unit pages to fetch per project.
FETCH=3

# 20 real projects from the DB — each has ≥62 available units today.
PROJECTS=(
  "https://www.k2invest.cz/nase-projekty/rezidence-zabelity#"
  "https://www.viasancta.cz/pricing"
  "https://www.mosaiq-beroun.cz/cenik/"
  "https://skytowers.cz/cenik"
  "https://www.satpo.cz/rezidence-escape/nabidka"
  "https://www.central-group.cz/prehled-bytu/189?layoutRoomCounts%5B0%5D=1&layoutRoomCounts%5B1%5D=2&layoutRoomCounts%5B2%5D=3&minPrice=6000000&maxPrice=16000000&floorLevels%5B0%5D=1&floorLevels%5B1%5D=2&floorLevels%5B2%5D=3&floorLevels%5B3%5D=5&housingBlockIds%5B0%5D=2344&completionDate=2999-12-31T00%3A00%3A00&sort=1&sortDirection=1&search=true"
  "https://www.namarianskeceste.cz/cs/byty-a-cenik#2"
  "https://nadskalou.cz/cs/byty/"
  "https://zahradak.cz/#pricelist"
  "https://www.dum-leopold.cz/vyber-bytu-leopold"
  "https://www.connectvrsovice.cz/cs/byty"
  "https://www.green-mb.cz/nabidka-apartmanu/"
  "https://www.proximachabry.cz/cenik"
  "https://www.kolbengate.cz/cenik"
  "https://l1fe.cz/cenik"
  "https://www.aura-statenice.cz/cenik/"
  "https://www.central-group.cz/prehled-bytu/192"
  "https://prodej.dvoryvysocany.cz/apartments/dvory/"
  "https://rezidencekolovraty.cz/cenik/bytove-domy/"
  "https://lario.cz/"
)

TOTAL=${#PROJECTS[@]}
OK=0
FAIL=0

for i in "${!PROJECTS[@]}"; do
  URL="${PROJECTS[$i]}"
  NUM=$((i + 1))
  echo "========================================"
  echo "[$NUM/$TOTAL] TESTING: $URL"
  echo "========================================"

  if python -m app.parse_units \
       --project-url "$URL" \
       --fetch "$FETCH" \
       --out "$OUT_DIR" \
       --json; then
    OK=$((OK + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  ! project $NUM failed (see output above)"
  fi
  echo
done

echo "========================================"
echo "Summary: $OK ok, $FAIL fail out of $TOTAL"
echo "Output dir: $(pwd)/$OUT_DIR"
echo "========================================"

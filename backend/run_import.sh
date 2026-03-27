#!/usr/bin/env bash
# Spustí stahování z BuiltMind API a import do DB.
# Před spuštěním: v .env nastav BUILTMIND_API_KEY (viz README).
set -e
cd "$(dirname "$0")"
if [ -z "$BUILTMIND_API_KEY" ]; then
  if [ -f ../.env ]; then
    set -a
    source ../.env
    set +a
  fi
fi
if [ -z "$BUILTMIND_API_KEY" ]; then
  echo "Chybí BUILTMIND_API_KEY. Přidej ho do .env v kořeni projektu."
  exit 1
fi

# Nastavíme PYTHONPATH, aby byl dostupný balík app (src/app)
export PYTHONPATH=src
echo "Spouštím fetch + import (BuiltMind API -> DB)..."
exec python -m app.fetch_builtmind "$@"

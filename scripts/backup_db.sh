#!/usr/bin/env bash
set -euo pipefail

DOCKER="$HOME/.orbstack/bin/docker"
CONTAINER="reamar_postgres"
DB_USER="reamar"
DB_NAME="reamar"
BACKUP_DIR="$HOME/reamar-ai/backups"
KEEP_DAYS=14

TIMESTAMP=$(date +"%Y%m%d_%H%M")
FILENAME="reamar_${TIMESTAMP}.dump"
DEST="$BACKUP_DIR/$FILENAME"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup -> $DEST"
$DOCKER exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$DEST"

SIZE=$(du -sh "$DEST" | cut -f1)
echo "[$(date)] Backup done: $FILENAME ($SIZE)"

# Keep only last KEEP_DAYS days
find "$BACKUP_DIR" -name "reamar_*.dump" -mtime +$KEEP_DAYS -delete
echo "[$(date)] Cleanup done (removed files older than $KEEP_DAYS days)"

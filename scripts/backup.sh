#!/usr/bin/env sh
# Freero database backup: a compressed, consistent pg_dump (custom format) with retention.
#
#   DATABASE_URL=postgres://user:pass@host:5432/freero scripts/backup.sh [backup-dir]
#
# Environment:
#   DATABASE_URL     required. The database to dump.
#   BACKUP_DIR       where dumps go (default: ./backups, or the first argument)
#   BACKUP_KEEP_DAYS delete dumps older than this many days (default 14; 0 keeps everything)
#   BACKUP_S3_URI    optional, e.g. s3://my-backups/freero/ — upload each dump with the aws CLI
#                    (any S3-compatible target: set AWS_ENDPOINT_URL for MinIO/R2/B2)
#   PG_DUMP          pg_dump binary (default: pg_dump). Its major version must be >= the server's.
#                    Without a local client, run it from the official image, e.g.
#                    PG_DUMP="docker run --rm --network host -e PGPASSWORD postgres:17-alpine pg_dump"
#
# Restore: docs/operations.md#restore. Uploaded files live in object storage: protect them with
# bucket versioning (+ replication), not with this script.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PG_DUMP="${PG_DUMP:-pg_dump}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/freero-$stamp.dump"
tmp="$file.partial"

echo "backup: dumping to $file"
# --format=custom: compressed, restorable selectively and in parallel with pg_restore.
# --no-owner/--no-privileges: restorable into a database with a different owner/role setup.
# shellcheck disable=SC2086 # PG_DUMP may be a command with arguments
$PG_DUMP --format=custom --compress=6 --no-owner --no-privileges --dbname="$DATABASE_URL" > "$tmp"
mv "$tmp" "$file"

# A dump that pg_restore cannot list is not a backup.
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$file" >/dev/null
fi
size="$(wc -c < "$file" | tr -d ' ')"
echo "backup: ok ($size bytes)"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  echo "backup: uploading to $BACKUP_S3_URI"
  aws s3 cp "$file" "${BACKUP_S3_URI%/}/$(basename "$file")"
fi

if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_DIR" -maxdepth 1 -name 'freero-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete |
    sed 's/^/backup: pruned /'
fi

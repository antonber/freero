#!/usr/bin/env sh
# Freero database backup: a compressed, consistent pg_dump (custom format) with retention,
# optionally encrypted to a public key before it leaves the machine.
#
#   DATABASE_URL=postgres://user:pass@host:5432/freero scripts/backup.sh [backup-dir]
#
# Environment:
#   DATABASE_URL          required. The database to dump.
#   BACKUP_DIR            where dumps go (default: ./backups, or the first argument)
#   BACKUP_KEEP_DAYS      delete dumps older than this many days (default 14; 0 keeps everything)
#   BACKUP_S3_URI         optional, e.g. s3://my-backups/freero/ — upload each dump with the aws CLI
#                         (any S3-compatible target: set AWS_ENDPOINT_URL for MinIO/R2/B2)
#   BACKUP_GPG_RECIPIENT  optional: encrypt each dump to this GnuPG key (id, fingerprint or email;
#                         its PUBLIC key must be in the keyring) → freero-<stamp>.dump.gpg
#   BACKUP_AGE_RECIPIENT  optional, instead: encrypt with age to this recipient (age1… or an ssh
#                         public key) → freero-<stamp>.dump.age
#   PG_DUMP               pg_dump binary (default: pg_dump). Its major version must be >= the server's.
#                         Without a local client, run it from the official image, e.g.
#                         PG_DUMP="docker run --rm --network host -e PGPASSWORD postgres:17-alpine pg_dump"
#
# With a recipient set, only the encrypted file is kept or uploaded: the plain dump exists only
# while it is checked (owner-only permissions) and is deleted right after encrypting. The private
# key never needs to be on this machine; keep it offline and test a restore with it
# (docs/operations.md#restore, "Encrypted dumps").
#
# Restore: docs/operations.md#restore. Uploaded files live in object storage: protect them with
# bucket versioning (+ replication), not with this script.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PG_DUMP="${PG_DUMP:-pg_dump}"
GPG_TO="${BACKUP_GPG_RECIPIENT:-}"
AGE_TO="${BACKUP_AGE_RECIPIENT:-}"

if [ -n "$GPG_TO" ] && [ -n "$AGE_TO" ]; then
  echo "backup: set BACKUP_GPG_RECIPIENT or BACKUP_AGE_RECIPIENT, not both" >&2
  exit 2
fi
# Fail before dumping when the encryption tool or key is missing: never fall back to plain text.
if [ -n "$GPG_TO" ]; then
  command -v gpg >/dev/null 2>&1 || { echo "backup: BACKUP_GPG_RECIPIENT is set but gpg is not installed" >&2; exit 2; }
  gpg --batch --list-keys "$GPG_TO" >/dev/null 2>&1 || { echo "backup: no public key for BACKUP_GPG_RECIPIENT in the keyring (gpg --import it first)" >&2; exit 2; }
fi
if [ -n "$AGE_TO" ]; then
  command -v age >/dev/null 2>&1 || { echo "backup: BACKUP_AGE_RECIPIENT is set but age is not installed" >&2; exit 2; }
fi

# Dumps hold every account and board: readable by this user only.
umask 077
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

if [ -n "$GPG_TO" ]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_TO" --output "$file.gpg" "$file"
  rm -f "$file"
  file="$file.gpg"
  echo "backup: encrypted to $GPG_TO ($file)"
elif [ -n "$AGE_TO" ]; then
  age --encrypt --recipient "$AGE_TO" --output "$file.age" "$file"
  rm -f "$file"
  file="$file.age"
  echo "backup: encrypted with age ($file)"
fi

if [ -n "${BACKUP_S3_URI:-}" ]; then
  echo "backup: uploading to $BACKUP_S3_URI"
  aws s3 cp "$file" "${BACKUP_S3_URI%/}/$(basename "$file")"
fi

if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_DIR" -maxdepth 1 \( -name 'freero-*.dump' -o -name 'freero-*.dump.gpg' -o -name 'freero-*.dump.age' \) -type f -mtime +"$KEEP_DAYS" -print -delete |
    sed 's/^/backup: pruned /'
fi

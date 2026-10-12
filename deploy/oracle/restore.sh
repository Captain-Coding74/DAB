#!/usr/bin/env bash
# deploy/oracle/restore.sh — v21.32: put a backup made by backup.sh, or an
# export from Railway, back into DAB's data volume. When and how to use it:
# docs/deploy/oracle-always-free.md, steps 11 and 12.
#
#   ./restore.sh -i ~/dab-backup-key.txt dab-20261012T193000Z.tar.gz.age
#   ./restore.sh ~/dab-export        # a directory holding app.db and objects.tar
#
# Run it from the directory that holds compose.yml and .env (or set
# COMPOSE_DIR). For a restore drill beside a running copy, set
# COMPOSE_PROJECT_NAME=dab-drill so the drill gets volumes of its own.
#
# What it does:
#   1. Decrypts and unpacks the archive into a private temporary directory
#      (or uses the directory given), and checks SHA256SUMS when present.
#   2. Stops DAB. Caddy keeps running and answers 502 in the meantime.
#   3. In a one-off container on the same volume, moves any current data to
#      replaced-<time>/ inside the volume. Nothing is deleted, so a wrong
#      archive can be undone. It then copies the database in, unpacks
#      objects.tar, and hands everything to appuser, the user the server
#      runs as.
#   4. Checks the database with PRAGMA integrity_check, then starts DAB and
#      waits until it is healthy.
#
# It does not touch .env. Files sealed under one STORAGE_ENCRYPTION_KEY open
# only with that key, so on a new machine copy the backup's `env` file to
# .env first.
set -euo pipefail
umask 077

usage() { echo "usage: $0 [-i AGE_PRIVATE_KEY_FILE] BACKUP.tar.gz.age | DIRECTORY" >&2; exit 2; }
log() { printf 'restore: %s\n' "$*"; }
die() { printf 'restore: ERROR: %s\n' "$*" >&2; exit 1; }

identity=""
while getopts 'i:' opt; do
  case "$opt" in
    i) identity="$OPTARG" ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))
[ $# -eq 1 ] || usage
src="$1"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$script_dir}"
[ -f "$COMPOSE_DIR/compose.yml" ] || die "no compose.yml in $COMPOSE_DIR"
dc() { docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/compose.yml" "$@"; }

# ── 1. Unpack and check ───────────────────────────────────
tmp=""
cleanup() { if [ -n "$tmp" ] && [ -d "$tmp" ]; then rm -rf -- "$tmp"; fi; }
trap cleanup EXIT
if [ -d "$src" ]; then
  dir="$(cd "$src" && pwd)"
elif [ -f "$src" ]; then
  [ -n "$identity" ] || die "$src is encrypted: pass the private key with -i"
  command -v age >/dev/null || die "'age' is not installed"
  tmp="$(mktemp -d)"
  log "decrypting $(basename "$src")"
  age -d -i "$identity" "$src" | tar -xz -C "$tmp"
  dir="$tmp"
else
  die "no such file or directory: $src"
fi
[ -f "$dir/app.db" ] || die "$src has no app.db"
[ -f "$dir/objects.tar" ] || die "$src has no objects.tar"
if [ -f "$dir/SHA256SUMS" ]; then
  (cd "$dir" && sha256sum -c --quiet SHA256SUMS) || die "SHA256SUMS does not match: the archive is damaged"
  log "checksums match"
fi
[ ! -f "$dir/MANIFEST" ] || sed 's/^/  /' "$dir/MANIFEST"

# ── 2.–3. Swap the data ───────────────────────────────────
log "stopping dab"
dc stop dab

# Runs as root in a throwaway container: a new volume can be written by its
# owner (appuser) only, and moving data aside needs both owners' files.
# shellcheck disable=SC2016  # expanded by the container's sh, not here
swap='
  set -e
  cd /app/backend/data
  if [ -e app.db ] || [ -d objects ]; then
    old="replaced-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir "$old"
    for f in app.db app.db-journal app.db-wal app.db-shm objects; do
      if [ -e "$f" ]; then mv "$f" "$old/"; fi
    done
    echo "restore: the data that was here is now in $old/ inside the volume"
  fi
  cp /restore/app.db app.db
  tar -xf /restore/objects.tar
  chown -R appuser:appgroup /app/backend/data
'
dc run --rm --no-deps --user root -v "$dir:/restore:ro" dab sh -c "$swap"

# ── 4. Check, then start ──────────────────────────────────
check='
  import { createClient } from "@libsql/client";
  const db = createClient({ url: "file:/app/backend/data/app.db" });
  const { rows } = await db.execute("PRAGMA integrity_check");
  if (rows.length !== 1 || rows[0][0] !== "ok") { console.error(JSON.stringify(rows.slice(0, 5))); process.exit(1); }
'
dc run --rm --no-deps dab node --input-type=module -e "$check" || die "the restored database fails integrity_check. DAB is left stopped"
log "database OK, starting"
# Caddy waits for DAB to report healthy (compose.yml), so this returns when
# the site answers again, or fails if DAB cannot start.
dc up -d
log "done. Sign in and open a saved dataset to check."
log "If these files were saved before STORAGE_ENCRYPTION_KEY was set (data from Railway, say), seal them now:"
log "  docker compose exec dab node src/scripts/storage-encrypt.mjs && docker compose restart dab"

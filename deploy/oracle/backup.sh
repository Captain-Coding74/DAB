#!/usr/bin/env bash
# deploy/oracle/backup.sh — v21.32: DAB's nightly backup, encrypted and sent
# OFF Oracle. Setup, scheduling and the restore steps are in
# docs/deploy/oracle-always-free.md, step 12.
#
# Why off Oracle: the VM, its volumes, its volume backups and any Object
# Storage copies all sit in one Oracle account, and one suspension takes all
# of them at once. Only a copy held somewhere else survives that.
#
# One run, in this order:
#   1. A consistent copy of the SQLite database. VACUUM INTO runs inside the
#      DAB container, through the same libsql driver the server uses: the
#      image has no sqlite3 program, and `cp` of a database that is being
#      written can copy half a transaction. The copy must pass
#      PRAGMA integrity_check.
#   2. A tar of objects/ (the uploaded files; each is already sealed with
#      AES-256-GCM when STORAGE_ENCRYPTION_KEY is set).
#   3. The .env, unless INCLUDE_ENV=0. A restore needs STORAGE_ENCRYPTION_KEY
#      to read objects/, and the JWT secrets to keep everyone signed in.
#   4. A MANIFEST and SHA256SUMS, then all of it as one tar.gz encrypted with
#      age to a PUBLIC key. The private key never sits on this server, so a
#      stolen server, disk or bucket cannot open any backup.
#   5. Upload with rclone. Then local copies older than KEEP_LOCAL_DAYS are
#      deleted, and remote ones too if REMOTE_KEEP_DAYS is set.
#
# The database is copied before the objects. An upload that lands between
# the two steps leaves an object no row points to, which is harmless. The
# other order would leave a row whose file is missing from the archive.
#
# Settings: environment variables, or a backup.env file next to this script
# (BACKUP_ENV=/path overrides that location):
#   RCLONE_REMOTE     required. Where archives go, e.g. offsite:dab-backups/oracle
#                     (a remote from `rclone config`), or a local directory for
#                     a trial run. There is no "skip": a backup that never
#                     leaves this VM does not protect against losing the account.
#   AGE_RECIPIENTS    file of age public keys (default: backup-recipients.txt
#                     next to this script)
#   COMPOSE_DIR       directory holding compose.yml and .env (default: this
#                     script's directory)
#   BACKUP_DIR        local archive directory (default /var/backups/dab)
#   KEEP_LOCAL_DAYS   default 7
#   REMOTE_KEEP_DAYS  default 0 = never delete remotely. Prefer a lifecycle
#                     rule on the bucket, so this server's key needs no
#                     delete permission.
#   INCLUDE_ENV       default 1
#   RCLONE_FLAGS      extra rclone flags, e.g. --s3-no-check-bucket
#   RCLONE_CONFIG     rclone's own setting: path to its config file
#   PING_URL          optional dead-man's switch (e.g. healthchecks.io). The
#                     script requests the URL after a successful run, and
#                     <PING_URL>/fail after a failed one.
#
# It prints no secrets. There is no `set -x`, the .env is copied without
# being read, and PING_URL is never printed. The log names only the rclone
# remote (the part before the colon). rclone's own error messages may name
# the bucket, never the keys, which stay in rclone's config file.
set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_env="${BACKUP_ENV:-$script_dir/backup.env}"
if [ -f "$backup_env" ]; then
  # set -a exports what the file sets, so rclone sees RCLONE_CONFIG too.
  set -a
  # shellcheck source=/dev/null
  . "$backup_env"
  set +a
fi

COMPOSE_DIR="${COMPOSE_DIR:-$script_dir}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dab}"
AGE_RECIPIENTS="${AGE_RECIPIENTS:-$script_dir/backup-recipients.txt}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-0}"
INCLUDE_ENV="${INCLUDE_ENV:-1}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
PING_URL="${PING_URL:-}"
read -r -a rclone_flags <<< "${RCLONE_FLAGS:-}"

# The volume mount in compose.yml. db/pool.js resolves the same directory
# (SQLITE_DIR, or backend/data next to the code).
DATA_DIR=/app/backend/data

log() { printf 'backup: %s\n' "$*"; }
die() { printf 'backup: ERROR: %s\n' "$*" >&2; exit 1; }

dc() { docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/compose.yml" "$@"; }

ping_url() {   # $1 = "" or "/fail". Never printed: the URL is a credential.
  [ -n "$PING_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${PING_URL%/}$1" || log "warning: the ping did not go through"
}

# ── Checks before touching anything ───────────────────────
for cmd in docker age rclone gzip tar sha256sum flock curl; do
  command -v "$cmd" >/dev/null || die "'$cmd' is not installed (guide, step 12)"
done
[ -n "$RCLONE_REMOTE" ] || die "RCLONE_REMOTE is not set (in $backup_env or the environment)"
[ -s "$AGE_RECIPIENTS" ] || die "no age public key in $AGE_RECIPIENTS"
if grep -q 'AGE-SECRET-KEY' "$AGE_RECIPIENTS"; then
  die "$AGE_RECIPIENTS holds a PRIVATE key: delete it from this server and copy only the public key (age1…)"
fi
grep -q '^age1' "$AGE_RECIPIENTS" || die "$AGE_RECIPIENTS holds no age public key (a line starting age1…)"
[ -f "$COMPOSE_DIR/compose.yml" ] || die "no compose.yml in $COMPOSE_DIR"
case "$KEEP_LOCAL_DAYS$REMOTE_KEEP_DAYS" in
  *[!0-9]*) die "KEEP_LOCAL_DAYS and REMOTE_KEEP_DAYS must be whole numbers" ;;
  *) ;;
esac
[ "$REMOTE_KEEP_DAYS" -eq 0 ] || [ "$REMOTE_KEEP_DAYS" -ge 2 ] || die "REMOTE_KEEP_DAYS must be 0 (keep) or at least 2"

mkdir -p "$BACKUP_DIR"
# One run at a time: a slow upload must not overlap the next night's run.
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || die "another backup is still running"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="dab-$stamp.tar.gz.age"
work="$(mktemp -d "$BACKUP_DIR/.work-XXXXXX")"
snap="/tmp/dab-backup-$stamp.db"   # inside the container
started=$SECONDS

finish() {
  status=$?
  rm -rf "$work" "$BACKUP_DIR/$name.partial"
  dc exec -T dab rm -f "$snap" >/dev/null 2>&1 || true
  if [ "$status" -eq 0 ]; then ping_url ""; else log "FAILED (exit $status)"; ping_url "/fail"; fi
}
trap finish EXIT

dc exec -T dab true 2>/dev/null || die "the dab container is not running (docker compose ps)"

# ── 1. The database ───────────────────────────────────────
log "copying the database"
# shellcheck disable=SC2016  # JavaScript, not shell: ${src} is a template literal
dc exec -T dab node --input-type=module -e '
  import { createClient } from "@libsql/client";
  import { sqliteFile } from "/app/backend/src/db/pool.js";
  import { rmSync } from "node:fs";
  const [out, dataDir] = process.argv.slice(1);
  const src = sqliteFile();
  // The objects tar reads dataDir; a database somewhere else (SQLITE_DIR set
  // in .env) would also live outside the volume that compose.yml keeps.
  if (!src.startsWith(dataDir + "/")) throw new Error(`the database is at ${src}, outside ${dataDir}`);
  rmSync(out, { force: true });
  const db = createClient({ url: `file:${src}` });
  await db.execute({ sql: "VACUUM INTO ?", args: [out] });
  db.close();
  const copy = createClient({ url: `file:${out}` });
  const { rows } = await copy.execute("PRAGMA integrity_check");
  copy.close();
  if (rows.length !== 1 || rows[0][0] !== "ok") throw new Error("integrity_check: " + JSON.stringify(rows.slice(0, 5)));
' "$snap" "$DATA_DIR"
dc exec -T dab cat "$snap" > "$work/app.db"
dc exec -T dab rm -f "$snap"

# ── 2. The stored files ───────────────────────────────────
log "copying stored files"
if dc exec -T dab test -d "$DATA_DIR/objects"; then
  dc exec -T dab tar -C "$DATA_DIR" -cf - objects > "$work/objects.tar"
else
  tar -cf "$work/objects.tar" -T /dev/null   # no upload saved yet
fi

# ── 3. The settings ───────────────────────────────────────
case "$INCLUDE_ENV" in
  1) [ -f "$COMPOSE_DIR/.env" ] || die "no .env in $COMPOSE_DIR"
     cp "$COMPOSE_DIR/.env" "$work/env" ;;
  0) ;;
  *) die "INCLUDE_ENV must be 0 or 1" ;;
esac

# ── 4. Describe, pack, encrypt ────────────────────────────
# What a restore needs to know: which image wrote this data (a newer image
# migrates the schema forward on boot; an older one may not read it).
health="$(dc exec -T dab wget -qO- http://localhost:3000/api/health 2>/dev/null || echo unavailable)"
cid="$(dc ps -q dab)"
image="$(docker inspect --format '{{.Config.Image}}' "$cid")"
image_id="$(docker inspect --format '{{.Image}}' "$cid")"
digests="$(docker image inspect --format '{{join .RepoDigests " "}}' "$image_id")"
files="$(tar -tf "$work/objects.tar" | grep -vc '/$' || true)"
contents="app.db (VACUUM INTO copy), objects.tar (of $DATA_DIR/objects)"
[ "$INCLUDE_ENV" = 0 ] || contents="$contents, env (the .env)"
{
  echo "created: $stamp"
  echo "image: $image"
  echo "image id: $image_id"
  echo "image digest: ${digests:-none (built locally)}"
  echo "health: $health"
  echo "stored files: $files"
  echo "contents: $contents"
} > "$work/MANIFEST"
(cd "$work" && sha256sum -- * > SHA256SUMS)

log "encrypting"
tar -C "$work" -cf - . | gzip -6 | age -R "$AGE_RECIPIENTS" -o "$BACKUP_DIR/$name.partial"
mv "$BACKUP_DIR/$name.partial" "$BACKUP_DIR/$name"
size="$(du -h "$BACKUP_DIR/$name" | cut -f1)"

# ── 5. Off the server, then prune ─────────────────────────
log "uploading $name ($size) to ${RCLONE_REMOTE%%:*}"
rclone copy "${rclone_flags[@]}" "$BACKUP_DIR/$name" "$RCLONE_REMOTE"
# copy checks size and hash after the transfer. lsf proves it can be listed.
rclone lsf "${rclone_flags[@]}" --include "$name" "$RCLONE_REMOTE" | grep -qx "$name" \
  || die "the upload finished but $name is not on the remote"

if [ "$REMOTE_KEEP_DAYS" -gt 0 ]; then
  rclone delete "${rclone_flags[@]}" --min-age "${REMOTE_KEEP_DAYS}d" --include 'dab-*.tar.gz.age' "$RCLONE_REMOTE"
fi
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dab-*.tar.gz.age' -mtime +"$KEEP_LOCAL_DAYS" -delete

log "done: $name, $size, $((SECONDS - started)) s"

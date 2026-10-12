#!/usr/bin/env bash
# v21.32: proves a built image RUNS on its platform, not just that it built.
# CI's Docker Build job runs it against the linux/amd64 and the linux/arm64
# image (the second under QEMU); locally:
#
#   docker buildx build --platform linux/arm64 -f backend/Dockerfile -t dab:arm64 --load .
#   scripts/docker-smoke.sh dab:arm64 linux/arm64
#
# The Dockerfile installs the target's libsql binary on the build machine
# without ever loading it, so a wrong --cpu, or a glibc build on Alpine, would
# pass the build and fail at a user's first query. Checks:
#   1. the native driver loads, for the expected CPU, and runs `select 1`;
#   2. the server boots with NODE_ENV=production (the image default) and
#      /api/health answers 200;
#   3. GET / serves the built UI, and an anonymous POST /api/analyze of a
#      sample CSV answers 200 (parsing, statistics, a SQLite write).
# The server boots while check 1 runs: emulated, each Node start costs
# seconds, and this runs on every push.
set -euo pipefail

image="${1:?usage: scripts/docker-smoke.sh IMAGE [linux/amd64|linux/arm64]}"
platform="${2:-}"
sample="$(cd "$(dirname "$0")/.." && pwd)/backend/sample-data/thai_shop.csv"

plat=()
expect_arch=""
case "$platform" in
  "")          ;;
  linux/amd64) plat=(--platform "$platform"); expect_arch=x64 ;;
  linux/arm64) plat=(--platform "$platform"); expect_arch=arm64 ;;
  *) echo "unsupported platform: $platform" >&2; exit 2 ;;
esac

t0=$SECONDS
step() { printf '[%s %3ss] %s\n' "${platform:-native}" "$((SECONDS - t0))" "$*"; }

# ── 2 (started first). The server, in production mode ────
# Production refuses to start without both JWT secrets (auth.js); AI_MOCK and
# RATE_LIMIT_MAX are refused there too, so neither is set. No Anthropic key:
# the client is only constructed at boot, and anonymous analysis never calls it.
cid="$(docker run -d "${plat[@]}" -p 127.0.0.1::3000 \
  -e JWT_SECRET=docker-smoke-access-secret-not-for-real-use \
  -e JWT_REFRESH_SECRET=docker-smoke-refresh-secret-not-for-real-use \
  "$image")"
body_file="$(mktemp)"
cleanup() { docker rm -f "$cid" >/dev/null 2>&1 || true; rm -f "$body_file"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; echo "── container log ──" >&2; docker logs "$cid" >&2 || true; exit 1; }

# ── 1. libsql loads and answers ───────────────────────────
docker run --rm "${plat[@]}" -e EXPECT_ARCH="$expect_arch" "$image" \
  node --input-type=module -e '
    import { createClient } from "@libsql/client";
    const want = process.env.EXPECT_ARCH;
    if (want && process.arch !== want) throw new Error(`running as ${process.arch}, expected ${want}`);
    const db = createClient({ url: ":memory:" });
    const { rows } = await db.execute("select 1 as one");
    if (Number(rows[0]?.one) !== 1) throw new Error("select 1 returned " + JSON.stringify(rows));
    console.log(`libsql select 1 OK (${process.platform}-${process.arch}, node ${process.version})`);
  '
step "native driver OK"

# ── 2. /api/health ────────────────────────────────────────
port="$(docker port "$cid" 3000/tcp | head -n1 | sed 's/.*://')"
base="http://127.0.0.1:$port"
# Emulated Node boots in about 20 s; 90 s is the ceiling, not the wait.
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "$base/api/health" 2>/dev/null; then break; fi
  [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = true ] || fail "the container exited during boot"
  sleep 1
done
health="$(curl -fsS "$base/api/health")" || fail "/api/health never answered 200"
step "GET /api/health 200 $health"

# ── 3. the UI and one real request ────────────────────────
curl -fsS "$base/" | grep -q '<div id="root"' || fail "GET / did not serve the built UI"
step "GET / serves the UI"

code="$(curl -sS -o "$body_file" -w '%{http_code}' -F "file=@$sample;type=text/csv" "$base/api/analyze")"
body="$(cat "$body_file")"
[ "$code" = 200 ] || fail "POST /api/analyze answered $code: ${body:0:300}"
grep -q '"success":true' <<<"$body" || fail "POST /api/analyze answered 200 without success: ${body:0:300}"
step "POST /api/analyze 200 ($(grep -o '"rows":[0-9]*' <<<"$body" | head -n1), $(grep -o '"columns":[0-9]*' <<<"$body" | head -n1))"

echo "smoke OK: $image ${platform:-(native)} in $((SECONDS - t0)) s"

# ── Build stage ───────────────────────────────────────────
# NOTE: the build context is the REPO ROOT, not backend/. This is an npm
# workspaces project — the only package-lock.json lives at the root, so a
# context of ./backend gave `npm ci` nothing to install from ("can only
# install with an existing package-lock.json"). Same assumption that broke
# the CI jobs before v21. Consumers of this context: .github/workflows/ci.yml
# and docker-compose.yml — change all three together.
#
# v21.32: the image is built for linux/amd64 AND linux/arm64 (Oracle's free
# Ampere A1 VMs are Arm). Both build stages run on the BUILD machine's own
# platform, never under emulation: under QEMU the two npm ci runs and the Vite
# build took 68 + 84 + 100 s (natively 9 + 11 + 9 s), and what they produce
# is plain JavaScript. The one exception is libsql's native binary, so the
# backend's dependencies are installed FOR the target with npm's
# --os/--cpu/--libc, which picks @libsql/linux-<cpu>-* from the lockfile
# without running anything built for that CPU; the result is byte-for-byte
# the node_modules an emulated `npm ci` produced. --ignore-scripts: no
# production dependency needs an install script to work — the one that has
# one, @scarf/scarf, only phones home, and ADR-0008 wants install-time code
# off anyway — and a script built for the target could not run here.
#
# `:-linux`: BuildKit always sets BUILDPLATFORM; the legacy builder
# (DOCKER_BUILDKIT=0) sets none of these and failed on the empty --platform.
# A bare "linux" means "this daemon's own architecture".
FROM --platform=${BUILDPLATFORM:-linux} node:22-alpine AS builder
# Docker's arch names to Node's. Empty under the legacy builder, which builds
# for its own platform only: fall back to that. Any other arch has no libsql
# binary in the lockfile, so refuse it here rather than ship an image whose
# database driver fails at the first query.
ARG TARGETARCH
WORKDIR /app

# Manifests first so the layer caches until dependencies actually change.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN arch="${TARGETARCH:-$(node -p process.arch)}" \
 && case "$arch" in \
      amd64|x64) cpu=x64 ;; \
      arm64)     cpu=arm64 ;; \
      *) echo "Unsupported target architecture '$arch': DAB builds for amd64 and arm64 only" >&2; exit 1 ;; \
    esac \
 && npm ci --omit=dev -w backend --os=linux --cpu="$cpu" --libc=musl --ignore-scripts

# ── Frontend build stage ──────────────────────────────────
# The image used to ship the backend ONLY, and docker-compose bind-mounted
# ./frontend/dist to /app/public while app.js read /app/frontend/dist — so a
# container served no UI whatsoever and /api was the only thing answering.
# A container host (Azure, Fly, Cloud Run) has no local dist to mount at all,
# which pushed the frontend onto separate static hosting where /api/* then hit
# storage instead of this server. The image now builds and carries the UI, so
# one container serves both. Dev dependencies are needed here (vite).
# v21.32: the build platform too — dist/ is the same files for every target,
# so a multi-platform build runs this stage once and both images share it.
FROM --platform=${BUILDPLATFORM:-linux} node:22-alpine AS webbuilder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci -w frontend
COPY frontend ./frontend
RUN npm run build -w frontend

# ── Runtime stage ─────────────────────────────────────────
# The TARGET platform: this is the image that runs. Its only RUN step comes
# before the copies, so a code change re-runs nothing here under emulation.
FROM node:22-alpine AS runner
WORKDIR /app

# v21.32: everything under /app still belongs to appuser — data volumes
# created by earlier images stay writable — but the copies below now set the
# owner themselves. The old `chown -R /app` after them rewrote every file
# into a second 132 MB layer (the image carried node_modules twice) and, for
# arm64, walked 7,600 files under QEMU after every code change.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
 && mkdir -p /app/backend/data && chown -R appuser:appgroup /app

# Workspaces hoist to the root node_modules; Node resolves upward from
# /app/backend/src, so this one copy covers the backend's dependencies.
COPY --chown=appuser:appgroup --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup backend ./backend
# The built UI, at the path app.js resolves to (/app/frontend/dist).
COPY --chown=appuser:appgroup --from=webbuilder /app/frontend/dist ./frontend/dist

USER appuser
WORKDIR /app/backend

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/server.js"]

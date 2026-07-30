# ── Build stage ───────────────────────────────────────────
# NOTE: the build context is the REPO ROOT, not backend/. This is an npm
# workspaces project — the only package-lock.json lives at the root, so a
# context of ./backend gave `npm ci` nothing to install from ("can only
# install with an existing package-lock.json"). Same assumption that broke
# the CI jobs before v21. Consumers of this context: .github/workflows/ci.yml
# and docker-compose.yml — change all three together.
FROM node:22-alpine AS builder
WORKDIR /app

# Manifests first so the layer caches until dependencies actually change.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --omit=dev -w backend

# ── Runtime stage ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Workspaces hoist to the root node_modules; Node resolves upward from
# /app/backend/src, so this one copy covers the backend's dependencies.
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY backend ./backend

RUN mkdir -p /app/backend/data && chown -R appuser:appgroup /app

USER appuser
WORKDIR /app/backend

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/server.js"]

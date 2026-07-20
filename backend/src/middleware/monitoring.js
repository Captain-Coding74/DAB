/**
 * src/middleware/monitoring.js — Lightweight monitoring
 *
 * Exposes GET /api/metrics with:
 *   - Request counts per route + status code
 *   - Latency percentiles (p50, p95, p99)
 *   - Error rate
 *   - Memory + uptime
 *   - Cache stats
 *   - DB backend
 *
 * No external service needed — works standalone.
 * In production, scrape /api/metrics with Prometheus/Grafana.
 */

import { cache }     from "../services/cache.js";
import { getBackend } from "../db/pool.js";
import { logger }    from "../logger.js";

// ── In-memory metrics store ───────────────────────────────
const metrics = {
  startTime:   Date.now(),
  requests:    {},   // { "GET /api/health": { count, errors, latencies[] } }
  totalReqs:   0,
  totalErrors: 0,
};

const MAX_LATENCIES = 1000; // ring buffer per route

function getRoute(req) {
  // Normalise dynamic segments: /api/history/abc123 → /api/history/:id
  return req.route?.path
    ? `${req.method} ${req.baseUrl || ""}${req.route.path}`
    : `${req.method} ${req.path.replace(/\/[0-9a-f-]{36}/g, "/:id").replace(/\/\d+/g, "/:n")}`;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p / 100)];
}

// ── Request timing middleware ─────────────────────────────
export function requestMetrics(req, res, next) {
  const start = performance.now();

  res.on("finish", () => {
    const ms    = Math.round(performance.now() - start);
    const route = getRoute(req);
    const isErr = res.statusCode >= 400;

    metrics.totalReqs++;
    if (isErr) metrics.totalErrors++;

    if (!metrics.requests[route]) {
      metrics.requests[route] = { count: 0, errors: 0, latencies: [] };
    }
    const r = metrics.requests[route];
    r.count++;
    if (isErr) r.errors++;
    r.latencies.push(ms);
    if (r.latencies.length > MAX_LATENCIES) r.latencies.shift();
  });

  next();
}

// ── /api/metrics handler ──────────────────────────────────
export async function metricsHandler(req, res) {
  const uptimeSec = Math.round((Date.now() - metrics.startTime) / 1000);
  const mem       = process.memoryUsage();

  // Per-route summary
  const routes = Object.entries(metrics.requests).map(([route, r]) => ({
    route,
    count:    r.count,
    errors:   r.errors,
    errorPct: r.count ? ((r.errors / r.count) * 100).toFixed(1) + "%" : "0%",
    p50:      percentile(r.latencies, 50),
    p95:      percentile(r.latencies, 95),
    p99:      percentile(r.latencies, 99),
  }));

  const cacheStats = await cache.stats().catch(() => ({}));

  res.json({
    status:       "ok",
    version:      process.env.npm_package_version || "13.0.0",
    uptime:       `${Math.floor(uptimeSec/3600)}h ${Math.floor((uptimeSec%3600)/60)}m`,
    uptimeSec,
    db:           getBackend(),
    cache:        cacheStats,
    totals: {
      requests:   metrics.totalReqs,
      errors:     metrics.totalErrors,
      errorPct:   metrics.totalReqs ? ((metrics.totalErrors / metrics.totalReqs) * 100).toFixed(2) + "%" : "0%",
    },
    memory: {
      heapUsedMB:  (mem.heapUsed  / 1024 / 1024).toFixed(1),
      heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
      rssMB:       (mem.rss       / 1024 / 1024).toFixed(1),
    },
    routes: routes.sort((a, b) => b.count - a.count),
    timestamp: new Date().toISOString(),
  });
}

// ── Error tracking ────────────────────────────────────────
export function errorHandler(err, req, res, next) {
  metrics.totalErrors++;
  logger.error({ err, url: req.url, method: req.method, userId: req.user?.userId }, "Unhandled error");

  if (res.headersSent) return next(err);

  // v13 (found by E2E): upload rejections are client errors, not server errors.
  // Multer's fileFilter and limit errors were surfacing as 500s in production
  // while testApp mapped them to 400 — a prod/test drift.
  const isUploadReject =
    err.code === "LIMIT_FILE_SIZE" ||
    /only$|only\b|CSV\/Excel|file too large/i.test(err.message || "");

  const status = err.status || err.statusCode || (isUploadReject ? 400 : 500);
  res.status(status).json({
    error:     process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    requestId: req.id,
  });
}

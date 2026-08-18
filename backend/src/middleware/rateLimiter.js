/**
 * src/middleware/rateLimiter.js — Per-user + per-IP rate limiting
 *
 * Two layers:
 *   1. IP-based  — anonymous protection (express-rate-limit)
 *   2. User-based — authenticated users get higher limits
 *      stored in Redis (or in-memory fallback)
 *
 * Limits:
 *   Anonymous:    30 req / 15 min
 *   Authenticated: 100 req / 15 min
 *   Heavy (analyze): 20 req / 15 min (anon), 50 req / 15 min (auth)
 *   Slow-down:    after 80% of limit, add 500ms delay per request
 */

import rateLimit  from "express-rate-limit";
import slowDown   from "express-slow-down";
import { cache, cacheKey } from "../services/cache.js";
import { serviceLogger }   from "../logger.js";

const log = serviceLogger("rate-limiter");

// ── Custom Redis/memory store for express-rate-limit ──────
function makeStore(prefix, windowMs) {
  return {
    async increment(key) {
      const ckey     = `${prefix}:${key}`;
      const existing = await cache.get(ckey);
      // Re-create the entry once its window has passed even if the cache kept
      // it alive, and — critically — arm the TTL from the REMAINING window,
      // not a fresh full one. Re-setting a full TTL on every hit turned the
      // fixed window into a never-expiring one: a client trickling requests
      // kept its count forever and stayed blocked long past resetTime.
      const fresh = !existing || existing.reset <= Date.now();
      const count = fresh ? 1 : existing.count + 1;
      const reset = fresh ? Date.now() + windowMs : existing.reset;
      await cache.set(ckey, { count, reset }, Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
      return { totalHits: count, resetTime: new Date(reset) };
    },
    async decrement(key) {
      const ckey = `${prefix}:${key}`;
      const val  = await cache.get(ckey);
      if (val && val.count > 0) {
        await cache.set(ckey, { ...val, count: val.count - 1 }, Math.max(1, Math.ceil((val.reset - Date.now()) / 1000)));
      }
    },
    async resetKey(key) {
      await cache.del(`${prefix}:${key}`);
    },
  };
}

// ── Key generators ────────────────────────────────────────
function keyByUserOrIp(req) {
  return req.user?.userId
    ? `user:${req.user.userId}`
    : `ip:${req.ip}`;
}

/**
 * v13: RATE_LIMIT_MAX raises every ceiling — needed for load-testing the app
 * itself (otherwise the benchmark just measures the limiter). Refused in
 * production so it can never be used to disable protection on a real deploy.
 */
const OVERRIDE = (() => {
  const v = Number(process.env.RATE_LIMIT_MAX);
  if (!v) return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("FATAL: RATE_LIMIT_MAX override is not allowed in production");
  }
  log.warn({ max: v }, "RATE_LIMIT_MAX override active — limits raised (non-production only)");
  return v;
})();

function maxByAuth(anonMax, authMax) {
  if (OVERRIDE) return () => OVERRIDE;
  return (req) => req.user ? authMax : anonMax;
}

// ── Standard API limiter (general routes) ─────────────────
export function apiLimiter() {
  const windowMs = 15 * 60 * 1000;
  return rateLimit({
    windowMs,
    max: maxByAuth(30, 100),
    keyGenerator: keyByUserOrIp,
    store: makeStore("rl:api", windowMs),
    standardHeaders: "draft-7",
    legacyHeaders:   false,
    handler: (req, res, _, opts) => {
      log.warn({ key: keyByUserOrIp(req), limit: opts.max }, "Rate limit exceeded");
      res.status(429).json({ error: "Too many requests", retryAfter: Math.ceil(opts.windowMs / 1000) });
    },
  });
}

// ── Heavy operations (analyze) ────────────────────────────
export function analyzeLimiter() {
  const windowMs = 15 * 60 * 1000;
  return rateLimit({
    windowMs,
    max: maxByAuth(20, 50),
    keyGenerator: keyByUserOrIp,
    store: makeStore("rl:analyze", windowMs),
    standardHeaders: "draft-7",
    legacyHeaders:   false,
    handler: (req, res) => {
      log.warn({ key: keyByUserOrIp(req) }, "Analyze rate limit exceeded");
      res.status(429).json({ error: "Analysis limit reached. Try again later." });
    },
  });
}

// ── Auth brute-force protection ───────────────────────────
export function authLimiter() {
  const windowMs = 15 * 60 * 1000;
  return rateLimit({
    windowMs,
    max: OVERRIDE || 10,
    // Distinct namespace: apiLimiter's keyByUserOrIp emits `ip:<addr>` for
    // anonymous requests, and /api/auth/* passes through BOTH limiters. Sharing
    // the key made express-rate-limit count one request twice
    // (ERR_ERL_DOUBLE_COUNT) and halved the real auth budget.
    keyGenerator: (req) => `auth:${req.ip}`,
    store: makeStore("rl:auth", windowMs),
    standardHeaders: "draft-7",
    legacyHeaders:   false,
    handler: (_, res) => res.status(429).json({ error: "Too many auth attempts. Wait 15 minutes." }),
  });
}

// ── Share brute-force protection (public share links) ─────
// The public share route mounts outside the /api limiter, so a
// password-protected link could otherwise be brute-forced unthrottled.
// Keyed by IP + token so guessing one link can't exhaust another's budget.
export function shareLimiter() {
  const windowMs = 15 * 60 * 1000;
  return rateLimit({
    windowMs,
    max: OVERRIDE || 30,
    keyGenerator: (req) => `ip:${req.ip}:${req.params.token || "none"}`,
    store: makeStore("rl:share", windowMs),
    standardHeaders: "draft-7",
    legacyHeaders:   false,
    handler: (_, res) => res.status(429).json({ error: "Too many attempts on this link. Wait 15 minutes." }),
  });
}

// ── Slow-down (after 80% limit, delay responses) ──────────
export function speedLimiter() {
  // v13: under RATE_LIMIT_MAX (load testing only) the deliberate slow-down is
  // disabled — otherwise a benchmark measures this throttle, not the app.
  if (OVERRIDE) return (_req, _res, next) => next();
  return slowDown({
    windowMs:          15 * 60 * 1000,
    delayAfter:        (req) => req.user ? 40 : 24,
    delayMs:           (used) => (used - 24) * 500,
    maxDelayMs:        5000,
    keyGenerator:      keyByUserOrIp,
  });
}

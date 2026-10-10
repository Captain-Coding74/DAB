/**
 * auth.js — Complete JWT + Refresh Token authentication
 *
 * Flow:
 *   POST /api/auth/register  → { accessToken, refreshToken }
 *   POST /api/auth/login     → { accessToken, refreshToken }
 *   POST /api/auth/refresh   → { accessToken }
 *   POST /api/auth/logout    → revoke refresh token
 */

import jwt     from "jsonwebtoken";
import crypto  from "crypto";

// SECURITY: never allow the built-in dev secrets in production.
// A misconfigured deploy would otherwise silently sign tokens with a
// publicly known string, letting anyone forge admin JWTs.
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error("FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be set in production (see .env.example)");
}

const ACCESS_SECRET  = process.env.JWT_SECRET         || "dev-access-secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";
const ACCESS_TTL     = "15m";   // short-lived
const REFRESH_TTL    = "7d";    // long-lived

// ── Token helpers ─────────────────────────────────────────
export function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefresh(payload) {
  // jsonwebtoken's iat has only second-level granularity, so two refresh
  // tokens signed for the same user within the same second (e.g. two
  // logins from different tabs, or register immediately followed by
  // login) would otherwise be byte-identical — and since refresh tokens
  // are stored by their SHA-256 hash under a UNIQUE constraint, the second
  // insert would fail with a 500. A random jti guarantees uniqueness
  // regardless of timing.
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccess(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function verifyRefresh(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

// ── Erased accounts (v21.30) ─────────────────────────────
/* An access token stays valid until it expires (ACCESS_TTL) and the
   middleware below never looks the user up. After an account is erased
   (DELETE /api/auth/me), a token still open in another tab could otherwise
   write new rows under the erased id — an analysis, a chat message — that
   nothing would ever delete. The id is marked here from the moment erasure
   starts until every token it could have been issued has expired, and both
   middlewares treat it as no token at all. In-process only: an erasure run
   from the operator CLI cannot reach a running server, and there the
   remaining window is the token's own 15 minutes. */
const ACCESS_TTL_MS = 15 * 60 * 1000;
const erased = new Map();   // userId → time after which no token for it is still valid

export function markErased(userId, now = Date.now()) {
  for (const [id, until] of erased) if (until <= now) erased.delete(id);
  erased.set(userId, now + ACCESS_TTL_MS);
}
/** Undo markErased when erasure failed part-way, so the user can sign in and run it again. */
export function clearErased(userId) { erased.delete(userId); }
const isErased = (userId, now = Date.now()) => (erased.get(userId) ?? 0) > now;

// ── Middleware ────────────────────────────────────────────
/** Require valid access token → req.user */
export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "No token provided" });
  let user;
  try {
    user = verifyAccess(token);
  } catch (err) {
    const msg = err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return res.status(401).json({ error: msg, code: err.name });
  }
  if (isErased(user.userId)) return res.status(401).json({ error: "Account deleted" });
  req.user = user;
  next();
}

/** Attach req.user if valid token, but don't block */
export function optionalAuth(req, _, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const user = verifyAccess(token);
      if (!isErased(user.userId)) req.user = user;
    } catch {}
  }
  next();
}

function extractToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

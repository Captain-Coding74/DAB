/**
 * routes/auth.js — v12 extraction from server.js
 * Register / login / refresh / logout / logout-all / me / accept-terms.
 *
 * v21.30 click-wrap: register requires acceptTerms and ageConfirmed (400
 * TERMS_REQUIRED) and records the accepted LEGAL_VERSION, time and IP.
 * Login, register and /me report `legal: { accepted, current }`; when they
 * differ the SPA blocks on a re-accept dialog that posts to accept-terms.
 * Register and login leave the new session's user id on res.locals for the
 * traffic log (services/trafficLog.js), since req.user is not set there.
 */
import bcrypt from "bcryptjs";
import * as R from "../db/repository.js";
import { cache } from "../services/cache.js";
import { LEGAL_VERSION } from "../services/legal.js";
import { signAccess, signRefresh, verifyRefresh, hashToken, refreshExpiresAt, requireAuth, isErased } from "../auth.js";

/* Bodies arrive as parsed JSON, so a field can be a number, array or object,
   not just a string. Truthiness + .length checks silently pass a numeric
   password (its .length is undefined, and undefined<6 is false) and then throw
   deep in bcrypt/the DB driver as an unclassified 500. Gate the type first. */
const isCred = (v) => typeof v === "string" && v.length > 0;
import { authLimiter } from "../middleware/rateLimiter.js";

/* A ticked box arrives as JSON true; a form-encoded client sends "true".
   Anything else — absent, "1", "yes", "on" — is not an agreement. */
const ticked = (v) => v === true || v === "true";
/** What the SPA compares to decide whether to ask for acceptance again. */
const legalStatus = (accepted) => ({ accepted: accepted || null, current: LEGAL_VERSION });

export function mountAuthRoutes(app) {
  app.post("/api/auth/register", authLimiter(), async (req, res, next) => {
    try {
      const { username, password, email, acceptTerms, ageConfirmed } = req.body;
      if (!isCred(username) || !isCred(password)) return res.status(400).json({ error: "username and password must be non-empty strings" });
      if (username.length < 3)   return res.status(400).json({ error: "username must be 3+ chars" });
      if (password.length < 6)   return res.status(400).json({ error: "password must be 6+ chars" });
      if (!ticked(acceptTerms) || !ticked(ageConfirmed)) {
        return res.status(400).json({ error: "Agree to the Terms of Service and confirm your age to create an account", code: "TERMS_REQUIRED" });
      }
      const hash = await bcrypt.hash(password, 12);
      const user = await R.createUser({ username, passwordHash: hash, email, terms: { version: LEGAL_VERSION, ip: req.ip } });
      res.locals.trafficUserId = user.id;
      const at   = signAccess({ userId: user.id, username });
      const rt   = signRefresh({ userId: user.id });
      await R.storeRefreshToken(user.id, hashToken(rt), refreshExpiresAt());
      await R.auditLog({ userId: user.id, action: "register", ipAddress: req.ip });
      res.status(201).json({ accessToken: at, refreshToken: rt, username, legal: legalStatus(LEGAL_VERSION) });
    } catch (err) { next(err); }   // DuplicateUserError carries status 400
  });

  app.post("/api/auth/login", authLimiter(), async (req, res, next) => {
    try {
      const { username, password } = req.body;
      // Reject non-string/missing credentials as a plain 401 rather than
      // letting undefined reach findUserByUsername (throws on libsql) or
      // bcrypt.compare (throws on a non-string) — both surfaced as a 500 on
      // unauthenticated input, and the libsql-vs-pg divergence made {} a 500
      // on SQLite but a 401 on Postgres.
      if (!isCred(username) || !isCred(password)) return res.status(401).json({ error: "Invalid credentials" });
      const user = await R.findUserByUsername(username);
      if (!user || !(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ error: "Invalid credentials" });
      await R.updateLastLogin(user.id);
      res.locals.trafficUserId = user.id;
      const at = signAccess({ userId: user.id, username: user.username });
      const rt = signRefresh({ userId: user.id });
      await R.storeRefreshToken(user.id, hashToken(rt), refreshExpiresAt());
      await R.auditLog({ userId: user.id, action: "login", ipAddress: req.ip });
      res.json({ accessToken: at, refreshToken: rt, username: user.username, legal: legalStatus(user.terms_version) });
    } catch (err) { next(err); }
  });

  app.post("/api/auth/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
      if (typeof refreshToken !== "string") return res.status(400).json({ error: "refreshToken required" });
      let payload; try { payload = verifyRefresh(refreshToken); } catch { return res.status(401).json({ error: "Invalid or expired refresh token" }); }
      // v21.30: an account being (or just) erased mints nothing — see auth.js markErased.
      if (isErased(payload.userId)) return res.status(401).json({ error: "Account deleted" });
      const presented = hashToken(refreshToken);
      // v21.10 SECURITY: rotation is now atomic AND reuse-detecting. The revoke
      // is the serialization point — a conditional UPDATE that flips revoked
      // 0→1 only if the token is still live. Two concurrent refreshes of the
      // same token race here: exactly one gets true and mints a new token; the
      // loser (and any later replay of an already-rotated token) gets false,
      // which means the token was stolen-then-used or double-spent, so we burn
      // the whole chain. Previously this was a non-atomic check-then-revoke, so
      // one leaked token could mint two valid successors with no alarm.
      const flipped = await R.revokeRefreshTokenIfActive(presented);
      if (!flipped) {
        await R.revokeAllUserTokens(payload.userId);   // reuse detected → invalidate the chain
        return res.status(401).json({ error: "Refresh token revoked" });
      }
      const user = await R.findActiveUserById(payload.userId);   // a banned user must not rotate forever
      if (!user) return res.status(401).json({ error: "User not found" });
      const newRt = signRefresh({ userId: user.id });
      await R.storeRefreshToken(user.id, hashToken(newRt), refreshExpiresAt());
      res.json({ accessToken: signAccess({ userId: user.id, username: user.username }), refreshToken: newRt });
    /* Was res.status(500).json({ error: err.message }) — the only route in the
       codebase returning a raw internal message to the client, and reachable
       WITHOUT authentication. A database or driver error would have gone
       straight to an anonymous caller. next(err) routes through the shared
       handler, which logs the detail and returns a sanitised response. */
    } catch (err) { next(err); }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) await R.revokeRefreshToken(hashToken(refreshToken));
    res.json({ success: true });
  });

  // v11: revoke every refresh token for this user — "log out all devices"
  app.post("/api/auth/logout-all", requireAuth, async (req, res, next) => {
    try {
      await R.revokeAllUserTokens(req.user.userId);
      await R.auditLog({ userId: req.user.userId, action: "logout_all", ipAddress: req.ip });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  app.get("/api/auth/me", requireAuth, async (req, res, next) => {
    try {
      const ck = `user:${req.user.userId}:profile`;
      let profile = await cache.get(ck);
      if (!profile) {
        const user  = await R.findUserById(req.user.userId);
        if (!user) return res.status(404).json({ error: "Not found" });
        const stats = await R.getUserStats(req.user.userId);
        profile     = { ...user, stats };
        await cache.set(ck, profile, 60);
      }
      // legal is worked out per response, not cached: `current` must be the
      // running LEGAL_VERSION even in the minute after a release bumps it.
      const { terms_version, ...rest } = profile;
      res.json({ ...rest, legal: legalStatus(terms_version) });
    } catch (err) { next(err); }
  });

  /* v21.30: re-acceptance after LEGAL_VERSION changes. The client echoes the
     version it showed, so an acceptance can never be recorded for a text the
     user did not see (a tab left open across a version bump gets a 400). */
  app.post("/api/auth/accept-terms", requireAuth, async (req, res, next) => {
    try {
      if (req.body?.version !== LEGAL_VERSION) {
        return res.status(400).json({ error: "Accept the current Terms of Service and Privacy Notice", code: "TERMS_REQUIRED", current: LEGAL_VERSION });
      }
      if (!(await R.recordTermsAcceptance(req.user.userId, { version: LEGAL_VERSION, ip: req.ip }))) {
        return res.status(404).json({ error: "Not found" });
      }
      await cache.del(`user:${req.user.userId}:profile`);
      res.json({ success: true, legal: legalStatus(LEGAL_VERSION) });
    } catch (err) { next(err); }
  });
}

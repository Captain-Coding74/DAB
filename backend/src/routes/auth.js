/**
 * routes/auth.js — v12 extraction from server.js
 * Register / login / refresh / logout / logout-all / me.
 */
import bcrypt from "bcryptjs";
import * as R from "../db/repository.js";
import { cache } from "../services/cache.js";
import { signAccess, signRefresh, verifyRefresh, hashToken, refreshExpiresAt, requireAuth } from "../auth.js";

/* Bodies arrive as parsed JSON, so a field can be a number, array or object,
   not just a string. Truthiness + .length checks silently pass a numeric
   password (its .length is undefined, and undefined<6 is false) and then throw
   deep in bcrypt/the DB driver as an unclassified 500. Gate the type first. */
const isCred = (v) => typeof v === "string" && v.length > 0;
import { authLimiter } from "../middleware/rateLimiter.js";

export function mountAuthRoutes(app) {
  app.post("/api/auth/register", authLimiter(), async (req, res, next) => {
    try {
      const { username, password, email } = req.body;
      if (!isCred(username) || !isCred(password)) return res.status(400).json({ error: "username and password must be non-empty strings" });
      if (username.length < 3)   return res.status(400).json({ error: "username must be 3+ chars" });
      if (password.length < 6)   return res.status(400).json({ error: "password must be 6+ chars" });
      const hash = await bcrypt.hash(password, 12);
      const user = await R.createUser({ username, passwordHash: hash, email });
      const at   = signAccess({ userId: user.id, username });
      const rt   = signRefresh({ userId: user.id });
      await R.storeRefreshToken(user.id, hashToken(rt), refreshExpiresAt());
      await R.auditLog({ userId: user.id, action: "register", ipAddress: req.ip });
      res.status(201).json({ accessToken: at, refreshToken: rt, username });
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
      const at = signAccess({ userId: user.id, username: user.username });
      const rt = signRefresh({ userId: user.id });
      await R.storeRefreshToken(user.id, hashToken(rt), refreshExpiresAt());
      await R.auditLog({ userId: user.id, action: "login", ipAddress: req.ip });
      res.json({ accessToken: at, refreshToken: rt, username: user.username });
    } catch (err) { next(err); }
  });

  app.post("/api/auth/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
      if (typeof refreshToken !== "string") return res.status(400).json({ error: "refreshToken required" });
      let payload; try { payload = verifyRefresh(refreshToken); } catch { return res.status(401).json({ error: "Invalid or expired refresh token" }); }
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
      res.json(profile);
    } catch (err) { next(err); }
  });
}

/**
 * routes/auth.js — v12 extraction from server.js
 * Register / login / refresh / logout / logout-all / me.
 */
import bcrypt from "bcryptjs";
import * as R from "../db/repository.js";
import { cache } from "../services/cache.js";
import { signAccess, signRefresh, verifyRefresh, hashToken, refreshExpiresAt, requireAuth } from "../auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";

export function mountAuthRoutes(app) {
  app.post("/api/auth/register", authLimiter(), async (req, res, next) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
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

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
      let payload; try { payload = verifyRefresh(refreshToken); } catch { return res.status(401).json({ error: "Invalid or expired refresh token" }); }
      const stored = await R.findRefreshToken(hashToken(refreshToken));
      if (!stored) return res.status(401).json({ error: "Refresh token revoked" });
      const user = await R.findUserById(payload.userId);
      if (!user) return res.status(401).json({ error: "User not found" });
      res.json({ accessToken: signAccess({ userId: user.id, username: user.username }) });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

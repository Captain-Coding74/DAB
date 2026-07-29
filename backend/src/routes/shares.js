/**
 * routes/shares.js — v16 extraction from the createApp() god-factory.
 * Public shared reports (password-protected via X-Share-Password).
 */
import bcrypt from "bcryptjs";
import { shareLimiter } from "../middleware/rateLimiter.js";
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";

export function mountShareRoutes(app) {
  // ── Shared Reports ────────────────────────────────────────
  app.post("/api/analyses/:id/share", requireAuth, async (req, res, next) => {
    try {
      const { title, password, expiresIn } = req.body;
      const analysis = await R.getAnalysis(req.params.id, req.user.userId);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      const expiresAt    = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
      const share = await R.createSharedReport({ analysisId: req.params.id, userId: req.user.userId, title, passwordHash, expiresAt });
      const shareUrl = `${req.protocol}://${req.get("host")}/share/${share.token}`;
      res.status(201).json({ ...share, shareUrl });
    } catch (err) { next(err); }
  });

  app.get("/api/shares", requireAuth, async (req, res, next) => {
    try { res.json(await R.getUserSharedReports(req.user.userId)); } catch (err) { next(err); }
  });

  app.delete("/api/shares/:id", requireAuth, async (req, res, next) => {
    try { await R.deleteSharedReport(req.params.id, req.user.userId); res.json({ success: true }); } catch (err) { next(err); }
  });

  // Public shared report view
  // v9: password is read from the X-Share-Password header first — query-string
  // passwords end up in access logs, browser history, and proxies. The query
  // param still works for old links but the frontend now sends the header.
  app.get("/api/public/share/:token", shareLimiter(), async (req, res, next) => {
    try {
      // v21 SECURITY: header only — query-string passwords leak into access
      // logs, proxies, and browser history.
      const password = req.get("x-share-password");
      const report = await R.getSharedReport(req.params.token);
      if (!report) return res.status(404).json({ error: "Report not found or expired" });
      if (report.password_hash) {
        if (!password || !(await bcrypt.compare(password, report.password_hash)))
          return res.status(401).json({ error: "Password required", passwordProtected: true });
      }
      await R.incrementShareViewCount(req.params.token);
      const data = { ...report };
      delete data.password_hash;
      if (data.stats_json) data.stats_json = JSON.parse(data.stats_json);
      if (data.chart_config) data.chart_config = JSON.parse(data.chart_config);
      res.json(data);
    } catch (err) { next(err); }
  });
}

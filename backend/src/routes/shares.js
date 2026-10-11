/**
 * routes/shares.js — v16 extraction from the createApp() god-factory.
 * Public shared reports (password-protected via X-Share-Password).
 *
 * v21.30: a link always expires (1, 7, 30 or 90 days, default 30), its title
 * is never the file name, the public payload is an allowlist with personal-
 * data columns reduced to their name and kind (services/shareView.js), every
 * public response says noindex, and revoking deletes the row.
 */
import bcrypt from "bcryptjs";
import { shareLimiter } from "../middleware/rateLimiter.js";
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";
import { parseExpiryDays, shareTitle, publicShareView, SHARE_EXPIRY_DAYS, SHARE_ROBOTS } from "../services/shareView.js";

const DAY_MS = 86_400_000;
// Before the limiter, so a 429 says noindex too.
const noIndex = (_req, res, next) => { res.set("X-Robots-Tag", SHARE_ROBOTS); next(); };

export function mountShareRoutes(app) {
  // ── Shared Reports ────────────────────────────────────────
  app.post("/api/analyses/:id/share", requireAuth, async (req, res, next) => {
    try {
      const { title, password, expiresInDays } = req.body;
      // v21.30: no "never" — the old `expiresIn` seconds field was optional,
      // and the SPA never sent it, so every link it made lived forever.
      const days = parseExpiryDays(expiresInDays);
      if (days === null) return res.status(400).json({ error: `expiresInDays must be one of ${SHARE_EXPIRY_DAYS.join(", ")}` });
      const analysis = await R.getAnalysis(req.params.id, req.user.userId);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      const expiresAt    = new Date(Date.now() + days * DAY_MS).toISOString();
      const safeTitle    = shareTitle(title, analysis.file_name);
      const share = await R.createSharedReport({ analysisId: req.params.id, userId: req.user.userId, title: safeTitle, passwordHash, expiresAt });
      res.locals.trafficRef = share.id;   // v21.30: traffic log ref — the link's id, never its token
      const shareUrl = `${req.protocol}://${req.get("host")}/share/${share.token}`;
      res.status(201).json({ ...share, title: safeTitle, expiresAt, shareUrl });
    } catch (err) { next(err); }
  });

  app.get("/api/shares", requireAuth, async (req, res, next) => {
    try { res.json(await R.getUserSharedReports(req.user.userId)); } catch (err) { next(err); }
  });

  // v21.30: revoking DELETES the link (it was a soft is_active=0, which kept
  // the token and title forever). Scoped to the owner: anyone else gets 404.
  app.delete("/api/shares/:id", requireAuth, async (req, res, next) => {
    try {
      const deleted = await R.deleteSharedReport(req.params.id, req.user.userId);
      if (!deleted) return res.status(404).json({ error: "Share not found" });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // Public shared report view
  // v9: password is read from the X-Share-Password header first — query-string
  // passwords end up in access logs, browser history, and proxies. The query
  // param still works for old links but the frontend now sends the header.
  app.get("/api/public/share/:token", noIndex, shareLimiter(), async (req, res, next) => {
    try {
      // v21 SECURITY: header only — query-string passwords leak into access
      // logs, proxies, and browser history.
      const password = req.get("x-share-password");
      const report = await R.getSharedReport(req.params.token);   // null once expired
      if (!report) return res.status(404).json({ error: "Report not found or expired" });
      if (report.password_hash) {
        if (!password || !(await bcrypt.compare(password, report.password_hash)))
          return res.status(401).json({ error: "Password required", passwordProtected: true });
      }
      res.locals.trafficRef = report.id;   // v21.30: traffic log ref — the link's id, never its token
      await R.incrementShareViewCount(req.params.token);
      res.json(publicShareView(report));
    } catch (err) { next(err); }
  });
}

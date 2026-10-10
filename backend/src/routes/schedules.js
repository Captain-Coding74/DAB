/**
 * routes/schedules.js — v16 extraction from the createApp() god-factory.
 *
 * v21.30: Scheduled Reports is OFF ("coming soon"). The runner was a stub —
 * no analysis ran and no email was ever sent — yet the form collected
 * recipient email addresses, the scheduler logged them on every tick, and the
 * Workspace UI counted "N runs". Holding addresses for a purpose that is never
 * served is a PDPA data-minimisation problem, and run counts for runs that
 * never happened are a misleading-feature problem. So:
 *   · create / edit → 501 FEATURE_UNAVAILABLE, before anything is read or stored
 *   · list          → 200 [] (the array shape the Workspace UI always took)
 *   · delete        → unchanged; the table is empty, so it removes nothing
 * Every stored row, recipients included, is purged by db/migrate.js DATA_FIXES.
 *
 * When this comes back, so must the dataset-access check that guarded create
 * (see git history): without it anyone could schedule a report against a
 * dataset they cannot read, delivered to any address.
 */
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";

function unavailable(req, res) {
  res.status(501).json({ error: "Scheduled reports are not available yet", code: "FEATURE_UNAVAILABLE" });
}

export function mountScheduleRoutes(app) {
  // ── Scheduled Reports ─────────────────────────────────────
  app.get("/api/workspaces/:id/schedules", requireAuth, async (req, res, next) => {
    try {
      const member = await R.isMember(req.params.id, req.user.userId);
      if (!member) return res.status(403).json({ error: "Not a member" });
      res.json([]);
    } catch (err) { next(err); }
  });

  app.post("/api/workspaces/:id/schedules", requireAuth, unavailable);
  app.put("/api/workspaces/:wsId/schedules/:id", requireAuth, unavailable);
  app.patch("/api/workspaces/:wsId/schedules/:id", requireAuth, unavailable);

  app.delete("/api/workspaces/:wsId/schedules/:id", requireAuth, async (req, res, next) => {
    try {
      await R.deleteScheduledReport(req.params.id, req.user.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
}

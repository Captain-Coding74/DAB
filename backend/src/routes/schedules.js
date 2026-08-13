/**
 * routes/schedules.js — v16 extraction from the createApp() god-factory.
 * Scheduled report definitions (executed by services/scheduler.js).
 */
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";

export function mountScheduleRoutes(app) {
  // ── Scheduled Reports ─────────────────────────────────────
  app.get("/api/workspaces/:id/schedules", requireAuth, async (req, res, next) => {
    try {
      const member = await R.isMember(req.params.id, req.user.userId);
      if (!member) return res.status(403).json({ error: "Not a member" });
      res.json(await R.getScheduledReports(req.params.id));
    } catch (err) { next(err); }
  });

  app.post("/api/workspaces/:id/schedules", requireAuth, async (req, res, next) => {
    try {
      const member = await R.isMember(req.params.id, req.user.userId);
      if (!member || !["owner","admin"].includes(member.role)) return res.status(403).json({ error: "Insufficient role" });
      const { name, datasetId, prompt, cronExpr, recipients, format } = req.body;
      if (!name || !cronExpr || !recipients?.length) return res.status(400).json({ error: "name, cronExpr, recipients required" });

      /* datasetId came straight from the body and was stored unchecked. The
         WORKSPACE role was verified but the DATASET was not, so anyone could
         create a workspace they own and schedule a recurring report against
         somebody else's private dataset, delivered to any address they chose.
         The scheduler is a stub today, so nothing is sent — which is exactly
         why this would have shipped unnoticed and become a live exfiltration
         path the day email delivery landed. */
      if (datasetId) {
        const { getUserDatasetRole } = await import("../db/datasetRepository.js");
        const role = await getUserDatasetRole(datasetId, req.user.userId);
        if (!role) return res.status(403).json({ error: "No access to that dataset" });
      }
      const sr = await R.createScheduledReport({ workspaceId: req.params.id, userId: req.user.userId, name, datasetId, prompt: prompt||"สรุปภาพรวม", cronExpr, recipients, format });
      res.status(201).json(sr);
    } catch (err) { next(err); }
  });

  app.delete("/api/workspaces/:wsId/schedules/:id", requireAuth, async (req, res, next) => {
    try {
      await R.deleteScheduledReport(req.params.id, req.user.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
}

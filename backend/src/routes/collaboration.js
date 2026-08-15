/**
 * src/routes/collaboration.js — Comments, mentions, activity, notifications, dashboards
 */
import express from "express";
import { requireAuth } from "../auth.js";
import * as CR from "../db/collabRepository.js";
import * as DR from "../db/datasetRepository.js";
import { findUserByUsername } from "../db/repository.js";
import { pageParams } from "../pagination.js";

const router = express.Router();

// ── Comments ──────────────────────────────────────────────────
router.post("/comments", requireAuth, async (req, res, next) => {
  try {
    const { datasetId, analysisId, parentId, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "content required" });
    if (!datasetId && !analysisId) return res.status(400).json({ error: "datasetId or analysisId required" });

    const comment = await CR.createComment({ datasetId, analysisId, userId: req.user.userId, parentId, content });

    // Parse @mentions and notify
    const usernames = CR.parseMentions(content);
    for (const uname of usernames) {
      const user = await findUserByUsername(uname);
      if (user && user.id !== req.user.userId) {
        await CR.createMention(comment.id, user.id);
        await CR.createNotification({
          userId: user.id, type: "mention",
          title: `${req.user.username} mentioned you`,
          body: content.slice(0, 100),
          link: datasetId ? `/datasets/${datasetId}` : `/analysis/${analysisId}`,
        });
      }
    }

    if (datasetId) {
      const ds = await DR.getDataset(datasetId);
      await CR.logActivity({ datasetId, userId: req.user.userId, action: "comment_added", metadata: { name: ds?.name } });
    }

    res.status(201).json(comment);
  } catch (err) { next(err); }
});

router.get("/comments", requireAuth, async (req, res, next) => {
  try {
    const { datasetId, analysisId } = req.query;
    if (!datasetId && !analysisId) return res.status(400).json({ error: "datasetId or analysisId required" });
    res.json(await CR.getComments(datasetId, analysisId));
  } catch (err) { next(err); }
});

router.patch("/comments/:id", requireAuth, async (req, res, next) => {
  try { await CR.editComment(req.params.id, req.user.userId, req.body.content); res.json({ success: true }); }
  catch (err) { next(err); }
});

router.delete("/comments/:id", requireAuth, async (req, res, next) => {
  try { await CR.deleteComment(req.params.id, req.user.userId); res.json({ success: true }); }
  catch (err) { next(err); }
});

router.post("/comments/:id/resolve", requireAuth, async (req, res, next) => {
  try { await CR.resolveComment(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

// ── Notifications ─────────────────────────────────────────────
router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === "true";
    res.json(await CR.getNotifications(req.user.userId, { unreadOnly }));
  } catch (err) { next(err); }
});

router.get("/notifications/unread-count", requireAuth, async (req, res, next) => {
  try { res.json({ count: await CR.getUnreadCount(req.user.userId) }); } catch (err) { next(err); }
});

router.post("/notifications/:id/read", requireAuth, async (req, res, next) => {
  try { await CR.markNotificationRead(req.params.id, req.user.userId); res.json({ success: true }); }
  catch (err) { next(err); }
});

router.post("/notifications/read-all", requireAuth, async (req, res, next) => {
  try { await CR.markAllNotificationsRead(req.user.userId); res.json({ success: true }); }
  catch (err) { next(err); }
});

// ── Mentions ───────────────────────────────────────────────────
router.get("/mentions/unread", requireAuth, async (req, res, next) => {
  try { res.json(await CR.getUnreadMentions(req.user.userId)); } catch (err) { next(err); }
});
router.post("/mentions/read-all", requireAuth, async (req, res, next) => {
  try { await CR.markMentionsRead(req.user.userId); res.json({ success: true }); } catch (err) { next(err); }
});

// ── Activity Feed ───────────────────────────────────────────────
router.get("/activity", requireAuth, async (req, res, next) => {
  try {
    const { workspaceId, datasetId } = req.query;
    if (!workspaceId && !datasetId) return res.status(400).json({ error: "workspaceId or datasetId required" });
    const { limit, offset } = pageParams(req.query, { defaultLimit: 30 });
    res.json(await CR.getActivityFeed({ workspaceId, datasetId, limit, offset }));
  } catch (err) { next(err); }
});

// ── Shared Dashboards ──────────────────────────────────────────
router.post("/dashboards", requireAuth, async (req, res, next) => {
  try {
    const { workspaceId, name, description } = req.body;
    if (!workspaceId || !name) return res.status(400).json({ error: "workspaceId and name required" });
    const d = await CR.createDashboard({ workspaceId, name, description, createdBy: req.user.userId });
    await CR.logActivity({ workspaceId, userId: req.user.userId, action: "dashboard_created", metadata: { name } });
    res.status(201).json(d);
  } catch (err) { next(err); }
});

router.get("/dashboards", requireAuth, async (req, res, next) => {
  try {
    if (!req.query.workspaceId) return res.status(400).json({ error: "workspaceId required" });
    res.json(await CR.getDashboards(req.query.workspaceId));
  } catch (err) { next(err); }
});

router.get("/dashboards/:id", requireAuth, async (req, res, next) => {
  try {
    const d = await CR.getDashboard(req.params.id);
    d ? res.json(d) : res.status(404).json({ error: "Not found" });
  } catch (err) { next(err); }
});

router.post("/dashboards/:id/widgets", requireAuth, async (req, res, next) => {
  try {
    const { analysisId, datasetId, widgetType, title, config, position } = req.body;
    const w = await CR.addWidget({ dashboardId: req.params.id, analysisId, datasetId, widgetType, title, config, position });
    res.status(201).json(w);
  } catch (err) { next(err); }
});

router.patch("/dashboards/widgets/:id/position", requireAuth, async (req, res, next) => {
  try { await CR.updateWidgetPosition(req.params.id, req.body.position); res.json({ success: true }); }
  catch (err) { next(err); }
});

router.delete("/dashboards/widgets/:id", requireAuth, async (req, res, next) => {
  try { await CR.removeWidget(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

router.delete("/dashboards/:id", requireAuth, async (req, res, next) => {
  try { await CR.deleteDashboard(req.params.id); res.json({ success: true }); }
  catch (err) { next(err); }
});

export default router;

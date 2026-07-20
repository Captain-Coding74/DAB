/**
 * routes/workspaces.js — v16 extraction from the createApp() god-factory.
 * Team workspaces + membership.
 */
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";

export function mountWorkspaceRoutes(app) {
  // ── Workspaces ────────────────────────────────────────────
  app.get("/api/workspaces", requireAuth, async (req, res, next) => {
    try { res.json(await R.getUserWorkspaces(req.user.userId)); } catch (err) { next(err); }
  });

  app.post("/api/workspaces", requireAuth, async (req, res, next) => {
    try {
      const { name, description, brandColor } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const ws = await R.createWorkspace({ name, ownerId: req.user.userId, description, brandColor });
      res.status(201).json(ws);
    } catch (err) { next(err); }
  });

  app.get("/api/workspaces/:id", requireAuth, async (req, res, next) => {
    try {
      const member = await R.isMember(req.params.id, req.user.userId);
      if (!member) return res.status(403).json({ error: "Not a member" });
      const [ws, members] = await Promise.all([R.getWorkspace(req.params.id), R.getWorkspaceMembers(req.params.id)]);
      res.json({ ...ws, members });
    } catch (err) { next(err); }
  });

  app.patch("/api/workspaces/:id/branding", requireAuth, async (req, res, next) => {
    try {
      const member = await R.isMember(req.params.id, req.user.userId);
      if (!member || !["owner","admin"].includes(member.role)) return res.status(403).json({ error: "Insufficient role" });
      await R.updateWorkspaceBranding({ id: req.params.id, ...req.body });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  app.post("/api/workspaces/:id/members", requireAuth, async (req, res, next) => {
    try {
      const me = await R.isMember(req.params.id, req.user.userId);
      if (!me || !["owner","admin"].includes(me.role)) return res.status(403).json({ error: "Insufficient role" });
      const { username, role } = req.body;
      const user = await R.findUserByUsername(username);
      if (!user) return res.status(404).json({ error: "User not found" });
      await R.addWorkspaceMember(req.params.id, user.id, role || "member", req.user.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  app.delete("/api/workspaces/:id/members/:userId", requireAuth, async (req, res, next) => {
    try {
      const me = await R.isMember(req.params.id, req.user.userId);
      if (!me || !["owner","admin"].includes(me.role)) return res.status(403).json({ error: "Insufficient role" });
      await R.removeWorkspaceMember(req.params.id, req.params.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
}

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
      const { username, role: rawRole } = req.body;
      /* role reached the comparison unvalidated, so "OWNER", "Owner" and
         " owner " all slipped past a check on the literal string, and an array
         or object threw a 500 instead of being refused. Normalise to a known
         value first — anything else is rejected outright rather than defaulted,
         since silently downgrading a typo to "member" hides the mistake. */
      const ROLES = ["owner", "admin", "member", "viewer"];
      const role = rawRole === undefined || rawRole === null
        ? "member"
        : (typeof rawRole === "string" ? rawRole.trim().toLowerCase() : null);
      if (!ROLES.includes(role)) {
        return res.status(400).json({
          error: `บทบาทไม่ถูกต้อง — ใช้ได้เฉพาะ ${ROLES.join(", ")}`,
          errorEn: `invalid role — must be one of ${ROLES.join(", ")}`,
        });
      }
      
      /* The caller's role was checked but never the role being GRANTED, nor the
         target's current role. An admin could therefore promote themselves to
         owner, demote the real owner to member, and then remove them — a
         complete takeover of a workspace by someone invited to help with it.
         Only an owner may create another owner, and only an owner may change
         an owner's role. */
      if (role === "owner" && me.role !== "owner") {
        return res.status(403).json({
          error: "เฉพาะเจ้าของเท่านั้นที่ตั้งเจ้าของคนใหม่ได้",
          errorEn: "only an owner can grant the owner role",
        });
      }
      const user = await R.findUserByUsername(username);
      if (!user) return res.status(404).json({ error: "User not found" });
      const target = await R.isMember(req.params.id, user.id);
      if (target?.role === "owner" && me.role !== "owner") {
        return res.status(403).json({
          error: "เฉพาะเจ้าของเท่านั้นที่เปลี่ยนบทบาทเจ้าของได้",
          errorEn: "only an owner can change an owner's role",
        });
      }
      await R.addWorkspaceMember(req.params.id, user.id, role, req.user.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  app.delete("/api/workspaces/:id/members/:userId", requireAuth, async (req, res, next) => {
    try {
      const me = await R.isMember(req.params.id, req.user.userId);
      if (!me || !["owner","admin"].includes(me.role)) return res.status(403).json({ error: "Insufficient role" });
      /* An admin could remove the owner, completing the takeover. */
      const victim = await R.isMember(req.params.id, req.params.userId);
      if (victim?.role === "owner" && me.role !== "owner") {
        return res.status(403).json({
          error: "เฉพาะเจ้าของเท่านั้นที่ลบเจ้าของได้",
          errorEn: "only an owner can remove an owner",
        });
      }
      /* Removing the LAST owner strands the workspace: the remaining members can
         see it but cannot claim it, cannot delete it, and the departed owner
         cannot rejoin — the data sits there with nobody able to administer it and
         no API path to recover. Hand ownership over first. */
      if (victim?.role === "owner") {
        const members = await R.getWorkspaceMembers(req.params.id);
        const owners = (members || []).filter(m => m.role === "owner").length;
        if (owners <= 1) {
          return res.status(409).json({
            error: "ลบเจ้าของคนสุดท้ายไม่ได้ — ต้องตั้งเจ้าของคนใหม่ก่อน",
            errorEn: "cannot remove the last owner — grant the owner role to someone else first",
          });
        }
      }
      await R.removeWorkspaceMember(req.params.id, req.params.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
}

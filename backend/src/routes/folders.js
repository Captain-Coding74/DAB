/**
 * src/routes/folders.js — Dataset folder endpoints
 *
 * v21.10 extraction from routes/datasets.js: adding the authorization guards
 * pushed that file past its size ratchet, and the ratchet was right — folders
 * are their own resource. Mounted by datasets.js at /folders, so the public
 * paths (/api/datasets/folders/...) are unchanged.
 *
 * These four routes had requireAuth and nothing else: any logged-in user
 * could list, rename or delete a stranger's folders by id (the permission
 * matrix skips /folders/ paths, so no test probed them). Workspace listings
 * require membership; rename/delete require the folder's owner.
 */
import express from "express";
import { requireAuth } from "../auth.js";
import * as DR from "../db/datasetRepository.js";
import { isMember } from "../db/repository.js";

const router = express.Router();

/** Load the folder and require the caller to own it. Answers the response
 *  itself when access fails; returns null in that case. */
async function requireOwnFolder(req, res, verb) {
  const folder = await DR.getFolder(req.params.id);
  if (!folder) { res.status(404).json({ error: "Not found" }); return null; }
  if (folder.owner_id !== req.user.userId) {
    res.status(403).json({ error: `Only the folder owner can ${verb}` });
    return null;
  }
  return folder;
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { name, parentId, workspaceId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    if (workspaceId && !(await isMember(workspaceId, req.user.userId)))
      return res.status(403).json({ error: "Not a member of this workspace" });
    const folder = await DR.createFolder({ workspaceId, ownerId: req.user.userId, name, parentId });
    res.status(201).json(folder);
  } catch (err) { next(err); }
});

router.get("/list", requireAuth, async (req, res, next) => {
  try {
    const { workspaceId, parentId } = req.query;
    if (workspaceId && !(await isMember(workspaceId, req.user.userId)))
      return res.status(403).json({ error: "Not a member of this workspace" });
    res.json(await DR.getFolders(workspaceId, parentId || null, req.user.userId));
  } catch (err) { next(err); }
});

router.patch("/:id/rename", requireAuth, async (req, res, next) => {
  try {
    if (!(await requireOwnFolder(req, res, "rename"))) return;
    if (!req.body.name?.trim()) return res.status(400).json({ error: "name required" });
    await DR.renameFolder(req.params.id, req.body.name, req.user.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!(await requireOwnFolder(req, res, "delete"))) return;
    await DR.deleteFolder(req.params.id, req.user.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;

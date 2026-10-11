/**
 * routes/datasetScope.js — where a caller may list, create or file a dataset
 * (v21.30).
 *
 * GET /api/datasets?workspaceId=… listed every dataset in ANY workspace whose
 * id the caller knew, and POST /api/datasets (and /multi) stored a new one
 * in any workspace or folder named in the body. A collaborator on one dataset
 * reads its workspace_id from GET /api/datasets/:id, so the names and
 * descriptions of every other dataset in that workspace — often a pupil's
 * name, defaulting to the uploaded file name — were one request away, while
 * the Privacy Notice says only members of a workspace see what is in it.
 * folders.js already required membership; these routes now do the same.
 * Registered in routes/datasets.js, kept here for its size ratchet.
 */
import { isMember } from "../db/repository.js";
import { getFolder } from "../db/datasetRepository.js";

/**
 * May the caller put (or look for) a dataset in this workspace and folder?
 * A workspace needs membership; a folder must exist and be the caller's own
 * personal folder or one in a workspace they belong to. Answers 403 itself
 * and returns false when not; true otherwise (nothing named is always fine).
 */
export async function requirePlacement(req, res, { workspaceId, folderId } = {}) {
  const userId = req.user.userId;
  if (workspaceId && !(await isMember(workspaceId, userId))) {
    res.status(403).json({ error: "Not a member of this workspace" });
    return false;
  }
  if (folderId && folderId !== "root") {
    const folder = await getFolder(folderId);
    const allowed = folder && (folder.workspace_id ? await isMember(folder.workspace_id, userId) : folder.owner_id === userId);
    if (!allowed) {
      res.status(403).json({ error: "No access to this folder" });
      return false;
    }
  }
  return true;
}

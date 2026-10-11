/**
 * GET /api/datasets/:id/versions/:versionId/download — the original file of
 * one saved version, as uploaded (v21.30).
 *
 * The account export (GET /api/auth/me/export) lists every saved file with
 * this path instead of inlining megabytes of bytes, so the right to a copy
 * of your data includes the files themselves. Owner only, like delete and
 * share: the owner answers for the file, and a collaborator's view of it is
 * the preview and the analyses, not a copy to take away. Bytes come through
 * getVersionBytes — the one way to read a stored object — so whatever the
 * storage layer does at rest is undone here too. Registered in
 * routes/datasets.js (where the permission matrix finds it); the handler
 * lives here to keep that file under its size ratchet.
 */
import * as DR from "../db/datasetRepository.js";

export async function downloadVersion(req, res, next) {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (role !== "owner") return res.status(403).json({ error: "Only the dataset owner can download the original file" });
    const version = await DR.getVersion(req.params.versionId);
    if (!version || version.dataset_id !== req.params.id) return res.status(404).json({ error: "Not found" });
    const bytes = await DR.getVersionBytes(version);
    res.set("Cache-Control", "no-store");
    res.attachment(version.file_name);
    res.send(bytes);
  } catch (err) { next(err); }
}

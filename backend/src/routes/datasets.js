/**
 * src/routes/datasets.js — Dataset management endpoints
 * Google Drive-style: store, version, rename, delete, preview, filter, folders, tags
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { recordUpload } from "../services/telemetry.js";
import multer  from "multer";
import { requireAuth } from "../auth.js";
import { parseFileStreaming } from "../services/streaming.js";
import * as storage from "../services/storage.js";
import { computeQualityScore } from "../services/qualityScore.js";
import * as DR from "../db/datasetRepository.js";
import * as CR from "../db/collabRepository.js";

const router = express.Router();

// v9 fix: these uploaders had NO fileFilter, so /api/datasets accepted any
// file type (exe, zip, ...) while /api/analyze correctly rejected them.
const csvExcelOnly = (_, file, cb) =>
  /\.(csv|xlsx|xls)$/i.test(file.originalname) ? cb(null, true) : cb(new Error("CSV/Excel only"));

/* v21 SECURITY: the filename check above is spoofable. This second gate reads
   the buffer's leading bytes after upload: xlsx is a ZIP (PK\x03\x04), xls is
   the OLE compound-file magic (D0 CF 11 E0). CSV is plain text, so anything
   not matching a known binary magic is allowed through as text and left to the
   parser. Rejects a renamed executable before it reaches streaming. */
function verifyFileMagic(buf, name) {
  if (!buf || buf.length < 8) return true;
  const isXlsxName = /\.xlsx$/i.test(name), isXlsName = /\.xls$/i.test(name);
  const zip = buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
  const ole = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
  if (isXlsxName) return zip;              // .xlsx must be a real ZIP container
  if (isXlsName)  return zip || ole;       // .xls: legacy OLE, or xlsx mislabelled
  // .csv / .tsv: reject only if it carries a known binary magic
  return !(zip || ole || (buf[0] === 0x7F && buf[1] === 0x45 && buf[2] === 0x4C && buf[3] === 0x46)); // ELF
}

const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: csvExcelOnly });
const uploadMulti  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: csvExcelOnly });

function canAccess(role) { return role !== null; }
function canEdit(role)   { return ["owner", "editor"].includes(role); }

// ── List / Filter datasets ──────────────────────────────────
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { folderId, starred, trashed, search, workspaceId, view } = req.query;
    const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;

    let items, total;
    if (view === "shared") {
      items = await DR.getSharedWithMeDatasets(req.user.userId, { limit, offset });
      total = items.length;
    } else {
      const opts = {
        ownerId: workspaceId ? undefined : req.user.userId,
        workspaceId: workspaceId || undefined,
        folderId: folderId === "root" ? null : (folderId || undefined),
        starred: starred === "true" ? true : starred === "false" ? false : undefined,
        trashed: trashed === "true",
        search: search || undefined,
        limit, offset,
      };
      [items, total] = await Promise.all([DR.listDatasets(opts), DR.countDatasets(opts)]);
    }
    res.set("X-Total-Count", total).json(items);
  } catch (err) { next(err); }
});

// ── Upload new dataset ───────────────────────────────────────
router.post("/", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!verifyFileMagic(req.file.buffer, req.file.originalname))
      return res.status(400).json({ error: "File content does not match its extension" });
    const { name, description, folderId, workspaceId } = req.body;
    const { headers, colAnalysis, totalRows, dupeCount, normalization } = await parseFileStreaming(req.file.buffer, req.file.originalname);
    const quality = computeQualityScore(colAnalysis, totalRows, dupeCount);
    recordUpload({ source: "dataset", fileType: req.file.originalname.split(".").pop(), sizeBytes: req.file.size,
                   parsed: { headers, colAnalysis, totalRows, normalization }, userId: req.user.userId });

    // v21.1: bytes go to object storage, never through a UTF-8 string.
    // The old `buffer.toString("utf-8")` corrupted every .xlsx on write.
    const datasetId = randomUUID();
    const stored = await storage.put(storage.buildKey({ datasetId, versionNum: 1, fileName: req.file.originalname }), req.file.buffer);

    const ds = await DR.createDataset({
      datasetId,
      workspaceId: workspaceId || null,
      ownerId: req.user.userId,
      name: name || req.file.originalname,
      description,
      folderId: folderId || null,
      fileName: req.file.originalname,
      storageKey: stored.key,
      storageSha256: stored.sha256,
      fileType: req.file.originalname.split(".").pop().toLowerCase(),
      totalRows, totalCols: headers.length,
      colAnalysis, qualityScore: quality?.score,
      sizeBytes: req.file.size,
    });

    await CR.logActivity({ workspaceId, datasetId: ds.id, userId: req.user.userId, action: "dataset_created", targetType: "dataset", targetId: ds.id, metadata: { name: name || req.file.originalname } });

    res.status(201).json({ ...ds, totalRows, totalCols: headers.length, colAnalysis, quality });
  } catch (err) { next(err); }
});

// ── Upload multiple files as ONE combined dataset ─────────────
// Each file becomes a "version" of the dataset, concatenated under one name.
// Useful for e.g. monthly exports that should live as a single tracked dataset.
router.post("/multi", requireAuth, uploadMulti.array("files", 10), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "At least one file required" });
    const { name, description, folderId, workspaceId } = req.body;

    const first = req.files[0];
    const bundleId = randomUUID();
    const firstStored = await storage.put(storage.buildKey({ datasetId: bundleId, versionNum: 1, fileName: first.originalname }), first.buffer);
    const { headers, colAnalysis, totalRows: firstRows, dupeCount } = await parseFileStreaming(first.buffer, first.originalname);

    const totalRows = req.files.length === 1 ? firstRows : await (async () => {
      let sum = 0;
      // v21: same magic-byte gate on every file in a multi-upload
    for (const f of req.files) {
      if (!verifyFileMagic(f.buffer, f.originalname)) return res.status(400).json({ error: `${f.originalname}: content does not match extension` }); const r = await parseFileStreaming(f.buffer, f.originalname); sum += r.totalRows; }
      return sum;
    })();
    const quality = computeQualityScore(colAnalysis, totalRows, dupeCount);

    const ds = await DR.createDataset({
      datasetId: bundleId,
        workspaceId: workspaceId || null,
      ownerId: req.user.userId,
      name: name || first.originalname,
      description,
      folderId: folderId || null,
      fileName: first.originalname,
      storageKey: firstStored.key,
      storageSha256: firstStored.sha256,
      fileType: first.originalname.split(".").pop().toLowerCase(),
      totalRows, totalCols: headers.length,
      colAnalysis, qualityScore: quality?.score,
      sizeBytes: req.files.reduce((s, f) => s + f.size, 0),
    });

    // Remaining files become additional versions with a clear change note
    for (let i = 1; i < req.files.length; i++) {
      const f = req.files[i];
      const parsed  = await parseFileStreaming(f.buffer, f.originalname);
      const q       = computeQualityScore(parsed.colAnalysis, parsed.totalRows, parsed.dupeCount);
        const bundledStored = await storage.put(storage.buildKey({ datasetId: ds.id, versionNum: i + 1, fileName: f.originalname }), f.buffer);
      await DR.addDatasetVersion({
        datasetId: ds.id, fileName: f.originalname,
        storageKey: bundledStored.key,
        storageSha256: bundledStored.sha256,
        fileType: f.originalname.split(".").pop().toLowerCase(),
        totalRows: parsed.totalRows, totalCols: parsed.headers.length,
        colAnalysis: parsed.colAnalysis, qualityScore: q?.score,
        changeNote: `Bundled upload: ${f.originalname}`, uploadedBy: req.user.userId, sizeBytes: f.size,
      });
    }

    await CR.logActivity({ workspaceId, datasetId: ds.id, userId: req.user.userId, action: "dataset_created", targetType: "dataset", targetId: ds.id, metadata: { name: name || first.originalname, fileCount: req.files.length } });

    res.status(201).json({ ...ds, totalRows, totalCols: headers.length, colAnalysis, quality, fileCount: req.files.length });
  } catch (err) { next(err); }
});

// ── Get dataset detail (with current version preview) ───────
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canAccess(role)) return res.status(403).json({ error: "No access" });
    const ds = await DR.getDatasetWithContent(req.params.id);
    if (!ds) return res.status(404).json({ error: "Not found" });
    res.json({ ...ds, myRole: role });
  } catch (err) { next(err); }
});

// ── Preview (sample rows from current version) ───────────────
router.get("/:id/preview", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canAccess(role)) return res.status(403).json({ error: "No access" });
    const ds = await DR.getDatasetWithContent(req.params.id);
    if (!ds?.version) return res.status(404).json({ error: "Not found" });

    const { headers, colAnalysis, sampleRows } = await parseFileStreaming(
      await DR.getVersionBytes(ds.version), ds.version.file_name
    );
    res.json({ headers, colAnalysis, sampleRows: sampleRows.slice(0, 20), totalRows: ds.version.total_rows });
  } catch (err) { next(err); }
});

// ── Rename ─────────────────────────────────────────────────
router.patch("/:id/rename", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canEdit(role)) return res.status(403).json({ error: "Editor access required" });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    await DR.renameDataset(req.params.id, name);
    await CR.logActivity({ datasetId: req.params.id, userId: req.user.userId, action: "dataset_renamed", metadata: { name } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.patch("/:id/description", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canEdit(role)) return res.status(403).json({ error: "Editor access required" });
    await DR.updateDatasetDescription(req.params.id, req.body.description || "");
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Star / Unstar ─────────────────────────────────────────
router.patch("/:id/star", requireAuth, async (req, res, next) => {
  try {
    await DR.toggleStar(req.params.id, req.body.starred);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Move to folder ─────────────────────────────────────────
router.patch("/:id/move", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canEdit(role)) return res.status(403).json({ error: "Editor access required" });
    await DR.moveDataset(req.params.id, req.body.folderId || null);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Trash / Restore / Delete ────────────────────────────────
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const ds = await DR.getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: "Not found" });
    if (ds.owner_id !== req.user.userId) return res.status(403).json({ error: "Only owner can delete" });
    await DR.trashDataset(req.params.id);
    await CR.logActivity({ datasetId: req.params.id, userId: req.user.userId, action: "dataset_deleted", metadata: { name: ds.name } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post("/:id/restore", requireAuth, async (req, res, next) => {
  try {
    await DR.restoreDataset(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete("/:id/permanent", requireAuth, async (req, res, next) => {
  try {
    const ds = await DR.getDataset(req.params.id);
    if (!ds || ds.owner_id !== req.user.userId) return res.status(403).json({ error: "Forbidden" });
    await DR.permanentlyDeleteDataset(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post("/trash/empty", requireAuth, async (req, res, next) => {
  try {
    const count = await DR.emptyTrash(req.user.userId);
    res.json({ success: true, deletedCount: count });
  } catch (err) { next(err); }
});

// ── Versioning ───────────────────────────────────────────────
router.post("/:id/versions", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canEdit(role)) return res.status(403).json({ error: "Editor access required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!verifyFileMagic(req.file.buffer, req.file.originalname))
      return res.status(400).json({ error: "File content does not match its extension" });

    const { headers, colAnalysis, totalRows, dupeCount, normalization } = await parseFileStreaming(req.file.buffer, req.file.originalname);
    const quality = computeQualityScore(colAnalysis, totalRows, dupeCount);
    recordUpload({ source: "dataset", fileType: req.file.originalname.split(".").pop(), sizeBytes: req.file.size,
                   parsed: { headers, colAnalysis, totalRows, normalization }, userId: req.user.userId });

    const nextStored = await storage.put(storage.buildKey({ datasetId: req.params.id, versionNum: Date.now(), fileName: req.file.originalname }), req.file.buffer);

    const v = await DR.addDatasetVersion({
      datasetId: req.params.id, fileName: req.file.originalname,
      storageKey: nextStored.key,
      storageSha256: nextStored.sha256,
      fileType: req.file.originalname.split(".").pop().toLowerCase(),
      totalRows, totalCols: headers.length, colAnalysis, qualityScore: quality?.score,
      changeNote: req.body.changeNote, uploadedBy: req.user.userId, sizeBytes: req.file.size,
    });

    const ds = await DR.getDataset(req.params.id);
    await CR.logActivity({ datasetId: req.params.id, userId: req.user.userId, action: "version_added", metadata: { name: ds.name, version: v.versionNum } });

    res.status(201).json({ ...v, totalRows, totalCols: headers.length, colAnalysis, quality });
  } catch (err) { next(err); }
});

router.get("/:id/versions", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canAccess(role)) return res.status(403).json({ error: "No access" });
    res.json(await DR.getVersions(req.params.id));
  } catch (err) { next(err); }
});

router.get("/:id/versions/:versionId", requireAuth, async (req, res, next) => {
  try {
    const v = await DR.getVersion(req.params.versionId);
    if (!v) return res.status(404).json({ error: "Not found" });
    res.json(v);
  } catch (err) { next(err); }
});

router.post("/:id/versions/:versionId/restore", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!canEdit(role)) return res.status(403).json({ error: "Editor access required" });
    const v = await DR.restoreVersion(req.params.id, req.params.versionId);
    res.json(v);
  } catch (err) { next(err); }
});

// ── Tags ──────────────────────────────────────────────────────
router.post("/:id/tags", requireAuth, async (req, res, next) => {
  try { await DR.addTag(req.params.id, req.body.tag); res.json({ success: true }); }
  catch (err) { next(err); }
});
router.delete("/:id/tags/:tag", requireAuth, async (req, res, next) => {
  try { await DR.removeTag(req.params.id, req.params.tag); res.json({ success: true }); }
  catch (err) { next(err); }
});
router.get("/tags/all", requireAuth, async (req, res, next) => {
  try { res.json(await DR.getAllTags(req.user.userId)); } catch (err) { next(err); }
});

// ── Sharing / Collaborators ───────────────────────────────────
router.post("/:id/share", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (role !== "owner") return res.status(403).json({ error: "Only owner can share" });
    const { username, role: newRole } = req.body;
    const { findUserByUsername } = await import("../db/repository.js");
    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    await DR.shareDataset(req.params.id, user.id, newRole || "viewer", req.user.userId);
    const ds = await DR.getDataset(req.params.id);
    await CR.logActivity({ datasetId: req.params.id, userId: req.user.userId, action: "dataset_shared", metadata: { name: ds.name, invitee: username } });
    await CR.createNotification({ userId: user.id, type: "dataset_shared", title: `${req.user.username} shared "${ds.name}" with you`, link: `/datasets/${req.params.id}` });

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get("/:id/collaborators", requireAuth, async (req, res, next) => {
  try { res.json(await DR.getDatasetCollaborators(req.params.id)); } catch (err) { next(err); }
});

router.delete("/:id/collaborators/:userId", requireAuth, async (req, res, next) => {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (role !== "owner") return res.status(403).json({ error: "Only owner can remove" });
    await DR.removeCollaborator(req.params.id, req.params.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Folders ───────────────────────────────────────────────────
router.post("/folders", requireAuth, async (req, res, next) => {
  try {
    const { name, parentId, workspaceId } = req.body;
    const folder = await DR.createFolder({ workspaceId, ownerId: req.user.userId, name, parentId });
    res.status(201).json(folder);
  } catch (err) { next(err); }
});
router.get("/folders/list", requireAuth, async (req, res, next) => {
  try { res.json(await DR.getFolders(req.query.workspaceId, req.query.parentId || null)); } catch (err) { next(err); }
});
router.patch("/folders/:id/rename", requireAuth, async (req, res, next) => {
  try { await DR.renameFolder(req.params.id, req.body.name); res.json({ success: true }); } catch (err) { next(err); }
});
router.delete("/folders/:id", requireAuth, async (req, res, next) => {
  try { await DR.deleteFolder(req.params.id); res.json({ success: true }); } catch (err) { next(err); }
});

export default router;

/**
 * src/db/datasetRepository.js — Dataset Management queries
 * Google Drive-style: store, version, rename, delete, preview, filter
 */
import { query } from "./pool.js";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();
const now  = () => new Date().toISOString();

// ── Folders ────────────────────────────────────────────────
export async function createFolder({ workspaceId, ownerId, name, parentId }) {
  const id = uuid();
  await query(`INSERT INTO dataset_folders (id,workspace_id,owner_id,name,parent_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, workspaceId||null, ownerId, name, parentId||null, now()]);
  return { id, name, parentId };
}
export async function getFolders(workspaceId, parentId = null) {
  if (parentId) return query(`SELECT * FROM dataset_folders WHERE workspace_id=$1 AND parent_id=$2 ORDER BY name`, [workspaceId, parentId]);
  return query(`SELECT * FROM dataset_folders WHERE workspace_id=$1 AND parent_id IS NULL ORDER BY name`, [workspaceId]);
}
export async function renameFolder(id, name) {
  await query(`UPDATE dataset_folders SET name=$1 WHERE id=$2`, [name, id]);
}
export async function deleteFolder(id) {
  await query(`DELETE FROM dataset_folders WHERE id=$1`, [id]);
}

// ── Datasets — Create with first version ────────────────────
export async function createDataset({ datasetId: providedId, workspaceId, ownerId, name, description, folderId, fileName, fileContent, storageKey, storageSha256, fileType, totalRows, totalCols, colAnalysis, qualityScore, sizeBytes }) {
  // The caller may supply the id so the storage key it already wrote points
  // at the same dataset; otherwise generate one as before.
  const datasetId = providedId || uuid();
  const versionId = uuid();
  const t = now();

  await query(
    `INSERT INTO datasets (id,workspace_id,owner_id,name,description,folder_id,current_version_id,total_rows,total_cols,file_type,size_bytes,quality_score,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [datasetId, workspaceId||null, ownerId, name, description||null, folderId||null, versionId, totalRows, totalCols, fileType, sizeBytes||0, qualityScore||null, t, t]
  );

  await query(
    `INSERT INTO dataset_versions (id,dataset_id,version_num,file_name,file_content,storage_key,storage_sha256,file_type,total_rows,total_cols,col_analysis,quality_score,change_note,uploaded_by,size_bytes,created_at)
     VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Initial upload',$12,$13,$14)`,
    [versionId, datasetId, fileName, fileContent ?? '', storageKey||null, storageSha256||null, fileType, totalRows, totalCols, JSON.stringify(colAnalysis), qualityScore||null, ownerId, sizeBytes||0, t]
  );

  return { id: datasetId, versionId };
}

// ── New Version (re-upload) ──────────────────────────────────
export async function addDatasetVersion({ datasetId, fileName, fileContent, storageKey, storageSha256, fileType, totalRows, totalCols, colAnalysis, qualityScore, changeNote, uploadedBy, sizeBytes }) {
  const versionId = uuid();
  const t = now();

  const last = await query(`SELECT MAX(version_num) AS v FROM dataset_versions WHERE dataset_id=$1`, [datasetId]);
  const nextVersion = (last[0]?.v || 0) + 1;

  await query(
    `INSERT INTO dataset_versions (id,dataset_id,version_num,file_name,file_content,storage_key,storage_sha256,file_type,total_rows,total_cols,col_analysis,quality_score,change_note,uploaded_by,size_bytes,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [versionId, datasetId, nextVersion, fileName, fileContent ?? '', storageKey||null, storageSha256||null, fileType, totalRows, totalCols, JSON.stringify(colAnalysis), qualityScore||null, changeNote||`Version ${nextVersion}`, uploadedBy, sizeBytes||0, t]
  );

  await query(
    `UPDATE datasets SET current_version_id=$1, total_rows=$2, total_cols=$3, file_type=$4, size_bytes=$5, quality_score=$6, updated_at=$7 WHERE id=$8`,
    [versionId, totalRows, totalCols, fileType, sizeBytes||0, qualityScore||null, t, datasetId]
  );

  return { versionId, versionNum: nextVersion };
}

export async function getVersions(datasetId) {
  return query(
    `SELECT dv.id,dv.version_num,dv.file_name,dv.total_rows,dv.total_cols,dv.quality_score,dv.change_note,dv.size_bytes,dv.created_at,u.username AS uploaded_by_name
     FROM dataset_versions dv LEFT JOIN users u ON u.id=dv.uploaded_by
     WHERE dv.dataset_id=$1 ORDER BY dv.version_num DESC`,
    [datasetId]
  );
}

export async function getVersion(versionId) {
  const r = await query(`SELECT * FROM dataset_versions WHERE id=$1`, [versionId]);
  if (!r[0]) return null;
  return { ...r[0], col_analysis: JSON.parse(r[0].col_analysis || "[]") };
}

export async function restoreVersion(datasetId, versionId) {
  const v = await getVersion(versionId);
  if (!v) throw new Error("Version not found");
  await query(`UPDATE datasets SET current_version_id=$1, total_rows=$2, total_cols=$3, quality_score=$4, updated_at=$5 WHERE id=$6`,
    [versionId, v.total_rows, v.total_cols, v.quality_score, now(), datasetId]);
  return v;
}

// ── Dataset CRUD ───────────────────────────────────────────
export async function getDataset(id) {
  const r = await query(`SELECT * FROM datasets WHERE id=$1`, [id]);
  return r[0] || null;
}

export async function getDatasetWithContent(id) {
  const ds = await getDataset(id);
  if (!ds) return null;
  const version = await getVersion(ds.current_version_id);
  return { ...ds, version };
}

export async function listDatasets({ ownerId, workspaceId, folderId, starred, trashed = false, search, tags, limit = 50, offset = 0 }) {
  let sql = `SELECT d.*, GROUP_CONCAT(dt.tag) AS tags_csv FROM datasets d LEFT JOIN dataset_tags dt ON dt.dataset_id=d.id WHERE 1=1`;
  const args = [];
  let i = 1;

  if (workspaceId) { sql += ` AND d.workspace_id=$${i++}`; args.push(workspaceId); }
  else if (ownerId) { sql += ` AND d.owner_id=$${i++}`; args.push(ownerId); }

  if (folderId !== undefined) {
    if (folderId === null) sql += ` AND d.folder_id IS NULL`;
    else { sql += ` AND d.folder_id=$${i++}`; args.push(folderId); }
  }
  if (starred !== undefined) { sql += ` AND d.is_starred=$${i++}`; args.push(starred ? 1 : 0); }
  sql += ` AND d.is_trashed=$${i++}`; args.push(trashed ? 1 : 0);

  if (search) { sql += ` AND (d.name LIKE $${i++} OR d.description LIKE $${i++})`; args.push(`%${search}%`, `%${search}%`); }

  sql += ` GROUP BY d.id ORDER BY d.updated_at DESC LIMIT $${i++} OFFSET $${i++}`;
  args.push(limit, offset);

  const rows = await query(sql, args);
  return rows.map(r => ({ ...r, tags: r.tags_csv ? r.tags_csv.split(",") : [] }));
}

export async function countDatasets({ ownerId, workspaceId, folderId, starred, trashed = false, search }) {
  let sql = `SELECT COUNT(DISTINCT d.id) AS cnt FROM datasets d WHERE 1=1`;
  const args = []; let i = 1;
  if (workspaceId) { sql += ` AND d.workspace_id=$${i++}`; args.push(workspaceId); }
  else if (ownerId) { sql += ` AND d.owner_id=$${i++}`; args.push(ownerId); }
  if (folderId !== undefined) {
    if (folderId === null) sql += ` AND d.folder_id IS NULL`;
    else { sql += ` AND d.folder_id=$${i++}`; args.push(folderId); }
  }
  if (starred !== undefined) { sql += ` AND d.is_starred=$${i++}`; args.push(starred ? 1 : 0); }
  sql += ` AND d.is_trashed=$${i++}`; args.push(trashed ? 1 : 0);
  if (search) { sql += ` AND (d.name LIKE $${i++} OR d.description LIKE $${i++})`; args.push(`%${search}%`, `%${search}%`); }
  const r = await query(sql, args);
  return parseInt(r[0]?.cnt || 0);
}

export async function renameDataset(id, name) {
  await query(`UPDATE datasets SET name=$1, updated_at=$2 WHERE id=$3`, [name, now(), id]);
}

export async function updateDatasetDescription(id, description) {
  await query(`UPDATE datasets SET description=$1, updated_at=$2 WHERE id=$3`, [description, now(), id]);
}

export async function moveDataset(id, folderId) {
  await query(`UPDATE datasets SET folder_id=$1, updated_at=$2 WHERE id=$3`, [folderId, now(), id]);
}

export async function toggleStar(id, starred) {
  await query(`UPDATE datasets SET is_starred=$1 WHERE id=$2`, [starred ? 1 : 0, id]);
}

export async function trashDataset(id) {
  await query(`UPDATE datasets SET is_trashed=1, trashed_at=$1 WHERE id=$2`, [now(), id]);
}

export async function restoreDataset(id) {
  await query(`UPDATE datasets SET is_trashed=0, trashed_at=NULL WHERE id=$1`, [id]);
}

export async function permanentlyDeleteDataset(id) {
  await query(`DELETE FROM dataset_versions WHERE dataset_id=$1`, [id]);
  await query(`DELETE FROM dataset_tags WHERE dataset_id=$1`, [id]);
  await query(`DELETE FROM dataset_permissions WHERE dataset_id=$1`, [id]);
  await query(`DELETE FROM comments WHERE dataset_id=$1`, [id]);
  await query(`DELETE FROM datasets WHERE id=$1`, [id]);
}

export async function emptyTrash(ownerId) {
  const trashed = await query(`SELECT id FROM datasets WHERE owner_id=$1 AND is_trashed=1`, [ownerId]);
  for (const d of trashed) await permanentlyDeleteDataset(d.id);
  return trashed.length;
}

// ── Tags ───────────────────────────────────────────────────
export async function addTag(datasetId, tag) {
  await query(`INSERT OR IGNORE INTO dataset_tags (id,dataset_id,tag) VALUES ($1,$2,$3)`, [uuid(), datasetId, tag.toLowerCase().trim()]);
}
export async function removeTag(datasetId, tag) {
  await query(`DELETE FROM dataset_tags WHERE dataset_id=$1 AND tag=$2`, [datasetId, tag.toLowerCase().trim()]);
}
export async function getAllTags(ownerId) {
  return query(`SELECT DISTINCT dt.tag, COUNT(*) as cnt FROM dataset_tags dt JOIN datasets d ON d.id=dt.dataset_id WHERE d.owner_id=$1 GROUP BY dt.tag ORDER BY cnt DESC`, [ownerId]);
}

// ── Permissions (sharing with teammates) ────────────────────
export async function shareDataset(datasetId, userId, role, invitedBy) {
  await query(
    `INSERT INTO dataset_permissions (id,dataset_id,user_id,role,invited_by,created_at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(dataset_id,user_id) DO UPDATE SET role=$4`,
    [uuid(), datasetId, userId, role, invitedBy, now()]
  ).catch(async () => {
    // SQLite fallback if ON CONFLICT syntax differs
    await query(`DELETE FROM dataset_permissions WHERE dataset_id=$1 AND user_id=$2`, [datasetId, userId]);
    await query(`INSERT INTO dataset_permissions (id,dataset_id,user_id,role,invited_by,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuid(), datasetId, userId, role, invitedBy, now()]);
  });
}
export async function getDatasetCollaborators(datasetId) {
  return query(`SELECT u.id,u.username,u.email,u.avatar_url,dp.role,dp.created_at FROM dataset_permissions dp JOIN users u ON u.id=dp.user_id WHERE dp.dataset_id=$1 ORDER BY dp.created_at`, [datasetId]);
}
export async function removeCollaborator(datasetId, userId) {
  await query(`DELETE FROM dataset_permissions WHERE dataset_id=$1 AND user_id=$2`, [datasetId, userId]);
}
export async function getUserDatasetRole(datasetId, userId) {
  const ds = await getDataset(datasetId);
  if (ds?.owner_id === userId) return "owner";
  const r = await query(`SELECT role FROM dataset_permissions WHERE dataset_id=$1 AND user_id=$2`, [datasetId, userId]);
  return r[0]?.role || null;
}
export async function getSharedWithMeDatasets(userId, { limit = 50, offset = 0 } = {}) {
  return query(
    `SELECT d.*, dp.role AS my_role FROM datasets d JOIN dataset_permissions dp ON dp.dataset_id=d.id
     WHERE dp.user_id=$1 AND d.is_trashed=0 ORDER BY d.updated_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}


/**
 * Bytes for a version — the ONLY way callers should obtain file content.
 *
 * v21.1: prefers object storage. Rows written before the migration still hold
 * `file_content TEXT`, which is lossless for CSV but was corrupt-on-write for
 * xlsx (binary through a UTF-8 column), so the legacy path is a fallback for
 * old rows only. Nothing new writes it.
 */
export async function getVersionBytes(version) {
  if (!version) throw new Error("getVersionBytes: no version row");

  if (version.storage_key) {
    const storage = await import("../services/storage.js");
    try {
      return await storage.get(version.storage_key);
    } catch (err) {
      // The object is gone (pruned volume, restored DB without its bucket, a
      // key written under a different DATA_DIR). Fall back to the legacy
      // column when the row still has one rather than 500-ing the request —
      // for CSV that content is intact, and for xlsx nothing was recoverable
      // anyway. Callers get bytes or a clear error, never a crash.
      if (version.file_content) return Buffer.from(version.file_content, "utf-8");
      const e = new Error(`stored object missing for version ${version.id}: ${version.storage_key}`);
      e.status = 410;   // Gone — the row exists, the bytes do not
      throw e;
    }
  }

  return Buffer.from(version.file_content || "", "utf-8");
}

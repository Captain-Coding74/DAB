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
export async function getFolders(workspaceId, parentId = null, ownerId = null) {
  // Personal folders store workspace_id NULL — `workspace_id=$1` can never
  // match them (and libsql rejects an undefined argument outright), so branch
  // explicitly and scope personal listings by owner. Workspace listings are
  // membership-checked at the route.
  const scope    = workspaceId ? `workspace_id=$1` : `workspace_id IS NULL AND owner_id=$1`;
  const scopeArg = workspaceId || ownerId;
  if (parentId) return query(`SELECT * FROM dataset_folders WHERE ${scope} AND parent_id=$2 ORDER BY name`, [scopeArg, parentId]);
  return query(`SELECT * FROM dataset_folders WHERE ${scope} AND parent_id IS NULL ORDER BY name`, [scopeArg]);
}
export async function getFolder(id) {
  const r = await query(`SELECT * FROM dataset_folders WHERE id=$1`, [id]);
  return r[0] || null;
}
/* Rename/delete are owner-scoped in the SQL itself (defence in depth — the
   routes also check ownership): unscoped, any authenticated user could rename
   or delete a stranger's folder by id. */
export async function renameFolder(id, name, ownerId) {
  await query(`UPDATE dataset_folders SET name=$1 WHERE id=$2 AND owner_id=$3`, [name, id, ownerId]);
}
export async function deleteFolder(id, ownerId) {
  await query(`DELETE FROM dataset_folders WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
}

// ── Datasets — Create with first version ────────────────────
export async function createDataset({ datasetId: providedId, workspaceId, ownerId, name, description, folderId, fileName, fileContent, storageKey, storageSha256, fileType, totalRows, totalCols, colAnalysis, qualityScore, sizeBytes }) {
  // The caller may supply the id so the storage key it already wrote points
  // at the same dataset; otherwise generate one as before.
  const datasetId = providedId || uuid();
  const versionId = uuid();
  const t = now();

  // Version row FIRST, dataset row second: the two statements autocommit
  // separately (withTransaction is a no-op on SQLite), and a crash between
  // them used to leave a user-visible ghost dataset whose current_version_id
  // pointed nowhere. An orphaned version row is invisible and harmless.
  await query(
    `INSERT INTO dataset_versions (id,dataset_id,version_num,file_name,file_content,storage_key,storage_sha256,file_type,total_rows,total_cols,col_analysis,quality_score,change_note,uploaded_by,size_bytes,created_at)
     VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Initial upload',$12,$13,$14)`,
    [versionId, datasetId, fileName, fileContent ?? '', storageKey||null, storageSha256||null, fileType, totalRows, totalCols, JSON.stringify(colAnalysis), qualityScore||null, ownerId, sizeBytes||0, t]
  );

  await query(
    `INSERT INTO datasets (id,workspace_id,owner_id,name,description,folder_id,current_version_id,total_rows,total_cols,file_type,size_bytes,quality_score,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [datasetId, workspaceId||null, ownerId, name, description||null, folderId||null, versionId, totalRows, totalCols, fileType, sizeBytes||0, qualityScore||null, t, t]
  );

  return { id: datasetId, versionId };
}

// ── New Version (re-upload) ──────────────────────────────────
export async function addDatasetVersion({ datasetId, fileName, fileContent, storageKey, storageSha256, fileType, totalRows, totalCols, colAnalysis, qualityScore, changeNote, uploadedBy, sizeBytes }) {
  const versionId = uuid();
  const t = now();

  // Version number is computed INSIDE the insert: the old read-then-write
  // (SELECT MAX ... then INSERT) let two concurrent uploads both observe v=N
  // and write duplicate version N+1 rows. A scalar subquery in one statement
  // is atomic on both backends, and RETURNING reports the number assigned.
  const inserted = await query(
    `INSERT INTO dataset_versions (id,dataset_id,version_num,file_name,file_content,storage_key,storage_sha256,file_type,total_rows,total_cols,col_analysis,quality_score,change_note,uploaded_by,size_bytes,created_at)
       VALUES ($1,$2,(SELECT COALESCE(MAX(version_num),0)+1 FROM dataset_versions WHERE dataset_id=$2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING version_num`,
      [versionId, datasetId, fileName, fileContent ?? '', storageKey||null, storageSha256||null, fileType, totalRows, totalCols, JSON.stringify(colAnalysis), qualityScore||null, changeNote||null, uploadedBy, sizeBytes||0, t]
  );
  const nextVersion = inserted[0]?.version_num;
  if (changeNote == null) {
    await query(`UPDATE dataset_versions SET change_note=$1 WHERE id=$2`, [`Version ${nextVersion}`, versionId]);
  }

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
  // file_type and size_bytes travel with the version too — without them a
  // restored CSV version under an xlsx dataset kept lying about both.
  await query(`UPDATE datasets SET current_version_id=$1, total_rows=$2, total_cols=$3, quality_score=$4, file_type=$5, size_bytes=$6, updated_at=$7 WHERE id=$8`,
    [versionId, v.total_rows, v.total_cols, v.quality_score, v.file_type, v.size_bytes || 0, now(), datasetId]);
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
  // Tags are fetched in a second batched query rather than aggregated in SQL:
  // GROUP_CONCAT does not exist on Postgres, and the CSV round-trip corrupted
  // any tag containing a comma.
  let sql = `SELECT d.* FROM datasets d WHERE 1=1`;
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

  sql += ` ORDER BY d.updated_at DESC LIMIT $${i++} OFFSET $${i++}`;
  args.push(limit, offset);

  const rows = await query(sql, args);
  if (!rows.length) return rows;

  const ph      = rows.map((_, n) => `$${n + 1}`).join(",");
  const tagRows = await query(`SELECT dataset_id, tag FROM dataset_tags WHERE dataset_id IN (${ph})`, rows.map(r => r.id));
  const byDs    = new Map();
  for (const t of tagRows) {
    if (!byDs.has(t.dataset_id)) byDs.set(t.dataset_id, []);
    byDs.get(t.dataset_id).push(t.tag);
  }
  return rows.map(r => ({ ...r, tags: byDs.get(r.id) || [] }));
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
  // Remove the stored objects FIRST — "permanently delete" must not leave the
  // user's file bytes on disk/S3 forever. storage.remove is idempotent, so a
  // version without a key (legacy file_content rows) is a no-op.
  const versions = await query(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1 AND storage_key IS NOT NULL`, [id]);
  if (versions.length) {
    const storage = await import("../services/storage.js");
    for (const v of versions) await storage.remove(v.storage_key);
  }
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
  // ON CONFLICT works on both backends; `INSERT OR IGNORE` is SQLite-only.
  await query(`INSERT INTO dataset_tags (id,dataset_id,tag) VALUES ($1,$2,$3) ON CONFLICT (dataset_id,tag) DO NOTHING`, [uuid(), datasetId, tag.toLowerCase().trim()]);
}
export async function removeTag(datasetId, tag) {
  await query(`DELETE FROM dataset_tags WHERE dataset_id=$1 AND tag=$2`, [datasetId, tag.toLowerCase().trim()]);
}
export async function getAllTags(ownerId) {
  return query(`SELECT DISTINCT dt.tag, COUNT(*) as cnt FROM dataset_tags dt JOIN datasets d ON d.id=dt.dataset_id WHERE d.owner_id=$1 GROUP BY dt.tag ORDER BY cnt DESC`, [ownerId]);
}

// ── Permissions (sharing with teammates) ────────────────────
export async function shareDataset(datasetId, userId, role, invitedBy) {
  // Both backends support this upsert (libsql binds $N by name since the
  // pool.js fix, so the repeated $4 is safe). The old blanket .catch fallback
  // did DELETE-then-INSERT: any transient insert failure silently revoked the
  // collaborator's existing access, and every real error was swallowed.
  await query(
    `INSERT INTO dataset_permissions (id,dataset_id,user_id,role,invited_by,created_at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(dataset_id,user_id) DO UPDATE SET role=$4`,
    [uuid(), datasetId, userId, role, invitedBy, now()]
  );
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

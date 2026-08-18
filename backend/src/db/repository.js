import { query } from "./pool.js";

/* Default workspace brand — the stamp token (mirrors frontend LEDGER.stamp) */
const DEFAULT_BRAND_COLOR = "#2F9E6E";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();
const now  = () => new Date().toISOString();

// ── Users ──────────────────────────────────────────────────
/** Raised when a username is taken. Carries its own HTTP status so callers
 *  never have to sniff a driver-specific error string. */
export class DuplicateUserError extends Error {
  constructor(username) {
    super(`username "${username}" is already taken`);
    this.name = "DuplicateUserError";
    this.code = "USERNAME_TAKEN";
    this.status = 400;
  }
}

// SQLite and Postgres word their unique-violation errors completely
// differently. Normalise here, once, at the boundary that knows about SQL.
const isUniqueViolation = (err) =>
  err?.code === "23505" ||                                   // Postgres
  /unique constraint|UNIQUE constraint failed/i.test(err?.message || "") ||  // SQLite
  /SQLITE_CONSTRAINT/i.test(err?.rawCode || err?.code || "");

export async function createUser({ username, passwordHash, email }) {
  const id = uuid();
  try {
    await query(`INSERT INTO users (id,username,password_hash,email,created_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, username, passwordHash, email||null, now()]);
  } catch (err) {
    // v16 BUG FIX (found the moment integration tests started hitting the real
    // app): a duplicate username surfaced as a raw SQL error and fell through
    // to a 500. The route tried to catch it with err.message.includes("already")
    // — but the driver says "UNIQUE constraint failed", so it never matched.
    // Users got "Internal Server Error" for a taken username.
    if (isUniqueViolation(err)) throw new DuplicateUserError(username);
    throw err;
  }
  return { id, username, email };
}
export async function findUserByUsername(u) {
  const r = await query(`SELECT * FROM users WHERE username=$1 AND is_active!=0`, [u]);
  return r[0]||null;
}
export async function findUserById(id) {
  const r = await query(`SELECT id,username,email,role,avatar_url,created_at,last_login FROM users WHERE id=$1`, [id]);
  return r[0]||null;
}
export async function updateLastLogin(id) {
  await query(`UPDATE users SET last_login=$1 WHERE id=$2`, [now(),id]);
}

// ── Refresh tokens ─────────────────────────────────────────
export async function storeRefreshToken(userId, tokenHash, expiresAt) {
  // ON CONFLICT DO NOTHING: token_hash is UNIQUE. With the jti fix in
  // signRefresh this should never collide, but a raw insert failure here
  // would 500 the whole login/register request over what's effectively a
  // no-op (the valid token is already stored) — so we degrade gracefully.
  // (Was `INSERT OR IGNORE`, which is SQLite-only syntax and broke every
  // token issue on Postgres; ON CONFLICT works on both backends.)
  await query(`INSERT INTO refresh_tokens (id,user_id,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (token_hash) DO NOTHING`,
    [uuid(),userId,tokenHash,expiresAt,now()]);
}
export async function findRefreshToken(tokenHash) {
  const r = await query(`SELECT * FROM refresh_tokens WHERE token_hash=$1 AND expires_at>$2 AND revoked=0`, [tokenHash,now()]);
  return r[0]||null;
}
export async function revokeRefreshToken(h) { await query(`UPDATE refresh_tokens SET revoked=1 WHERE token_hash=$1`,[h]); }
export async function revokeAllUserTokens(uid) { await query(`UPDATE refresh_tokens SET revoked=1 WHERE user_id=$1`,[uid]); }

// ── Workspaces ─────────────────────────────────────────────
export async function createWorkspace({ name, ownerId, description, brandColor }) {
  const id   = uuid();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-" + id.slice(0,6);
  await query(`INSERT INTO workspaces (id,name,slug,description,owner_id,brand_color,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id,name,slug,description||null,ownerId,brandColor||DEFAULT_BRAND_COLOR,now()]);
  await query(`INSERT INTO workspace_members (id,workspace_id,user_id,role,joined_at) VALUES ($1,$2,$3,'owner',$4)`,
    [uuid(),id,ownerId,now()]);
  return { id, name, slug };
}
export async function getUserWorkspaces(userId) {
  return query(`SELECT w.*,wm.role AS member_role FROM workspaces w JOIN workspace_members wm ON w.id=wm.workspace_id WHERE wm.user_id=$1 ORDER BY w.created_at DESC`,[userId]);
}
export async function getWorkspace(id) {
  const r = await query(`SELECT * FROM workspaces WHERE id=$1`,[id]);
  return r[0]||null;
}
export async function updateWorkspaceBranding({ id, brandLogo, brandColor, brandName }) {
  await query(`UPDATE workspaces SET brand_logo=$1,brand_color=$2,brand_name=$3 WHERE id=$4`,
    [brandLogo||null,brandColor||DEFAULT_BRAND_COLOR,brandName||null,id]);
}
export async function getWorkspaceMembers(wsId) {
  return query(`SELECT u.id,u.username,u.email,u.avatar_url,wm.role,wm.joined_at FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=$1 ORDER BY wm.joined_at`,[wsId]);
}
export async function addWorkspaceMember(wsId, userId, role="member", invitedBy=null) {
  // Duplicate invites stay a no-op via the UNIQUE(workspace_id,user_id)
  // constraint — ON CONFLICT is portable where `INSERT OR IGNORE` was not.
  await query(`INSERT INTO workspace_members (id,workspace_id,user_id,role,invited_by,joined_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,user_id) DO NOTHING`,
    [uuid(),wsId,userId,role,invitedBy,now()]);
}
export async function removeWorkspaceMember(wsId, userId) {
  await query(`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,[wsId,userId]);
}
export async function isMember(wsId, userId) {
  const r = await query(`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,[wsId,userId]);
  return r[0]||null;
}

// ── Datasets ───────────────────────────────────────────────
export async function createDataset({ workspaceId, userId, name, description, fileNames, fileTypes, totalRows, totalCols, colAnalysis, qualityScore }) {
  const id=uuid(), t=now();
  await query(`INSERT INTO datasets (id,workspace_id,user_id,name,description,file_names,file_types,total_rows,total_cols,col_analysis,quality_score,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id,workspaceId||null,userId,name,description||null,JSON.stringify(fileNames),JSON.stringify(fileTypes),totalRows,totalCols,JSON.stringify(colAnalysis),qualityScore||null,t,t]);
  return { id };
}
export async function getDataset(id) {
  const r = await query(`SELECT * FROM datasets WHERE id=$1`,[id]);
  if (!r[0]) return null;
  const d=r[0];
  return {...d, file_names:JSON.parse(d.file_names||"[]"), file_types:JSON.parse(d.file_types||"[]"), col_analysis:JSON.parse(d.col_analysis||"[]")};
}
export async function getWorkspaceDatasets(wsId) {
  return query(`SELECT id,name,description,file_names,total_rows,total_cols,quality_score,created_at FROM datasets WHERE workspace_id=$1 ORDER BY created_at DESC`,[wsId]);
}

// ── Analyses ───────────────────────────────────────────────
export async function saveAnalysis({ userId, workspaceId, datasetId, fileName, fileType, totalRows, totalCols, prompt, analysis, statsJson, chartConfig, qualityScore, durationMs, ipAddress }) {
  const id=uuid();
  await query(`INSERT INTO analyses (id,user_id,workspace_id,dataset_id,file_name,file_type,total_rows,total_cols,prompt,analysis,stats_json,chart_config,quality_score,duration_ms,ip_address,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id,userId||null,workspaceId||null,datasetId||null,fileName,fileType,totalRows,totalCols,prompt,analysis,statsJson?JSON.stringify(statsJson):null,chartConfig?JSON.stringify(chartConfig):null,qualityScore||null,durationMs||0,ipAddress||null,now()]);
  return { id };
}
export async function getAnalysis(id, userId) {
  const r = await query(`SELECT * FROM analyses WHERE id=$1 AND (user_id=$2 OR user_id IS NULL)`,[id,userId]);
  return r[0]||null;
}
export async function getUserAnalyses(userId, { limit=20, offset=0 }={}) {
  return query(`SELECT id,file_name,file_type,total_rows,total_cols,prompt,quality_score,created_at,duration_ms,substr(analysis,1,200) AS preview FROM analyses WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,[userId,limit,offset]);
}
export async function getAnalysisCount(userId) {
  const r = await query(`SELECT COUNT(*) AS cnt FROM analyses WHERE user_id=$1`,[userId]);
  return parseInt(r[0]?.cnt||0);
}
export async function deleteAnalysis(id, userId) { await query(`DELETE FROM analyses WHERE id=$1 AND user_id=$2`,[id,userId]); }
export async function getUserStats(userId) {
  const r = await query(`SELECT COUNT(*) AS total, SUM(total_rows) AS total_rows, AVG(duration_ms) AS avg_ms FROM analyses WHERE user_id=$1`,[userId]);
  return r[0]||{ total:0, total_rows:0, avg_ms:0 };
}

// ── Chat ───────────────────────────────────────────────────
export async function saveChatMessage({ analysisId, userId, role, content }) {
  const id=uuid();
  await query(`INSERT INTO chat_messages (id,analysis_id,user_id,role,content,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id,analysisId,userId,role,content,now()]);
  return { id };
}
export async function getChatHistory(analysisId) {
  return query(`SELECT id,role,content,created_at FROM chat_messages WHERE analysis_id=$1 ORDER BY created_at ASC`,[analysisId]);
}

// ── Shared Reports ─────────────────────────────────────────
export async function createSharedReport({ analysisId, userId, title, passwordHash, expiresAt }) {
  const id=uuid(), token=crypto.randomBytes(24).toString("base64url");
  await query(`INSERT INTO shared_reports (id,analysis_id,user_id,token,title,password_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id,analysisId,userId,token,title||null,passwordHash||null,expiresAt||null,now()]);
  return { id, token };
}
export async function getSharedReport(token) {
  const r = await query(`SELECT sr.*,a.analysis,a.file_name,a.total_rows,a.stats_json,a.chart_config,w.brand_color,w.brand_name,w.brand_logo FROM shared_reports sr JOIN analyses a ON a.id=sr.analysis_id LEFT JOIN workspaces w ON w.id=a.workspace_id WHERE sr.token=$1 AND sr.is_active=1`,[token]);
  if (!r[0]) return null;
  if (r[0].expires_at && new Date(r[0].expires_at) < new Date()) return null;
  return r[0];
}
export async function incrementShareViewCount(token) { await query(`UPDATE shared_reports SET view_count=view_count+1 WHERE token=$1`,[token]); }
export async function getUserSharedReports(userId) {
  return query(`SELECT sr.id,sr.token,sr.title,sr.view_count,sr.expires_at,sr.created_at,a.file_name FROM shared_reports sr JOIN analyses a ON a.id=sr.analysis_id WHERE sr.user_id=$1 ORDER BY sr.created_at DESC`,[userId]);
}
export async function deleteSharedReport(id, userId) { await query(`UPDATE shared_reports SET is_active=0 WHERE id=$1 AND user_id=$2`,[id,userId]); }

// ── Scheduled Reports ──────────────────────────────────────
export async function createScheduledReport({ workspaceId, userId, name, datasetId, prompt, cronExpr, recipients, format }) {
  const id=uuid();
  await query(`INSERT INTO scheduled_reports (id,workspace_id,user_id,name,dataset_id,prompt,cron_expr,recipients,format,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id,workspaceId||null,userId,name,datasetId||null,prompt,cronExpr,JSON.stringify(recipients),format||"pdf",now()]);
  return { id };
}
export async function getScheduledReports(wsId) {
  return query(`SELECT * FROM scheduled_reports WHERE workspace_id=$1 AND is_active=1 ORDER BY created_at DESC`,[wsId]);
}
/** Mark a run and advance next_run — without persisting the next fire time,
 *  getDueScheduledReports matched every report on every one-minute tick. */
export async function updateScheduledRun(id, nextRun = null) { await query(`UPDATE scheduled_reports SET last_run=$1,next_run=$2,run_count=run_count+1 WHERE id=$3`,[now(),nextRun,id]); }
export async function getDueScheduledReports() {
  return query(`SELECT * FROM scheduled_reports WHERE is_active=1 AND (next_run IS NULL OR next_run<=$1)`,[now()]);
}
export async function deleteScheduledReport(id, userId) { await query(`DELETE FROM scheduled_reports WHERE id=$1 AND user_id=$2`,[id,userId]); }

// ── Audit ──────────────────────────────────────────────────
export async function auditLog({ userId, workspaceId, action, resource, ipAddress, userAgent }) {
  await query(`INSERT INTO audit_log (id,user_id,workspace_id,action,resource,ip_address,user_agent,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [uuid(),userId||null,workspaceId||null,action,resource||null,ipAddress||null,userAgent||null,now()]).catch(()=>{});
}

// ── Upload telemetry (v20.2) — see services/telemetry.js for the privacy contract ──
export async function saveUploadMetadata(m) {
  await query(`INSERT INTO upload_metadata (id,source,file_type,row_count,col_count,size_kb,numeric_cols,text_cols,date_cols,buddhist_era,encoding,delimiter,skipped_rows,categories,segment,segment_score,sample_id,user_id,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [uuid(), m.source, m.fileType, m.rowCount, m.colCount, m.sizeKb, m.numericCols, m.textCols, m.dateCols,
     m.buddhistEra ? 1 : 0, m.encoding, m.delimiter, m.skippedRows, JSON.stringify(m.categories || []),
     m.segment, m.segmentScore || 0, m.sampleId || null, m.userId || null, now()]);
}

/** Aggregates in JS over the newest rows — one portable query, no dialect-specific JSON SQL. */
export async function getTelemetrySummary({ limit = 5000 } = {}) {
  const rows = await query(
    `SELECT source,file_type,segment,categories,encoding,buddhist_era,skipped_rows,sample_id
       FROM upload_metadata ORDER BY created_at DESC LIMIT $1`, [limit]);
  const bump = (o, k) => { if (k != null && k !== "") o[k] = (o[k] || 0) + 1; };
  const s = { total: rows.length, bySource: {}, bySegment: {}, byFileType: {}, byEncoding: {},
              categories: {}, demoTaps: {}, messy: { buddhistEra: 0, skippedHeaderRows: 0 } };
  for (const r of rows) {
    bump(s.bySource, r.source); bump(s.bySegment, r.segment);
    bump(s.byFileType, r.file_type); bump(s.byEncoding, r.encoding);
    if (r.sample_id) bump(s.demoTaps, r.sample_id);
    if (r.buddhist_era) s.messy.buddhistEra++;
    if (r.skipped_rows > 0) s.messy.skippedHeaderRows++;
    try { for (const t of JSON.parse(r.categories || "[]")) bump(s.categories, t); } catch { /* tolerate bad rows */ }
  }
  return s;
}

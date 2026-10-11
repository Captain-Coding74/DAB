/**
 * src/db/accountData.js — everything DAB holds about one user, as one JSON
 * document (v21.30). Behind GET /api/auth/me/export and the operator's
 * `privacy-request.mjs export` for requests that arrive by email or post.
 *
 * Every table in migrate.js that holds a user id is read here, so the export
 * is the same list account erasure (db/accountErase.js) works through. Left
 * out on purpose: secrets (the password hash, refresh-token hashes, share-link
 * tokens and passwords), internal storage keys, and other people's ids —
 * a version someone else uploaded to your dataset says "not you", not who.
 * Also left out of the self-service download: the traffic log
 * (services/trafficLog.js), which holds user ids but which no API exposes;
 * erasure leaves it to its own 90-day retention, as the Computer-Related
 * Crime Act s.26 requires. v21.30: the export SAYS so (`about`, and the
 * /account and Privacy Notice text), and a user who asks by email or post
 * gets their entries from the operator (privacy-request.mjs export
 * --traffic-log, which passes { trafficLog: true }).
 * Saved files are listed with the API path that downloads each original
 * (owner only), not inlined: a file can be megabytes and the export must stay
 * a document a person can open and read.
 */
import { query } from "./pool.js";
import { privacyRequestsFor } from "../services/privacyRequests.js";

export const EXPORT_FORMAT = "dab-account-export/1";

/** dab-export-<username>-<yyyy-mm-dd>.json, safe to put in a Content-Disposition. */
export function exportFileName(username, now = new Date()) {
  const safe = String(username || "user").replace(/[^\w.\-฀-๿]+/g, "_").slice(0, 80);
  return `dab-export-${safe}-${now.toISOString().slice(0, 10)}.json`;
}

/* Stored JSON text comes back as structure; a malformed value stays text. */
function parsed(value) {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return value; }
}
const parseFields = (rows, fields) => rows.map((r) => {
  const out = { ...r };
  for (const f of fields) if (f in out) out[f] = parsed(out[f]);
  return out;
});
const byUser = (sql) => (userId) => query(sql, [userId]);

/* Every column of users except anything that is a hash — so legal-acceptance
   fields and any other column added later are exported without a change here. */
async function profile(userId) {
  const [row] = await query(`SELECT * FROM users WHERE id=$1`, [userId]);
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).filter(([k]) => !/hash/i.test(k)));
}

async function workspaces(userId) {
  const rows = await query(
    `SELECT w.id,w.name,w.slug,w.description,w.brand_name,w.brand_color,w.created_at,w.owner_id,wm.role,wm.joined_at
       FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=$1 ORDER BY wm.joined_at`, [userId]);
  return rows.map(({ owner_id, ...w }) => ({ ...w, you_own_it: owner_id === userId }));
}

async function datasets(userId) {
  const rows = await query(`SELECT * FROM datasets WHERE owner_id=$1 ORDER BY created_at`, [userId]);
  const out = [];
  for (const d of rows) {
    const versions = await query(
      `SELECT id,version_num,file_name,file_type,total_rows,total_cols,col_analysis,quality_score,change_note,size_bytes,storage_sha256,uploaded_by,created_at
         FROM dataset_versions WHERE dataset_id=$1 ORDER BY version_num`, [d.id]);
    const tags = await query(`SELECT tag FROM dataset_tags WHERE dataset_id=$1 ORDER BY tag`, [d.id]);
    out.push({
      ...d,
      tags: tags.map((t) => t.tag),
      versions: parseFields(versions, ["col_analysis"]).map(({ uploaded_by, ...v }) => ({
        ...v,
        uploaded_by_you: uploaded_by === userId,
        download: `/api/datasets/${d.id}/versions/${v.id}/download`,
      })),
    });
  }
  return out;
}

const analyses = async (userId) =>
  parseFields(await query(`SELECT * FROM analyses WHERE user_id=$1 ORDER BY created_at`, [userId]), ["stats_json", "chart_config"]);

/* Both sides of every conversation on your analyses, and anything you asked elsewhere. */
const chat = byUser(
  `SELECT id,analysis_id,role,content,created_at FROM chat_messages
    WHERE user_id=$1 OR analysis_id IN (SELECT id FROM analyses WHERE user_id=$1) ORDER BY created_at`);

const shareLinks = async (userId) => (await query(
  `SELECT id,analysis_id,title,created_at,expires_at,view_count,is_active,
          CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS password_protected
     FROM shared_reports WHERE user_id=$1 ORDER BY created_at`, [userId]))
  .map((s) => ({ ...s, password_protected: Number(s.password_protected) === 1 }));

const activity = async (userId) => parseFields(await query(
  `SELECT id,workspace_id,dataset_id,action,target_type,target_id,metadata,created_at FROM activity_feed WHERE user_id=$1 ORDER BY created_at`,
  [userId]), ["metadata"]);

/* v21.30: a version you uploaded to someone else's dataset stays with its
   owner (db/accountErase.js), but it is still your upload: its details are
   yours to see. No download path — the file is the owner's to hand out. */
const versionsYouAdded = byUser(
  `SELECT v.dataset_id,v.version_num,v.file_name,v.file_type,v.total_rows,v.total_cols,v.size_bytes,v.change_note,v.created_at
     FROM dataset_versions v JOIN datasets d ON d.id=v.dataset_id WHERE v.uploaded_by=$1 AND d.owner_id<>$1 ORDER BY v.created_at`);

const telemetry = async (userId) =>
  parseFields(await query(`SELECT * FROM upload_metadata WHERE user_id=$1 ORDER BY created_at`, [userId]), ["categories"])
    .map(({ user_id: _u, ...row }) => row);

const READERS = {
  workspaces,
  datasets,
  versionsYouAddedToOthers: versionsYouAdded,
  sharedWithYou: byUser(`SELECT dataset_id,role,created_at FROM dataset_permissions WHERE user_id=$1 ORDER BY created_at`),
  folders:       byUser(`SELECT id,workspace_id,name,parent_id,created_at FROM dataset_folders WHERE owner_id=$1 ORDER BY created_at`),
  analyses,
  chat,
  shareLinks,
  comments:      byUser(`SELECT id,dataset_id,analysis_id,parent_id,content,is_resolved,is_edited,created_at,updated_at FROM comments WHERE user_id=$1 ORDER BY created_at`),
  mentionsOfYou: byUser(`SELECT id,comment_id,is_read,created_at FROM mentions WHERE mentioned_user_id=$1 ORDER BY created_at`),
  notifications: byUser(`SELECT id,type,title,body,link,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at`),
  dashboards:    byUser(`SELECT id,workspace_id,name,description,layout,created_at,updated_at FROM shared_dashboards WHERE created_by=$1 ORDER BY created_at`),
  scheduledReports: byUser(`SELECT id,workspace_id,name,dataset_id,prompt,cron_expr,recipients,format,is_active,last_run,next_run,run_count,created_at FROM scheduled_reports WHERE user_id=$1 ORDER BY created_at`),
  activity,
  auditLog:      byUser(`SELECT id,workspace_id,action,resource,ip_address,user_agent,created_at FROM audit_log WHERE user_id=$1 ORDER BY created_at`),
  telemetry,
  sessions:      byUser(`SELECT created_at,expires_at,revoked FROM refresh_tokens WHERE user_id=$1 ORDER BY created_at`),
  privacyRequests: (userId) => privacyRequestsFor(userId),
};

const ABOUT = "What Data Analysis Bot holds about this account. Each saved original file is listed under datasets[].versions[].download: download it from the /account page, or GET that path while signed in.";
const NO_TRAFFIC = " Not included: your entries in the traffic log the Computer-Related Crime Act requires — ask by email or post (see /privacy#rights) and we send them.";

/** The whole export, or null when there is no such user. trafficLog: the
 *  operator's export for a request by email or post includes those rows. */
export async function collectAccountData(userId, now = new Date(), { trafficLog = false } = {}) {
  const user = await profile(userId);
  if (!user) return null;
  const out = {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    about: trafficLog ? ABOUT : ABOUT + NO_TRAFFIC,
    profile: user,
  };
  for (const [key, read] of Object.entries(READERS)) out[key] = await read(userId);
  if (trafficLog) out.trafficLog = await query(`SELECT event,ip,ref,created_at FROM traffic_log WHERE user_id=$1 ORDER BY created_at`, [userId]);
  return out;
}

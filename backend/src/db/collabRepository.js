/**
 * src/db/collabRepository.js — Collaboration queries
 * Invite, comment, mention, activity feed, shared dashboards
 */
import { query } from "./pool.js";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();
const now  = () => new Date().toISOString();

// ── Comments + threads ──────────────────────────────────────
export async function createComment({ datasetId, analysisId, userId, parentId, content }) {
  const id = uuid();
  await query(
    `INSERT INTO comments (id,dataset_id,analysis_id,user_id,parent_id,content,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, datasetId||null, analysisId||null, userId, parentId||null, content, now()]
  );
  return { id };
}

export async function getComments(datasetId, analysisId) {
  const sql = datasetId
    ? `SELECT c.*,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.dataset_id=$1 ORDER BY c.created_at ASC`
    : `SELECT c.*,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.analysis_id=$1 ORDER BY c.created_at ASC`;
  const rows = await query(sql, [datasetId || analysisId]);
  // Build threaded structure
  const byId = {}; const roots = [];
  rows.forEach(r => { byId[r.id] = { ...r, replies: [] }; });
  rows.forEach(r => {
    if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].replies.push(byId[r.id]);
    else roots.push(byId[r.id]);
  });
  return roots;
}

export async function editComment(id, userId, content) {
  await query(`UPDATE comments SET content=$1, is_edited=1, updated_at=$2 WHERE id=$3 AND user_id=$4`, [content, now(), id, userId]);
}
export async function deleteComment(id, userId) {
  await query(`DELETE FROM comments WHERE id=$1 AND user_id=$2`, [id, userId]);
}
export async function resolveComment(id) {
  await query(`UPDATE comments SET is_resolved=1 WHERE id=$1`, [id]);
}

// ── Mentions (@username parsing + notification) ─────────────
export async function createMention(commentId, mentionedUserId) {
  await query(`INSERT INTO mentions (id,comment_id,mentioned_user_id,created_at) VALUES ($1,$2,$3,$4)`,
    [uuid(), commentId, mentionedUserId, now()]);
}
export async function getUnreadMentions(userId) {
  return query(
    `SELECT m.id,m.comment_id,m.created_at,c.content,u.username AS from_username
     FROM mentions m JOIN comments c ON c.id=m.comment_id JOIN users u ON u.id=c.user_id
     WHERE m.mentioned_user_id=$1 AND m.is_read=0 ORDER BY m.created_at DESC LIMIT 50`,
    [userId]
  );
}
export async function markMentionsRead(userId) {
  await query(`UPDATE mentions SET is_read=1 WHERE mentioned_user_id=$1`, [userId]);
}

/** Parse @username mentions out of comment text */
export function parseMentions(content) {
  const matches = content.match(/@([a-zA-Z0-9_]+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

// ── Notifications ────────────────────────────────────────────
export async function createNotification({ userId, type, title, body, link }) {
  await query(`INSERT INTO notifications (id,user_id,type,title,body,link,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuid(), userId, type, title, body||null, link||null, now()]);
}
export async function getNotifications(userId, { limit = 30, unreadOnly = false } = {}) {
  const sql = unreadOnly
    ? `SELECT * FROM notifications WHERE user_id=$1 AND is_read=0 ORDER BY created_at DESC LIMIT $2`
    : `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`;
  return query(sql, [userId, limit]);
}
export async function markNotificationRead(id, userId) {
  await query(`UPDATE notifications SET is_read=1 WHERE id=$1 AND user_id=$2`, [id, userId]);
}
export async function markAllNotificationsRead(userId) {
  await query(`UPDATE notifications SET is_read=1 WHERE user_id=$1`, [userId]);
}
export async function getUnreadCount(userId) {
  const r = await query(`SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=$1 AND is_read=0`, [userId]);
  return parseInt(r[0]?.cnt || 0);
}

// ── Activity Feed ─────────────────────────────────────────────
const ACTIONS = {
  dataset_created:  (n) => `อัปโหลด dataset "${n.name}"`,
  dataset_renamed:  (n) => `เปลี่ยนชื่อเป็น "${n.name}"`,
  dataset_deleted:  (n) => `ลบ dataset "${n.name}"`,
  version_added:    (n) => `อัปเดต version ${n.version} ของ "${n.name}"`,
  comment_added:    (n) => `แสดงความเห็นใน "${n.name}"`,
  member_invited:   (n) => `เชิญ ${n.invitee} เข้า workspace`,
  dataset_shared:   (n) => `แชร์ "${n.name}" ให้ ${n.invitee}`,
  analysis_created: (n) => `วิเคราะห์ "${n.name}"`,
  dashboard_created:(n) => `สร้าง dashboard "${n.name}"`,
};

export async function logActivity({ workspaceId, datasetId, userId, action, targetType, targetId, metadata }) {
  await query(
    `INSERT INTO activity_feed (id,workspace_id,dataset_id,user_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uuid(), workspaceId||null, datasetId||null, userId, action, targetType||null, targetId||null, metadata ? JSON.stringify(metadata) : null, now()]
  ).catch(() => {});
}

export async function getActivityFeed({ workspaceId, datasetId, limit = 50, offset = 0 }) {
  const sql = datasetId
    ? `SELECT a.*,u.username,u.avatar_url FROM activity_feed a JOIN users u ON u.id=a.user_id WHERE a.dataset_id=$1 ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`
    : `SELECT a.*,u.username,u.avatar_url FROM activity_feed a JOIN users u ON u.id=a.user_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`;
  const rows = await query(sql, [datasetId || workspaceId, limit, offset]);
  return rows.map(r => {
    const meta = r.metadata ? JSON.parse(r.metadata) : {};
    const describe = ACTIONS[r.action];
    return { ...r, metadata: meta, description: describe ? describe(meta) : r.action };
  });
}

// ── Shared Dashboards ─────────────────────────────────────────
export async function createDashboard({ workspaceId, name, description, createdBy }) {
  const id = uuid(); const t = now();
  await query(`INSERT INTO shared_dashboards (id,workspace_id,name,description,layout,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,'[]',$5,$6,$7)`,
    [id, workspaceId, name, description||null, createdBy, t, t]);
  return { id };
}
export async function getDashboards(workspaceId) {
  return query(`SELECT id,name,description,created_by,created_at,updated_at FROM shared_dashboards WHERE workspace_id=$1 ORDER BY updated_at DESC`, [workspaceId]);
}
export async function getDashboard(id) {
  const r = await query(`SELECT * FROM shared_dashboards WHERE id=$1`, [id]);
  if (!r[0]) return null;
  const widgets = await query(`SELECT * FROM dashboard_widgets WHERE dashboard_id=$1`, [id]);
  return { ...r[0], widgets: widgets.map(w => ({ ...w, config: JSON.parse(w.config), position: JSON.parse(w.position) })) };
}
export async function addWidget({ dashboardId, analysisId, datasetId, widgetType, title, config, position }) {
  const id = uuid();
  await query(`INSERT INTO dashboard_widgets (id,dashboard_id,analysis_id,dataset_id,widget_type,title,config,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, dashboardId, analysisId||null, datasetId||null, widgetType, title||null, JSON.stringify(config), JSON.stringify(position), now()]);
  await query(`UPDATE shared_dashboards SET updated_at=$1 WHERE id=$2`, [now(), dashboardId]);
  return { id };
}
export async function updateWidgetPosition(id, position) {
  await query(`UPDATE dashboard_widgets SET position=$1 WHERE id=$2`, [JSON.stringify(position), id]);
}
export async function removeWidget(id) {
  await query(`DELETE FROM dashboard_widgets WHERE id=$1`, [id]);
}
export async function deleteDashboard(id) {
  await query(`DELETE FROM dashboard_widgets WHERE dashboard_id=$1`, [id]);
  await query(`DELETE FROM shared_dashboards WHERE id=$1`, [id]);
}

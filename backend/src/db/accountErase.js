/**
 * src/db/accountErase.js — erase an account and everything it owns (v21.30).
 * Behind DELETE /api/auth/me and the operator's `privacy-request.mjs delete`.
 *
 * What goes, immediately: every dataset the user owns and every analysis they
 * made, through the same cascades as their own deletes (db/cascade.js) — so
 * stored files, chat, share links, comment threads and the rows that point at
 * them go too; then their remaining chat, share links and schedules, the
 * comments they wrote (with the replies under them, as deleting a comment
 * always did), mentions and notifications for them, notifications and activity
 * rows that name them, collaborator grants to and by them, folders and
 * dashboards they made, memberships, refresh tokens, audit-log rows, and the
 * users row itself.
 *
 * What changes instead of going: a workspace they own passes to the
 * earliest-joined remaining admin, else member (a remaining co-owner simply
 * keeps it; viewers are read-only and never inherit); with nobody to take it,
 * the workspace and its rows are deleted and anything other people left in
 * it moves to their personal space. A version they uploaded to someone
 * else's dataset is that person's data and stays, with uploaded_by replaced.
 * Upload telemetry stays, unlinked (user_id NULL).
 *
 * The traffic log is not touched: it is a legal record with its own 90-day
 * retention. Neither is the privacy-request log, which holds only a hash.
 *
 * No transaction: the cascades run on the shared pool and stored objects
 * cannot be rolled back anyway. Instead every step is idempotent and the
 * users row goes LAST, so a failure part-way leaves an account that can
 * still sign in and simply run the deletion again.
 */
import { query } from "./pool.js";
import { cache } from "../services/cache.js";
import { deleteAnalysisCascade, deleteDatasetCascade, deleteCommentsWithReplies } from "./cascade.js";

/** dataset_versions.uploaded_by is NOT NULL; this marks a version whose uploader erased their account. */
export const ERASED_USER = "erased-user";

/* Who inherits a workspace, in order. Viewers are read-only by choice of the
   owner — promoting one would grant rights nobody gave them. */
const SUCCESSION = ["owner", "admin", "member"];

const placeholders = (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(",");
const idsOf = (rows) => rows.map((r) => r.id);

async function deleteDashboards(ids) {
  if (!ids.length) return;
  await query(`DELETE FROM dashboard_widgets WHERE dashboard_id IN (${placeholders(ids.length)})`, ids);
  await query(`DELETE FROM shared_dashboards WHERE id IN (${placeholders(ids.length)})`, ids);
}

/* Nobody is left to take the workspace. Its members' datasets and analyses
   are theirs, not the workspace's, so they move to their personal space;
   what belonged to the workspace itself goes with it. */
async function deleteWorkspace(wsId) {
  await query(`UPDATE datasets SET workspace_id=NULL, folder_id=NULL WHERE workspace_id=$1`, [wsId]);
  await query(`UPDATE analyses SET workspace_id=NULL WHERE workspace_id=$1`, [wsId]);
  await query(`DELETE FROM dataset_folders WHERE workspace_id=$1`, [wsId]);
  await deleteDashboards(idsOf(await query(`SELECT id FROM shared_dashboards WHERE workspace_id=$1`, [wsId])));
  await query(`DELETE FROM activity_feed WHERE workspace_id=$1`, [wsId]);
  await query(`DELETE FROM scheduled_reports WHERE workspace_id=$1`, [wsId]);
  await query(`DELETE FROM workspace_members WHERE workspace_id=$1`, [wsId]);
  await query(`DELETE FROM workspaces WHERE id=$1`, [wsId]);
}

/** Hand over (or delete) every workspace the user owns. Returns { passed, deleted }. */
export async function handOverWorkspaces(userId) {
  const owned = await query(
    `SELECT id, owner_id FROM workspaces
      WHERE owner_id=$1 OR id IN (SELECT workspace_id FROM workspace_members WHERE user_id=$1 AND role='owner')`, [userId]);
  const done = { passed: 0, deleted: 0 };
  for (const ws of owned) {
    const others = await query(
      `SELECT user_id, role FROM workspace_members WHERE workspace_id=$1 AND user_id<>$2 ORDER BY joined_at, id`, [ws.id, userId]);
    const heir = SUCCESSION.map((role) => others.find((m) => m.role === role)).find(Boolean);
    if (!heir) { await deleteWorkspace(ws.id); done.deleted++; continue; }
    if (heir.role !== "owner") {
      await query(`UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2`, [ws.id, heir.user_id]);
    }
    if (ws.owner_id === userId || heir.role !== "owner") {
      await query(`UPDATE workspaces SET owner_id=$1 WHERE id=$2`, [heir.user_id, ws.id]);
    }
    done.passed++;
  }
  return done;
}

/* Rows other people hold that are about this user by name: "<name> mentioned
   you" notifications and "shared with <name>" activity. There is no sender
   column, so they are matched on the exact text the app writes. */
async function deleteRowsNaming(username) {
  await query(`DELETE FROM notifications WHERE type='mention' AND title=$1`, [`${username} mentioned you`]);
  const shared = await query(`SELECT id, metadata FROM activity_feed WHERE action IN ('dataset_shared','member_invited')`);
  const naming = shared.filter((r) => {
    try { return JSON.parse(r.metadata || "{}").invitee === username; } catch { return false; }
  });
  if (naming.length) await query(`DELETE FROM activity_feed WHERE id IN (${placeholders(naming.length)})`, idsOf(naming));
}

/* Folders the user made. Anything someone else filed inside moves to the top level. */
async function deleteFolders(userId) {
  const ids = idsOf(await query(`SELECT id FROM dataset_folders WHERE owner_id=$1`, [userId]));
  if (!ids.length) return;
  const ph = placeholders(ids.length);
  await query(`UPDATE datasets SET folder_id=NULL WHERE folder_id IN (${ph})`, ids);
  await query(`UPDATE dataset_folders SET parent_id=NULL WHERE parent_id IN (${ph})`, ids);
  await query(`DELETE FROM dataset_folders WHERE id IN (${ph})`, ids);
}

/** Erase the account. Safe to run again on a partly erased account. Returns a count summary (no ids). */
export async function eraseAccount(userId) {
  const [user] = await query(`SELECT username FROM users WHERE id=$1`, [userId]);
  // Sessions go FIRST (v21.30). The cascades below remove one stored object
  // per version and can take a while; a refresh from another tab during that
  // time used to mint a fresh access token that outlived the erased-account
  // guard (auth.js markErased) and could store a file under the gone id. A
  // failure part-way leaves an account that signs in with its password again.
  await query(`DELETE FROM refresh_tokens WHERE user_id=$1`, [userId]);
  const summary = { workspaces: await handOverWorkspaces(userId), datasets: 0, analyses: 0 };

  for (const id of idsOf(await query(`SELECT id FROM datasets WHERE owner_id=$1`, [userId]))) {
    await deleteDatasetCascade(id); summary.datasets++;
  }
  for (const id of idsOf(await query(`SELECT id FROM analyses WHERE user_id=$1`, [userId]))) {
    await deleteAnalysisCascade(id); summary.analyses++;
  }
  for (const table of ["chat_messages", "shared_reports", "scheduled_reports", "notifications", "activity_feed"]) {
    await query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
  }
  await deleteCommentsWithReplies(idsOf(await query(`SELECT id FROM comments WHERE user_id=$1`, [userId])));
  await query(`DELETE FROM mentions WHERE mentioned_user_id=$1`, [userId]);
  if (user?.username) await deleteRowsNaming(user.username);
  await query(`DELETE FROM dataset_permissions WHERE user_id=$1 OR invited_by=$1`, [userId]);
  await deleteFolders(userId);
  await deleteDashboards(idsOf(await query(`SELECT id FROM shared_dashboards WHERE created_by=$1`, [userId])));

  await query(`DELETE FROM workspace_members WHERE user_id=$1`, [userId]);
  await query(`UPDATE workspace_members SET invited_by=NULL WHERE invited_by=$1`, [userId]);
  await query(`UPDATE dataset_versions SET uploaded_by=$1 WHERE uploaded_by=$2`, [ERASED_USER, userId]);
  await query(`UPDATE upload_metadata SET user_id=NULL WHERE user_id=$1`, [userId]);
  await query(`DELETE FROM refresh_tokens WHERE user_id=$1`, [userId]);   // again: a login during the erasure
  await query(`DELETE FROM audit_log WHERE user_id=$1`, [userId]);
  await query(`DELETE FROM users WHERE id=$1`, [userId]);

  // Profile (60 s), History list (30 s) and each analysis (120 s) are cached
  // per user — none of it may be served after the account is gone.
  await cache.delPattern(`user:${userId}:`);
  return summary;
}

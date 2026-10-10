/**
 * src/db/cascade.js — delete an analysis or a dataset with EVERYTHING tied to
 * it (v21.30).
 *
 * Before this, "permanently delete" removed the dataset's versions, tags,
 * permissions and comments but left its analyses behind — each still holding
 * the filename, per-column top values and the AI report — along with their
 * chat logs, share links, the activity rows and notifications that name the
 * dataset, and any schedule pointing at it. Deleting a history item removed
 * the analyses row and orphaned its chat. Erasure has to be whole to mean
 * anything, so every path that deletes one of these — permanent delete, empty
 * trash, history delete, the retention jobs — goes through these two
 * functions, and anything added later (account deletion) must too.
 *
 * Every table in migrate.js that references a dataset or an analysis:
 *   dataset_versions, dataset_tags, dataset_permissions, scheduled_reports,
 *   dashboard_widgets, activity_feed (dataset_id, target_id) and analyses by
 *   dataset_id; chat_messages, shared_reports and dashboard_widgets by
 *   analysis_id; comments by either (replies and mentions go with them);
 *   notifications by the link they open (/datasets/:id, /analysis/:id).
 * audit_log.resource is the one reference left alone: nothing writes a
 * dataset or analysis id there, and the audit log has its own retention.
 *
 * Children go first and the parent row last, so a crash part-way leaves the
 * dataset or analysis in place and the delete can simply be run again.
 */
import { query } from "./pool.js";
import { cache } from "../services/cache.js";

const placeholders = (n) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(",");

/** Comments on a dataset or analysis, every reply under them, and their mentions. */
async function deleteCommentThreads(column, id) {
  await deleteCommentsWithReplies((await query(`SELECT id FROM comments WHERE ${column}=$1`, [id])).map((r) => r.id));
}

/** These comments, every reply under them, and their mentions (also used by db/accountErase.js). */
export async function deleteCommentsWithReplies(rootIds) {
  let level = [...rootIds];
  const doomed = new Set(level);
  while (level.length) {
    const kids = await query(`SELECT id FROM comments WHERE parent_id IN (${placeholders(level.length)})`, level);
    level = kids.map((k) => k.id).filter((k) => !doomed.has(k));
    level.forEach((k) => doomed.add(k));
  }
  if (!doomed.size) return;
  const ids = [...doomed];
  await query(`DELETE FROM mentions WHERE comment_id IN (${placeholders(ids.length)})`, ids);
  await query(`DELETE FROM comments WHERE id IN (${placeholders(ids.length)})`, ids);
}

/**
 * Delete one analysis: its chat, share links, comments (with replies and
 * mentions), the notifications and activity rows that point at it, any
 * dashboard widget built from it, then the analyses row. Idempotent.
 */
export async function deleteAnalysisCascade(analysisId) {
  const [row] = await query(`SELECT user_id FROM analyses WHERE id=$1`, [analysisId]);
  await query(`DELETE FROM chat_messages WHERE analysis_id=$1`, [analysisId]);
  await query(`DELETE FROM shared_reports WHERE analysis_id=$1`, [analysisId]);
  await deleteCommentThreads("analysis_id", analysisId);
  await query(`DELETE FROM notifications WHERE link=$1`, [`/analysis/${analysisId}`]);
  await query(`DELETE FROM activity_feed WHERE target_id=$1`, [analysisId]);
  await query(`DELETE FROM dashboard_widgets WHERE analysis_id=$1`, [analysisId]);
  await query(`DELETE FROM analyses WHERE id=$1`, [analysisId]);
  // History caches the list for 30 s and each analysis for 120 s — a deleted
  // analysis must not keep being served from there.
  if (row?.user_id) {
    await cache.del(`user:${row.user_id}:analysis:${analysisId}`);
    await cache.delPattern(`user:${row.user_id}:history:`);
  }
}

/**
 * Delete one dataset: the stored file of every version, then every analysis
 * made from it (through deleteAnalysisCascade), its versions, tags,
 * collaborators, comments, activity rows, the notifications that link to it,
 * schedules and dashboard widgets that use it, and finally the dataset row.
 * Idempotent.
 */
export async function deleteDatasetCascade(datasetId) {
  // The stored bytes go first, as permanent delete always did: the rows below
  // are the only record of these keys. storage.remove is idempotent (an
  // already-missing object is skipped); legacy file_content rows have no key.
  const versions = await query(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1 AND storage_key IS NOT NULL`, [datasetId]);
  if (versions.length) {
    const storage = await import("../services/storage.js");
    for (const v of versions) await storage.remove(v.storage_key);
  }
  const analyses = await query(`SELECT id FROM analyses WHERE dataset_id=$1`, [datasetId]);
  for (const a of analyses) await deleteAnalysisCascade(a.id);

  await query(`DELETE FROM dataset_versions WHERE dataset_id=$1`, [datasetId]);
  await query(`DELETE FROM dataset_tags WHERE dataset_id=$1`, [datasetId]);
  await query(`DELETE FROM dataset_permissions WHERE dataset_id=$1`, [datasetId]);
  await deleteCommentThreads("dataset_id", datasetId);
  await query(`DELETE FROM activity_feed WHERE dataset_id=$1 OR target_id=$1`, [datasetId]);
  await query(`DELETE FROM notifications WHERE link=$1`, [`/datasets/${datasetId}`]);
  await query(`DELETE FROM scheduled_reports WHERE dataset_id=$1`, [datasetId]);
  await query(`DELETE FROM dashboard_widgets WHERE dataset_id=$1`, [datasetId]);
  await query(`DELETE FROM datasets WHERE id=$1`, [datasetId]);
}

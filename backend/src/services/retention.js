/**
 * services/retention.js — how long DAB keeps things, enforced (v21.30).
 *
 * Nothing used to expire: trashed datasets waited for the user to empty the
 * trash, and analyses, telemetry, the audit log, the activity feed and
 * notifications grew forever. Each kind of data now has a retention period
 * (RETENTION_DEFAULTS, every one overridable by the env var of the same name
 * — see .env.example) and a job that deletes what is past it:
 *
 *   trash      datasets in Trash longer than TRASH_RETENTION_DAYS
 *   datasets   saved datasets with no activity for DATASET_RETENTION_DAYS —
 *              activity is the latest of created, updated, last used
 *              (opened, analysed, tested), newest version, newest analysis
 *   analyses   analyses older than ANALYSIS_RETENTION_DAYS, with their chat
 *              and share links (db/cascade.js)
 *   telemetry  upload_metadata rows older than TELEMETRY_RETENTION_DAYS
 *   audit      audit_log rows older than AUDIT_RETENTION_DAYS
 *   activity, notifications   rows older than ACTIVITY_RETENTION_DAYS
 *
 * Datasets and analyses go through the same cascades as a user's own delete,
 * so expiry is as complete as erasure. The registry is open: later modules
 * add their own jobs with registerRetentionJob. startRetention (called from
 * scheduler.js) runs every job daily at 03:17 Bangkok time and once shortly
 * after boot. Logs carry job names and counts only — never an id, a name or
 * any content.
 */
import cron from "node-cron";
import { query } from "../db/pool.js";
import { deleteAnalysisCascade, deleteDatasetCascade } from "../db/cascade.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("retention");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days kept, by env var name. These are the periods the Privacy Notice states. */
export const RETENTION_DEFAULTS = Object.freeze({
  TRASH_RETENTION_DAYS:     30,
  DATASET_RETENTION_DAYS:   365,
  ANALYSIS_RETENTION_DAYS:  365,
  TELEMETRY_RETENTION_DAYS: 395,
  AUDIT_RETENTION_DAYS:     365,
  ACTIVITY_RETENTION_DAYS:  365,
});

/**
 * The configured period: a positive whole number of days, else the default
 * with a warning. A typo must not become "keep forever" (NaN compares false
 * against every date) or "delete everything" (0 or a negative number).
 */
export function retentionDays(name, env = process.env, fallback = RETENTION_DEFAULTS[name]) {
  const raw = String(env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  log.warn({ setting: name, fallback }, "retention period must be a positive whole number of days — using the default");
  return fallback;
}

/** ISO time `days` before `now`: anything older is past retention. */
export const cutoffFor = (days, now = Date.now()) => new Date(now - days * DAY_MS).toISOString();

const jobs = [];

/** fn({ now, env }) resolves to how many items it deleted. Re-registering a name replaces it. */
export function registerRetentionJob(name, fn) {
  const i = jobs.findIndex((j) => j.name === name);
  if (i >= 0) jobs[i] = { name, fn };
  else jobs.push({ name, fn });
}
export const retentionJobNames = () => jobs.map((j) => j.name);

/** Run every job once. A failing job is logged and the others still run. */
export async function runRetention({ now = Date.now(), env = process.env } = {}) {
  const deleted = {};
  for (const { name, fn } of jobs) {
    try {
      deleted[name] = await fn({ now, env });
    } catch (err) {
      deleted[name] = null;
      log.error({ job: name, error: err.message }, "retention job failed");
    }
  }
  log.info({ deleted }, "retention run complete");
  return deleted;
}

/** Cascade-delete each id; one failure (a locked database, say) must not stop the rest. */
async function deleteEach(job, ids, del) {
  let done = 0, failed = 0;
  for (const id of ids) {
    try { await del(id); done++; } catch { failed++; }
  }
  if (failed) log.warn({ job, failed }, "some items could not be deleted — the next run retries them");
  return done;
}

async function deleteOlderThan(table, cutoff) {
  const [row] = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE created_at < $1`, [cutoff]);
  const n = Number(row?.n || 0);
  if (n) await query(`DELETE FROM ${table} WHERE created_at < $1`, [cutoff]);
  return n;
}

const cutoffOf = (setting, { now, env }) => cutoffFor(retentionDays(setting, env), now);

registerRetentionJob("trash", async (ctx) => {
  // trashed_at is always set by trashDataset; updated_at covers any row from before it was.
  const rows = await query(
    `SELECT id FROM datasets WHERE is_trashed=1 AND COALESCE(trashed_at, updated_at) < $1`,
    [cutoffOf("TRASH_RETENTION_DAYS", ctx)]);
  return deleteEach("trash", rows.map((r) => r.id), deleteDatasetCascade);
});

registerRetentionJob("datasets", async (ctx) => {
  const rows = await query(
    `SELECT d.id FROM datasets d
      WHERE d.created_at < $1 AND d.updated_at < $1
        AND (d.last_used_at IS NULL OR d.last_used_at < $1)
        AND NOT EXISTS (SELECT 1 FROM dataset_versions v WHERE v.dataset_id = d.id AND v.created_at >= $1)
        AND NOT EXISTS (SELECT 1 FROM analyses a WHERE a.dataset_id = d.id AND a.created_at >= $1)`,
    [cutoffOf("DATASET_RETENTION_DAYS", ctx)]);
  return deleteEach("datasets", rows.map((r) => r.id), deleteDatasetCascade);
});

registerRetentionJob("analyses", async (ctx) => {
  const rows = await query(`SELECT id FROM analyses WHERE created_at < $1`, [cutoffOf("ANALYSIS_RETENTION_DAYS", ctx)]);
  return deleteEach("analyses", rows.map((r) => r.id), deleteAnalysisCascade);
});

registerRetentionJob("telemetry",     (ctx) => deleteOlderThan("upload_metadata", cutoffOf("TELEMETRY_RETENTION_DAYS", ctx)));
registerRetentionJob("audit",         (ctx) => deleteOlderThan("audit_log",       cutoffOf("AUDIT_RETENTION_DAYS", ctx)));
registerRetentionJob("activity",      (ctx) => deleteOlderThan("activity_feed",   cutoffOf("ACTIVITY_RETENTION_DAYS", ctx)));
registerRetentionJob("notifications", (ctx) => deleteOlderThan("notifications",   cutoffOf("ACTIVITY_RETENTION_DAYS", ctx)));

let started = false;

/** Daily at 03:17 Bangkok (off the hour, outside school hours) and once ~1 min after boot. */
export function startRetention({ delayMs = 60_000 } = {}) {
  if (started) return;
  started = true;
  // Read every setting now so a bad value is reported at boot, not first at 03:17.
  for (const name of Object.keys(RETENTION_DEFAULTS)) retentionDays(name);
  const run = () => runRetention().catch((err) => log.error({ error: err.message }, "retention run failed"));
  cron.schedule("17 3 * * *", run, { timezone: "Asia/Bangkok" });
  setTimeout(run, delayMs).unref();
}

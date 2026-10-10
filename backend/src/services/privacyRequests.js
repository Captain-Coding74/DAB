/**
 * services/privacyRequests.js — the privacy-request log (v21.30).
 *
 * PDPA gives people the right to a copy of their data and to have it erased,
 * and the operator has to be able to show that each request was answered.
 * Every self-service export and account deletion writes a row here, and the
 * operator logs requests that arrive by email or post with
 * scripts/privacy-request.mjs.
 *
 * The row outlives the account it is about, so it holds no name, no email and
 * no user id — only subject_hash, the sha256 of the user id. That is enough
 * to match a later "did you delete me?" question to its row and identifies
 * nobody by itself. The retention job in services/retention.js deletes rows
 * after PRIVACY_REQUEST_RETENTION_DAYS (3 years).
 */
import { createHash, randomUUID } from "node:crypto";
import { query } from "../db/pool.js";

export const REQUEST_TYPES    = Object.freeze(["export", "delete", "access", "rectify", "object", "other"]);
export const REQUEST_CHANNELS = Object.freeze(["self-service", "email", "post"]);
export const REQUEST_STATUSES = Object.freeze(["received", "completed", "refused"]);

/** One-way: sha256 hex of the user id (or, for someone with no account, of the identifier they gave). */
export const subjectHash = (subject) => createHash("sha256").update(String(subject)).digest("hex");

function check(list, value, what) {
  if (!list.includes(value)) throw new TypeError(`privacy request ${what} must be one of ${list.join(", ")}`);
}

/**
 * Record a request. `subject` is the user id. A request that is already
 * handled (a self-service export) is logged "completed" in one step; one that
 * is about to be carried out (a deletion) is logged "received" first and
 * completed afterwards, so a failure part-way leaves an open row to follow up.
 */
export async function logPrivacyRequest({ subject, type, channel, status = "completed", note = null, now = new Date() }) {
  if (subject == null || subject === "") throw new TypeError("privacy request needs a subject");
  check(REQUEST_TYPES, type, "type");
  check(REQUEST_CHANNELS, channel, "channel");
  check(REQUEST_STATUSES, status, "status");
  const id = randomUUID();
  const at = now.toISOString();
  await query(
    `INSERT INTO privacy_requests (id,subject_hash,type,channel,status,created_at,completed_at,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, subjectHash(subject), type, channel, status, at, status === "received" ? null : at, note || null]);
  return { id };
}

/** Close an open request — "completed", or "refused" (with the reason in the note). */
export async function completePrivacyRequest(id, { status = "completed", note = null, now = new Date() } = {}) {
  check(REQUEST_STATUSES.filter((s) => s !== "received"), status, "status");
  const r = await query(
    `UPDATE privacy_requests SET status=$1, completed_at=$2, note=COALESCE($3, note) WHERE id=$4 RETURNING id`,
    [status, now.toISOString(), note || null, id]);
  return r.length === 1;
}

/** The requests about one subject, oldest first — for that subject's own export. */
export async function privacyRequestsFor(subject) {
  return query(
    `SELECT id,type,channel,status,created_at,completed_at FROM privacy_requests WHERE subject_hash=$1 ORDER BY created_at`,
    [subjectHash(subject)]);
}

/** Newest first, for the operator. */
export async function listPrivacyRequests({ limit = 50 } = {}) {
  return query(
    `SELECT id,subject_hash,type,channel,status,created_at,completed_at,note FROM privacy_requests ORDER BY created_at DESC LIMIT $1`,
    [limit]);
}

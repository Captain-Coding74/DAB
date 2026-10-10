/**
 * lib/saveDataset.js — the explicit "Save dataset" step (v21.30).
 *
 * Analyze used to POST the same File to /api/datasets for every signed-in
 * user, silently, so the hypothesis tests had a stored copy to read. The
 * original file — often a full gradebook or customer list — was then kept
 * with no time limit, and nothing on screen said so. Now the file is stored
 * only when the user presses "Save dataset" and confirms a dialog that says
 * what is kept and for how long. Features that need the stored copy
 * (hypothesis tests, data fixes and their versions) offer that same action
 * instead of failing.
 *
 * Plain functions, no React: the decisions here are unit-tested under Node
 * (saveDataset.test.js); components/dashboard/SaveDataset.jsx renders them.
 */
import { apiFetch } from "./api.js";   // explicit .js: this module is unit-tested under plain Node

/**
 * Where the save action stands for the result on screen:
 *   "none"        no result yet
 *   "saved"       the result already has a stored dataset
 *   "signed-out"  saving needs an account
 *   "no-file"     signed in, but the original file is not in memory (a demo
 *                 sample) — there is nothing to save
 *   "ready"       the Save dataset action can be offered
 */
export function saveStatus({ signedIn, file, analysis }) {
  if (!analysis) return "none";
  if (analysis.datasetId) return "saved";
  if (!signedIn) return "signed-out";
  if (!file) return "no-file";
  return "ready";
}

/**
 * School Edition: when the result has a class report, the file is a class
 * roster and the dialog asks for the school-authority attestation. The
 * server decides the same way (services/schoolRoster.js) and refuses the save
 * with SCHOOL_AUTHORITY_REQUIRED without it.
 */
export const needsSchoolAttestation = (analysis) => !!analysis?.classReport;

export function saveForm(file, { schoolAuthority = false } = {}) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  if (schoolAuthority) fd.append("schoolAuthority", "1");
  return fd;
}

/**
 * POST /api/datasets. Resolves { ok: true, id } or { ok: false, code, error,
 * errorEn } — never throws for an HTTP error, so the dialog can react to the
 * code (SCHOOL_AUTHORITY_REQUIRED shows the attestation it was missing).
 */
export async function saveDataset(file, opts = {}, fetcher = apiFetch) {
  const res  = await fetcher("/api/datasets", { method: "POST", headers: {}, body: saveForm(file, opts) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, code: data.code || null, error: data.error || `HTTP ${res.status}`, errorEn: data.errorEn || null };
  return { ok: true, id: data.id };
}

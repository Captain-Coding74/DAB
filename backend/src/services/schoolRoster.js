/**
 * services/schoolRoster.js — saving a class roster needs the school's say-so
 * (v21.30).
 *
 * School Edition builds a class report (services/classReport.js) when a file
 * is shaped like a teacher's gradebook: a student-id column, scores, 3–500
 * rows. Saving that file stores children's records — names, ids, often a
 * citizen id and birth date — for as long as the dataset lives, and the
 * teacher holds them on the school's behalf. So every upload that saves a
 * file (POST /api/datasets, /multi and /:id/versions) asks the uploader to
 * confirm that authority first, and refuses with SCHOOL_AUTHORITY_REQUIRED
 * otherwise. The confirmation time is kept on the dataset.
 *
 * isClassRoster is the SAME test the analyze response uses to show the class
 * report — rows chosen exactly as computeStatsBundle chooses them — so the
 * save dialog (which asks whenever the analysis has a class report) and this
 * gate cannot disagree about a file. It is cheap where it can be: without a
 * detected student-id column buildClassReport returns null, so nothing is
 * re-read for an ordinary business file.
 */
import { buildClassReport } from "./classReport.js";
import { parseAllRows } from "./fullRows.js";
import { alignHeaders } from "./chartSeries.js";
import { flagOn } from "./aiGate.js";

/** The refusal body, `{ error, errorEn, code }` like every other route. */
export const SCHOOL_AUTHORITY_REQUIRED = {
  error: "ไฟล์นี้มีลักษณะเป็นรายชื่อนักเรียน — โปรดยืนยันว่าได้รับอนุญาตจากโรงเรียนให้ประมวลผลข้อมูลนักเรียนชุดนี้ก่อนบันทึก",
  errorEn: "This file looks like a class roster — confirm that your school authorises you to process these students' data before saving it",
  code: "SCHOOL_AUTHORITY_REQUIRED",
};

/** `parsed` is parseFileStreaming's result for `buffer`. */
export function isClassRoster(parsed, buffer, fileName = "") {
  const { headers, colAnalysis = [], totalRows = 0, sensitive = [], headRows = [] } = parsed || {};
  if (!sensitive.some((d) => d.kind === "student-id")) return false;
  const full = alignHeaders(parseAllRows(buffer, fileName), colAnalysis.map((c) => c.col));
  const rows = full.rows?.length ? full.rows
    : headRows.length && totalRows <= headRows.length ? headRows : null;
  if (!rows) return false;
  const cols = full.rows?.length ? full.headers : headers;
  return !!buildClassReport({ headers: cols, rows, colAnalysis, sensitive, fileName });
}

/**
 * The gate, for an upload route. `uploads` is [{ file, parsed }] (multer file
 * + its parse). Returns null when no file is a roster, the attestation time
 * when one is and the form carries schoolAuthority "1"/"true", or false after
 * answering 400 SCHOOL_AUTHORITY_REQUIRED — call it BEFORE anything is stored.
 */
export function schoolAuthority(req, res, uploads) {
  if (!uploads.some(({ file, parsed }) => isClassRoster(parsed, file.buffer, file.originalname))) return null;
  if (flagOn(req.body?.schoolAuthority)) return new Date().toISOString();
  res.status(400).json(SCHOOL_AUTHORITY_REQUIRED);
  return false;
}

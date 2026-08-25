/**
 * src/services/classReport.js — ทำเนียบห้องเรียน (deterministic, no AI)
 *
 * What a teacher actually asks first is not a hypothesis test — it is
 * "ใครได้มากสุด ใครได้น้อยสุด ใครได้เกียรติบัตร". This builds that view from
 * EVERY row, per ADR-0001: computed here, deterministically; the AI never
 * produces these numbers and never sees them (the report is UI-bound only —
 * it is not part of summaryStr, the prompt, or the saved stats_json).
 *
 * PDPA shape: output carries ONLY the student-id column, one name column and
 * the score columns — the citizen-id/birthdate columns are never selected, so
 * raw rows in, safe rows out. Student ids and nicknames stay readable because
 * this is the teacher's own deterministic view (same policy as the non-strict
 * mask), never the model's.
 */
import { parseFlexibleNumber } from "./normalize.js";

/* คะแนนเต็มโดยประมาณ: the file does not say what a column is out of, so round
   the observed max UP to the nearest score ceiling a Thai gradebook uses.
   29.5 → 30, 9 → 10, 87 → 100. Labelled as an estimate in the UI. */
const NICE_FULL = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200];
const niceFull = (max) => NICE_FULL.find((n) => n >= max) ?? Math.ceil(max / 10) * 10;

const GRADE_RE = /เกรด|grade|gpa/i;
const LIKERT_RE = /^q\d+$/i;

/** Returns the report, or null when the data is not classroom-shaped. */
export function buildClassReport({ headers, rows, colAnalysis, sensitive = [] }) {
  if (!headers?.length || !rows?.length) return null;
  if (rows.length < 3 || rows.length > 500) return null;   // a "class", not a warehouse

  const idDet    = sensitive.find((d) => d.kind === "student-id");
  /* Every name column rides along (ชื่อ-สกุล for the official record,
     ชื่อเล่น for the classroom) — capped at 3 so a strange file cannot bloat
     every row. Teacher-facing by policy; none of this reaches the AI. */
  const nameDets = sensitive.filter((d) => d.kind === "name").slice(0, 3);
  if (!idDet) return null;                                  // no student identity → not a class list
  const idIdx    = headers.indexOf(idDet.col);
  const nameIdxs = nameDets.map((d) => headers.indexOf(d.col)).filter((i) => i >= 0);
  if (idIdx < 0) return null;

  const sensitiveCols = new Set(sensitive.map((d) => d.col));
  const numeric = colAnalysis.filter((c) => c.type === "numeric" && !sensitiveCols.has(c.col) && c.semantic !== "date");

  // เกรดเฉลี่ย column (0-4 scale): drives the honor rule directly when present.
  const gradeCol = numeric.find((c) => GRADE_RE.test(c.col) && c.max != null && c.max <= 4.01);
  const scoreCols = numeric.filter((c) => c !== gradeCol && !LIKERT_RE.test(c.col));
  if (!scoreCols.length) return null;

  const scoreIdx  = scoreCols.map((c) => headers.indexOf(c.col)).filter((i) => i >= 0);
  const gradeIdx  = gradeCol ? headers.indexOf(gradeCol.col) : -1;
  const fullMarks = scoreCols.reduce((s, c) => s + niceFull(c.max ?? 0), 0);
  if (!fullMarks) return null;

  const students = rows.map((r) => {
    const scores = scoreIdx.map((i) => parseFlexibleNumber(r[i]));
    const missing = scores.filter((v) => v === null).length;
    const total = scores.reduce((s, v) => s + (v ?? 0), 0);
    const grade = gradeIdx >= 0 ? parseFlexibleNumber(r[gradeIdx]) : null;
    return {
      id: String(r[idIdx] ?? ""),
      names: nameIdxs.map((i) => String(r[i] ?? "")),
      scores, missing, grade,
      total: Math.round(total * 100) / 100,
      percent: Math.round((total / fullMarks) * 1000) / 10,
    };
  }).filter((s) => s.id !== "");
  if (students.length < 3) return null;

  // Competition ranking (1,2,2,4) over total, descending.
  students.sort((a, b) => b.total - a.total);
  let last = null, lastRank = 0;
  students.forEach((s, i) => {
    s.rank = s.total === last ? lastRank : (lastRank = i + 1, i + 1);
    last = s.total;
    /* เกียรติบัตร: a real เกรด column decides directly (4.00); without one,
       ≥80% of the estimated full marks — the Thai grade-4 boundary. */
    s.honor = gradeCol ? (s.grade ?? 0) >= 3.995 : s.percent >= 80;
  });

  const totals = students.map((s) => s.total);
  const median = totals[Math.floor(totals.length / 2)];   // already sorted desc
  return {
    idCol: idDet.col, nameCols: nameIdxs.map((i) => headers[i]),
    scoreCols: scoreCols.map((c) => c.col),
    gradeCol: gradeCol?.col ?? null,
    fullMarks, fullMarksEstimated: true,
    count: students.length,
    max: totals[0], min: totals[totals.length - 1], median,
    honorCount: students.filter((s) => s.honor).length,
    students,
  };
}

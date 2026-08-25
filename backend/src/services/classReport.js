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

/* Submission marks, lower-cased. ✓/"/"/ส่ง are how Thai paper sheets tick;
   TRUE/FALSE and 1/0 are how Google Sheets and Excel checkboxes export. "x"
   and ✗ mean NOT submitted in a Thai gradebook. */
const CHECK_TRUE  = new Set(["✓", "✔", "☑", "/", "ส่ง", "ส่งแล้ว", "true", "1", "y", "yes"]);
const CHECK_FALSE = new Set(["✗", "✘", "☐", "x", "×", "-", "ไม่ส่ง", "ยังไม่ส่ง", "ขาด", "false", "0", "n", "no"]);

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

  /* Checkbox columns — งานที่ติ๊กส่ง ไม่ใช่ให้คะแนน. Teachers track submission
     with ✓/✗, ส่ง/ไม่ส่ง, "/" — and Google Sheets/Excel checkboxes export as
     TRUE/FALSE or 1/0. Value-based detection: every non-empty cell must be a
     recognised mark. A BLANK cell counts as not-submitted (an unticked box is
     an empty cell in every real sheet). Detected columns are pulled OUT of the
     score set — a 1/0 column would otherwise rank the class on a "score" out
     of 1. */
  const candidateIdx = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !sensitiveCols.has(h) && h !== gradeCol?.col && !LIKERT_RE.test(h));
  const checkIdx = candidateIdx.filter(({ i }) => {
    let marks = 0;
    for (const r of rows) {
      const v = String(r[i] ?? "").trim().toLowerCase();
      if (v === "") continue;
      if (!CHECK_TRUE.has(v) && !CHECK_FALSE.has(v)) return false;
      marks++;
    }
    return marks > 0;
  });
  const checkColNames = new Set(checkIdx.map(({ h }) => h));

  const scoreCols = numeric.filter((c) => c !== gradeCol && !LIKERT_RE.test(c.col) && !checkColNames.has(c.col));
  if (!scoreCols.length && !checkIdx.length) return null;

  const scoreIdx  = scoreCols.map((c) => headers.indexOf(c.col)).filter((i) => i >= 0);
  const gradeIdx  = gradeCol ? headers.indexOf(gradeCol.col) : -1;
  const fullMarks = scoreCols.reduce((s, c) => s + niceFull(c.max ?? 0), 0);
  if (scoreCols.length && !fullMarks) return null;

  const students = rows.map((r) => {
    const scores = scoreIdx.map((i) => parseFlexibleNumber(r[i]));
    const missing = scores.filter((v) => v === null).length;
    const total = scores.reduce((s, v) => s + (v ?? 0), 0);
    const grade = gradeIdx >= 0 ? parseFlexibleNumber(r[gradeIdx]) : null;
    const checks = checkIdx.map(({ i }) => CHECK_TRUE.has(String(r[i] ?? "").trim().toLowerCase()));
    return {
      id: String(r[idIdx] ?? ""),
      names: nameIdxs.map((i) => String(r[i] ?? "")),
      scores, missing, grade, checks,
      missingWork: checks.filter((v) => !v).length,
      total: scoreCols.length ? Math.round(total * 100) / 100 : null,
      percent: scoreCols.length ? Math.round((total / fullMarks) * 1000) / 10 : null,
    };
  }).filter((s) => s.id !== "");
  if (students.length < 3) return null;

  /* Ranked by total when there are scores; a pure checkbox sheet ranks by
     fewest missing submissions instead — that IS its order of merit. */
  students.sort(scoreCols.length
    ? (a, b) => b.total - a.total
    : (a, b) => a.missingWork - b.missingWork || a.id.localeCompare(b.id));
  const rankKey = scoreCols.length ? (s) => s.total : (s) => s.missingWork;
  let last = null, lastRank = 0;
  students.forEach((s, i) => {
    s.rank = rankKey(s) === last ? lastRank : (lastRank = i + 1, i + 1);
    last = rankKey(s);
    /* เกียรติบัตร: a real เกรด column decides directly (4.00); without one,
       ≥80% of the estimated full marks — the Thai grade-4 boundary. A
       checkbox-only sheet awards none: submission is duty, not merit. */
    s.honor = gradeCol ? (s.grade ?? 0) >= 3.995 : (scoreCols.length ? s.percent >= 80 : false);
  });

  /* ใครยังไม่ส่งงาน — the actionable list, worst offender first. */
  const checklist = checkIdx.length ? {
    cols: checkIdx.map(({ h }) => h),
    rates: checkIdx.map(({ h }, ci) => {
      const submitted = students.filter((s) => s.checks[ci]).length;
      return { col: h, submitted, missing: students.length - submitted,
               pct: Math.round((submitted / students.length) * 1000) / 10 };
    }),
    incomplete: students.filter((s) => s.missingWork > 0)
      .slice().sort((a, b) => b.missingWork - a.missingWork || a.id.localeCompare(b.id))
      .map((s) => ({ id: s.id, names: s.names,
                     missingCols: checkIdx.filter((_, ci) => !s.checks[ci]).map(({ h }) => h) })),
  } : null;

  const totals = students.map((s) => s.total);
  const median = scoreCols.length ? totals[Math.floor(totals.length / 2)] : null;
  return {
    idCol: idDet.col, nameCols: nameIdxs.map((i) => headers[i]),
    scoreCols: scoreCols.map((c) => c.col),
    gradeCol: gradeCol?.col ?? null,
    fullMarks: scoreCols.length ? fullMarks : null, fullMarksEstimated: true,
    count: students.length,
    max: scoreCols.length ? totals[0] : null,
    min: scoreCols.length ? totals[totals.length - 1] : null,
    median,
    honorCount: students.filter((s) => s.honor).length,
    checklist,
    students,
  };
}

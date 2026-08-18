/**
 * src/services/qualityScore.js — Data Quality Scorer
 *
 * Produces a 0–100 score with breakdown across 5 dimensions:
 *   Completeness  — missing values
 *   Uniqueness    — duplicate rows
 *   Consistency   — outliers, type consistency
 *   Validity      — value ranges, format checks
 *   Timeliness    — date column freshness (if present)
 */

export function computeQualityScore(colAnalysis, totalRows, dupeCount) {
  if (!colAnalysis?.length || !totalRows) return null;

  // ── 1. Completeness (30 pts) ──────────────────────────
  const totalCells   = colAnalysis.reduce((s, c) => s + (c.count || 0) + (c.missing || 0), 0);
  const missingCells = colAnalysis.reduce((s, c) => s + (c.missing || 0), 0);
  const completeness = totalCells > 0
    ? Math.max(0, 1 - missingCells / totalCells)
    : 1;
  const completenessScore = completeness * 30;

  // ── 2. Uniqueness (20 pts) ────────────────────────────
  const dupePct       = totalRows > 0 ? dupeCount / totalRows : 0;
  /* A file that is 99% duplicate rows previously scored 80/100 (grade B): it
     lost all 20 uniqueness points but kept 50 from consistency, validity and
     timeliness, none of which can detect duplication. Heavy duplication is not
     a 20-point problem, it invalidates the dataset — so past 30% it also
     scales the whole score down. */
  const uniquenessScore = Math.max(0, 1 - dupePct * 2) * 20;

  // ── 3. Consistency (25 pts) ───────────────────────────
  // Penalise columns with high outlier rate
  const numCols = colAnalysis.filter(c => c.type === "numeric");
  let consistencyScore = 25;
  if (numCols.length > 0) {
    const avgOutlierRate = numCols.reduce((s, c) => {
      const total = (c.count || 1);
      return s + (c.outlierCount || 0) / total;
    }, 0) / numCols.length;
    consistencyScore = Math.max(0, 25 * (1 - avgOutlierRate * 3));
  }

  // ── 4. Validity (15 pts) ──────────────────────────────
  // Check text columns for reasonable unique ratio
  const txtCols = colAnalysis.filter(c => c.type === "text");
  let validityScore = 15;
  if (txtCols.length > 0) {
    const avgUniqueRatio = txtCols.reduce((s, c) => {
      const ratio = (c.unique || 0) / Math.max(c.count || 1, 1);
      // Very high ratio (≥95% unique) may mean ID column — neutral 0.7
      // Very low ratio (1–5 unique values) is fine for categories
      /* The old test was `ratio > 0 && ratio <= 1`, which is true for every
         non-empty column — validity was a constant 15/15, the same
         cannot-fail inflation the timeliness dimension had. */
      return s + (ratio >= 0.95 ? 0.7 : 1);
    }, 0) / txtCols.length;
    validityScore = avgUniqueRatio * 15;
  }

  // ── 5. Timeliness (10 pts) ────────────────────────────
  /* Previously: full marks when no date column exists, "can't penalise".
     That hands 10 free points to most files and makes the score less able to
     discriminate. A dimension that cannot be assessed is excluded from the
     total instead of being awarded. */
  // If no date column found, this dimension is NOT SCORED (see rescale below)
  /* Word-boundary matches only. The old substring test /date|time|at$/ made
     'candidate', 'lifetime' and 'Format' count as date columns — 10 free
     points, and a possible grade change, from a name that has nothing to do
     with dates. 'at' counts only as a suffix after a separator (created_at),
     and the Thai date/time words anchor to a word start (วันที่ขาย). */
  const DATE_COL_RE = /(^|[_\s-])(date|time|datetime|timestamp|created|updated)([_\s-]|$)|[_\s-]at$|(^|[_\s-])(วันที่|เวลา)/i;
  const dateCols = colAnalysis.filter(c => DATE_COL_RE.test(String(c.col ?? "")));
  /* Timeliness returned a constant 10 whether or not a date column existed —
     it could not fail, so it was 10 points of pure inflation on every file.
     Now it is scored only when there IS a date column, and the total is
     rescaled over the dimensions that were actually assessed. */
  const timelinessApplies = dateCols.length > 0;
  const timelinessScore = timelinessApplies ? 10 : 0;
  const maxPossible = 30 + 20 + 25 + 15 + (timelinessApplies ? 10 : 0);

  const rawTotal = completenessScore + uniquenessScore + consistencyScore
                 + validityScore + timelinessScore;

  /* Heavy duplication is not a 20-point problem — it invalidates the file.
     A 99%-duplicate dataset previously scored 80/100 (grade B) because it
     kept all 50 points from consistency, validity and timeliness, none of
     which can detect duplication. Past 30% duplicate rows the whole score is
     scaled down so the grade reflects a dataset nobody should analyse. */
  const dupePenalty = dupePct > 0.3 ? Math.max(0.25, 1 - (dupePct - 0.3)) : 1;

  /* Same for completeness: past 40% missing the file is not a B-grade file
     with a low completeness score, it is unusable. */
  const missPct = totalCells > 0 ? missingCells / totalCells : 0;
  const missPenalty = missPct > 0.4 ? Math.max(0.3, 1 - (missPct - 0.4)) : 1;

  const total = Math.round((rawTotal / maxPossible) * 100 * dupePenalty * missPenalty);

  // ── Grade ─────────────────────────────────────────────
  const grade = total >= 90 ? "A" : total >= 75 ? "B" : total >= 60 ? "C" : total >= 45 ? "D" : "F";
  const label = total >= 90 ? "Excellent" : total >= 75 ? "Good" : total >= 60 ? "Fair" : total >= 45 ? "Poor" : "Critical";

  return {
    score:   Math.min(100, Math.max(0, total)),
    grade,
    label,
    breakdown: {
      completeness:  { score: Math.round(completenessScore),  max: 30, pct: (completeness * 100).toFixed(1) },
      uniqueness:    { score: Math.round(uniquenessScore),    max: 20, dupePct: (dupePct * 100).toFixed(1) },
      consistency:   { score: Math.round(consistencyScore),  max: 25 },
      validity:      { score: Math.round(validityScore),     max: 15 },
      timeliness:    { score: Math.round(timelinessScore),   max: 10 },
    },
    issues: buildIssues(colAnalysis, totalRows, dupeCount, missingCells, total),
  };
}

function buildIssues(colAnalysis, totalRows, dupeCount, missingCells, score) {
  const issues = [];

  if (missingCells > 0) {
    const pct = ((missingCells / (colAnalysis.reduce((s,c)=>s+(c.count||0)+(c.missing||0),0))) * 100).toFixed(1);
    const severity = parseFloat(pct) > 20 ? "high" : parseFloat(pct) > 5 ? "medium" : "low";
    issues.push({ severity, type: "missing_values", message: `${missingCells.toLocaleString()} missing values (${pct}% of dataset)`, affected: colAnalysis.filter(c=>c.missing>0).map(c=>c.col) });
  }
  if (dupeCount > 0) {
    const pct = ((dupeCount / totalRows) * 100).toFixed(1);
    issues.push({ severity: parseFloat(pct) > 10 ? "high" : "medium", type: "duplicates", message: `${dupeCount.toLocaleString()} duplicate rows (${pct}%)`, affected: [] });
  }
  const outlierCols = colAnalysis.filter(c => c.type === "numeric" && (c.outlierCount || 0) > 0);
  outlierCols.forEach(c => {
    const pct = ((c.outlierCount / (c.count||1)) * 100).toFixed(1);
    if (parseFloat(pct) > 1)
      issues.push({ severity: parseFloat(pct) > 10 ? "high" : "low", type: "outliers", message: `${c.col}: ${c.outlierCount} outliers (${pct}%)`, affected: [c.col] });
  });

  return issues.sort((a,b) => ({ high:0, medium:1, low:2 }[a.severity] - { high:0, medium:1, low:2 }[b.severity]));
}

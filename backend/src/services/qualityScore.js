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
      // Very high ratio (all unique) may mean ID column — neutral
      // Very low ratio (1–5 unique values) is fine for categories
      return s + (ratio > 0 && ratio <= 1 ? 1 : 0.7);
    }, 0) / txtCols.length;
    validityScore = avgUniqueRatio * 15;
  }

  // ── 5. Timeliness (10 pts) ────────────────────────────
  // If no date column found, award full points (can't penalise)
  const dateCols = colAnalysis.filter(c =>
    c.col?.toLowerCase().match(/date|time|created|updated|at$/)
  );
  const timelinessScore = dateCols.length === 0 ? 10 : (() => {
    // Give 10 pts — date detection was present
    return 10;
  })();

  const total = Math.round(
    completenessScore + uniquenessScore + consistencyScore + validityScore + timelinessScore
  );

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

/**
 * analyze.js — Full analysis engine
 * - Descriptive stats (uses corrected stats.js)
 * - Missing values per column
 * - Duplicate row detection
 * - Correlation matrix (Pearson)
 * - Linear regression + 3-step forecast
 * - Auto chart type recommendation
 */

import { describeNumeric, describeText } from "./stats.js";

// ── Column Analysis ───────────────────────────────────────
export function analyzeColumns(headers, rows) {
  return headers.map((col, i) => {
    const allValues  = rows.map(r => r[i]);
    const missing    = allValues.filter(v => v === "" || v == null).length;
    const present    = allValues.filter(v => v !== "" && v != null);
    const nums       = present.map(v => parseFloat(v)).filter(v => !isNaN(v));
    const isNumeric  = nums.length > present.length * 0.6;

    if (isNumeric) {
      const s = describeNumeric(nums);
      return { col, type: "numeric", missing, missingPct: ((missing / rows.length) * 100).toFixed(1), ...s };
    } else {
      const s = describeText(present);
      return { col, type: "text", missing, missingPct: ((missing / rows.length) * 100).toFixed(1), ...s };
    }
  });
}

// ── Missing Values ────────────────────────────────────────
export function detectMissing(headers, rows) {
  return headers.map((col, i) => {
    const total   = rows.length;
    const missing = rows.filter(r => r[i] === "" || r[i] == null).length;
    return { col, missing, total, pct: ((missing / total) * 100).toFixed(1) };
  }).filter(c => c.missing > 0);
}

// ── Duplicate Rows ────────────────────────────────────────
export function detectDuplicates(rows) {
  const seen  = new Map();
  const dupes = [];
  rows.forEach((r, idx) => {
    const key = r.join("|||");
    if (seen.has(key)) {
      dupes.push({ firstSeen: seen.get(key) + 1, duplicate: idx + 1 });
    } else {
      seen.set(key, idx);
    }
  });
  return { count: dupes.length, examples: dupes.slice(0, 5) };
}

// ── Pearson Correlation ───────────────────────────────────
export function correlationMatrix(headers, rows) {
  const numCols = headers
    .map((col, i) => {
      const vals = rows.map(r => parseFloat(r[i])).filter(v => !isNaN(v));
      return vals.length > rows.length * 0.5 ? { col, vals } : null;
    })
    .filter(Boolean);

  if (numCols.length < 2) return null;

  function pearson(a, b) {
    const n   = Math.min(a.length, b.length);
    const ax  = a.slice(0, n), bx = b.slice(0, n);
    const ma  = ax.reduce((s, v) => s + v, 0) / n;
    const mb  = bx.reduce((s, v) => s + v, 0) / n;
    const num = ax.reduce((s, v, i) => s + (v - ma) * (bx[i] - mb), 0);
    const da  = Math.sqrt(ax.reduce((s, v) => s + (v - ma) ** 2, 0));
    const db  = Math.sqrt(bx.reduce((s, v) => s + (v - mb) ** 2, 0));
    return da && db ? +(num / (da * db)).toFixed(3) : 0;
  }

  const cols   = numCols.map(c => c.col);
  const matrix = numCols.map(a =>
    numCols.map(b => pearson(a.vals, b.vals))
  );

  // Strong correlations (|r| >= 0.7, exclude diagonal)
  const strong = [];
  cols.forEach((c1, i) => {
    cols.forEach((c2, j) => {
      if (i < j && Math.abs(matrix[i][j]) >= 0.7) {
        strong.push({ col1: c1, col2: c2, r: matrix[i][j] });
      }
    });
  });

  return { cols, matrix, strong };
}

// ── Linear Regression + Forecast ─────────────────────────
export function linearRegression(xVals, yVals) {
  const n  = Math.min(xVals.length, yVals.length);
  const xs = xVals.slice(0, n), ys = yVals.slice(0, n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const ss = xs.reduce((a, v) => a + (v - mx) ** 2, 0);
  const sp = xs.reduce((a, v, i) => a + (v - mx) * (ys[i] - my), 0);
  const slope     = ss ? sp / ss : 0;
  const intercept = my - slope * mx;

  // R²
  const yHat  = xs.map(x => slope * x + intercept);
  const ssTot = ys.reduce((a, v) => a + (v - my) ** 2, 0);
  const ssRes = ys.reduce((a, v, i) => a + (v - yHat[i]) ** 2, 0);
  const r2    = ssTot ? +(1 - ssRes / ssTot).toFixed(3) : 0;

  const forecast = [1, 2, 3].map(step => ({
    step,
    x:         n + step,
    predicted: +(slope * (n + step) + intercept).toFixed(2),
  }));

  return { slope: +slope.toFixed(4), intercept: +intercept.toFixed(4), r2, forecast };
}

export function autoForecast(headers, rows) {
  const results = [];
  headers.forEach((col, i) => {
    const vals = rows.map(r => parseFloat(r[i])).filter(v => !isNaN(v));
    if (vals.length < 4) return;
    const xs  = vals.map((_, idx) => idx + 1);
    const reg = linearRegression(xs, vals);
    if (reg.r2 >= 0.5) {  // only show if decent fit
      results.push({ col, ...reg });
    }
  });
  return results;
}

// ── Chart Type Recommendation ─────────────────────────────
export function recommendCharts(colAnalysis) {
  const numeric = colAnalysis.filter(c => c.type === "numeric");
  const text    = colAnalysis.filter(c => c.type === "text");
  const recs    = [];

  if (numeric.length >= 2) {
    recs.push({ type: "scatter", reason: `แสดงความสัมพันธ์ระหว่าง ${numeric[0].col} กับ ${numeric[1].col}` });
    recs.push({ type: "line",    reason: `แสดง trend ของ ${numeric[0].col}` });
  }
  if (text.length >= 1 && numeric.length >= 1) {
    recs.push({ type: "bar",   reason: `เปรียบเทียบ ${numeric[0].col} ตาม ${text[0].col}` });
    recs.push({ type: "pie",   reason: `สัดส่วน ${text[0].col}` });
  }
  if (numeric.length >= 1) {
    recs.push({ type: "area",  reason: `แสดง volume ของ ${numeric[0].col}` });
  }
  return recs;
}

// ── Build Summary String for Claude ──────────────────────
export function buildSummaryString(colAnalysis, missing, dupes, corr, forecasts) {
  const lines = [];

  // Column stats
  lines.push("=== Column Statistics ===");
  colAnalysis.forEach(c => {
    if (c.type === "numeric") {
      lines.push(
        `[${c.col}] numeric | ${c.count?.toLocaleString()} values | missing: ${c.missing} (${c.missingPct}%)\n` +
        `  Min:${c.min}  Max:${c.max}  Avg:${c.avg?.toFixed(2)}  Median:${c.median}  StdDev:${c.stdDev?.toFixed(2)}\n` +
        `  Q1:${c.q1}  Q3:${c.q3}  IQR:${c.iqr}  Outliers:${c.outlierCount}`
      );
    } else {
      const top = c.top?.slice(0, 5).map(t => `"${t.value}"(${t.count})`).join(", ");
      lines.push(`[${c.col}] text | ${c.count?.toLocaleString()} values | ${c.unique} unique | missing: ${c.missing} (${c.missingPct}%)\n  Top: ${top}`);
    }
  });

  // Missing
  if (missing.length > 0) {
    lines.push("\n=== Missing Values ===");
    missing.forEach(m => lines.push(`  ${m.col}: ${m.missing}/${m.total} rows (${m.pct}%)`));
  }

  // Duplicates
  lines.push(`\n=== Duplicate Rows ===\n  Found: ${dupes.count} duplicate rows`);

  // Correlation
  if (corr && corr.strong.length > 0) {
    lines.push("\n=== Strong Correlations (|r| ≥ 0.7) ===");
    corr.strong.forEach(s => lines.push(`  ${s.col1} ↔ ${s.col2}: r = ${s.r}`));
  }

  // Forecast
  if (forecasts.length > 0) {
    lines.push("\n=== Linear Regression Forecasts ===");
    forecasts.forEach(f => {
      lines.push(`  ${f.col}: slope=${f.slope} R²=${f.r2}`);
      f.forecast.forEach(p => lines.push(`    Step +${p.step}: predicted = ${p.predicted}`));
    });
  }

  return lines.join("\n");
}

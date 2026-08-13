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
const ISO_DATE = /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
const INDEX_NAME = /^(month|year|day|date|week|quarter|period|time|timestamp|datetime|no\.?|id|idx|index|seq|rank|row|order|ลำดับ|เดือน|ปี|วันที่|เวลา|สัปดาห์|ไตรมาส|รหัส)$/i;
/* Real exports are full of Order_Date, Ship_Date, created_at — the suffix
   matters as much as the exact name. */
const DATEISH_SUFFIX = /(_|\s|-)(date|time|at)$/i;
/* Identifiers: Customer_ID, user_id, OrderID, SKU, รหัสลูกค้า. A customer
   number is a label that happens to be stored as digits — correlating it
   with revenue is meaningless, and it crowds the matrix. Matches a bare
   or suffixed id/code, and the Thai รหัส prefix. */
/* Identifiers must be separated by a boundary, never matched as a bare
   word ending. A plain /id$/ silently ate Humid, Liquid, Solid, Valid, Fluid,
   Acid, Rapid, Paid, Grid — every one a plausible measurement in a real
   thesis, dropped with no explanation. Require _ - space or a lowercase-to-
   uppercase hump (CustomerID), so Customer_ID and OrderID are caught while
   Humidity keeps its column. */
/* Two rules, deliberately separate.
   - Boundary form, case-insensitive: an id/code/sku/key that stands alone or
     follows _ - or a space. Catches Customer_ID, user_id, SKU, order-code.
   - Hump form, case-SENSITIVE: a lowercase letter followed by Id or ID, as in
     CustomerID or orderId.
   They must not be merged under one /i flag: doing that makes [a-z](Id|ID)$
   match any letter before "id", which silently ate Humid, Liquid, Solid,
   Valid, Fluid, Acid, Rapid, Paid, Grid and Lipid — all plausible
   measurements in a real thesis, dropped with no explanation. */
const IDISH_WORD = /(^|[_\s-])(id|ids|code|sku|uuid|guid|key)$/i;
const IDISH_HUMP = /[a-z](Id|ID)$/;
const isIdish = (n) => IDISH_WORD.test(n) || IDISH_HUMP.test(n) || /^(รหัส|เลขที่)/.test(n);

/**
 * A row counter: 1,2,3,4… starting at 0 or 1, stepping by exactly 1.
 *
 * NARROWER THAN IT LOOKS, DELIBERATELY. The first version of this flagged any
 * constant-step column, which quietly excluded real measurements — a designed
 * dosage of 5,10,15,20mg, test scores in tens, a steady temperature rise. All
 * of those are genuine predictors, and dropping them loses findings the user
 * needed with no explanation. That is a worse bug than the one this was meant
 * to fix. Only an unnamed 1,2,3,4 counter qualifies on shape alone.
 */
function isRowCounter(vals) {
  if (vals.length < 4) return false;
  if (vals[0] !== 0 && vals[0] !== 1) return false;
  return vals.every((v, i) => v === vals[0] + i);
}

export function isIndexColumn(col, vals) {
  const name = String(col).trim();
  return INDEX_NAME.test(name) || DATEISH_SUFFIX.test(name) || isIdish(name) || isRowCounter(vals);
}

export function correlationMatrix(headers, rows) {
  const numCols = headers
    .map((col, i) => {
      /* parseFloat("2024-01-05") is 2024. A date column silently becomes its
         YEAR, so every day of a year collapses to one number and the matrix
         reports a confident correlation computed on 1/365th of the data.
         Catch it by value shape as well as by column name. */
      const rawVals = rows.map(r => r[i]);
      const dateLike = rawVals.filter(v => typeof v === "string" && ISO_DATE.test(v)).length;
      if (dateLike > rawVals.length * 0.5) return null;
      const vals = rows.map(r => parseFloat(r[i])).filter(v => !isNaN(v));
      // An index column correlates with anything that drifts over time, and
      // "month correlates with sales, r=0.81" tells a user nothing they did
      // not already know. Keep counters out of the matrix entirely.
      if (isIndexColumn(col, vals)) return null;
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

/**
 * Columns that are a POSITION, not a measurement.
 *
 * Forecasting these produces findings that are true and useless: a column of
 * 1,2,3,4,5,6 always "has a clear upward trend, R2 0.614, next value 6.10".
 * Of course it does — it is the month number. Reporting that as an insight
 * makes the whole report look naive, and it crowds out the real findings.
 *
 * Two tests, because a name check alone misses `n` or `col_3`, and a shape
 * check alone would wrongly drop a genuine measurement that happens to rise
 * steadily.
 */
/**
 * Fit a trend from sums accumulated over the whole column, in file order.
 * Preferred over the row-based path below, which can only see a sample.
 */
export function forecastFromTrend(col, t) {
  const { n, sx, sy, sxx, sxy, syy } = t;
  const ss = n * sxx - sx * sx;
  if (ss === 0) return null;
  const slope     = (n * sxy - sx * sy) / ss;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  const ssRes = ssTot - (slope * (sxy - (sx * sy) / n));
  const r2 = ssTot > 0 ? +(1 - ssRes / ssTot).toFixed(3) : 0;
  return {
    col,
    slope: +slope.toFixed(4),
    intercept: +intercept.toFixed(4),
    r2,
    forecast: [1, 2, 3].map((step) => ({
      step, x: n + step, predicted: +(slope * (n + step) + intercept).toFixed(2),
    })),
  };
}

/**
 * Trends from full-column sums when colAnalysis carries them, which is the
 * accurate path; `rows` remains the fallback for callers that have no
 * colAnalysis (tests, the export path).
 */
export function autoForecastFromAnalysis(colAnalysis = []) {
  const out = [];
  for (const c of colAnalysis) {
    if (c.type !== "numeric" || !c.trend) continue;
    if (isIndexColumn(c.col, [])) continue;      // name check; sums are not a sequence
    const f = forecastFromTrend(c.col, c.trend);
    if (f && f.r2 >= 0.5) out.push(f);
  }
  return out;
}

export function autoForecast(headers, rows) {
  const results = [];
  headers.forEach((col, i) => {
    const vals = rows.map(r => parseFloat(r[i])).filter(v => !isNaN(v));
    if (vals.length < 4) return;
    if (isIndexColumn(col, vals)) return;   // a counter is not a trend
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

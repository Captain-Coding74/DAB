/**
 * stats.js — Production-grade statistical functions
 *
 * Median:     correct even-length handling (average of two middle values)
 * Quartiles:  Tukey's hinges / inclusive method — same as Excel QUARTILE.INC
 * All functions are pure and tested via stats.test.js
 */

/**
 * Median — average the two middle values when n is even
 * @param {number[]} sorted — must be pre-sorted ascending
 */
export function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  // odd  → middle element
  // even → average of the two middle elements ← the fix
  return n % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Quartiles — Tukey's hinges (inclusive method, matches Excel QUARTILE.INC)
 * Q1 = median of lower half (including median element when n is odd)
 * Q3 = median of upper half (including median element when n is odd)
 * @param {number[]} sorted — must be pre-sorted ascending
 * @returns {{ q1: number, q2: number, q3: number }}
 */
export function quartiles(sorted) {
  const n = sorted.length;
  if (n === 0) return { q1: null, q2: null, q3: null };
  if (n === 1) return { q1: sorted[0], q2: sorted[0], q3: sorted[0] };

  const q2  = median(sorted);
  const mid = Math.floor(n / 2);

  // Odd n  → include the middle element in BOTH halves (Tukey's hinges)
  // Even n → lower = first half, upper = second half
  const lower = n % 2 !== 0 ? sorted.slice(0, mid + 1) : sorted.slice(0, mid);
  const upper = n % 2 !== 0 ? sorted.slice(mid)        : sorted.slice(mid);

  return { q1: median(lower), q2, q3: median(upper) };
}

/**
 * Full descriptive statistics for a numeric array
 * @param {number[]} values — raw (unsorted) values
 */
export function describeNumeric(values) {
  if (!values.length) return null;

  const sorted   = [...values].sort((a, b) => a - b);
  const n        = sorted.length;
  const sum      = values.reduce((a, b) => a + b, 0);
  const avg      = sum / n;
  const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / n;
  const stdDev   = Math.sqrt(variance);

  const { q1, q2: med, q3 } = quartiles(sorted);
  const iqr      = q3 - q1;
  const outliers = sorted.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);

  return {
    count:        n,
    min:          sorted[0],
    max:          sorted[n - 1],
    sum,
    avg,
    median:       med,
    stdDev,
    q1,
    q3,
    iqr,
    outlierCount: outliers.length,
    outlierMin:   outliers.length ? outliers[0] : null,
    outlierMax:   outliers.length ? outliers[outliers.length - 1] : null,
  };
}

/**
 * Frequency table for a categorical/text column
 * @param {string[]} values
 * @param {number}   topN
 */
export function describeText(values, topN = 10) {
  const freq = {};
  values.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return {
    count:  values.length,
    unique: sorted.length,
    top: sorted.slice(0, topN).map(([value, count]) => ({
      value,
      count,
      pct: ((count / values.length) * 100).toFixed(1),
    })),
  };
}

import { isIndexColumn } from "../analyze.js";

/**
 * Exact pairwise correlations, accumulated during the streaming pass.
 *
 * Split out of streaming.js because that file had grown past its ratchet and
 * this is a self-contained concern: six running moments per column pair,
 * updated once per row, turned into a Pearson matrix at the end.
 */
/**
 * Pairwise moments for an exact correlation matrix over EVERY row.
 *
 * correlationMatrix used to be handed sampleRows — a reservoir sample of FIVE
 * rows, whatever the file size. Measured: with n=5 and two columns of pure
 * independent noise, |r| >= 0.7 is reported 20% of the time and |r| >= 0.95
 * about 2%. On an 8-numeric-column file that is roughly six invented "strong
 * correlations" per report, printed to three decimals over a red-green
 * heatmap. Six numbers per pair, updated per row, gives the real answer.
 *
 * CENTERED, NOT RAW SUMS. The first version kept Σx, Σx² and computed
 * n·Σx² − (Σx)². For values large relative to their spread — epoch-ms
 * timestamps ~1.7e12, long meter readings — both terms are ~1e24 and float64
 * keeps only ~16 digits, so the true variance drowns in rounding: the
 * radicand cancels to zero or negative, Math.sqrt gives NaN, and a perfect
 * correlation was reported as exactly 0.000. Welford-style co-moments (the
 * same trick streaming.js's OnlineStat already uses per column) subtract the
 * running mean BEFORE squaring, so nothing large ever meets its own square.
 */
export class PairAccumulator {
  constructor(k) {
    this.k = k;
    this.n   = Array.from({ length: k }, () => new Float64Array(k));
    this.ma  = Array.from({ length: k }, () => new Float64Array(k));  // running mean of col i
    this.mb  = Array.from({ length: k }, () => new Float64Array(k));  // running mean of col j
    this.m2a = Array.from({ length: k }, () => new Float64Array(k));  // Σ(a − ma)²
    this.m2b = Array.from({ length: k }, () => new Float64Array(k));  // Σ(b − mb)²
    this.cab = Array.from({ length: k }, () => new Float64Array(k));  // Σ(a − ma)(b − mb)
  }
  /** vals[i] is the numeric value of column i for this row, or null. */
  update(vals) {
    for (let i = 0; i < this.k; i++) {
      const a = vals[i];
      if (a === null) continue;
      for (let j = i + 1; j < this.k; j++) {
        const b = vals[j];
        if (b === null) continue;      // pairwise-complete, like R's default
        const n = ++this.n[i][j];
        const da = a - this.ma[i][j];
        const db = b - this.mb[i][j];
        this.ma[i][j] += da / n;
        this.mb[i][j] += db / n;
        // deltas from the OLD mean times deltas from the NEW mean — the
        // standard Welford update, exact for the (n-1)/n telescoping.
        this.m2a[i][j] += da * (a - this.ma[i][j]);
        this.m2b[i][j] += db * (b - this.mb[i][j]);
        this.cab[i][j] += da * (b - this.mb[i][j]);
      }
    }
  }
  /** Pearson r for the pair, or null when it cannot be computed. */
  r(i, j) {
    const n = this.n[i][j];
    if (n < 3) return null;
    const da = Math.sqrt(this.m2a[i][j]);
    const db = Math.sqrt(this.m2b[i][j]);
    // da/db are 0 only for a genuinely constant column now — the moments are
    // non-negative by construction, so the NaN-from-cancellation path is gone.
    // The clamp guards the last-digit rounding that could print r = 1.001.
    return da && db ? +Math.max(-1, Math.min(1, this.cab[i][j] / (da * db))).toFixed(3) : 0;
  }
  count(i, j) { return this.n[i][j]; }
}


/** Turn the pairwise sums into the shape correlationMatrix used to return. */
export function buildCorrelation(headers, colAnalysis, pairs) {
  /* Must apply the SAME exclusions as analyze.js's correlationMatrix, which
     this path replaced. Filtering on type alone let Day and Year straight back
     into the matrix — a counter correlates with anything that drifts, and
     "Year correlates with Cost" is not a finding. Reuse the one rule rather
     than restating it, so the two paths cannot drift apart again. */
  const idx = [];
  headers.forEach((h, i) => {
    const c = colAnalysis[i];
    if (!c || c.type !== "numeric" || c.semantic) return;
    if (isIndexColumn(h, [])) return;          // by name: Day, Year, Order_Date…
    idx.push(i);
  });
  if (idx.length < 2) return null;
  const cols = idx.map((i) => headers[i]);
  const matrix = idx.map((a, x) => idx.map((b, y) => (x === y ? 1 : pairs.r(Math.min(a, b), Math.max(a, b)) ?? 0)));
  const strong = [];
  for (let x = 0; x < idx.length; x++)
    for (let y = x + 1; y < idx.length; y++) {
      const r = matrix[x][y];
      if (Math.abs(r) >= 0.7) strong.push({ col1: cols[x], col2: cols[y], r, n: pairs.count(Math.min(idx[x], idx[y]), Math.max(idx[x], idx[y])) });
    }
  return { cols, matrix, strong };
}


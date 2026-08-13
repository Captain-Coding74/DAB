import { isIndexColumn } from "../analyze.js";

/**
 * Exact pairwise correlations, accumulated during the streaming pass.
 *
 * Split out of streaming.js because that file had grown past its ratchet and
 * this is a self-contained concern: six running sums per column pair, updated
 * once per row, turned into a Pearson matrix at the end.
 */
/**
 * Pairwise sums for an exact correlation matrix over EVERY row.
 *
 * correlationMatrix used to be handed sampleRows — a reservoir sample of FIVE
 * rows, whatever the file size. Measured: with n=5 and two columns of pure
 * independent noise, |r| >= 0.7 is reported 20% of the time and |r| >= 0.95
 * about 2%. On an 8-numeric-column file that is roughly six invented "strong
 * correlations" per report, printed to three decimals over a red-green
 * heatmap. Six numbers per pair, updated per row, gives the real answer.
 */
export class PairAccumulator {
  constructor(k) {
    this.k = k;
    this.n   = Array.from({ length: k }, () => new Float64Array(k));
    this.sx  = Array.from({ length: k }, () => new Float64Array(k));
    this.sy  = Array.from({ length: k }, () => new Float64Array(k));
    this.sxx = Array.from({ length: k }, () => new Float64Array(k));
    this.syy = Array.from({ length: k }, () => new Float64Array(k));
    this.sxy = Array.from({ length: k }, () => new Float64Array(k));
  }
  /** vals[i] is the numeric value of column i for this row, or null. */
  update(vals) {
    for (let i = 0; i < this.k; i++) {
      const a = vals[i];
      if (a === null) continue;
      for (let j = i + 1; j < this.k; j++) {
        const b = vals[j];
        if (b === null) continue;      // pairwise-complete, like R's default
        this.n[i][j]++;
        this.sx[i][j] += a;  this.sy[i][j] += b;
        this.sxx[i][j] += a * a; this.syy[i][j] += b * b; this.sxy[i][j] += a * b;
      }
    }
  }
  /** Pearson r for the pair, or null when it cannot be computed. */
  r(i, j) {
    const n = this.n[i][j];
    if (n < 3) return null;
    const num = n * this.sxy[i][j] - this.sx[i][j] * this.sy[i][j];
    const da  = Math.sqrt(n * this.sxx[i][j] - this.sx[i][j] ** 2);
    const db  = Math.sqrt(n * this.syy[i][j] - this.sy[i][j] ** 2);
    return da && db ? +(num / (da * db)).toFixed(3) : 0;
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


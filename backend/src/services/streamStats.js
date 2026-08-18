/**
 * src/services/streamStats.js — single-pass statistics primitives
 *
 * v21.10 extraction from streaming.js: the .xls guard and the real reservoir
 * pushed that file past its size ratchet, and these four classes are the
 * self-contained O(1)-memory core the streaming parser is built on.
 */

// ── Online statistics (Welford's algorithm) ───────────────
// Computes mean, variance, min, max in a single pass
// without storing all values — O(1) memory
export class OnlineStat {
  constructor() {
    this.n = 0; this.mean = 0; this.M2 = 0;
    this.min = Infinity; this.max = -Infinity; this.sum = 0;
  }
  update(x) {
    this.n++; this.sum += x;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    this.M2   += delta * (x - this.mean);
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }
  result() {
    return {
      count:  this.n,
      sum:    this.sum,
      avg:    this.mean,
      min:    this.min === Infinity  ? null : this.min,
      max:    this.max === -Infinity ? null : this.max,
      stdDev: this.n > 1 ? Math.sqrt(this.M2 / this.n) : 0,
    };
  }
}

// ── Frequency counter (capped at 10k unique values) ───────
export class FreqCounter {
  constructor(cap = 10_000) { this.freq = new Map(); this.cap = cap; this.overflow = false; }
  update(v) {
    if (this.freq.has(v)) { this.freq.set(v, this.freq.get(v) + 1); return; }
    if (this.freq.size >= this.cap) { this.overflow = true; return; }
    this.freq.set(v, 1);
  }
  top(n = 10) {
    return [...this.freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, count, pct: (count / [...this.freq.values()].reduce((a,b)=>a+b,0) * 100).toFixed(1) }));
  }
  get unique() { return this.freq.size; }
}

/* Deterministic PRNG (mulberry32) for the quantile reservoir.
   Math.random would make two analyses of the SAME file disagree on
   median/quartiles once a column passes the reservoir cap — and this
   product's whole pitch is that the statistics are reproducible. Seeded
   per column from a constant, so a re-run gives identical numbers. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Reservoir sampler (keep N random rows for preview) ────
export class ReservoirSampler {
  constructor(k = 5) { this.k = k; this.reservoir = []; this.n = 0; }
  update(row) {
    this.n++;
    if (this.reservoir.length < this.k) { this.reservoir.push(row); return; }
    const j = Math.floor(Math.random() * this.n);
    if (j < this.k) this.reservoir[j] = [...row];
  }
}

/**
 * Probability distributions — the machinery p-values need.
 *
 * Written out rather than pulled from a library so every number DAB reports
 * is traceable to code in this repo, and so the production dependency list
 * does not grow for a thesis feature. Each function is pinned in
 * distributions.test.js against textbook values.
 *
 * ADR-0001 applies: these are deterministic. Run them a thousand times and
 * they return the same answer. The AI never computes a statistic — it only
 * writes prose about numbers produced here.
 *
 * A note on variance: stats.js `describeNumeric` uses the POPULATION form
 * (divide by n) because it is describing the rows it was given. Everything in
 * this file uses the SAMPLE form (divide by n-1), because inference treats
 * the rows as a sample drawn from a larger population. Mixing the two is a
 * classic way to report a wrong p-value, so the distinction is explicit
 * everywhere below.
 */

/** Lanczos approximation. Good to ~15 significant figures for x > 0. */
export function logGamma(x) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised incomplete beta I_x(a,b), by continued fraction (Lentz). */
export function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );

  // The series converges fast only for x < (a+1)/(a+b+2); otherwise use the
  // symmetry I_x(a,b) = 1 - I_{1-x}(b,a).
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let numerator;
    if (i === 0)            numerator = 1;
    else if (i % 2 === 0)   numerator =  (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else                    numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));

    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-12) break;
  }
  return (front * (f - 1)) / a;
}

/** Regularised lower incomplete gamma P(s,x) — series and continued fraction. */
export function incompleteGamma(s, x) {
  if (x <= 0) return 0;
  if (x < s + 1) {
    // series expansion
    let sum = 1 / s, term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  // continued fraction for the upper tail, then complement
  let b = x + 1 - s, c = 1e30, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

/** Two-tailed p for Student's t with df degrees of freedom. */
export function tDistPValue(t, df) {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);          // already two-tailed
}

/** Upper-tail p for the F distribution — what ANOVA reports. */
export function fDistPValue(f, df1, df2) {
  if (!Number.isFinite(f) || f < 0 || df1 <= 0 || df2 <= 0) return NaN;
  return incompleteBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

/** Upper-tail p for chi-square. */
export function chiSquarePValue(chi2, df) {
  if (!Number.isFinite(chi2) || chi2 < 0 || df <= 0) return NaN;
  return 1 - incompleteGamma(df / 2, chi2 / 2);
}

/** Two-tailed p for the standard normal (used by logistic regression). */
export function normalPValue(z) {
  if (!Number.isFinite(z)) return NaN;
  const a = Math.abs(z);
  // erfc via incomplete gamma: P(|Z| > a) = erfc(a/√2)
  return 1 - incompleteGamma(0.5, (a * a) / 2);
}

/**
 * How a p-value should be read aloud in a thesis. Thai, because the audience
 * is Thai — and deliberately cautious: "significant" is a claim about the
 * test, not about the world.
 */
export function significanceLabel(p) {
  if (!Number.isFinite(p)) return { level: "unknown", th: "คำนวณไม่ได้", stars: "" };
  if (p < 0.001) return { level: "very-strong", th: "มีนัยสำคัญมาก (p < 0.001)", stars: "***" };
  if (p < 0.01)  return { level: "strong",      th: "มีนัยสำคัญ (p < 0.01)",     stars: "**"  };
  if (p < 0.05)  return { level: "significant", th: "มีนัยสำคัญ (p < 0.05)",     stars: "*"   };
  if (p < 0.10)  return { level: "marginal",    th: "ใกล้เคียงนัยสำคัญ (p < 0.10)", stars: "."   };
  return { level: "none", th: "ไม่มีนัยสำคัญทางสถิติ", stars: "" };
}

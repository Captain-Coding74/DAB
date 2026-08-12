/**
 * Inferential statistics — the tests a thesis actually has to run.
 *
 * DAB could describe data but not answer "is this difference real?", which is
 * the question a defence committee asks. Everything here is deterministic
 * (ADR-0001): the AI never computes a statistic, it only writes prose about
 * numbers produced in this file.
 *
 * SAMPLE vs POPULATION VARIANCE
 * -----------------------------
 * stats.js `describeNumeric` divides by n — correct, because it is describing
 * the rows it was handed. Everything here divides by n-1, because inference
 * treats those rows as a sample from a larger population. Mixing the two
 * inflates significance, so the sample form is written out explicitly rather
 * than reused from stats.js.
 *
 * REFUSING TO ANSWER
 * ------------------
 * Every function returns `{ error }` instead of a number when the sample is
 * too small or degenerate. A wrong p-value is worse than no p-value: a student
 * would defend a thesis on it.
 */
import {
  tDistPValue, fDistPValue, chiSquarePValue, significanceLabel,
} from "./distributions.js";

const num = (a) => a.filter((v) => typeof v === "number" && Number.isFinite(v));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
/** Sample variance (n-1). See the note above — this is not describeNumeric's. */
const sampleVar = (a) => {
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
};

/**
 * Independent-samples t-test (Welch).
 *
 * Welch rather than Student because it does not assume the two groups have
 * equal variances — real survey groups rarely do, and the equal-variance
 * version silently overstates significance when they differ.
 */
export function independentTTest(groupA, groupB) {
  const a = num(groupA), b = num(groupB);
  if (a.length < 2 || b.length < 2) {
    return { error: "ต้องมีอย่างน้อย 2 ค่าในแต่ละกลุ่ม", errorEn: "each group needs at least 2 values" };
  }

  const meanA = mean(a), meanB = mean(b);
  const varA = sampleVar(a), varB = sampleVar(b);
  const seA = varA / a.length, seB = varB / b.length;
  const se = Math.sqrt(seA + seB);

  if (se === 0) {
    return {
      test: "independent-t", meanA, meanB, n: a.length + b.length,
      t: meanA === meanB ? 0 : Infinity,
      p: meanA === meanB ? 1 : 0,
      significant: meanA !== meanB,
      note: "ไม่มีความแปรปรวนในข้อมูล", noteEn: "no variance in the data",
    };
  }

  const t = (meanA - meanB) / se;
  // Welch–Satterthwaite degrees of freedom
  const df = (seA + seB) ** 2 / (seA ** 2 / (a.length - 1) + seB ** 2 / (b.length - 1));
  const p = tDistPValue(t, df);

  // Cohen's d on the pooled SD — effect size, because significance alone says
  // nothing about whether a difference is large enough to matter.
  const pooledSd = Math.sqrt(((a.length - 1) * varA + (b.length - 1) * varB) / (a.length + b.length - 2));
  const d = pooledSd === 0 ? 0 : (meanA - meanB) / pooledSd;

  return {
    test: "independent-t", variant: "Welch",
    meanA, meanB, nA: a.length, nB: b.length, n: a.length + b.length,
    sdA: Math.sqrt(varA), sdB: Math.sqrt(varB),
    t, df, p, cohensD: d,
    effectSizeTh: Math.abs(d) < 0.2 ? "เล็กมาก" : Math.abs(d) < 0.5 ? "เล็ก" : Math.abs(d) < 0.8 ? "ปานกลาง" : "ใหญ่",
    significant: p < 0.05,
    ...significanceLabel(p),
  };
}

/** Paired-samples t-test — before/after on the same subjects. */
export function pairedTTest(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return { error: "ข้อมูลสองชุดต้องมีจำนวนเท่ากัน", errorEn: "paired data must be the same length" };
  }
  const diffs = [];
  for (let i = 0; i < before.length; i++) {
    const x = before[i], y = after[i];
    if (Number.isFinite(x) && Number.isFinite(y)) diffs.push(y - x);
  }
  if (diffs.length < 2) {
    return { error: "ต้องมีอย่างน้อย 2 คู่", errorEn: "at least 2 complete pairs required" };
  }

  const meanDiff = mean(diffs);
  const sd = Math.sqrt(sampleVar(diffs));
  const df = diffs.length - 1;

  if (sd === 0) {
    return {
      test: "paired-t", meanDiff, n: diffs.length, df,
      t: meanDiff === 0 ? 0 : Infinity, p: meanDiff === 0 ? 1 : 0,
      significant: meanDiff !== 0,
      note: "ผลต่างคงที่ทุกคู่", noteEn: "every pair changed by the same amount",
    };
  }

  const t = meanDiff / (sd / Math.sqrt(diffs.length));
  const p = tDistPValue(t, df);
  return {
    test: "paired-t", meanDiff, sdDiff: sd, n: diffs.length, df, t, p,
    cohensD: meanDiff / sd,
    significant: p < 0.05,
    ...significanceLabel(p),
  };
}

/** One-way ANOVA — comparing three or more group means at once. */
export function oneWayAnova(groups) {
  const gs = (groups || []).map(num).filter((g) => g.length > 0);
  if (gs.length < 2) return { error: "ต้องมีอย่างน้อย 2 กลุ่ม", errorEn: "at least 2 groups required" };
  const N = gs.reduce((s, g) => s + g.length, 0);
  if (N <= gs.length) return { error: "ข้อมูลน้อยเกินไป", errorEn: "not enough observations" };

  const grand = mean(gs.flat());
  const ssBetween = gs.reduce((s, g) => s + g.length * (mean(g) - grand) ** 2, 0);
  const ssWithin  = gs.reduce((s, g) => { const m = mean(g); return s + g.reduce((t, v) => t + (v - m) ** 2, 0); }, 0);

  const dfBetween = gs.length - 1;
  const dfWithin  = N - gs.length;
  const msBetween = ssBetween / dfBetween;
  const msWithin  = ssWithin / dfWithin;

  const f = msWithin === 0 ? (ssBetween === 0 ? 0 : Infinity) : msBetween / msWithin;
  const p = msWithin === 0 ? (ssBetween === 0 ? 1 : 0) : fDistPValue(f, dfBetween, dfWithin);

  return {
    test: "one-way-anova",
    groups: gs.map((g, i) => ({ index: i, n: g.length, mean: mean(g), sd: g.length > 1 ? Math.sqrt(sampleVar(g)) : 0 })),
    ssBetween, ssWithin, dfBetween, dfWithin, msBetween, msWithin,
    f, p,
    etaSquared: ssBetween + ssWithin === 0 ? 0 : ssBetween / (ssBetween + ssWithin),
    significant: p < 0.05,
    ...significanceLabel(p),
  };
}

/** Chi-square test of independence on a contingency table. */
export function chiSquareTest(table) {
  if (!Array.isArray(table) || table.length < 2 || !Array.isArray(table[0]) || table[0].length < 2) {
    return { error: "ต้องเป็นตารางอย่างน้อย 2x2", errorEn: "needs at least a 2x2 table" };
  }
  const rows = table.length, cols = table[0].length;
  const rowSums = table.map((r) => r.reduce((s, v) => s + v, 0));
  const colSums = Array.from({ length: cols }, (_, j) => table.reduce((s, r) => s + r[j], 0));
  const total = rowSums.reduce((s, v) => s + v, 0);
  if (total === 0) return { error: "ตารางว่าง", errorEn: "empty table" };

  let chi2 = 0, minExpected = Infinity;
  const expected = [];
  for (let i = 0; i < rows; i++) {
    expected.push([]);
    for (let j = 0; j < cols; j++) {
      const e = (rowSums[i] * colSums[j]) / total;
      expected[i].push(e);
      minExpected = Math.min(minExpected, e);
      if (e > 0) chi2 += (table[i][j] - e) ** 2 / e;
    }
  }

  const df = (rows - 1) * (cols - 1);
  const p = chiSquarePValue(chi2, df);
  // Cramér's V — effect size, since chi-square grows with sample size alone.
  const v = Math.sqrt(chi2 / (total * Math.min(rows - 1, cols - 1)));

  return {
    test: "chi-square", chi2, df, p, n: total, expected, cramersV: v,
    significant: p < 0.05,
    // The standard rule: chi-square is unreliable when expected counts are tiny.
    warning: minExpected < 5
      ? "ค่าคาดหวังบางช่องต่ำกว่า 5 — ผลอาจไม่น่าเชื่อถือ"
      : null,
    warningEn: minExpected < 5 ? "some expected counts below 5 — result may be unreliable" : null,
    ...significanceLabel(p),
  };
}

/** Pearson correlation with a p-value. */
export function pearsonCorrelation(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return { error: "ต้องมีอย่างน้อย 3 คู่", errorEn: "at least 3 complete pairs required" };

  const x = pairs.map((p) => p[0]), y = pairs.map((p) => p[1]);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) {
    return { test: "pearson", r: NaN, p: NaN, n: x.length, significant: false,
             note: "ตัวแปรหนึ่งไม่มีความแปรปรวน", noteEn: "one variable has no variance" };
  }

  const r = sxy / Math.sqrt(sxx * syy);
  const df = x.length - 2;
  const t = r * Math.sqrt(df / (1 - r * r));
  const p = Math.abs(r) >= 1 ? 0 : tDistPValue(t, df);

  return {
    test: "pearson", r, r2: r * r, n: x.length, df, t, p,
    strengthTh: Math.abs(r) < 0.3 ? "อ่อน" : Math.abs(r) < 0.7 ? "ปานกลาง" : "แข็งแรง",
    directionTh: r > 0 ? "ทางเดียวกัน" : "ตรงกันข้าม",
    significant: p < 0.05,
    ...significanceLabel(p),
  };
}

/** Simple linear regression with a coefficient table. */
export function linearRegression(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return { error: "ต้องมีอย่างน้อย 3 คู่", errorEn: "at least 3 complete pairs required" };

  const x = pairs.map((p) => p[0]), y = pairs.map((p) => p[1]);
  const n = x.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  if (sxx === 0) return { error: "ตัวแปร x ไม่มีความแปรปรวน", errorEn: "x has no variance" };

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * x[i];
    ssRes += (y[i] - yhat) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const df = n - 2;

  // Perfect fit ⇒ zero residual variance ⇒ the slope's standard error is 0.
  if (ssRes === 0 || df <= 0) {
    return { test: "linear-regression", slope, intercept, r2, n, df,
             se: 0, t: Infinity, p: 0, significant: true,
             equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
             note: "พอดีสมบูรณ์", noteEn: "perfect fit" };
  }

  const mse = ssRes / df;
  const seSlope = Math.sqrt(mse / sxx);
  const t = slope / seSlope;
  const p = tDistPValue(t, df);

  return {
    test: "linear-regression",
    slope, intercept, r2, n, df,
    seSlope, t, p,
    rmse: Math.sqrt(mse),
    equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
    significant: p < 0.05,
    ...significanceLabel(p),
  };
}

/**
 * Cronbach's alpha — internal consistency of a questionnaire scale.
 *
 * `items` is one array per question, each holding that question's answers in
 * respondent order. Nearly every Thai survey-based thesis reports this.
 */
export function cronbachAlpha(items) {
  if (!Array.isArray(items) || items.length < 2) {
    return { error: "ต้องมีอย่างน้อย 2 ข้อคำถาม", errorEn: "at least 2 items required" };
  }
  const nResp = items[0]?.length ?? 0;
  if (nResp < 2 || items.some((it) => it.length !== nResp)) {
    return { error: "ทุกข้อต้องมีจำนวนผู้ตอบเท่ากัน และอย่างน้อย 2 คน",
             errorEn: "every item needs the same number of respondents, at least 2" };
  }
  if (items.some((it) => it.some((v) => !Number.isFinite(v)))) {
    return { error: "มีค่าที่ไม่ใช่ตัวเลข", errorEn: "non-numeric values present" };
  }

  const k = items.length;
  const itemVarSum = items.reduce((s, it) => s + sampleVar(it), 0);
  const totals = Array.from({ length: nResp }, (_, r) => items.reduce((s, it) => s + it[r], 0));
  const totalVar = sampleVar(totals);

  if (totalVar === 0) {
    return { error: "คะแนนรวมไม่มีความแปรปรวน", errorEn: "total scores have no variance" };
  }

  const alpha = (k / (k - 1)) * (1 - itemVarSum / totalVar);

  // The conventional Thai thesis reporting bands.
  const interpretationTh =
    alpha >= 0.9 ? "ยอดเยี่ยม" : alpha >= 0.8 ? "ดี" : alpha >= 0.7 ? "ยอมรับได้"
    : alpha >= 0.6 ? "น่าสงสัย" : alpha >= 0.5 ? "แย่" : "ใช้ไม่ได้";

  return {
    test: "cronbach-alpha",
    alpha, nItems: k, nRespondents: nResp,
    itemVarianceSum: itemVarSum, totalVariance: totalVar,
    interpretationTh,
    acceptable: alpha >= 0.7,
    noteTh: alpha < 0.7 ? "ค่าต่ำกว่า 0.7 — ควรทบทวนข้อคำถาม" : null,
  };
}

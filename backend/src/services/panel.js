/**
 * Panel data — fixed effects, random effects, and the Hausman test.
 *
 * WHY THIS FITS DAB'S USERS
 * -------------------------
 * Panel structure is genuinely common in Thai thesis work: the same students
 * measured before and after an intervention, the same respondents across
 * three survey waves, the same shop branches over 24 months. Unlike SEM or
 * MIDAS, this is a shape the data actually has.
 *
 * The appeal of fixed effects is that it answers a sharper question than
 * ordinary regression. Pooled OLS asks "do shops with more promotion spend
 * sell more?" — which confounds promotion with everything else that differs
 * between shops (location, size, manager). Fixed effects asks "WITHIN the
 * same shop, does spending more move sales?" Every fixed characteristic of
 * that shop cancels out. No extra data required; it falls out of the algebra.
 *
 * ADR-0001 holds: deterministic, offline, no model call.
 *
 * HOW IT IS VALIDATED
 * -------------------
 * The within estimator is checked against least-squares-dummy-variables —
 * algebraically the same answer, computed by an entirely different route
 * (demeaning versus inverting a larger matrix with n-1 dummy columns). Both
 * agreeing to ten decimals is real evidence. Published plm targets for later
 * Grunfeld parity work are recorded in panel.test.js.
 */
import { serviceLogger } from "../logger.js";
import { chiSquarePValue } from "./distributions.js";

const log = serviceLogger("panel");

const MIN_UNITS = 2;
const MIN_OBS   = 10;

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * OLS by Gaussian elimination on the normal equations, returning coefficients,
 * standard errors and the residual sum of squares. `dfOverride` exists because
 * the within estimator must charge itself for the n unit means it absorbed —
 * without it the standard errors come out too small, which is the classic way
 * a hand-rolled fixed-effects routine reports spurious significance.
 */
function ols(X, y, dfOverride = null) {
  const k = X.length, N = y.length;
  const XtX = X.map((xi) => X.map((xj) => xi.reduce((s, v, r) => s + v * xj[r], 0)));
  const Xty = X.map((xi) => xi.reduce((s, v, r) => s + v * y[r], 0));

  // augmented system, solved with partial pivoting; also builds the inverse
  const M = XtX.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)), Xty[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) return null;      // singular ⇒ collinear
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = c; j < 2 * k + 1; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = c; j < 2 * k + 1; j++) M[r][j] -= f * M[c][j];
    }
  }
  const beta = M.map((row) => row[2 * k]);
  const inv  = M.map((row) => row.slice(k, 2 * k));

  let rss = 0;
  for (let r = 0; r < N; r++) {
    const fit = X.reduce((s, xi, i) => s + beta[i] * xi[r], 0);
    rss += (y[r] - fit) ** 2;
  }
  const df = dfOverride ?? (N - k);
  const sigma2 = df > 0 ? rss / df : NaN;
  const se = inv.map((row, i) => Math.sqrt(sigma2 * row[i]));

  return { beta, se, rss, df, sigma2, inv };
}

/** Shared setup: pull the columns out, group by unit, and refuse the unusable. */
function prepare(rows, { y, x, unit }) {
  if (!Array.isArray(rows) || rows.length < MIN_OBS) {
    return { error: `ต้องมีข้อมูลอย่างน้อย ${MIN_OBS} แถว`,
             errorEn: `at least ${MIN_OBS} observations required, got ${rows?.length ?? 0}` };
  }
  for (const col of [y, unit, ...x]) {
    if (!(col in rows[0])) {
      return { error: `ไม่พบคอลัมน์ "${col}"`, errorEn: `column "${col}" not found` };
    }
  }

  const clean = [];
  for (const r of rows) {
    const yv = num(r[y]);
    const xv = x.map((c) => num(r[c]));
    const u  = String(r[unit] ?? "").trim();
    if (yv === null || xv.some((v) => v === null) || !u) continue;
    clean.push({ u, y: yv, x: xv });
  }
  if (clean.length < MIN_OBS) {
    return { error: "ข้อมูลที่ใช้ได้น้อยเกินไป", errorEn: `only ${clean.length} usable rows after dropping incomplete ones` };
  }

  const groups = new Map();
  for (const r of clean) {
    if (!groups.has(r.u)) groups.set(r.u, []);
    groups.get(r.u).push(r);
  }
  if (groups.size < MIN_UNITS) {
    return { error: `ต้องมีอย่างน้อย ${MIN_UNITS} หน่วย — ข้อมูลนี้ไม่ใช่ panel`,
             errorEn: `panel models need at least ${MIN_UNITS} units, found ${groups.size}` };
  }

  const singletons = [...groups.entries()].filter(([, g]) => g.length < 2).map(([u]) => u);
  const sizes = [...groups.values()].map((g) => g.length);
  const balanced = sizes.every((s) => s === sizes[0]);

  return { clean, groups, balanced, singletons, T: sizes[0], nObs: clean.length };
}

/**
 * Fixed effects (within estimator).
 *
 * Subtract each unit's own mean from its rows, then run OLS on the deviations.
 * Everything constant within a unit vanishes — which is the feature, and also
 * why a time-invariant regressor cannot be estimated and is refused below.
 */
export function fixedEffects(rows, spec) {
  const prep = prepare(rows, spec);
  if (prep.error) return prep;
  const { clean, groups, balanced, singletons, nObs } = prep;
  const k = spec.x.length;

  // Demean within each unit.
  const dy = [], dx = Array.from({ length: k }, () => []);
  const unitMeans = new Map();
  for (const [u, g] of groups) {
    const my = mean(g.map((r) => r.y));
    const mx = Array.from({ length: k }, (_, j) => mean(g.map((r) => r.x[j])));
    unitMeans.set(u, { my, mx });
    for (const r of g) {
      dy.push(r.y - my);
      for (let j = 0; j < k; j++) dx[j].push(r.x[j] - mx[j]);
    }
  }

  // A regressor that never moves within a unit is zero after demeaning. It is
  // not estimable by fixed effects — say so instead of returning NaN.
  const dead = spec.x.filter((_, j) => {
    const col = dx[j];
    const m = mean(col);
    return col.reduce((s, v) => s + (v - m) ** 2, 0) < 1e-9;
  });
  if (dead.length) {
    return {
      error: `ตัวแปร ${dead.join(", ")} ไม่เปลี่ยนแปลงภายในหน่วย — fixed effects ประมาณค่าไม่ได้`,
      errorEn: `${dead.join(", ")} is time-invariant within units — fixed effects cannot identify it. Use random effects instead.`,
    };
  }

  const n = groups.size;
  const df = nObs - n - k;                     // absorbed unit means cost n
  if (df <= 0) {
    return { error: "องศาความเป็นอิสระไม่พอ", errorEn: `no degrees of freedom left (${nObs} obs, ${n} units, ${k} regressors)` };
  }

  const fit = ols(dx, dy, df);
  if (!fit) return { error: "ตัวแปรทำนายมีความสัมพันธ์กันสูงเกินไป", errorEn: "regressors are collinear" };

  // Unit effects: alpha_i = mean(y_i) - beta . mean(x_i)
  const unitEffects = {};
  for (const [u, { my, mx }] of unitMeans) {
    unitEffects[u] = my - fit.beta.reduce((s, b, j) => s + b * mx[j], 0);
  }

  // Within R²: how much of the within-unit variation the model explains.
  const tssWithin = dy.reduce((s, v) => s + v * v, 0);
  const coefficients = Object.fromEntries(spec.x.map((c, j) => [c, fit.beta[j]]));
  const se = Object.fromEntries(spec.x.map((c, j) => [c, fit.se[j]]));

  log.info({ units: n, obs: nObs }, "fixed effects estimated");

  return {
    model: "fixed-effects", coefficients, se,
    tStat: Object.fromEntries(spec.x.map((c, j) => [c, fit.beta[j] / fit.se[j]])),
    n, T: prep.T, nObs, df, balanced,
    r2Within: tssWithin > 0 ? 1 - fit.rss / tssWithin : NaN,
    sigma2: fit.sigma2,
    vcov: fit.inv.map((row) => row.map((v) => v * fit.sigma2)),
    unitEffects,
    warning: singletons.length
      ? `หน่วย ${singletons.join(", ")} มีข้อมูลเพียงแถวเดียว — ไม่ได้ช่วยประมาณค่า`
      : null,
    warningEn: singletons.length
      ? `units with a single observation contribute nothing to the within estimator: ${singletons.join(", ")}`
      : null,
    computedBy: "deterministic",
  };
}

/**
 * Least-squares dummy variables — the same estimator by a different route.
 *
 * Exists so the within estimator can be checked against an independent
 * computation rather than against itself. Not intended for production use on
 * large panels: it inverts a (k + n - 1) matrix where the within estimator
 * inverts a k one.
 */
export function lsdv(rows, spec) {
  const prep = prepare(rows, spec);
  if (prep.error) return prep;
  const { clean, groups } = prep;
  const units = [...groups.keys()];
  const k = spec.x.length;

  const cols = [];
  for (let j = 0; j < k; j++) cols.push(clean.map((r) => r.x[j]));
  cols.push(clean.map(() => 1));                                   // intercept
  for (let i = 1; i < units.length; i++)                            // n-1 dummies
    cols.push(clean.map((r) => (r.u === units[i] ? 1 : 0)));

  const fit = ols(cols, clean.map((r) => r.y));
  if (!fit) return { error: "singular design matrix", errorEn: "singular design matrix" };

  return {
    model: "lsdv",
    coefficients: Object.fromEntries(spec.x.map((c, j) => [c, fit.beta[j]])),
    se: Object.fromEntries(spec.x.map((c, j) => [c, fit.se[j]])),
    df: fit.df, rss: fit.rss,
  };
}

/**
 * Random effects (Swamy-Arora).
 *
 * Quasi-demeaning: subtract theta times the unit mean rather than all of it,
 * where theta comes from the two variance components. theta = 0 gives pooled
 * OLS, theta = 1 gives fixed effects, and real data lands between.
 *
 * NOTE ON ESTIMATORS: at least four variance-component estimators are in use
 * (Swamy-Arora, Wallace-Hussain, Amemiya, Nerlove) and packages disagree in
 * the third decimal depending which they pick. This is Swamy-Arora, R plm's
 * default, so any parity check must be against that.
 */
export function randomEffects(rows, spec) {
  const prep = prepare(rows, spec);
  if (prep.error) return prep;
  const { clean, groups, balanced, nObs } = prep;
  const k = spec.x.length, n = groups.size;

  if (!balanced) {
    return { error: "ข้อมูลไม่สมดุล — ยังรองรับเฉพาะ panel ที่แต่ละหน่วยมีจำนวนแถวเท่ากัน",
             errorEn: "unbalanced panels are not supported yet — Swamy-Arora here assumes equal T per unit" };
  }
  const T = prep.T;

  const within = fixedEffects(rows, spec);
  if (within.error) return within;
  const sigma2Within = within.sigma2;                 // idiosyncratic variance

  // Between regression: one row per unit, on unit means.
  const bY = [], bX = Array.from({ length: k }, () => []);
  for (const g of groups.values()) {
    bY.push(mean(g.map((r) => r.y)));
    for (let j = 0; j < k; j++) bX[j].push(mean(g.map((r) => r.x[j])));
  }
  const bCols = [...bX, bY.map(() => 1)];
  const between = ols(bCols, bY, n - k - 1);
  if (!between) return { error: "between regression singular", errorEn: "between regression is singular" };

  // Swamy-Arora: sigma2_between = sigma2_within/T + sigma2_mu
  const sigma2Between = between.sigma2;
  const sigma2Mu = Math.max(0, sigma2Between - sigma2Within / T);
  const theta = 1 - Math.sqrt(sigma2Within / (sigma2Within + T * sigma2Mu));

  // Quasi-demean and run OLS.
  const qy = [], qx = Array.from({ length: k }, () => []), qc = [];
  for (const g of groups.values()) {
    const my = mean(g.map((r) => r.y));
    const mx = Array.from({ length: k }, (_, j) => mean(g.map((r) => r.x[j])));
    for (const r of g) {
      qy.push(r.y - theta * my);
      for (let j = 0; j < k; j++) qx[j].push(r.x[j] - theta * mx[j]);
      qc.push(1 - theta);
    }
  }
  const fit = ols([...qx, qc], qy);
  if (!fit) return { error: "ตัวแปรทำนายมีความสัมพันธ์กันสูงเกินไป", errorEn: "regressors are collinear" };

  log.info({ units: n, theta: theta.toFixed(4) }, "random effects estimated");

  return {
    model: "random-effects", method: "Swamy-Arora",
    coefficients: Object.fromEntries(spec.x.map((c, j) => [c, fit.beta[j]])),
    se: Object.fromEntries(spec.x.map((c, j) => [c, fit.se[j]])),
    intercept: fit.beta[k],
    theta,
    varIdiosyncratic: sigma2Within,
    varIndividual: sigma2Mu,
    shareIndividual: sigma2Mu / (sigma2Mu + sigma2Within),
    n, T, nObs, df: fit.df,
    vcov: fit.inv.slice(0, k).map((row) => row.slice(0, k).map((v) => v * fit.sigma2)),
    computedBy: "deterministic",
  };
}

/**
 * Hausman test — fixed or random effects?
 *
 * Random effects is more efficient but assumes the unit effects are
 * uncorrelated with the regressors. That assumption fails constantly in
 * practice (bigger shops both spend more AND sell more). The test compares the
 * two coefficient vectors: a large difference means the assumption is broken
 * and fixed effects should be used.
 */
export function hausmanTest(fe, re) {
  if (fe?.error) return fe;
  if (re?.error) return re;

  const names = Object.keys(fe.coefficients);
  const d = names.map((c) => fe.coefficients[c] - re.coefficients[c]);
  const k = names.length;

  // Var(b_FE - b_RE) = Var(b_FE) - Var(b_RE), valid under the null.
  const D = fe.vcov.map((row, i) => row.map((v, j) => v - re.vcov[i][j]));

  const M = D.map((row, i) => [...row, ...d.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) {
      // A non-invertible difference is a documented outcome, not a bug — it
      // means the two estimators are too close to distinguish here.
      return { error: "เปรียบเทียบไม่ได้ — ความแตกต่างของสองแบบจำลองเล็กเกินไป",
               errorEn: "the variance difference is not invertible — the two models are too similar to distinguish" };
    }
    [M[c], M[piv]] = [M[piv], M[c]];
    const dd = M[c][c];
    for (let j = c; j < 2 * k; j++) M[c][j] /= dd;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = c; j < 2 * k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const inv = M.map((row) => row.slice(k, 2 * k));
  const chi2 = Math.max(0, d.reduce((s, di, i) => s + di * d.reduce((t, dj, j) => t + inv[i][j] * dj, 0), 0));
  const p = chiSquarePValue(chi2, k);

  return {
    test: "hausman", chi2, df: k, p,
    significant: p < 0.05,
    recommendationTh: p < 0.05
      ? "ควรใช้ Fixed Effects — ผลของหน่วยสัมพันธ์กับตัวแปรทำนาย"
      : "ใช้ Random Effects ได้ — ไม่พบหลักฐานว่าผลของหน่วยสัมพันธ์กับตัวแปรทำนาย",
    recommendationEn: p < 0.05
      ? "use fixed effects — the unit effects are correlated with the regressors"
      : "random effects is acceptable — no evidence the unit effects are correlated with the regressors",
  };
}

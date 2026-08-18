/**
 * Kalman filter — local level structural time series.
 *
 * WHAT THIS REPLACES
 * ------------------
 * DAB's forecasting was a linear regression with a three-step projection. It
 * ran on anything: twelve months of seasonal shop sales got a straight line
 * through the seasonality, five points got the same confident treatment, and
 * nothing reported how much to trust the result. This gives a proper state
 * estimate, prediction intervals that widen with horizon, native handling of
 * missing periods, and — most importantly — a refusal when the data cannot
 * support a forecast at all.
 *
 * NOT MACHINE LEARNING
 * --------------------
 * The Kalman filter is a recursion from 1960. There is no training set and no
 * learned weights. It keeps a running estimate of the level plus how uncertain
 * that estimate is, then blends prediction with observation according to which
 * is more trustworthy. Two variances are estimated by maximum likelihood —
 * the same procedure that fits a regression line. ADR-0001 holds: deterministic,
 * reproducible, offline, no API call.
 *
 * THE MODEL
 * ---------
 *   observation:  y_t = mu_t + eps_t      eps ~ N(0, sigma2Eps)
 *   state:        mu_{t+1} = mu_t + eta_t  eta ~ N(0, sigma2Eta)
 *
 * The ratio of the two variances is the whole story. A large sigma2Eta means
 * the underlying level really moves, so the filter follows new data closely; a
 * small one means the observations are noisy around a stable level, so it
 * averages. Everything else falls out of that.
 *
 * VALIDATION
 * ----------
 * Pinned in kalman.test.js to the published Nile benchmark: sigma2 ~
 * 15099/1469, log-likelihood -632.538, 1971 forecast 798.4 with 95% interval
 * [517.1, 1079.7]. Those numbers come from R and statsmodels, not from this
 * code, which is the only way the test means anything.
 */
import { serviceLogger } from "../logger.js";

const log = serviceLogger("kalman");

const MIN_POINTS   = 8;
const MAX_HORIZON  = 0.5;   // never forecast further than half the series length
const DIFFUSE_P1   = 1e7;   // vague prior on the initial level

/** A row is observed if it is a finite number; null/undefined/NaN are gaps. */
const isObserved = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Run the filter and smoother for known variances.
 *
 * Missing observations are the reason this method is worth having: at a gap
 * the update step is simply skipped and the state propagates on its own. The
 * likelihood ignores those rows, and the smoother interpolates across them.
 */
export function kalmanLocalLevel(series, { sigma2Eps, sigma2Eta }) {
  const n = series.length;
  const a = new Array(n + 1);   // predicted state
  const P = new Array(n + 1);   // predicted state variance
  const v = new Array(n);       // innovation
  const F = new Array(n);       // innovation variance
  const K = new Array(n);       // Kalman gain
  const filtered = new Array(n);

  // Diffuse start: we know nothing about the initial level.
  a[0] = isObserved(series[0]) ? series[0] : 0;
  P[0] = DIFFUSE_P1;

  let logLikelihood = 0, nObserved = 0, seenFirstObs = false;

  for (let t = 0; t < n; t++) {
    if (isObserved(series[t])) {
      v[t] = series[t] - a[t];
      F[t] = P[t] + sigma2Eps;
      K[t] = P[t] / F[t];

      filtered[t] = a[t] + K[t] * v[t];
      a[t + 1] = filtered[t];
      P[t + 1] = P[t] * (1 - K[t]) + sigma2Eta;

      // Prediction error decomposition. The first OBSERVED point under a
      // diffuse prior contributes essentially no information, so it is
      // excluded — this is what statsmodels calls loglikelihood_burn=1, and
      // skipping it is the difference between matching -632.538 and not.
      // Keyed to the first observation, not t === 0: a series that starts
      // with a gap carries the diffuse P ≈ 1e7 to its first real point.
      if (seenFirstObs) logLikelihood += -0.5 * (Math.log(2 * Math.PI) + Math.log(F[t]) + (v[t] * v[t]) / F[t]);
      else seenFirstObs = true;
      nObserved++;
    } else {
      // No observation: no update, state carries forward, uncertainty grows.
      v[t] = 0; F[t] = Infinity; K[t] = 0;
      filtered[t] = a[t];
      a[t + 1] = a[t];
      P[t + 1] = P[t] + sigma2Eta;
    }
  }

  // ── RTS smoother: a backward pass giving states conditional on ALL data ──
  const smoothed = new Array(n);
  const smoothedVar = new Array(n);
  let r = 0, N = 0;
  for (let t = n - 1; t >= 0; t--) {
    if (Number.isFinite(F[t])) {
      const L = 1 - K[t];
      r = v[t] / F[t] + L * r;
      N = 1 / F[t] + L * L * N;
    }
    smoothed[t] = a[t] + P[t] * r;
    smoothedVar[t] = P[t] - P[t] * P[t] * N;
  }

  return { filtered, smoothed, smoothedVar, v, F, P, logLikelihood, nObserved,
           lastState: a[n], lastVariance: P[n] };
}

/**
 * Nelder–Mead on two parameters. Written out rather than pulled in because it
 * is thirty lines and the alternative is a dependency for one simplex.
 */
function nelderMead(objective, start, { maxIter = 400, tol = 1e-8 } = {}) {
  const n = start.length;
  let simplex = [start.slice()];
  for (let i = 0; i < n; i++) {
    const p = start.slice();
    p[i] += p[i] !== 0 ? 0.5 : 0.25;
    simplex.push(p);
  }
  let values = simplex.map(objective);
  let iterations = 0;

  for (; iterations < maxIter; iterations++) {
    const order = values.map((val, i) => i).sort((x, y) => values[x] - values[y]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);

    if (Math.abs(values[n] - values[0]) < tol) break;

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

    const reflect = centroid.map((c, j) => c + (c - simplex[n][j]));
    const fr = objective(reflect);

    if (fr < values[0]) {
      const expand = centroid.map((c, j) => c + 2 * (c - simplex[n][j]));
      const fe = objective(expand);
      if (fe < fr) { simplex[n] = expand; values[n] = fe; }
      else         { simplex[n] = reflect; values[n] = fr; }
    } else if (fr < values[n - 1]) {
      simplex[n] = reflect; values[n] = fr;
    } else {
      const contract = centroid.map((c, j) => c + 0.5 * (simplex[n][j] - c));
      const fc = objective(contract);
      if (fc < values[n]) { simplex[n] = contract; values[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j]));
          values[i] = objective(simplex[i]);
        }
      }
    }
  }

  const best = values.indexOf(Math.min(...values));
  return { params: simplex[best], value: values[best], iterations, converged: iterations < maxIter };
}

/** Refuse anything that cannot support a forecast. */
function validate(series) {
  if (!Array.isArray(series)) {
    return { error: "ข้อมูลไม่ถูกต้อง", errorEn: "a numeric array is required" };
  }
  const bad = series.find((v) => v != null && !isObserved(v));
  if (bad !== undefined) {
    return { error: `พบค่าที่ไม่ใช่ตัวเลข: ${bad}`, errorEn: `non-numeric value in the series: ${bad}` };
  }
  const observed = series.filter(isObserved);
  if (observed.length < MIN_POINTS) {
    return { error: `ต้องมีข้อมูลอย่างน้อย ${MIN_POINTS} จุด (มี ${observed.length})`,
             errorEn: `at least ${MIN_POINTS} observations required, got ${observed.length}` };
  }
  const mean = observed.reduce((s, x) => s + x, 0) / observed.length;
  const variance = observed.reduce((s, x) => s + (x - mean) ** 2, 0) / observed.length;
  if (variance < 1e-12) {
    return { error: "ข้อมูลไม่มีความแปรปรวน — พยากรณ์ไม่ได้",
             errorEn: "the series is constant — nothing to forecast" };
  }
  return null;
}

/**
 * Estimate the two variances by maximum likelihood.
 *
 * Optimised over LOG variances so they cannot go negative — a boundary the
 * optimiser would otherwise wander across, producing a variance of -300 and a
 * filter that quietly returns nonsense.
 */
export function fitLocalLevel(series) {
  const invalid = validate(series);
  if (invalid) return invalid;

  const observed = series.filter(isObserved);
  const mean = observed.reduce((s, x) => s + x, 0) / observed.length;
  const variance = observed.reduce((s, x) => s + (x - mean) ** 2, 0) / (observed.length - 1);

  const negLogLik = ([logEps, logEta]) => {
    const r = kalmanLocalLevel(series, { sigma2Eps: Math.exp(logEps), sigma2Eta: Math.exp(logEta) });
    return Number.isFinite(r.logLikelihood) ? -r.logLikelihood : 1e12;
  };

  // Start from the sample variance split between the two components; try a
  // second start because this likelihood is famously flat and a single simplex
  // can settle early on a shoulder.
  const starts = [
    [Math.log(variance * 0.7), Math.log(variance * 0.3)],
    [Math.log(variance * 0.9), Math.log(variance * 0.05)],
  ];
  let best = null;
  for (const s of starts) {
    const r = nelderMead(negLogLik, s);
    if (!best || r.value < best.value) best = r;
  }

  const sigma2Eps = Math.exp(best.params[0]);
  const sigma2Eta = Math.exp(best.params[1]);
  const fitted = kalmanLocalLevel(series, { sigma2Eps, sigma2Eta });

  log.info({ sigma2Eps: Math.round(sigma2Eps), sigma2Eta: Math.round(sigma2Eta),
             logLikelihood: fitted.logLikelihood.toFixed(3) }, "local level fitted");

  return {
    method: "local-level", sigma2Eps, sigma2Eta,
    logLikelihood: fitted.logLikelihood,
    converged: best.converged,
    iterations: best.iterations,
    n: series.length,
    nObserved: fitted.nObserved,
    // A vanishing level variance means the series is flat noise around a fixed
    // mean; a vanishing irregular means every wobble is treated as real. Both
    // are legitimate fits but worth telling the user about.
    note: sigma2Eta < 1e-6 ? "ระดับคงที่ — ข้อมูลแกว่งรอบค่าเฉลี่ยเดียว"
        : sigma2Eps < 1e-6 ? "ไม่มีสัญญาณรบกวน — ทุกการเปลี่ยนแปลงถือว่าจริง" : null,
    computedBy: "deterministic",
  };
}

/**
 * Forecast forward. In state-space terms a forecast IS a run of missing
 * observations: propagate the state, and the growing variance becomes the
 * widening prediction interval.
 */
export function forecast(series, fit, steps = 3) {
  if (fit?.error) return fit;
  const observed = series.filter(isObserved).length;
  const cap = Math.max(1, Math.floor(observed * MAX_HORIZON));
  if (!Number.isInteger(steps) || steps < 1) {
    return { error: "จำนวนงวดที่พยากรณ์ต้องเป็นจำนวนเต็มบวก", errorEn: "steps must be a positive integer" };
  }
  if (steps > cap) {
    return { error: `พยากรณ์ได้ไม่เกิน ${cap} งวดจากข้อมูล ${observed} จุด`,
             errorEn: `refusing ${steps} steps from ${observed} observations — max ${cap}` };
  }

  const r = kalmanLocalLevel(series, fit);
  const out = [];
  let level = r.lastState, P = r.lastVariance;

  for (let h = 1; h <= steps; h++) {
    const varForecast = P + fit.sigma2Eps;    // state uncertainty + measurement noise
    const se = Math.sqrt(varForecast);
    out.push({
      step: h,
      point: level,
      se,
      lower95: level - 1.96 * se,
      upper95: level + 1.96 * se,
      lower80: level - 1.2816 * se,
      upper80: level + 1.2816 * se,
    });
    P += fit.sigma2Eta;                        // each step without data widens it
  }
  return out;
}

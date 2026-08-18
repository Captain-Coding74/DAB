/**
 * PLS-SEM — partial least squares structural equation modelling.
 *
 * Answers the question a thesis actually asks: "does service quality drive
 * loyalty, and how strongly?" — where neither is directly measurable and both
 * are inferred from questionnaire items.
 *
 * WHY PLS AND NOT COVARIANCE-BASED SEM
 * -----------------------------------
 * CB-SEM (what AMOS and LISREL do) maximises a likelihood over a model-implied
 * covariance matrix. It needs an optimiser that can fail, standard errors from
 * an inverted information matrix, and a battery of improper-solution guards.
 * PLS is a deterministic sequence of correlations and OLS regressions: no
 * likelihood surface, no convergence failure to misread. It also tolerates the
 * sample sizes Thai theses actually have (100-300) and makes no normality
 * assumption. That is why this is implemented and CB-SEM is not.
 *
 * ADR-0001 holds: every number here is deterministic. Run it a thousand times
 * on the same data and it returns the same answer. The AI is not involved.
 *
 * HOW IT IS VALIDATED
 * -------------------
 * PLS always produces a number — there is no error state to catch a wrong
 * weighting scheme. So plsSem.test.js pins it to statistics already verified
 * against published critical-value tables: with one indicator per construct a
 * path coefficient MUST equal the Pearson correlation, and multi-predictor
 * paths MUST equal standardized regression betas. Those anchor the estimation
 * to maths this codebase already proved correct.
 *
 * Reference: Wold (1982), Lohmöller (1989), Hair et al. Primer on PLS-SEM.
 */
import { serviceLogger } from "../logger.js";

const log = serviceLogger("pls-sem");

const MAX_ITER  = 300;
const TOLERANCE = 1e-7;   // SmartPLS's stop criterion
const MIN_ROWS  = 10;

/* ── small helpers ──────────────────────────────────────── */
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** z-score a column. Returns null if it has no variance — a dead indicator. */
function standardize(values) {
  const m = mean(values);
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
  if (!Number.isFinite(sd) || sd < 1e-12) return null;
  return values.map((v) => (v - m) / sd);
}

const dot  = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const corr = (a, b) => dot(a, b) / (a.length - 1);   // both standardized ⇒ this is r

/** Rescale a composite to unit variance, the algorithm's normalisation step. */
function toUnitVariance(v) {
  const m = mean(v);
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  if (sd < 1e-12) return null;
  return v.map((x) => (x - m) / sd);
}

/**
 * OLS of y on the columns of X (all standardized), solved by Gaussian
 * elimination on the normal equations. Small systems only — a construct rarely
 * has more than a handful of predictors — so a full QR is unnecessary.
 */
function standardizedBetas(X, y) {
  const k = X.length;
  if (k === 0) return [];
  if (k === 1) return [corr(X[0], y)];               // simple regression ⇒ r

  const A = X.map((xi) => X.map((xj) => corr(xi, xj)));
  const b = X.map((xi) => corr(xi, y));

  // Gaussian elimination with partial pivoting.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;  // singular ⇒ collinear predictors
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= k; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[k] / M[i][i]);
}

/**
 * Fit the model.
 *
 * @param rows       array of objects, one per respondent
 * @param model      { constructs: { Name: [indicator, …] }, paths: { Target: [Source, …] } }
 * @param options    { mode: "A"|"B" } — A (reflective, default) or B (formative)
 */
/**
 * Reject anything unmodellable before estimating. Split out because PLS always
 * produces a number — the refusals are the only place a bad model is caught,
 * so they deserve to be readable on their own.
 */
function validateModel(rows, model) {
  if (!Array.isArray(rows) || rows.length < MIN_ROWS) {
    return { error: `ต้องมีข้อมูลอย่างน้อย ${MIN_ROWS} แถว`,
             errorEn: `at least ${MIN_ROWS} rows required, got ${rows?.length ?? 0}` };
  }
  const constructs = model?.constructs;
  if (!constructs || Object.keys(constructs).length < 2) {
    return { error: "ต้องมีตัวแปรแฝงอย่างน้อย 2 ตัว", errorEn: "at least 2 constructs required" };
  }
  const names = Object.keys(constructs);

  for (const [name, items] of Object.entries(constructs)) {
    if (!Array.isArray(items) || items.length === 0) {
      return { error: `ตัวแปรแฝง "${name}" ไม่มีข้อคำถาม`, errorEn: `construct "${name}" has no indicators` };
    }
    for (const it of items) {
      if (!(it in rows[0])) {
        return { error: `ไม่พบคอลัมน์ "${it}"`, errorEn: `indicator "${it}" not found in the data` };
      }
    }
  }
  for (const [target, sources] of Object.entries(model.paths || {})) {
    if (!names.includes(target)) {
      return { error: `เส้นทางชี้ไปยัง "${target}" ที่ไม่ได้ประกาศไว้`,
               errorEn: `path targets undeclared construct "${target}"` };
    }
    for (const s of sources) if (!names.includes(s)) {
      return { error: `เส้นทางมาจาก "${s}" ที่ไม่ได้ประกาศไว้`,
               errorEn: `path comes from undeclared construct "${s}"` };
    }
  }
  return null;
}

/**
 * Discriminant validity — Fornell-Larcker and HTMT.
 *
 * Kept separate because these are the two competing criteria a thesis reports,
 * and HTMT (Henseler et al. 2015) is the one to trust: Fornell-Larcker is
 * insensitive when loadings across constructs are similar.
 */
function discriminantValidity(names, constructs, scores, Z, ave, corr) {
  const constructCorr = {};
  for (const a of names) {
    constructCorr[a] = {};
    for (const b of names) constructCorr[a][b] = a === b ? 1 : corr(scores[a], scores[b]);
  }

  // Fornell-Larcker: √AVE on the diagonal, construct correlations off it.
  const fornellLarcker = {};
  for (const a of names) {
    fornellLarcker[a] = {};
    for (const b of names) fornellLarcker[a][b] = a === b ? Math.sqrt(ave[a]) : constructCorr[a][b];
  }

  // HTMT: mean between-construct indicator correlation over the geometric mean
  // of the two within-construct averages. Preferred over Fornell-Larcker,
  // which is insensitive when loadings are similar (Henseler et al. 2015).
  const meanAbs = (xs) => (xs.length ? xs.reduce((s, v) => s + Math.abs(v), 0) / xs.length : NaN);
  const withinAvg = (name) => {
    const items = constructs[name], out = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        out.push(corr(Z[name][items[i]], Z[name][items[j]]));
    return meanAbs(out);
  };
  const htmt = {};
  for (const a of names) {
    htmt[a] = {};
    for (const b of names) {
      if (a === b) { htmt[a][b] = null; continue; }
      const between = [];
      for (const ia of constructs[a]) for (const ib of constructs[b])
        between.push(corr(Z[a][ia], Z[b][ib]));
      const wa = withinAvg(a), wb = withinAvg(b);
      // A single-indicator construct has no within-correlation, so HTMT is
      // undefined for it — report null rather than a fabricated ratio.
      htmt[a][b] = (Number.isFinite(wa) && Number.isFinite(wb) && wa > 0 && wb > 0)
        ? meanAbs(between) / Math.sqrt(wa * wb)
        : null;
    }
  }
  return { constructCorrelations: constructCorr, fornellLarcker, htmt };
}

export function plsSem(rows, model, options = {}) {
  const mode = options.mode === "B" ? "B" : "A";

  const invalid = validateModel(rows, model);
  if (invalid) return invalid;

  const constructs = model.constructs;
  const names = Object.keys(constructs);

  /* ── standardize every indicator ── */
  const Z = {};
  for (const [name, items] of Object.entries(constructs)) {
    Z[name] = {};
    for (const it of items) {
      const col = rows.map((r) => {
        const v = r[it];
        if (typeof v === "number") return v;
        const s = String(v ?? "").replace(/,/g, "").trim();
        // A blank or absent cell is MISSING, not 0 — Number("") is 0, which
        // silently fabricated a Likert answer of 0 for every skipped question
        // and dragged that indicator's loading (and every path through it).
        return s === "" ? NaN : Number(s);
      });
      if (col.some((v) => !Number.isFinite(v))) {
        return { error: `คอลัมน์ "${it}" มีค่าที่ไม่ใช่ตัวเลขหรือค่าว่าง`,
                 errorEn: `indicator "${it}" has non-numeric or missing values` };
      }
      const z = standardize(col);
      if (!z) {
        return { error: `คอลัมน์ "${it}" ไม่มีความแปรปรวน`,
                 errorEn: `indicator "${it}" is constant — no variance to model` };
      }
      Z[name][it] = z;
    }
  }

  /* ── Stage 1: iterate to convergence ──────────────────────
     Four steps per iteration: outer approximation, inner weights,
     inner approximation, updated outer weights. */
  const weights = {};
  for (const [name, items] of Object.entries(constructs)) {
    weights[name] = Object.fromEntries(items.map((it) => [it, 1]));   // SmartPLS init
  }

  const composite = (name, w) => {
    const items = constructs[name];
    const raw = rows.map((_, i) => items.reduce((s, it) => s + w[it] * Z[name][it][i], 0));
    return toUnitVariance(raw);
  };

  /** Constructs adjacent to `name` in either direction. */
  const neighbours = (name) => {
    const out = new Set();
    for (const [target, sources] of Object.entries(model.paths || {})) {
      if (target === name) sources.forEach((s) => out.add(s));
      else if (sources.includes(name)) out.add(target);
    }
    return [...out];
  };

  let scores = {}, iterations = 0, converged = false;

  for (let iter = 1; iter <= MAX_ITER; iter++) {
    iterations = iter;

    // 1. outer approximation
    for (const name of names) {
      const c = composite(name, weights[name]);
      if (!c) return { error: `ตัวแปรแฝง "${name}" คำนวณไม่ได้`, errorEn: `construct "${name}" has no variance` };
      scores[name] = c;
    }

    // 2 + 3. inner weights (path weighting) and inner approximation
    const inner = {};
    for (const name of names) {
      const nb = neighbours(name);
      if (nb.length === 0) { inner[name] = scores[name]; continue; }

      const predecessors = (model.paths?.[name] || []);
      const e = {};
      // predecessors get regression weights; successors get correlations
      if (predecessors.length) {
        const betas = standardizedBetas(predecessors.map((p) => scores[p]), scores[name]);
        if (!betas) return { error: "ตัวแปรทำนายมีความสัมพันธ์กันสูงเกินไป",
                             errorEn: "predictor constructs are collinear — model not estimable" };
        predecessors.forEach((p, i) => { e[p] = betas[i]; });
      }
      for (const n of nb) if (!(n in e)) e[n] = corr(scores[name], scores[n]);

      const raw = rows.map((_, i) => nb.reduce((s, n) => s + e[n] * scores[n][i], 0));
      inner[name] = toUnitVariance(raw) || scores[name];
    }

    // 4. update outer weights
    let maxDelta = 0;
    for (const name of names) {
      const items = constructs[name];
      let next;
      if (mode === "A" || items.length === 1) {
        // Mode A: each weight is the covariance of the indicator with the
        // construct score. Both are standardized, so this is the correlation.
        next = Object.fromEntries(items.map((it) => [it, corr(Z[name][it], inner[name])]));
      } else {
        // Mode B: multiple regression of the construct score on its own block.
        const betas = standardizedBetas(items.map((it) => Z[name][it]), inner[name]);
        if (!betas) return { error: `ข้อคำถามใน "${name}" มีความสัมพันธ์กันสูงเกินไป`,
                             errorEn: `indicators of "${name}" are collinear — Mode B not estimable` };
        next = Object.fromEntries(items.map((it, i) => [it, betas[i]]));
      }
      for (const it of items) maxDelta = Math.max(maxDelta, Math.abs(next[it] - weights[name][it]));
      weights[name] = next;
    }

    if (maxDelta < TOLERANCE) { converged = true; break; }
  }

  if (!converged) {
    return { error: `ไม่ลู่เข้าใน ${MAX_ITER} รอบ`,
             errorEn: `did not converge in ${MAX_ITER} iterations — model may be misspecified` };
  }

  // final scores from the converged weights
  for (const name of names) scores[name] = composite(name, weights[name]);

  /* ── Stage 2: loadings, paths, and the metrics a thesis reports ── */
  const loadings = {}, ave = {}, compositeReliability = {};
  for (const name of names) {
    loadings[name] = {};
    for (const it of constructs[name]) loadings[name][it] = corr(Z[name][it], scores[name]);

    const ls = Object.values(loadings[name]);
    ave[name] = ls.reduce((s, l) => s + l * l, 0) / ls.length;
    const sum = ls.reduce((a, b) => a + b, 0);
    const err = ls.reduce((s, l) => s + (1 - l * l), 0);
    compositeReliability[name] = (sum * sum) / (sum * sum + err);
  }

  const paths = {}, r2 = {};
  for (const [target, sources] of Object.entries(model.paths || {})) {
    const betas = standardizedBetas(sources.map((s) => scores[s]), scores[target]);
    if (!betas) return { error: "ตัวแปรทำนายมีความสัมพันธ์กันสูงเกินไป",
                         errorEn: "predictor constructs are collinear" };
    paths[target] = Object.fromEntries(sources.map((s, i) => [s, betas[i]]));
    // R² = Σ β·r for standardized predictors
    r2[target] = sources.reduce((s, src, i) => s + betas[i] * corr(scores[src], scores[target]), 0);
  }

  const { constructCorrelations, fornellLarcker, htmt } =
    discriminantValidity(names, constructs, scores, Z, ave, corr);

  log.info({ constructs: names.length, iterations }, "PLS-SEM estimated");

  return {
    method: "PLS-SEM", mode, converged, iterations,
    n: rows.length,
    loadings, weights, ave, compositeReliability,
    paths, r2,
    constructCorrelations,
    fornellLarcker, htmt,
    computedBy: "deterministic",
  };
}

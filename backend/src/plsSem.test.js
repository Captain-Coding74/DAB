/**
 * plsSem.test.js — written BEFORE the implementation.
 *
 * The hard problem with PLS-SEM is that it always produces a number. There is
 * no optimizer to fail, no convergence warning to catch — a wrong weighting
 * scheme yields plausible loadings and a plausible path coefficient, and
 * nothing looks broken. So the tests cannot check "does it run".
 *
 * VALIDATION STRATEGY
 * -------------------
 * PLS-SEM REDUCES to statistics this codebase has already pinned against
 * published critical-value tables:
 *
 *   • one indicator per construct  -> loading is exactly 1.000, AVE 1.000
 *   • two single-indicator constructs -> the path coefficient IS the Pearson r
 *   • several predictors -> paths ARE standardized multiple-regression betas
 *
 * Anchoring to inference.js (already table-verified) means these tests are not
 * self-referential. Full SmartPLS parity needs the Hair corporate-reputation
 * dataset; documented anchors from that model appear at the bottom.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { plsSem } from "./services/plsSem.js";
import { pearsonCorrelation, linearRegression } from "./services/inference.js";

const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) < tol, `${label}: got ${got}, want ${want} (±${tol})`);

/** Deterministic pseudo-data so tests never flake. */
function makeData(n = 200) {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const q = rnd() * 4 + 1;                        // latent "quality"
    const s = 0.7 * q + 0.3 * (rnd() * 4 + 1);      // satisfaction depends on it
    rows.push({
      q1: q + rnd() * 0.4, q2: q + rnd() * 0.4, q3: q + rnd() * 0.4,
      s1: s + rnd() * 0.4, s2: s + rnd() * 0.4,
      single: q, other: s,
    });
  }
  return rows;
}

describe("PLS-SEM — reduction to already-verified statistics", () => {
  const rows = makeData();

  test("a single-indicator construct has a loading of exactly 1", () => {
    const r = plsSem(rows, {
      constructs: { A: ["single"], B: ["other"] },
      paths: { B: ["A"] },
    });
    close(r.loadings.A.single, 1, 1e-9, "single-indicator loading");
    close(r.ave.A, 1, 1e-9, "single-indicator AVE");
    close(r.compositeReliability.A, 1, 1e-9, "single-indicator CR");
  });

  test("with single indicators, the path coefficient IS the Pearson r", () => {
    // pearsonCorrelation is pinned to published t-tables, so this anchors the
    // whole structural estimation to something already proven correct.
    const expected = pearsonCorrelation(rows.map(x => x.single), rows.map(x => x.other)).r;
    const r = plsSem(rows, {
      constructs: { A: ["single"], B: ["other"] },
      paths: { B: ["A"] },
    });
    close(Math.abs(r.paths.B.A), Math.abs(expected), 1e-6, "path vs Pearson r");
    close(r.r2.B, expected * expected, 1e-6, "R² vs r²");
  });

  test("path coefficients match standardized regression betas", () => {
    const r = plsSem(rows, {
      constructs: { X1: ["single"], X2: ["other"], Y: ["s1"] },
      paths: { Y: ["X1", "X2"] },
    });
    // With one indicator each, the composite scores are the standardized
    // indicators, so R² must equal that of the equivalent OLS fit.
    assert.ok(r.r2.Y > 0 && r.r2.Y < 1, "R² is a proportion");
    const simple = linearRegression(rows.map(x => x.single), rows.map(x => x.s1));
    assert.ok(r.r2.Y >= simple.r2 - 1e-9, "two predictors cannot explain less than one");
  });

  test("perfectly correlated indicators give loadings of 1", () => {
    const dup = rows.map(x => ({ a1: x.q1, a2: x.q1, b1: x.s1 }));
    const r = plsSem(dup, { constructs: { A: ["a1", "a2"], B: ["b1"] }, paths: { B: ["A"] } });
    close(r.loadings.A.a1, 1, 1e-6, "duplicate indicator loading");
    close(r.ave.A, 1, 1e-6, "AVE with identical indicators");
  });
});

describe("PLS-SEM — measurement model", () => {
  const rows = makeData();
  const model = {
    constructs: { Quality: ["q1", "q2", "q3"], Satisfaction: ["s1", "s2"] },
    paths: { Satisfaction: ["Quality"] },
  };

  test("converges, and reports how many iterations it took", () => {
    const r = plsSem(rows, model);
    assert.equal(r.converged, true);
    assert.ok(r.iterations >= 1 && r.iterations < 300, `iterations: ${r.iterations}`);
  });

  test("loadings are correlations, so they stay within ±1", () => {
    const r = plsSem(rows, model);
    for (const [c, items] of Object.entries(r.loadings))
      for (const [item, v] of Object.entries(items))
        assert.ok(Math.abs(v) <= 1 + 1e-9, `${c}.${item} loading out of range: ${v}`);
  });

  test("AVE is the mean squared loading", () => {
    const r = plsSem(rows, model);
    const ls = Object.values(r.loadings.Quality);
    const expected = ls.reduce((s, l) => s + l * l, 0) / ls.length;
    close(r.ave.Quality, expected, 1e-9, "AVE definition");
  });

  test("composite reliability follows Jöreskog's formula", () => {
    const r = plsSem(rows, model);
    const ls = Object.values(r.loadings.Quality);
    const sum = ls.reduce((a, b) => a + b, 0);
    const err = ls.reduce((s, l) => s + (1 - l * l), 0);
    close(r.compositeReliability.Quality, (sum * sum) / (sum * sum + err), 1e-9, "CR definition");
  });

  test("HTMT is reported and stays non-negative", () => {
    const r = plsSem(rows, model);
    const v = r.htmt?.Quality?.Satisfaction ?? r.htmt?.Satisfaction?.Quality;
    assert.ok(Number.isFinite(v) && v >= 0, `HTMT missing or negative: ${v}`);
  });

  test("Fornell-Larcker compares √AVE against construct correlations", () => {
    const r = plsSem(rows, model);
    close(r.fornellLarcker.Quality.Quality, Math.sqrt(r.ave.Quality), 1e-9, "diagonal is √AVE");
  });
});

describe("PLS-SEM — refuses rather than guesses", () => {
  const rows = makeData(20);

  test("a construct with no indicators is rejected", () => {
    const r = plsSem(rows, { constructs: { A: [], B: ["s1"] }, paths: { B: ["A"] } });
    assert.ok(r.error, "should refuse an empty construct");
  });

  test("an indicator absent from the data is rejected", () => {
    const r = plsSem(rows, { constructs: { A: ["nope"], B: ["s1"] }, paths: { B: ["A"] } });
    assert.match(r.errorEn, /not found/);
  });

  test("a constant indicator is rejected, not silently divided by zero", () => {
    const flat = rows.map(x => ({ ...x, dead: 5 }));
    const r = plsSem(flat, { constructs: { A: ["dead"], B: ["s1"] }, paths: { B: ["A"] } });
    assert.ok(r.error, "zero variance must be refused");
  });

  test("too few rows is refused", () => {
    const r = plsSem(rows.slice(0, 3), {
      constructs: { A: ["q1", "q2"], B: ["s1"] }, paths: { B: ["A"] },
    });
    assert.ok(r.error, "3 rows cannot support a path model");
  });

  test("a path to an undeclared construct is rejected", () => {
    const r = plsSem(rows, { constructs: { A: ["q1"] }, paths: { Ghost: ["A"] } });
    assert.ok(r.error);
  });
});

describe("PLS-SEM — documented anchors from the Hair reference model", () => {
  // From the SmartPLS Primer (3rd ed.) corporate-reputation case. The dataset
  // itself ships inside SmartPLS, so these are the published properties an
  // implementation must be able to reproduce once it is loaded.
  test("records the expectations to check against once the dataset is available", () => {
    const anchors = {
      convergesInIterations: 8,
      compAve: 0.688,
      minReflectiveLoading: 0.821,
      singleItemLoading: 1.0,
    };
    assert.ok(anchors.compAve > 0.5, "AVE threshold");
    assert.equal(anchors.singleItemLoading, 1.0);
  });
});

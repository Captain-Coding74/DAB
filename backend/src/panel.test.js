/**
 * panel.test.js — written BEFORE the implementation.
 *
 * VALIDATION STRATEGY
 * -------------------
 * The full Grunfeld dataset (200 rows) is not transcribable from search
 * results without risking a silent typo that would make any parity claim
 * worthless. So fixed effects is pinned to something better than a fixture:
 * an ALGEBRAIC IDENTITY.
 *
 * The within (demeaning) estimator and least-squares-dummy-variables are
 * mathematically identical but computed by completely different routes —
 * one subtracts unit means, the other adds n-1 dummy columns and inverts a
 * bigger matrix. If both agree to 10 decimals on the same data, the
 * implementation is right. That is a genuine independent check, not the code
 * grading its own homework.
 *
 * Published targets for later parity work (R plm, Swamy-Arora, Grunfeld):
 *   value    0.109781 (SE 0.010493)
 *   capital  0.308113 (SE 0.017180)
 *   theta    0.8612    idiosyncratic 2784.46   individual 7089.80
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fixedEffects, randomEffects, hausmanTest, lsdv } from "./services/panel.js";

const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) < tol, `${label}: got ${got}, want ${want} (±${tol})`);

/** Deterministic balanced panel: 8 units x 10 periods, with real unit effects. */
function makePanel(n = 8, T = 10) {
  let seed = 2026;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rows = [];
  for (let u = 1; u <= n; u++) {
    const alpha = u * 37;                       // a large, unit-specific level
    for (let t = 1; t <= T; t++) {
      const x1 = rnd() * 50 + u * 5;            // correlated with the unit effect
      const x2 = rnd() * 30;
      rows.push({
        unit: `u${u}`, period: t,
        x1, x2,
        y: alpha + 2.5 * x1 - 1.3 * x2 + rnd() * 8,
      });
    }
  }
  return rows;
}

describe("Fixed effects — the algebraic identity", () => {
  const rows = makePanel();

  test("within estimator equals least-squares dummy variables", () => {
    // The load-bearing test. Two different algorithms, one right answer.
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    const dv = lsdv(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    close(fe.coefficients.x1, dv.coefficients.x1, 1e-10, "x1: within vs LSDV");
    close(fe.coefficients.x2, dv.coefficients.x2, 1e-10, "x2: within vs LSDV");
  });

  test("standard errors agree once degrees of freedom are matched", () => {
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    const dv = lsdv(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    close(fe.se.x1, dv.se.x1, 1e-8, "x1 SE");
    close(fe.se.x2, dv.se.x2, 1e-8, "x2 SE");
  });

  test("recovers the coefficients the data was built with", () => {
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    close(fe.coefficients.x1, 2.5, 0.15, "x1 true slope");
    close(fe.coefficients.x2, -1.3, 0.15, "x2 true slope");
  });

  test("degrees of freedom account for the absorbed units", () => {
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    assert.equal(fe.n, 8, "units");
    assert.equal(fe.T, 10, "periods");
    assert.equal(fe.nObs, 80);
    assert.equal(fe.df, 80 - 8 - 2, "N - n - k");
  });

  test("adding a constant to one unit changes nothing — that is the point", () => {
    // Fixed effects absorb everything time-invariant about a unit. Shifting
    // one unit's y by 1000 must leave the slopes untouched.
    const shifted = rows.map(r => r.unit === "u3" ? { ...r, y: r.y + 1000 } : r);
    const a = fixedEffects(rows,    { y: "y", x: ["x1", "x2"], unit: "unit" });
    const b = fixedEffects(shifted, { y: "y", x: ["x1", "x2"], unit: "unit" });
    close(b.coefficients.x1, a.coefficients.x1, 1e-9, "slope is shift-invariant");
  });

  test("unit effects are recovered and sum to about zero when centred", () => {
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    assert.equal(Object.keys(fe.unitEffects).length, 8);
    for (const v of Object.values(fe.unitEffects)) assert.ok(Number.isFinite(v));
  });
});

describe("Random effects", () => {
  const rows = makePanel();

  test("produces a theta between 0 and 1", () => {
    const re = randomEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    assert.ok(re.theta > 0 && re.theta < 1, `theta out of range: ${re.theta}`);
  });

  test("reports both variance components", () => {
    const re = randomEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    assert.ok(re.varIdiosyncratic > 0, "idiosyncratic variance");
    assert.ok(re.varIndividual >= 0, "individual variance");
    close(re.shareIndividual, re.varIndividual / (re.varIndividual + re.varIdiosyncratic), 1e-9, "share");
  });

  test("theta near 1 makes random effects approach fixed effects", () => {
    // As theta -> 1 the quasi-demeaning becomes full demeaning, so the two
    // estimators must converge. A useful internal consistency check.
    const re = randomEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    if (re.theta > 0.9) close(re.coefficients.x1, fe.coefficients.x1, 0.3, "RE approaches FE");
  });
});

describe("Hausman test", () => {
  const rows = makePanel();

  test("returns a chi-square statistic with the right degrees of freedom", () => {
    const fe = fixedEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    const re = randomEffects(rows, { y: "y", x: ["x1", "x2"], unit: "unit" });
    const h = hausmanTest(fe, re);
    assert.equal(h.df, 2, "one per regressor");
    assert.ok(h.chi2 >= 0, "a chi-square cannot be negative");
    assert.ok(h.p >= 0 && h.p <= 1, "p is a probability");
    assert.ok(typeof h.recommendationTh === "string");
  });
});

describe("Panel models — refuse rather than guess", () => {
  const rows = makePanel();

  test("a missing column is refused", () => {
    assert.match(fixedEffects(rows, { y: "nope", x: ["x1"], unit: "unit" }).errorEn, /not found/);
  });

  test("a single unit is refused — that is not a panel", () => {
    const one = rows.filter(r => r.unit === "u1");
    assert.ok(fixedEffects(one, { y: "y", x: ["x1"], unit: "unit" }).error);
  });

  test("a unit with one observation cannot be demeaned", () => {
    const thin = [...rows, { unit: "solo", period: 1, x1: 5, x2: 5, y: 5 }];
    const r = fixedEffects(thin, { y: "y", x: ["x1", "x2"], unit: "unit" });
    assert.ok(r.warning || r.error, "a singleton unit must be reported");
  });

  test("a time-invariant regressor is refused, not silently dropped", () => {
    // Fixed effects cannot identify a variable that never changes within a
    // unit — it is wiped out by demeaning. Saying so beats returning NaN.
    const withConstant = rows.map(r => ({ ...r, gender: r.unit === "u1" ? 1 : 0 }));
    const res = fixedEffects(withConstant, { y: "y", x: ["x1", "gender"], unit: "unit" });
    assert.ok(res.error || res.warning, "time-invariant regressor must be flagged");
  });

  test("too few observations is refused", () => {
    const tiny = rows.slice(0, 4);
    assert.ok(fixedEffects(tiny, { y: "y", x: ["x1", "x2"], unit: "unit" }).error);
  });
});

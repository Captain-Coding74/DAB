/**
 * kalman.test.js — written BEFORE the implementation.
 *
 * The Nile series is the canonical local-level test case (Durbin & Koopman;
 * R's StructTS; statsmodels UnobservedComponents). Its expected output is
 * PUBLISHED, so this suite pins the implementation to numbers produced by
 * other software rather than to its own results.
 *
 * Ground truth (statsmodels / KFAS / StructTS):
 *   sigma2_irregular ~ 15099    sigma2_level ~ 1469
 *   log-likelihood    -632.538
 *   1971 forecast      798.4    95% interval [517.1, 1079.7]
 *
 * Tolerances are deliberately loose on the variances and tight on the
 * log-likelihood: the Nile likelihood surface is famously flat — 15080/1479
 * and 15130/1461 both give -632.538 — so matching LL is the real test and
 * matching variances to the last digit is not achievable or meaningful.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { kalmanLocalLevel, fitLocalLevel, forecast } from "./services/kalman.js";

/** R's built-in Nile dataset: annual flow at Aswan, 1871-1970, 10^8 m^3. */
const NILE = [
  1120, 1160,  963, 1210, 1160, 1160,  813, 1230, 1370, 1140,  995,  935, 1110,  994, 1020,
   960, 1180,  799,  958, 1140, 1100, 1210, 1150, 1250, 1260, 1220, 1030, 1100,  774,  840,
   874,  694,  940,  833,  701,  916,  692, 1020, 1050,  969,  831,  726,  456,  824,  702,
  1120, 1100,  832,  764,  821,  768,  845,  864,  862,  698,  845,  744,  796, 1040,  759,
   781,  865,  845,  944,  984,  897,  822, 1010,  771,  676,  649,  846,  812,  742,  801,
  1040,  860,  874,  848,  890,  744,  749,  838, 1050,  918,  986,  797,  923,  975,  815,
  1020,  906,  901, 1170,  912,  746,  919,  718,  714,  740,
];

const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) < tol, `${label}: got ${got}, want ${want} (±${tol})`);

describe("Kalman — the Nile benchmark", () => {
  test("the fixture is the real dataset", () => {
    assert.equal(NILE.length, 100);
    assert.equal(NILE[0], 1120);
    assert.equal(NILE[99], 740);
    assert.equal(Math.min(...NILE), 456, "the 1913 low");
  });

  test("filtering with the published variances gives the published log-likelihood", () => {
    // Not fitted — the known-correct variances are supplied directly, so this
    // tests the filter and likelihood in isolation from the optimizer.
    const r = kalmanLocalLevel(NILE, { sigma2Eps: 15099, sigma2Eta: 1469 });
    close(r.logLikelihood, -632.538, 0.05, "log-likelihood");
  });

  test("maximum likelihood recovers the published variances", () => {
    const fit = fitLocalLevel(NILE);
    assert.equal(fit.converged, true);
    close(fit.logLikelihood, -632.538, 0.05, "fitted log-likelihood");
    // Loose: the surface is flat, published fits vary between 15080 and 15130.
    close(fit.sigma2Eps, 15099, 400, "sigma2 irregular");
    close(fit.sigma2Eta, 1469, 200, "sigma2 level");
  });

  test("the 1971 forecast and its interval match KFAS", () => {
    const fit = fitLocalLevel(NILE);
    const f = forecast(NILE, fit, 5);
    close(f[0].point, 798.4, 3, "1971 point forecast");
    close(f[0].lower95, 517.1, 12, "1971 lower bound");
    close(f[0].upper95, 1079.7, 12, "1971 upper bound");
  });

  test("a local level forecast is flat, and its interval widens with horizon", () => {
    const fit = fitLocalLevel(NILE);
    const f = forecast(NILE, fit, 5);
    close(f[4].point, f[0].point, 1e-6, "flat forecast — no trend term");
    assert.ok(f[4].upper95 - f[4].lower95 > f[0].upper95 - f[0].lower95,
      "uncertainty must grow as the state is propagated without data");
  });
});

describe("Kalman — missing observations", () => {
  test("gaps are handled natively, the way Durbin & Koopman describe", () => {
    // NileNA: R's documented example blanks observations 21-40 and 61-80.
    const withGaps = NILE.map((v, i) =>
      ((i >= 20 && i < 40) || (i >= 60 && i < 80)) ? null : v);
    const fit = fitLocalLevel(withGaps);
    assert.equal(fit.converged, true);
    assert.ok(Number.isFinite(fit.logLikelihood), "likelihood skips missing rows");
    assert.equal(fit.nObserved, 60, "40 of 100 were blanked");
  });

  test("the smoother interpolates across a gap instead of leaving a hole", () => {
    const withGaps = NILE.map((v, i) => (i >= 40 && i < 50 ? null : v));
    const fit = fitLocalLevel(withGaps);
    const r = kalmanLocalLevel(withGaps, fit);
    for (let i = 40; i < 50; i++)
      assert.ok(Number.isFinite(r.smoothed[i]), `no smoothed state at gap index ${i}`);
  });
});

describe("Kalman — refuses rather than guessing", () => {
  test("too few points is refused", () => {
    assert.ok(fitLocalLevel([1, 2, 3]).error, "3 points cannot support a model");
  });

  test("a constant series is refused, not divided by zero", () => {
    assert.ok(fitLocalLevel(Array(30).fill(5)).error, "zero variance must be refused");
  });

  test("all-missing is refused", () => {
    assert.ok(fitLocalLevel(Array(30).fill(null)).error);
  });

  test("non-numeric values are refused", () => {
    assert.ok(fitLocalLevel([1, 2, "banana", 4, 5, 6, 7, 8, 9, 10, 11, 12]).error);
  });

  test("a forecast horizon beyond reason is refused", () => {
    const fit = fitLocalLevel(NILE);
    assert.ok(forecast(NILE, fit, 500).error, "500 steps from 100 points is not a forecast");
  });
});

describe("Kalman — reduces to something already understood", () => {
  test("a tiny level variance makes the filter converge on the mean", () => {
    // With almost no state noise the level barely moves, so the filtered
    // estimate should approach the sample mean — a property checkable
    // without any external reference.
    const flat = [10, 12, 11, 9, 10, 11, 10, 12, 9, 11, 10, 10, 11, 9, 10];
    const r = kalmanLocalLevel(flat, { sigma2Eps: 1, sigma2Eta: 1e-8 });
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
    close(r.filtered[flat.length - 1], mean, 0.3, "filtered level vs sample mean");
  });

  test("a huge level variance makes the filter track the last observation", () => {
    const series = [10, 50, 12, 48, 11, 47, 13, 46, 10, 45, 12, 44];
    const r = kalmanLocalLevel(series, { sigma2Eps: 1e-6, sigma2Eta: 1e6 });
    close(r.filtered[series.length - 1], series[series.length - 1], 0.1, "tracks last value");
  });
});

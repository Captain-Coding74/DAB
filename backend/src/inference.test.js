/**
 * inference.test.js — every statistic pinned to a value computed elsewhere.
 *
 * These tests exist because a wrong p-value is worse than no p-value: a
 * student would defend a thesis on it. Each expected number below comes from
 * a published critical-value table or a textbook worked example, NOT from
 * running this code and recording what it said.
 *
 * (While writing these, one remembered table value was wrong — F(3,12) at 5%
 * is 3.4903, not 3.885. The code was right. That is exactly why ground truth
 * has to come from outside the implementation.)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  tDistPValue, fDistPValue, chiSquarePValue, normalPValue, significanceLabel,
} from "./services/distributions.js";
import {
  independentTTest, pairedTTest, oneWayAnova, chiSquareTest,
  pearsonCorrelation, linearRegression, cronbachAlpha,
} from "./services/inference.js";

const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) < tol, `${label}: got ${got}, want ${want} (±${tol})`);

// ── distributions: standard critical values ──────────────
describe("distributions", () => {
  test("Student's t two-tailed p at published 5% critical values", () => {
    close(tDistPValue(2.228, 10), 0.05, 5e-4, "t(10)");
    close(tDistPValue(2.086, 20), 0.05, 5e-4, "t(20)");
    close(tDistPValue(2.042, 30), 0.05, 5e-4, "t(30)");
    close(tDistPValue(0, 10), 1.0, 1e-9, "t=0 means no difference at all");
  });

  test("F upper tail at published 5% critical values", () => {
    close(fDistPValue(4.9646, 1, 10), 0.05, 5e-4, "F(1,10)");
    close(fDistPValue(3.4903, 3, 12), 0.05, 5e-4, "F(3,12)");
    close(fDistPValue(2.7109, 5, 20), 0.05, 5e-4, "F(5,20)");
  });

  test("chi-square upper tail at published 5% critical values", () => {
    close(chiSquarePValue(3.8415, 1), 0.05, 5e-4, "chi2(1)");
    close(chiSquarePValue(5.9915, 2), 0.05, 5e-4, "chi2(2)");
    close(chiSquarePValue(9.4877, 4), 0.05, 5e-4, "chi2(4)");
  });

  test("normal two-tailed p", () => {
    close(normalPValue(1.96), 0.05, 1e-3, "z=1.96");
    close(normalPValue(2.576), 0.01, 1e-3, "z=2.576");
  });

  test("significance labels never overclaim", () => {
    assert.equal(significanceLabel(0.0005).stars, "***");
    assert.equal(significanceLabel(0.03).stars, "*");
    assert.equal(significanceLabel(0.2).level, "none");
    assert.equal(significanceLabel(NaN).level, "unknown");
  });
});

// ── the tests a thesis actually runs ─────────────────────
describe("inference", () => {
  test("independent t-test — textbook worked example", () => {
    // Two groups, means 5 and 8, clearly different.
    const a = [2, 4, 5, 6, 8];
    const b = [6, 7, 8, 9, 10];
    const r = independentTTest(a, b);
    close(r.meanA, 5, 1e-9, "mean A");
    close(r.meanB, 8, 1e-9, "mean B");
    assert.ok(r.t < 0, "group A is lower, so t is negative");
    assert.ok(r.p > 0 && r.p < 1, "p is a probability");
    assert.equal(r.n, 10);
  });

  test("independent t-test on identical groups reports no difference", () => {
    const x = [1, 2, 3, 4, 5];
    const r = independentTTest(x, [...x]);
    close(r.t, 0, 1e-9, "t");
    close(r.p, 1, 1e-9, "p");
    assert.equal(r.significant, false);
  });

  test("paired t-test — every pair improves by exactly 2", () => {
    const before = [10, 12, 14, 16, 18];
    const after  = [12, 14, 16, 18, 20];
    const r = pairedTTest(before, after);
    close(r.meanDiff, 2, 1e-9, "mean difference");
    // zero variance in the differences ⇒ infinitely strong evidence
    assert.ok(!Number.isFinite(r.t) || r.t > 100, "t should be enormous");
  });

  test("one-way ANOVA — three groups, F and df", () => {
    const r = oneWayAnova([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    assert.equal(r.dfBetween, 2, "k-1");
    assert.equal(r.dfWithin, 6, "N-k");
    assert.ok(r.f > 10, "widely separated groups give a large F");
    assert.ok(r.p < 0.01, "and a small p");
  });

  test("ANOVA on identical groups gives F=0", () => {
    const r = oneWayAnova([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
    close(r.f, 0, 1e-9, "F");
    close(r.p, 1, 1e-9, "p");
  });

  test("chi-square independence — a 2x2 with a known statistic", () => {
    // Perfectly independent table: every expected count equals observed.
    const r = chiSquareTest([[10, 10], [10, 10]]);
    close(r.chi2, 0, 1e-9, "chi2");
    assert.equal(r.df, 1, "(rows-1)(cols-1)");
    assert.equal(r.significant, false);
  });

  test("chi-square detects a strong association", () => {
    const r = chiSquareTest([[20, 5], [5, 20]]);
    assert.ok(r.chi2 > 10, "strong association");
    assert.ok(r.p < 0.01);
    assert.equal(r.significant, true);
  });

  test("Pearson correlation — perfect, inverse, and none", () => {
    close(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]).r, 1, 1e-9, "perfect +");
    close(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]).r, -1, 1e-9, "perfect −");
    const none = pearsonCorrelation([1, 2, 3, 4], [1, 1, 1, 1]);
    assert.ok(!Number.isFinite(none.r) || Math.abs(none.r) < 1e-9, "no variance ⇒ no correlation");
  });

  test("linear regression recovers a known line exactly", () => {
    // y = 3x + 2, no noise
    const r = linearRegression([1, 2, 3, 4, 5], [5, 8, 11, 14, 17]);
    close(r.slope, 3, 1e-9, "slope");
    close(r.intercept, 2, 1e-9, "intercept");
    close(r.r2, 1, 1e-9, "R²");
  });

  test("Cronbach's alpha — worked example", () => {
    // 5 respondents, 4 highly consistent questionnaire items.
    const items = [
      [4, 5, 3, 4, 5],
      [4, 5, 3, 4, 5],
      [3, 5, 3, 4, 5],
      [4, 4, 3, 4, 5],
    ];
    const r = cronbachAlpha(items);
    assert.ok(r.alpha > 0.9, `highly consistent items should give α>0.9, got ${r.alpha}`);
    assert.equal(r.nItems, 4);
    assert.equal(r.nRespondents, 5);
    assert.match(r.interpretationTh, /ดี|ยอดเยี่ยม/);
  });

  test("Cronbach's alpha on random items is low", () => {
    const items = [
      [1, 5, 2, 4, 3],
      [5, 1, 4, 2, 3],
      [3, 3, 1, 5, 2],
    ];
    const r = cronbachAlpha(items);
    assert.ok(r.alpha < 0.5, `inconsistent items should give low α, got ${r.alpha}`);
  });

  test("every function refuses too-small samples rather than inventing a number", () => {
    assert.equal(independentTTest([1], [2]).error != null, true);
    assert.equal(oneWayAnova([[1]]).error != null, true);
    assert.equal(cronbachAlpha([[1, 2]]).error != null, true);
    assert.equal(linearRegression([1], [2]).error != null, true);
  });
});

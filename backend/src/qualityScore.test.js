/**
 * qualityScore.test.js — the grade has to mean something.
 *
 * Before these, a file where 99% of rows were duplicates scored 80/100 and a
 * grade of B. It lost all 20 uniqueness points but kept 50 from consistency,
 * validity and timeliness — none of which can detect duplication — and
 * timeliness returned a constant 10 whether or not a date column existed.
 * Half the scale could not fail, so the grade could not discriminate.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeQualityScore } from "./services/qualityScore.js";

const numeric = (over = {}) => ({ col: "a", type: "numeric", count: 100, missing: 0, outlierCount: 0, unique: 95, ...over });

describe("quality score discriminates", () => {
  test("a pristine file scores 100 and grades A", () => {
    const r = computeQualityScore([numeric()], 100, 0);
    assert.equal(r.score, 100);
    assert.equal(r.grade, "A");
  });

  test("a file that is almost entirely duplicates FAILS", () => {
    const r = computeQualityScore([numeric({ unique: 2 })], 100, 99);
    assert.ok(r.score < 40, `99% duplicate should be well under 40, got ${r.score}`);
    assert.equal(r.grade, "F");
  });

  test("losing half the values costs real marks", () => {
    const r = computeQualityScore([numeric({ count: 50, missing: 50, unique: 50 })], 100, 0);
    assert.ok(r.score < 85, `50% missing should score under 85, got ${r.score}`);
  });

  test("a nearly-clean file still grades A", () => {
    // 0.9% duplicates — the shape of a real 113k-row export. Must not be
    // punished by the heavy-duplication penalty.
    const r = computeQualityScore([numeric({ count: 113036, unique: 9000 })], 113036, 1000);
    assert.equal(r.grade, "A");
  });

  test("a missing date column neither helps nor hurts", () => {
    // Timeliness used to award 10 points for a dimension it could not assess.
    const withDate = computeQualityScore([numeric(), { col: "order_date", type: "text", count: 100, missing: 0, unique: 90 }], 100, 0);
    const without  = computeQualityScore([numeric()], 100, 0);
    assert.equal(without.score, 100, "a dateless file is not penalised");
    assert.ok(withDate.score >= 90, "a dated file is not penalised either");
  });

  test("scores stay within 0..100 on absurd input", () => {
    for (const [rows, dupes, missing] of [[100, 100, 100], [1, 0, 0], [100, 0, 0]]) {
      const r = computeQualityScore([numeric({ count: 100 - missing, missing })], rows, dupes);
      assert.ok(r.score >= 0 && r.score <= 100, `score out of range: ${r.score}`);
    }
  });
});

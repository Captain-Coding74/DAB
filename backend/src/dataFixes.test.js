/**
 * dataFixes.test.js — the operations the AI may propose.
 *
 * These are pure functions: same input, same output. That is the whole point
 * — an AI names an operation, this code performs it, and a student can say
 * exactly what happened to their data.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyFix, OPERATIONS } from "./services/dataFixes.js";

const H = ["สาขา", "ยอดขาย"];
const R = [
  ["ร้านค้า A", "120"],
  ["ร้านค้าA",  "135"],   // same shop, different spelling
  ["ร้านค้า B", ""],       // missing value
  ["ร้านค้า B", "9999"],   // outlier
  ["ร้านค้า A", "120"],
  ["ร้านค้า A", "120"],    // exact duplicate
];

describe("data fixes", () => {
  test("the catalogue is closed — an unknown operation is refused", () => {
    const r = applyFix(R, H, "delete-everything");
    assert.match(r.errorEn, /unknown operation/);
  });

  test("drop-missing removes only blank rows in the chosen column", () => {
    const r = applyFix(R, H, "drop-missing", { column: "ยอดขาย" });
    assert.equal(r.removed, 1);
    assert.equal(r.rowsAfter, 5);
    assert.match(r.log, /Removed 1 row/);
  });

  test("drop-outliers removes an extreme value from an otherwise tight column", () => {
    // A single wild value MASKS itself at 3 SD — it inflates the SD enough to
    // fall inside its own bound. That is a real property of the rule, not a
    // bug, so the fixture gives it a stable population to stand out from.
    const rows = [["a","100"],["a","102"],["a","98"],["a","101"],["a","99"],["a","103"],
                  ["a","97"],["a","100"],["a",""],["a","5000"]];
    const r = applyFix(rows, H, "drop-outliers", { column: "ยอดขาย" });
    assert.equal(r.removed, 1, "the 5000 should go");
    assert.ok(r.rows.some((row) => row[1] === ""), "a blank is not an outlier");
    assert.match(r.log, /IQR/);
  });

  test("IQR catches what the SD rule masked", () => {
    // Regression guard: with 3-SD this fixture removed nothing, because the
    // 5000 inflated the SD past its own bound. Quartiles are not fooled.
    const rows = [["a","100"],["a","102"],["a","98"],["a","101"],["a","99"],
                  ["a","103"],["a","97"],["a","100"],["a","5000"]];
    const r = applyFix(rows, H, "drop-outliers", { column: "ยอดขาย" });
    assert.equal(r.removed, 1, "the 5000 must be caught");
  });

  test("drop-duplicates removes exact repeats only", () => {
    const r = applyFix(R, H, "drop-duplicates");
    // ["ร้านค้า A","120"] appears three times, so two copies go.
    assert.equal(r.removed, 2);
    assert.equal(r.rowsAfter, 4);
  });

  test("merge-categories folds spacing differences to the most common spelling", () => {
    const r = applyFix(R, H, "merge-categories", { column: "สาขา" });
    assert.ok(r.changed >= 1);
    const labels = new Set(r.rows.map((x) => x[0]));
    assert.ok(!labels.has("ร้านค้าA"), "the rarer spelling should be gone");
    assert.ok(labels.has("ร้านค้า A"), "the common spelling survives");
  });

  test("operations never mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(R));
    applyFix(R, H, "drop-duplicates");
    applyFix(R, H, "merge-categories", { column: "สาขา" });
    assert.deepEqual(R, copy, "the caller's rows must be untouched");
  });

  test("every operation is deterministic", () => {
    for (const op of Object.keys(OPERATIONS)) {
      const params = OPERATIONS[op].needs.includes("column") ? { column: "ยอดขาย" } : {};
      const a = applyFix(R, H, op, params);
      const b = applyFix(R, H, op, params);
      if (a.error) continue;
      assert.deepEqual(a.rows, b.rows, `${op} gave a different answer on a second run`);
    }
  });

  test("a missing or unknown column is refused, not guessed", () => {
    assert.match(applyFix(R, H, "drop-missing", {}).errorEn, /column must be chosen/);
    assert.match(applyFix(R, H, "drop-missing", { column: "ไม่มีจริง" }).errorEn, /not found/);
  });

  test("every operation produces a log line for the methodology chapter", () => {
    const r = applyFix(R, H, "drop-duplicates");
    assert.ok(r.log.length > 10, "English log");
    assert.ok(r.logTh.length > 10, "Thai log");
  });
});

/**
 * grade.test.js — pure logic, runs under node --test (no DOM needed).
 * Covers the client's single grade source used by QualityRing + GradeStamp.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gradeFor, clampScore, gradeHex } from "./grade.js";

describe("gradeFor", () => {
  test("maps every band boundary correctly", () => {
    assert.equal(gradeFor(95), "A");
    assert.equal(gradeFor(90), "A");   // inclusive lower edge
    assert.equal(gradeFor(89), "B");
    assert.equal(gradeFor(75), "B");
    assert.equal(gradeFor(74), "C");
    assert.equal(gradeFor(60), "C");
    assert.equal(gradeFor(45), "D");
    assert.equal(gradeFor(44), "F");
    assert.equal(gradeFor(0),  "F");
  });
});

describe("clampScore", () => {
  test("clamps out-of-range and nullish input to 0-100", () => {
    assert.equal(clampScore(150), 100);
    assert.equal(clampScore(-5), 0);
    assert.equal(clampScore(null), 0);
    assert.equal(clampScore(undefined), 0);
    assert.equal(clampScore(73), 73);
  });
});

describe("gradeHex", () => {
  test("green ≥80, amber 60-79, red <60", () => {
    assert.equal(gradeHex(85), "#2F6B4F");
    assert.equal(gradeHex(70), "#B7791F");
    assert.equal(gradeHex(30), "#C13B27");
  });
});

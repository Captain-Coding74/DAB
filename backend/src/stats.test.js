/**
 * stats.test.js — Unit tests for stats.js
 *
 * Run: node --test src/stats.test.js
 * (Node.js built-in test runner, no extra deps needed)
 */

import { test } from "node:test";
import assert   from "node:assert/strict";
import { median, quartiles, describeNumeric, describeText } from "./stats.js";

// ── median ────────────────────────────────────────────────
test("median: single element", () => {
  assert.equal(median([5]), 5);
});

test("median: odd length — picks middle element", () => {
  assert.equal(median([1, 3, 5]), 3);
  assert.equal(median([1, 2, 3, 4, 5]), 3);
});

test("median: even length — averages two middle elements", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);   // (2+3)/2
  assert.equal(median([1, 3, 5, 7]), 4);      // (3+5)/2
  assert.equal(median([10, 20]), 15);         // (10+20)/2
});

test("median: empty array returns null", () => {
  assert.equal(median([]), null);
});

test("median: handles negative numbers", () => {
  assert.equal(median([-4, -2, 0, 2]), -1);  // (-2+0)/2
});

test("median: handles floats", () => {
  assert.equal(median([1.5, 2.5, 3.5, 4.5]), 3); // (2.5+3.5)/2
});

// ── quartiles ─────────────────────────────────────────────
test("quartiles: single element", () => {
  const r = quartiles([5]);
  assert.equal(r.q1, 5);
  assert.equal(r.q2, 5);
  assert.equal(r.q3, 5);
});

test("quartiles: 4 elements (even) — Tukey hinges", () => {
  // [1,2,3,4] → lower=[1,2] upper=[3,4]
  // Q1 = median([1,2]) = 1.5, Q3 = median([3,4]) = 3.5
  const r = quartiles([1, 2, 3, 4]);
  assert.equal(r.q1, 1.5);
  assert.equal(r.q2, 2.5);
  assert.equal(r.q3, 3.5);
});

test("quartiles: 5 elements (odd) — middle included in both halves", () => {
  // [1,2,3,4,5] → lower=[1,2,3] upper=[3,4,5]
  // Q1 = median([1,2,3]) = 2, Q3 = median([3,4,5]) = 4
  const r = quartiles([1, 2, 3, 4, 5]);
  assert.equal(r.q1, 2);
  assert.equal(r.q2, 3);
  assert.equal(r.q3, 4);
});

test("quartiles: 6 elements (even)", () => {
  // [2,4,6,8,10,12] → lower=[2,4,6] upper=[8,10,12]
  // Q1=4, Q2=7, Q3=10
  const r = quartiles([2, 4, 6, 8, 10, 12]);
  assert.equal(r.q1, 4);
  assert.equal(r.q2, 7);
  assert.equal(r.q3, 10);
});

test("quartiles: empty array returns nulls", () => {
  const r = quartiles([]);
  assert.equal(r.q1, null);
  assert.equal(r.q2, null);
  assert.equal(r.q3, null);
});

// ── describeNumeric ───────────────────────────────────────
test("describeNumeric: basic stats", () => {
  const r = describeNumeric([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(r.count,  8);
  assert.equal(r.min,    2);
  assert.equal(r.max,    9);
  assert.equal(r.sum,    40);
  assert.equal(r.avg,    5);
  assert.equal(r.median, 4.5);  // (4+5)/2 — even length
});

test("describeNumeric: std dev", () => {
  // [2,4,4,4,5,5,7,9] population stddev = 2
  const r = describeNumeric([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.ok(Math.abs(r.stdDev - 2) < 0.0001);
});

test("describeNumeric: outlier detection", () => {
  // 100 is a clear outlier in [1,2,3,4,5,100]
  const r = describeNumeric([1, 2, 3, 4, 5, 100]);
  assert.equal(r.outlierCount, 1);
  assert.equal(r.outlierMax,   100);
});

test("describeNumeric: no outliers in uniform data", () => {
  const r = describeNumeric([10, 10, 10, 10, 10]);
  assert.equal(r.outlierCount, 0);
});

test("describeNumeric: single element", () => {
  const r = describeNumeric([42]);
  assert.equal(r.count,  1);
  assert.equal(r.min,    42);
  assert.equal(r.max,    42);
  assert.equal(r.median, 42);
  assert.equal(r.stdDev, 0);
});

test("describeNumeric: returns null for empty", () => {
  assert.equal(describeNumeric([]), null);
});

// ── describeText ──────────────────────────────────────────
test("describeText: basic frequency", () => {
  const r = describeText(["a", "b", "a", "c", "a", "b"]);
  assert.equal(r.count,     6);
  assert.equal(r.unique,    3);
  assert.equal(r.top[0].value, "a");
  assert.equal(r.top[0].count, 3);
  assert.equal(r.top[0].pct, "50.0");
});

test("describeText: topN limit respected", () => {
  const vals = Array.from({ length: 20 }, (_, i) => String(i));
  const r    = describeText(vals, 5);
  assert.equal(r.top.length, 5);
});

test("describeText: all unique values", () => {
  const r = describeText(["x", "y", "z"]);
  assert.equal(r.unique, 3);
  assert.equal(r.top.length, 3);
  // Each appears once (33.3%)
  r.top.forEach(t => assert.equal(t.count, 1));
});

test("describeText: empty array", () => {
  const r = describeText([]);
  assert.equal(r.count,  0);
  assert.equal(r.unique, 0);
  assert.equal(r.top.length, 0);
});

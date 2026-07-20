/**
 * perf.test.js — the pure logic behind the perf instrumentation.
 * Percentiles and the ring buffer are exactly the kind of code that fails
 * silently (an off-by-one in p95 just… reports a wrong number forever), so
 * they get tests. The DOM observers are not unit-testable under plain node
 * and are exercised in the browser.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordApi, apiStats, perfSnapshot, startSpan, resetPerf } from "./perf.js";

// The module holds one store for the whole app; reset it between tests.
beforeEach(() => resetPerf());

describe("recordApi + apiStats", () => {
  test("p50 and p95 are computed from recorded latencies", () => {
    for (let i = 1; i <= 100; i++) recordApi("/api/x", i, true);
    const s = apiStats();
    assert.equal(s.count, 100);
    assert.ok(s.p50 >= 49 && s.p50 <= 52, `p50 in range, got ${s.p50}`);
    assert.ok(s.p95 >= 94 && s.p95 <= 97, `p95 in range, got ${s.p95}`);
  });

  test("slowest call is surfaced with its url", () => {
    recordApi("/api/fast", 10, true);
    recordApi("/api/analyze", 900, true);
    recordApi("/api/mid", 100, true);
    const s = apiStats();
    assert.equal(s.slowest.url, "/api/analyze");
    assert.equal(s.slowest.ms, 900);
  });

  test("error rate counts failed responses", () => {
    recordApi("/a", 10, true);
    recordApi("/b", 10, false);
    recordApi("/c", 10, true);
    recordApi("/d", 10, true);
    assert.equal(apiStats().errorPct, 25);
  });

  test("overBudget flips when p95 exceeds the target (800ms)", () => {
    for (let i = 0; i < 20; i++) recordApi("/api/x", 50, true);
    assert.equal(apiStats().overBudget, false);

    for (let i = 0; i < 20; i++) recordApi("/api/slow", 5000, true);
    assert.equal(apiStats().overBudget, true, "a p95 of 5s must breach the 800ms budget");
  });

  test("ring buffer is bounded — memory cannot grow without limit", () => {
    for (let i = 0; i < 500; i++) recordApi("/api/x", i, true);
    assert.ok(apiStats().count <= 200, `expected ≤200 samples, got ${apiStats().count}`);
  });

  test("latencies are rounded to whole milliseconds", () => {
    recordApi("/api/x", 12.7, true);
    assert.equal(apiStats().slowest.ms, 13);
  });
});

describe("startSpan", () => {
  test("records a named span and returns its duration", () => {
    const end = startSpan("analyze");
    const ms = end();
    assert.equal(typeof ms, "number");
    assert.ok(ms >= 0);
    assert.ok(perfSnapshot().spans.analyze, "span stored in the snapshot");
  });
});

describe("perfSnapshot", () => {
  test("exposes budgets alongside live stats", () => {
    const snap = perfSnapshot();
    assert.equal(snap.budgets.apiP95Ms, 800);
    assert.equal(snap.budgets.lcpMs, 2500);
    assert.ok(snap.apiStats, "aggregated api stats included");
  });
});

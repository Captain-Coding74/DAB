/**
 * retention.test.js — v21.30: the retention settings and registry. The jobs
 * themselves run against a real database in dataLifecycle.test.js.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RETENTION_DEFAULTS, retentionDays, cutoffFor, retentionJobNames } from "./services/retention.js";

describe("retention settings", () => {
  test("the defaults are the periods the Privacy Notice states", () => {
    assert.deepEqual({ ...RETENTION_DEFAULTS }, {
      TRASH_RETENTION_DAYS: 30,
      DATASET_RETENTION_DAYS: 365,
      ANALYSIS_RETENTION_DAYS: 365,
      TELEMETRY_RETENTION_DAYS: 395,
      AUDIT_RETENTION_DAYS: 365,
      ACTIVITY_RETENTION_DAYS: 365,
    });
  });

  test("unset or blank → the default", () => {
    assert.equal(retentionDays("TRASH_RETENTION_DAYS", {}), 30);
    assert.equal(retentionDays("TRASH_RETENTION_DAYS", { TRASH_RETENTION_DAYS: "  " }), 30);
  });

  test("a positive whole number of days is used", () => {
    assert.equal(retentionDays("TRASH_RETENTION_DAYS", { TRASH_RETENTION_DAYS: "7" }), 7);
    assert.equal(retentionDays("AUDIT_RETENTION_DAYS", { AUDIT_RETENTION_DAYS: " 90 " }), 90);
  });

  test("anything else falls back to the default — never 'keep forever', never 'delete all'", () => {
    for (const bad of ["0", "-5", "1.5", "abc", "30d", "Infinity", "NaN"]) {
      assert.equal(retentionDays("DATASET_RETENTION_DAYS", { DATASET_RETENTION_DAYS: bad }), 365, bad);
    }
  });

  test("cutoffFor is exactly N days before now, as ISO text", () => {
    const now = Date.parse("2026-10-10T00:00:00.000Z");
    assert.equal(cutoffFor(30, now), "2026-09-10T00:00:00.000Z");
    assert.equal(cutoffFor(395, now), "2025-09-10T00:00:00.000Z");
  });

  test("every retention job is registered", () => {
    for (const name of ["trash", "datasets", "analyses", "telemetry", "audit", "activity", "notifications"]) {
      assert.ok(retentionJobNames().includes(name), name);
    }
  });
});

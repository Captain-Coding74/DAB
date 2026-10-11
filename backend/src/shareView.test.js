/**
 * shareView.test.js — v21.30 rules for public share links: expiry values,
 * titles that are never the file name, and a public payload that carries no
 * values from columns detected as personal data.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseExpiryDays, shareTitle, publicShareView, DEFAULT_SHARE_TITLE, DEFAULT_SHARE_EXPIRY_DAYS, SHARE_EXPIRY_DAYS }
  from "./services/shareView.js";

describe("parseExpiryDays", () => {
  test("absent means the 30-day default", () => {
    assert.equal(DEFAULT_SHARE_EXPIRY_DAYS, 30);
    assert.equal(parseExpiryDays(undefined), 30);
    assert.equal(parseExpiryDays(null), 30);
  });

  test("1, 7, 30 and 90 are accepted as they are", () => {
    assert.deepEqual([...SHARE_EXPIRY_DAYS], [1, 7, 30, 90]);
    for (const d of SHARE_EXPIRY_DAYS) assert.equal(parseExpiryDays(d), d);
  });

  test("everything else is refused, not coerced — there is no 'never'", () => {
    for (const bad of [0, -1, 2, 365, 30.5, Infinity, NaN, "30", "never", true, false, {}, []]) {
      assert.equal(parseExpiryDays(bad), null, `${String(bad)} should be refused`);
    }
  });
});

describe("shareTitle", () => {
  test("defaults to the generic title", () => {
    assert.equal(DEFAULT_SHARE_TITLE, "Analysis report");
    assert.equal(shareTitle(undefined, "x.csv"), DEFAULT_SHARE_TITLE);
    assert.equal(shareTitle("   ", "x.csv"), DEFAULT_SHARE_TITLE);
    assert.equal(shareTitle(42, "x.csv"), DEFAULT_SHARE_TITLE);
  });

  test("never the file name, even when a client sends it", () => {
    // The pre-v21.30 SPA sent { title: file.name } on every share.
    assert.equal(shareTitle("ม.3-2 roster.xlsx", "ม.3-2 roster.xlsx"), DEFAULT_SHARE_TITLE);
    assert.equal(shareTitle("  payroll.csv ", "payroll.csv"), DEFAULT_SHARE_TITLE);
  });

  test("an owner's own title is kept, trimmed and capped", () => {
    assert.equal(shareTitle("  Q3 sales  ", "q3.csv"), "Q3 sales");
    assert.equal(shareTitle("x".repeat(500), "q3.csv").length, 120);
  });
});

describe("publicShareView", () => {
  const row = {
    id: "sr1", analysis_id: "a1", user_id: "u1", token: "tok", password_hash: "h", is_active: 1,
    title: "Q3", analysis: "AI text", total_rows: 4, view_count: 2,
    created_at: "2026-10-01T00:00:00.000Z", expires_at: "2026-10-31T00:00:00.000Z",
    file_name: "roster.csv", brand_color: "#123456", brand_name: "School", brand_logo: null,
    chart_config: JSON.stringify({ type: "bar", data: [{ x: 1 }] }),
    stats_json: JSON.stringify({
      colAnalysis: [
        { col: "name", type: "text", count: 4, missing: 0, missingPct: "0.0", unique: 4,
          top: [{ value: "ส***", count: 1, pct: "25.0" }], sensitive: "name" },
        { col: "dob", type: "text", count: 4, missing: 0, missingPct: "0.0", unique: 4, semantic: "date",
          dateRange: { min: "2010", max: "2011" }, top: [{ value: "2010-**-**" }], sensitive: "dob" },
        { col: "bmi", type: "numeric", count: 4, missing: 0, missingPct: "0.0",
          min: 17.2, max: 31.9, avg: 22, median: 21, q1: 19, q3: 25, iqr: 6, stdDev: 3, sum: 88,
          trend: { n: 4 }, outlierCount: 1, sensitive: "health" },
        { col: "score", type: "numeric", count: 4, missing: 0, missingPct: "0.0", min: 10, max: 40, avg: 25 },
      ],
      corr: { cols: ["bmi", "score"], matrix: [[1, 0.5], [0.5, 1]], strong: [] },
      forecasts: [{ col: "bmi", forecast: [] }],
    }),
  };
  const view = publicShareView(row);

  test("carries no internal ids, password hash, token or file name", () => {
    for (const k of ["id", "analysis_id", "user_id", "token", "password_hash", "is_active", "file_name"]) {
      assert.equal(k in view, false, `${k} must not be public`);
    }
    assert.doesNotMatch(JSON.stringify(view), /roster\.csv/);
  });

  test("keeps what SharePage renders", () => {
    assert.equal(view.title, "Q3");
    assert.equal(view.analysis, "AI text");
    assert.equal(view.view_count, 2);
    assert.equal(view.expires_at, row.expires_at);
    assert.deepEqual(view.chart_config, { type: "bar", data: [{ x: 1 }] });
    assert.equal(view.stats_json.colAnalysis.length, 4, "every column is still listed");
  });

  test("a personal-data column keeps its name and kind, but no values", () => {
    const [name, dob, bmi] = view.stats_json.colAnalysis;
    assert.deepEqual(name, { col: "name", type: "text", sensitive: "name", count: 4, missing: 0, missingPct: "0.0", unique: 4 });
    assert.equal(dob.top, undefined);
    assert.equal(dob.dateRange, undefined);
    for (const k of ["min", "max", "avg", "median", "q1", "q3", "iqr", "stdDev", "sum", "trend", "top"]) {
      assert.equal(k in bmi, false, `bmi.${k} must not be public`);
    }
    assert.equal(bmi.sensitive, "health");
  });

  test("an ordinary column is untouched", () => {
    const score = view.stats_json.colAnalysis[3];
    assert.equal(score.min, 10);
    assert.equal(score.max, 40);
  });

  test("correlations and forecasts are not published — the page never shows them", () => {
    assert.deepEqual(Object.keys(view.stats_json), ["colAnalysis"]);
  });

  test("a missing title falls back to the generic one; bad JSON does not throw", () => {
    const v = publicShareView({ ...row, title: null, stats_json: "{not json", chart_config: null });
    assert.equal(v.title, DEFAULT_SHARE_TITLE);
    assert.deepEqual(v.stats_json, { colAnalysis: [] });
    assert.equal(v.chart_config, null);
  });
});

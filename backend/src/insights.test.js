/**
 * insights.test.js — Unit tests for the deterministic insights engine
 * Run: node --test src/insights.test.js  (included in `npm test`)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateInsights } from "./services/insights.js";

const numericCol = (over = {}) => ({
  col: "revenue", type: "numeric", count: 100, missing: 0, missingPct: "0.0",
  min: 10, max: 500, avg: 120, median: 115, stdDev: 40,
  q1: 90, q3: 150, iqr: 60, outlierCount: 0, ...over,
});
const textCol = (over = {}) => ({
  col: "category", type: "text", count: 100, missing: 0, missingPct: "0.0",
  unique: 3, top: [{ value: "A", count: 40, pct: "40.0" }], ...over,
});

describe("generateInsights", () => {
  test("returns empty array for empty input", () => {
    assert.deepEqual(generateInsights({}), []);
    assert.deepEqual(generateInsights({ colAnalysis: [], totalRows: 0 }), []);
  });

  test("flags critical missing data at >=30%", () => {
    const res = generateInsights({
      colAnalysis: [numericCol({ col: "age", missing: 35, missingPct: "35.0" })],
      totalRows: 100,
    });
    const hit = res.find(i => i.id === "missing:age");
    assert.ok(hit, "expected missing:age insight");
    assert.equal(hit.severity, "critical");
  });

  test("flags warning missing data at 10-29%", () => {
    const res = generateInsights({
      colAnalysis: [numericCol({ col: "age", missing: 12, missingPct: "12.0" })],
      totalRows: 100,
    });
    assert.equal(res.find(i => i.id === "missing:age")?.severity, "warning");
  });

  test("ignores missing data below 10%", () => {
    const res = generateInsights({
      colAnalysis: [numericCol({ col: "age", missing: 5, missingPct: "5.0" })],
      totalRows: 100,
    });
    assert.equal(res.find(i => i.id === "missing:age"), undefined);
  });

  test("duplicate severity scales with ratio", () => {
    const heavy = generateInsights({ colAnalysis: [numericCol()], totalRows: 100, dupeCount: 10 });
    assert.equal(heavy.find(i => i.id === "dupes")?.severity, "warning");
    const light = generateInsights({ colAnalysis: [numericCol()], totalRows: 100, dupeCount: 2 });
    assert.equal(light.find(i => i.id === "dupes")?.severity, "info");
  });

  test("flags outlier-heavy numeric columns (>=5% and >=3 points)", () => {
    const res = generateInsights({
      colAnalysis: [numericCol({ outlierCount: 8 })], totalRows: 100,
    });
    const hit = res.find(i => i.id === "outliers:revenue");
    assert.ok(hit);
    assert.equal(hit.severity, "warning");
    // below both thresholds → silent
    const quiet = generateInsights({ colAnalysis: [numericCol({ outlierCount: 2 })], totalRows: 100 });
    assert.equal(quiet.find(i => i.id === "outliers:revenue"), undefined);
  });

  test("flags constant numeric and constant text columns", () => {
    const res = generateInsights({
      colAnalysis: [
        numericCol({ col: "flag", stdDev: 0, min: 1, max: 1 }),
        textCol({ col: "country", unique: 1, top: [{ value: "TH", count: 100, pct: "100.0" }] }),
      ],
      totalRows: 100,
    });
    assert.ok(res.find(i => i.id === "constant:flag"));
    assert.ok(res.find(i => i.id === "constant:country"));
  });

  test("flags likely ID columns (unique/count >= 95%, count > 20)", () => {
    const res = generateInsights({
      colAnalysis: [textCol({ col: "order_id", count: 100, unique: 99 })],
      totalRows: 100,
    });
    assert.ok(res.find(i => i.id === "idcol:order_id"));
    // small samples never flagged
    const small = generateInsights({ colAnalysis: [textCol({ col: "x", count: 10, unique: 10 })], totalRows: 10 });
    assert.equal(small.find(i => i.id === "idcol:x"), undefined);
  });

  test("flags dominant category at >=70%", () => {
    const res = generateInsights({
      colAnalysis: [textCol({ unique: 3, top: [{ value: "Bangkok", count: 80, pct: "80.0" }] })],
      totalRows: 100,
    });
    const hit = res.find(i => i.id === "dominant:category");
    assert.ok(hit);
    assert.match(hit.title, /Bangkok/);
  });

  test("reports strong correlations with direction, |r|>=0.9 is positive", () => {
    const res = generateInsights({
      colAnalysis: [numericCol()], totalRows: 50,
      corr: { cols: ["a", "b"], matrix: [], strong: [
        { col1: "a", col2: "b", r: 0.95 },
        { col1: "a", col2: "c", r: -0.75 },
      ]},
    });
    assert.equal(res.find(i => i.id === "corr:a:b")?.severity, "positive");
    assert.equal(res.find(i => i.id === "corr:a:c")?.severity, "info");
    assert.match(res.find(i => i.id === "corr:a:c").detail, /สวนทาง/);
  });

  test("reports trends only when R² >= 0.6", () => {
    const res = generateInsights({
      colAnalysis: [numericCol()], totalRows: 50,
      forecasts: [
        { col: "sales", slope: 5.2, r2: 0.91, forecast: [{ step: 1, predicted: 320 }] },
        { col: "noise", slope: 1.1, r2: 0.55, forecast: [] },
      ],
    });
    const up = res.find(i => i.id === "trend:sales");
    assert.ok(up);
    assert.equal(up.severity, "positive");
    assert.equal(res.find(i => i.id === "trend:noise"), undefined);
  });

  test("downtrend is a warning", () => {
    const res = generateInsights({
      colAnalysis: [numericCol()], totalRows: 50,
      forecasts: [{ col: "churn", slope: -2, r2: 0.8, forecast: [{ step: 1, predicted: 10 }] }],
    });
    assert.equal(res.find(i => i.id === "trend:churn")?.severity, "warning");
  });

  test("clean-data bonus only when zero missing and zero dupes", () => {
    const clean = generateInsights({ colAnalysis: [numericCol(), textCol()], totalRows: 100, dupeCount: 0 });
    assert.ok(clean.find(i => i.id === "clean"));
    const dirty = generateInsights({ colAnalysis: [numericCol({ missing: 1, missingPct: "1.0" })], totalRows: 100 });
    assert.equal(dirty.find(i => i.id === "clean"), undefined);
  });

  test("results are sorted by severity and capped at 12", () => {
    const cols = [];
    for (let i = 0; i < 20; i++) cols.push(numericCol({ col: `c${i}`, missing: 40, missingPct: "40.0" }));
    cols.push(numericCol({ col: "warn", missing: 15, missingPct: "15.0" }));
    const res = generateInsights({ colAnalysis: cols, totalRows: 100 });
    assert.equal(res.length, 12);
    assert.equal(res[0].severity, "critical");
    const order = { critical: 0, warning: 1, info: 2, positive: 3 };
    for (let i = 1; i < res.length; i++) {
      assert.ok(order[res[i - 1].severity] <= order[res[i].severity], "sorted by severity");
    }
  });
});

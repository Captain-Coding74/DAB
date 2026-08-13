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

import { correlationMatrix, isIndexColumn } from "./analyze.js";

describe("the streaming correlation path applies the same exclusions", () => {
  test("index and date columns stay out of the pairwise matrix", async () => {
    // Regression: buildCorrelation in services/pairwise.js replaced
    // correlationMatrix but filtered on type alone, so Day, Year and
    // Customer_ID walked straight back into the matrix that analyze.js had
    // carefully excluded them from. Two paths, one rule.
    const { parseFileStreaming } = await import("./services/streaming.js");
    const rows = ["Day,Year,Customer_ID,Unit_Cost,Revenue"];
    for (let i = 0; i < 300; i++)
      rows.push(`${(i % 28) + 1},${2020 + (i % 5)},C${i},${5 + (i % 20)},${100 + i}`);
    const res = await parseFileStreaming(Buffer.from(rows.join("\n")), "s.csv");
    const cols = res.pairwise?.cols ?? [];
    for (const bad of ["Day", "Year", "Customer_ID"])
      assert.ok(!cols.includes(bad), `${bad} must not be correlated`);
    assert.ok(cols.includes("Unit_Cost") && cols.includes("Revenue"), "real measures stay");
  });

  test("every reported correlation carries its true sample size", async () => {
    // The old path correlated a FIVE-row reservoir sample regardless of file
    // size, where unrelated columns clear |r|>=0.7 about 20% of the time.
    const { parseFileStreaming } = await import("./services/streaming.js");
    const rows = ["a,b"];
    for (let i = 0; i < 2000; i++) rows.push(`${Math.sin(i)},${Math.sin(i) * 3 + 1}`);
    const res = await parseFileStreaming(Buffer.from(rows.join("\n")), "n.csv");
    const strong = res.pairwise?.strong ?? [];
    assert.ok(strong.length > 0, "a real relationship should be found");
    assert.equal(strong[0].n, 2000, "n must be the whole file, not the sample");
  });
});


describe("the ID-column insight needs more than uniqueness", () => {
  test("a real identifier is flagged", () => {
    for (const col of ["Customer_ID", "order_id", "SKU"]) {
      const r = generateInsights({
        colAnalysis: [{ col, type: "text", count: 1000, missing: 0, missingPct: "0.0", unique: 1000, top: [] }],
        totalRows: 1000, dupeCount: 0, corr: null, forecasts: [],
      });
      assert.ok(r.some(x => /รหัส \(ID\)/.test(x.title)), `${col} should be flagged`);
    }
  });

  test("names and free-text answers are NOT called identifiers", () => {
    // Uniqueness alone flagged customer names, open-ended survey responses,
    // product names and addresses as ID columns — all naturally near-unique
    // and none of them identifiers. A thesis with open-ended questions had
    // DAB announcing the responses were an ID column.
    for (const [col, unique] of [["ชื่อลูกค้า", 980], ["ความคิดเห็น", 990], ["Product_Name", 960], ["Address", 1000]]) {
      const r = generateInsights({
        colAnalysis: [{ col, type: "text", count: 1000, missing: 0, missingPct: "0.0", unique, top: [] }],
        totalRows: 1000, dupeCount: 0, corr: null, forecasts: [],
      });
      assert.ok(!r.some(x => /รหัส \(ID\)/.test(x.title)), `${col} must not be called an ID`);
    }
  });
});


describe("identifier columns, without eating real words", () => {
  test("identifiers are excluded", () => {
    for (const n of ["id", "Customer_ID", "CustomerID", "user_id", "OrderID",
                     "SKU", "order-id", "order_code", "รหัสลูกค้า", "เลขที่ใบสั่ง"])
      assert.equal(isIndexColumn(n, [101, 102, 103]), true, `${n} should be excluded`);
  });

  test("real words ending in -id keep their column", () => {
    // A plain /id$/ rule silently dropped every one of these. In a science
    // thesis Humid, Liquid, Solid and Acid are measurements, and losing them
    // with no message is worse than the noise the rule was meant to remove.
    for (const n of ["Humid", "Liquid", "Solid", "Valid", "Fluid", "Acid",
                     "Rapid", "Paid", "Grid", "Lipid", "Void", "Humidity"])
      assert.equal(isIndexColumn(n, [10, 25, 13]), false, `${n} must be kept`);
  });
});


describe("date columns never enter a correlation matrix", () => {
  test("a Date column is excluded by name", () => {
    for (const n of ["Date", "Order_Date", "Ship_Date", "created_at", "วันที่"])
      assert.equal(isIndexColumn(n, [2024, 2024, 2023]), true, `${n} should be excluded`);
    for (const n of ["Revenue", "Unit_Cost", "Profit"])
      assert.equal(isIndexColumn(n, [100, 250, 90]), false, `${n} should be kept`);
  });

  test("a date-shaped column is excluded even under an odd name", () => {
    // parseFloat("2024-01-05") is 2024, so an unguarded date column reports a
    // confident correlation computed on the YEAR alone — 1/365th of the data.
    const headers = ["ts_field", "Revenue"];
    const rows = Array.from({ length: 40 }, (_, i) =>
      [`202${Math.floor(i / 12)}-0${(i % 9) + 1}-15`, 1000 - i * 10]);
    const c = correlationMatrix(headers, rows);
    assert.ok(!c || !c.cols.includes("ts_field"), "a date-shaped column must not be correlated");
  });
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

/**
 * aiSafe.test.js — the one view every AI payload is built from (v21.30).
 *
 * The contract: a detected personal-data column keeps its name and kind;
 * everything else goes — values, aggregates, even counts. Analyses saved before v21.30
 * lack the new kinds, so the helper must re-detect them from what is stored.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aiSafeColumns, aiSafeStats, aiSafeInsights, detectedKinds } from "./services/aiSafe.js";
import { generateInsights } from "./services/insights.js";

/* The shape stats_json had BEFORE v21.30 for the audit's five-column file:
   no `sensitive` anywhere, raw values in every frequency table. */
const OLD = {
  colAnalysis: [
    { col: "customer_email", type: "text", count: 12, missing: 0, missingPct: "0.0", unique: 4,
      top: [{ value: "user0@example.com", count: 3, pct: "25.0" }, { value: "user1@example.com", count: 3, pct: "25.0" }] },
    { col: "address", type: "text", count: 12, missing: 1, missingPct: "8.3", unique: 5,
      top: [{ value: "0 Sukhumvit Rd Bangkok", count: 4, pct: "33.3" }] },
    { col: "line_id", type: "text", count: 12, missing: 0, missingPct: "0.0", unique: 4,
      top: [{ value: "line_0", count: 3, pct: "25.0" }] },
    { col: "diagnosis", type: "text", count: 12, missing: 0, missingPct: "0.0", unique: 1,
      top: [{ value: "diabetes type 1", count: 12, pct: "100.0" }] },
    { col: "contact", type: "text", count: 12, missing: 0, missingPct: "0.0", unique: 2,
      top: [{ value: "a@shop.co.th", count: 6, pct: "50.0" }, { value: "b@shop.co.th", count: 6, pct: "50.0" }] },
    { col: "amount", type: "numeric", count: 12, missing: 0, missingPct: "0.0",
      min: 100, max: 177, avg: 138.5, median: 138.5, stdDev: 25, q1: 119, q3: 158, iqr: 39, outlierCount: 0,
      trend: { n: 12 } },
  ],
  corr: { strong: [{ col1: "amount", col2: "diagnosis", r: 0.9 }, { col1: "amount", col2: "tax", r: 0.99 }] },
  forecasts: [{ col: "amount", slope: 7, r2: 1, forecast: [{ step: 1, predicted: 184 }] },
              { col: "diagnosis", slope: 1, r2: 1, forecast: [] }],
};
const LEAKS = ["@example.com", "@shop.co.th", "Sukhumvit", "line_0", "diabetes"];

describe("aiSafeColumns", () => {
  test("old analyses: header AND stored-value detection catch every PII column", () => {
    assert.deepEqual(Object.fromEntries(detectedKinds(OLD.colAnalysis)), {
      customer_email: "email", address: "address", line_id: "social-id", diagnosis: "health",
      contact: "email",   // innocuous header — the stored top values give it away
    });
  });

  test("a detected column keeps only its name and kind", () => {
    const [email] = aiSafeColumns(OLD.colAnalysis);
    assert.deepEqual(email, { col: "customer_email", sensitive: "email" });
  });

  test("no value of a detected column survives anywhere in the output", () => {
    const json = JSON.stringify(aiSafeColumns(OLD.colAnalysis));
    for (const leak of LEAKS) assert.ok(!json.includes(leak), `leaked: ${leak}`);
  });

  test("an undetected column passes through untouched — same object", () => {
    const out = aiSafeColumns(OLD.colAnalysis);
    assert.equal(out[5], OLD.colAnalysis[5]);
    assert.equal(out[5].avg, 138.5);
  });

  test("an already-flagged column keeps its stored kind, and its aggregates go", () => {
    const [c] = aiSafeColumns([{ col: "รหัสอ้างอิง", type: "numeric", sensitive: "citizen-id",
      count: 3, min: 1e12, max: 9e12, avg: 5e12, outliers: [9e12] }]);
    assert.deepEqual(c, { col: "รหัสอ้างอิง", sensitive: "citizen-id" });
  });

  test("the input is never mutated", () => {
    const before = JSON.stringify(OLD);
    aiSafeColumns(OLD.colAnalysis);
    aiSafeStats(OLD);
    assert.equal(JSON.stringify(OLD), before);
  });
});

describe("aiSafeStats", () => {
  test("correlations and forecasts naming a detected column are dropped", () => {
    const s = aiSafeStats(OLD);
    assert.deepEqual(s.corr.strong, [{ col1: "amount", col2: "tax", r: 0.99 }]);
    assert.deepEqual(s.forecasts.map((f) => f.col), ["amount"]);
    assert.deepEqual([...s.hidden].sort(), ["address", "contact", "customer_email", "diagnosis", "line_id"]);
  });

  test("empty and missing input is fine", () => {
    assert.deepEqual(aiSafeStats({}), { colAnalysis: [], corr: null, forecasts: [], hidden: new Set() });
    assert.deepEqual(aiSafeStats(undefined).colAnalysis, []);
  });
});

describe("aiSafeInsights — in step with insights.js ids", () => {
  test("real findings about a detected column are dropped, the rest kept", () => {
    // Generate REAL insights, so a change to the id format fails here.
    const insights = generateInsights({ colAnalysis: OLD.colAnalysis, totalRows: 12, dupeCount: 0,
      corr: OLD.corr, forecasts: OLD.forecasts });
    const json = JSON.stringify(insights);
    assert.ok(json.includes("diabetes"), "fixture sanity: the raw insights DO quote a detected value");

    const safe = aiSafeInsights(insights, aiSafeStats(OLD).hidden);
    const safeJson = JSON.stringify(safe);
    for (const leak of [...LEAKS, "diagnosis", "customer_email"]) {
      assert.ok(!safeJson.includes(leak), `insight about a detected column survived: ${leak}`);
    }
    assert.ok(safe.some((i) => i.id === "corr:amount:tax"), "findings about other columns stay");
  });

  test("nothing hidden → the same list back", () => {
    const list = [{ id: "dupes" }];
    assert.equal(aiSafeInsights(list, new Set()), list);
  });
});

/* v21.30: numeric columns store no top values, so value detection on an old
   analysis has to look at the aggregates it did store. */
describe("detectedKinds — numeric columns from old analyses", () => {
  test("Luhn-valid card numbers stored as min/quartiles/max are a card column", () => {
    const col = { col: "ref", type: "numeric", min: 4532015110000004, q1: 4532015110237572, median: 4532015110475130, q3: 4532015110712715, max: 4532015110871099 };
    assert.equal(detectedKinds([col]).get("ref"), "card");
    const safe = aiSafeColumns([col])[0];
    assert.deepEqual(safe, { col: "ref", sensitive: "card" });
  });

  test("ordinary measurements are not flagged", () => {
    const col = { col: "amount", type: "numeric", min: 100, q1: 250, median: 400, q3: 900, max: 12000 };
    assert.equal(detectedKinds([col]).size, 0);
  });
});

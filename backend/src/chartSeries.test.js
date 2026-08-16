/**
 * chartSeries.test.js — the aggregation that feeds every chart a user sees.
 *
 * The done-when from docs/IMPROVEMENTS.md item 1: aggregated values must
 * match what a spreadsheet pivot of the same rows would say.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { enrichChartsWithData } from "./services/chartSeries.js";

const H = ["Date", "Region", "Revenue", "Rating"];
const rows = [
  ["2025-01-05", "North", "100", "4.0"],
  ["2025-01-20", "North", "50",  "5.0"],
  ["2025-02-11", "South", "200", "3.0"],
  ["2025-02-28", "North", "25",  "4.0"],
];

describe("chartSeries", () => {
  test("few distinct days bucket by day and sum like a pivot", () => {
    const [c] = enrichChartsWithData(
      [{ type: "line", xAxis: "Date", yAxis: ["Revenue"] }], H, rows);
    assert.deepEqual(c.data, [
      { Date: "2025-01-05", Revenue: 100 },
      { Date: "2025-01-20", Revenue: 50 },
      { Date: "2025-02-11", Revenue: 200 },
      { Date: "2025-02-28", Revenue: 25 },
    ]);
    assert.equal(c.aggregations.Revenue, "sum");
  });

  test("more than 31 distinct days falls back to month buckets that pivot", () => {
    const many = [];
    for (let d = 1; d <= 20; d++) many.push([`2025-01-${String(d).padStart(2, "0")}`, "X", "10", "4"]);
    for (let d = 1; d <= 20; d++) many.push([`2025-02-${String(d).padStart(2, "0")}`, "X", "5", "4"]);
    const [c] = enrichChartsWithData(
      [{ type: "line", xAxis: "Date", yAxis: ["Revenue"] }], H, many);
    assert.deepEqual(c.data, [
      { Date: "2025-01", Revenue: 200 },
      { Date: "2025-02", Revenue: 100 },
    ]);
  });

  test("rate-like columns average instead of summing", () => {
    const [c] = enrichChartsWithData(
      [{ type: "bar", xAxis: "Region", yAxis: ["Rating"] }], H, rows);
    const north = c.data.find((d) => d.Region === "North");
    assert.equal(north.Rating, 4.33); // (4+5+4)/3, not 13
    assert.equal(c.aggregations.Rating, "avg");
  });

  test("categorical buckets rank by the first measure and cap at 12", () => {
    const many = Array.from({ length: 40 }, (_, i) => [`2025-01-01`, `Cat${i}`, String(i + 1), "4"]);
    const [c] = enrichChartsWithData(
      [{ type: "bar", xAxis: "Region", yAxis: ["Revenue"] }], H, many);
    assert.equal(c.data.length, 12);
    assert.equal(c.truncatedFrom, 40);
    assert.equal(c.data[0].Revenue, 40); // largest first
  });

  test("a single month of daily data buckets by day, not one blob", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      [`2026-01-${String(i + 1).padStart(2, "0")}`, "X", "10", "4"]);
    const [c] = enrichChartsWithData(
      [{ type: "line", xAxis: "Date", yAxis: ["Revenue"] }], H, days);
    assert.equal(c.data.length, 30);
    assert.equal(c.data[0].Date, "2026-01-01");
  });

  test("date buckets keep the most recent 24 months, chronological", () => {
    const long = Array.from({ length: 60 }, (_, i) =>
      [`202${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-0${(i % 2) + 1}`, "X", "10", "4"]);
    const [c] = enrichChartsWithData(
      [{ type: "line", xAxis: "Date", yAxis: ["Revenue"] }], H, long);
    assert.equal(c.data.length, 24);
    assert.equal(c.data[0].Date < c.data[23].Date, true);
    assert.equal(c.truncatedFrom, 60);
  });

  test("scatter ships real strided points, never aggregates", () => {
    const many = Array.from({ length: 900 }, (_, i) => ["2025-01-01", "X", String(i), String(i * 2)]);
    const [c] = enrichChartsWithData(
      [{ type: "scatter", xAxis: "Revenue", yAxis: ["Rating"] }], H, many);
    assert.ok(c.data.length <= 300 && c.data.length > 200);
    assert.equal(c.sampledEvery, 3);
    assert.deepEqual(c.data[0], { Revenue: 0, Rating: 0 });
  });

  test("thousand separators and blanks coerce like the inference route", () => {
    const messy = [["2025-03-01", "North", "1,250", ""], ["2025-03-02", "North", "", "4"]];
    const [c] = enrichChartsWithData(
      [{ type: "line", xAxis: "Date", yAxis: ["Revenue"] }], H, messy);
    assert.deepEqual(c.data, [{ Date: "2025-03-01", Revenue: 1250 }, { Date: "2025-03-02", Revenue: null }]);
  });

  test("missing columns or empty rows leave the config untouched", () => {
    const [a] = enrichChartsWithData([{ type: "bar", xAxis: "Nope", yAxis: ["Revenue"] }], H, rows);
    assert.equal(a.data, undefined);
    const b = enrichChartsWithData([{ type: "bar", xAxis: "Region", yAxis: ["Revenue"] }], H, []);
    assert.equal(b[0].data, undefined);
  });
});

describe("chartSeries messy-file handling", () => {
  test("alignHeaders re-anchors past a report banner row", async () => {
    const { alignHeaders } = await import("./services/chartSeries.js");
    const raw = { headers: ["รายงานยอดขาย ประจำเดือน"], rows: [
      ["วันที่", "สินค้า", "ยอดขาย"],
      ["05/01/2569", "มาม่า", "฿144"],
    ]};
    const a = alignHeaders(raw, ["วันที่", "สินค้า", "ยอดขาย"]);
    assert.deepEqual(a.headers, ["วันที่", "สินค้า", "ยอดขาย"]);
    assert.equal(a.rows.length, 1);
  });

  test("Thai numerals and baht signs coerce; all-text measures decline", () => {
    const H2 = ["สาขา", "ยอดขาย", "หมายเหตุ"];
    const rows2 = [["เหนือ", "฿๑,๒๕๐", "ดี"], ["เหนือ", "฿750", "พอใช้"]];
    const [ok] = enrichChartsWithData([{ type: "bar", xAxis: "สาขา", yAxis: ["ยอดขาย"] }], H2, rows2);
    assert.deepEqual(ok.data, [{ "สาขา": "เหนือ", "ยอดขาย": 2000 }]);
    const [nope] = enrichChartsWithData([{ type: "bar", xAxis: "สาขา", yAxis: ["หมายเหตุ"] }], H2, rows2);
    assert.equal(nope.data, undefined);
  });
});

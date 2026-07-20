/**
 * telemetry.test.js — v20.2 "Let usage pick the segment"
 *
 * The privacy contract is the point, so it gets tested like a feature:
 * records must contain dictionary tags and shapes — never raw column
 * names, filenames, or values.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { categorizeColumns, inferSegment, buildUploadRecord } from "./services/telemetry.js";

describe("categorizeColumns", () => {
  test("Thai pharmacy headers map to dictionary tags", () => {
    const { tags } = categorizeColumns(["วันที่", "ชื่อยา", "ล็อต", "วันหมดอายุ", "คงเหลือ", "ราคา"]);
    assert.deepEqual(tags, ["date", "expiry", "price", "product", "stock"]);
  });
  test("English retail headers map correctly", () => {
    const { tags } = categorizeColumns(["Date", "Product", "Category", "Units", "Price", "Revenue"]);
    assert.deepEqual(tags, ["category", "date", "price", "product", "quantity", "sales"]);
  });
  test("a header can vote for multiple tags", () => {
    const { tags } = categorizeColumns(["ราคาขายรวม"]);
    assert.ok(tags.includes("price") && tags.includes("sales"));
  });
  test("unmatched headers are counted, their text discarded", () => {
    const r = categorizeColumns(["xyz_ปริศนา", "คอลัมน์ลับ"]);
    assert.deepEqual(r.tags, []);
    assert.equal(r.otherCols, 2);
  });
  test("empty input is safe", () => {
    assert.deepEqual(categorizeColumns([]).tags, []);
    assert.deepEqual(categorizeColumns().tags, []);
  });
});

describe("inferSegment", () => {
  const seg = (headers) => inferSegment(categorizeColumns(headers).tags).segment;
  test("expiry + stock reads as pharmacy", () => {
    assert.equal(seg(["วันที่", "ชื่อยา", "ล็อต", "วันหมดอายุ", "คงเหลือ", "ราคา"]), "pharmacy");
  });
  test("sales + product + price reads as retail_shop", () => {
    assert.equal(seg(["วันที่", "สินค้า", "หมวดหมู่", "จำนวน", "ยอดขาย"]), "retail_shop");
  });
  test("pharmacy beats retail when both match (expiry is decisive)", () => {
    assert.equal(seg(["สินค้า", "ราคา", "ยอดขาย", "คงเหลือ", "วันหมดอายุ"]), "pharmacy");
  });
  test("menu + orders reads as restaurant", () => {
    assert.equal(seg(["เมนู", "โต๊ะ", "จำนวน", "ยอดขาย"]), "restaurant");
  });
  test("web analytics headers read as web_marketing", () => {
    assert.equal(seg(["Date", "Visitors", "PageViews", "Bounce_Rate", "Conversions"]), "web_marketing");
  });
  test("payroll headers read as hr_payroll", () => {
    assert.equal(seg(["พนักงาน", "เงินเดือน", "แผนก"]), "hr_payroll");
  });
  test("too little evidence stays general", () => {
    assert.equal(seg(["a", "b", "ราคา"]), "general");
    assert.equal(inferSegment([]).segment, "general");
  });
});

describe("buildUploadRecord — the privacy contract", () => {
  const thaiHeaders = ["วันที่", "ชื่อยาสามัญ", "ล็อตการผลิต", "วันหมดอายุ", "คงเหลือคลัง", "ราคาขายปลีก"];
  const parsed = {
    headers: thaiHeaders,
    totalRows: 321,
    normalization: { encoding: "windows-874", delimiter: "\t", skippedPreHeaderRows: 2 },
    colAnalysis: [
      { col: thaiHeaders[0], type: "text", semantic: "date", buddhistEra: true },
      { col: thaiHeaders[1], type: "text" },
      { col: thaiHeaders[2], type: "text" },
      { col: thaiHeaders[3], type: "text", semantic: "date", buddhistEra: false },
      { col: thaiHeaders[4], type: "numeric" },
      { col: thaiHeaders[5], type: "numeric" },
    ],
  };
  const rec = buildUploadRecord({ source: "analyze", fileType: "CSV", sizeBytes: 51200, parsed, userId: "u1" });

  test("record carries shape + tags + segment", () => {
    assert.equal(rec.rowCount, 321);
    assert.equal(rec.colCount, 6);
    assert.equal(rec.sizeKb, 50);
    assert.equal(rec.numericCols, 2);
    assert.equal(rec.dateCols, 2);
    assert.equal(rec.textCols, 2);
    assert.equal(rec.buddhistEra, 1);
    assert.equal(rec.encoding, "windows-874");
    assert.equal(rec.delimiter, "tab");
    assert.equal(rec.skippedRows, 2);
    assert.equal(rec.fileType, "csv");
    assert.equal(rec.segment, "pharmacy");
  });

  test("NO raw column name survives into the record", () => {
    const json = JSON.stringify(rec);
    for (const h of thaiHeaders) assert.ok(!json.includes(h), `leaked header: ${h}`);
  });

  test("no filename field exists at all", () => {
    assert.ok(!("fileName" in rec) && !("filename" in rec) && !("name" in rec));
  });

  test("headers fall back to colAnalysis col names (demo path)", () => {
    const r = buildUploadRecord({ source: "demo", parsed: { colAnalysis: parsed.colAnalysis, totalRows: 5 }, sampleId: "thai-shop" });
    assert.equal(r.segment, "pharmacy");
    assert.equal(r.sampleId, "thai-shop");
    assert.equal(r.colCount, 6);
  });

  test("garbage input never throws", () => {
    assert.doesNotThrow(() => buildUploadRecord({ source: "analyze" }));
    assert.doesNotThrow(() => buildUploadRecord({ source: "analyze", parsed: { colAnalysis: null } }));
  });
});

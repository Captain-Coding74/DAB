/**
 * fullRows.test.js — parseAllRowsAny reads .xlsx the way the pipeline does.
 *
 * The fixes/inference/class-report paths used to 415 on every Excel upload
 * because parseAllRows is CSV-only (and sync, for computeStatsBundle). The
 * async parseAllRowsAny must produce, from an .xlsx, exactly the rows the
 * CSV-equivalent file would produce: same header detection, same cell
 * flattening as streaming.js (Date → YYYY-MM-DD, formula → cached result),
 * blank rows dropped, every row aligned to the header width. Otherwise a fix
 * applied to an Excel upload would persist rows the stats never described.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import ExcelJS from "exceljs";
import { parseAllRows, parseAllRowsAny } from "./services/fullRows.js";

const HEADERS = ["เลขประจำตัว", "ชื่อเล่น", "คะแนนเก็บ", "วันที่ส่ง", "รวม"];

/* One workbook exercising every flattening rule at once: Thai headers,
   numeric cells, a Date cell, formula cells with cached results, a fully
   blank row (must vanish) and a short row (must be padded to header width).
   Dates are built with Date.UTC because exceljs serialises via UTC — a local
   midnight on a UTC+7 machine would round-trip to the previous day. */
async function buildXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("คะแนน");
  ws.addRow(HEADERS);
  ws.addRow([30001, "หนึ่ง", 28, new Date(Date.UTC(2026, 0, 14)), { formula: "C2*2", result: 56 }]);
  ws.addRow([]);                                                   // blank row — not data
  ws.addRow([30002, "สอง", 20, new Date(Date.UTC(2026, 1, 1)), { formula: "C4*2", result: 40 }]);
  ws.addRow([30003, "สาม", 15]);                                   // short row — Excel drops trailing blanks
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* The same content as hand-written CSV. Trailing ",," spells out the short
   row's empty cells because the xlsx path aligns rows to the header width. */
const CSV_TEXT =
  "เลขประจำตัว,ชื่อเล่น,คะแนนเก็บ,วันที่ส่ง,รวม\n" +
  "30001,หนึ่ง,28,2026-01-14,56\n" +
  "30002,สอง,20,2026-02-01,40\n" +
  "30003,สาม,15,,";

describe("parseAllRowsAny — xlsx", () => {
  test("flattens cells like streaming.js and matches the CSV-equivalent content", async () => {
    const xlsx = await buildXlsx();
    const fromXlsx = await parseAllRowsAny(xlsx, "คะแนน.xlsx");
    const fromCsv  = parseAllRows(Buffer.from(CSV_TEXT, "utf-8"), "คะแนน.csv");

    assert.deepEqual(fromXlsx.headers, HEADERS, "Thai headers survive");
    assert.deepEqual(fromXlsx.rows, [
      ["30001", "หนึ่ง", "28", "2026-01-14", "56"],   // Date → ISO day, formula → cached result
      ["30002", "สอง",  "20", "2026-02-01", "40"],
      ["30003", "สาม",  "15", "", ""],                // short row padded to header width
    ]);

    // The two views of the same data must be identical — a fix computed on
    // one and applied to the other would otherwise corrupt the dataset.
    assert.deepEqual(fromXlsx.headers, fromCsv.headers);
    assert.deepEqual(fromXlsx.rows, fromCsv.rows);
  });

  test("blank rows are dropped and every row is aligned to the header width", async () => {
    const { headers, rows } = await parseAllRowsAny(await buildXlsx(), "คะแนน.xlsx");
    assert.equal(rows.length, 3, "the fully blank worksheet row is not data");
    for (const r of rows) assert.equal(r.length, headers.length, "row aligned to header width");
  });
});

describe("parseAllRowsAny — delegation and unsupported types", () => {
  test("CSV delegates to parseAllRows and the result is identical", async () => {
    const buf = Buffer.from(CSV_TEXT, "utf-8");
    const viaAny  = await parseAllRowsAny(buf, "grades.csv");
    const viaSync = parseAllRows(buf, "grades.csv");
    assert.deepEqual(viaAny, viaSync);
    // Byte-identical, not just structurally similar: the async wrapper must
    // add no re-encoding of its own on the CSV path.
    assert.equal(JSON.stringify(viaAny), JSON.stringify(viaSync));
  });

  test("legacy .xls (OLE compound document) returns headers null", async () => {
    // D0 CF 11 E0 is the OLE magic — the Excel 97-2003 container exceljs
    // cannot open. The caller uses headers:null to send a 415 with advice.
    const ole = Buffer.concat([
      Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
      Buffer.alloc(512),
    ]);
    const r = await parseAllRowsAny(ole, "เกรดเก่า.xls");
    assert.equal(r.headers, null);
    assert.equal(r.rows, null);
  });

  test("unknown extensions return headers null", async () => {
    const r = await parseAllRowsAny(Buffer.from("not a table"), "report.pdf");
    assert.equal(r.headers, null);
    assert.equal(r.rows, null);
  });
});

describe("ragged CSV alignment (v21.23)", () => {
  test("short rows are padded to header width, same as xlsx and streaming", () => {
    const csv = Buffer.from("a,b,c\n1,2,3\n4,5\n7,8,9\n", "utf-8");
    const { headers, rows } = parseAllRows(csv, "t.csv");
    assert.equal(headers.length, 3);
    assert.deepEqual(rows.map((r) => r.length), [3, 3, 3]);
    assert.deepEqual(rows[1], ["4", "5", ""]);
  });
});

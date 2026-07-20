/**
 * streaming.test.js — v15: the XLSX parser (exceljs) must produce the SAME
 * stats as the equivalent CSV, and must safely coerce dates, formulas,
 * blanks, and stray cells. This is the parity contract that let us swap out
 * SheetJS (two unpatched HIGH CVEs) with confidence.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseFileStreaming } from "./services/streaming.js";

async function xlsxBuffer(build) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  build(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("XLSX parsing (exceljs)", () => {
  test("produces identical stats to the equivalent CSV", async () => {
    const buf = await xlsxBuffer(ws => {
      ws.addRow(["month", "region", "units", "price"]);
      [["2025-01","BKK",120,49],["2025-01","CNX",40,49],["2025-02","BKK",135,49],
       ["2025-02","CNX",45,49],["2025-03","BKK",150,49],["2025-03","CNX",null,49]]
        .forEach(r => ws.addRow(r));
    });
    const csv = "month,region,units,price\n2025-01,BKK,120,49\n2025-01,CNX,40,49\n" +
      "2025-02,BKK,135,49\n2025-02,CNX,45,49\n2025-03,BKK,150,49\n2025-03,CNX,,49\n";

    const x = await parseFileStreaming(buf, "t.xlsx");
    const c = await parseFileStreaming(Buffer.from(csv), "t.csv");

    const norm = (r) => ({ headers: r.headers, totalRows: r.totalRows, dupeCount: r.dupeCount,
      cols: r.colAnalysis.map(k => ({ col: k.col, type: k.type, missing: k.missing,
        avg: k.avg, min: k.min, max: k.max, unique: k.unique })) });
    assert.deepEqual(norm(x), norm(c));
  });

  test("coerces Date cells to YYYY-MM-DD", async () => {
    const buf = await xlsxBuffer(ws => {
      ws.addRow(["when", "n"]);
      ws.addRow([new Date("2025-06-15T12:00:00Z"), 1]);
      ws.addRow([new Date("2025-06-16T00:00:00Z"), 2]);
    });
    const r = await parseFileStreaming(buf, "d.xlsx");
    const dates = r.sampleRows.map(row => row[0]);
    assert.ok(dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)), `dates normalized: ${dates}`);
  });

  test("uses a formula cell's computed result, never its text", async () => {
    const buf = await xlsxBuffer(ws => {
      ws.addRow(["a", "b", "total"]);
      const row = ws.addRow([10, 20, null]);
      row.getCell(3).value = { formula: "A2+B2", result: 30 };
    });
    const r = await parseFileStreaming(buf, "f.xlsx");
    const total = r.colAnalysis.find(c => c.col === "total");
    assert.equal(total.type, "numeric");
    assert.equal(total.min, 30);
    assert.equal(total.max, 30);
  });

  test("a stray cell beyond the header does NOT create a phantom column", async () => {
    const buf = await xlsxBuffer(ws => {
      ws.addRow(["x", "y"]);          // 2 columns declared
      ws.addRow([1, 2]);
      const row = ws.addRow([3, 4]);
      row.getCell(5).value = 999;     // stray value in column 5
    });
    const r = await parseFileStreaming(buf, "s.xlsx");
    assert.equal(r.headers.length, 2, "only the two declared columns");
    assert.deepEqual(r.headers, ["x", "y"]);
  });

  test("treats error cells as missing", async () => {
    const buf = await xlsxBuffer(ws => {
      ws.addRow(["v", "label"]);
      ws.addRow([100, "a"]);
      ws.addRow([{ error: "#DIV/0!" }, "b"]);   // error in a row that still has data
      ws.addRow([200, "c"]);
    });
    const r = await parseFileStreaming(buf, "e.xlsx");
    assert.equal(r.totalRows, 3, "the error row still counts — it has a label");
    const v = r.colAnalysis.find(c => c.col === "v");
    assert.equal(v.missing, 1, "the #DIV/0! cell counts as missing");
  });

  test("empty sheet yields zero rows, not a crash", async () => {
    const buf = await xlsxBuffer(() => {});
    const r = await parseFileStreaming(buf, "empty.xlsx");
    assert.equal(r.totalRows, 0);
    assert.deepEqual(r.headers, []);
  });
});

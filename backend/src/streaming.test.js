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

describe("missing values in short rows", () => {
  test("cells absent from a short row count as missing", async () => {
    // Regression: ingest walked the ROW, so a row shorter than the header
    // never visited the trailing columns and their absent cells were invisible
    // rather than missing. Real exports drop trailing empty fields constantly,
    // so a 113k-row file reported MISSING = 0 and an inflated quality grade.
    const csv = ["a,b,c,d,e", "1,2,3,4,5", "1,2,3", "1,2,3,4,5", "1,2", "1,2,3,4,"].join("\n");
    const res = await parseFileStreaming(Buffer.from(csv), "short.csv");
    const byCol = Object.fromEntries(res.colAnalysis.map(c => [c.col, c.missing]));
    assert.equal(byCol.c, 1, "one row stops before c");
    assert.equal(byCol.d, 2);
    assert.equal(byCol.e, 3, "two short rows plus one explicit empty");
    assert.equal(res.colAnalysis.reduce((s, c) => s + (c.missing || 0), 0), 6);
  });

  test("a fully populated file still reports no missing", async () => {
    const csv = ["a,b,c", "1,2,3", "4,5,6"].join("\n");
    const res = await parseFileStreaming(Buffer.from(csv), "full.csv");
    assert.equal(res.colAnalysis.reduce((s, c) => s + (c.missing || 0), 0), 0);
  });
});

describe("duplicate detection", () => {
  test("a wide export with repeating leading columns is NOT all duplicates", async () => {
    // Regression: duplicates were keyed on the first FOUR columns only. A real
    // Amazon sales export beginning date,region,category,channel reported
    // 111,152 duplicates out of 113,036 rows — 98% — because those four repeat
    // constantly while an order id further along makes each row unique.
    const lines = ["date,region,category,channel,sku,qty"];
    let id = 0;
    for (const d of ["2024-01-05", "2024-01-06"])
      for (const r of ["North", "South"])
        for (const c of ["Books", "Toys"])
          for (let k = 0; k < 10; k++) lines.push(`${d},${r},${c},Retail,SKU-${++id},${k}`);
    const res = await parseFileStreaming(Buffer.from(lines.join("\n")), "wide.csv");
    assert.equal(res.totalRows, 80);
    assert.equal(res.dupeCount, 0, "every row is unique beyond column four");
  });

  test("genuine duplicates are still counted", async () => {
    const csv = ["a,b,c", "1,2,3", "1,2,3", "4,5,6", "1,2,3"].join("\n");
    const res = await parseFileStreaming(Buffer.from(csv), "d.csv");
    assert.equal(res.dupeCount, 2);
  });

  test("rows differing only in the last column are distinct", async () => {
    const csv = ["a,b,c,d,e", "1,1,1,1,X", "1,1,1,1,Y", "1,1,1,1,Z"].join("\n");
    const res = await parseFileStreaming(Buffer.from(csv), "t.csv");
    assert.equal(res.dupeCount, 0);
  });
});

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

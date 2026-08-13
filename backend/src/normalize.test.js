/**
 * normalize.test.js — v20 "Messy File Layer"
 *
 * Two layers of coverage:
 *   1. Pure-function units (normalize.js) — Thai numbers, พ.ศ. dates,
 *      TIS-620 decoding, delimiter sniffing, header detection.
 *   2. End-to-end through parseFileStreaming — the fixtures below are
 *      shaped like real Thai shop exports (banner rows, ฿ amounts,
 *      Buddhist-Era dates, legacy encodings).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseFileStreaming } from "./services/streaming.js";
import {
  cleanCell, thaiDigitsToArabic, parseFlexibleNumber, parseFlexibleDate,
  decodeSmart, sniffDelimiter, detectHeaderRow, finalizeHeaders,
} from "./services/normalize.js";

// Encode a JS string to TIS-620 bytes (inverse of the decoder's Thai block).
function toTis620(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) bytes.push(cp);
    else if (cp >= 0x0E01 && cp <= 0x0E5B) bytes.push(cp - 0x0D60);
    else throw new Error(`not TIS-620 encodable: ${ch}`);
  }
  return Buffer.from(bytes);
}

async function xlsxBuffer(build) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  build(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── 1. cleanCell / Thai digits ──────────────────────────────
describe("column names are unique", () => {
  test("repeated headers are made distinguishable", () => {
    // Excel exports and merged reports repeat a header constantly. Everything
    // downstream resolves a column by NAME — the statistical tests, the fix
    // catalogue, the AI edit path, the correlation matrix — and all of them
    // land on the first match, so the second column was unreachable: a user
    // picking it in the UI silently got the first one's data.
    assert.deepEqual(finalizeHeaders(["ยอดขาย", "ยอดขาย", "ยอดขาย"]),
      ["ยอดขาย", "ยอดขาย (2)", "ยอดขาย (3)"]);
  });

  test("renaming cannot create a NEW collision", () => {
    // A plain counter reintroduced the bug it fixes: a file already holding
    // "a (2)" met a duplicate "a", which was also renamed to "a (2)".
    for (const cells of [["a", "a", "a (2)"], ["a (2)", "a", "a"], ["a", "a (2)", "a", "a (3)", "a"]]) {
      const out = finalizeHeaders(cells);
      assert.equal(out.length, new Set(out).size, `collision in ${JSON.stringify(out)}`);
    }
  });

  test("names that are already unique are left alone", () => {
    assert.deepEqual(finalizeHeaders(["a", "b", "c"]), ["a", "b", "c"]);
    // Case matters in a CSV: Revenue and revenue are different columns.
    assert.deepEqual(finalizeHeaders(["Revenue", "revenue"]), ["Revenue", "revenue"]);
  });

  test("blanks are still named and trailing ones still dropped", () => {
    assert.deepEqual(finalizeHeaders(["a", "", "c"]), ["a", "col_1", "c"]);
    assert.deepEqual(finalizeHeaders(["", "", ""]), []);
  });
});


describe("year disambiguation stays plausible", () => {
  test("two-digit years that would land decades ahead read as the past", () => {
    // "69" means BE 2569 in Thai documents, so the rule mapped two-digit years
    // to 25xx. The same rule sent "95" to CE 2052 and "99" to CE 2056 — a 1995
    // sales record dated thirty years in the future, silently corrupting every
    // date range and trend built on it.
    assert.equal(parseFlexibleDate("14/01/95").iso, "1995-01-14");
    assert.equal(parseFlexibleDate("14/01/99").iso, "1999-01-14");
    assert.equal(parseFlexibleDate("14/01/90").iso, "1990-01-14");
  });

  test("two-digit years near today still read as Buddhist Era", () => {
    assert.equal(parseFlexibleDate("14/01/68").iso, "2025-01-14");
    assert.equal(parseFlexibleDate("14/01/69").iso, "2026-01-14");
    assert.equal(parseFlexibleDate("14/01/69").be, true);
  });

  test("expiry dates a few years out are NOT rejected", () => {
    // Pharmacy files carry วันหมดอายุ legitimately in the future, so the
    // plausibility window has to be wide enough to keep them.
    assert.equal(parseFlexibleDate("30/06/2570").iso, "2027-06-30");
    assert.equal(parseFlexibleDate("31/12/2575").iso, "2032-12-31");
  });

  test("a four-digit year landing centuries ahead is refused", () => {
    // BE 2799 became CE 2256 and was accepted without complaint.
    assert.equal(parseFlexibleDate("2799-12-31"), null);
    assert.equal(parseFlexibleDate("2599-01-14"), null);
  });

  test("the historical cases the parser was built for still hold", () => {
    assert.equal(parseFlexibleDate("2482-01-01").iso, "1939-01-01");
    assert.equal(parseFlexibleDate("2543-01-01").iso, "2000-01-01");
    assert.equal(parseFlexibleDate("๑๔/๐๑/๒๕๖๙").iso, "2026-01-14");
  });
});


describe("cleanCell + thaiDigitsToArabic", () => {
  test("strips zero-width chars and NBSP", () => {
    assert.equal(cleanCell("\u200Bราคา\u00A0ขาย\uFEFF"), "ราคา ขาย");
  });
  test("null/undefined → empty string", () => {
    assert.equal(cleanCell(null), "");
    assert.equal(cleanCell(undefined), "");
  });
  test("Thai digits convert, other chars untouched", () => {
    assert.equal(thaiDigitsToArabic("๑๒๓.๕๐ บาท"), "123.50 บาท");
  });
});

// ── 2. parseFlexibleNumber ──────────────────────────────────
describe("parseFlexibleNumber", () => {
  const cases = [
    ["1234", 1234],            // plain fast path
    ["-45.5", -45.5],
    ["1,234.50", 1234.5],      // thousands grouping
    ["12,345,678", 12345678],
    ["฿1,200", 1200],          // baht symbol
    ["1,200 บาท", 1200],       // baht word
    ["THB 5,000", 5000],
    ["$99.99", 99.99],
    ["(500)", -500],           // accounting negative
    ["(1,250.75)", -1250.75],
    ["12.5%", 12.5],           // percent → bare number
    ["๑๒๓", 123],              // Thai digits
    ["฿๙๙๙", 999],
    ["+42", 42],
    ["  60 ", 60],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      assert.equal(parseFlexibleNumber(input), expected);
    });
  }
  const rejects = ["", "12abc", "1,23", "abc", "1.2.3", "--5", "12-34", null];
  for (const input of rejects) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(parseFlexibleNumber(input), null);
    });
  }
});

// ── 3. parseFlexibleDate ────────────────────────────────────
describe("parseFlexibleDate", () => {
  test("ISO CE passes through", () => {
    assert.deepEqual(parseFlexibleDate("2026-01-14"), { iso: "2026-01-14", be: false });
  });
  test("ISO with time part", () => {
    assert.deepEqual(parseFlexibleDate("2026-01-14 10:30:00"), { iso: "2026-01-14", be: false });
  });
  test("ISO Buddhist Era converts (2569 → 2026)", () => {
    assert.deepEqual(parseFlexibleDate("2569-01-14"), { iso: "2026-01-14", be: true });
  });
  test("d/m/y Buddhist Era", () => {
    assert.deepEqual(parseFlexibleDate("14/01/2569"), { iso: "2026-01-14", be: true });
  });
  test("d/m/y CE", () => {
    assert.deepEqual(parseFlexibleDate("14/01/2026"), { iso: "2026-01-14", be: false });
  });
  test("2-digit year ≥43 is BE (14/1/69 → 2026)", () => {
    assert.deepEqual(parseFlexibleDate("14/1/69"), { iso: "2026-01-14", be: true });
  });
  test("2-digit year <43 is CE (14/1/26 → 2026)", () => {
    assert.deepEqual(parseFlexibleDate("14/1/26"), { iso: "2026-01-14", be: false });
  });
  test("US m/d/y detected via impossible month and swapped", () => {
    assert.deepEqual(parseFlexibleDate("01/25/2026"), { iso: "2026-01-25", be: false });
  });
  test("dot separators (14.07.2569)", () => {
    assert.deepEqual(parseFlexibleDate("14.07.2569"), { iso: "2026-07-14", be: true });
  });
  test("Thai month abbreviation with dots", () => {
    assert.deepEqual(parseFlexibleDate("14 ม.ค. 2569"), { iso: "2026-01-14", be: true });
  });
  test("Thai month abbreviation without dots", () => {
    assert.deepEqual(parseFlexibleDate("14 มค 69"), { iso: "2026-01-14", be: true });
  });
  test("Thai full month name", () => {
    assert.deepEqual(parseFlexibleDate("7 ธันวาคม 2568"), { iso: "2025-12-07", be: true });
  });
  test("Thai digits inside a date", () => {
    assert.deepEqual(parseFlexibleDate("๑๔/๐๑/๒๕๖๙"), { iso: "2026-01-14", be: true });
  });
  test("YYYY-MM month series → first of month", () => {
    assert.deepEqual(parseFlexibleDate("2025-01"), { iso: "2025-01-01", be: false });
  });
  const rejects = ["31/02/2569", "hello", "1234", "555-1234", "2025.01", "99/99/99", ""];
  for (const input of rejects) {
    test(`rejects "${input}"`, () => {
      assert.equal(parseFlexibleDate(input), null);
    });
  }
});

// ── 4. decodeSmart ──────────────────────────────────────────
describe("decodeSmart", () => {
  test("valid UTF-8 detected", () => {
    const r = decodeSmart(Buffer.from("ชื่อ,ราคา\nน้ำปลา,25", "utf8"));
    assert.equal(r.encoding, "utf-8");
    assert.ok(r.text.includes("น้ำปลา"));
  });
  test("TIS-620 Thai bytes detected and decoded", () => {
    const r = decodeSmart(toTis620("สินค้า,ราคา\nขนม,10"));
    assert.equal(r.encoding, "windows-874");
    assert.ok(r.text.includes("สินค้า"));
    assert.ok(r.text.includes("ขนม,10"));
  });
  test("UTF-16LE BOM detected", () => {
    const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from("a\tb\nค\t1", "utf16le")]);
    const r = decodeSmart(utf16);
    assert.equal(r.encoding, "utf-16le");
    assert.ok(r.text.includes("ค\t1"));
  });
  test("baht sign ฿ (TIS-620 0xDF) round-trips", () => {
    const r = decodeSmart(toTis620("฿100"));
    assert.ok(r.text.includes("฿100"));
  });
});

// ── 5. sniffDelimiter ───────────────────────────────────────
describe("sniffDelimiter", () => {
  test("comma", () => assert.equal(sniffDelimiter("a,b,c\n1,2,3\n4,5,6"), ","));
  test("semicolon", () => assert.equal(sniffDelimiter("a;b;c\n1;2;3\n4;5;6"), ";"));
  test("tab (Excel Unicode Text export)", () => assert.equal(sniffDelimiter("a\tb\tc\n1\t2\t3"), "\t"));
  test("pipe", () => assert.equal(sniffDelimiter("a|b|c\n1|2|3"), "|"));
  test("commas inside a semicolon file don't win", () => {
    assert.equal(sniffDelimiter('name;price\n"x, y";10\n"z, w";20'), ";");
  });
});

// ── 6. detectHeaderRow / finalizeHeaders ────────────────────
describe("detectHeaderRow", () => {
  test("clean file keeps row 0", () => {
    assert.equal(detectHeaderRow([["name", "price"], ["a", "1"], ["b", "2"]]), 0);
  });
  test("single-cell banner row is skipped", () => {
    assert.equal(detectHeaderRow([["รายงานยอดขาย ประจำเดือน"], ["สินค้า", "ราคา"], ["ขนม", "10"]]), 1);
  });
  test("banner + blank row skipped", () => {
    assert.equal(detectHeaderRow([["Sales Report", ""], ["", ""], ["item", "qty"], ["a", "1"]]), 2);
  });
  test("all-numeric data with no header keeps row 0 (legacy behavior)", () => {
    assert.equal(detectHeaderRow([["1", "2"], ["3", "4"], ["5", "6"]]), 0);
  });
  test("empty input → 0", () => assert.equal(detectHeaderRow([]), 0));
});

describe("finalizeHeaders", () => {
  test("trailing empties dropped, gaps named col_i", () => {
    assert.deepEqual(finalizeHeaders(["a", "", "c", "", ""]), ["a", "col_1", "c"]);
  });
});

// ── 7. End-to-end: messy Thai CSV ───────────────────────────
describe("E2E messy Thai files", () => {
  const messyCsv =
    "รายงานยอดขาย ร้านป้าศรี\n" +                       // banner row
    "วันที่,สินค้า,จำนวน,ยอดขาย\n" +
    "14/01/2569,น้ำปลา,12,\"฿1,200.50\"\n" +
    "15/01/2569,ข้าวสาร,5,\"฿2,750\"\n" +
    "16/01/2569,น้ำตาล,๘,\"(500)\"\n";

  test("banner skipped, header found, Thai values coerced", async () => {
    const r = await parseFileStreaming(Buffer.from(messyCsv, "utf8"), "sales.csv");
    assert.deepEqual(r.headers, ["วันที่", "สินค้า", "จำนวน", "ยอดขาย"]);
    assert.equal(r.totalRows, 3);
    assert.equal(r.normalization.skippedPreHeaderRows, 1);
    assert.equal(r.normalization.encoding, "utf-8");

    const qty = r.colAnalysis.find(c => c.col === "จำนวน");
    assert.equal(qty.type, "numeric");
    assert.equal(qty.max, 12);
    assert.equal(qty.min, 5);          // ๘ → 8 sits between

    const sales = r.colAnalysis.find(c => c.col === "ยอดขาย");
    assert.equal(sales.type, "numeric");
    assert.equal(sales.min, -500);      // (500) accounting negative
    assert.equal(sales.max, 2750);      // ฿2,750 — old parseFloat read this as 2

    const date = r.colAnalysis.find(c => c.col === "วันที่");
    assert.equal(date.type, "text");    // contract-safe
    assert.equal(date.semantic, "date");
    assert.equal(date.buddhistEra, true);
    assert.deepEqual(date.dateRange, { min: "2026-01-14", max: "2026-01-16" });
  });

  test("TIS-620 encoded CSV decodes to correct Thai headers", async () => {
    const buf = toTis620("สินค้า,ราคา\nขนม,10\nนม,25\n");
    const r = await parseFileStreaming(buf, "legacy.csv");
    assert.deepEqual(r.headers, ["สินค้า", "ราคา"]);
    assert.equal(r.normalization.encoding, "windows-874");
    assert.equal(r.colAnalysis.find(c => c.col === "ราคา").max, 25);
  });

  test("semicolon-delimited file parses into columns", async () => {
    const r = await parseFileStreaming(Buffer.from("a;b\n1;2\n3;4\n"), "semi.csv");
    assert.deepEqual(r.headers, ["a", "b"]);
    assert.equal(r.normalization.delimiter, ";");
    assert.equal(r.totalRows, 2);
  });

  test("UTF-16LE tab file (Excel 'Unicode Text') parses", async () => {
    const body = "ชื่อ\tยอด\nกาแฟ\t45\nชา\t30";
    const buf = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(body, "utf16le")]);
    const r = await parseFileStreaming(buf, "unicode.csv");
    assert.deepEqual(r.headers, ["ชื่อ", "ยอด"]);
    assert.equal(r.normalization.encoding, "utf-16le");
    assert.equal(r.normalization.delimiter, "\t");
    assert.equal(r.colAnalysis.find(c => c.col === "ยอด").max, 45);
  });

  test("all-blank comma lines are not counted as rows", async () => {
    const r = await parseFileStreaming(Buffer.from("a,b\n1,2\n,,\n3,4\n"), "blank.csv");
    assert.equal(r.totalRows, 2);
  });

  test("ISO date column no longer masquerades as numeric", async () => {
    const r = await parseFileStreaming(Buffer.from("when,v\n2026-01-01,5\n2026-01-02,7\n2026-01-03,9\n"), "d.csv");
    const when = r.colAnalysis.find(c => c.col === "when");
    assert.equal(when.type, "text");
    assert.equal(when.semantic, "date");
    assert.equal(when.buddhistEra, false);
  });

  test("XLSX with banner row above header is detected", async () => {
    const buf = await xlsxBuffer(ws => {
      ws.addRow(["รายงานสต็อกสินค้า"]);            // banner
      ws.addRow(["สินค้า", "คงเหลือ", "หมดอายุ"]);
      ws.addRow(["พาราเซตามอล", 120, "14/03/2569"]);
      ws.addRow(["ยาแก้ไอ", 40, "01/06/2569"]);
    });
    const r = await parseFileStreaming(buf, "stock.xlsx");
    assert.deepEqual(r.headers, ["สินค้า", "คงเหลือ", "หมดอายุ"]);
    assert.equal(r.normalization.skippedPreHeaderRows, 1);
    assert.equal(r.totalRows, 2);
    const exp = r.colAnalysis.find(c => c.col === "หมดอายุ");
    assert.equal(exp.semantic, "date");
    assert.equal(exp.buddhistEra, true);
    assert.deepEqual(exp.dateRange, { min: "2026-03-14", max: "2026-06-01" });
  });

  test("clean files behave exactly as before (regression guard)", async () => {
    const r = await parseFileStreaming(Buffer.from("region,units\nBKK,120\nCNX,40\n"), "clean.csv");
    assert.deepEqual(r.headers, ["region", "units"]);
    assert.equal(r.normalization.skippedPreHeaderRows, 0);
    assert.equal(r.normalization.encoding, "utf-8");
    assert.equal(r.normalization.delimiter, ",");
    const units = r.colAnalysis.find(c => c.col === "units");
    assert.equal(units.type, "numeric");
    assert.equal(units.avg, 80);
  });
});

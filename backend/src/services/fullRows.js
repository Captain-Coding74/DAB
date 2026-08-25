/**
 * Read EVERY row of an uploaded file.
 *
 * parseFileStreaming returns `sampleRows`, a bounded reservoir sample — five
 * rows regardless of file size. That is right for a preview and wrong for
 * anything that computes a number a user will act on. Four separate features
 * were silently running on those five rows before this existed: charts,
 * trends, correlations, and the hypothesis tests.
 *
 * Shared by routes/fixes.js and routes/inference.js so the two cannot drift.
 */
/**
 * Read every row. parseAllRows is CSV/TSV/TXT only and SYNC — it has sync
 * callers (computeStatsBundle) that cannot await. parseAllRowsAny below adds
 * .xlsx (exceljs must load the whole workbook, which is acceptable: the
 * upload limit already bounds it, and streaming.js pays the same cost).
 * Returns { headers: null } for unsupported input so the caller can say why.
 *
 * Built on the SAME normalization layer and csv-parse options as streaming.js
 * (encoding detection, delimiter sniffing, header-row detection, quoted cells
 * with embedded newlines), so this view of the file cannot drift from the one
 * colAnalysis was computed on. It used to split on newlines with a hand-rolled
 * quote machine: a quoted address containing "\n" became two malformed rows,
 * TIS-620 files decoded to mojibake, and semicolon CSVs collapsed to one
 * column — corruption a fix then persisted as a new dataset version.
 */
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { cleanCell, decodeSmart, sniffDelimiter, detectHeaderRow, finalizeHeaders } from "./normalize.js";

function parseAllRows(buffer, fileName) {
  if (!/\.(csv|tsv|txt)$/i.test(fileName || "")) return { headers: null, rows: null };

  const { text } = decodeSmart(buffer);
  const delimiter = sniffDelimiter(text);
  const records = parse(text, { bom: true, trim: true, skip_empty_lines: true, relax_column_count: true, delimiter })
    .map((r) => r.map(cleanCell));
  if (!records.length) return { headers: [], rows: [] };

  const hIdx    = detectHeaderRow(records.slice(0, 10));
  const headers = finalizeHeaders(records[hIdx]);
  const rows    = records.slice(hIdx + 1)
    .filter((r) => !r.every((v) => v === "")); // ",,," lines are not data (parity with streaming)
  return { headers, rows };
}

/**
 * Flatten one exceljs cell to the flat string the pipeline expects.
 *
 * LOCAL MIRROR of streaming.js's cellToString (~line 315), duplicated on
 * purpose: that helper is private to streaming.js, and exporting it would
 * widen a module boundary just to save eleven lines. The semantics MUST stay
 * identical — this file's view of an xlsx must match the one colAnalysis was
 * computed on, or a fix would persist rows the stats never described:
 *   - Date        → "YYYY-MM-DD"
 *   - formula     → its cached .result (never the formula text)
 *   - hyperlink   → the visible text
 *   - rich text   → concatenated runs
 *   - error       → "" (treated as missing, as in streaming)
 */
function xlsxCellToString(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "object") {
    if (value.error) return "";                                   // #DIV/0! etc → missing
    if ("result" in value) return xlsxCellToString(value.result); // formula cell
    if ("text" in value)   return String(value.text).trim();      // hyperlink
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("").trim();
    return "";
  }
  return String(value).trim();
}

/** Legacy .xls (Excel 97-2003) is an OLE compound document, not a zip —
    exceljs cannot read it. Same magic check parseFileStreaming uses. */
const isLegacyXls = (buffer) =>
  buffer.length >= 4 &&
  buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;

/** Read every row of an .xlsx: first worksheet, same header detection as the
    CSV path, rows aligned to the header width, empty rows dropped. */
async function parseAllRowsXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount === 0) return { headers: [], rows: [] };

  // Materialise each row only out to its own last non-empty cell; the header
  // row, not ws.columnCount, decides the final width (a stray value low in
  // the sheet must not manufacture a phantom column — parity with streaming).
  const records = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const excelRow = ws.getRow(r);
    let extent = 0;
    excelRow.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      if (colNumber > extent) extent = colNumber;
    });
    const cells = [];
    for (let c = 1; c <= extent; c++) cells.push(cleanCell(xlsxCellToString(excelRow.getCell(c).value)));
    records.push(cells);
  }
  if (!records.length) return { headers: [], rows: [] };

  const hIdx    = detectHeaderRow(records.slice(0, 10));
  const headers = finalizeHeaders(records[hIdx] || []);
  if (!headers.length) return { headers: [], rows: [] };

  // Align every data row to the header width (Excel drops trailing blanks on
  // short rows; downstream consumers index cells by header position), THEN
  // drop rows that are empty within that width — a value beyond the header
  // is outside the table, exactly as the streaming parser treats it.
  const rows = records.slice(hIdx + 1)
    .map((r) => headers.map((_, i) => r[i] ?? ""))
    .filter((r) => !r.every((v) => v === ""));
  return { headers, rows };
}

/**
 * Read every row of ANY supported upload.
 *
 * Async because the xlsx path must be (exceljs load is promise-based); the
 * sync parseAllRows stays exported unchanged for its existing sync callers
 * (analysisPipeline's computeStatsBundle cannot go async). CSV/TSV/TXT
 * delegates to parseAllRows, so the two views cannot drift. Genuinely
 * unsupported input — legacy .xls (OLE magic), unknown extensions — returns
 * { headers: null, rows: null } so the caller can say why.
 */
async function parseAllRowsAny(buffer, fileName) {
  const name = fileName || "";
  if (/\.(csv|tsv|txt)$/i.test(name)) return parseAllRows(buffer, fileName);
  if (/\.(xlsx|xls)$/i.test(name)) {
    // A ".xls" that is really a zipped OOXML still parses (parity with
    // parseFileStreaming); only the true OLE-container legacy format bails.
    if (isLegacyXls(buffer)) return { headers: null, rows: null };
    return parseAllRowsXlsx(buffer);
  }
  return { headers: null, rows: null };
}

export { parseAllRows, parseAllRowsAny };

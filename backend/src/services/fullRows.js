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
 * Read every row. CSV only, and deliberately so: an xlsx would need the whole
 * workbook in memory, and the fix catalogue is aimed at survey exports.
 * Returns { headers: null } for anything else so the caller can say why.
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

export { parseAllRows };

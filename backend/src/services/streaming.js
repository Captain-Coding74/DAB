/**
 * src/services/streaming.js — Streaming parser for large files
 *
 * Strategy:
 *   - Files < 5MB  → buffer parse (fast, same as before)
 *   - Files ≥ 5MB  → stream parse row-by-row, compute stats
 *                    incrementally without loading full dataset
 *                    into memory
 *
 * Uses Node.js Streams + csv-parse in streaming mode.
 * XLSX: exceljs load + row iteration (SheetJS removed in v15 — unpatched CVEs).
 *
 * v20 — "Messy File Layer" (see services/normalize.js):
 *   - CSV encoding detection: UTF-8 / UTF-16 / TIS-620 (windows-874)
 *   - Delimiter sniffing (, ; tab |)
 *   - Header-row detection: skips report titles / banner rows above the table
 *   - Thai-aware value coercion for STATS ONLY: "฿1,234.50" → 1234.5,
 *     "14 ม.ค. 2569" (พ.ศ.) → date. Original strings are preserved in
 *     sampleRows and frequency tables — we normalize numbers, not data.
 *   - Date-majority columns keep type:"text" (the numeric/text contract is
 *     unchanged for downstream consumers) but gain semantic:"date",
 *     dateRange {min,max} and a buddhistEra flag. This also FIXES a bug:
 *     parseFloat("2026-01-14") === 2026, so date columns used to masquerade
 *     as numeric with avg ≈ the year.
 */

import { parse }  from "csv-parse";
import ExcelJS   from "exceljs";
import { Readable } from "stream";
import { serviceLogger } from "../logger.js";
import { PairAccumulator, buildCorrelation } from "./pairwise.js";
import { cleanCell, parseFlexibleNumber, parseFlexibleDate,
         decodeSmart, sniffDelimiter, detectHeaderRow, finalizeHeaders } from "./normalize.js";

const log = serviceLogger("streaming");

const STREAM_THRESHOLD = 5 * 1024 * 1024; // 5 MB
const HEADER_SCAN = 10; // rows buffered up-front to locate the real header

// ── Online statistics (Welford's algorithm) ───────────────
// Computes mean, variance, min, max in a single pass
// without storing all values — O(1) memory
class OnlineStat {
  constructor() {
    this.n = 0; this.mean = 0; this.M2 = 0;
    this.min = Infinity; this.max = -Infinity; this.sum = 0;
  }
  update(x) {
    this.n++; this.sum += x;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    this.M2   += delta * (x - this.mean);
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }
  result() {
    return {
      count:  this.n,
      sum:    this.sum,
      avg:    this.mean,
      min:    this.min === Infinity  ? null : this.min,
      max:    this.max === -Infinity ? null : this.max,
      stdDev: this.n > 1 ? Math.sqrt(this.M2 / this.n) : 0,
    };
  }
}

// ── Frequency counter (capped at 10k unique values) ───────
class FreqCounter {
  constructor(cap = 10_000) { this.freq = new Map(); this.cap = cap; this.overflow = false; }
  update(v) {
    if (this.freq.has(v)) { this.freq.set(v, this.freq.get(v) + 1); return; }
    if (this.freq.size >= this.cap) { this.overflow = true; return; }
    this.freq.set(v, 1);
  }
  top(n = 10) {
    return [...this.freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, count, pct: (count / [...this.freq.values()].reduce((a,b)=>a+b,0) * 100).toFixed(1) }));
  }
  get unique() { return this.freq.size; }
}

/**
 * A compact fingerprint of an ENTIRE row.
 *
 * Duplicate detection used to hash only the first four columns "to save
 * memory". On a wide export that is catastrophically wrong: an Amazon sales
 * file whose first columns are date, region, category and channel reported
 * 111,152 duplicates out of 113,036 rows — 98% — when the true count was
 * near zero, because the row is made unique by an order id further along.
 *
 * Hashing every cell fixes the correctness problem; hashing to a 64-bit
 * string rather than storing the row keeps the memory saving that motivated
 * the shortcut. FNV-1a over two offsets, so a collision needs both to clash.
 */
function rowFingerprint(row) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < row.length; i++) {
    const cell = String(row[i] ?? "");
    for (let j = 0; j < cell.length; j++) {
      h1 ^= cell.charCodeAt(j); h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 + cell.charCodeAt(j)) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    h1 ^= 0x7c; h1 = Math.imul(h1, 0x01000193) >>> 0;   // cell separator
    h2 = (h2 ^ 0x7c) >>> 0;
  }
  return `${h1.toString(36)}:${h2.toString(36)}`;
}

/* Deterministic PRNG (mulberry32) for the quantile reservoir below.
   Math.random would make two analyses of the SAME file disagree on
   median/quartiles once a column passes the reservoir cap — and this
   product's whole pitch is that the statistics are reproducible. Seeded
   per column from a constant, so a re-run gives identical numbers. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Reservoir sampler (keep N random rows for preview) ────
class ReservoirSampler {
  constructor(k = 5) { this.k = k; this.reservoir = []; this.n = 0; }
  update(row) {
    this.n++;
    if (this.reservoir.length < this.k) { this.reservoir.push(row); return; }
    const j = Math.floor(Math.random() * this.n);
    if (j < this.k) this.reservoir[j] = [...row];
  }
}

// ── Build per-column accumulators ─────────────────────────
function makeAccumulators(headers) {
  return headers.map((_, colIdx) => ({
    onlineStat:  new OnlineStat(),
    freqCounter: new FreqCounter(),
    missing:     0,
    numericCount: 0,
    dateCount:   0,          // v20: values recognized as dates
    beCount:     0,          // v20: of those, how many used พ.ศ. years
    dateMin:     null,       // v20: ISO range across the column
    dateMax:     null,
    totalCount:  0,
    // Reservoir for quantile estimation (Q1/Q2/Q3)
    // We keep up to 10k values for quantile accuracy.
    // Past the cap, Algorithm R keeps the sample uniform over the WHOLE
    // column — the old keep-the-first-10k made the "median" of a sorted
    // 113k-row export the ~4th percentile. Deterministic seed, see above.
    reservoir:   [],
    reservoirCap: 10_000,
    overflowQ:   false,
    quantileRng: mulberry32(0x9E3779B9 ^ colIdx),
    /* Trend sums over EVERY row in file order.
       autoForecast fitted its line to sampleRows — a reservoir SAMPLE in
       sampling order — which destroys the time sequence. On the bundled
       sales.csv the real columns trend at R2 0.80-0.85, but fitted to 5
       shuffled rows they came out at 0.02-0.05, so nothing cleared the
       0.5 threshold and the forecast tab was silently empty. Six numbers
       per column is all a least-squares line needs, and costs no memory. */
    /* After a column has shown its hand, stop guessing on every cell.
       parseFlexibleDate runs FIRST on every value — necessary, because
       parseFloat("2026-01-14") is 2026 and would leak dates into numeric
       stats. But on a 113k x 18 export that is 2 million date attempts,
       most on columns like "Completed" or "ORD-99213" that were never
       going to be dates. Once SNIFF_ROWS values have gone by with no date
       at all, skip the attempt for the rest of the column. */
    sniffed: 0, dateHopeless: false,
    trendN: 0, trendSx: 0, trendSy: 0, trendSxx: 0, trendSxy: 0, trendSyy: 0,
  }));
}

function updateAccumulator(acc, value) {
  acc.totalCount++;
  if (value === "" || value == null) { acc.missing++; return; }

  // v20: dates FIRST — parseFloat("2026-01-14") is 2026, which used to
  // leak date columns into numeric stats. Original string still feeds the
  // frequency table so top-values remain what the user typed.
  const d = acc.dateHopeless ? null : parseFlexibleDate(value);
  if (!acc.dateHopeless) {
    acc.sniffed++;
    // 200 values with not one date means this column has no dates in it.
    if (acc.sniffed >= 200 && acc.dateCount === 0) acc.dateHopeless = true;
  }
  if (d) {
    acc.dateCount++;
    if (d.be) acc.beCount++;
    if (acc.dateMin === null || d.iso < acc.dateMin) acc.dateMin = d.iso;
    if (acc.dateMax === null || d.iso > acc.dateMax) acc.dateMax = d.iso;
    acc.freqCounter.update(value);
    return;
  }

  // v20: flexible numbers ("฿1,234.50" → 1234.5) instead of bare parseFloat,
  // which read "1,234.50" as 1 and "12abc" as 12. Strict beats lenient.
  const n = parseFlexibleNumber(value);
  if (n !== null) {
    acc.numericCount++;
    acc.onlineStat.update(n);
    // x is the row position, so the fitted line is a trend over the file.
    const x = ++acc.trendN;
    acc.trendSx += x; acc.trendSy += n;
    acc.trendSxx += x * x; acc.trendSxy += x * n; acc.trendSyy += n * n;
    acc.freqCounter.update(value);
    if (acc.reservoir.length < acc.reservoirCap) acc.reservoir.push(n);
    else {
      // Algorithm R: the i-th value replaces a random slot with probability
      // cap/i, so every value has an equal chance of being in the sample.
      acc.overflowQ = true;
      const j = Math.floor(acc.quantileRng() * acc.numericCount);
      if (j < acc.reservoirCap) acc.reservoir[j] = n;
    }
  } else {
    acc.freqCounter.update(value);
  }
}

function finalizeColumn(col, acc) {
  /* Classify against NON-missing cells, like analyzeColumns (the reference
     behaviour): a 50%-blank survey column whose answers are all numeric is
     numeric, not text. totalCount includes blanks, so it was the wrong
     denominator. Guard 0 for header-only files — 0/0 rendered "NaN%" in the
     API payload and the AI prompt. */
  const present    = acc.totalCount - acc.missing;
  const missingPct = acc.totalCount ? ((acc.missing / acc.totalCount) * 100).toFixed(1) : "0.0";
  const isNumeric  = present > 0 && acc.numericCount > present * 0.6;
  if (isNumeric) {
    const s = acc.onlineStat.result();
    // Compute Q1/Q3/median from reservoir sample
    acc.reservoir.sort((a, b) => a - b);
    const r   = acc.reservoir;
    const n   = r.length;
    const mid = Math.floor(n / 2);
    const q2  = n % 2 !== 0 ? r[mid] : (r[mid-1] + r[mid]) / 2;
    const lower = n % 2 !== 0 ? r.slice(0, mid+1) : r.slice(0, mid);
    const upper = n % 2 !== 0 ? r.slice(mid)       : r.slice(mid);
    const q1  = lower.length ? lower[Math.floor(lower.length/2)] : null;
    const q3  = upper.length ? upper[Math.floor(upper.length/2)] : null;
    const iqr = (q1 != null && q3 != null) ? q3 - q1 : null;
    const outlierCount = iqr != null
      ? acc.reservoir.filter(v => v < q1 - 1.5*iqr || v > q3 + 1.5*iqr).length
      : 0;
    return {
      col, type: "numeric",
      count: s.count, missing: acc.missing,
      missingPct,
      min: s.min, max: s.max, avg: s.avg, median: q2,
      stdDev: s.stdDev, sum: s.sum, q1, q3, iqr, outlierCount,
      quantileApprox: acc.overflowQ,
      /* Exposed so autoForecast can fit a trend over the whole column in
         order, rather than over a shuffled sample of it. */
      trend: acc.trendN >= 4 ? {
        n: acc.trendN, sx: acc.trendSx, sy: acc.trendSy,
        sxx: acc.trendSxx, sxy: acc.trendSxy, syy: acc.trendSyy,
      } : null,
    };
  } else {
    const top = acc.freqCounter.top(10);
    const base = {
      col, type: "text",
      count: present, missing: acc.missing,
      missingPct,
      unique: acc.freqCounter.unique, top,
      uniqueApprox: acc.freqCounter.overflow,
    };
    // v20: date-majority columns keep type:"text" (contract-safe) but carry
    // semantic metadata for insights/charts.
    if (present > 0 && acc.dateCount > present * 0.6) {
      base.semantic    = "date";
      base.dateRange   = { min: acc.dateMin, max: acc.dateMax };
      base.buddhistEra = acc.beCount > 0;
    }
    return base;
  }
}

// ── CSV streaming parse ───────────────────────────────────
async function streamCSV(buffer) {
  // v20: decode legacy encodings BEFORE parsing (TIS-620 CSVs from Thai
  // Windows/Excel were mojibake before), then sniff the delimiter.
  const { text, encoding } = decodeSmart(buffer);
  const delimiter = sniffDelimiter(text);

  return new Promise((resolve, reject) => {
    let headers    = null;
    let accs       = null;
    let totalRows  = 0;
    let skipped    = 0;      // junk rows above the detected header
    let dupeCount  = 0;
    const dupeSet  = new Set();
    const sampler  = new ReservoirSampler(5);
    let pairs = null;   // built once headers are known
    const readable = Readable.from(text);

    const parser = parse({ bom: true, trim: true, skip_empty_lines: true, relax_column_count: true, delimiter });

    // Ingest one DATA row into stats.
    const ingest = (row) => {
      if (row.every(v => v === "")) return; // ",,," lines are not data (parity with XLSX)
      totalRows++;
      sampler.update(row);
      /* Walk the HEADER, not the row. A row shorter than the header is normal
         in real exports — trailing empty fields get dropped on the way out of
         Excel — and row.forEach simply never visits those cells, so they were
         invisible rather than missing. Measured: a 5-column file where two
         rows were short reported 1 missing cell instead of 6, and the quality
         grade rose because completeness was scored against a shrunken
         denominator. */
      for (let i = 0; i < accs.length; i++) {
        if (accs[i]) updateAccumulator(accs[i], i < row.length ? row[i] : "");
      }
        /* Correlations over every row, not over the five-row sample. */
        if (pairs) {
          pairs.update(accs.map((a, i) => {
            if (!a || a.dateCount > (a.totalCount - a.missing) * 0.5) return null;   // dates are not measurements
            return i < row.length ? parseFlexibleNumber(row[i]) : null;
          }));
        }
      const key = rowFingerprint(row);
      if (dupeSet.has(key)) dupeCount++;
      else dupeSet.add(key);
    };

    // v20: buffer the first rows, locate the real header (report titles /
    // banner rows above the table are common in shop exports), then flow.
    let pre = [];
    const flushPreBuffer = () => {
      const hIdx = detectHeaderRow(pre);
      skipped = hIdx;
      headers = finalizeHeaders(pre[hIdx]);
      accs    = makeAccumulators(headers);
      pairs   = new PairAccumulator(headers.length);
      for (let j = hIdx + 1; j < pre.length; j++) ingest(pre[j]);
      pre = null;
    };

    parser.on("data", (row) => {
      const cleaned = row.map(cleanCell);
      if (!headers) {
        pre.push(cleaned);
        if (pre.length >= HEADER_SCAN) flushPreBuffer();
        return;
      }
      ingest(cleaned);
    });

    parser.on("end", () => {
      if (!headers) {
        if (!pre || !pre.length) return reject(new Error("Empty CSV"));
        flushPreBuffer();
      }
      const colAnalysis = accs.map((acc, i) => finalizeColumn(headers[i], acc));
      resolve({ headers, colAnalysis, totalRows, dupeCount, sampleRows: sampler.reservoir,
             pairwise: pairs ? buildCorrelation(headers, colAnalysis, pairs) : null,
                normalization: { encoding, delimiter, skippedPreHeaderRows: skipped } });
    });

    parser.on("error", reject);
    readable.pipe(parser);
  });
}

// ── XLSX streaming parse (exceljs) ────────────────────────
// v15: migrated off `xlsx` (SheetJS), which shipped two unpatched HIGH CVEs
// (prototype pollution + ReDoS) with no fix available — unacceptable for a
// path that parses untrusted uploads. exceljs is actively maintained and
// its value model is explicit, so coercion is done deliberately below.

/**
 * Normalize one exceljs cell to the flat string the pipeline expects.
 * exceljs returns rich objects for some types; we flatten them the same way
 * the old SheetJS path did, so downstream stats are byte-identical:
 *   - Date        → "YYYY-MM-DD"
 *   - formula     → its computed .result (never the formula text)
 *   - hyperlink   → the visible text
 *   - rich text   → concatenated runs
 *   - error       → "" (treated as missing, as before)
 */
function cellToString(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "object") {
    if (value.error) return "";                              // #DIV/0! etc → missing
    if ("result" in value) return cellToString(value.result); // formula cell
    if ("text" in value)   return String(value.text).trim();   // hyperlink
    if (Array.isArray(value.richText)) return value.richText.map(r => r.text).join("").trim();
    if (value.formula && "result" in value) return cellToString(value.result);
    return "";
  }
  return String(value).trim();
}

async function streamXLSX(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount === 0) {
    return { headers: [], colAnalysis: [], totalRows: 0, dupeCount: 0, sampleRows: [],
             normalization: { encoding: null, delimiter: null, skippedPreHeaderRows: 0 } };
  }

  // v20: scan the first rows for the real header — Thai SME exports often
  // put a report title (merged cells) above the table. Column count still
  // comes from the HEADER row, not ws.columnCount: a stray value in a lower
  // row would otherwise manufacture a phantom "col_N" full of blanks.
  const scanLimit = Math.min(ws.rowCount, HEADER_SCAN);
  const scanned = [];
  for (let r = 1; r <= scanLimit; r++) {
    const excelRow = ws.getRow(r);
    let extent = 0;
    excelRow.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      if (colNumber > extent) extent = colNumber;
    });
    const cells = [];
    for (let c = 1; c <= extent; c++) cells.push(cleanCell(cellToString(excelRow.getCell(c).value)));
    scanned.push(cells);
  }

  const hIdx    = detectHeaderRow(scanned);
  const headers = finalizeHeaders(scanned[hIdx] || []);
  if (headers.length === 0) {
    return { headers: [], colAnalysis: [], totalRows: 0, dupeCount: 0, sampleRows: [],
             normalization: { encoding: null, delimiter: null, skippedPreHeaderRows: hIdx } };
  }
  const colCount = headers.length;

  let totalRows = 0, dupeCount = 0;
  const pairs = new PairAccumulator(headers.length);
  const accs    = makeAccumulators(headers);
  const sampler = new ReservoirSampler(5);
  const dupeSet = new Set();

  for (let r = hIdx + 2; r <= ws.rowCount; r++) {
    const excelRow = ws.getRow(r);
    const row = [];
    for (let c = 1; c <= colCount; c++) row.push(cleanCell(cellToString(excelRow.getCell(c).value)));
    if (row.every(v => v === "")) continue;

    totalRows++;
    sampler.update(row);
    // Same as the CSV path: walk the header width so cells absent from a
    // short row count as missing rather than vanishing.
    for (let i = 0; i < accs.length; i++) {
      if (accs[i]) updateAccumulator(accs[i], i < row.length ? row[i] : "");
    }
      pairs.update(accs.map((a, ci) => {
        if (!a || a.dateCount > (a.totalCount - a.missing) * 0.5) return null;
        return ci < row.length ? parseFlexibleNumber(row[ci]) : null;
      }));
    const key = rowFingerprint(row);
    if (dupeSet.has(key)) dupeCount++;
    else dupeSet.add(key);
  }

  const colAnalysis = accs.map((acc, i) => finalizeColumn(headers[i], acc));
  return { headers, colAnalysis, totalRows, dupeCount, sampleRows: sampler.reservoir,
           pairwise: buildCorrelation(headers, colAnalysis, pairs),
           normalization: { encoding: null, delimiter: null, skippedPreHeaderRows: hIdx } };
}

// ── Public API ────────────────────────────────────────────
/**
 * parseFileStreaming(buffer, originalName)
 *
 * Always streams — even small files go through the streaming path
 * so stats are computed in O(1) memory regardless of size.
 *
 * Returns:
 *   { headers, colAnalysis, totalRows, dupeCount, sampleRows, normalization }
 *   normalization: { encoding, delimiter, skippedPreHeaderRows }
 */
export async function parseFileStreaming(buffer, originalName) {
  const ext  = originalName.split(".").pop().toLowerCase();
  const size = buffer.length;
  const mode = size >= STREAM_THRESHOLD ? "streaming" : "buffered-stream";
  log.debug({ file: originalName, sizeKB: Math.round(size/1024), mode }, "Parsing file");

  /* Legacy .xls (Excel 97-2003) is an OLE compound document — exceljs only
     reads OOXML zips, so wb.xlsx.load() dies with an opaque "can't find end
     of central directory" 500. The upload filters accept .xls, so say what
     to do instead. A .xls that is really a zipped xlsx still parses below. */
  if (ext === "xls" && buffer.length >= 4 &&
      buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
    const err = new Error(
      "ไฟล์ .xls รุ่นเก่า (Excel 97-2003) ยังไม่รองรับ — เปิดใน Excel แล้วบันทึกเป็น .xlsx หรือ CSV ก่อนอัปโหลด " +
      "(legacy .xls is not supported — save the file as .xlsx or CSV first)");
    err.status = 415;
    throw err;
  }

  const t0     = performance.now();
  const result = ext === "xlsx" || ext === "xls"
    ? await streamXLSX(buffer)
    : await streamCSV(buffer);
  const ms     = Math.round(performance.now() - t0);

  log.info({ file: originalName, rows: result.totalRows, ms, mode,
             norm: result.normalization }, "File parsed");
  return { ...result, parseMs: ms };
}

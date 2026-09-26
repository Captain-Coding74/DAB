/**
 * services/zipGuard.js — decompression-bomb guard for .xlsx uploads.
 *
 * THE EXPOSURE
 * ------------
 * An .xlsx is a ZIP archive. The upload limit (MAX_UPLOAD_MB) bounds the
 * COMPRESSED bytes, but ExcelJS inflates every part into memory before it
 * parses a single row, and a crafted workbook — a sharedStrings.xml of a
 * hundred million spaces — deflates by 1000:1 or better. 25 MB in, 25 GB
 * out, and the process is gone. Uploads sit in memory (multer memoryStorage)
 * and /api/analyze takes them anonymously, so this was an unauthenticated
 * way to knock the server over.
 *
 * WHY MEASURE, NOT TRUST
 * ----------------------
 * The ZIP central directory declares each entry's uncompressed size, and a
 * header-only check would be cheap — but an attacker writes that header.
 * jszip (under ExcelJS) inflates the stream to its actual end and only then
 * notices the size lied, by which point the memory is spent. So this guard
 * inflates each deflated entry itself through a streaming zlib inflater that
 * COUNTS output and discards it: constant memory, one extra inflate pass
 * (fast — inflate runs at hundreds of MB/s), and a number that cannot lie.
 * The moment the running total passes the budget, the stream is destroyed
 * and the upload is refused before ExcelJS ever sees it.
 *
 * BUDGET
 * ------
 * A real workbook inflates about 8× (measured: 100k rows × 8 Thai columns,
 * 3.7 MB → 29.6 MB), so the default is 10 × MAX_UPLOAD_MB — every honest
 * file at the size limit still fits; a bomb does not. MAX_XLSX_INFLATED_MB
 * overrides it.
 *
 * SCOPE
 * -----
 * Structural problems (no central directory, truncated entries) are NOT this
 * guard's to report — it returns quietly and ExcelJS raises its own error
 * exactly as before. This module only answers one question: will inflating
 * this archive stay inside the budget?
 */
import zlib from "node:zlib";
import { MAX_XLSX_INFLATED_BYTES, MAX_XLSX_INFLATED_MB } from "../config.js";

const SIG_EOCD      = 0x06054b50;
const SIG_EOCD64    = 0x06064b50;
const SIG_EOCD64LOC = 0x07064b50;
const SIG_CENTRAL   = 0x02014b50;
const SIG_LOCAL     = 0x04034b50;
const MAX_ENTRIES   = 10_000;   // a workbook has ~16; thousands is not a workbook

export class ZipBombError extends Error {
  constructor(inflated, limit) {
    const mb = (n) => Math.round(n / 1048576);
    super(`ไฟล์ .xlsx ขยายตัวเกิน ${mb(limit)} MB เมื่อเปิด — ไฟล์อาจเสียหายหรือถูกสร้างมาเพื่อโจมตี ` +
          `(workbook inflates past the ${mb(limit)} MB limit; refused before parsing)`);
    this.name = "ZipBombError";
    this.status = 413;
    this.inflated = inflated;
    this.limit = limit;
  }
}

/** Locate the end-of-central-directory record; null if there is none. */
function findEocd(buf) {
  // EOCD is 22 bytes plus an optional comment of up to 65535 bytes.
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let p = buf.length - 22; p >= floor; p--) {
    if (buf.readUInt32LE(p) === SIG_EOCD) return p;
  }
  return null;
}

/**
 * Parse the central directory. Returns [] for anything that is not a
 * readable ZIP — the caller lets ExcelJS produce its own error for those.
 * Supports ZIP64 sizes/offsets, which a large legitimate workbook can use.
 */
export function readCentralDirectory(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return [];
  const eocd = findEocd(buf);
  if (eocd === null) return [];

  let count  = buf.readUInt16LE(eocd + 10);
  let cdOff  = buf.readUInt32LE(eocd + 16);

  // ZIP64: the classic record saturates and points at a locator just before it.
  if ((count === 0xFFFF || cdOff === 0xFFFFFFFF) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_EOCD64LOC) {
    const rec = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (rec + 56 <= buf.length && buf.readUInt32LE(rec) === SIG_EOCD64) {
      count = Number(buf.readBigUInt64LE(rec + 32));
      cdOff = Number(buf.readBigUInt64LE(rec + 48));
    }
  }
  if (count > MAX_ENTRIES) throw new ZipBombError(Infinity, MAX_XLSX_INFLATED_BYTES);

  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buf.readUInt16LE(p + 10);
    let csize    = buf.readUInt32LE(p + 20);
    let usize    = buf.readUInt32LE(p + 24);
    const nLen   = buf.readUInt16LE(p + 28);
    const xLen   = buf.readUInt16LE(p + 30);
    const cLen   = buf.readUInt16LE(p + 32);
    let offset   = buf.readUInt32LE(p + 42);
    const name   = buf.toString("utf8", p + 46, p + 46 + nLen);

    // ZIP64 extra field (id 0x0001) carries the 64-bit values, in this order,
    // only for the fields that saturated in the fixed header.
    let x = p + 46 + nLen, xEnd = Math.min(x + xLen, buf.length);
    while (x + 4 <= xEnd) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize  === 0xFFFFFFFF && q + 8 <= xEnd) { usize  = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize  === 0xFFFFFFFF && q + 8 <= xEnd) { csize  = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xFFFFFFFF && q + 8 <= xEnd) { offset = Number(buf.readBigUInt64LE(q)); }
        break;
      }
      x += 4 + sz;
    }

    entries.push({ name, method, compressedSize: csize, declaredSize: usize, localHeaderOffset: offset });
    p += 46 + nLen + xLen + cLen;
  }
  return entries;
}

/** The compressed bytes of one entry, located through its local header. */
function entryData(buf, e) {
  const h = e.localHeaderOffset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== SIG_LOCAL) return null;
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  if (start > buf.length) return null;
  // Clamp to what physically exists: a lying compressedSize cannot reach past the upload.
  return buf.subarray(start, Math.min(start + e.compressedSize, buf.length));
}

/**
 * Inflate a raw deflate stream and count its output without keeping it.
 * Resolves with the byte count, stopping early (and resolving with a count
 * already past `budget`) as soon as the budget is exceeded. A corrupt stream
 * resolves with whatever was produced — corruption is ExcelJS's to report.
 */
function inflatedLength(data, budget) {
  return new Promise((resolve) => {
    const inf = zlib.createInflateRaw();
    let total = 0, done = false;
    const finish = () => { if (!done) { done = true; resolve(total); } };
    inf.on("data", (chunk) => {
      total += chunk.length;
      if (total > budget) { finish(); inf.destroy(); }
    });
    inf.on("end", finish);
    inf.on("error", finish);
    for (let i = 0; i < data.length && !done; i += 65536) inf.write(data.subarray(i, i + 65536));
    if (!done) inf.end();
  });
}

/**
 * Measure how many bytes this archive inflates to, stopping as soon as
 * `maxBytes` is exceeded. Never throws for malformed input; returns what it
 * could measure.
 */
export async function measureInflatedSize(buf, { maxBytes = MAX_XLSX_INFLATED_BYTES } = {}) {
  let total = 0;
  for (const e of readCentralDirectory(buf)) {
    const data = entryData(buf, e);
    if (!data) continue;
    // Stored (0): the bytes are the bytes. Deflate (8): measure. Anything
    // else jszip cannot read anyway; count the physical size and move on.
    total += e.method === 8 ? await inflatedLength(data, maxBytes - total) : data.length;
    if (total > maxBytes) return total;
  }
  return total;
}

/**
 * Refuse an archive that would inflate past the budget. Call BEFORE
 * ExcelJS.Workbook#xlsx.load. Throws ZipBombError (HTTP 413).
 */
export async function assertInflatable(buf, { maxBytes = MAX_XLSX_INFLATED_BYTES } = {}) {
  const inflated = await measureInflatedSize(buf, { maxBytes });
  if (inflated > maxBytes) throw new ZipBombError(inflated, maxBytes);
  return inflated;
}

export { MAX_XLSX_INFLATED_MB };

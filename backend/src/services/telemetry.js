/**
 * services/telemetry.js — v20.2 "Let usage pick the segment"
 *
 * We chose to stay horizontal until real usage says otherwise. This module
 * is how usage gets a vote: every upload leaves a privacy-safe fingerprint
 * (file shape + column-name CATEGORIES), and after a month the segment
 * table reads like a market survey we didn't have to run.
 *
 * THE PRIVACY CONTRACT — enforced structurally, verified by tests:
 *   · No cell values. Ever. Nothing here receives row data.
 *   · No filenames (they leak: "ยอดขายร้านป้าศรี.xlsx").
 *   · No raw column names. A header either matches the fixed dictionary
 *     below (→ its TAG is recorded) or it is counted as "other" and its
 *     text is discarded on the spot.
 *   · Failures are swallowed: telemetry must never break an upload.
 */
import { saveUploadMetadata } from "../db/repository.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("telemetry");

// ── Column-category dictionary ─────────────────────────────
// Thai + English patterns. NOTE: \b only works for ASCII, so Thai patterns
// are plain substrings; short English words get \b to avoid false hits.
const CATEGORY_PATTERNS = [
  ["date",     /วันที่|เดือน|\bdate\b|month|\bday\b|เวลา|\btime\b|timestamp/i],
  ["expiry",   /หมดอายุ|วันหมด|expir|\bexp\b|\bmfg\b|\blot\b|ล็อต|batch/i],
  ["menu",     /เมนู|\bmenu\b|\bdish/i],
  ["product",  /สินค้า|product|\bitem\b|รายการ|ชื่อยา|ตัวยา|\bdrug/i],
  ["sku",      /\bsku\b|barcode|บาร์โค้ด|รหัสสินค้า/i],
  ["price",    /ราคา|price|ต่อหน่วย/i],
  ["cost",     /ต้นทุน|\bcost/i],
  ["quantity", /จำนวน|\bqty\b|quantity|\bunits?\b|ปริมาณ/i],
  ["sales",    /ยอดขาย|ขายรวม|revenue|\bsales?\b|\bsold\b|รายได้|\bamount\b|\btotal\b/i],
  ["stock",    /สต็อก|สต๊อก|stock|คงเหลือ|inventory|on.?hand|balance/i],
  ["customer", /ลูกค้า|customer|member|สมาชิก/i],
  ["patient",  /ผู้ป่วย|patient|\bhn\b|คนไข้/i],
  ["order",    /ออเดอร์|\border|บิล|invoice|ใบเสร็จ|receipt|โต๊ะ|\btable\b/i],
  ["category", /หมวด|ประเภท|category|\btype\b|กลุ่ม/i],
  ["traffic",  /visitor|page.?view|session|bounce|conversion|click|ผู้เข้าชม/i],
  ["employee", /พนักงาน|employee|staff|\bshift\b/i],
  ["salary",   /เงินเดือน|salary|payroll|ค่าจ้าง|wage/i],
  ["shipping", /จัดส่ง|ขนส่ง|\bship|tracking|delivery|พัสดุ/i],
  ["location", /สาขา|branch|region|จังหวัด|โซน|zone|warehouse|คลัง|\bbin\b/i],
  ["tax",      /ภาษี|\bvat\b|\btax\b/i],
];

/** headers → { tags: [dictionary tags only], otherCols: n }. Raw names discarded. */
export function categorizeColumns(headers = []) {
  const tags = new Set();
  let other = 0;
  for (const h of headers) {
    const s = String(h);
    let hit = false;
    for (const [tag, re] of CATEGORY_PATTERNS) {
      if (re.test(s)) { tags.add(tag); hit = true; }
    }
    if (!hit) other++;
  }
  return { tags: [...tags].sort(), otherCols: other };
}

// ── Segment inference ──────────────────────────────────────
// Weighted tag votes; negative weights pull a file OUT of a segment (an
// expiry column makes "generic retail" the wrong read — that file belongs
// to expiry-tracking retail, i.e. pharmacy/grocery). A segment must clear
// the threshold to claim a file; everything else stays honestly "general".
// Insertion order breaks ties (more specific segments first).
const SEGMENTS = {
  pharmacy:      { expiry: 3, patient: 3, product: 1, stock: 1, quantity: 0.5 },
  restaurant:    { menu: 3, order: 1.5, sales: 0.5, quantity: 0.5 },
  hr_payroll:    { salary: 3, employee: 2 },
  web_marketing: { traffic: 3, order: 0.5, customer: 0.5 },
  logistics:     { shipping: 2.5, sku: 2, location: 1, stock: 1 },
  finance:       { tax: 2.5, order: 1, cost: 1 },
  retail_shop:   { sales: 2, product: 1.5, price: 1, stock: 1, category: 0.5, customer: 0.5, expiry: -2 },
};
const CLAIM_THRESHOLD = 3;

export function inferSegment(tags = []) {
  let best = { segment: "general", score: 0 };
  for (const [segment, weights] of Object.entries(SEGMENTS)) {
    const score = tags.reduce((s, t) => s + (weights[t] || 0), 0);
    if (score > best.score) best = { segment, score };
  }
  return best.score >= CLAIM_THRESHOLD ? best : { segment: "general", score: best.score };
}

// ── Record builder ─────────────────────────────────────────
/**
 * buildUploadRecord({ source, fileType, sizeBytes, parsed, sampleId, userId })
 * `parsed` is (a subset of) parseFileStreaming output. Only whitelisted,
 * non-identifying fields make it into the record.
 */
export function buildUploadRecord({ source, fileType = null, sizeBytes = 0, parsed = {}, sampleId = null, userId = null }) {
  const colAnalysis = parsed.colAnalysis || [];
  const headers     = parsed.headers ?? colAnalysis.map(c => c.col);
  const norm        = parsed.normalization || {};
  const { tags }    = categorizeColumns(headers);
  const { segment, score } = inferSegment(tags);
  const dateCols    = colAnalysis.filter(c => c.semantic === "date");
  return {
    source,
    fileType: fileType ? String(fileType).slice(0, 8).toLowerCase() : null,
    rowCount: parsed.totalRows || 0,
    colCount: headers.length,
    sizeKb: Math.round((sizeBytes || 0) / 1024),
    numericCols: colAnalysis.filter(c => c.type === "numeric").length,
    textCols:    colAnalysis.filter(c => c.type === "text" && c.semantic !== "date").length,
    dateCols:    dateCols.length,
    buddhistEra: dateCols.some(c => c.buddhistEra) ? 1 : 0,
    encoding:  norm.encoding || null,
    delimiter: norm.delimiter === "\t" ? "tab" : (norm.delimiter || null),
    skippedRows: norm.skippedPreHeaderRows || 0,
    categories: tags,            // dictionary tags ONLY — never raw names
    segment,
    segmentScore: score,
    sampleId,
    userId,
  };
}

/** Fire-and-forget: telemetry must never block or break an upload. */
export function recordUpload(args) {
  try {
    const rec = buildUploadRecord(args);
    saveUploadMetadata(rec).catch(err => log.warn({ err: err.message }, "telemetry insert failed"));
  } catch (err) {
    log.warn({ err: err.message }, "telemetry build failed");
  }
}

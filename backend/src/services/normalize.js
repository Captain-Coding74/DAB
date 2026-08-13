/**
 * src/services/normalize.js — v20 "Messy File Layer"
 *
 * Real shop exports are not clean CSVs. This module makes the parser
 * survive what Thai SMEs actually upload:
 *
 *   1. Legacy encodings   — TIS-620 / windows-874 CSVs (Excel "CSV" on Thai
 *                           Windows), UTF-16 ("Unicode Text" exports)
 *   2. Junk above header  — report titles / banner rows before the real table
 *   3. Odd delimiters     — semicolons, tabs, pipes
 *   4. Thai numbers       — "฿1,234.50", "1,200 บาท", "(500)" negatives,
 *                           Thai digits ๐-๙, percent signs
 *   5. Thai dates         — พ.ศ. (Buddhist Era) years, Thai month names
 *                           ("14 ม.ค. 2569"), d/m/y ordering
 *   6. Invisible garbage  — zero-width spaces, NBSP, BOM leftovers
 *
 * Everything here is a pure function (no I/O), so it is fully unit-testable.
 * streaming.js wires these into the parse pipeline.
 *
 * DESIGN RULES
 *   - Never mutate the user's values: normalization feeds *stats*; sampleRows
 *     and frequency tables keep the original strings.
 *   - Strict beats lenient: "12abc" is text, not 12. (The old parseFloat
 *     path silently read "1,234.50" as 1 — that class of bug is why this
 *     file exists.)
 *   - Only move the header down when a later row is CLEARLY better
 *     (margin rule in detectHeaderRow) — clean files must be untouched.
 */

// ── Invisible-character cleanup ─────────────────────────────
/** Trim + strip zero-width chars (U+200B/C/D, stray BOM) + NBSP→space. */
export function cleanCell(v) {
  if (v == null) return "";
  return String(v)
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

// ── Thai digits ─────────────────────────────────────────────
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
export function thaiDigitsToArabic(s) {
  let out = "";
  for (const ch of String(s)) {
    const i = THAI_DIGITS.indexOf(ch);
    out += i === -1 ? ch : String(i);
  }
  return out;
}

// ── Flexible number parsing ─────────────────────────────────
// Currency tokens seen in Thai SME exports. Case-insensitive.
const CURRENCY_RE = /฿|\$|€|£|¥|THB|USD|บาท/gi;
// Thousands grouping must be REAL grouping ("1,234,567.89") — "1,23" is text.
const GROUPED_RE = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_RE = /^\d+(\.\d+)?$/;

/**
 * parseFlexibleNumber("฿1,234.50") → 1234.5
 * Returns a Number, or null when the value is not confidently numeric.
 * Percent values return the bare number ("12.5%" → 12.5).
 */
export function parseFlexibleNumber(raw) {
  if (raw == null) return null;
  let s = thaiDigitsToArabic(cleanCell(raw));
  if (s === "") return null;

  // Fast path: plain machine numbers (the overwhelmingly common case).
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);

  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); } // (500) → -500
  s = s.replace(CURRENCY_RE, "").replace(/[\s\u202F\u2009]/g, "");
  if (s.endsWith("%")) s = s.slice(0, -1);
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s === "") return null;

  if (GROUPED_RE.test(s)) s = s.replace(/,/g, "");
  if (!PLAIN_RE.test(s)) return null;

  const n = Number(s);
  return neg ? -n : n;
}

// ── Flexible date parsing (Buddhist Era aware) ──────────────
const THAI_MONTHS = {
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
  "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
  "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
  // dot-stripped abbreviations (ม.ค. → มค)
  "มค": 1, "กพ": 2, "มีค": 3, "เมย": 4, "พค": 5, "มิย": 6,
  "กค": 7, "สค": 8, "กย": 9, "ตค": 10, "พย": 11, "ธค": 12,
};

/**
 * Year disambiguation:
 *   ≥ 2400        → Buddhist Era, subtract 543   (2569 → 2026)
 *   1900–2200     → Gregorian as-is
 *   2-digit ≥ 43  → BE 25xx (BE 2543 = CE 2000; Thai docs write "69" for 2569)
 *   2-digit < 43  → CE 20xx
 */
/* How far ahead a date may plausibly sit. Wide because expiry dates are a
   first-class case here — a pharmacy file legitimately carries วันหมดอายุ years
   out — but not so wide that a misparse survives. */
const MAX_YEARS_AHEAD = 12;

function normalizeYear(y) {
  const thisYear = new Date().getUTCFullYear();

  if (y >= 2400 && y <= 2800) {
    const ce = y - 543;
    /* BE 2799 became CE 2256 — 230 years out, accepted silently. A four-digit
       year that lands that far ahead is a misparse, not a date. */
    if (ce > thisYear + MAX_YEARS_AHEAD) return null;
    return { year: ce, be: true };
  }
  if (y >= 1900 && y <= 2200) return { year: y, be: false };
  if (y >= 100) return null;

  if (y >= 43) {
    /* Thai documents write "69" for BE 2569, so a two-digit year usually means
       25xx. But the same rule sent "95" to CE 2052 and "99" to CE 2056 —
       decades ahead — when a file writing "95" almost always means 1995. When
       the Buddhist reading lands implausibly far in the future, the Gregorian
       19xx reading is the better one. */
    const beYear = 2500 + y - 543;
    if (beYear > thisYear + MAX_YEARS_AHEAD) return { year: 1900 + y, be: false };
    return { year: beYear, be: true };
  }
  return { year: 2000 + y, be: false };
}

function validDate(y, m, d) {
  if (!Number.isInteger(y) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isoOf = (y, m, d) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * parseFlexibleDate("14/01/2569") → { iso: "2026-01-14", be: true }
 * Handles: ISO (with optional time), YYYY-MM, d/m/y (also . or - separated,
 * swaps to m/d when the d-slot is >12), and "14 ม.ค. 2569" Thai-month forms.
 * Returns null when not confidently a date.
 */
export function parseFlexibleDate(raw) {
  if (raw == null) return null;
  let s = thaiDigitsToArabic(cleanCell(raw));
  if (s === "") return null;
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, ""); // drop time part

  // ISO: YYYY-MM-DD (BE years converted)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const ny = normalizeYear(+m[1]);
    if (ny && validDate(ny.year, +m[2], +m[3])) return { iso: isoOf(ny.year, +m[2], +m[3]), be: ny.be };
    return null;
  }

  // YYYY-MM (month series like "2025-01") — dash only; dots stay numeric
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const ny = normalizeYear(+m[1]);
    if (ny && +m[2] >= 1 && +m[2] <= 12) return { iso: isoOf(ny.year, +m[2], 1), be: ny.be };
    return null;
  }

  // d/m/y — Thai ordering; separators / . -
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    let d = +m[1], mo = +m[2];
    const ny = normalizeYear(+m[3]);
    if (!ny) return null;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // clearly m/d (US export) — swap
    if (validDate(ny.year, mo, d)) return { iso: isoOf(ny.year, mo, d), be: ny.be };
    return null;
  }

  // "14 ม.ค. 2569" / "14 มกราคม 2569" (dots optional, year optionally 2-digit)
  m = s.match(/^(\d{1,2})\s*([\u0E00-\u0E7F.]+)\s*(\d{2,4})$/);
  if (m) {
    const mo = THAI_MONTHS[m[2].replace(/\./g, "")];
    const ny = normalizeYear(+m[3]);
    if (mo && ny && validDate(ny.year, mo, +m[1])) return { iso: isoOf(ny.year, mo, +m[1]), be: ny.be };
    return null;
  }

  return null;
}

// ── Legacy encoding detection ───────────────────────────────
// windows-874 = TIS-620 + a few Microsoft extras in 0x80–0x9F.
const WIN874_EXTRAS = {
  0x80: 0x20AC, 0x85: 0x2026, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
};
const inThaiRange = (b) => (b >= 0xA1 && b <= 0xDA) || (b >= 0xDF && b <= 0xFB);

function decodeWindows874(buf) {
  let out = "";
  for (const b of buf) {
    if (b < 0x80) out += String.fromCharCode(b);
    else if (WIN874_EXTRAS[b]) out += String.fromCharCode(WIN874_EXTRAS[b]);
    else if (inThaiRange(b)) out += String.fromCharCode(b + 0x0D60); // 0xA1→U+0E01 (ก)
    else if (b === 0xA0) out += " ";
    else out += "\uFFFD";
  }
  return out;
}

/**
 * decodeSmart(buffer) → { text, encoding }
 * Order: UTF-16 BOM → strict UTF-8 → Thai-byte heuristic (windows-874)
 * → lossy UTF-8 as last resort.
 */
export function decodeSmart(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { text: new TextDecoder("utf-16le").decode(buffer), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    // Swap to LE then decode — avoids relying on ICU's utf-16be support.
    const swapped = Buffer.allocUnsafe(buffer.length);
    for (let i = 0; i + 1 < buffer.length; i += 2) { swapped[i] = buffer[i + 1]; swapped[i + 1] = buffer[i]; }
    return { text: new TextDecoder("utf-16le").decode(swapped), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "utf-8" };
  } catch {
    let high = 0, thai = 0;
    for (const b of buffer) if (b >= 0x80) { high++; if (inThaiRange(b)) thai++; }
    if (high > 0 && thai / high >= 0.5) {
      return { text: decodeWindows874(buffer), encoding: "windows-874" };
    }
    return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8-lossy" };
  }
}

// ── Delimiter sniffing ──────────────────────────────────────
/** Pick the delimiter that appears most, most consistently, in the first rows. */
export function sniffDelimiter(text) {
  const lines = text.slice(0, 64 * 1024).split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 10);
  if (!lines.length) return ",";
  let best = ",", bestScore = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((c) => c > 0);
    if (!counts.length) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const coverage = counts.length / lines.length;
    const uniform = counts.every((c) => c === counts[0]) ? 1.5 : 1;
    const score = avg * coverage * uniform;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// ── Header detection ────────────────────────────────────────
/**
 * detectHeaderRow(rows) → index of the most likely header row.
 * Scores each of the first rows on coverage + textiness + uniqueness;
 * a later row only wins with a CLEAR margin (+0.5), so clean files
 * always keep row 0. Banner/title rows (<2 non-empty cells) score 0.
 */
export function detectHeaderRow(rows, maxScan = 10) {
  if (!rows.length) return 0;
  const width = Math.max(...rows.map((r) => r.length), 1);
  const scan = Math.min(rows.length, maxScan);
  const scores = [];
  for (let i = 0; i < scan; i++) {
    const nonEmpty = rows[i].filter((c) => c !== "");
    if (nonEmpty.length < 2) { scores.push(0); continue; }
    const hasDataBelow = rows.slice(i + 1).some((r) => r.some((c) => c !== ""));
    if (!hasDataBelow && i > 0) { scores.push(0); continue; }
    const coverage = nonEmpty.length / width;
    const texty = nonEmpty.filter((c) => parseFlexibleNumber(c) === null && parseFlexibleDate(c) === null).length / nonEmpty.length;
    const uniq = new Set(nonEmpty).size / nonEmpty.length;
    scores.push(coverage + texty + uniq);
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best] + 0.5) best = i;
  return best;
}

/**
 * Drop trailing empty header cells; name remaining blanks col_i (0-based);
 * make every name unique.
 *
 * Blanks were renamed but DUPLICATES were not, and Excel exports and merged
 * reports repeat a header constantly. Everything downstream resolves a column
 * by name — the statistical tests, the fix catalogue, the AI edit path, the
 * correlation matrix — and every one of them lands on the FIRST match. Two
 * columns called ยอดขาย with different values (250 and 832.5 in the case that
 * found this) meant the second was silently unreachable: a user picking it in
 * the UI got the first one's data, with nothing to indicate the swap.
 *
 * Suffixes are 1-based and human-facing, so the second ยอดขาย becomes
 * "ยอดขาย (2)" — recognisable in a dropdown rather than an opaque col_7.
 */
export function finalizeHeaders(cells) {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") end--;

  const out = [];
  const taken = new Set();
  for (let i = 0; i < end; i++) {
    const base = cells[i] === "" ? `col_${i}` : cells[i];
    let name = base, n = 1;
    /* Keep incrementing until the name is genuinely free. A plain counter
       reintroduced the very collision this fixes: a file already containing
       "a (2)" met a duplicate "a", which was renamed to "a (2)" as well. */
    while (taken.has(name)) name = `${base} (${++n})`;
    taken.add(name);
    out.push(name);
  }
  return out;
}

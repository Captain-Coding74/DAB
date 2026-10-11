/**
 * PDPA sensitive-column detection and masking — School Edition.
 * ตรวจจับและปิดบังคอลัมน์ข้อมูลส่วนบุคคล (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล)
 *
 * WHY THIS EXISTS
 * ---------------
 * School datasets are rosters: บัตรประชาชน (citizen ID), เลขประจำตัว
 * (student ID), ชื่อ-สกุล, วันเกิด, เบอร์โทร. The data subjects are minors,
 * so "probably fine" is not a policy:
 *
 *   • Nothing that identifies a child may reach the AI. This module DETECTS
 *     and masks; every AI payload is built from aiSafe.js, which drops a
 *     detected column's values entirely and keeps only its name and kind.
 *   • Citizen IDs must not survive into previews or exports either. A
 *     teacher keeps the student ID (pseudonymous inside the school, and the
 *     only way to find the right row) but never the citizen ID.
 *
 * v21.30: the same machinery now covers ordinary business files — email,
 * payment card, bank account, passport, postal address, LINE/social IDs —
 * and the PDPA s.26 categories (health, religion, ethnicity, disability,
 * criminal record, sexual behaviour, political opinion, trade union,
 * biometric), which are detected by header and stay READABLE in the owner's
 * own view but are excluded from AI payloads like every other kind.
 *
 * WHY VALUE-AWARE, NOT HEADER-ONLY
 * --------------------------------
 * aiEdit.js has a small header-regex detector for its own warning banner.
 * Headers lie: a column called "รหัสอ้างอิง" full of 13-digit numbers with
 * valid mod-11 checksums IS a citizen-ID column, whatever it is called. The
 * checksum does not lie, so values outrank headers here. The converse also
 * holds: a column is never flagged merely for being numeric — silently
 * masking a real measurement is its own kind of data loss.
 *
 * When a header claims sensitivity but the values cannot confirm it, we
 * still flag at "medium" confidence. For minors' data the asymmetry is
 * clear: a false positive costs a little readability, a false negative
 * leaks a child's identity.
 */

import {
  isThaiCitizenId, ROLL_HEADER_RE, looksLikeRollSequence,
  VALUE_KINDS, SHAPES, HEADER_PATTERNS, S26_KINDS,
} from "./sensitivePatterns.js";

/* Re-exported: callers and tests have imported these from here since the
   School Edition; the patterns themselves now live in sensitivePatterns.js. */
export { isThaiCitizenId, S26_KINDS };

/* Sampling is capped so classification stays O(1) per column on a 25 MB
   upload — 50 NON-EMPTY values is plenty to establish a majority. The cap
   must count VALUES, not rows: slicing the first 50 rows meant a citizen-ID
   column that is blank early and filled later (students enrolled mid-year)
   sampled nothing but blanks, classified as unprotected, and its raw IDs
   were sent to the model while the UI promised they never leave the server.
   Scanning all rows but stopping at 50 collected values keeps the bound. */
const SAMPLE_ROWS = 50;

function sampleValues(rows, index) {
  const out = [];
  for (const row of rows) {
    const v = row?.[index];
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== "") out.push(s);
    if (out.length >= SAMPLE_ROWS) break;
  }
  return out;
}

/** Strictly more than half of the non-empty sample passes the predicate. */
function majority(values, pred) {
  if (!values.length) return false;
  return values.filter(pred).length * 2 > values.length;
}

// ── Classification ────────────────────────────────────────

/**
 * classifySensitiveColumns(headers, rows) -> [{ index, col, kind, confidence }]
 *
 * kinds: "citizen-id" | "student-id" | "name" | "dob" | "phone" | "email" |
 * "card" | "bank-account" | "passport" | "address" | "social-id" | the
 * PDPA s.26 kinds (S26_KINDS). Evidence, strongest first:
 *   1. A majority of sampled non-empty values passing a value test — the
 *      mod-11 citizen-ID checksum, the Luhn card check, an email shape — is
 *      that kind at high confidence, whatever the header says.
 *   2. A header pattern match flags the column; when the sampled values also
 *      fit the kind's shape, confidence is "high", otherwise "medium".
 * A column is never flagged for merely being numeric.
 */
export function classifySensitiveColumns(headers = [], rows = []) {
  const found = [];
  headers.forEach((h, index) => {
    const col = String(h ?? "");
    const values = sampleValues(rows, index);

    /* Checksum evidence trumps the header entirely — schools routinely put
       citizen IDs in columns named for something else, and a CRM export's
       "contact" column full of addresses is an email column. */
    const byValue = VALUE_KINDS.find((v) => majority(values, v.test));
    if (byValue) {
      found.push({ index, col, kind: byValue.kind, confidence: "high" });
      return;
    }

    /* ลำดับ / เลขที่ — the roll-call number. Real Thai gradebooks are keyed
       by it (often with NO formal student id at all), so missing it meant
       the whole class report never appeared for the most common file shape,
       and worse: a 1..N column is numeric, so it was SUMMED into every
       student's score total. Classified as student-id so all the identity
       semantics follow: out of the score set, readable for the teacher,
       kept out of the AI, aggregates and trend nulled. Header AND
       values must agree — a column merely NAMED ลำดับ holding scores stays
       a score column. */
    if (ROLL_HEADER_RE.test(col.trim()) && looksLikeRollSequence(values)) {
      found.push({ index, col, kind: "student-id", confidence: "high" });
      return;
    }

    const match = HEADER_PATTERNS.find((p) => p.re.test(col));
    if (!match) return;

    /* A header that said citizen-id/card/email reaches here only after the
       value majority above failed — value support for those kinds can only
       come from there, so SHAPES has no entry for them. */
    const shape = SHAPES[match.kind];
    const corroborated = shape ? majority(values, shape) : false;

    found.push({
      index, col, kind: match.kind,
      confidence: corroborated ? "high" : "medium",
    });
  });
  return found;
}

// ── Masking ───────────────────────────────────────────────

/* Keep the first `head` and last `tail` digits and x the rest; separators
   survive so the masked value still reads as what it was. Fewer than
   `minTotal` digits is not the shape we expected — keep nothing. */
function maskDigits(s, head, tail, minTotal) {
  const total = s.replace(/\D/g, "").length;
  if (total < minTotal) return s.replace(/\d/g, "x");
  let seen = 0;
  return [...s].map((ch) => {
    if (!/\d/.test(ch)) return ch;
    const keep = seen < head || seen >= total - tail;
    seen++;
    return keep ? ch : "x";
  }).join("");
}

/**
 * maskValue(value, kind) -> string. Empty/null stays "".
 *
 *   citizen-id   : "1-xxxx-xxxxx-xx-21" — real first digit and last two,
 *                  everything between becomes x, canonical dashes kept.
 *   phone        : first 2 and last 2 digits kept, separators preserved.
 *   card         : last 4 digits kept ("xxxx-xxxx-xxxx-1234").
 *   bank-account : last 4 digits kept.
 *   passport     : first 2 characters kept, the rest x.
 *   email        : first character + "***@" + the domain.
 *   name, address, social-id : first character + "***".
 *   dob          : year survives, month/day masked (both 2010-05-14 and
 *                  14/05/2553 shapes); unparseable becomes "xxxx".
 *   student-id and the s.26 kinds : returned UNCHANGED — a teacher needs
 *                  the student id to find the row, and s.26 values are the
 *                  owner's own data in the owner's own view. Neither ever
 *                  reaches the AI: aiSafe.js drops detected columns whole.
 */
export function maskValue(value, kind) {
  if (value == null) return "";
  const s = String(value);
  const t = s.trim();
  if (t === "") return "";

  switch (kind) {
    case "citizen-id": {
      const digits = s.replace(/\D/g, "");
      if (digits.length === 13) {
        return `${digits[0]}-xxxx-xxxxx-xx-${digits.slice(11)}`;
      }
      /* Not a real ID shape — keep nothing rather than guess positions. */
      return s.replace(/\d/g, "x");
    }
    case "phone":        return maskDigits(s, 2, 2, 5);
    case "card":
    case "bank-account": return maskDigits(s, 0, 4, 8);
    case "passport":     return t.slice(0, 2) + t.slice(2).replace(/[0-9A-Za-z]/g, "x");
    case "email": {
      const at = t.lastIndexOf("@");
      return at > 0 ? `${t[0]}***${t.slice(at)}` : `${t[0]}***`;
    }
    case "name":
    case "address":
    case "social-id":
      return t.slice(0, 1) + "***";
    case "dob": {
      let m = t.match(/^(\d{4})([-/.])\d{1,2}\2\d{1,2}$/);
      if (m) return `${m[1]}${m[2]}xx${m[2]}xx`;
      m = t.match(/^\d{1,2}([-/.])\d{1,2}\1(\d{4})$/);
      if (m) return `xx${m[1]}xx${m[1]}${m[2]}`;
      return "xxxx";
    }
    default:
      return s;
  }
}

/* Masked in EVERY view, the owner's own included: the direct identifiers
   that let a stranger reach the person. Names, birthdates and student ids
   stay readable in previews (a teacher works with them inside the school),
   and so do the s.26 kinds — those are kept out of AI payloads and share
   pages instead, which is where they would leave the owner's hands. */
const MASKED_IN_VIEW = new Set([
  "citizen-id", "phone", "email", "card", "bank-account", "passport", "address", "social-id",
]);

/**
 * maskRows(headers, rows, detections) -> new rows, inputs never mutated.
 *
 * The view a user keeps — previews, exports, fix previews. v21.30 removed
 * the old { strict } mode: it existed for the five sample rows the analyze
 * prompt used to carry, and no prompt carries rows any more.
 */
export function maskRows(headers, rows, detections = []) {
  const kindByIndex = new Map();
  for (const d of detections) {
    if (MASKED_IN_VIEW.has(d.kind)) kindByIndex.set(d.index, d.kind);
  }
  return rows.map((row) => row.map((cell, i) =>
    (kindByIndex.has(i) ? maskValue(cell, kindByIndex.get(i)) : cell)));
}

/* The "average citizen ID" is nonsense that must not render or reach the
   AI — a 13-digit label parses as a number, so analyze.js dutifully
   computes min/max/avg for it. Those aggregates are wiped, not masked:
   there is no truthful masked version of a meaningless statistic. Card and
   bank-account numbers are digit runs too, and their "max" IS a number. */
const NUMERIC_AGGREGATES = ["min", "max", "avg", "median", "q1", "q3", "stdDev", "sum"];
const IDENTIFIER_NUMBERS = new Set(["citizen-id", "phone", "student-id", "card", "bank-account", "passport"]);

/**
 * maskColAnalysis(colAnalysis, detections) -> new array, inputs untouched.
 * Flagged columns get { sensitive: kind }, their top[].value masked, and —
 * for identifier columns that came out numeric — their aggregate
 * statistics nulled.
 */
export function maskColAnalysis(colAnalysis = [], detections = []) {
  const kindByCol = new Map(detections.map((d) => [d.col, d.kind]));
  return colAnalysis.map((c) => {
    const kind = kindByCol.get(c.col);
    if (!kind) return c;
    const masked = { ...c, sensitive: kind };
    if (Array.isArray(c.top)) {
      masked.top = c.top.map((t) => ({ ...t, value: maskValue(t.value, kind) }));
    }
    if (IDENTIFIER_NUMBERS.has(kind) && c.type === "numeric") {
      for (const key of NUMERIC_AGGREGATES) masked[key] = null;
    }
    return masked;
  });
}

/**
 * The parse-boundary guard: one call, applied where every uploaded file
 * becomes data (parseFileStreaming), so every consumer — the analyze
 * response, saved stats_json, chat/agent context, exports, dataset previews,
 * the demo — receives the SAME protected view. Detection runs on the ordered
 * head rows (up to 500) rather than the 5-row reservoir so a sparse ID
 * column cannot slip past on a tiny sample. The masking here is the view a
 * user keeps (direct identifiers x'd; names/DOB/student ids and s.26 values
 * stay readable — see MASKED_IN_VIEW); every AI payload is cut down further
 * by aiSafe.js. The original file bytes in object storage are untouched:
 * this guards what the SERVER shows and sends, not what the owner keeps.
 */
export function guardParsed(parsed) {
  const basis = parsed.headRows?.length ? parsed.headRows : (parsed.sampleRows || []);
  const detections = classifySensitiveColumns(parsed.headers, basis);
  if (!detections.length) return { ...parsed, sensitive: [] };
  /* Beyond the base masking: (1) iqr is DERIVED from q1/q3, so the IQR of a
     citizen-id column is itself a 13-digit identifier-shaped number — null it
     wherever aggregates are nulled, and treat student ids the same way
     (identifiers are not measurements, their min/max/avg mean nothing);
     (2) dateRange on a birthdate column carries full DOBs into the insights
     text — reduce it to year precision, matching maskValue's dob policy. */
  const scrub = (cols) => cols.map((c) => {
    const d = detections.find((x) => x.col === c.col);
    if (!d) return c;
    const out = { ...c };
    if (IDENTIFIER_NUMBERS.has(d.kind)) {
      for (const k of ["min", "max", "avg", "median", "q1", "q3", "iqr", "stdDev", "sum"]) {
        if (k in out) out[k] = null;
      }
      /* The trend sums too: autoForecastFromAnalysis fits a line to c.trend,
         so leaving it meant the AI prompt carried the slope, intercept and
         "forecast" of the citizen-ID column — identifier data by another
         name, and a nonsense forecast besides. */
      if ("trend" in out) out.trend = null;
    }
    if (d.kind === "dob" && out.dateRange) {
      out.dateRange = {
        min: String(out.dateRange.min || "").slice(0, 4) || null,
        max: String(out.dateRange.max || "").slice(0, 4) || null,
      };
    }
    return out;
  });
  return {
    ...parsed,
    colAnalysis: scrub(maskColAnalysis(parsed.colAnalysis, detections)),
    sampleRows:  maskRows(parsed.headers, parsed.sampleRows || [], detections),
    headRows:    maskRows(parsed.headers, parsed.headRows || [], detections),
    sensitive:   detections.map(({ col, kind, confidence }) => ({ col, kind, confidence })),
  };
}

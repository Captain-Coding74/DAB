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
 *   • Nothing that identifies a child may reach the AI. aiEdit.js warns the
 *     caller; this module MASKS. Strict mode strips every identifier —
 *     including the student ID, because the model never needs one.
 *   • Citizen IDs must not survive into previews or exports either. A
 *     teacher keeps the student ID (pseudonymous inside the school, and the
 *     only way to find the right row) but never the citizen ID.
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

// ── Thai citizen ID checksum ──────────────────────────────

/**
 * True for a 13-digit Thai citizen ID with a VALID mod-11 check digit.
 * Digits may be interleaved with spaces or dashes ("1-2345-67890-12-1");
 * any other character rejects. 13 digits with a wrong check digit reject —
 * that is the whole point of using the checksum as evidence. The first
 * digit of a real ID is never 0.
 */
export function isThaiCitizenId(value) {
  if (value == null) return false;
  const s = String(value).trim();
  if (s === "" || !/^[\d\s-]+$/.test(s)) return false;
  const digits = s.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(digits) || digits[0] === "0") return false;
  const d = [...digits].map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += d[i] * (13 - i);
  return (11 - (sum % 11)) % 10 === d[12];
}

// ── Header patterns (Thai AND English), in severity order ─
/* Order matters: "เลขประจำตัวประชาชน" — the official name of the citizen
   ID — contains "เลขประจำตัว", which alone means student ID. The citizen
   pattern is checked first so the more severe kind wins. */
const HEADER_PATTERNS = [
  { kind: "citizen-id", re: /ประชาชน|เลขบัตร|citizen|national[\s_-]?id/i },
  { kind: "student-id", re: /เลขประจำตัว|รหัสนักเรียน|รหัสนิสิต|รหัสนักศึกษา|student[\s_-]?id/i },
  { kind: "dob",        re: /เกิด|birth|\bdob\b|d\.o\.b/i },
  { kind: "phone",      re: /เบอร์|โทร|มือถือ|phone|\btel\b|mobile/i },
  { kind: "name",       re: /ชื่อ|สกุล|name/i },
];

// ── Value-shape corroborators ─────────────────────────────

/** Thai mobile/landline: leading 0 then 8-9 more digits, dashes/spaces ok. */
function looksLikeThaiPhone(s) {
  if (!/^[\d\s-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits[0] === "0" && (digits.length === 9 || digits.length === 10);
}

/** ISO 2010-05-14 or Thai day-first 14/05/2553 (Buddhist years included). */
function looksLikeDob(s) {
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)
      || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(s);
}

/** Contains an actual letter (Thai or Latin) — a name is never a number. */
function looksLikeName(s) {
  return /[A-Za-zก-๎]/.test(s);
}

/** A digit run (dashes/spaces allowed) that is NOT a valid citizen ID. */
function looksLikeStudentId(s) {
  if (!/^[\d\s-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 13 && !isThaiCitizenId(s);
}

/* Sampling is capped so classification stays O(1) per column on a 25 MB
   upload — 50 rows is plenty to establish a majority. */
const SAMPLE_ROWS = 50;

function sampleValues(rows, index) {
  const out = [];
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    const v = row?.[index];
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== "") out.push(s);
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
 * kinds: "citizen-id" | "student-id" | "name" | "dob" | "phone".
 * Evidence, strongest first:
 *   1. A majority of sampled non-empty values passing the mod-11 checksum is
 *      "citizen-id" at high confidence, whatever the header says.
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
       citizen IDs in columns named for something else. */
    if (majority(values, isThaiCitizenId)) {
      found.push({ index, col, kind: "citizen-id", confidence: "high" });
      return;
    }

    const match = HEADER_PATTERNS.find((p) => p.re.test(col));
    if (!match) return;

    const corroborated = {
      /* Header said citizen-id but the checksum majority above already
         failed — value support for this kind can only come from there. */
      "citizen-id": () => false,
      "student-id": () => majority(values, looksLikeStudentId),
      "name":       () => majority(values, looksLikeName),
      "dob":        () => majority(values, looksLikeDob),
      "phone":      () => majority(values, looksLikeThaiPhone),
    }[match.kind]();

    found.push({
      index, col, kind: match.kind,
      confidence: corroborated ? "high" : "medium",
    });
  });
  return found;
}

// ── Masking ───────────────────────────────────────────────

/**
 * maskValue(value, kind) -> string. Empty/null stays "".
 *
 *   citizen-id : "1-xxxx-xxxxx-xx-21" — real first digit and last two,
 *                everything between becomes x, canonical dashes kept.
 *   phone      : first 2 and last 2 digits kept, separators preserved.
 *   name       : first character + "***".
 *   dob        : year survives, month/day masked (both 2010-05-14 and
 *                14/05/2553 shapes); unparseable becomes "xxxx".
 *   student-id : returned UNCHANGED — teachers need it to identify rows;
 *                it is pseudonymous within the school. (Strict maskRows
 *                overrides this for AI-bound payloads.)
 */
export function maskValue(value, kind) {
  if (value == null) return "";
  const s = String(value);
  if (s.trim() === "") return "";

  switch (kind) {
    case "citizen-id": {
      const digits = s.replace(/\D/g, "");
      if (digits.length === 13) {
        return `${digits[0]}-xxxx-xxxxx-xx-${digits.slice(11)}`;
      }
      /* Not a real ID shape — keep nothing rather than guess positions. */
      return s.replace(/\d/g, "x");
    }
    case "phone": {
      const total = s.replace(/\D/g, "").length;
      if (total < 5) return s.replace(/\d/g, "x");
      let seen = 0;
      return [...s].map((ch) => {
        if (!/\d/.test(ch)) return ch;
        const keep = seen < 2 || seen >= total - 2;
        seen++;
        return keep ? ch : "x";
      }).join("");
    }
    case "name":
      return s.trim().slice(0, 1) + "***";
    case "dob": {
      let m = s.trim().match(/^(\d{4})([-/.])\d{1,2}\2\d{1,2}$/);
      if (m) return `${m[1]}${m[2]}xx${m[2]}xx`;
      m = s.trim().match(/^\d{1,2}([-/.])\d{1,2}\1(\d{4})$/);
      if (m) return `xx${m[1]}xx${m[1]}${m[2]}`;
      return "xxxx";
    }
    case "student-id":
    default:
      return s;
  }
}

/* Strict-mode student IDs: maskValue's student-id branch is the
   teacher-facing contract (unchanged), but the AI never needs ANY
   identifier — so for AI-bound rows every letter and digit becomes x. */
function fullMask(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.trim() === "") return "";
  return s.replace(/[0-9A-Za-zก-๛]/g, "x");
}

/**
 * maskRows(headers, rows, detections, { strict }) -> new rows.
 *
 * Non-strict (previews and exports a teacher keeps): only citizen-id and
 * phone are masked — names and birthdates are data a teacher legitimately
 * works with inside the school.
 * Strict (anything leaving for the AI): citizen-id, phone, name, dob AND
 * student-id are all masked. Never mutates its inputs.
 */
export function maskRows(headers, rows, detections = [], { strict = false } = {}) {
  const maskable = strict
    ? new Set(["citizen-id", "phone", "name", "dob", "student-id"])
    : new Set(["citizen-id", "phone"]);
  const kindByIndex = new Map();
  for (const d of detections) {
    if (maskable.has(d.kind)) kindByIndex.set(d.index, d.kind);
  }
  return rows.map((row) => row.map((cell, i) => {
    if (!kindByIndex.has(i)) return cell;
    const kind = kindByIndex.get(i);
    if (strict && kind === "student-id") return fullMask(cell);
    return maskValue(cell, kind);
  }));
}

/* The "average citizen ID" is nonsense that must not render or reach the
   AI — a 13-digit label parses as a number, so analyze.js dutifully
   computes min/max/avg for it. Those aggregates are wiped, not masked:
   there is no truthful masked version of a meaningless statistic. */
const NUMERIC_AGGREGATES = ["min", "max", "avg", "median", "q1", "q3", "stdDev", "sum"];

/**
 * maskColAnalysis(colAnalysis, detections) -> new array, inputs untouched.
 * Flagged columns get { sensitive: kind }, their top[].value masked, and —
 * for citizen-id/phone columns that came out numeric — their aggregate
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
    if ((kind === "citizen-id" || kind === "phone") && c.type === "numeric") {
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
 * column cannot slip past on a tiny sample. Non-strict masking here (citizen
 * IDs and phones x'd; names/DOB/student ids stay readable — teachers need
 * them); the AI boundary applies its own STRICT pass on top. The original
 * file bytes in object storage are untouched: this guards what the SERVER
 * shows and sends, not what the owner keeps.
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
    if (d.kind === "citizen-id" || d.kind === "phone" || d.kind === "student-id") {
      for (const k of ["min", "max", "avg", "median", "q1", "q3", "iqr", "stdDev", "sum"]) {
        if (k in out) out[k] = null;
      }
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

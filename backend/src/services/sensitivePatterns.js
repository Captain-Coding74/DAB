/**
 * The evidence sensitive.js classifies with: value predicates and header
 * vocabulary (Thai AND English). Split out of sensitive.js in v21.30, when
 * the kinds grew from five school identifiers to the full PDPA list, so the
 * classifier and the masking policy stay readable on their own.
 *
 * THAI HAS NO WORD SPACING
 * ------------------------
 * A Thai header is one unbroken run of letters, so a short pattern matches
 * inside unrelated words: "ยา" (medicine) sits inside ยาว (long) and พยาบาล,
 * "ชาติ" inside both เชื้อชาติ (race, s.26) and สัญชาติ (nationality, not
 * s.26), "ไลน์" inside ออนไลน์ (online). Every Thai pattern below is the
 * whole compound word, and a near-miss that would flag ordinary business
 * columns (การรักษาลูกค้า — customer retention; ปุ๋ยชีวภาพ — bio-fertiliser)
 * is left out on purpose. English patterns use letter lookarounds, not \b,
 * where an underscore-joined name (customer_line_id) must still match.
 */

// ── Value predicates ──────────────────────────────────────

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

/**
 * True for a payment-card number: 13–19 digits (spaces/dashes allowed)
 * passing the Luhn check. Like the citizen-ID checksum, Luhn is what makes
 * value evidence trustworthy — a random 16-digit order number passes one
 * time in ten, so the majority rule in the classifier does the rest. A
 * leading 0 or a single repeated digit ("0000…", which Luhn accepts) is
 * filler, not a card.
 */
export function isPaymentCard(value) {
  if (value == null) return false;
  const s = String(value).trim();
  if (!/^\d[\d\s-]*\d$/.test(s)) return false;
  const digits = s.replace(/[\s-]/g, "");
  if (digits.length < 13 || digits.length > 19 || digits[0] === "0" || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** local@domain.tld — distinctive enough to classify on values alone. */
export function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(String(s).trim());
}

/** Thai mobile/landline: leading 0 then 8-9 more digits, dashes/spaces ok. */
export function looksLikeThaiPhone(s) {
  if (!/^[\d\s-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits[0] === "0" && (digits.length === 9 || digits.length === 10);
}

/** ISO 2010-05-14 or Thai day-first 14/05/2553 (Buddhist years included). */
export function looksLikeDob(s) {
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)
      || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(s);
}

/** Contains an actual letter (Thai or Latin) — a name is never a number. */
export function looksLikeName(s) {
  return /[A-Za-zก-๎]/.test(s);
}

/** A digit run (dashes/spaces allowed) that is NOT a valid citizen ID. */
export function looksLikeStudentId(s) {
  if (!/^[\d\s-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 13 && !isThaiCitizenId(s);
}

/** Thai bank accounts are 10 digits (12 at GSB/BAAC), often dashed. */
function looksLikeBankAccount(s) {
  if (!/^[\d\s-]+$/.test(s)) return false;
  const n = s.replace(/\D/g, "").length;
  return n >= 10 && n <= 12;
}

/** Thai and most ICAO passports: one or two letters, then 6–8 digits. */
function looksLikePassport(s) {
  return /^[A-Z]{1,2}\d{6,8}$/i.test(s.replace(/\s/g, ""));
}

/* Roll-call headers, anchored — bare "ที่" only as the WHOLE header, so
   "เลขที่บ้าน" (house number) or "วันที่" can never match. */
export const ROLL_HEADER_RE = /^(ลำดับ(ที่)?|เลขที่|ที่|no\.?|#)$/i;

/** A 1..N-ish sequence: small integers, starts at ≤3, mostly +1 steps. */
export function looksLikeRollSequence(values) {
  if (values.length < 3) return false;
  const nums = values.map((v) => Number(v));
  if (!nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 999)) return false;
  if (nums[0] > 3) return false;
  let steps = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1] + 1) steps++;
  return steps >= (nums.length - 1) * 0.7;
}

/* Kinds whose VALUES are distinctive enough to flag a column whatever its
   header says, strongest first. Checksums (citizen ID, Luhn) cannot happen
   by accident at majority scale; an email address cannot be anything else. */
export const VALUE_KINDS = [
  { kind: "citizen-id", test: isThaiCitizenId },
  { kind: "card",       test: isPaymentCard },
  { kind: "email",      test: looksLikeEmail },
];

/* The value shape that lifts a header match to "high" confidence. Kinds
   with no checkable shape (address, social-id, every s.26 kind) stay at
   "medium" — the header is the only evidence there is. */
export const SHAPES = {
  "student-id":   looksLikeStudentId,
  "name":         looksLikeName,
  "dob":          looksLikeDob,
  "phone":        looksLikeThaiPhone,
  "bank-account": looksLikeBankAccount,
  "passport":     looksLikePassport,
};

// ── Header patterns (Thai AND English), in severity order ─
/* Order matters. "เลขประจำตัวประชาชน" — the official name of the citizen ID —
   contains "เลขประจำตัว", which alone means student ID, so citizen-id is
   checked first. "เลขบัตรเครดิต" contains "เลขบัตร" (citizen-id), so card
   comes before it. "email address" must be email, not address. The PDPA
   s.26 kinds come before "name" so "ชื่อโรค" (disease name) is health data. */
export const HEADER_PATTERNS = [
  { kind: "card",         re: /บัตรเครดิต|บัตรเดบิต|(credit|debit)[\s_-]?card|card[\s_-]?(no|num|number)(?![a-z])|(?<![a-z])cc[\s_-]?(no|num|number)(?![a-z])/i },
  { kind: "citizen-id",   re: /ประชาชน|เลขบัตร|citizen|national[\s_-]?id/i },
  { kind: "passport",     re: /หนังสือเดินทาง|พาสปอร์ต|passport/i },
  { kind: "bank-account", re: /เลขที่บัญชี|เลขบัญชี|บัญชีธนาคาร|พร้อมเพย์|bank[\s_-]?acc|account[\s_-]?(no|num|number)(?![a-z])|(?<![a-z])iban(?![a-z])|promptpay/i },
  { kind: "student-id",   re: /เลขประจำตัว|รหัสนักเรียน|รหัสนิสิต|รหัสนักศึกษา|student[\s_-]?id/i },
  { kind: "dob",          re: /เกิด|birth|\bdob\b|d\.o\.b/i },
  { kind: "email",        re: /e[\s_-]?mail|อีเมล/i },
  { kind: "social-id",    re: /ไอดี\s*ไลน์|ไลน์\s*(ไอดี|id)|^\s*ไลน์\s*$|(?<![a-z])line[\s_-]?(id|user|account)(?![a-z])|(?<![a-z])id[\s_-]?line(?![a-z])|facebook|เฟซบุ๊ก|เฟสบุ๊ค|เฟสบุ๊ก|instagram|อินสตาแกรม|tiktok|twitter|(?<![a-z])(fb|ig)(?![a-z])|social[\s_-]?media|โซเชียลมีเดีย/i },
  { kind: "phone",        re: /เบอร์|โทร|มือถือ|phone|\btel\b|mobile/i },
  { kind: "address",      re: /ที่อยู่|รหัสไปรษณีย์|address|street|postal|post[\s_-]?code|zip[\s_-]?code|(?<![a-z])zip(?![a-z])/i },
  // ── PDPA s.26 — sensitive data, detected by header only ──
  { kind: "health",       re: /สุขภาพ|โรค|วินิจฉัย|อาการ|ประวัติการรักษา|การรักษาพยาบาล|แพ้ยา|กรุ๊ปเลือด|หมู่เลือด|ความดันโลหิต|น้ำตาลในเลือด|เวชระเบียน|ผลตรวจเลือด|ผลแล็บ|ตั้งครรภ์|diagnos|disease|illness|medical|medication|prescription|symptom|allerg|blood[\s_-]?(type|group|pressure|sugar)|health[\s_-]?(condition|status|record|issue|problem|history)|(?<![a-z])(icd|hiv)(?![a-z])|pregnan/i },
  { kind: "religion",     re: /ศาสนา|ลัทธิ|religio|(?<![a-z])faith(?![a-z])/i },
  { kind: "ethnicity",    re: /เชื้อชาติ|เผ่าพันธุ์|ชาติพันธุ์|ethnic|\brace\b|racial/i },
  { kind: "disability",   re: /พิการ|ทุพพลภาพ|disabilit|handicap|wheelchair/i },
  { kind: "criminal",     re: /อาชญากร|คดีอาญา|ประวัติคดี|ต้องโทษ|criminal|conviction|felony|(arrest|police)[\s_-]?record/i },
  { kind: "sexual-orientation", re: /รสนิยมทางเพศ|เพศวิถี|พฤติกรรมทางเพศ|sexual[\s_-]?(orientation|behaviou?r|preference)|sexuality|lgbt/i },
  { kind: "political",    re: /การเมือง|พรรค|politic|party[\s_-]?(affiliation|member)/i },
  { kind: "trade-union",  re: /สหภาพแรงงาน|สมาชิกสหภาพ|(trade|labou?r)[\s_-]?union|union[\s_-]?member/i },
  /* Genetic data rides with biometric: both are body-derived and both are
     listed in s.26; the kind names the category the notice uses. */
  { kind: "biometric",    re: /ลายนิ้วมือ|ม่านตา|ใบหน้า|ชีวมิติ|พันธุกรรม|biometric|fingerprint|face[\s_-]?(id|scan|template|print)|facial|iris[\s_-]?scan|retina|voice[\s_-]?print|(?<![a-z])dna(?![a-z])|genetic/i },
  { kind: "name",         re: /ชื่อ|สกุล|name/i },
];

/** PDPA s.26 kinds — readable in the owner's own view, never sent to AI. */
export const S26_KINDS = new Set([
  "health", "religion", "ethnicity", "disability", "criminal",
  "sexual-orientation", "political", "trade-union", "biometric",
]);

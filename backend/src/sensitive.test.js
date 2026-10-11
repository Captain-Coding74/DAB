/**
 * sensitive.test.js — the checksum vectors are GENERATED, not copied.
 *
 * Hard-coded "known good" IDs rot: nobody can tell whether the vector or
 * the implementation is wrong when one fails. The helper below builds a
 * valid ID from 12 random digits plus the check digit computed by the
 * published mod-11 rule, so every run exercises fresh vectors — and the
 * off-by-one cases prove the checksum is actually being checked, not just
 * the length.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  isThaiCitizenId,
  classifySensitiveColumns,
  maskValue,
  maskRows,
  maskColAnalysis,
  guardParsed,
  S26_KINDS,
} from "./services/sensitive.js";
import { isPaymentCard } from "./services/sensitivePatterns.js";
import { parseFileStreaming } from "./services/streaming.js";

/** Compute the mod-11 check digit for 12 leading digits. */
function checkDigit(d12) {
  const sum = d12.reduce((acc, d, i) => acc + d * (13 - i), 0);
  return (11 - (sum % 11)) % 10;
}

/** A VALID citizen ID: first digit 1-9, 11 random digits, computed check. */
function makeCitizenId() {
  const d = [1 + Math.floor(Math.random() * 9)];
  for (let i = 1; i < 12; i++) d.push(Math.floor(Math.random() * 10));
  d.push(checkDigit(d));
  return d.join("");
}

/** The same ID in the canonical printed layout: 1-2345-67890-12-1. */
const dashed = (id) =>
  `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;

/** The same ID with a deliberately wrong (off-by-one) check digit. */
const offByOne = (id) => id.slice(0, 12) + ((Number(id[12]) + 1) % 10);

describe("isThaiCitizenId — the checksum is the law", () => {
  test("twenty generated IDs with computed check digits all pass", () => {
    for (let i = 0; i < 20; i++) {
      const id = makeCitizenId();
      assert.equal(isThaiCitizenId(id), true, `${id} should pass`);
    }
  });

  test("an off-by-one check digit fails, same 13 digits or not", () => {
    for (let i = 0; i < 20; i++) {
      const bad = offByOne(makeCitizenId());
      assert.equal(isThaiCitizenId(bad), false, `${bad} should fail`);
    }
  });

  test("dashes and spaces between digits are accepted", () => {
    const id = makeCitizenId();
    assert.equal(isThaiCitizenId(dashed(id)), true);
    assert.equal(isThaiCitizenId(id.split("").join(" ")), true);
    assert.equal(isThaiCitizenId(` ${dashed(id)} `), true);
  });

  test("wrong length, letters, and a leading zero are rejected", () => {
    const id = makeCitizenId();
    assert.equal(isThaiCitizenId(id.slice(0, 12)), false, "12 digits");
    assert.equal(isThaiCitizenId(id + "1"), false, "14 digits");
    assert.equal(isThaiCitizenId("a" + id.slice(1)), false, "letter inside");
    // A leading zero fails even with a correct check digit — real IDs never start with 0.
    const zeroLed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1];
    assert.equal(isThaiCitizenId(zeroLed.join("") + checkDigit(zeroLed)), false);
  });

  test("null, undefined and empty are simply false", () => {
    assert.equal(isThaiCitizenId(null), false);
    assert.equal(isThaiCitizenId(undefined), false);
    assert.equal(isThaiCitizenId(""), false);
    assert.equal(isThaiCitizenId("   "), false);
  });
});

describe("classifySensitiveColumns — headers lie, checksums do not", () => {
  test("header plus corroborating values is high confidence", () => {
    const headers = ["เลขบัตรประชาชน", "เบอร์โทร", "คะแนน"];
    const rows = [
      [makeCitizenId(), "081-234-5678", "87"],
      [dashed(makeCitizenId()), "062 345 6789", "62"],
      [makeCitizenId(), "021234567", "95"],
    ];
    const d = classifySensitiveColumns(headers, rows);
    assert.deepEqual(d.find((x) => x.index === 0),
      { index: 0, col: "เลขบัตรประชาชน", kind: "citizen-id", confidence: "high" });
    assert.deepEqual(d.find((x) => x.index === 1),
      { index: 1, col: "เบอร์โทร", kind: "phone", confidence: "high" });
    assert.equal(d.find((x) => x.index === 2), undefined, "a score column is not sensitive");
  });

  test("a matching header with no values to corroborate is medium", () => {
    const d = classifySensitiveColumns(["เลขบัตรประชาชน", "เบอร์โทร", "phone_2"], []);
    assert.deepEqual(d.map((x) => [x.kind, x.confidence]), [
      ["citizen-id", "medium"],
      ["phone", "medium"],
      ["phone", "medium"],
    ]);
  });

  test("a lying header cannot hide a citizen-id column", () => {
    // "รหัสอ้างอิง" matches no pattern; the checksum majority still flags it.
    const rows = Array.from({ length: 10 }, () => [makeCitizenId(), "A"]);
    const d = classifySensitiveColumns(["รหัสอ้างอิง", "ห้อง"], rows);
    assert.deepEqual(d, [
      { index: 0, col: "รหัสอ้างอิง", kind: "citizen-id", confidence: "high" },
    ]);
  });

  test("a student-id header holding real citizen IDs becomes citizen-id", () => {
    const rows = Array.from({ length: 6 }, () => [makeCitizenId()]);
    const d = classifySensitiveColumns(["เลขประจำตัว"], rows);
    assert.equal(d[0].kind, "citizen-id");
    assert.equal(d[0].confidence, "high");
  });

  test("เลขประจำตัวประชาชน is citizen-id, not student-id", () => {
    const d = classifySensitiveColumns(["เลขประจำตัวประชาชน"], []);
    assert.equal(d[0].kind, "citizen-id");
  });

  test("a numeric column is never flagged just for being numeric", () => {
    const rows = [["1000", "13"], ["2000", "12"], ["1500", "14"]];
    assert.deepEqual(classifySensitiveColumns(["ยอดขาย", "อายุ"], rows), []);
  });

  test("13-digit numbers with broken checksums do not flag a neutral header", () => {
    const rows = Array.from({ length: 10 }, () => [offByOne(makeCitizenId())]);
    assert.deepEqual(classifySensitiveColumns(["รหัสอ้างอิง"], rows), []);
  });

  test("Thai and English header vocabulary both classify", () => {
    const d = classifySensitiveColumns(
      ["ชื่อ-สกุล", "วันเกิด", "national_id", "student id", "mobile"], []);
    assert.deepEqual(d.map((x) => x.kind),
      ["name", "dob", "citizen-id", "student-id", "phone"]);
  });
});

describe("maskValue — what a masked value looks like", () => {
  test("citizen-id keeps the first digit, the last two, and the dashes", () => {
    const id = makeCitizenId();
    const expected = `${id[0]}-xxxx-xxxxx-xx-${id.slice(11)}`;
    assert.equal(maskValue(id, "citizen-id"), expected);
    assert.equal(maskValue(dashed(id), "citizen-id"), expected, "dashed input, same mask");
  });

  test("a citizen-id cell that is not 13 digits leaks no digit at all", () => {
    assert.equal(maskValue("12345", "citizen-id"), "xxxxx");
  });

  test("phone keeps first 2 and last 2 digits, separators survive", () => {
    assert.equal(maskValue("0812345678", "phone"), "08xxxxxx78");
    assert.equal(maskValue("081-234-5678", "phone"), "08x-xxx-xx78");
    assert.equal(maskValue("02 123 4567", "phone"), "02 xxx xx67");
  });

  test("name is first character + ***", () => {
    assert.equal(maskValue("สมชาย ใจดี", "name"), "ส***");
    assert.equal(maskValue("Somchai", "name"), "S***");
  });

  test("dob keeps only the year, in both ISO and Thai day-first shapes", () => {
    assert.equal(maskValue("2010-05-14", "dob"), "2010-xx-xx");
    assert.equal(maskValue("14/05/2553", "dob"), "xx/xx/2553");
    assert.equal(maskValue("ไม่ทราบ", "dob"), "xxxx", "unparseable dates leak nothing");
  });

  test("student-id is returned unchanged — teachers need it", () => {
    assert.equal(maskValue("12345", "student-id"), "12345");
  });

  test("empty and null stay empty for every kind", () => {
    for (const kind of ["citizen-id", "student-id", "name", "dob", "phone"]) {
      assert.equal(maskValue("", kind), "");
      assert.equal(maskValue(null, kind), "");
      assert.equal(maskValue(undefined, kind), "");
    }
  });
});

describe("maskRows — the view a user keeps", () => {
  const id = makeCitizenId();
  const headers = ["เลขประจำตัว", "ชื่อ", "บัตรประชาชน", "เบอร์โทร", "วันเกิด", "คะแนน"];
  const detections = [
    { index: 0, col: "เลขประจำตัว", kind: "student-id", confidence: "high" },
    { index: 1, col: "ชื่อ", kind: "name", confidence: "high" },
    { index: 2, col: "บัตรประชาชน", kind: "citizen-id", confidence: "high" },
    { index: 3, col: "เบอร์โทร", kind: "phone", confidence: "high" },
    { index: 4, col: "วันเกิด", kind: "dob", confidence: "medium" },
  ];
  const rows = [["12345", "สมชาย", id, "0812345678", "2010-05-14", "87"]];

  test("non-strict masks ONLY citizen-id and phone", () => {
    const out = maskRows(headers, rows, detections);
    assert.equal(out[0][0], "12345", "student id survives a preview");
    assert.equal(out[0][1], "สมชาย", "name survives a preview");
    assert.equal(out[0][2], `${id[0]}-xxxx-xxxxx-xx-${id.slice(11)}`);
    assert.equal(out[0][3], "08xxxxxx78");
    assert.equal(out[0][4], "2010-05-14", "dob survives a preview");
    assert.equal(out[0][5], "87");
  });

  test("v21.30: direct identifiers are masked, s.26 values stay readable", () => {
    const h = ["email", "card", "acct", "passport", "addr", "line", "diagnosis"];
    const det = ["email", "card", "bank-account", "passport", "address", "social-id", "health"]
      .map((kind, index) => ({ index, col: h[index], kind, confidence: "medium" }));
    const [out] = maskRows(h, [[
      "somchai@example.co.th", "4111 1111 1111 1111", "123-4-56789-0", "AA1234567",
      "99 ถนนสุขุมวิท กรุงเทพฯ", "somchai.line", "เบาหวาน",
    ]], det);
    assert.deepEqual(out, [
      "s***@example.co.th", "xxxx xxxx xxxx 1111", "xxx-x-xx789-0", "AAxxxxxxx",
      "9***", "s***", "เบาหวาน",
    ]);
  });

  test("inputs are never mutated, and the output is new arrays", () => {
    const before = JSON.stringify(rows);
    const out = maskRows(headers, rows, detections);
    assert.equal(JSON.stringify(rows), before, "rows untouched");
    assert.notEqual(out, rows);
    assert.notEqual(out[0], rows[0]);
  });
});

describe("maskColAnalysis — the average citizen ID is nonsense", () => {
  const id = makeCitizenId();
  const colAnalysis = [
    {
      col: "บัตรประชาชน", type: "numeric", count: 3,
      min: 1.1e12, max: 8.9e12, sum: 1.5e13, avg: 5e12,
      median: 5e12, stdDev: 1.2e11, q1: 2e12, q3: 8e12, iqr: 6e12,
    },
    {
      col: "ชื่อ", type: "text", count: 3, unique: 2,
      top: [{ value: "สมชาย", count: 2, pct: "66.7" }, { value: "สมหญิง", count: 1, pct: "33.3" }],
    },
    { col: "คะแนน", type: "numeric", count: 3, avg: 70, min: 60, max: 80 },
  ];
  const detections = [
    { index: 0, col: "บัตรประชาชน", kind: "citizen-id", confidence: "high" },
    { index: 1, col: "ชื่อ", kind: "name", confidence: "high" },
  ];

  test("numeric aggregates are nulled for a citizen-id column", () => {
    const out = maskColAnalysis(colAnalysis, detections);
    const cid = out.find((c) => c.col === "บัตรประชาชน");
    for (const k of ["min", "max", "avg", "median", "q1", "q3", "stdDev", "sum"]) {
      assert.equal(cid[k], null, `${k} must not render`);
    }
    assert.equal(cid.sensitive, "citizen-id");
    assert.equal(cid.count, 3, "the row count is not personal data");
  });

  test("top values of a flagged text column are masked", () => {
    const out = maskColAnalysis(colAnalysis, detections);
    const name = out.find((c) => c.col === "ชื่อ");
    assert.deepEqual(name.top.map((t) => t.value), ["ส***", "ส***"]);
    assert.equal(name.top[0].count, 2, "counts survive — only the value is personal");
    assert.equal(name.sensitive, "name");
  });

  test("a text citizen-id column masks its top values with the canonical mask", () => {
    const analysis = [{
      col: "เลขบัตร", type: "text", count: 1,
      top: [{ value: dashed(id), count: 1, pct: "100.0" }],
    }];
    const out = maskColAnalysis(analysis,
      [{ index: 0, col: "เลขบัตร", kind: "citizen-id", confidence: "high" }]);
    assert.equal(out[0].top[0].value, `${id[0]}-xxxx-xxxxx-xx-${id.slice(11)}`);
  });

  test("unflagged columns pass through untouched", () => {
    const out = maskColAnalysis(colAnalysis, detections);
    const score = out.find((c) => c.col === "คะแนน");
    assert.equal(score.avg, 70);
    assert.equal(score.sensitive, undefined);
  });

  test("the input analysis is never mutated", () => {
    const before = JSON.stringify(colAnalysis);
    maskColAnalysis(colAnalysis, detections);
    assert.equal(JSON.stringify(colAnalysis), before);
    assert.equal(colAnalysis[0].avg, 5e12, "original aggregate intact");
    assert.equal(colAnalysis[1].top[0].value, "สมชาย", "original top value intact");
  });
});

describe("sparse identifier columns (v21.23)", () => {
  test("citizen IDs that start after row 50 are still detected", () => {
    // valid mod-11 id generator (same math as the module under test)
    const mkId = (seed) => {
      const d = [1 + (seed % 8)];
      for (let i = 1; i < 12; i++) d.push((seed * (i + 7)) % 10);
      const sum = d.reduce((s, digit, i) => s + digit * (13 - i), 0);
      d.push((11 - (sum % 11)) % 10);
      return d.join("");
    };
    const headers = ["เลขอ้างอิง", "คะแนน"];   // lying header: no PII pattern
    const rows = [];
    for (let i = 0; i < 55; i++) rows.push(["", String(i)]);          // blank early
    for (let i = 0; i < 45; i++) rows.push([mkId(i + 3), String(i)]); // ids late
    const det = classifySensitiveColumns(headers, rows);
    assert.ok(det.some((d) => d.col === "เลขอ้างอิง" && d.kind === "citizen-id"),
      "sparse citizen-id column must be detected (the old first-50-ROWS window sampled only blanks)");
  });
});

describe("roll-number detection (v21.24)", () => {
  const seq = (n) => Array.from({ length: n }, (_, i) => [String(i + 1), String(20 - i)]);
  test("ลำดับ with a 1..N sequence classifies as student-id", () => {
    const det = classifySensitiveColumns(["ลำดับ", "คะแนน"], seq(8));
    assert.ok(det.some((d) => d.col === "ลำดับ" && d.kind === "student-id" && d.confidence === "high"));
  });
  test("เลขที่ works; เลขที่บ้าน does not (anchored header)", () => {
    assert.ok(classifySensitiveColumns(["เลขที่"], seq(5).map((r) => [r[0]])).length === 1);
    assert.equal(classifySensitiveColumns(["เลขที่บ้าน"], [["12"], ["7"], ["309"]]).length, 0);
  });
  test("a column NAMED ลำดับ holding scores stays unflagged", () => {
    const det = classifySensitiveColumns(["ลำดับ"], [["25"], ["18"], ["22"], ["9"]]);
    assert.equal(det.length, 0);   // not a 1..N sequence — values disagree with the header
  });
});

// ── v21.30: the PDPA kinds beyond the School Edition five ─────────────────

/** A valid card number: 15 digits + the Luhn check digit (fresh every run). */
function makeCard(prefix = "4") {
  const d = [...prefix].map(Number);
  while (d.length < 15) d.push(Math.floor(Math.random() * 10));
  const sum = d.reduce((acc, x, i) => {
    // positions counted from the right once the check digit is appended
    const fromRight = d.length - i;
    let v = x;
    if (fromRight % 2 === 1) { v *= 2; if (v > 9) v -= 9; }
    return acc + v;
  }, 0);
  return d.join("") + ((10 - (sum % 10)) % 10);
}

describe("v21.30 detection — values where values are distinctive", () => {
  test("Luhn: generated cards pass, an off-by-one check digit fails", () => {
    for (let i = 0; i < 20; i++) {
      const c = makeCard();
      assert.equal(isPaymentCard(c), true, `${c} should pass`);
      assert.equal(isPaymentCard(c.slice(0, 15) + ((Number(c[15]) + 1) % 10)), false);
    }
    assert.equal(isPaymentCard("4111-1111-1111-1111"), true, "dashes allowed");
    assert.equal(isPaymentCard("0000000000000000"), false, "repeated filler is not a card");
    assert.equal(isPaymentCard("411111111111"), false, "12 digits is too short");
  });

  test("a card column is flagged by its values whatever the header", () => {
    const rows = Array.from({ length: 8 }, () => [makeCard(), "10"]);
    assert.deepEqual(classifySensitiveColumns(["ref", "qty"], rows),
      [{ index: 0, col: "ref", kind: "card", confidence: "high" }]);
  });

  test("random 16-digit order numbers do not pass the majority", () => {
    // Luhn passes 1 in 10 by chance — the majority rule is what holds.
    const rows = Array.from({ length: 30 }, (_, i) => [String(4000000000000000 + i * 7919)]);
    assert.deepEqual(classifySensitiveColumns(["order_no"], rows), []);
  });

  test("an email column is flagged by its values whatever the header", () => {
    const rows = ["a@x.co", "b.c@mail.example.com", "", "ก@โดเมน.ไทย"].map((v) => [v]);
    assert.equal(classifySensitiveColumns(["contact"], rows)[0]?.kind, "email");
  });
});

describe("v21.30 detection — headers, Thai and English", () => {
  const kindOf = (h, rows = []) => classifySensitiveColumns([h], rows)[0]?.kind;
  const CASES = {
    "email":        ["อีเมล", "E-mail", "customer_email", "อีเมล์ลูกค้า"],
    "card":         ["เลขบัตรเครดิต", "credit_card", "Card No."],
    "bank-account": ["เลขที่บัญชี", "เลขบัญชีธนาคาร", "bank_account", "Account Number", "พร้อมเพย์"],
    "passport":     ["เลขหนังสือเดินทาง", "พาสปอร์ต", "passport_no"],
    "address":      ["ที่อยู่", "ที่อยู่จัดส่ง", "รหัสไปรษณีย์", "address", "Street", "zip_code"],
    "social-id":    ["ไอดีไลน์", "ไลน์", "line_id", "LINE ID", "customer_line_id", "Facebook", "IG"],
    "health":       ["โรคประจำตัว", "การวินิจฉัย", "อาการ", "กรุ๊ปเลือด", "แพ้ยา", "diagnosis", "medical_history", "blood_type"],
    "religion":     ["ศาสนา", "religion"],
    "ethnicity":    ["เชื้อชาติ", "ethnicity", "Race"],
    "disability":   ["ความพิการ", "ประเภทความพิการ", "disability"],
    "criminal":     ["ประวัติอาชญากรรม", "คดีอาญา", "criminal_record"],
    "sexual-orientation": ["รสนิยมทางเพศ", "sexual_orientation"],
    "political":    ["พรรคการเมือง", "ความคิดเห็นทางการเมือง", "political_view"],
    "trade-union":  ["สมาชิกสหภาพแรงงาน", "trade_union"],
    "biometric":    ["ลายนิ้วมือ", "ข้อมูลใบหน้า", "fingerprint", "face_id", "DNA"],
  };
  for (const [kind, headers] of Object.entries(CASES)) {
    test(`${kind}: ${headers.join(" · ")}`, () => {
      for (const h of headers) assert.equal(kindOf(h), kind, `"${h}"`);
    });
  }

  test("s.26 kinds are exactly the nine PDPA categories", () => {
    assert.deepEqual([...S26_KINDS].sort(), ["biometric", "criminal", "disability", "ethnicity", "health",
      "political", "religion", "sexual-orientation", "trade-union"]);
  });

  test("Thai near-misses with no word spacing stay unflagged", () => {
    // "ยา" alone is NOT a pattern (ยาว, พยาบาล); "ไลน์" only whole or with id;
    // สัญชาติ is nationality, not race; การรักษาลูกค้า is customer retention.
    for (const h of ["ความยาว", "ช่องทางออนไลน์", "สัญชาติ", "การรักษาลูกค้า", "ปุ๋ยชีวภาพ", "ยอดขาย",
      "deadline", "online_sales", "product_line", "is_disabled", "race_id", "zipper_size", "เพศ", "party_size"]) {
      assert.equal(kindOf(h), undefined, `"${h}" must not be flagged`);
    }
  });

  test("specific beats general: card before citizen-id, email before address", () => {
    assert.equal(kindOf("เลขบัตรเครดิต"), "card");
    assert.equal(kindOf("email address"), "email");
    assert.equal(kindOf("ชื่อโรค"), "health", "a disease name is health data, not a person's name");
  });

  test("shape-corroborated header kinds reach high confidence", () => {
    const d = classifySensitiveColumns(["เลขที่บัญชี", "passport"],
      [["123-4-56789-0", "AA1234567"], ["9876543210", "AB7654321"]]);
    assert.deepEqual(d.map((x) => x.confidence), ["high", "high"]);
  });
});

describe("v21.30 masking — what a masked value looks like", () => {
  test("email keeps the first character and the domain", () => {
    assert.equal(maskValue("somchai@example.co.th", "email"), "s***@example.co.th");
    assert.equal(maskValue("not-an-email", "email"), "n***");
  });

  test("card and bank account keep the last four digits only", () => {
    assert.equal(maskValue("4111111111111111", "card"), "xxxxxxxxxxxx1111");
    assert.equal(maskValue("123-4-56789-0", "bank-account"), "xxx-x-xx789-0");
    assert.equal(maskValue("12345", "bank-account"), "xxxxx", "too short to be what we expected");
  });

  test("passport keeps the first two characters", () => {
    assert.equal(maskValue("AA1234567", "passport"), "AAxxxxxxx");
  });

  test("address and social id are first character + ***", () => {
    assert.equal(maskValue("99 ถนนสุขุมวิท", "address"), "9***");
    assert.equal(maskValue("somchai.line", "social-id"), "s***");
  });

  test("s.26 values are the owner's own view — readable, but flagged", () => {
    for (const kind of S26_KINDS) assert.equal(maskValue("เบาหวาน", kind), "เบาหวาน");
    const [col] = maskColAnalysis(
      [{ col: "โรคประจำตัว", type: "text", top: [{ value: "เบาหวาน", count: 3 }] }],
      [{ index: 0, col: "โรคประจำตัว", kind: "health", confidence: "medium" }]);
    assert.equal(col.sensitive, "health", "flagged so AI payloads and share pages leave it out");
    assert.equal(col.top[0].value, "เบาหวาน");
  });

  test("a numeric card column loses its aggregates and trend at the parse boundary", () => {
    const parsed = guardParsed({
      headers: ["card"], headRows: Array.from({ length: 5 }, () => [makeCard()]), sampleRows: [],
      colAnalysis: [{ col: "card", type: "numeric", min: 4e15, max: 4.9e15, avg: 4.5e15, iqr: 1e14, trend: { n: 5 } }],
    });
    const c = parsed.colAnalysis[0];
    assert.equal(c.sensitive, "card");
    for (const k of ["min", "max", "avg", "iqr", "trend"]) assert.equal(c[k], null, k);
  });
});

/* The release must not start masking columns of the files users already
   know. Detections on every bundled sample file are pinned to exactly what
   v21.29 found — a new pattern that fires on a demo file fails here. */
describe("v21.30: the bundled sample files gain no new detections", () => {
  const SCHOOL = [["เลขประจำตัว", "student-id"], ["บัตรประชาชน", "citizen-id"],
    ["ชื่อ-สกุล", "name"], ["ชื่อเล่น", "name"], ["วันเกิด", "dob"]];
  const EXPECTED = {
    "big_sales.csv": [], "classroom.csv": SCHOOL, "classroom.xlsx": SCHOOL,
    "inventory.csv": [], "sales.csv": [], "thai_shop.csv": [], "traffic.csv": [],
  };
  const dir = new URL("../sample-data/", import.meta.url);

  test("the pinned list covers every data file in sample-data/", () => {
    const files = readdirSync(dir).filter((f) => /\.(csv|xlsx)$/.test(f)).sort();
    assert.deepEqual(files, Object.keys(EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    test(file, async () => {
      const parsed = await parseFileStreaming(readFileSync(new URL(file, dir)), file);
      assert.deepEqual(parsed.sensitive.map((d) => [d.col, d.kind]), expected);
    });
  }
});

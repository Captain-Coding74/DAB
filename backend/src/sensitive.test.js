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
import {
  isThaiCitizenId,
  classifySensitiveColumns,
  maskValue,
  maskRows,
  maskColAnalysis,
} from "./services/sensitive.js";

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

describe("maskRows — strict is for the AI", () => {
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

  test("strict masks every identifier, student-id included", () => {
    const out = maskRows(headers, rows, detections, { strict: true });
    assert.equal(out[0][0], "xxxxx", "the AI never needs a student id");
    assert.equal(out[0][1], "ส***");
    assert.equal(out[0][2], `${id[0]}-xxxx-xxxxx-xx-${id.slice(11)}`);
    assert.equal(out[0][3], "08xxxxxx78");
    assert.equal(out[0][4], "2010-xx-xx");
    assert.equal(out[0][5], "87", "the actual data still flows");
  });

  test("inputs are never mutated, and the output is new arrays", () => {
    const before = JSON.stringify(rows);
    const out = maskRows(headers, rows, detections, { strict: true });
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

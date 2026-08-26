/**
 * classReport.test.js — the teacher's ranking view is deterministic and
 * PDPA-shaped: identity limited to student id + one name column, honor rule
 * matches the grade-4 boundary, and the citizen-id column never appears.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { buildClassReport } from "./services/classReport.js";
import { classifySensitiveColumns } from "./services/sensitive.js";
import { parseAllRows } from "./services/fullRows.js";
import { parseFileStreaming } from "./services/streaming.js";

const HEADERS = ["เลขประจำตัว", "ชื่อเล่น", "คะแนนเก็บ", "สอบปลายภาค"];
const COLS = [
  { col: "เลขประจำตัว", type: "numeric", max: 30005 },
  { col: "ชื่อเล่น", type: "text" },
  { col: "คะแนนเก็บ", type: "numeric", max: 28 },
  { col: "สอบปลายภาค", type: "numeric", max: 58 },
];
const SENS = [
  { col: "เลขประจำตัว", kind: "student-id", confidence: "high" },
  { col: "ชื่อเล่น", kind: "name", confidence: "high" },
];
const ROWS = [
  ["30001", "หนึ่ง", "28", "58"],   // 86 / 90 → 95.6% → honor
  ["30002", "สอง",  "20", "40"],   // 60 → 66.7%
  ["30003", "สาม",  "20", "40"],   // tie with สอง
  ["30004", "สี่",   "5",  "10"],   // 15 → bottom
];

describe("buildClassReport", () => {
  test("ranks by total with competition ranking and flags honor at ≥80%", () => {
    const r = buildClassReport({ headers: HEADERS, rows: ROWS, colAnalysis: COLS, sensitive: SENS });
    assert.ok(r);
    assert.equal(r.fullMarks, 30 + 60);                    // 28→30, 58→60 (nice ceilings)
    assert.deepEqual(r.students.map((s) => s.rank), [1, 2, 2, 4]);
    assert.equal(r.students[0].id, "30001");
    assert.equal(r.students[0].honor, true);
    assert.equal(r.honorCount, 1);
    assert.equal(r.max, 86); assert.equal(r.min, 15);
  });

  test("a real เกรด column overrides the percent rule", () => {
    const headers = [...HEADERS, "เกรด"];
    const cols = [...COLS, { col: "เกรด", type: "numeric", max: 4 }];
    const rows = ROWS.map((r, i) => [...r, i === 3 ? "4.00" : "3.50"]);   // bottom kid has 4.00
    const r = buildClassReport({ headers, rows, colAnalysis: cols, sensitive: SENS });
    assert.equal(r.gradeCol, "เกรด");
    assert.equal(r.students.find((s) => s.id === "30004").honor, true);
    assert.equal(r.students.find((s) => s.id === "30001").honor, false);
    assert.equal(r.honorCount, 1);
  });

  test("no student-id column → null (not classroom-shaped)", () => {
    assert.equal(buildClassReport({ headers: HEADERS, rows: ROWS, colAnalysis: COLS, sensitive: [] }), null);
  });

  test("classroom.csv end-to-end: honor roll exists and no citizen id leaks", async () => {
    const buf = fs.readFileSync(new URL("../sample-data/classroom.csv", import.meta.url));
    const parsed = await parseFileStreaming(buf, "classroom.csv");
    const { headers, rows } = parseAllRows(buf, "classroom.csv");
    const r = buildClassReport({ headers, rows, colAnalysis: parsed.colAnalysis, sensitive: parsed.sensitive });
    assert.ok(r, "classroom sample must produce a report");
    assert.equal(r.count, 40);
    assert.ok(r.honorCount >= 1, "someone earns เกียรติบัตร");
    assert.ok(!r.scoreCols.some((c) => c.includes("บัตรประชาชน")));
    const dump = JSON.stringify(r);
    assert.ok(!/[1-9]\d{12}/.test(dump), "no 13-digit citizen id anywhere in the report");
    assert.equal(r.students[0].rank, 1);
    assert.equal(r.students[0].total, r.max);
  });
});

describe("checklist — ช่องติ๊กส่งงาน", () => {
  const H = ["เลขประจำตัว", "ชื่อเล่น", "คะแนนเก็บ", "ส่งใบงาน", "การบ้าน", "เช็คชื่อ"];
  const C = [
    { col: "เลขประจำตัว", type: "numeric", max: 30004 },
    { col: "ชื่อเล่น", type: "text" },
    { col: "คะแนนเก็บ", type: "numeric", max: 28 },
    { col: "ส่งใบงาน", type: "text" },                       // ✓ / blank
    { col: "การบ้าน", type: "text" },                        // TRUE/FALSE (Sheets export)
    { col: "เช็คชื่อ", type: "numeric", max: 1 },             // 1/0 — must NOT become a score
  ];
  const S = [
    { col: "เลขประจำตัว", kind: "student-id", confidence: "high" },
    { col: "ชื่อเล่น", kind: "name", confidence: "high" },
  ];
  const R = [
    ["30001", "หนึ่ง", "28", "✓", "TRUE",  "1"],
    ["30002", "สอง",  "20", "",  "FALSE", "1"],   // blank = ไม่ส่ง
    ["30003", "สาม",  "18", "✓", "TRUE",  "0"],
    ["30004", "สี่",   "10", "✗", "TRUE",  "1"],
  ];

  test("detects ✓/blank, TRUE/FALSE and 1/0 — and keeps 1/0 out of the scores", () => {
    const r = buildClassReport({ headers: H, rows: R, colAnalysis: C, sensitive: S });
    assert.deepEqual(r.checklist.cols, ["ส่งใบงาน", "การบ้าน", "เช็คชื่อ"]);
    assert.deepEqual(r.scoreCols, ["คะแนนเก็บ"]);            // 1/0 col excluded
    assert.equal(r.fullMarks, 30);
    const rates = Object.fromEntries(r.checklist.rates.map((x) => [x.col, x.submitted]));
    assert.deepEqual(rates, { "ส่งใบงาน": 2, "การบ้าน": 3, "เช็คชื่อ": 3 });
  });

  test("incomplete list is worst-first with the exact missing columns", () => {
    const r = buildClassReport({ headers: H, rows: R, colAnalysis: C, sensitive: S });
    assert.equal(r.checklist.incomplete[0].id, "30002");     // ขาด 2 ชิ้น
    assert.deepEqual(r.checklist.incomplete[0].missingCols, ["ส่งใบงาน", "การบ้าน"]);
    const ids = r.checklist.incomplete.map((x) => x.id);
    assert.deepEqual(ids, ["30002", "30003", "30004"]);      // 2, then 1+1 by id
  });

  test("checkbox-only sheet still reports: ranked by fewest missing, no honor", () => {
    const h = ["เลขประจำตัว", "ส่งใบงาน", "การบ้าน"];
    const c = [{ col: "เลขประจำตัว", type: "numeric", max: 3 }, { col: "ส่งใบงาน", type: "text" }, { col: "การบ้าน", type: "text" }];
    const s = [{ col: "เลขประจำตัว", kind: "student-id", confidence: "high" }];
    const rows = [["1", "✓", "TRUE"], ["2", "", "FALSE"], ["3", "✓", "FALSE"]];
    const r = buildClassReport({ headers: h, rows, colAnalysis: c, sensitive: s });
    assert.ok(r);
    assert.equal(r.scoreCols.length, 0);
    assert.equal(r.max, null);
    assert.equal(r.honorCount, 0);
    assert.deepEqual(r.students.map((x) => x.id), ["1", "3", "2"]);   // fewest missing first
    assert.deepEqual(r.students.map((x) => x.rank), [1, 2, 3]);
  });

  test("a real score column full of marks is not misread as a checkbox", () => {
    const r = buildClassReport({ headers: H, rows: R, colAnalysis: C, sensitive: S });
    assert.ok(!r.checklist.cols.includes("คะแนนเก็บ"));
  });

  test("classroom.csv end-to-end: both demo checkbox columns detected", async () => {
    const buf = fs.readFileSync(new URL("../sample-data/classroom.csv", import.meta.url));
    const parsed = await parseFileStreaming(buf, "classroom.csv");
    const { headers, rows } = parseAllRows(buf, "classroom.csv");
    const r = buildClassReport({ headers, rows, colAnalysis: parsed.colAnalysis, sensitive: parsed.sensitive });
    assert.deepEqual(r.checklist.cols, ["ส่งใบงาน4", "ส่งการบ้าน5"]);
    assert.deepEqual(r.scoreCols, ["คะแนนก่อนเรียน", "คะแนนหลังเรียน", "งาน1", "งาน2", "งาน3"]);
    assert.ok(r.checklist.incomplete.length > 0, "some students owe work in the demo");
    const rate = r.checklist.rates.find((x) => x.col === "ส่งใบงาน4");
    assert.ok(rate.submitted > 25 && rate.submitted < 40, "plausible submit rate");
  });
});

describe("hunt regressions (v21.23)", () => {
  const S = [{ col: "เลขประจำตัว", kind: "student-id", confidence: "high" }];
  const base = (extraH = [], extraC = []) => ({
    headers: ["เลขประจำตัว", "คะแนน", ...extraH],
    colAnalysis: [
      { col: "เลขประจำตัว", type: "numeric", max: 4 },
      { col: "คะแนน", type: "numeric", max: 28 },
      ...extraC,
    ],
    sensitive: S,
  });

  test("a remarks column of only '-' is NOT a checkbox assignment", () => {
    const r = buildClassReport({ ...base(["หมายเหตุ"], [{ col: "หมายเหตุ", type: "text" }]),
      rows: [["1", "20", "-"], ["2", "15", "-"], ["3", "10", "-"], ["4", "25", "-"]] });
    assert.equal(r.checklist, null);
  });

  test("blank เกรด cell falls back to the percent rule instead of denying honours", () => {
    const cfg = base(["เกรด"], [{ col: "เกรด", type: "numeric", max: 4 }]);
    const r = buildClassReport({ ...cfg,
      rows: [["1", "28", ""], ["2", "15", "3.5"], ["3", "10", "2.0"], ["4", "25", "4.00"]] });
    const blankKid = r.students.find((s) => s.id === "1");   // 28/30 = 93% but no grade
    assert.equal(blankKid.honor, true, "93% with a BLANK grade cell earns the certificate");
    assert.equal(r.students.find((s) => s.id === "4").honor, true);
    assert.equal(r.students.find((s) => s.id === "2").honor, false);
  });

  test("even-sized class median averages the two middle totals", () => {
    const r = buildClassReport({ ...base(),
      rows: [["1", "28"], ["2", "20"], ["3", "10"], ["4", "6"]] });
    assert.equal(r.median, 15);   // (20 + 10) / 2 — not the lower-middle 10
  });
});

describe("ลำดับ-keyed gradebooks (v21.24)", () => {
  const rows6 = [
    ["1", "26501", "เอ", "25"], ["2", "26502", "บี", "20"], ["3", "26503", "ซี", "18"],
    ["4", "26504", "ดี", "28"], ["5", "26505", "อี", "10"], ["6", "26506", "เอฟ", "22"],
  ];
  const cols = [
    { col: "ลำดับ", type: "numeric", max: 6 },
    { col: "เลขประจำตัว", type: "numeric", max: 26506 },
    { col: "ชื่อเล่น", type: "text" },
    { col: "คะแนน", type: "numeric", max: 28 },
  ];
  const sens = [
    { col: "ลำดับ", kind: "student-id", confidence: "high" },
    { col: "เลขประจำตัว", kind: "student-id", confidence: "high" },
    { col: "ชื่อเล่น", kind: "name", confidence: "high" },
  ];

  test("roll-only file (no formal id) still gets a report, roll excluded from totals", () => {
    const r = buildClassReport({
      headers: ["ลำดับ", "ชื่อเล่น", "คะแนน"],
      rows: rows6.map((x) => [x[0], x[2], x[3]]),
      colAnalysis: [cols[0], cols[2], cols[3]],
      sensitive: [sens[0], sens[2]],
      fileName: "ห้อง 5-13.xlsx",
    });
    assert.ok(r);
    assert.equal(r.idCol, "ลำดับ");
    assert.equal(r.className, "ห้อง 5-13");
    assert.deepEqual(r.scoreCols, ["คะแนน"]);       // ลำดับ never a score
    assert.equal(r.fullMarks, 30);
    assert.equal(r.students[0].id, "4");             // 28 points → rank 1
  });

  test("with BOTH columns the formal id wins and the roll number rides along", () => {
    const r = buildClassReport({
      headers: ["ลำดับ", "เลขประจำตัว", "ชื่อเล่น", "คะแนน"],
      rows: rows6, colAnalysis: cols, sensitive: sens,
    });
    assert.equal(r.idCol, "เลขประจำตัว");
    assert.equal(r.rollCol, "ลำดับ");
    assert.equal(r.students[0].id, "26504");
    assert.equal(r.students[0].roll, "4");
  });
});

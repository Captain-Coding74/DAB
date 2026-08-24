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

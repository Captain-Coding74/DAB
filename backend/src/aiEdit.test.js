/**
 * aiEdit.test.js — mostly about the model being wrong.
 *
 * This is the one path where raw cell values go to the model and come back as
 * data. The shape guards are the difference between "a cell was corrected"
 * and "the dataset silently lost half its rows".
 *
 * Since the PDPA-strict rework, the model never sees identifier columns at
 * all: the payload is the unprotected SUBSET, and shape validation runs
 * against that subset. The fakes in "model behaviour" therefore answer in
 * subset shape (สาขา, ยอดขาย — the ชื่อ column is protected and absent), and
 * the "PDPA boundary" suite pins the privacy contract itself.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aiEditRows, validateEdit, diffRows, detectSensitiveColumns,
  assertProtectedUnchanged, MAX_AI_EDIT_ROWS,
} from "./services/aiEdit.js";
import { AI_MODEL } from "./config.js";

const H = ["ชื่อ", "สาขา", "ยอดขาย"];
const R = [["สมชาย", "ร้าน A", "100"], ["สมหญิง", "ร้านA", "200"]];
const fakeAI = (text) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });

/* A fake client that also CAPTURES the request, so tests can assert what
   was (and was not) transmitted. */
const capturingAI = (text) => {
  const calls = [];
  return {
    calls,
    client: { messages: { create: async (req) => { calls.push(req); return { content: [{ type: "text", text }] }; } } },
  };
};

/* Roster-shaped fixture: both citizen IDs carry VALID mod-11 check digits,
   so value-aware detection fires regardless of the header. Protected:
   เลขบัตรประชาชน (citizen-id), ชื่อ-สกุล (name), วันเกิด (dob).
   Unprotected: คะแนน, หมายเหตุ. */
const PH = ["เลขบัตรประชาชน", "ชื่อ-สกุล", "วันเกิด", "คะแนน", "หมายเหตุ"];
const PR = [
  ["1100702035600", "สมชาย ใจดี", "2010-05-14", "85", "ok"],
  ["1234567890120", "สมหญิง รักเรียน", "2011-07-01", "92", ""],
];

describe("AI edit — shape guards", () => {
  test("a dropped row is rejected, not accepted quietly", () => {
    const v = validateEdit(R, [R[0]]);
    assert.equal(v.ok, false);
    assert.match(v.errorEn, /row count changed/);
  });

  test("a dropped column is rejected", () => {
    const v = validateEdit(R, [["a", "b"], ["c", "d"]]);
    assert.equal(v.ok, false);
    assert.match(v.errorEn, /wrong number of columns/);
  });

  test("prose instead of a table is rejected", () => {
    assert.equal(validateEdit(R, "I cleaned it for you").ok, false);
  });

  test("a same-shape rewrite passes", () => {
    assert.equal(validateEdit(R, [["x", "y", "z"], ["a", "b", "c"]]).ok, true);
  });
});

describe("AI edit — the diff is the point", () => {
  test("every changed cell is reported with its coordinates", () => {
    const after = [["สมชาย", "ร้าน A", "100"], ["สมหญิง", "ร้าน A", "200"]];
    const d = diffRows(R, after, H);
    assert.equal(d.length, 1);
    assert.deepEqual(d[0], { row: 2, column: "สาขา", before: "ร้านA", after: "ร้าน A" });
  });

  test("an identical rewrite produces an empty diff", () => {
    assert.equal(diffRows(R, R.map(r => [...r]), H).length, 0);
  });
});

describe("AI edit — privacy surface", () => {
  test("columns that look personal are named so a UI can warn", () => {
    const s = detectSensitiveColumns(["ชื่อ", "เบอร์โทร", "ยอดขาย", "email"]);
    assert.ok(s.includes("ชื่อ"));
    assert.ok(s.includes("email"));
    assert.ok(!s.includes("ยอดขาย"), "a sales column is not personal data");
  });
});

describe("AI edit — model behaviour", () => {
  /* Instruction deliberately avoids "ชื่อ": that header is a protected name
     column, and naming it would (correctly) trigger the PDPA refusal that
     has its own suite below. These tests are about shape handling. */
  const args = { headers: H, rows: R, instruction: "รวมสาขาที่สะกดต่างกัน" };

  test("a clean same-shape response is accepted and diffed", async () => {
    /* The model answers in SUBSET shape (สาขา, ยอดขาย) — it never saw ชื่อ. */
    const r = await aiEditRows(fakeAI(JSON.stringify([
      ["ร้าน A", "100"], ["ร้าน A", "200"],
    ])), args);
    assert.equal(r.ok, true);
    assert.equal(r.changes.length, 1);
    assert.deepEqual(r.changes[0], { row: 2, column: "สาขา", before: "ร้านA", after: "ร้าน A" });
    /* Full-width rows come back with the protected column untouched. */
    assert.deepEqual(r.rows, [["สมชาย", "ร้าน A", "100"], ["สมหญิง", "ร้าน A", "200"]]);
  });

  test("a response that drops a row is refused", async () => {
    const r = await aiEditRows(fakeAI('[["ร้าน A","100"]]'), args);
    assert.equal(r.ok, false);
    assert.match(r.errorEn, /row count changed/);
  });

  test("row-removing instructions are pushed back to the deterministic catalogue", async () => {
    const r = await aiEditRows(fakeAI("NEEDS_ROW_OPERATION"), { ...args, instruction: "ลบแถวที่ว่าง" });
    assert.equal(r.ok, false);
    assert.match(r.errorEn, /deterministic fix catalogue/);
  });

  test("prose from the model is refused rather than guessed at", async () => {
    const r = await aiEditRows(fakeAI("Sure! I have cleaned your data."), args);
    assert.equal(r.ok, false);
  });

  test("a markdown fence is tolerated", async () => {
    const r = await aiEditRows(fakeAI('```json\n[["ร้าน A","100"],["ร้าน A","200"]]\n```'), args);
    assert.equal(r.ok, true);
  });

  test("oversized datasets are refused before anything is transmitted", async () => {
    const many = Array.from({ length: MAX_AI_EDIT_ROWS + 1 }, () => ["a", "b", "c"]);
    const r = await aiEditRows(fakeAI("[]"), { headers: H, rows: many, instruction: "fix it" });
    assert.equal(r.ok, false);
    assert.match(r.errorEn, /too many rows/);
  });

  test("an empty instruction is refused", async () => {
    assert.equal((await aiEditRows(fakeAI("[]"), { headers: H, rows: R, instruction: "" })).ok, false);
  });

  test("no AI client fails cleanly instead of throwing", async () => {
    assert.equal((await aiEditRows(null, args)).ok, false);
  });

  test("a thrown API error fails cleanly", async () => {
    const broken = { messages: { create: async () => { throw new Error("network down"); } } };
    const r = await aiEditRows(broken, args);
    assert.equal(r.ok, false);
    assert.match(r.errorEn, /AI call failed/);
  });
});

describe("AI edit — PDPA boundary", () => {
  test("identifier values AND their headers never reach the model", async () => {
    const { client, calls } = capturingAI(JSON.stringify([["85", "ตรวจแล้ว"], ["92", "ตรวจแล้ว"]]));
    const r = await aiEditRows(client, {
      headers: PH, rows: PR, instruction: "เติมช่องหมายเหตุที่ว่างเป็น ตรวจแล้ว",
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);

    const prompt = calls[0].messages[0].content;
    /* No citizen-ID value, no name, no birthdate — omitted, not masked. */
    assert.ok(!prompt.includes("1100702035600"), "citizen ID value leaked into the prompt");
    assert.ok(!prompt.includes("1234567890120"), "citizen ID value leaked into the prompt");
    assert.ok(!prompt.includes("สมชาย"), "a name leaked into the prompt");
    assert.ok(!prompt.includes("สมหญิง"), "a name leaked into the prompt");
    assert.ok(!prompt.includes("2010-05-14"), "a birthdate leaked into the prompt");
    assert.ok(!prompt.includes("2011-07-01"), "a birthdate leaked into the prompt");
    /* Not even the protected HEADERS — the model must not learn the table
       has identifier columns at all. */
    assert.ok(!prompt.includes("เลขบัตรประชาชน"), "protected header leaked into the prompt");
    assert.ok(!prompt.includes("ชื่อ-สกุล"), "protected header leaked into the prompt");
    assert.ok(!prompt.includes("วันเกิด"), "protected header leaked into the prompt");
    /* Positive control: the unprotected subset IS there. */
    assert.ok(prompt.includes("คะแนน") && prompt.includes("หมายเหตุ") && prompt.includes("85"));
  });

  test("the model name comes from config, not a hardcoded string", async () => {
    const { client, calls } = capturingAI(JSON.stringify([["85", "ok"], ["92", ""]]));
    await aiEditRows(client, { headers: PH, rows: PR, instruction: "แก้เลขคะแนนให้เป็นตัวเลขล้วน" });
    assert.equal(calls[0].model, AI_MODEL);
  });

  test("splice-back keeps protected cells identical and lands edits in the right slots", async () => {
    const { client } = capturingAI(JSON.stringify([["85", "ตรวจแล้ว"], ["92", "ตรวจแล้ว"]]));
    const r = await aiEditRows(client, {
      headers: PH, rows: PR, instruction: "เติมช่องหมายเหตุที่ว่างเป็น ตรวจแล้ว",
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.rows, [
      ["1100702035600", "สมชาย ใจดี", "2010-05-14", "85", "ตรวจแล้ว"],
      ["1234567890120", "สมหญิง รักเรียน", "2011-07-01", "92", "ตรวจแล้ว"],
    ]);
    /* The diff is computed on FULL rows: real column names, both edits. */
    assert.equal(r.changes.length, 2);
    assert.ok(r.changes.every((c) => c.column === "หมายเหตุ"));
    /* And the response names what was withheld so the UI can say so. */
    assert.deepEqual(r.protectedColumns, [
      { col: "เลขบัตรประชาชน", kind: "citizen-id" },
      { col: "ชื่อ-สกุล", kind: "name" },
      { col: "วันเกิด", kind: "dob" },
    ]);
  });

  test("a full-width response is rejected — the contract is the subset", async () => {
    const { client } = capturingAI(JSON.stringify(PR));
    const r = await aiEditRows(client, {
      headers: PH, rows: PR, instruction: "เติมช่องหมายเหตุที่ว่างเป็น ตรวจแล้ว",
    });
    assert.equal(r.ok, false);
    assert.match(r.errorEn, /wrong number of columns/);
  });

  test("an instruction naming a protected column is refused WITHOUT calling the model", async () => {
    const { client, calls } = capturingAI("[]");
    const r = await aiEditRows(client, {
      headers: PH, rows: PR, instruction: "แปลง วันเกิด เป็นปี ค.ศ.",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "คอลัมน์ข้อมูลส่วนบุคคลแก้ไขผ่าน AI ไม่ได้ (PDPA)");
    assert.match(r.errorEn, /PDPA/);
    assert.equal(calls.length, 0, "the model must not be called at all");
  });

  test("a table where every column is protected is refused the same way", async () => {
    const { client, calls } = capturingAI("[]");
    const r = await aiEditRows(client, {
      headers: ["ชื่อ", "เบอร์โทร"],
      rows: [["สมชาย", "0812345678"]],
      instruction: "ทำความสะอาดข้อมูลทั้งหมด",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "คอลัมน์ข้อมูลส่วนบุคคลแก้ไขผ่าน AI ไม่ได้ (PDPA)");
    assert.equal(calls.length, 0, "the model must not be called at all");
  });
});

describe("AI edit — assertProtectedUnchanged (the apply backstop)", () => {
  test("a tampered citizen-id cell is caught, with coordinates", () => {
    const edited = PR.map((r) => [...r]);
    edited[0][0] = "9999999999999";      // the smuggled identifier edit
    edited[1][4] = "ตรวจแล้ว";           // an honest edit alongside it
    const v = assertProtectedUnchanged(PH, PR, edited);
    assert.equal(v.ok, false);
    assert.deepEqual(v.violations, [{ row: 1, col: "เลขบัตรประชาชน" }]);
  });

  test("an honest edit to unprotected cells passes", () => {
    const edited = PR.map((r) => [...r]);
    edited[1][4] = "ตรวจแล้ว";
    const v = assertProtectedUnchanged(PH, PR, edited);
    assert.equal(v.ok, true);
    assert.deepEqual(v.violations, []);
  });
});

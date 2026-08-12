/**
 * aiEdit.test.js — mostly about the model being wrong.
 *
 * This is the one path where raw cell values go to the model and come back as
 * data. The shape guards are the difference between "a cell was corrected"
 * and "the dataset silently lost half its rows".
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aiEditRows, validateEdit, diffRows, detectSensitiveColumns, MAX_AI_EDIT_ROWS } from "./services/aiEdit.js";

const H = ["ชื่อ", "สาขา", "ยอดขาย"];
const R = [["สมชาย", "ร้าน A", "100"], ["สมหญิง", "ร้านA", "200"]];
const fakeAI = (text) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });

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
  const args = { headers: H, rows: R, instruction: "รวมชื่อสาขาที่สะกดต่างกัน" };

  test("a clean same-shape response is accepted and diffed", async () => {
    const r = await aiEditRows(fakeAI(JSON.stringify([
      ["สมชาย", "ร้าน A", "100"], ["สมหญิง", "ร้าน A", "200"],
    ])), args);
    assert.equal(r.ok, true);
    assert.equal(r.changes.length, 1);
  });

  test("a response that drops a row is refused", async () => {
    const r = await aiEditRows(fakeAI('[["สมชาย","ร้าน A","100"]]'), args);
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
    const r = await aiEditRows(fakeAI('```json\n[["สมชาย","ร้าน A","100"],["สมหญิง","ร้าน A","200"]]\n```'), args);
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

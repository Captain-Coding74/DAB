/**
 * fixSuggest.test.js — what happens when the model is wrong.
 *
 * The AI picks from a closed catalogue. These tests are mostly about the
 * validation layer, because that is the only thing standing between a
 * hallucinated suggestion and a student trusting it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestFixes, suggestDeterministic, validateSuggestions } from "./services/fixSuggest.js";

const HEADERS = ["สาขา", "ยอดขาย"];
const COLS = [
  { col: "สาขา",  type: "text",    missing: 0, top: [{ value: "ร้าน A" }, { value: "ร้านA" }] },
  { col: "ยอดขาย", type: "numeric", missing: 4, outliers: [9999] },
];

/** A fake client returning whatever text a test wants. */
const fakeAI = (text) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });

describe("fix suggestions — validation", () => {
  test("an invented operation is discarded", () => {
    const out = validateSuggestions([{ op: "drop-table", params: {} }], HEADERS);
    assert.equal(out.length, 0, "only catalogue operations may survive");
  });

  test("a hallucinated column is discarded", () => {
    const out = validateSuggestions([{ op: "drop-missing", params: { column: "ไม่มีจริง" } }], HEADERS);
    assert.equal(out.length, 0);
  });

  test("a valid suggestion survives with its params", () => {
    const out = validateSuggestions([
      { op: "drop-missing", params: { column: "ยอดขาย" }, reasonEn: "4 blanks", severity: "high" },
    ], HEADERS);
    assert.equal(out.length, 1);
    assert.equal(out[0].params.column, "ยอดขาย");
    assert.equal(out[0].source, "ai");
  });

  test("an operation missing its required column is discarded", () => {
    assert.equal(validateSuggestions([{ op: "drop-missing" }], HEADERS).length, 0);
  });

  test("output is capped so the UI cannot be flooded", () => {
    const many = Array.from({ length: 40 }, () => ({ op: "drop-duplicates", params: {} }));
    assert.ok(validateSuggestions(many, HEADERS).length <= 6);
  });

  test("garbage input never throws", () => {
    for (const junk of [null, undefined, "nope", 42, [{}], [null]]) {
      assert.doesNotThrow(() => validateSuggestions(junk, HEADERS));
    }
  });
});

describe("fix suggestions — deterministic floor", () => {
  test("finds missing values, outliers and near-duplicate labels", () => {
    const s = suggestDeterministic(COLS, 100, 3);
    const ops = s.map((x) => x.op);
    assert.ok(ops.includes("drop-missing"));
    assert.ok(ops.includes("drop-outliers"));
    assert.ok(ops.includes("merge-categories"));
    assert.ok(ops.includes("drop-duplicates"));
  });

  test("clean data produces no suggestions", () => {
    const clean = [{ col: "a", type: "numeric", missing: 0, outliers: [] }];
    assert.equal(suggestDeterministic(clean, 100, 0).length, 0);
  });

  test("one stray blank is not worth a suggestion", () => {
    const s = suggestDeterministic([{ col: "a", type: "text", missing: 1 }], 500, 0);
    assert.equal(s.length, 0, "1 blank in 500 rows is noise, not a finding");
  });
});

describe("fix suggestions — the AI path", () => {
  const args = { headers: HEADERS, colAnalysis: COLS, totalRows: 100, dupeCount: 3 };

  test("uses valid model output", async () => {
    const r = await suggestFixes(fakeAI(JSON.stringify([
      { op: "drop-missing", params: { column: "ยอดขาย" }, reasonTh: "ว่าง 4", reasonEn: "4 blanks", severity: "high" },
    ])), args);
    assert.equal(r.source, "ai");
    assert.equal(r.suggestions[0].op, "drop-missing");
  });

  test("tolerates a markdown fence around the JSON", async () => {
    const r = await suggestFixes(fakeAI('```json\n[{"op":"drop-duplicates","params":{}}]\n```'), args);
    assert.equal(r.source, "ai");
    assert.equal(r.suggestions.length, 1);
  });

  test("falls back to rules when the model returns prose", async () => {
    const r = await suggestFixes(fakeAI("I think you should clean the data."), args);
    assert.equal(r.source, "rules");
    assert.ok(r.suggestions.length > 0, "the floor still answers");
  });

  test("falls back when every suggestion is hallucinated", async () => {
    const r = await suggestFixes(fakeAI('[{"op":"delete-everything"}]'), args);
    assert.equal(r.source, "rules");
  });

  test("falls back when the model throws", async () => {
    const broken = { messages: { create: async () => { throw new Error("network down"); } } };
    const r = await suggestFixes(broken, args);
    assert.equal(r.source, "rules");
  });

  test("works with no AI client at all — offline", async () => {
    const r = await suggestFixes(null, args);
    assert.equal(r.source, "rules");
    assert.ok(r.suggestions.length > 0);
  });

  test("an empty array from the model is respected as 'nothing to fix'", async () => {
    const r = await suggestFixes(fakeAI("[]"), args);
    assert.equal(r.source, "ai");
    assert.equal(r.suggestions.length, 0, "the model may legitimately say the data is clean");
  });
});

/**
 * agent.test.js — the agent loop verified without any API key.
 * A scripted FakeClient plays the model's side of the conversation.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runAgent, runTool, AGENT_TOOLS } from "./services/agent.js";

const STATS = {
  colAnalysis: [
    { col: "revenue", type: "numeric", missing: 0, missingPct: "0.0", min: 10, max: 500, avg: 120, median: 100, stdDev: 40, outlierCount: 2 },
    { col: "region",  type: "text",    missing: 3, missingPct: "3.0", unique: 4, top: [{ value: "Bangkok", count: 60, pct: "60.0" }] },
  ],
  corr:      { strong: [{ col1: "units", col2: "revenue", r: 0.98 }] },
  forecasts: [{ col: "revenue", slope: 4.2, r2: 0.9, forecast: [{ step: 1, predicted: 520 }] }],
};

function fakeClient(script) {
  let i = 0;
  return {
    calls: [],
    messages: { create: async (req) => {
      fake.calls.push(req);
      const next = script[Math.min(i, script.length - 1)]; i++;
      return next;
    }},
  };
  // note: `fake` bound below
}
// small helper to keep the closure name available
let fake;
function makeClient(script) { fake = fakeClient(script); return fake; }

const textMsg = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const toolMsg = (name, input, id = "tu_1") => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });

describe("runTool", () => {
  test("list_columns returns name/type/missing for every column", () => {
    const out = runTool("list_columns", {}, STATS);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { col: "revenue", type: "numeric", missing: 0, missingPct: "0.0" });
  });

  test("get_column_detail returns the full column or a helpful error", () => {
    assert.equal(runTool("get_column_detail", { column: "revenue" }, STATS).avg, 120);
    assert.match(runTool("get_column_detail", { column: "nope" }, STATS).error, /list_columns/);
  });

  test("get_correlations and get_forecasts handle empty gracefully", () => {
    assert.equal(runTool("get_correlations", {}, STATS)[0].r, 0.98);
    assert.ok(runTool("get_correlations", {}, {}).note);
    assert.ok(runTool("get_forecasts", {}, {}).note);
  });

  test("unknown tool reports an error instead of throwing", () => {
    assert.match(runTool("hack_the_db", {}, STATS).error, /unknown tool/);
  });
});

describe("runAgent", () => {
  test("direct answer (no tools) returns text with zero steps", async () => {
    const client = makeClient([textMsg("คำตอบตรง ๆ")]);
    const { reply, steps } = await runAgent({ client, statsJson: STATS, question: "hi" });
    assert.equal(reply, "คำตอบตรง ๆ");
    assert.equal(steps.length, 0);
    assert.equal(client.calls.length, 1);
    assert.ok(client.calls[0].tools === AGENT_TOOLS, "tools offered on first call");
  });

  test("tool round-trip: dispatches, records step, feeds result back, returns final text", async () => {
    const client = makeClient([
      toolMsg("get_column_detail", { column: "revenue" }),
      textMsg("avg คือ 120 (ตรวจแล้ว)"),
    ]);
    const { reply, steps } = await runAgent({ client, statsJson: STATS, question: "avg revenue?" });
    assert.equal(reply, "avg คือ 120 (ตรวจแล้ว)");
    // The trail now records the OUTCOME, not just the request: a refused tool
    // and a successful one used to look identical, which undermines the point
    // of showing the trail at all (ADR-0006).
    assert.equal(steps.length, 1);
    assert.equal(steps[0].tool, "get_column_detail");
    assert.deepEqual(steps[0].input, { column: "revenue" });
    assert.equal(steps[0].ok, true, "a successful tool call is marked ok");
    assert.equal(steps[0].error, undefined);
    // second call must include the tool_result with the real avg
    const second = client.calls[1];
    const toolResult = second.messages.at(-1).content[0];
    assert.equal(toolResult.type, "tool_result");
    assert.match(toolResult.content, /"avg":120/);
  });

  test("multiple tool_use blocks in one turn all execute", async () => {
    const client = makeClient([
      { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "a", name: "list_columns",     input: {} },
        { type: "tool_use", id: "b", name: "get_correlations", input: {} },
      ]},
      textMsg("done"),
    ]);
    const { steps } = await runAgent({ client, statsJson: STATS, question: "overview" });
    assert.equal(steps.length, 2);
    assert.equal(client.calls[1].messages.at(-1).content.length, 2, "two tool_results returned");
  });

  test("iteration cap: stops calling tools and forces a final answer", async () => {
    const endless = toolMsg("list_columns", {});
    const client = makeClient([endless, endless, endless, textMsg("สรุปจากที่ตรวจมา")]);
    const { reply, steps } = await runAgent({ client, statsJson: STATS, question: "loop?", maxSteps: 2 });
    assert.equal(reply, "สรุปจากที่ตรวจมา");
    assert.equal(steps.length, 2, "only maxSteps tool rounds recorded");
    const lastReq = client.calls.at(-1);
    assert.equal(lastReq.tools, undefined, "final forced call offers no tools");
    assert.match(JSON.stringify(lastReq.messages.at(-1)), /หมดรอบ/);
  });

  test("unknown tool from the model is surfaced as an error result, not a crash", async () => {
    const client = makeClient([
      toolMsg("drop_tables", {}),
      textMsg("ok"),
    ]);
    const { reply } = await runAgent({ client, statsJson: STATS, question: "x" });
    assert.equal(reply, "ok");
    assert.match(client.calls[1].messages.at(-1).content[0].content, /unknown tool/);
  });
});

describe("the agent trail is honest and bounded", () => {
  test("a refused tool is visibly refused, not silently identical to success", async () => {
    let c = 0;
    const client = { messages: { create: async () => { c++; return c === 1
      ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "exfiltrate_all", input: {} }] }
      : { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }; } } };
    const { steps } = await runAgent({ client, statsJson: { colAnalysis: [] }, analysisText: "x", question: "q" });
    assert.equal(steps[0].ok, false);
    assert.match(steps[0].error, /unknown tool/);
  });

  test("a huge tool input cannot balloon the stored trail", async () => {
    // input is whatever the MODEL sent, echoed into a trail stored per analysis
    // and rendered in the UI. A 50 KB input across five rounds produced a
    // 250 KB trail before this was bounded.
    let c = 0;
    const client = { messages: { create: async () => { c++; return c <= 5
      ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x" + c, name: "list_columns", input: { junk: "y".repeat(50000) } }] }
      : { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }; } } };
    const { steps } = await runAgent({ client, statsJson: { colAnalysis: [] }, analysisText: "x", question: "q" });
    assert.ok(JSON.stringify(steps).length < 10000, "the trail must stay small");
  });
});

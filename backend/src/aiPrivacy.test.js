/**
 * aiPrivacy.test.js — v21.30: what reaches the AI provider, and the switches
 * that stop it, through the REAL app (AI stubbed by AI_MOCK=1).
 *
 * The stub records every request it is handed (services/aiClient.js
 * mockRequests), so each test asserts on the actual payloads — analyze,
 * chat, streaming chat, the agent, fix-suggest and AI edit — rather than on
 * what a helper was supposed to build. The fixture is the privacy audit's
 * verified-by-execution file: before v21.30 its emails, street addresses,
 * LINE ids and diagnoses all reached the model, plus five raw rows.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { mockRequests } from "./services/aiClient.js";
import * as R from "./db/repository.js";

const PII_CSV = [
  "customer_email,address,line_id,diagnosis,amount",
  ...Array.from({ length: 12 }, (_, i) =>
    `user${i % 4}@example.com,${i % 5} Sukhumvit Rd Bangkok,line_${i % 4},${["diabetes type 1", "asthma", "hypertension"][i % 3]},${100 + i * 7}`),
].join("\n");
const RAW_ROWS = PII_CSV.split("\n").slice(1);
const LEAKS = ["@example.com", "user0", "Sukhumvit", "line_0", "line_1", "diabetes", "asthma", "hypertension"];

let agent, tok = {};
const u = Date.now().toString(36);
const NAME = { owner: `aip_o_${u}`, editor: `aip_e_${u}`, viewer: `aip_v_${u}`, other: `aip_s_${u}` };
const as = (req, who = "owner") => req.set("Authorization", `Bearer ${tok[who]}`);

/** Everything the stub was handed since the last call, as one string. */
function drainSent() {
  const s = JSON.stringify(mockRequests);
  mockRequests.length = 0;
  return s;
}
function assertClean(sent, where) {
  for (const row of RAW_ROWS) assert.ok(!sent.includes(row), `${where}: raw row leaked: ${row}`);
  for (const leak of LEAKS) assert.ok(!sent.includes(leak), `${where}: detected value leaked: ${leak}`);
}
const uploadPII = (req) => req.attach("file", Buffer.from(PII_CSV), "customers.csv");

before(async () => {
  agent = request(await buildApp());
  for (const [k, name] of Object.entries(NAME)) {
    tok[k] = (await agent.post("/api/auth/register").send({ username: name, password: "Test1234!", ...TERMS })).body.accessToken;
    assert.ok(tok[k], `could not register ${k}`);
  }
});
after(async () => { delete process.env.AI_DAILY_BUDGET; await closeApp(); });

describe("no raw row and no detected value in ANY AI payload", () => {
  let savedId, datasetId;

  test("analyze: the prompt is statistics only", async () => {
    mockRequests.length = 0;
    const res = await uploadPII(as(agent.post("/api/analyze")));
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    assert.match(res.body.analysis, /\[MOCK\]/);
    assert.deepEqual(res.body.sensitiveColumns.map((d) => d.kind), ["email", "address", "social-id", "health"]);
    savedId = res.body.savedId;

    const sent = drainSent();
    assert.match(sent, /amount/, "the payload is the analyze prompt");
    assertClean(sent, "analyze");
  });

  test("the user's own view: identifiers masked, s.26 values readable but flagged", async () => {
    const res = await uploadPII(as(agent.post("/api/analyze")).field("noAi", "1"));
    const col = (name) => res.body.colAnalysis.find((c) => c.col === name);
    assert.ok(col("customer_email").top.every((t) => /^u\*\*\*@example\.com$/.test(t.value)));
    assert.equal(col("diagnosis").sensitive, "health");
    assert.ok(col("diagnosis").top.some((t) => t.value === "diabetes type 1"), "the owner still sees their own data");
    drainSent();
  });

  test("chat, streaming chat and the agent", async () => {
    const chat = await as(agent.post(`/api/analyses/${savedId}/chat`)).send({ message: "อธิบายเพิ่ม" });
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    const stream = await as(agent.post(`/api/analyses/${savedId}/chat/stream`)).send({ message: "ต่อ" });
    assert.equal(stream.status, 200);
    const deep = await as(agent.post(`/api/analyses/${savedId}/agent`)).send({ question: "คอลัมน์ไหนน่าสนใจ" });
    assert.equal(deep.status, 200, JSON.stringify(deep.body));

    const sent = drainSent();
    assert.match(sent, /customer_email/, "detected columns are still NAMED");
    assert.match(sent, /sensitive\\":\s?\\"email/, "…with their kind");
    assertClean(sent, "chat/agent");
  });

  test("fix-suggest on the saved dataset", async () => {
    const up = await uploadPII(as(agent.post("/api/datasets")));
    assert.equal(up.status, 201);
    datasetId = up.body.id;
    mockRequests.length = 0;
    const res = await as(agent.post(`/api/fixes/${datasetId}/suggest`)).send({});
    assert.equal(res.status, 200);
    const sent = drainSent();
    assert.match(sent, /personalData/, "the model was asked (and told which columns are personal data)");
    assertClean(sent, "fix-suggest");
  });

  test("AI edit: refused without confirmSend, nothing sent; with it, detected columns left out", async () => {
    const refused = await as(agent.post(`/api/fixes/${datasetId}/ai-edit`)).send({ instruction: "ตัดช่องว่างทั้งหมด" });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "AI_EDIT_CONFIRM_REQUIRED");
    assert.deepEqual(refused.body.sentColumns, ["amount"]);
    assert.equal(refused.body.protectedColumns.length, 4);
    assert.equal(mockRequests.length, 0, "nothing may be sent before confirmation");

    const scope = await as(agent.get(`/api/fixes/${datasetId}/ai-edit/scope`));
    assert.equal(scope.status, 200);
    assert.equal(scope.body.rowCount, 12);
    assert.equal(scope.body.aiEnabled, true);

    await as(agent.post(`/api/fixes/${datasetId}/ai-edit`)).send({ instruction: "ตัดช่องว่างทั้งหมด", confirmSend: true });
    const sent = drainSent();
    assert.match(sent, /amount/, "the confirmed request reached the model");
    assertClean(sent, "ai-edit");
  });

  test("an analysis saved BEFORE v21.30 (no new kinds in stats_json) is cleaned by name and value", async () => {
    const me = (await as(agent.get("/api/auth/me"))).body;
    const old = await R.saveAnalysis({
      userId: me.id, fileName: "old.csv", fileType: "csv", totalRows: 12, totalCols: 2,
      prompt: "x", analysis: "old report",
      statsJson: { colAnalysis: [
        { col: "customer_email", type: "text", count: 12, top: [{ value: "user0@example.com", count: 3 }] },
        { col: "diagnosis", type: "text", count: 12, top: [{ value: "asthma", count: 4 }] },
      ] },
    });
    const res = await as(agent.post(`/api/analyses/${old.id}/chat`)).send({ message: "สรุป" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertClean(drainSent(), "old-analysis chat");
  });
});

describe("Statistics only — the per-upload switch", () => {
  let savedId;

  test("noAi: stats-only result, no AI call, recorded on the analysis", async () => {
    mockRequests.length = 0;
    const res = await uploadPII(as(agent.post("/api/analyze")).field("noAi", "true"));
    assert.equal(res.status, 200);
    assert.equal(res.body.analysis, null);
    assert.equal(res.body.aiDisabled, true);
    assert.equal(res.body.aiGated, false);
    assert.ok(res.body.savedId, "still saved to history");
    assert.ok(res.body.insights.length > 0, "the statistics are all there");
    assert.equal(mockRequests.length, 0);
    savedId = res.body.savedId;
  });

  test("re-analyzing the saved copy with noAi stays stats-only (the SPA re-sends the choice)", async () => {
    const ds = (await uploadPII(as(agent.post("/api/datasets")))).body.id;
    mockRequests.length = 0;
    const res = await as(agent.post(`/api/datasets/${ds}/analyze`)).send({ noAi: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.aiDisabled, true);
    assert.equal(res.body.analysis, null);
    assert.equal(mockRequests.length, 0);
  });

  test("chat, streaming chat and the agent refuse with AI_DISABLED — before the budget", async () => {
    process.env.AI_DAILY_BUDGET = "0";     // a budget check first would answer 429
    try {
      for (const [path, body] of [["chat", { message: "x" }], ["chat/stream", { message: "x" }], ["agent", { question: "x" }]]) {
        const res = await as(agent.post(`/api/analyses/${savedId}/${path}`)).send(body);
        assert.equal(res.status, 403, `${path}: ${res.status}`);
        assert.equal(res.body.code, "AI_DISABLED", path);
      }
    } finally { delete process.env.AI_DAILY_BUDGET; }
    assert.equal(mockRequests.length, 0);
    assert.equal((await as(agent.get(`/api/analyses/${savedId}/chat`))).status, 200, "history still readable");
  });
});

describe("the dataset AI switch", () => {
  let ds, linkedAnalysis;

  before(async () => {
    ds = (await uploadPII(as(agent.post("/api/datasets")))).body.id;
    for (const [who, role] of [["editor", "editor"], ["viewer", "viewer"]]) {
      await as(agent.post(`/api/datasets/${ds}/share`)).send({ username: NAME[who], role });
    }
    linkedAnalysis = (await as(agent.post(`/api/datasets/${ds}/analyze`)).send({})).body.savedId;
    assert.ok(linkedAnalysis);
  });

  test("only the owner may toggle it", async () => {
    for (const who of ["editor", "viewer", "other"]) {
      const res = await as(agent.patch(`/api/datasets/${ds}/ai`), who).send({ aiEnabled: false });
      assert.equal(res.status, 403, who);
    }
    assert.equal((await as(agent.patch(`/api/datasets/${ds}/ai`)).send({ aiEnabled: "no" })).status, 400);
    const ok = await as(agent.patch(`/api/datasets/${ds}/ai`)).send({ aiEnabled: false });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.aiEnabled, false);
    assert.equal(Number((await as(agent.get(`/api/datasets/${ds}`))).body.ai_enabled), 0);
  });

  test("off: every AI route refuses or serves its floor, before the budget, sending nothing", async () => {
    mockRequests.length = 0;
    process.env.AI_DAILY_BUDGET = "0";
    try {
      const an = await as(agent.post(`/api/datasets/${ds}/analyze`)).send({});
      assert.equal(an.status, 200);
      assert.equal(an.body.aiDisabled, true);
      assert.equal(an.body.analysis, null);
      assert.equal(an.body.aiBudget, null, "the budget was never consulted");

      const sug = await as(agent.post(`/api/fixes/${ds}/suggest`), "editor").send({});
      assert.equal(sug.status, 200);
      assert.equal(sug.body.source, "rules");
      assert.equal(sug.body.aiDisabled, true);

      const edit = await as(agent.post(`/api/fixes/${ds}/ai-edit`), "editor").send({ instruction: "trim", confirmSend: true });
      assert.equal(edit.status, 403);
      assert.equal(edit.body.code, "AI_DISABLED");

      // analyses linked to the dataset — made before the switch, and after it
      for (const id of [linkedAnalysis, an.body.savedId]) {
        const chat = await as(agent.post(`/api/analyses/${id}/chat`)).send({ message: "x" });
        assert.equal(chat.status, 403);
        assert.equal(chat.body.code, "AI_DISABLED");
      }

      // an upload that names the dataset honours its switch too
      const up = await uploadPII(as(agent.post("/api/analyze")).field("datasetId", ds));
      assert.equal(up.body.aiDisabled, true);
    } finally { delete process.env.AI_DAILY_BUDGET; }
    assert.equal(mockRequests.length, 0, "nothing reached the AI provider");
  });

  test("hypothesis tests (local, no AI): s.26 columns are variables, identifiers are not", async () => {
    const anova = await as(agent.post(`/api/inference/${ds}`)).send({ test: "anova", valueColumn: "amount", groupColumn: "diagnosis" });
    assert.equal(anova.status, 200, JSON.stringify(anova.body).slice(0, 160));
    const byEmail = await as(agent.post(`/api/inference/${ds}`)).send({ test: "anova", valueColumn: "amount", groupColumn: "customer_email" });
    assert.equal(byEmail.status, 400, "an identifier is still refused as a grouping variable");
  });

  test("on again: AI features work", async () => {
    assert.equal((await as(agent.patch(`/api/datasets/${ds}/ai`)).send({ aiEnabled: true })).status, 200);
    const an = await as(agent.post(`/api/datasets/${ds}/analyze`)).send({});
    assert.match(an.body.analysis, /\[MOCK\]/);
    assert.equal(an.body.aiDisabled, false);
    const chat = await as(agent.post(`/api/analyses/${linkedAnalysis}/chat`)).send({ message: "x" });
    assert.equal(chat.status, 200);
    assertClean(drainSent(), "after re-enabling");
  });
});

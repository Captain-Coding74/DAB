/**
 * shares.test.js — v21.30 share links, AI labels in exports, log redaction.
 *
 * Driven through the REAL app (testApp.js), so the route, repository,
 * migration and middleware are the production ones:
 *   · creating a link: expiry required (default 30 days, only 1/7/30/90),
 *     generic title, never the file name
 *   · the public payload: no file name, personal-data columns without values,
 *     noindex on the API and on the /share page document, expired → 404
 *   · revoking deletes the row (owner only)
 *   · the DATA_FIXES that bring older links up to these rules
 *   · request logs carry no share token
 *   · PDF / Excel exports flag AI text in their metadata
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import request from "supertest";
import express from "express";
import pino from "pino";
import ExcelJS from "exceljs";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { query } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createHttpLogger } from "./logger.js";
import { AI_LABEL } from "./services/aiLabel.js";

let app, agent, ownerTok, otherTok, analysisId;
const FILE = "roster_somchai_private.csv";
const CSV  = "name,phone,score\nสมชาย ใจดี,0812345678,10\nสมหญิง รักเรียน,0898765432,20\nวิชัย มั่นคง,0811111111,30\nมานี มีนา,0822222222,40\n";
const DAY  = 86_400_000;

// One place to change if registration grows required fields (v21.30: the click-wrap boxes).
const register = async (prefix) =>
  (await agent.post("/api/auth/register").send({ username: `${prefix}_${Date.now()}`, password: "Test1234!", ...TERMS })).body.accessToken;
const auth = (req, t = ownerTok) => req.set("Authorization", `Bearer ${t}`);
const share = (body, t = ownerTok) => auth(agent.post(`/api/analyses/${analysisId}/share`), t).send(body);
const tokenOf = (res) => res.body.shareUrl.split("/").pop();
const daysFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / DAY;

before(async () => {
  app   = await buildApp();
  agent = request(app);
  ownerTok = await register("share_owner");
  otherTok = await register("share_other");
  const res = await auth(agent.post("/api/analyze")).attach("file", Buffer.from(CSV), FILE);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  analysisId = res.body.savedId;
  assert.ok(analysisId, "a signed-in analysis is saved");
});
after(async () => { await closeApp(); });

describe("Creating a share link", () => {
  test("no expiry given → 30 days, generic title", async () => {
    const res = await share({});
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.title, "Analysis report");
    const d = daysFromNow(res.body.expiresAt);
    assert.ok(d > 29.9 && d <= 30, `expires in ${d} days`);
  });

  test("1, 7, 30 and 90 days are accepted", async () => {
    for (const days of [1, 7, 30, 90]) {
      const res = await share({ expiresInDays: days });
      assert.equal(res.status, 201, `${days}: ${JSON.stringify(res.body)}`);
      const d = daysFromNow(res.body.expiresAt);
      assert.ok(d > days - 0.1 && d <= days, `${days} → ${d}`);
    }
  });

  test("any other expiry is refused with 400 and stores nothing", async () => {
    const count = async () => (await query(`SELECT COUNT(*) AS n FROM shared_reports WHERE analysis_id=$1`, [analysisId]))[0].n;
    const before = Number(await count());
    for (const bad of [0, 2, 365, -7, "30", "never", true]) {
      const res = await share({ expiresInDays: bad });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} → ${res.status}`);
      assert.match(res.body.error, /1, 7, 30, 90/);
    }
    assert.equal(Number(await count()), before);
  });

  test("the file name is never the title, even when a client sends it", async () => {
    const res = await share({ title: FILE, expiresInDays: 7 });
    assert.equal(res.status, 201);
    assert.equal(res.body.title, "Analysis report");
    const own = await share({ title: "Term 1 scores", expiresInDays: 7 });
    assert.equal(own.body.title, "Term 1 scores", "an owner's own title is kept");
  });

  test("someone else's analysis cannot be shared", async () => {
    const res = await share({}, otherTok);
    assert.equal(res.status, 404);
  });
});

describe("The public share payload", () => {
  let token;
  before(async () => { token = tokenOf(await share({ expiresInDays: 7 })); });

  test("says noindex, carries no file name, keeps the report", async () => {
    const res = await agent.get(`/api/public/share/${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
    assert.equal(res.body.file_name, undefined);
    assert.ok(!JSON.stringify(res.body).includes("roster_somchai"), "file name nowhere in the payload");
    assert.equal(res.body.title, "Analysis report");
    assert.ok(res.body.analysis.includes("[MOCK]"));
    assert.ok(daysFromNow(res.body.expires_at) > 6.9, "the page can show the expiry date");
  });

  test("personal-data columns keep their name and kind, not their values", async () => {
    const cols = (await agent.get(`/api/public/share/${token}`)).body.stats_json.colAnalysis;
    const byName = Object.fromEntries(cols.map((c) => [c.col, c]));
    assert.equal(byName.name.sensitive, "name");
    assert.equal(byName.phone.sensitive, "phone");
    for (const c of [byName.name, byName.phone]) {
      for (const k of ["top", "min", "max", "avg", "median", "q1", "q3", "trend", "dateRange"]) {
        assert.equal(k in c, false, `${c.col}.${k} must not be public`);
      }
    }
    assert.equal(byName.score.max, 40, "ordinary columns keep their statistics");
    // The owner's own saved stats still have the (masked) top values.
    const [row] = await query(`SELECT stats_json FROM analyses WHERE id=$1`, [analysisId]);
    assert.ok(JSON.parse(row.stats_json).colAnalysis.find((c) => c.col === "name").top.length);
  });

  /* v21.30 integration: an analysis saved before the wider detection —
     stats_json without `sensitive` on the new kinds — is shared through the
     real route and re-classified on the way out (services/shareView.js). */
  test("an OLD analysis's stored stats are re-classified before they go public", async () => {
    const [a] = await query(`SELECT * FROM analyses WHERE id=$1`, [analysisId]);
    const oldId = `old-${Date.now()}`;
    const stats = { colAnalysis: [
      { col: "customer_email", type: "text", count: 2, unique: 2, top: [{ value: "somchai@example.com", count: 1 }] },
      { col: "ศาสนา", type: "text", count: 2, unique: 2, top: [{ value: "พุทธ", count: 1 }, { value: "อิสลาม", count: 1 }] },
      { col: "spend", type: "numeric", count: 2, min: 5, max: 20 },
    ] };
    const chart = { type: "bar", xAxis: "ศาสนา", yAxis: ["spend"], data: [{ "ศาสนา": "พุทธ", spend: 5 }] };
    await query(`INSERT INTO analyses (id,user_id,file_name,file_type,total_rows,total_cols,prompt,analysis,stats_json,chart_config,created_at) VALUES ($1,$2,$3,'csv',2,3,'q','old AI text',$4,$5,$6)`,
      [oldId, a.user_id, "old.csv", JSON.stringify(stats), JSON.stringify(chart), new Date().toISOString()]);
    const created = await auth(agent.post(`/api/analyses/${oldId}/share`)).send({ expiresInDays: 7 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const res = await agent.get(`/api/public/share/${tokenOf(created)}`);
    assert.equal(res.status, 200);
    const byName = Object.fromEntries(res.body.stats_json.colAnalysis.map((c) => [c.col, c]));
    assert.equal(byName.customer_email.sensitive, "email");
    assert.equal(byName["ศาสนา"].sensitive, "religion");
    assert.equal(byName.spend.max, 20);
    assert.equal(res.body.chart_config, null, "a chart over a detected column is not published");
    const json = JSON.stringify(res.body);
    for (const v of ["somchai@example.com", "พุทธ", "อิสลาม"]) assert.equal(json.includes(v), false, `${v} leaked`);
  });

  test("an unknown token is a 404 that also says noindex", async () => {
    const res = await agent.get("/api/public/share/not-a-real-token");
    assert.equal(res.status, 404);
    assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
  });

  test("the /share page document says noindex; other pages do not", async () => {
    const page = await agent.get(`/share/${token}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers["x-robots-tag"], "noindex, nofollow");
    const home = await agent.get("/history");
    assert.equal(home.headers["x-robots-tag"], undefined);
  });

  test("an expired link is refused", async () => {
    const t = tokenOf(await share({ expiresInDays: 1 }));
    await query(`UPDATE shared_reports SET expires_at=$1 WHERE token=$2`, [new Date(Date.now() - 1000).toISOString(), t]);
    const res = await agent.get(`/api/public/share/${t}`);
    assert.equal(res.status, 404);
  });
});

describe("Revoking a share link", () => {
  test("only the owner can revoke, and revoking deletes the row", async () => {
    const created = await share({ expiresInDays: 7 });
    const { id } = created.body, t = tokenOf(created);

    const theirs = await auth(agent.delete(`/api/shares/${id}`), otherTok);
    assert.equal(theirs.status, 404, "not the owner");
    assert.equal((await agent.get(`/api/public/share/${t}`)).status, 200, "still live");

    const mine = await auth(agent.delete(`/api/shares/${id}`));
    assert.equal(mine.status, 200);
    assert.equal((await query(`SELECT id FROM shared_reports WHERE id=$1`, [id])).length, 0, "row deleted, not flagged");
    assert.equal((await agent.get(`/api/public/share/${t}`)).status, 404);
  });
});

describe("DATA_FIXES bring older links up to the rules", () => {
  test("no expiry → 30 days; file-name or missing title → generic; soft-revoked → deleted", async () => {
    const now = new Date().toISOString();
    const [a] = await query(`SELECT user_id, file_name FROM analyses WHERE id=$1`, [analysisId]);
    assert.equal(a.file_name, FILE);
    const ins = (id, title, expires, active) => query(
      `INSERT INTO shared_reports (id,analysis_id,user_id,token,title,expires_at,is_active,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, analysisId, a.user_id, `tok-${id}`, title, expires, active, now]);
    const ids = { named: `fix-named-${Date.now()}`, untitled: `fix-untitled-${Date.now()}`,
                  custom: `fix-custom-${Date.now()}`, revoked: `fix-revoked-${Date.now()}` };
    await ins(ids.named, FILE, null, 1);
    await ins(ids.untitled, null, null, 1);
    await ins(ids.custom, "Board pack", null, 1);
    await ins(ids.revoked, "Old", null, 0);

    await migrate();
    const get = async (id) => (await query(`SELECT title, expires_at FROM shared_reports WHERE id=$1`, [id]))[0];
    const named = await get(ids.named);
    assert.equal(named.title, "Analysis report");
    const d = daysFromNow(named.expires_at);
    assert.ok(d > 29 && d <= 30, `backfilled expiry is ${d} days out`);
    assert.equal((await get(ids.untitled)).title, "Analysis report");
    const custom = await get(ids.custom);
    assert.equal(custom.title, "Board pack", "an owner's own title is kept");
    assert.ok(custom.expires_at, "every link now expires");
    assert.equal(await get(ids.revoked), undefined, "soft-revoked rows are deleted");

    // Idempotent: a second boot changes nothing.
    await migrate();
    assert.deepEqual(await get(ids.named), named);
    const [{ n }] = await query(`SELECT COUNT(*) AS n FROM shared_reports WHERE expires_at IS NULL OR is_active=0`);
    assert.equal(Number(n), 0);
  });
});

describe("Request logs carry no share token", () => {
  test("the real share routes, logged by the app's own request logger", async () => {
    const t = tokenOf(await share({ expiresInDays: 1 }));
    const lines = [];
    const sink = new Writable({ write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); } });
    // The app's logger is silent under test, so the same logger factory is
    // pointed at a captured stream in front of the real app.
    const outer = express().use(createHttpLogger(pino({ level: "info" }, sink))).use(app);
    const api = await request(outer).get(`/api/public/share/${t}`);
    assert.equal(api.status, 200);
    await request(outer).get(`/share/${t}?token=${t}`);
    const out = lines.join("");
    assert.equal(lines.length, 2, out);
    assert.ok(!out.includes(t), `share token leaked into the request log:\n${out}`);
    assert.match(out, /\/api\/public\/share\/\[redacted\]/);
    assert.match(out, /\/share\/\[redacted\]\?token=\[redacted\]/);
  });
});

describe("Exports flag AI text", () => {
  const CSV2 = "month,units\n2026-01,10\n2026-02,20\n2026-03,30\n";
  // PDFKit writes each Info value as an indirect object: /Keywords 22 0 R … 22 0 obj (ai_generated)
  const pdfInfo = (pdf, key) => {
    const ref = pdf.match(new RegExp(`/${key} (\\d+) 0 R`));
    return ref ? pdf.match(new RegExp(`\\n${ref[1]} 0 obj\\n\\((.*)\\)\\nendobj`))?.[1] ?? null : null;
  };
  const binary = (res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); };
  const exportOf = (fmt, analysis) => {
    const req = agent.post(`/api/export/${fmt}`).attach("file", Buffer.from(CSV2), "e.csv");
    if (analysis) req.field("analysis", analysis);
    return req.buffer(true).parse(binary);
  };

  test("PDF: ai_generated in Keywords and Subject when there is AI text, absent otherwise", async () => {
    const withAi = await exportOf("pdf", "ยอดขายเพิ่มขึ้นทุกเดือน");
    assert.equal(withAi.status, 200);
    const pdf = withAi.body.toString("latin1");
    assert.equal(pdfInfo(pdf, "Keywords"), "ai_generated");
    assert.match(pdfInfo(pdf, "Subject"), /ai_generated/);
    const plain = await exportOf("pdf", "");
    assert.equal(plain.status, 200);
    assert.ok(!plain.body.toString("latin1").includes("ai_generated"), "no AI text, no AI flag");
  });

  test("Excel: the label sits above the AI text, and the workbook keywords carry the flag", async () => {
    const withAi = await exportOf("excel", "ยอดขายเพิ่มขึ้นทุกเดือน");
    assert.equal(withAi.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(withAi.body);
    assert.equal(wb.keywords, "ai_generated");
    const sheet = wb.getWorksheet("AI Analysis");
    assert.equal(sheet.getCell("A2").value, AI_LABEL.en);
    assert.equal(sheet.getCell("A3").value, AI_LABEL.th);
    assert.equal(sheet.getCell("A4").value, "ยอดขายเพิ่มขึ้นทุกเดือน");

    const plain = await exportOf("excel", "");
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(plain.body);
    assert.ok(!String(wb2.keywords || "").includes("ai_generated"));
    assert.equal(wb2.getWorksheet("AI Analysis").getCell("A2").value, "—");
  });
});

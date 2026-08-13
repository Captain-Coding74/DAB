/**
 * routes.test.js — v16
 *
 * The dataset + collaboration routers had ZERO in-process coverage: until
 * v16 the integration tests hit testApp.js, a re-implementation that never
 * mounted them. They were exercised only by the smoketest, over HTTP, in a
 * process V8 can't instrument — so nobody could see what was untested.
 *
 * These tests drive the REAL routers through the REAL app factory, so the
 * repository layer, ownership checks, and error paths are all covered.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildApp, closeApp } from "./testApp.js";

let agent, token, otherToken, datasetId;
const user  = { username: `owner_${Date.now()}`,  password: "Test1234!" };
const other = { username: `other_${Date.now()}`,  password: "Test1234!" };

const CSV = "month,region,units,revenue\n2025-01,BKK,10,100\n2025-02,BKK,20,200\n2025-03,CNX,30,300\n";
const upload = (name = "d.csv") => ({ field: "file", buf: Buffer.from(CSV), name });

before(async () => {
  agent = request(await buildApp());
  token      = (await agent.post("/api/auth/register").send(user)).body.accessToken;
  otherToken = (await agent.post("/api/auth/register").send(other)).body.accessToken;
});
after(async () => { await closeApp(); });

const auth = (req, t = token) => req.set("Authorization", `Bearer ${t}`);

describe("Dataset routes (real router)", () => {
  test("requires auth", async () => {
    assert.equal((await agent.get("/api/datasets")).status, 401);
  });

  test("uploads a dataset and stores its stats", async () => {
    const res = await auth(agent.post("/api/datasets"))
      .attach("file", Buffer.from(CSV), "sales.csv");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.id);
    assert.equal(res.body.totalRows, 3);
    datasetId = res.body.id;
  });

  test("rejects a non-CSV/Excel upload with 400, not 500", async () => {
    const res = await auth(agent.post("/api/datasets"))
      .attach("file", Buffer.from("MZ\x90\x00"), "virus.exe");
    assert.equal(res.status, 400);
  });

  test("v21: rejects a binary renamed to .csv (magic-byte gate)", async () => {
    const elf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00]);
    const res = await auth(agent.post("/api/datasets")).attach("file", elf, "totally_a.csv");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /does not match/i);
  });

  test("v21.1: an uploaded .xlsx survives storage and re-analysis", async () => {
    // The bug this guards: uploads were persisted via buffer.toString("utf-8")
    // into a TEXT column, which corrupts every xlsx (a ZIP archive) on write.
    // Only CSVs were ever re-analyzed, so nothing noticed.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["สินค้า", "ยอดขาย"]);
    ws.addRow(["น้ำปลา", 1234]);
    ws.addRow(["ข้าวสาร", 5678]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

    const up = await auth(agent.post("/api/datasets")).attach("file", xlsx, "ยอดขาย.xlsx");
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.totalRows, 2, "xlsx parsed on upload");

    // the real test: read it back through the preview path
    const preview = await auth(agent.get(`/api/datasets/${up.body.id}/preview`));
    assert.equal(preview.status, 200, "stored xlsx could not be re-read");
    assert.equal(preview.body.totalRows, 2);
    assert.ok(preview.body.headers.includes("สินค้า"), "Thai headers survived the round-trip");
  });

  test("v21: accepts a genuine CSV whose bytes are plain text", async () => {
    const res = await auth(agent.post("/api/datasets")).attach("file", Buffer.from(CSV), "real.csv");
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test("lists datasets for the owner only", async () => {
    const mine = await auth(agent.get("/api/datasets"));
    assert.equal(mine.status, 200);
    assert.ok(Array.isArray(mine.body), "list is a bare array");
    assert.ok(mine.headers["x-total-count"] !== undefined, "total count is a header");
    assert.ok(mine.body.some(d => d.id === datasetId));

    const theirs = await auth(agent.get("/api/datasets"), otherToken);
    assert.ok(!theirs.body.some(d => d.id === datasetId), "no cross-user leakage");
  });

  test("previews rows", async () => {
    const res = await auth(agent.get(`/api/datasets/${datasetId}/preview`));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sampleRows) && res.body.sampleRows.length > 0);
    assert.ok(Array.isArray(res.body.headers) && res.body.headers.length === 4);
  });

  test("renames, describes, and stars", async () => {
    assert.equal((await auth(agent.patch(`/api/datasets/${datasetId}/rename`)).send({ name: "Q1 Sales" })).status, 200);
    assert.equal((await auth(agent.patch(`/api/datasets/${datasetId}/description`)).send({ description: "quarterly" })).status, 200);
    assert.equal((await auth(agent.patch(`/api/datasets/${datasetId}/star`)).send({ starred: true })).status, 200);

    const list = await auth(agent.get("/api/datasets?starred=true"));
    assert.ok(list.body.some(d => d.id === datasetId), "starred filter works");
  });

  test("another user cannot touch someone else's dataset", async () => {
    const res = await auth(agent.patch(`/api/datasets/${datasetId}/rename`), otherToken).send({ name: "hacked" });
    assert.ok([403, 404].includes(res.status), `ownership enforced (got ${res.status})`);
  });

  test("versions: add, list, fetch", async () => {
    const add = await auth(agent.post(`/api/datasets/${datasetId}/versions`))
      .attach("file", Buffer.from(CSV + "2025-04,CNX,40,400\n"), "sales-v2.csv");
    assert.equal(add.status, 201, JSON.stringify(add.body));

    const list = await auth(agent.get(`/api/datasets/${datasetId}/versions`));
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body) && list.body.length >= 1);
  });

  test("tags: add, list, remove", async () => {
    assert.equal((await auth(agent.post(`/api/datasets/${datasetId}/tags`)).send({ tag: "finance" })).status, 200);
    const all = await auth(agent.get("/api/datasets/tags/all"));
    assert.equal(all.status, 200);
    const names = all.body.map(t => t.tag ?? t.name ?? t);
    assert.ok(names.includes("finance"), `tags: ${JSON.stringify(all.body)}`);
    assert.equal((await auth(agent.delete(`/api/datasets/${datasetId}/tags/finance`))).status, 200);
  });

  test("trash → restore round-trip", async () => {
    assert.equal((await auth(agent.delete(`/api/datasets/${datasetId}`))).status, 200);

    const trashed = await auth(agent.get("/api/datasets?trashed=true"));
    assert.ok(trashed.body.some(d => d.id === datasetId), "lands in trash");

    assert.equal((await auth(agent.post(`/api/datasets/${datasetId}/restore`))).status, 200);
    const active = await auth(agent.get("/api/datasets"));
    assert.ok(active.body.some(d => d.id === datasetId), "restored to active");
  });
});

describe("Inference routes (v21.2)", () => {
  // A dataset with two groups, a numeric column, and questionnaire-style
  // items — enough to exercise every branch of the route.
  const SURVEY = [
    "สาขา,ยอดขาย,ข้อ1,ข้อ2,ข้อ3,เพศ",
    "A,120,4,4,5,ชาย",
    "A,135,5,5,5,หญิง",
    "A,128,4,4,4,ชาย",
    "B,210,2,2,1,หญิง",
    "B,198,1,2,2,ชาย",
    "B,225,2,1,2,หญิง",
  ].join("\n");
  let surveyId;

  test("uploads the survey dataset the tests run against", async () => {
    const res = await auth(agent.post("/api/datasets")).attach("file", Buffer.from(SURVEY), "survey.csv");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    surveyId = res.body.id;
  });

  test("requires auth", async () => {
    assert.equal((await agent.post(`/api/inference/${surveyId}`).send({ test: "t-test" })).status, 401);
  });

  test("lists which tests this dataset can support", async () => {
    const res = await auth(agent.get(`/api/inference/${surveyId}/available`));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.tests) && res.body.tests.length === 6);
    assert.ok(res.body.numericColumns.includes("ยอดขาย"));
    assert.ok(res.body.categoricalColumns.includes("สาขา"));
  });

  test("t-test compares two branches and reports a p-value", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`))
      .send({ test: "t-test", valueColumn: "ยอดขาย", groupColumn: "สาขา" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.test, "independent-t");
    assert.ok(Number.isFinite(res.body.p), "p must be a number");
    assert.equal(res.body.computedBy, "deterministic", "ADR-0001: not AI-generated");
    assert.deepEqual(res.body.groupNames.sort(), ["A", "B"]);
  });

  test("a large survey uses EVERY row, not the five-row sample", async () => {
    // Regression: the route read sampleRows, a bounded reservoir sample. A
    // 600-respondent survey came back "each group needs at least 2 values",
    // and where it did not refuse it would have returned a p-value computed
    // from five rows.
    const lines = ["กลุ่ม,คะแนน"];
    for (let i = 0; i < 300; i++) lines.push(`ก,${50 + (i % 10)}`);
    for (let i = 0; i < 300; i++) lines.push(`ข,${62 + (i % 10)}`);
    const up = await auth(agent.post("/api/datasets")).attach("file", Buffer.from(lines.join("\n")), "survey.csv");
    assert.equal(up.status, 201, JSON.stringify(up.body));

    const res = await auth(agent.post(`/api/inference/${up.body.id}`))
      .send({ test: "t-test", valueColumn: "คะแนน", groupColumn: "กลุ่ม" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.n, 600, "all 600 rows must reach the test");
    assert.ok(res.body.p < 0.001, "a 12-point gap across 600 people is unmissable");
  });

  test("t-test refuses when the grouping column has the wrong number of groups", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`))
      .send({ test: "t-test", valueColumn: "ยอดขาย", groupColumn: "ข้อ1" });
    assert.equal(res.status, 400);
    assert.match(res.body.errorEn, /exactly 2 groups/);
  });

  test("ANOVA runs across the grouping column", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`))
      .send({ test: "anova", valueColumn: "ยอดขาย", groupColumn: "สาขา" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.test, "one-way-anova");
    assert.ok(Number.isFinite(res.body.f));
  });

  test("chi-square builds a contingency table from two categorical columns", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`))
      .send({ test: "chi-square", xColumn: "สาขา", yColumn: "เพศ" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.df, 1, "2x2 table");
    assert.ok(Array.isArray(res.body.rowLabels));
  });

  test("correlation and regression both run on two numeric columns", async () => {
    for (const t of ["correlation", "regression"]) {
      const res = await auth(agent.post(`/api/inference/${surveyId}`))
        .send({ test: t, xColumn: "ข้อ1", yColumn: "ยอดขาย" });
      assert.equal(res.status, 200, `${t}: ${JSON.stringify(res.body)}`);
    }
  });

  test("Cronbach's alpha runs across the questionnaire items", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`))
      .send({ test: "cronbach", itemColumns: ["ข้อ1", "ข้อ2", "ข้อ3"] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.nItems, 3);
    assert.ok(typeof res.body.interpretationTh === "string");
  });

  test("Cronbach refuses with fewer than two items", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`))
      .send({ test: "cronbach", itemColumns: ["ข้อ1"] });
    assert.equal(res.status, 400);
  });

  test("an unknown test name lists what is available instead of guessing", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`)).send({ test: "mann-whitney" });
    assert.equal(res.status, 400);
    assert.ok(res.body.available.includes("t-test"));
  });

  test("another user cannot run tests on someone else's dataset", async () => {
    const res = await auth(agent.post(`/api/inference/${surveyId}`), otherToken)
      .send({ test: "t-test", valueColumn: "ยอดขาย", groupColumn: "สาขา" });
    assert.equal(res.status, 403);
  });
});

describe("Data fix routes (v21.3)", () => {
  const MESSY = ["ร้าน,ยอด","ร้าน A,100","ร้านA,102","ร้าน A,98","ร้าน A,101",
                 "ร้าน A,99","ร้าน A,103","ร้าน A,","ร้าน A,5000","ร้าน A,100"].join("\n");
  let fixId;

  test("uploads the messy dataset", async () => {
    const res = await auth(agent.post("/api/datasets")).attach("file", Buffer.from(MESSY), "messy.csv");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    fixId = res.body.id;
  });

  test("the catalogue is closed and auth-gated", async () => {
    assert.equal((await agent.get("/api/fixes/catalogue")).status, 401);
    const res = await auth(agent.get("/api/fixes/catalogue"));
    assert.equal(res.status, 200);
    const ids = res.body.operations.map(o => o.id);
    assert.ok(ids.includes("drop-outliers") && ids.includes("merge-categories"));
  });

  test("preview reports the effect and writes nothing", async () => {
    const before = (await auth(agent.get(`/api/datasets/${fixId}/versions`))).body.length;
    const res = await auth(agent.post(`/api/fixes/${fixId}/preview`))
      .send({ op: "drop-outliers", params: { column: "ยอด" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.applied, false);
    assert.equal(res.body.removed, 1, "the 5000 is an outlier by IQR");
    assert.ok(res.body.log.includes("IQR"));
    const after = (await auth(agent.get(`/api/datasets/${fixId}/versions`))).body.length;
    assert.equal(after, before, "preview must not create a version");
  });

  test("apply creates a NEW version and leaves the original intact", async () => {
    const before = (await auth(agent.get(`/api/datasets/${fixId}/versions`))).body.length;
    const res = await auth(agent.post(`/api/fixes/${fixId}/apply`))
      .send({ op: "drop-outliers", params: { column: "ยอด" } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.applied, true);
    const versions = (await auth(agent.get(`/api/datasets/${fixId}/versions`))).body;
    assert.equal(versions.length, before + 1, "a new version must exist");
    assert.ok(res.body.logTh.length > 5, "the methodology line is recorded");
  });

  test("suggest returns catalogue-valid fixes and changes nothing", async () => {
    const before = (await auth(agent.get(`/api/datasets/${fixId}/versions`))).body.length;
    const res = await auth(agent.post(`/api/fixes/${fixId}/suggest`)).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.suggestions));
    assert.ok(["ai", "rules"].includes(res.body.source));
    // Whatever the source, every suggestion must name a real operation.
    const { OPERATIONS } = await import("./services/dataFixes.js");
    for (const s of res.body.suggestions) {
      assert.ok(OPERATIONS[s.op], `suggested an operation outside the catalogue: ${s.op}`);
    }
    const after = (await auth(agent.get(`/api/datasets/${fixId}/versions`))).body.length;
    assert.equal(after, before, "suggesting must not modify anything");
  });

  test("refuses an operation that would change nothing", async () => {
    const res = await auth(agent.post(`/api/fixes/${fixId}/apply`))
      .send({ op: "drop-missing", params: { column: "ร้าน" } });
    assert.equal(res.status, 400);
  });

  test("refuses an unknown operation rather than improvising", async () => {
    const res = await auth(agent.post(`/api/fixes/${fixId}/preview`)).send({ op: "rm -rf" });
    assert.equal(res.status, 400);
    assert.match(res.body.errorEn, /unknown operation/);
  });

  test("another user cannot fix someone else's dataset", async () => {
    const res = await auth(agent.post(`/api/fixes/${fixId}/preview`), otherToken)
      .send({ op: "drop-duplicates" });
    assert.equal(res.status, 403);
  });

  test("a VIEWER can preview a fix but not apply one", async () => {
    // datasets.js has canEdit(role) on every write; these routes only checked
    // that SOME role existed, so someone given read access to look at a shared
    // thesis dataset could POST /apply and permanently write a new version.
    const share = await auth(agent.post(`/api/datasets/${fixId}/share`))
      .send({ username: other.username, role: "viewer" });
    assert.equal(share.status, 200, JSON.stringify(share.body));

    const preview = await auth(agent.post(`/api/fixes/${fixId}/preview`), otherToken)
      .send({ op: "drop-duplicates" });
    assert.equal(preview.status, 200, "a viewer may still look");

    const apply = await auth(agent.post(`/api/fixes/${fixId}/apply`), otherToken)
      .send({ op: "drop-duplicates" });
    assert.equal(apply.status, 403, "a viewer must not write a new version");

    const aiApply = await auth(agent.post(`/api/fixes/${fixId}/ai-edit/apply`), otherToken)
      .send({ rows: [["1", "2"]], instruction: "x" });
    assert.equal(aiApply.status, 403, "nor through the ai-edit path");
  });
});

describe("Scheduled reports respect dataset access", () => {
  test("you cannot schedule a report against a dataset you cannot read", async () => {
    // The WORKSPACE role was checked but the DATASET was not, so anyone could
    // create a workspace they own and schedule a recurring report against
    // someone else's private dataset, delivered to any address. The scheduler
    // is a stub today, which is why this would have shipped unnoticed and gone
    // live the day email delivery landed.
    const up = await auth(agent.post("/api/datasets"))
      .attach("file", Buffer.from("secret,value\n1,2\n3,4\n"), "private.csv");
    assert.equal(up.status, 201);

    const ws = await auth(agent.post("/api/workspaces"), otherToken).send({ name: "outsider ws" });
    assert.equal(ws.status, 201);

    const res = await auth(agent.post(`/api/workspaces/${ws.body.id}/schedules`), otherToken)
      .send({ name: "exfil", datasetId: up.body.id, cronExpr: "0 9 * * *", recipients: ["x@y.com"] });
    assert.equal(res.status, 403, "must not schedule against another user's dataset");
  });

  test("a schedule with no dataset attached is still allowed", async () => {
    const ws = await auth(agent.post("/api/workspaces")).send({ name: "mine" });
    const res = await auth(agent.post(`/api/workspaces/${ws.body.id}/schedules`))
      .send({ name: "plain", cronExpr: "0 9 * * *", recipients: ["me@x.com"] });
    assert.equal(res.status, 201);
  });
});

describe("Telemetry is operator-only", () => {
  test("a logged-in stranger cannot read the global summary", async () => {
    // It was requireAuth only. The payload carries no raw names, but it does
    // report e.g. {"bySegment":{"pharmacy":1},"categories":{"patient":1}} —
    // telling any registered user that SOMEONE here uploaded a pharmacy file
    // with patient columns. On a small deployment that is close to identifying.
    delete process.env.TELEMETRY_ADMINS;
    const res = await auth(agent.get("/api/telemetry/summary"), otherToken);
    assert.equal(res.status, 403);
  });

  test("anonymous callers are rejected before the operator check", async () => {
    assert.equal((await agent.get("/api/telemetry/summary")).status, 401);
  });

  test("a listed operator can read it", async () => {
    process.env.TELEMETRY_ADMINS = user.username;
    const res = await auth(agent.get("/api/telemetry/summary"));
    assert.equal(res.status, 200);
    delete process.env.TELEMETRY_ADMINS;
  });

  test("closed by default when no allowlist is configured", async () => {
    delete process.env.TELEMETRY_ADMINS;
    assert.equal((await auth(agent.get("/api/telemetry/summary"))).status, 403);
  });
});

describe("Collaboration routes (real router)", () => {
  test("comment with an @mention notifies the mentioned user", async () => {
    const c = await auth(agent.post("/api/collab/comments"))
      .send({ datasetId, content: `looks good @${other.username}` });
    assert.equal(c.status, 201, JSON.stringify(c.body));

    const notes = await auth(agent.get("/api/collab/notifications"), otherToken);
    assert.equal(notes.status, 200);
    assert.ok(Array.isArray(notes.body) && notes.body.length >= 1, "mentioned user was notified");
  });

  test("threaded comments are returned for the dataset", async () => {
    const res = await auth(agent.get(`/api/collab/comments?datasetId=${datasetId}`));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body) && res.body.length >= 1);
  });

  test("unread count and read-all", async () => {
    const before = await auth(agent.get("/api/collab/notifications/unread-count"), otherToken);
    assert.equal(before.status, 200);
    assert.ok(before.body.count >= 1);

    assert.equal((await auth(agent.post("/api/collab/notifications/read-all"), otherToken)).status, 200);

    const after = await auth(agent.get("/api/collab/notifications/unread-count"), otherToken);
    assert.equal(after.body.count, 0, "read-all clears the badge");
  });

  test("activity feed records what happened", async () => {
    const scoped = await auth(agent.get(`/api/collab/activity?datasetId=${datasetId}`));
    assert.equal(scoped.status, 200);
    assert.ok(Array.isArray(scoped.body));

    // the route demands a scope — unscoped is a 400, not a full-table scan
    const unscoped = await auth(agent.get("/api/collab/activity"));
    assert.equal(unscoped.status, 400);
  });

  test("collab endpoints require auth", async () => {
    assert.equal((await agent.get("/api/collab/notifications")).status, 401);
  });
});

describe("Demo routes (public, no auth, no AI)", () => {
  test("lists samples without any auth header", async () => {
    const res = await agent.get("/api/demo/samples");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.samples.length >= 3);
    const shop = res.body.samples.find(s => s.id === "thai-shop");
    assert.ok(shop, "thai-shop sample listed");
    assert.ok(shop.rows > 0 && shop.quality > 0, "cards carry real numbers");
  });

  test("returns a full stats bundle with analysis:null and no auth", async () => {
    const res = await agent.get("/api/demo/samples/thai-shop/analysis");
    assert.equal(res.status, 200);
    assert.equal(res.body.demo, true);
    assert.equal(res.body.analysis, null, "no AI call happens on the demo path");
    assert.equal(res.body.savedId, null);
    assert.ok(res.body.insights.length > 0, "Insights Engine findings present");
    assert.ok(res.body.quality?.score >= 0);
    assert.ok(res.body.suggestions?.length > 0);
  });

  test("thai-shop showcases the v20 messy-file layer end to end", async () => {
    const res = await agent.get("/api/demo/samples/thai-shop/analysis");
    assert.equal(res.body.normalization.skippedPreHeaderRows, 1, "banner row skipped");
    const dateCol = res.body.colAnalysis.find(c => c.semantic === "date");
    assert.ok(dateCol, "date column detected semantically");
    assert.equal(dateCol.buddhistEra, true, "พ.ศ. years recognized");
    assert.ok(dateCol.dateRange.min.startsWith("2026-"), "BE converted to CE");
    assert.ok(res.body.insights.some(i => i.id.startsWith("daterange:")), "date insight fires");
    const sales = res.body.colAnalysis.find(c => c.col === "ยอดขาย");
    assert.equal(sales.type, "numeric", "฿-formatted amounts parsed as numbers");
    assert.ok(sales.min < 0, "(36) refund parsed as negative");
  });

  test("second hit is served from the in-process cache", async () => {
    const res = await agent.get("/api/demo/samples/thai-shop/analysis");
    assert.equal(res.body.cached, true);
  });

  test("unknown sample id is a 404, and ids never touch the filesystem", async () => {
    assert.equal((await agent.get("/api/demo/samples/nope/analysis")).status, 404);
    assert.equal((await agent.get("/api/demo/samples/..%2F..%2Fpackage.json/analysis")).status, 404);
  });
});

describe("Upload telemetry (privacy-safe, v20.2)", () => {
  /* The summary endpoint is operator-only now (TELEMETRY_ADMINS); these
     tests assert what it CONTAINS, so they run as an operator. */
  before(() => { process.env.TELEMETRY_ADMINS = user.username; });
  after(()  => { delete process.env.TELEMETRY_ADMINS; });
  const PHARMACY_CSV = "วันที่,ชื่อยา,ล็อต,วันหมดอายุ,คงเหลือ,ราคา\n" +
    "14/01/2569,พาราเซตามอล,L42,30/06/2569,120,15\n" +
    "15/01/2569,ยาแก้ไอน้ำดำ,L43,31/12/2569,40,55\n";

  test("summary endpoint requires auth", async () => {
    assert.equal((await agent.get("/api/telemetry/summary")).status, 401);
  });

  test("an anonymous /api/analyze upload leaves a segment fingerprint", async () => {
    const up = await agent.post("/api/analyze")
      .attach("file", Buffer.from(PHARMACY_CSV), "ยาร้านป้าศรี.csv")
      .field("question", "สรุปหน่อย");
    assert.equal(up.status, 200, JSON.stringify(up.body).slice(0, 200));

    const res = await auth(agent.get("/api/telemetry/summary"));
    assert.equal(res.status, 200);
    assert.ok(res.body.bySegment.pharmacy >= 1, `pharmacy counted: ${JSON.stringify(res.body.bySegment)}`);
    assert.ok(res.body.bySource.analyze >= 1);
    assert.ok(res.body.categories.expiry >= 1);
    assert.ok(res.body.messy.buddhistEra >= 1, "พ.ศ. dates flagged");
  });

  test("demo taps are counted per sample", async () => {
    await agent.get("/api/demo/samples/thai-shop/analysis");
    const res = await auth(agent.get("/api/telemetry/summary"));
    assert.ok(res.body.demoTaps["thai-shop"] >= 1);
    assert.ok(res.body.bySource.demo >= 1);
    assert.ok(res.body.bySegment.retail_shop >= 1, "thai-shop sample reads as retail");
  });

  test("dataset uploads are counted too", async () => {
    const up = await auth(agent.post("/api/datasets"))
      .attach("file", Buffer.from(PHARMACY_CSV), "stock.csv");
    assert.equal(up.status, 201);
    const res = await auth(agent.get("/api/telemetry/summary"));
    assert.ok(res.body.bySource.dataset >= 1);
  });

  test("the summary leaks NO raw column names or filenames", async () => {
    const res = await auth(agent.get("/api/telemetry/summary"));
    const json = JSON.stringify(res.body);
    for (const leak of ["ชื่อยา", "วันหมดอายุ", "คงเหลือ", "ป้าศรี", "stock.csv"]) {
      assert.ok(!json.includes(leak), `summary leaked: ${leak}`);
    }
  });
});

describe("AI gating + daily budget (v20.3)", () => {
  const CSV2 = "region,units\nBKK,10\nCNX,20\n";

  test("anonymous /api/analyze gets full stats but no AI prose", async () => {
    const res = await agent.post("/api/analyze").attach("file", Buffer.from(CSV2), "anon.csv");
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    assert.equal(res.body.aiGated, true);
    assert.equal(res.body.analysis, null);
    assert.ok(Array.isArray(res.body.insights), "deterministic bundle intact");
    assert.ok(res.body.quality, "quality score intact");
    assert.equal(res.body.savedId, null);
  });

  test("signed-in /api/analyze gets the AI report within budget", async () => {
    const res = await auth(agent.post("/api/analyze")).attach("file", Buffer.from(CSV2), "authed.csv");
    assert.equal(res.status, 200);
    assert.equal(res.body.aiGated, false);
    assert.ok(res.body.analysis.includes("[MOCK]"), "AI (mock) prose present");
    assert.ok(res.body.savedId);
  });

  test("budget exhaustion degrades gracefully — stats served, history saved", async () => {
    process.env.AI_DAILY_BUDGET = "0";
    try {
      const res = await auth(agent.post("/api/analyze")).attach("file", Buffer.from(CSV2), "budget.csv");
      assert.equal(res.status, 200);
      assert.equal(res.body.aiBudget, "exceeded");
      assert.equal(res.body.analysis, null);
      assert.ok(Array.isArray(res.body.insights));
      assert.ok(res.body.savedId, "stats still saved to history");
    } finally { delete process.env.AI_DAILY_BUDGET; }
  });

  test("stored-dataset re-analysis respects the budget too", async () => {
    process.env.AI_DAILY_BUDGET = "0";
    try {
      const res = await auth(agent.post(`/api/datasets/${datasetId}/analyze`)).send({ question: "สรุป" });
      assert.equal(res.status, 200);
      assert.equal(res.body.aiBudget, "exceeded");
      assert.equal(res.body.analysis, null);
    } finally { delete process.env.AI_DAILY_BUDGET; }
  });
});

describe("Public landing page (v20.4.1)", () => {
  test("/welcome serves the bilingual landing, EN default", async () => {
    const res = await agent.get("/welcome");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("AFTER-HOURS CONSOLE"), "landing brand present");
    assert.ok(res.text.includes('id="langEn" class="on"'), "English is the default language");
    assert.ok(res.text.includes("LIVE PARSE"), "signature console present");
  });

  test("/api/health reports the real package version, not a hardcoded one", async () => {
    const res = await agent.get("/api/health");
    const pkg = JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(res.body.version, pkg.version, "health version === package.json version");
  });
});

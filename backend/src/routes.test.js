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

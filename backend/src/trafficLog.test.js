/**
 * trafficLog.test.js — v21.30: the Computer-Related Crime Act s.26 traffic
 * log, through the REAL app.
 *
 *   • Each listed event writes one row: event, user id (when known), IP
 *     (req.ip, here from X-Forwarded-For under TRUST_PROXY=1), time, ref.
 *   • A refused request (status >= 400) writes nothing.
 *   • The share token is never stored — the ref is the link's id.
 *   • Rows go after 90 days, and no setting can make that shorter.
 *   • No route reads the table.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { query } from "./db/pool.js";
import { trafficSettled } from "./services/trafficLog.js";
import { runRetention } from "./services/retention.js";

const SALES = fs.readFileSync(new URL("../sample-data/sales.csv", import.meta.url));
const PASSWORD = "Test1234!";
const DAY = 24 * 60 * 60 * 1000;
const u = Date.now().toString(36);
const T0 = new Date().toISOString();   // the test database persists across runs: only this run's rows count

let agent, tok, userId, username;
let ipSeq = 0;
/** A fresh documentation-range IP per request, so each row is found by its IP alone. */
const nextIp = () => `198.51.100.${++ipSeq}`;
const from = (req, ip) => req.set("X-Forwarded-For", ip);
const signedIn = (req, ip) => from(req, ip).set("Authorization", `Bearer ${tok}`);

async function rowsFrom(ip) {
  await trafficSettled();
  return query(`SELECT event,user_id,ip,ref,created_at FROM traffic_log WHERE ip=$1 AND created_at>=$2`, [ip, T0]);
}
/** Exactly one row from `ip`, with this event. */
async function oneRow(ip, event) {
  const rows = await rowsFrom(ip);
  assert.equal(rows.length, 1, `rows from ${ip}: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].event, event);
  assert.ok(!Number.isNaN(Date.parse(rows[0].created_at)));
  return rows[0];
}

before(async () => {
  agent = request(await buildApp());
  username = `tl_${u}`;
  const ip = nextIp();
  const res = await from(agent.post("/api/auth/register"), ip).send({ username, password: PASSWORD, ...TERMS });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  tok = res.body.accessToken;
  userId = (await query(`SELECT id FROM users WHERE username=$1`, [username]))[0].id;
  const row = await oneRow(ip, "register");
  assert.equal(row.user_id, userId, "register: the id comes from res.locals — req.user is not set there");
});
after(async () => { await closeApp(); });

describe("events", () => {
  let datasetId, analysisId, share;

  test("login records the user; a refused login records nothing", async () => {
    const ok = nextIp();
    assert.equal((await from(agent.post("/api/auth/login"), ok).send({ username, password: PASSWORD })).status, 200);
    assert.equal((await oneRow(ok, "login")).user_id, userId);
    const bad = nextIp();
    assert.equal((await from(agent.post("/api/auth/login"), bad).send({ username, password: "wrong-password" })).status, 401);
    assert.deepEqual(await rowsFrom(bad), []);
  });

  test("a refused sign-up records nothing", async () => {
    const ip = nextIp();
    assert.equal((await from(agent.post("/api/auth/register"), ip).send({ username: `tl_x_${u}`, password: PASSWORD })).status, 400);
    assert.deepEqual(await rowsFrom(ip), []);
  });

  test("analyze: signed out → no user id; signed in → the user", async () => {
    const anon = nextIp();
    assert.equal((await from(agent.post("/api/analyze"), anon).attach("file", SALES, "sales.csv")).status, 200);
    const a = await oneRow(anon, "analyze");
    assert.equal(a.user_id, null);
    assert.equal(a.ip, anon);
    const mine = nextIp();
    const res = await signedIn(agent.post("/api/analyze"), mine).attach("file", SALES, "sales.csv");
    assert.equal(res.status, 200);
    analysisId = res.body.savedId;
    assert.equal((await oneRow(mine, "analyze")).user_id, userId);
  });

  test("dataset upload: new, multi and a new version (ref = the dataset)", async () => {
    const one = nextIp();
    const res = await signedIn(agent.post("/api/datasets"), one).attach("file", SALES, "sales.csv");
    assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
    datasetId = res.body.id;
    assert.equal((await oneRow(one, "dataset_upload")).user_id, userId);

    const multi = nextIp();
    assert.equal((await signedIn(agent.post("/api/datasets/multi"), multi)
      .attach("files", SALES, "a.csv").attach("files", SALES, "b.csv")).status, 201);
    assert.equal((await oneRow(multi, "dataset_upload")).user_id, userId);

    const version = nextIp();
    assert.equal((await signedIn(agent.post(`/api/datasets/${datasetId}/versions`), version).attach("file", SALES, "sales.csv")).status, 201);
    const v = await oneRow(version, "dataset_upload");
    assert.equal(v.ref, datasetId);
  });

  test("analyze of a saved dataset carries the dataset id", async () => {
    const ip = nextIp();
    assert.equal((await signedIn(agent.post(`/api/datasets/${datasetId}/analyze`), ip).send({})).status, 200);
    const row = await oneRow(ip, "analyze");
    assert.equal(row.ref, datasetId);
    assert.equal(row.user_id, userId);
  });

  test("export: the format is the ref", async () => {
    const ip = nextIp();
    assert.equal((await signedIn(agent.post("/api/export/pdf"), ip).attach("file", SALES, "sales.csv")).status, 200);
    const row = await oneRow(ip, "export");
    assert.equal(row.ref, "pdf");
    assert.equal(row.user_id, userId);
  });

  test("share create and share view carry the link's id — never its token", async () => {
    const created = nextIp();
    const res = await signedIn(agent.post(`/api/analyses/${analysisId}/share`), created).send({ title: "t" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    share = res.body;
    const c = await oneRow(created, "share_create");
    assert.equal(c.ref, share.id);
    assert.equal(c.user_id, userId);

    const viewed = nextIp();
    assert.equal((await from(agent.get(`/api/public/share/${share.token}`), viewed)).status, 200);
    const v = await oneRow(viewed, "share_view");
    assert.equal(v.ref, share.id);
    assert.equal(v.user_id, null, "a public view by a signed-out visitor");

    const missing = nextIp();
    assert.equal((await from(agent.get(`/api/public/share/${randomUUID()}`), missing)).status, 404);
    assert.deepEqual(await rowsFrom(missing), []);

    const holding = await query(
      `SELECT COUNT(*) AS n FROM traffic_log WHERE id LIKE $1 OR event LIKE $1 OR user_id LIKE $1 OR ip LIKE $1 OR ref LIKE $1 OR created_at LIKE $1`,
      [`%${share.token}%`]);
    assert.equal(Number(holding[0].n), 0, "the share token is stored nowhere in the traffic log");
  });

  test("data export, logout and logout-all record the user", async () => {
    const exp = nextIp();
    assert.equal((await signedIn(agent.get("/api/auth/me/export"), exp)).status, 200);
    assert.equal((await oneRow(exp, "data_export")).user_id, userId);

    const out = nextIp();
    assert.equal((await signedIn(agent.post("/api/auth/logout"), out).send({})).status, 200);
    assert.equal((await oneRow(out, "logout")).user_id, userId);

    const all = nextIp();
    assert.equal((await signedIn(agent.post("/api/auth/logout-all"), all).send({})).status, 200);
    assert.equal((await oneRow(all, "logout_all")).user_id, userId);
  });

  test("routes outside the event list record nothing", async () => {
    const ip = nextIp();
    assert.equal((await signedIn(agent.get("/api/auth/me"), ip)).status, 200);
    assert.equal((await signedIn(agent.get("/api/history"), ip)).status, 200);
    assert.deepEqual(await rowsFrom(ip), []);
  });

  test("account deletion records the deleted user's id, and erasure keeps the log", async () => {
    const before = Number((await query(`SELECT COUNT(*) AS n FROM traffic_log WHERE user_id=$1`, [userId]))[0].n);
    const ip = nextIp();
    const res = await signedIn(agent.delete("/api/auth/me"), ip).send({ password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await oneRow(ip, "account_delete")).user_id, userId);
    const afterCount = Number((await query(`SELECT COUNT(*) AS n FROM traffic_log WHERE user_id=$1`, [userId]))[0].n);
    assert.equal(afterCount, before + 1);
    assert.equal((await query(`SELECT COUNT(*) AS n FROM users WHERE id=$1`, [userId]))[0].n * 1, 0);
  });
});

describe("retention", () => {
  const add = async (daysAgo) => {
    const id = randomUUID();
    await query(`INSERT INTO traffic_log (id,event,user_id,ip,ref,created_at) VALUES ($1,'login',NULL,'192.0.2.1',NULL,$2)`,
      [id, new Date(Date.now() - daysAgo * DAY).toISOString()]);
    return id;
  };
  const exists = async (id) => Number((await query(`SELECT COUNT(*) AS n FROM traffic_log WHERE id=$1`, [id]))[0].n) === 1;

  test("rows older than 90 days are deleted, younger ones kept", async () => {
    const old = await add(91), recent = await add(89);
    const result = await runRetention();
    assert.ok(result["traffic-log"] >= 1);
    assert.equal(await exists(old), false);
    assert.equal(await exists(recent), true);
  });

  test("a setting below 90 days is raised to 90; a longer one is honoured", async () => {
    const at60 = await add(60);
    await runRetention({ env: { TRAFFIC_LOG_RETENTION_DAYS: "30" } });
    assert.equal(await exists(at60), true, "s.26: never kept less than 90 days");
    const at120 = await add(120);
    await runRetention({ env: { TRAFFIC_LOG_RETENTION_DAYS: "180" } });
    assert.equal(await exists(at120), true);
    await runRetention({ env: { TRAFFIC_LOG_RETENTION_DAYS: "100" } });
    assert.equal(await exists(at120), false);
  });
});

describe("no API exposes the table", () => {
  test("no route module or app.js mentions traffic_log", () => {
    const dir = new URL("./routes/", import.meta.url);
    const sources = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => [f, fs.readFileSync(new URL(f, dir), "utf8")]);
    sources.push(["app.js", fs.readFileSync(new URL("./app.js", import.meta.url), "utf8")]);
    const hits = sources.filter(([, src]) => /traffic_log/.test(src)).map(([f]) => f);
    assert.deepEqual(hits, []);
  });
});

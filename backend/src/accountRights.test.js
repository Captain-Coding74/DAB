/**
 * accountRights.test.js — v21.30: the right to a copy and the right to
 * erasure, through the REAL app.
 *
 *   • GET /api/auth/me/export is everything DAB holds about the caller —
 *     analyses and chat included, no password or token hash anywhere — with a
 *     download path for each saved original file (owner only).
 *   • DELETE /api/auth/me needs the password, then leaves no row in any table
 *     that carries the user id — except the traffic log, a legal record kept
 *     until its own 90-day retention ends — hands owned workspaces on (admin,
 *     else member, else the workspace goes), and leaves every other account's
 *     data alone.
 *   • Both are logged in privacy_requests under sha256(user id), which the
 *     retention job keeps for 3 years.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { query } from "./db/pool.js";
import * as storage from "./services/storage.js";
import { runRetention } from "./services/retention.js";
import { trafficSettled } from "./services/trafficLog.js";
import { eraseAccount, ERASED_USER } from "./db/accountErase.js";
import { collectAccountData } from "./db/accountData.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SALES = fs.readFileSync(new URL("../sample-data/sales.csv", import.meta.url));
const PASSWORD = "Test1234!";
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

let agent;
const u = Date.now().toString(36);
const tok = {}, id = {}, name = {}, fx = {};
const as = (req, who) => req.set("Authorization", `Bearer ${tok[who]}`);
const one = async (sql, args) => (await query(sql, args))[0];
const count = async (sql, args) => Number((await one(sql, args)).n);

async function register(who) {
  name[who] = `ar_${who}_${u}`;
  const res = await agent.post("/api/auth/register").send({ username: name[who], password: PASSWORD, ...TERMS });
  assert.ok(res.body.accessToken, `could not register ${who}`);
  tok[who] = res.body.accessToken;
  id[who] = (await one(`SELECT id FROM users WHERE username=$1`, [name[who]])).id;
}

async function workspace(label, members) {
  const ws = (await as(agent.post("/api/workspaces"), "a").send({ name: `${label} ${u}` })).body.id;
  let t = Date.now();
  for (const [who, role] of members) {
    await as(agent.post(`/api/workspaces/${ws}/members`), "a").send({ username: name[who], role });
    await query(`UPDATE workspace_members SET joined_at=$1 WHERE workspace_id=$2 AND user_id=$3`, [new Date(t += 1000).toISOString(), ws, id[who]]);
  }
  return ws;
}

const upload = (who, file = "sales.csv") => as(agent.post("/api/datasets"), who).attach("file", SALES, file);

/** Every row, in every table, holding this value in any column — exact or embedded.
 *  traffic_log is left out on purpose: erasure keeps it (Computer-Related
 *  Crime Act s.26) until retention deletes it — asserted separately below. */
async function rowsHolding(value) {
  const found = {};
  await trafficSettled();
  for (const { name: table } of await query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'traffic_log'`)) {
    for (const { name: col } of await query(`PRAGMA table_info(${table})`)) {
      const n = await count(`SELECT COUNT(*) AS n FROM ${table} WHERE CAST(${col} AS TEXT) LIKE $1`, [`%${value}%`]);
      if (n) found[`${table}.${col}`] = n;
    }
  }
  return found;
}

before(async () => {
  agent = request(await buildApp());
  for (const who of ["a", "b", "c", "d", "v"]) await register(who);

  // Workspaces A owns: an admin who joined after a member (the admin inherits),
  // a lone member (inherits), and a viewer only (the workspace is deleted).
  fx.w1 = await workspace("W1", [["c", "member"], ["b", "admin"]]);
  fx.w2 = await workspace("W2", [["c", "member"]]);
  fx.w3 = await workspace("W3", [["v", "viewer"]]);
  fx.vDataset = (await upload("v")).body.id;
  await query(`UPDATE datasets SET workspace_id=$1 WHERE id=$2`, [fx.w3, fx.vDataset]);
  fx.folder = (await as(agent.post("/api/datasets/folders"), "a").send({ name: "mine", workspaceId: fx.w1 })).body.id;
  fx.dashboard = (await as(agent.post("/api/collab/dashboards"), "a").send({ workspaceId: fx.w1, name: "board" })).body.id;

  // A's own data: a saved dataset (two versions, shared with B), an analysis
  // of it, a direct analysis with chat and a password-protected share link.
  fx.ds = (await upload("a")).body.id;
  await as(agent.post(`/api/datasets/${fx.ds}/versions`), "a").attach("file", SALES, "sales-v2.csv");
  await as(agent.post(`/api/datasets/${fx.ds}/share`), "a").send({ username: name.b, role: "viewer" });
  fx.dsAnalysis = (await as(agent.post(`/api/datasets/${fx.ds}/analyze`), "a").send({ question: "trend?" })).body.savedId;
  fx.analysis = (await as(agent.post("/api/analyze"), "a").attach("file", SALES, "sales.csv").field("question", "top products")).body.savedId;
  assert.ok(fx.dsAnalysis && fx.analysis, "analyses saved");
  const chat = await as(agent.post(`/api/analyses/${fx.analysis}/chat`), "a").send({ message: "which month was best?" });
  assert.equal(chat.status, 200, JSON.stringify(chat.body).slice(0, 160));
  fx.shareToken = randomUUID();
  await query(`INSERT INTO shared_reports (id,analysis_id,user_id,token,title,password_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,'Analysis report','$2a$10$notarealhashnotarealhashnotarealhashnotarealhash',$5,$6)`,
    [randomUUID(), fx.analysis, id.a, fx.shareToken, iso(-30 * DAY), iso()]);
  await query(`INSERT INTO upload_metadata (id,source,user_id,created_at) VALUES ($1,'dataset',$2,$3)`, [randomUUID(), id.a, iso()]);

  // D's dataset, shared with A as editor: A adds a version, comments
  // (mentioning D), D replies; D comments mentioning A.
  fx.dDataset = (await upload("d")).body.id;
  await as(agent.post(`/api/datasets/${fx.dDataset}/share`), "d").send({ username: name.a, role: "editor" });
  await as(agent.post(`/api/datasets/${fx.dDataset}/versions`), "a").attach("file", SALES, "from-a.csv");
  fx.aComment = (await as(agent.post("/api/collab/comments"), "a").send({ datasetId: fx.dDataset, content: `@${name.d} look` })).body.id;
  fx.dReply = (await as(agent.post("/api/collab/comments"), "d").send({ datasetId: fx.dDataset, parentId: fx.aComment, content: "ok" })).body.id;
  fx.dComment = (await as(agent.post("/api/collab/comments"), "d").send({ datasetId: fx.dDataset, content: `thanks @${name.a}` })).body.id;
  fx.dAnalysis = (await as(agent.post("/api/analyze"), "d").attach("file", SALES, "sales.csv")).body.savedId;
});
after(async () => { await closeApp(); });

describe("GET /api/auth/me/export", () => {
  let res, data;
  before(async () => {
    res = await as(agent.get("/api/auth/me/export"), "a").buffer(true).parse((r, cb) => {
      let s = ""; r.setEncoding("utf8"); r.on("data", (c) => { s += c; }); r.on("end", () => cb(null, s));
    });
    data = JSON.parse(res.body);
  });

  test("a JSON attachment named dab-export-<username>-<date>.json, never cached", () => {
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.match(res.headers["content-disposition"], new RegExp(`^attachment; filename="dab-export-${name.a}-\\d{4}-\\d{2}-\\d{2}\\.json"$`));
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("no password hash, refresh-token hash, share token or share password anywhere", async () => {
    const { password_hash } = await one(`SELECT password_hash FROM users WHERE id=$1`, [id.a]);
    for (const secret of [password_hash, fx.shareToken, "notarealhash", "password_hash", "token_hash"]) {
      assert.ok(!res.body.includes(secret), `export contains ${secret.slice(0, 12)}`);
    }
    assert.equal(data.profile.username, name.a);
    assert.ok(data.sessions.length >= 1 && !("token_hash" in data.sessions[0]));
  });

  test("includes the analyses, both sides of the chat, and the share link's details", () => {
    const analyses = new Map(data.analyses.map((a) => [a.id, a]));
    assert.ok(analyses.has(fx.analysis) && analyses.has(fx.dsAnalysis));
    assert.equal(typeof analyses.get(fx.analysis).stats_json, "object", "stored JSON comes back as structure");
    const said = data.chat.filter((m) => m.analysis_id === fx.analysis).map((m) => m.role);
    assert.deepEqual(said.sort(), ["assistant", "user"]);
    assert.ok(data.chat.some((m) => m.content === "which month was best?"));
    const [link] = data.shareLinks;
    assert.equal(link.analysis_id, fx.analysis);
    assert.equal(link.password_protected, true);
    assert.ok(link.expires_at && link.created_at && "view_count" in link && !("token" in link));
  });

  test("datasets carry version metadata and a download path, not bytes", async () => {
    const ds = data.datasets.find((d) => d.id === fx.ds);
    assert.equal(ds.versions.length, 2);
    assert.ok(ds.versions.every((v) => !("file_content" in v) && !("storage_key" in v) && v.uploaded_by_you));
    const dl = await as(agent.get(ds.versions[0].download), "a").buffer(true).parse((r, cb) => {
      const parts = []; r.on("data", (c) => parts.push(c)); r.on("end", () => cb(null, Buffer.concat(parts)));
    });
    assert.equal(dl.status, 200);
    assert.match(dl.headers["content-disposition"], /^attachment; filename="sales\.csv"$/);
    assert.ok(Buffer.compare(dl.body, SALES) === 0, "the original bytes");
  });

  test("workspaces with roles, comments, notifications, activity, audit log and telemetry", () => {
    const owned = data.workspaces.filter((w) => w.you_own_it && w.role === "owner").map((w) => w.id);
    assert.deepEqual(owned.sort(), [fx.w1, fx.w2, fx.w3].sort());
    assert.ok(data.comments.some((c) => c.id === fx.aComment));
    assert.ok(data.notifications.some((n) => n.type === "mention"), "D's mention of A");
    assert.ok(data.activity.some((a) => a.action === "comment_added"));
    assert.ok(data.auditLog.some((a) => a.action === "register"));
    assert.ok(data.telemetry.length >= 1 && !("user_id" in data.telemetry[0]));
    assert.ok(data.sharedWithYou.some((p) => p.dataset_id === fx.dDataset && p.role === "editor"));
  });

  /* v21.30: the export claimed "everything" while leaving out the traffic
     log and the versions A added to other people's datasets. */
  test("says what it leaves out, and lists the version added to someone else's dataset", async () => {
    assert.match(data.about, /Not included: your entries in the traffic log/);
    const added = data.versionsYouAddedToOthers.filter((v) => v.dataset_id === fx.dDataset);
    assert.equal(added.length, 1);
    assert.equal(added[0].file_name, "from-a.csv");
    assert.ok(!("download" in added[0]) && !("storage_key" in added[0]), "the file stays the owner's to hand out");
    assert.ok(!("trafficLog" in data));
  });

  test("the operator's export for an email or post request adds the traffic-log entries", async () => {
    await trafficSettled();
    const full = await collectAccountData(id.a, new Date(), { trafficLog: true });
    assert.ok(full.trafficLog.some((r) => r.event === "register" && r.ip), JSON.stringify(full.trafficLog).slice(0, 200));
    assert.ok(full.trafficLog.every((r) => !("user_id" in r) && !("id" in r)));
    assert.doesNotMatch(full.about, /Not included/);
  });

  test("is logged as a completed self-service export under sha256(user id)", async () => {
    const rows = await query(`SELECT type, channel, status, completed_at FROM privacy_requests WHERE subject_hash=$1`, [sha256(id.a)]);
    assert.deepEqual(rows.map((r) => [r.type, r.channel, r.status]), [["export", "self-service", "completed"]]);
    assert.ok(rows[0].completed_at);
  });

  test("only ever the caller's own data", async () => {
    const other = await as(agent.get("/api/auth/me/export"), "b");
    assert.equal(other.status, 200);
    // B's own rows may name A's dataset (B was given access to it); A's records may not appear.
    const text = JSON.stringify(other.body);
    assert.equal(other.body.profile.username, name.b);
    for (const leaked of [fx.analysis, fx.dsAnalysis, fx.aComment, id.a]) assert.ok(!text.includes(leaked), leaked);
    assert.equal((await agent.get("/api/auth/me/export")).status, 401);
  });

  test("the download path is the owner's alone", async () => {
    const v = (await query(`SELECT id FROM dataset_versions WHERE dataset_id=$1`, [fx.ds]))[0].id;
    assert.equal((await as(agent.get(`/api/datasets/${fx.ds}/versions/${v}/download`), "b")).status, 403, "a collaborator");
    assert.equal((await as(agent.get(`/api/datasets/${fx.ds}/versions/${v}/download`), "d")).status, 403, "a stranger");
    assert.equal((await as(agent.get(`/api/datasets/${fx.dDataset}/versions/${v}/download`), "d")).status, 404, "a version of another dataset");
  });
});

describe("DELETE /api/auth/me", () => {
  const deleteRequests = () => count(`SELECT COUNT(*) AS n FROM privacy_requests WHERE type='delete' AND subject_hash=$1`, [sha256(id.a)]);

  test("400 PASSWORD_REQUIRED without a password, 403 WRONG_PASSWORD with a wrong one — nothing erased", async () => {
    for (const body of [{}, { password: "" }, { password: 123 }]) {
      const res = await as(agent.delete("/api/auth/me"), "a").send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "PASSWORD_REQUIRED");
    }
    // Not 401: the SPA reads a 401 as an expired session and re-sends the request.
    const wrong = await as(agent.delete("/api/auth/me"), "a").send({ password: "wrong-password" });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, "WRONG_PASSWORD");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM users WHERE id=$1`, [id.a]), 1);
    assert.equal(await deleteRequests(), 0);
  });

  test("cannot delete another user: the password is checked against the caller's own account", async () => {
    const res = await as(agent.delete("/api/auth/me"), "b").send({ password: "wrong-for-b", userId: id.a, username: name.a });
    assert.equal(res.status, 403);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM users WHERE id IN ($1,$2)`, [id.a, id.b]), 2);
  });

  test("erases the account: no row anywhere holds the user id", async () => {
    fx.keys = (await query(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1`, [fx.ds])).map((r) => r.storage_key);
    assert.ok(Object.keys(await rowsHolding(id.a)).length > 5, "the fixture reaches many tables");
    const res = await as(agent.delete("/api/auth/me"), "a").send({ password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await rowsHolding(id.a), {});
    for (const k of fx.keys) assert.equal(await storage.exists(k), false, "stored file deleted");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM notifications WHERE title LIKE $1`, [`%${name.a}%`]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM activity_feed WHERE metadata LIKE $1`, [`%${name.a}%`]), 0);
  });

  test("the traffic log is kept: it still records the account, its deletion included", async () => {
    await trafficSettled();
    const events = (await query(`SELECT event FROM traffic_log WHERE user_id=$1`, [id.a])).map((r) => r.event);
    for (const e of ["register", "dataset_upload", "account_delete"]) assert.ok(events.includes(e), e);
  });

  test("owned workspaces pass to the earliest admin, else member; with only a viewer left it is deleted", async () => {
    const owner = async (ws) => (await one(`SELECT owner_id FROM workspaces WHERE id=$1`, [ws]))?.owner_id;
    const role = async (ws, who) => (await one(`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [ws, id[who]]))?.role;
    assert.equal(await owner(fx.w1), id.b, "the admin, though the member joined first");
    assert.equal(await role(fx.w1, "b"), "owner");
    assert.equal(await role(fx.w1, "c"), "member");
    assert.equal(await owner(fx.w2), id.c);
    assert.equal(await role(fx.w2, "c"), "owner");
    assert.equal(await owner(fx.w3), undefined);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id=$1`, [fx.w3]), 0);
    const vDs = await one(`SELECT workspace_id FROM datasets WHERE id=$1`, [fx.vDataset]);
    assert.equal(vDs.workspace_id, null, "the viewer's dataset moved to their personal space");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM dataset_folders WHERE id=$1`, [fx.folder]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM shared_dashboards WHERE id=$1`, [fx.dashboard]), 0);
  });

  test("other users are untouched", async () => {
    assert.equal(await count(`SELECT COUNT(*) AS n FROM users WHERE id IN ($1,$2,$3,$4)`, [id.b, id.c, id.d, id.v]), 4);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM datasets WHERE id IN ($1,$2)`, [fx.dDataset, fx.vDataset]), 2);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM dataset_versions WHERE dataset_id=$1`, [fx.dDataset]), 2, "A's version of D's file stays D's");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM dataset_versions WHERE dataset_id=$1 AND uploaded_by=$2`, [fx.dDataset, ERASED_USER]), 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM analyses WHERE id=$1`, [fx.dAnalysis]), 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM comments WHERE id=$1`, [fx.dComment]), 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM comments WHERE id IN ($1,$2)`, [fx.aComment, fx.dReply]), 0, "A's thread, replies included");
    assert.equal((await agent.post("/api/auth/login").send({ username: name.d, password: PASSWORD })).status, 200);
    assert.equal((await as(agent.get(`/api/datasets/${fx.dDataset}`), "d")).status, 200);
  });

  test("the erased account cannot sign in, and its open token is refused at once", async () => {
    assert.equal((await agent.post("/api/auth/login").send({ username: name.a, password: PASSWORD })).status, 401);
    assert.equal((await as(agent.get("/api/auth/me"), "a")).status, 401);
    const anon = await as(agent.post("/api/analyze"), "a").attach("file", SALES, "sales.csv");
    assert.equal(anon.body.savedId ?? null, null, "optionalAuth treats it as signed out: nothing saved under the erased id");
    assert.deepEqual(await rowsHolding(id.a), {});
  });

  test("is logged received → completed, holding only the hash; a re-run is a no-op", async () => {
    const [row] = await query(`SELECT * FROM privacy_requests WHERE type='delete' AND subject_hash=$1`, [sha256(id.a)]);
    assert.equal(row.channel, "self-service");
    assert.equal(row.status, "completed");
    assert.ok(row.completed_at >= row.created_at);
    await eraseAccount(id.a);
    assert.deepEqual(await rowsHolding(id.a), {});
  });
});

describe("privacy-request retention", () => {
  test("rows are kept 3 years (PRIVACY_REQUEST_RETENTION_DAYS=1095), then deleted", async () => {
    const add = async (daysAgo) => {
      const rid = randomUUID();
      await query(`INSERT INTO privacy_requests (id,subject_hash,type,channel,status,created_at) VALUES ($1,$2,'other','email','completed',$3)`,
        [rid, sha256(rid), iso(daysAgo * DAY)]);
      return rid;
    };
    const old = await add(1100), recent = await add(1000);
    const result = await runRetention();
    assert.ok(result["privacy-requests"] >= 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM privacy_requests WHERE id=$1`, [old]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM privacy_requests WHERE id=$1`, [recent]), 1);
  });
});

/* v21.30: storage.remove swallowed every failure, so an erasure whose file
   delete failed (a network blip, a bucket credential without DeleteObject)
   answered 200, logged the request "completed" and dropped the only rows
   recording the key — the file stayed in storage for good. Now the failure
   stops the cascade with its rows intact and the request stays open. Sessions
   are revoked before the slow part, so no refresh mints a token meanwhile. */
describe("an erasure whose stored file cannot be deleted", () => {
  const OBJECTS = path.join(process.env.SQLITE_DIR || fileURLToPath(new URL("../data", import.meta.url)), "objects");
  const who = `ar_stuck_${u}`;
  let session, userId, datasetId, objectPath;

  before(async () => {
    session = (await agent.post("/api/auth/register").send({ username: who, password: PASSWORD, ...TERMS })).body;
    userId = (await one(`SELECT id FROM users WHERE username=$1`, [who])).id;
    datasetId = (await agent.post("/api/datasets").set("Authorization", `Bearer ${session.accessToken}`).attach("file", SALES, "sales.csv")).body.id;
    const { storage_key } = await one(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1`, [datasetId]);
    objectPath = path.join(OBJECTS, storage_key);
    fs.rmSync(objectPath);
    fs.mkdirSync(objectPath);   // unlink() now fails, as a refused S3 DeleteObject would
  });

  test("permanent delete fails and keeps the rows that record the file", async () => {
    const res = await agent.delete(`/api/datasets/${datasetId}/permanent`).set("Authorization", `Bearer ${session.accessToken}`);
    assert.equal(res.status, 500);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM dataset_versions WHERE dataset_id=$1`, [datasetId]), 1);
  });

  test("account deletion fails, stays an open request, and has already revoked the sessions", async () => {
    const res = await agent.delete("/api/auth/me").set("Authorization", `Bearer ${session.accessToken}`).send({ password: PASSWORD });
    assert.equal(res.status, 500);
    const [request] = await query(`SELECT status FROM privacy_requests WHERE type='delete' AND subject_hash=$1`, [sha256(userId)]);
    assert.equal(request.status, "received");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM dataset_versions WHERE dataset_id=$1`, [datasetId]), 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id=$1`, [userId]), 0);
    assert.equal((await agent.post("/api/auth/refresh").send({ refreshToken: session.refreshToken })).status, 401);
  });

  test("once storage works again, the user signs in and the deletion completes", async () => {
    fs.rmdirSync(objectPath);
    const login = (await agent.post("/api/auth/login").send({ username: who, password: PASSWORD })).body;
    const res = await agent.delete("/api/auth/me").set("Authorization", `Bearer ${login.accessToken}`).send({ password: PASSWORD });
    assert.equal(res.status, 200);
    assert.deepEqual(await rowsHolding(userId), {});
    const statuses = (await query(`SELECT status FROM privacy_requests WHERE type='delete' AND subject_hash=$1`, [sha256(userId)])).map((r) => r.status);
    assert.ok(statuses.includes("completed"), statuses.join());
  });

  test("an erased id is refused a new access token even with a live refresh token", async () => {
    const { markErased, clearErased } = await import("./auth.js");
    const other = (await agent.post("/api/auth/register").send({ username: `${who}_r`, password: PASSWORD, ...TERMS })).body;
    const otherId = (await one(`SELECT id FROM users WHERE username=$1`, [`${who}_r`])).id;
    markErased(otherId);
    try {
      assert.equal((await agent.post("/api/auth/refresh").send({ refreshToken: other.refreshToken })).status, 401);
    } finally { clearErased(otherId); }
  });
});

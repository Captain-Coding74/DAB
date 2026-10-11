/**
 * memberPrivacy.test.js — v21.30: who can see whose email, through the REAL app.
 *
 * A workspace member list carried every member's email to every other member,
 * and a dataset's collaborator list carried them to every collaborator. The
 * Privacy Notice now says an email is shown only to the user themself, so:
 *
 *   • GET /api/workspaces/:id — the caller's own row has their email; every
 *     other row has none, whatever the caller's role.
 *   • GET /api/datasets/:id/collaborators — no email at all, for anyone.
 *   • A saved file's object key holds no part of its original filename.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import request from "supertest";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { query } from "./db/pool.js";

const SALES = fs.readFileSync(new URL("../sample-data/sales.csv", import.meta.url));
const u = Date.now().toString(36);
const tok = {}, name = {}, email = {}, fx = {};
let agent;
const as = (req, who) => req.set("Authorization", `Bearer ${tok[who]}`);

async function register(who) {
  name[who] = `mp_${who}_${u}`;
  email[who] = `${who}.${u}@example.test`;
  const res = await agent.post("/api/auth/register").send({ username: name[who], password: "Test1234!", email: email[who], ...TERMS });
  assert.ok(res.body.accessToken, `could not register ${who}`);
  tok[who] = res.body.accessToken;
}

/** Every address in the response that is not the caller's own. */
const othersEmails = (body, who) => Object.entries(email).filter(([w, e]) => w !== who && JSON.stringify(body).includes(e)).map(([, e]) => e);

before(async () => {
  agent = request(await buildApp());
  for (const who of ["owner", "admin", "member", "collab"]) await register(who);

  fx.ws = (await as(agent.post("/api/workspaces"), "owner").send({ name: `Team ${u}` })).body.id;
  for (const [who, role] of [["admin", "admin"], ["member", "member"]]) {
    const r = await as(agent.post(`/api/workspaces/${fx.ws}/members`), "owner").send({ username: name[who], role });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }

  const up = await as(agent.post("/api/datasets"), "owner").attach("file", SALES, "customer-list-2026.csv");
  assert.equal(up.status, 201, JSON.stringify(up.body).slice(0, 200));
  fx.ds = up.body.id;
  for (const [who, role] of [["member", "viewer"], ["collab", "editor"]]) {
    const r = await as(agent.post(`/api/datasets/${fx.ds}/share`), "owner").send({ username: name[who], role });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
});

after(async () => { await closeApp(); });

describe("workspace member list", () => {
  for (const who of ["owner", "admin", "member"]) {
    test(`${who}: sees their own email and nobody else's`, async () => {
      const res = await as(agent.get(`/api/workspaces/${fx.ws}`), who);
      assert.equal(res.status, 200);
      assert.equal(res.body.members.length, 3);
      for (const m of res.body.members) {
        if (m.username === name[who]) assert.equal(m.email, email[who], "own email missing");
        else assert.ok(!m.email, `${who} can see ${m.username}'s email`);
        assert.ok(m.username, "members are still listed by username");
      }
      assert.deepEqual(othersEmails(res.body, who), []);
    });
  }

  test("someone outside the workspace still gets nothing", async () => {
    const res = await as(agent.get(`/api/workspaces/${fx.ws}`), "collab");
    assert.equal(res.status, 403);
    assert.deepEqual(othersEmails(res.body, "collab"), []);
  });
});

describe("dataset collaborator list", () => {
  for (const who of ["owner", "member", "collab"]) {
    test(`${who}: sees collaborators by username, with no email at all`, async () => {
      const res = await as(agent.get(`/api/datasets/${fx.ds}/collaborators`), who);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.map(c => c.username).sort(), [name.collab, name.member].sort());
      for (const c of res.body) assert.ok(!("email" in c), "collaborator row carries an email field");
      assert.ok(!JSON.stringify(res.body).includes("@example.test"), "an email leaked into the collaborator list");
    });
  }
});

describe("stored object keys", () => {
  test("a saved file's key holds no part of its original filename", async () => {
    const [v] = await query(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1`, [fx.ds]);
    assert.match(v.storage_key, /^datasets\/[^/]+\/1\.csv$/);
    assert.ok(!/customer/.test(v.storage_key), `filename in key: ${v.storage_key}`);
  });
});

/**
 * clickwrap.test.js — v21.30: agreeing to the Terms of Service and the
 * Privacy Notice, through the REAL app.
 *
 *   • Sign-up needs both boxes — acceptTerms and ageConfirmed, each JSON true
 *     or "true" — else 400 TERMS_REQUIRED and no account.
 *   • The account records LEGAL_VERSION, the time and the IP it was accepted from.
 *   • Register, login and /api/auth/me report legal: { accepted, current };
 *     an account from before this release reports accepted: null.
 *   • POST /api/auth/accept-terms takes only the current version and records it.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { query } from "./db/pool.js";
import { LEGAL_VERSION } from "./services/legal.js";

const PASSWORD = "Test1234!";
const u = Date.now().toString(36);
let agent;
let seq = 0;
const fresh = () => `cw_${u}_${++seq}`;
const userRow = async (username) => (await query(`SELECT * FROM users WHERE username=$1`, [username]))[0];
const register = (body) => agent.post("/api/auth/register").set("X-Forwarded-For", "203.0.113.20").send(body);

before(async () => { agent = request(await buildApp()); });
after(async () => { await closeApp(); });

describe("sign-up click-wrap", () => {
  test("without both boxes: 400 TERMS_REQUIRED and no account", async () => {
    for (const boxes of [{}, { acceptTerms: true }, { ageConfirmed: true }, { acceptTerms: false, ageConfirmed: true },
                         { acceptTerms: "yes", ageConfirmed: "1" }, { acceptTerms: 1, ageConfirmed: 1 }, { acceptTerms: "on", ageConfirmed: "on" }]) {
      const username = fresh();
      const res = await register({ username, password: PASSWORD, ...boxes });
      assert.equal(res.status, 400, JSON.stringify(boxes));
      assert.equal(res.body.code, "TERMS_REQUIRED", JSON.stringify(boxes));
      assert.equal(res.body.accessToken, undefined);
      assert.equal(await userRow(username), undefined, `no account for ${JSON.stringify(boxes)}`);
    }
  });

  test("with both boxes: the account records the version, the time and the IP", async () => {
    const username = fresh();
    const t0 = new Date().toISOString();
    const res = await register({ username, password: PASSWORD, ...TERMS });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.legal, { accepted: LEGAL_VERSION, current: LEGAL_VERSION });
    const row = await userRow(username);
    assert.equal(row.terms_version, LEGAL_VERSION);
    assert.ok(row.terms_accepted_at >= t0 && row.terms_accepted_at <= new Date().toISOString());
    assert.equal(row.terms_accepted_ip, "203.0.113.20");
  });

  test('the string "true" counts as ticked (form-encoded clients)', async () => {
    const username = fresh();
    const res = await register({ username, password: PASSWORD, acceptTerms: "true", ageConfirmed: "true" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await userRow(username)).terms_version, LEGAL_VERSION);
  });
});

describe("the legal block", () => {
  let token, legacyToken, legacyName;

  before(async () => {
    const username = fresh();
    token = (await register({ username, password: PASSWORD, ...TERMS })).body.accessToken;
    // An account from before click-wrap existed: no terms columns set.
    legacyName = fresh();
    await query(`INSERT INTO users (id,username,password_hash,created_at) VALUES ($1,$2,$3,$4)`,
      [randomUUID(), legacyName, await bcrypt.hash(PASSWORD, 4), new Date().toISOString()]);
  });

  test("/api/auth/me reports the accepted and the current version, and no raw terms columns", async () => {
    const res = await agent.get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.legal, { accepted: LEGAL_VERSION, current: LEGAL_VERSION });
    for (const k of ["terms_version", "terms_accepted_at", "terms_accepted_ip"]) assert.equal(k in res.body, false, k);
  });

  test("an account from before this release: login and /me report accepted null", async () => {
    const res = await agent.post("/api/auth/login").send({ username: legacyName, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.legal, { accepted: null, current: LEGAL_VERSION });
    legacyToken = res.body.accessToken;
    const me = await agent.get("/api/auth/me").set("Authorization", `Bearer ${legacyToken}`);
    assert.deepEqual(me.body.legal, { accepted: null, current: LEGAL_VERSION });
  });

  test("accept-terms needs a session and exactly the current version", async () => {
    assert.equal((await agent.post("/api/auth/accept-terms").send({ version: LEGAL_VERSION })).status, 401);
    for (const body of [{}, { version: "2020-01-01" }, { version: null }, { version: [LEGAL_VERSION] }]) {
      const res = await agent.post("/api/auth/accept-terms").set("Authorization", `Bearer ${legacyToken}`).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, "TERMS_REQUIRED");
      assert.equal(res.body.current, LEGAL_VERSION);
    }
    assert.equal((await userRow(legacyName)).terms_version, null);
  });

  test("accepting records the version, time and IP, and /me reflects it at once", async () => {
    const res = await agent.post("/api/auth/accept-terms").set("Authorization", `Bearer ${legacyToken}`)
      .set("X-Forwarded-For", "198.51.100.4").send({ version: LEGAL_VERSION });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.legal, { accepted: LEGAL_VERSION, current: LEGAL_VERSION });
    const row = await userRow(legacyName);
    assert.equal(row.terms_version, LEGAL_VERSION);
    assert.ok(row.terms_accepted_at);
    assert.equal(row.terms_accepted_ip, "198.51.100.4");
    // /me was cached by the previous test; accepting must not leave it stale.
    const me = await agent.get("/api/auth/me").set("Authorization", `Bearer ${legacyToken}`);
    assert.deepEqual(me.body.legal, { accepted: LEGAL_VERSION, current: LEGAL_VERSION });
    const login = await agent.post("/api/auth/login").send({ username: legacyName, password: PASSWORD });
    assert.deepEqual(login.body.legal, { accepted: LEGAL_VERSION, current: LEGAL_VERSION });
  });
});

/**
 * privacyRequests.test.js — v21.30: the pieces of the account-rights work
 * that need no database. The routes and the erasure itself run against a
 * real one in accountRights.test.js.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { subjectHash, logPrivacyRequest, completePrivacyRequest, REQUEST_TYPES, REQUEST_CHANNELS } from "./services/privacyRequests.js";
import { exportFileName } from "./db/accountData.js";
import { signAccess, requireAuth, optionalAuth, markErased, clearErased } from "./auth.js";

describe("privacy-request log", () => {
  test("the subject is a one-way sha256 hex, never the id itself", () => {
    assert.equal(subjectHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.match(subjectHash("6f1c-user-id"), /^[0-9a-f]{64}$/);
    assert.equal(subjectHash(42), subjectHash("42"));
  });

  test("the types and channels are the fixed lists", () => {
    assert.deepEqual([...REQUEST_TYPES], ["export", "delete", "access", "rectify", "object", "other"]);
    assert.deepEqual([...REQUEST_CHANNELS], ["self-service", "email", "post"]);
  });

  test("an unknown type, channel or status, or no subject, is refused before anything is written", async () => {
    const ok = { subject: "u1", type: "export", channel: "email" };
    for (const bad of [{ type: "erase" }, { channel: "phone" }, { status: "done" }, { subject: "" }, { subject: null }]) {
      await assert.rejects(logPrivacyRequest({ ...ok, ...bad }), TypeError, JSON.stringify(bad));
    }
    await assert.rejects(completePrivacyRequest("x", { status: "received" }), TypeError, "closing means completed or refused");
  });
});

describe("export file name", () => {
  const day = new Date("2026-10-10T23:59:00Z");

  test("dab-export-<username>-<yyyy-mm-dd>.json", () => {
    assert.equal(exportFileName("alice", day), "dab-export-alice-2026-10-10.json");
  });

  test("keeps Thai, flattens anything that could break a header or a path", () => {
    assert.equal(exportFileName("ครูสมศรี", day), "dab-export-ครูสมศรี-2026-10-10.json");
    assert.equal(exportFileName('../a "b"\r\nc', day), "dab-export-.._a_b_c-2026-10-10.json");
  });
});

describe("an erased account's open token", () => {
  const run = (mw, token) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const out = { status: 200, next: false };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    mw(req, res, () => { out.next = true; });
    return { ...out, user: req.user };
  };

  test("is refused by requireAuth and ignored by optionalAuth until cleared", () => {
    const token = signAccess({ userId: "erase-me", username: "x" });
    assert.equal(run(requireAuth, token).next, true);
    markErased("erase-me");
    assert.equal(run(requireAuth, token).status, 401);
    const optional = run(optionalAuth, token);
    assert.equal(optional.next, true);
    assert.equal(optional.user, undefined, "treated as signed out");
    clearErased("erase-me");
    assert.equal(run(requireAuth, token).user.userId, "erase-me");
  });

  test("lapses once every token it could hold has expired", () => {
    const token = signAccess({ userId: "long-gone", username: "y" });
    markErased("long-gone", Date.now() - 16 * 60 * 1000);
    assert.equal(run(requireAuth, token).next, true);
  });
});

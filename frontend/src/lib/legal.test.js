/**
 * legal.test.js — v21.30: when the re-accept dialog shows, when sign-up may
 * go ahead, and how a translated sentence takes its links.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { needsAcceptance, consentGiven, fillSlots, fetchLegal, gateActive, legalRetryMs, gateShown } from "./legal.js";
import { STRINGS } from "./i18n.js";
import "./strings/auth.js";   // the click-wrap string pack (lib/i18n.js addStrings)

describe("needsAcceptance", () => {
  test("an older or never-given acceptance needs the dialog", () => {
    assert.equal(needsAcceptance({ accepted: "2026-01-01", current: "2026-10-10" }), true);
    assert.equal(needsAcceptance({ accepted: null, current: "2026-10-10" }), true);
  });
  test("the current version, or no report yet, does not", () => {
    assert.equal(needsAcceptance({ accepted: "2026-10-10", current: "2026-10-10" }), false);
    assert.equal(needsAcceptance(null), false);
    assert.equal(needsAcceptance(undefined), false);
    assert.equal(needsAcceptance({ accepted: null }), false);
  });
});

describe("consentGiven", () => {
  test("both boxes, ticked", () => {
    assert.equal(consentGiven({ acceptTerms: true, ageConfirmed: true }), true);
  });
  test("anything less is not consent", () => {
    for (const c of [{}, null, { acceptTerms: true }, { ageConfirmed: true }, { acceptTerms: true, ageConfirmed: false },
                     { acceptTerms: "true", ageConfirmed: "true" }]) {
      assert.equal(consentGiven(c), false, JSON.stringify(c));
    }
  });
});

describe("fillSlots", () => {
  const T = { tag: "terms" }, P = { tag: "privacy" };
  test("English and Thai word order both keep their links", () => {
    assert.deepEqual(fillSlots(STRINGS["legal.agree"].en, { terms: T, privacy: P }),
      ["I agree to the ", T, " and have read the ", P]);
    assert.deepEqual(fillSlots(STRINGS["legal.agree"].th, { terms: T, privacy: P }),
      ["ฉันยอมรับ", T, "และได้อ่าน", P, "แล้ว"]);
  });
  test("every click-wrap sentence names both documents in both languages", () => {
    for (const key of ["legal.agree", "legal.updatedBody"]) {
      for (const lang of ["en", "th"]) {
        const parts = fillSlots(STRINGS[key][lang], { terms: T, privacy: P });
        assert.ok(parts.includes(T) && parts.includes(P), `${key}.${lang}`);
      }
    }
  });
  test("an unknown slot stays visible; a sentence with none is returned whole", () => {
    assert.deepEqual(fillSlots("a {nope} b", { terms: T }), ["a ", "{nope}", " b"]);
    assert.deepEqual(fillSlots("plain"), ["plain"]);
  });
});

test("the age line is the one the Privacy Notice and Terms quote", () => {
  assert.equal(STRINGS["legal.age"].en, "I am at least 18 years old, and if I am under 20 my parent or guardian agrees");
});

describe("fetchLegal", () => {
  const LEGAL = { accepted: "2026-01-01", current: "2026-10-10" };
  test("reads the legal block of GET /api/auth/me", async () => {
    const asked = [];
    const getJSON = async (path) => { asked.push(path); return { username: "a", legal: LEGAL }; };
    assert.deepEqual(await fetchLegal(getJSON), LEGAL);
    assert.deepEqual(asked, ["/api/auth/me"]);
  });
  test("null when there is no block or the request fails — never a throw", async () => {
    assert.equal(await fetchLegal(async () => ({ username: "a" })), null);
    assert.equal(await fetchLegal(async () => null), null);
    assert.equal(await fetchLegal(async () => { throw new Error("offline"); }), null);
  });
});

/* v21.30: the gate is the only control — the API does not refuse a user who
   has not re-accepted — so shortcuts and the palette consult it, and a failed
   status fetch is retried instead of leaving the gate down all session. */
describe("gateActive / legalRetryMs", () => {
  test("up only for a signed-in user whose accepted version is not the current one", () => {
    assert.equal(gateActive({ user: { username: "a" }, legal: { accepted: "2026-01-01", current: "2026-10-10" } }), true);
    assert.equal(gateActive({ user: { username: "a" }, legal: { accepted: null, current: "2026-10-10" } }), true);
    assert.equal(gateActive({ user: { username: "a" }, legal: { accepted: "2026-10-10", current: "2026-10-10" } }), false);
    assert.equal(gateActive({ user: null, legal: { accepted: null, current: "2026-10-10" } }), false);
    assert.equal(gateActive({ user: { username: "a" }, legal: null }), false, "unknown until fetched");
  });
  test("a failed fetch is retried: 5 s, doubling, capped at a minute", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 10].map(legalRetryMs), [5000, 10000, 20000, 40000, 60000, 60000]);
  });
});

describe("gateShown", () => {
  const due = { user: { username: "a" }, legal: { accepted: null, current: "2026-10-10" } };
  test("everywhere the gate is active, except /account — download and deletion stay open", () => {
    assert.equal(gateShown(due, "/"), true);
    assert.equal(gateShown(due, "/history"), true);
    assert.equal(gateShown(due, "/account"), false);
    assert.equal(gateShown({ ...due, legal: { accepted: "2026-10-10", current: "2026-10-10" } }, "/"), false);
  });
});

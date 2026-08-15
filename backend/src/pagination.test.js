/**
 * pagination.test.js — a cap that only caps one end is not a cap.
 *
 * Three routes each wrote Math.min(parseInt(limit) || 30, 100). That bounds the
 * top and leaves the bottom open, so ?limit=-1 reached SQL unchanged — and
 * SQLite reads LIMIT -1 as NO LIMIT. One request returned a user's entire list
 * regardless of the 100-row cap.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pageParams } from "./pagination.js";

describe("pageParams", () => {
  test("a negative limit cannot reach SQL", () => {
    // LIMIT -1 means unlimited in SQLite, so this was a full-table dump.
    assert.equal(pageParams({ limit: "-1" }).limit, 1);
    assert.equal(pageParams({ limit: "-999" }).limit, 1);
    assert.equal(pageParams({ limit: "0" }).limit, 1);
  });

  test("an enormous limit is capped", () => {
    assert.equal(pageParams({ limit: "999999999" }).limit, 100);
    // parseInt("1e9") is 1 — silently wrong rather than refused, so Number is
    // used instead and this now reaches the cap.
    assert.equal(pageParams({ limit: "1e9" }).limit, 100);
  });

  test("junk falls back to the default", () => {
    assert.equal(pageParams({ limit: "abc" }).limit, 30);
    assert.equal(pageParams({}).limit, 30);
    assert.equal(pageParams({ limit: "abc" }, { defaultLimit: 20 }).limit, 20);
  });

  test("a repeated query param takes the first value", () => {
    assert.equal(pageParams({ limit: ["2", "9"] }).limit, 2);
  });

  test("offset cannot go negative", () => {
    assert.equal(pageParams({ offset: "-5" }).offset, 0);
    assert.ok(Number.isSafeInteger(pageParams({ offset: "1e99" }).offset));
  });

  test("ordinary values pass through", () => {
    assert.deepEqual(pageParams({ limit: "25", offset: "50" }), { limit: 25, offset: 50 });
  });
});

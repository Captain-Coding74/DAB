/**
 * errorHandler.test.js — a client mistake must not look like a server outage.
 *
 * The handler already carried a note about a prod/test drift where multer
 * rejections surfaced as 500s. The list it grew from that fix caught size and
 * type errors but missed malformed multipart bodies: a filename containing a
 * null byte produced "Malformed part header" and a 500, so a bad request from
 * a client showed up in monitoring as DAB failing.
 *
 * The message regex was also loose enough that ANY error containing the word
 * "only" became a 400 — which would have hidden genuine server faults.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "./middleware/monitoring.js";

function capture(err) {
  let code = null;
  const res = { headersSent: false, status(c) { code = c; return this; }, json() { return this; } };
  errorHandler(err, { url: "/x", method: "POST", id: "1" }, res, () => {});
  return code;
}

describe("errorHandler logging", () => {
  test("a client mistake does not count as a server error", async () => {
    // The log fired at ERROR level with a full stack BEFORE the status was
    // computed, and incremented totalErrors — so a user picking the wrong file
    // type produced fifteen lines of multer internals and inflated the error
    // rate enough to trip an alert for a non-event.
    const mod = await import("./middleware/monitoring.js");
    let out = null;
    const res = { json: (b) => { out = b; } };
    await mod.metricsHandler({}, res);
    const before = out.totals.errors;

    for (let i = 0; i < 5; i++) capture(new Error("Only CSV/Excel files are allowed"));
    await mod.metricsHandler({}, res);
    assert.equal(out.totals.errors, before, "client rejections must not raise the error count");

    capture(new TypeError("boom"));
    await mod.metricsHandler({}, res);
    assert.equal(out.totals.errors, before + 1, "a genuine fault still counts");
  });
});

describe("errorHandler status mapping", () => {
  test("multipart failures are client errors", () => {
    assert.equal(capture(Object.assign(new Error("Malformed part header"), { name: "MulterError" })), 400);
    assert.equal(capture(Object.assign(new Error("File too large"), { name: "MulterError", code: "LIMIT_FILE_SIZE" })), 400);
    assert.equal(capture(new Error("Only CSV/Excel files are allowed")), 400);
  });

  test("genuine server faults stay 500", () => {
    assert.equal(capture(new TypeError("Cannot read properties of undefined")), 500);
    assert.equal(capture(new Error("SQLITE_BUSY: database is locked")), 500);
  });

  test("an unrelated error containing 'only' is NOT downgraded", () => {
    // The previous /only\b/ matched any message with that word, so a real
    // failure could be reported as a client error and vanish from alerting.
    assert.equal(capture(new Error("this is only a test")), 500);
  });

  test("an explicit status on the error is respected", () => {
    assert.equal(capture(Object.assign(new Error("nope"), { status: 403 })), 403);
  });
});

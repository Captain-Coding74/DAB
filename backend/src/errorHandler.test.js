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
import { errorHandler, loggableError } from "./middleware/monitoring.js";
import { logger } from "./logger.js";
import pino from "pino";
import { parse } from "csv-parse/sync";
import { DuplicateUserError } from "./db/repository.js";

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

/* v21.30: the error log holds no value from a user's file. A csv-parse error
   quoted the offending cell in its message, its stack and its `field`, and
   errorHandler logged the whole error object; a taken username went into a
   warn line; JSON.parse quotes the text it choked on. */
describe("errorHandler log lines", () => {
  function logged(err) {
    const lines = [];
    const saved = { error: logger.error, warn: logger.warn };
    logger.error = (obj) => lines.push(obj);
    logger.warn = (obj) => lines.push(obj);
    try { capture(err); } finally { Object.assign(logger, saved); }
    return JSON.stringify(lines);
  }
  const csvError = () => {
    try { parse('name,email\nNattida "Ploy" Raksatham,ploy.r@hotmail.com\n'); } catch (err) { return err; }
    throw new Error("expected csv-parse to refuse the quote");
  };

  test("an unclassified library error is logged by type, code and frames — never the cell it quoted", () => {
    const err = csvError();
    assert.match(err.message, /Nattida/, "the premise: csv-parse quotes the cell");
    const out = logged(err);
    assert.ok(!out.includes("Nattida") && !out.includes("ploy.r"), out);
    assert.match(out, /INVALID_OPENING_QUOTE/);
    assert.match(out, /at /, "the stack frames are kept for debugging");
  });

  test("JSON.parse and fs messages lose their quoted text", () => {
    let parseErr; try { JSON.parse('[x "customer_email"]'); } catch (e) { parseErr = e; }
    assert.ok(!logged(parseErr).includes("customer_email"));
    const fsErr = Object.assign(new Error("ENOENT: no such file or directory, open '/data/objects/datasets/d/1-รายชื่อ ม.3.csv'"), { code: "ENOENT" });
    assert.ok(!logged(fsErr).includes("รายชื่อ"));
    assert.equal(loggableError(fsErr).code, "ENOENT");
  });

  /* The objects above are what the handler hands the logger; pino then runs
     the `err` key through its serializer, which names an error after its
     constructor. A plain object's constructor is Object, so every 5xx line
     said "type": "Object" and the error's class was lost. */
  test("the error's type survives pino's err serializer, and nothing quoted comes back", () => {
    const line = pino.stdSerializers.err(loggableError(new TypeError("Cannot read 'roster.csv'")));
    assert.equal(line.type, "TypeError");
    assert.equal(line.message, 'Cannot read "…"');
    assert.ok(!JSON.stringify(line).includes("roster"));
    const csv = pino.stdSerializers.err(loggableError(csvError()));
    assert.equal(csv.type, "CsvError");
    assert.equal(csv.code, "INVALID_OPENING_QUOTE");
    assert.ok(!JSON.stringify(csv).includes("Nattida"));
  });

  test("a rejected request is logged by its code: a taken username is not repeated", () => {
    const out = logged(new DuplicateUserError("somchai.k"));
    assert.ok(!out.includes("somchai"), out);
    assert.match(out, /USERNAME_TAKEN/);
  });
});

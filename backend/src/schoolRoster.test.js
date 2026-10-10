/**
 * schoolRoster.test.js — v21.30: the save gate recognises a class roster by
 * EXACTLY the test that shows the class report, so the save dialog (which
 * asks whenever the analysis has a class report) and POST /api/datasets can
 * never disagree about a file.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseFileStreaming } from "./services/streaming.js";
import { computeStatsBundle } from "./services/analysisPipeline.js";
import { isClassRoster, schoolAuthority, SCHOOL_AUTHORITY_REQUIRED } from "./services/schoolRoster.js";

const SAMPLES = new URL("../sample-data/", import.meta.url);
const FILES = fs.readdirSync(SAMPLES).filter((f) => /\.(csv|xlsx)$/i.test(f));

async function load(name) {
  const buffer = fs.readFileSync(new URL(name, SAMPLES));
  return { buffer, parsed: await parseFileStreaming(buffer, name) };
}

/** A response double that records what the gate answered. */
function fakeRes() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

describe("isClassRoster", () => {
  test("the classroom sample is a roster, as CSV and as .xlsx", async () => {
    for (const name of ["classroom.csv", "classroom.xlsx"]) {
      const { buffer, parsed } = await load(name);
      assert.equal(isClassRoster(parsed, buffer, name), true, name);
    }
  });

  test("business files are not", async () => {
    for (const name of ["sales.csv", "big_sales.csv", "thai_shop.csv", "inventory.csv"]) {
      const { buffer, parsed } = await load(name);
      assert.equal(isClassRoster(parsed, buffer, name), false, name);
    }
  });

  test("agrees with the analyze response's class report on every bundled sample", async () => {
    for (const name of FILES) {
      const { buffer, parsed } = await load(name);
      const shown = !!computeStatsBundle({ ...parsed, buffer, fileName: name }).classReport;
      assert.equal(isClassRoster(parsed, buffer, name), shown, name);
    }
  });

  test("no detected student-id column: false without re-reading the file", () => {
    // A buffer that would throw if anything tried to parse it proves the cheap exit.
    const poison = { get length() { throw new Error("re-read"); } };
    assert.equal(isClassRoster({ headers: ["a"], colAnalysis: [], sensitive: [{ col: "a", kind: "name" }] }, poison, "x.csv"), false);
  });
});

describe("schoolAuthority gate", () => {
  test("a roster without the attestation is refused with SCHOOL_AUTHORITY_REQUIRED", async () => {
    const { buffer, parsed } = await load("classroom.csv");
    const res = fakeRes();
    const out = schoolAuthority({ body: {} }, res, [{ file: { buffer, originalname: "classroom.csv" }, parsed }]);
    assert.equal(out, false);
    assert.equal(res.code, 400);
    assert.equal(res.body.code, "SCHOOL_AUTHORITY_REQUIRED");
    assert.deepEqual(res.body, SCHOOL_AUTHORITY_REQUIRED);
    assert.ok(res.body.error && res.body.errorEn, "Thai and English message");
  });

  test("'1' and 'true' attest, and the time is returned for the dataset row", async () => {
    const { buffer, parsed } = await load("classroom.csv");
    for (const v of ["1", "true", "TRUE"]) {
      const res = fakeRes();
      const out = schoolAuthority({ body: { schoolAuthority: v } }, res, [{ file: { buffer, originalname: "classroom.csv" }, parsed }]);
      assert.match(out, /^\d{4}-\d{2}-\d{2}T/, v);
      assert.equal(res.code, null, "nothing answered");
    }
  });

  test("'0', 'no' and an empty value do not attest", async () => {
    const { buffer, parsed } = await load("classroom.csv");
    for (const v of ["0", "no", ""]) {
      const out = schoolAuthority({ body: { schoolAuthority: v } }, fakeRes(), [{ file: { buffer, originalname: "classroom.csv" }, parsed }]);
      assert.equal(out, false, JSON.stringify(v));
    }
  });

  test("not a roster: null, whatever the form says", async () => {
    const { buffer, parsed } = await load("sales.csv");
    const res = fakeRes();
    assert.equal(schoolAuthority({ body: {} }, res, [{ file: { buffer, originalname: "sales.csv" }, parsed }]), null);
    assert.equal(res.code, null);
  });

  test("one roster among several files is enough to require it", async () => {
    const a = await load("sales.csv"), b = await load("classroom.csv");
    const out = schoolAuthority({ body: {} }, fakeRes(), [
      { file: { buffer: a.buffer, originalname: "sales.csv" }, parsed: a.parsed },
      { file: { buffer: b.buffer, originalname: "classroom.csv" }, parsed: b.parsed },
    ]);
    assert.equal(out, false);
  });
});

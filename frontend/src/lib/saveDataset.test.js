/**
 * saveDataset.test.js — v21.30: the original file is stored only on an
 * explicit save, and a class roster carries the school attestation.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveStatus, needsSchoolAttestation, saveForm, saveDataset, analyzeForm } from "./saveDataset.js";

const file = new File(["a,b\n1,2\n"], "scores.csv", { type: "text/csv" });

describe("saveStatus", () => {
  test("nothing to offer before there is a result", () => {
    assert.equal(saveStatus({ signedIn: true, file, analysis: null }), "none");
  });
  test("ready only when signed in, with the file in memory, and not saved yet", () => {
    assert.equal(saveStatus({ signedIn: true, file, analysis: { savedId: "a1" } }), "ready");
  });
  test("signed out → the sign-in hint, never a save", () => {
    assert.equal(saveStatus({ signedIn: false, file, analysis: {} }), "signed-out");
  });
  test("a demo sample has no file to save", () => {
    assert.equal(saveStatus({ signedIn: true, file: null, analysis: {} }), "no-file");
  });
  test("already saved", () => {
    assert.equal(saveStatus({ signedIn: true, file, analysis: { datasetId: "d1" } }), "saved");
  });
});

describe("needsSchoolAttestation", () => {
  test("follows the class report", () => {
    assert.equal(needsSchoolAttestation({ classReport: { students: [] } }), true);
    assert.equal(needsSchoolAttestation({ classReport: null }), false);
    assert.equal(needsSchoolAttestation(null), false);
  });
});

describe("saveForm / saveDataset", () => {
  test("the form carries the file, and the attestation only when given", () => {
    assert.equal(saveForm(file).get("schoolAuthority"), null);
    assert.equal(saveForm(file, { schoolAuthority: true }).get("schoolAuthority"), "1");
    assert.equal(saveForm(file).get("file").name, "scores.csv");
  });

  test("the save names the analysis on screen and repeats a Statistics-only choice", () => {
    const plain = saveForm(file);
    assert.equal(plain.get("analysisId"), null);
    assert.equal(plain.get("noAi"), null);
    const linked = saveForm(file, { analysisId: "a7", noAi: true });
    assert.equal(linked.get("analysisId"), "a7");
    assert.equal(linked.get("noAi"), "1");
    assert.equal(saveForm(file, { analysisId: "a7", noAi: false }).get("noAi"), null);
  });

  test("posts to /api/datasets and returns the new id", async () => {
    const calls = [];
    const fetcher = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: "d42" }) }; };
    assert.deepEqual(await saveDataset(file, {}, fetcher), { ok: true, id: "d42", aiEnabled: true });
    assert.equal(calls[0].url, "/api/datasets");
    assert.equal(calls[0].opts.method, "POST");
    assert.ok(calls[0].opts.body instanceof FormData);
  });

  test("a dataset saved with AI off says so", async () => {
    const fetcher = async () => ({ ok: true, status: 201, json: async () => ({ id: "d9", aiEnabled: false }) });
    assert.deepEqual(await saveDataset(file, { noAi: true }, fetcher), { ok: true, id: "d9", aiEnabled: false });
  });

  test("SCHOOL_AUTHORITY_REQUIRED comes back as a code, not a throw", async () => {
    const fetcher = async () => ({ ok: false, status: 400, json: async () => ({ error: "th", errorEn: "en", code: "SCHOOL_AUTHORITY_REQUIRED" }) });
    assert.deepEqual(await saveDataset(file, {}, fetcher), { ok: false, code: "SCHOOL_AUTHORITY_REQUIRED", error: "th", errorEn: "en" });
  });

  test("analyze no longer stores the file on its own", () => {
    // The silent second POST lived in the analyze callback. The hook may
    // still mention the endpoint in a comment, but only saveDataset() calls it.
    const hook = readFileSync(new URL("../hooks/useAnalysis.js", import.meta.url), "utf8");
    assert.ok(!/apiFetch\(\s*["'`]\/api\/datasets["'`]/.test(hook), "useAnalysis must not POST /api/datasets itself");
  });
});

/* v21.30: analysing again after "Save dataset" names that dataset, so the
   server applies its AI switch and links the new analysis to it. */
describe("analyzeForm", () => {
  const file = new File(["a,b\n1,2\n"], "sales.csv");
  test("a fresh upload sends the file and the question only", () => {
    const fd = analyzeForm(file, "q");
    assert.equal(fd.get("question"), "q");
    assert.equal(fd.get("file").name, "sales.csv");
    assert.equal(fd.has("datasetId"), false);
    assert.equal(fd.has("noAi"), false);
  });
  test("after Save it carries the dataset id, and Statistics only as before", () => {
    const fd = analyzeForm(file, "", { datasetId: "ds-1", noAi: true });
    assert.equal(fd.get("datasetId"), "ds-1");
    assert.equal(fd.get("noAi"), "1");
  });
});

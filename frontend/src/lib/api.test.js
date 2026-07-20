/**
 * api.test.js — the centralized fetch wrapper, verified with an injected
 * fake store + stubbed global.fetch. No network, no DOM, no zustand.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, getJSON, postJSON, configureApi } from "./api.js";

let calls, state;
beforeEach(() => {
  calls = [];
  state = {
    accessToken: "tok",
    refreshTokens: async () => { state.accessToken = "tok2"; return true; },
    logout: () => { state.loggedOut = true; },
  };
  configureApi({ getState: () => state });
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return calls._next(url, opts); };
});
afterEach(() => { delete globalThis.fetch; });

describe("apiFetch", () => {
  test("attaches bearer token + JSON content-type", async () => {
    calls._next = () => ({ status: 200, ok: true });
    await apiFetch("/x");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer tok");
    assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
  });

  test("no Authorization header when logged out", async () => {
    state.accessToken = null;
    calls._next = () => ({ status: 200, ok: true });
    await apiFetch("/x");
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  });

  test("on 401 refreshes once and retries with the new token", async () => {
    let n = 0;
    calls._next = () => (n++ === 0 ? { status: 401, ok: false } : { status: 200, ok: true });
    const res = await apiFetch("/x");
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].opts.headers.Authorization, "Bearer tok2");
  });

  test("on 401 with failed refresh, logs out and throws", async () => {
    state.refreshTokens = async () => false;
    calls._next = () => ({ status: 401, ok: false });
    await assert.rejects(() => apiFetch("/x"), /Session expired/);
    assert.equal(state.loggedOut, true);
  });

  test("postJSON throws the server error message on non-2xx", async () => {
    calls._next = () => ({ status: 400, ok: false, json: async () => ({ error: "bad input" }) });
    await assert.rejects(() => postJSON("/x", { a: 1 }), /bad input/);
  });

  test("FormData body: does NOT force application/json (v14 upload bug)", async () => {
    calls._next = () => ({ status: 200, ok: true });
    const fd = new FormData();
    fd.append("file", new Blob(["a,b\n1,2"], { type: "text/csv" }), "x.csv");
    await apiFetch("/api/analyze", { method: "POST", body: fd });
    // The browser must set multipart/form-data with its boundary itself.
    assert.equal(calls[0].opts.headers["Content-Type"], undefined,
      "must not send application/json for a multipart upload");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer tok", "auth still attached");
  });

  test("JSON body still gets application/json", async () => {
    calls._next = () => ({ status: 200, ok: true });
    await apiFetch("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
  });

  test("getJSON returns parsed body on success", async () => {
    calls._next = () => ({ status: 200, ok: true, json: async () => ({ hello: "world" }) });
    assert.deepEqual(await getJSON("/x"), { hello: "world" });
  });
});

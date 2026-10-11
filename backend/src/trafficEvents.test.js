/**
 * trafficEvents.test.js — v21.30: which requests the traffic log records
 * (services/trafficLog.js), and that the share-view path never yields its
 * token as a reference. The rows themselves are tested against the real app
 * in trafficLog.test.js.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { trafficEventFor } from "./services/trafficLog.js";

const ID = "7d3c1b9e-4f2a-4c55-9a7e-0b1d2c3e4f50";

describe("trafficEventFor", () => {
  test("each listed event, with the ref the URL carries", () => {
    const cases = [
      ["POST", "/api/auth/register", "register", null],
      ["POST", "/api/auth/login", "login", null],
      ["POST", "/api/auth/logout", "logout", null],
      ["POST", "/api/auth/logout-all", "logout_all", null],
      ["POST", "/api/analyze", "analyze", null],
      ["POST", `/api/datasets/${ID}/analyze`, "analyze", ID],
      ["POST", "/api/datasets", "dataset_upload", null],
      ["POST", "/api/datasets/multi", "dataset_upload", null],
      ["POST", `/api/datasets/${ID}/versions`, "dataset_upload", ID],
      ["POST", "/api/export/pdf", "export", "pdf"],
      ["POST", "/api/export/excel", "export", "excel"],
      ["POST", `/api/analyses/${ID}/share`, "share_create", null],
      ["GET", "/api/public/share/abcDEF123_-xyz", "share_view", null],
      ["GET", "/api/auth/me/export", "data_export", null],
      ["DELETE", "/api/auth/me", "account_delete", null],
    ];
    for (const [method, url, event, ref] of cases) {
      assert.deepEqual(trafficEventFor(method, url), { event, ref }, `${method} ${url}`);
    }
  });

  test("the share-view token is never the ref, whatever the URL looks like", () => {
    for (const url of ["/api/public/share/SECRET-TOKEN", "/api/public/share/SECRET-TOKEN/", "/api/public/share/SECRET-TOKEN?x=1"]) {
      const hit = trafficEventFor("GET", url);
      assert.equal(hit.event, "share_view", url);
      assert.equal(hit.ref, null, url);
    }
    assert.equal(trafficEventFor("HEAD", "/api/public/share/SECRET-TOKEN").event, "share_view");
  });

  test("the query string is ignored; a trailing slash and letter case match as Express routes them", () => {
    assert.equal(trafficEventFor("POST", "/api/analyze?lang=th").event, "analyze");
    assert.equal(trafficEventFor("POST", "/api/analyze/").event, "analyze");
    assert.equal(trafficEventFor("POST", "/API/Auth/Login").event, "login");
  });

  test("anything else records nothing", () => {
    for (const [method, url] of [
      ["GET", "/api/analyze"], ["GET", "/api/auth/me"], ["POST", "/api/auth/refresh"], ["GET", "/api/datasets"],
      ["POST", "/api/datasets/trash/empty"], ["PATCH", `/api/datasets/${ID}/rename`], ["GET", "/api/shares"],
      ["DELETE", `/api/shares/${ID}`], ["POST", "/api/auth/accept-terms"], ["GET", "/share/abc"], ["POST", "/api/analyzer"],
      ["DELETE", "/api/auth/me/export"], ["POST", `/api/datasets/${ID}/versions/${ID}/restore`],
    ]) {
      assert.equal(trafficEventFor(method, url), null, `${method} ${url}`);
    }
  });
});

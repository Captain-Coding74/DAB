/**
 * logRedaction.test.js — v21.30: a share token in a request log line is
 * access to the report, so request URLs are logged with tokens redacted.
 * (shares.test.js drives the same logger through the real app.)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import express from "express";
import request from "supertest";
import { redactUrl, createHttpLogger } from "./logger.js";

const TOKEN = "q2Vb7mN_x9LkA3pT0zYw-4RfHc8uJdEs";

describe("redactUrl", () => {
  test("the public share API path", () => {
    assert.equal(redactUrl(`/api/public/share/${TOKEN}`), "/api/public/share/[redacted]");
  });

  test("the /share page, with or without a trailing part or query", () => {
    assert.equal(redactUrl(`/share/${TOKEN}`), "/share/[redacted]");
    assert.equal(redactUrl(`/share/${TOKEN}/`), "/share/[redacted]/");
    assert.equal(redactUrl(`/share/${TOKEN}?utm=x`), "/share/[redacted]?utm=x");
  });

  test("case does not matter — Express routes match case-insensitively", () => {
    assert.equal(redactUrl(`/API/Public/Share/${TOKEN}`), "/API/Public/Share/[redacted]");
  });

  test("any …token= query value", () => {
    assert.equal(redactUrl(`/x?token=${TOKEN}&a=1`), "/x?token=[redacted]&a=1");
    assert.equal(redactUrl(`/x?a=1&access_token=${TOKEN}`), "/x?a=1&access_token=[redacted]");
    assert.equal(redactUrl(`/x?a=1&shareToken=${TOKEN}#f`), "/x?a=1&shareToken=[redacted]#f");
  });

  test("leaves owner-only routes and ordinary URLs alone", () => {
    assert.equal(redactUrl("/api/datasets/abc-123/share"), "/api/datasets/abc-123/share");
    assert.equal(redactUrl("/api/analyses/abc-123/share"), "/api/analyses/abc-123/share");
    assert.equal(redactUrl("/api/history?page=2"), "/api/history?page=2");
    assert.equal(redactUrl(undefined), undefined);
  });
});

describe("createHttpLogger", () => {
  test("neither the url field nor the message carries the token", async () => {
    const lines = [];
    const sink = new Writable({ write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); } });
    const app = express();
    app.use(createHttpLogger(pino({ level: "info" }, sink)));
    app.get("/api/public/share/:token", (_req, res) => res.status(404).json({ error: "nope" }));
    app.get("/share/:token", (_req, res) => res.send("ok"));

    await request(app).get(`/api/public/share/${TOKEN}?token=${TOKEN}`);
    await request(app).get(`/share/${TOKEN}`);

    const out = lines.join("");
    assert.equal(lines.length, 2, out);
    assert.ok(!out.includes(TOKEN), `token leaked into the log:\n${out}`);
    const [api, page] = lines.map((l) => JSON.parse(l));
    assert.equal(api.req.url, "/api/public/share/[redacted]?token=[redacted]");
    assert.match(api.msg, /GET \/api\/public\/share\/\[redacted\]/);
    assert.equal(page.req.url, "/share/[redacted]");
    assert.equal(page.msg, "GET /share/[redacted] → 200");
  });
});

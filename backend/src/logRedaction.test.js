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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

  test("the dataset search box — it holds what the user typed, often a file name", () => {
    assert.equal(redactUrl("/api/datasets?search=roster%20m3&view=mine"), "/api/datasets?search=[redacted]&view=mine");
    assert.equal(redactUrl("/api/datasets?view=mine&q=payroll"), "/api/datasets?view=mine&q=[redacted]");
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

/* v21.30: service logs carry no file name, column name or cell value. */
describe("service logs", () => {
  const SRC = fileURLToPath(new URL(".", import.meta.url));

  test("parsing an upload logs its shape, never its name, columns or values", () => {
    // A child process, so the parser's own logger runs at debug level and
    // writes every field to stdout (pretty-printed outside production).
    const script = `
      const { parseFileStreaming } = await import(${JSON.stringify(new URL("./services/streaming.js", import.meta.url).href)});
      await parseFileStreaming(Buffer.from("student_secret_col,score\\nSomchaiSecretValue,10\\nMaliSecretValue,20\\n"), "class_roster_privatename.csv");`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, LOG_LEVEL: "debug", NODE_ENV: "test" }, encoding: "utf8",
    });
    assert.match(out, /File parsed/, "the parser did log");
    for (const secret of ["class_roster_privatename", "student_secret_col", "SomchaiSecretValue", "MaliSecretValue"]) {
      assert.equal(out.includes(secret), false, `${secret} reached the log:\n${out}`);
    }
    assert.match(out, /ext\W+csv/, "the extension is what identifies the format");
  });

  test("no logger call in backend/src passes a file name, column name, email or recipient", () => {
    const files = [];
    const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : /\.m?js$/.test(e) && !/\.test\./.test(e) && files.push(p); } };
    walk(SRC);
    const CALL = /\b(?:log|logger|svcLog)\.(?:trace|debug|info|warn|error|fatal)\(/g;
    const FORBIDDEN = /\b(?:originalName|originalname|fileName|file_name|file:|email|recipients?|headers|col)\b/;
    const hits = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(CALL)) {
        let i = m.index + m[0].length, depth = 1;
        while (i < text.length && depth) { depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0; i++; }
        // String literals are messages, and `x.length` is a count — neither is content.
        const args = text.slice(m.index + m[0].length, i - 1).replace(/"[^"]*"|`[^`]*`/g, '""').replace(/\b\w+\.length\b/g, "n");
        if (FORBIDDEN.test(args)) hits.push(`${relative(SRC, f)}: ${args.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    assert.deepEqual(hits, []);
  });
});

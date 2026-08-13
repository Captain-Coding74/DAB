/**
 * e2e/flows.test.mjs — v13 END-TO-END user journeys
 *
 * Unlike the integration tests (which mount an in-process app), this spawns
 * the REAL server binary, over REAL HTTP, with a REAL SQLite file, real
 * multipart uploads, and real PDF/XLSX generation. AI_MOCK=1 makes the whole
 * flow runnable without an API key.
 *
 * Journeys covered:
 *   A. Anonymous:  upload → analyze → export PDF → export Excel
 *   B. Registered: register → analyze (saved) → share w/ password →
 *                  public view (401 → 401 wrong pw → 200) → history → delete
 *   C. Intelligence: chat → deep-dive agent (tool trail asserted)
 *   D. Guard rails: bad file type rejected, rate-limit headers present
 *
 * Run: npm run test:e2e   (spawns on port 3199)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

const CSV = [
  "month,region,units,revenue",
  "2025-01,BKK,120,5880",
  "2025-02,BKK,135,6615",
  "2025-03,BKK,150,7350",
  "2025-04,CNX,52,2548",
  "2025-05,CNX,58,2842",
  "2025-06,CNX,,",            // missing → insights fire
  "2025-06,CNX,61,2989",
  "2025-06,CNX,61,2989",      // duplicate → insights fire
].join("\n");

let server, dataDir;

const uploadForm = (csv = CSV, name = "sales.csv", extra = {}) => {
  const fd = new FormData();
  fd.append("file", new Blob([csv], { type: "text/csv" }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};

const post = (path, body, token, isForm = false) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: isForm ? body : JSON.stringify(body),
  });

const get = (path, token, headers = {}) =>
  fetch(`${BASE}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "dab-e2e-"));
  server = spawn(process.execPath, [join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      AI_MOCK: "1",                       // ← full flow, no API key
      PORT: String(PORT),
      JWT_SECRET: "e2e-secret-32-chars-xxxxxxxxxxxx",
      JWT_REFRESH_SECRET: "e2e-refresh-32-chars-xxxxxxxxxx",
      SQLITE_DIR: dataDir,                // isolated DB — never touches dev data
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", d => process.env.E2E_DEBUG && console.error(String(d)));

  // Wait for readiness (max ~15s)
  for (let i = 0; i < 75; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy in time");
});

after(() => {
  server?.kill("SIGKILL");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ─────────────────────────────────────────────────────────
describe("E2E · Journey A — anonymous: upload → analyze → export", () => {
  let analysis;

  test("health reports the running version", async () => {
    const r = await get("/api/health");
    const d = await r.json();
    assert.equal(r.status, 200);
    assert.equal(d.status, "ok");
    assert.ok(d.version);
  });

  test("upload + analyze returns full stats bundle", async () => {
    const r = await post("/api/analyze", uploadForm(CSV, "sales.csv", { question: "สรุปภาพรวม" }), null, true);
    assert.equal(r.status, 200);
    analysis = await r.json();

    assert.equal(analysis.success, true);
    assert.equal(analysis.rows, 8);
    assert.equal(analysis.columns, 4);
    // v20.3 gates AI prose behind auth: anonymous callers get the full
    // deterministic bundle with analysis:null and the aiGated flag set.
    assert.equal(analysis.analysis, null, "anonymous gets no AI prose (v20.3 gating)");
    assert.equal(analysis.aiGated, true, "and is told why");
    assert.ok(Array.isArray(analysis.colAnalysis) && analysis.colAnalysis.length === 4);
    assert.ok(Array.isArray(analysis.sampleRows) && analysis.sampleRows.length > 0);
    assert.ok(analysis.quality?.score >= 0);
    assert.equal(analysis.savedId, null, "anonymous analyses are not persisted");
  });

  test("insights engine detected the seeded defects (missing + duplicate)", () => {
    const ids = analysis.insights.map(i => i.id);
    assert.ok(analysis.insights.length > 0, "insights present");
    assert.ok(ids.includes("dupes"), `expected duplicate finding, got: ${ids.join(", ")}`);
    assert.ok(ids.some(i => i.startsWith("missing:")), "expected a missing-data finding");
  });

  test("XLSX upload → analyze → export round-trips through exceljs (v15)", async () => {
    // Build a real .xlsx in memory (the format users actually upload), push
    // it through the whole pipeline, then export and re-open the result —
    // end-to-end proof the SheetJS→exceljs migration is sound on both read
    // and write, with no CVE-laden dependency anywhere in the path.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sales");
    ws.addRow(["month", "region", "units", "revenue"]);
    [["2025-01","BKK",120,5880],["2025-01","CNX",40,1960],["2025-02","BKK",135,6615],
     ["2025-02","CNX",45,2205],["2025-03","BKK",150,7350],["2025-03","CNX",60,2940]]
      .forEach(r => ws.addRow(r));
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    // upload the .xlsx
    const fd = new FormData();
    fd.append("file", new Blob([xlsxBuf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), "sales.xlsx");
    fd.append("question", "สรุป");
    const up = await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd });
    assert.equal(up.status, 200, "xlsx upload accepted");
    const parsed = await up.json();
    assert.equal(parsed.rows, 6, "all 6 data rows parsed from the workbook");
    assert.equal(parsed.columns, 4);
    const revenue = parsed.colAnalysis.find(c => c.col === "revenue");
    assert.equal(revenue.type, "numeric", "numeric column detected from xlsx");

    // export back to .xlsx and re-open it
    const exFd = new FormData();
    exFd.append("file", new Blob([xlsxBuf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), "sales.xlsx");
    exFd.append("analysis", parsed.analysis);
    const ex = await fetch(`${BASE}/api/export/excel`, { method: "POST", body: exFd });
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get("content-type"), /spreadsheetml|octet-stream/);

    const outBuf = Buffer.from(await ex.arrayBuffer());
    assert.equal(outBuf.subarray(0, 2).toString(), "PK", "xlsx is a zip container");
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(outBuf);                       // must re-open cleanly
    const names = back.worksheets.map(w => w.name);
    assert.ok(names.includes("Data") && names.includes("Statistics"),
      `exported workbook has the expected sheets: ${names.join(", ")}`);
  });

  test("export PDF returns a real PDF document", async () => {
    const r = await post("/api/export/pdf", uploadForm(CSV, "sales.csv", { analysis: analysis.analysis }), null, true);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /application\/pdf/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString(), "%PDF", "file starts with the PDF magic number");
    assert.ok(buf.length > 1000, "PDF has real content");
  });

  test("export Excel returns a real XLSX workbook", async () => {
    const r = await post("/api/export/excel", uploadForm(CSV, "sales.csv", { analysis: analysis.analysis }), null, true);
    assert.equal(r.status, 200);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), "PK", "XLSX is a zip container");
    assert.ok(buf.length > 500);
  });
});

// ─────────────────────────────────────────────────────────
describe("E2E · Journey B — registered: analyze → share → history → delete", () => {
  const user = { username: `e2e_${Date.now()}`, password: "e2e-password-123" };
  let token, savedId, shareToken;

  test("register issues tokens", async () => {
    const r = await post("/api/auth/register", user);
    assert.equal(r.status, 201);
    const d = await r.json();
    token = d.accessToken;
    assert.ok(token);
  });

  test("analyze as a logged-in user persists the report", async () => {
    const r = await post("/api/analyze", uploadForm(CSV, "sales.csv", { question: "สรุป" }), token, true);
    assert.equal(r.status, 200);
    const d = await r.json();
    savedId = d.savedId;
    assert.ok(savedId, "analysis was saved for the authenticated user");
  });

  test("share the report behind a password", async () => {
    const r = await post(`/api/analyses/${savedId}/share`, { title: "Q3 report", password: "hunter2" }, token);
    assert.equal(r.status, 201, "creating a share returns 201 Created");
    const d = await r.json();
    shareToken = d.shareUrl.split("/").pop();
    assert.ok(shareToken);
  });

  test("public view: no password → 401, wrong → 401, correct → 200", async () => {
    const noPw = await get(`/api/public/share/${shareToken}`);
    assert.equal(noPw.status, 401);
    assert.equal((await noPw.json()).passwordProtected, true);

    const wrong = await get(`/api/public/share/${shareToken}`, null, { "X-Share-Password": "nope" });
    assert.equal(wrong.status, 401);

    const right = await get(`/api/public/share/${shareToken}`, null, { "X-Share-Password": "hunter2" });
    assert.equal(right.status, 200);
    const d = await right.json();
    assert.ok(d.analysis.includes("[MOCK]"));
    assert.equal(d.title, "Q3 report");
  });
  test("a public share leaks no internal identifiers", async () => {
    // getSharedReport does SELECT sr.*, so the row carries every column of
    // shared_reports. Only password_hash was stripped, which handed the
    // owner's user_id and the internal analysis_id to anyone with the link.
    const r = await get(`/api/public/share/${shareToken}`, null, { "X-Share-Password": "hunter2" });
    assert.equal(r.status, 200);
    const body = await r.json();
    for (const leak of ["user_id", "analysis_id", "password_hash", "id"])
      assert.equal(body[leak], undefined, `public share must not expose ${leak}`);
    assert.ok(body.analysis !== undefined, "the report itself is still returned");
    assert.equal(typeof body.view_count, "number", "view_count is used by the page");
  });

  test("the report appears in history, then delete removes it", async () => {
    const list = await (await get("/api/history", token)).json();
    const items = Array.isArray(list) ? list : list.items || [];
    assert.ok(items.some(i => i.id === savedId), "saved analysis is listed in history");

    const del = await fetch(`${BASE}/api/history/${savedId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(del.status, 200);

    const after = await (await get("/api/history", token)).json();
    const afterItems = Array.isArray(after) ? after : after.items || [];
    assert.ok(!afterItems.some(i => i.id === savedId), "analysis is gone after delete");
  });
});

// ─────────────────────────────────────────────────────────
describe("E2E · Journey C — intelligence: chat + deep-dive agent", () => {
  const user = { username: `e2e_ai_${Date.now()}`, password: "e2e-password-123" };
  let token, savedId;

  test("setup: register + analyze", async () => {
    token = (await (await post("/api/auth/register", user)).json()).accessToken;
    const d = await (await post("/api/analyze", uploadForm(), token, true)).json();
    savedId = d.savedId;
    assert.ok(savedId);
  });

  test("chat about the dataset persists the exchange", async () => {
    const r = await post(`/api/analyses/${savedId}/chat`, { message: "มี outlier มั้ย" }, token);
    assert.equal(r.status, 200);
    assert.ok((await r.json()).reply.includes("[MOCK]"));

    const hist = await (await get(`/api/analyses/${savedId}/chat`, token)).json();
    assert.ok(hist.length >= 2, "user + assistant messages stored");
  });

  test("deep-dive agent runs real tool checks and returns its trail", async () => {
    const r = await post(`/api/analyses/${savedId}/agent`, { question: "คอลัมน์ไหนน่ากังวลที่สุด" }, token);
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.ok(d.reply, "agent produced an answer");
    assert.ok(Array.isArray(d.steps) && d.steps.length >= 1, "agent recorded at least one tool check");
    assert.equal(d.steps[0].tool, "list_columns");
  });

  test("agent rejects anonymous callers", async () => {
    const r = await post(`/api/analyses/${savedId}/agent`, { question: "x" });
    assert.equal(r.status, 401);
  });
});

// ─────────────────────────────────────────────────────────
describe("E2E · Journey D — guard rails", () => {
  test("non-CSV/Excel uploads are rejected", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["MZ\x90\x00"], { type: "application/octet-stream" }), "evil.exe");
    const r = await post("/api/analyze", fd, null, true);
    assert.equal(r.status, 400);
  });

  test("upload with a JSON content-type header is rejected, not misparsed (v14)", async () => {
    // The v14 bug: the client forced application/json on a multipart upload,
    // so express.json() choked on the boundary and every upload 400'd with a
    // JSON syntax error. A correct multipart request (no forced header) works;
    // this asserts the server still rejects a genuinely mislabelled body
    // cleanly rather than 500ing.
    const fd = uploadForm();
    const r = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },  // wrong on purpose
      body: fd,   // ...but the body is multipart
    });
    assert.equal(r.status, 400, "mislabelled upload is a clean 400");
    const d = await r.json();
    assert.ok(d.error, "responds with an error message, not a crash");
  });

  test("security + rate-limit headers are present on API responses", async () => {
    const r = await get("/api/health");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.ok(r.headers.get("ratelimit-policy"), "global rate limiter is mounted");
    assert.equal(r.headers.get("x-powered-by"), null);
  });

  test("metrics endpoint exposes latency percentiles per route", async () => {
    const d = await (await get("/api/metrics")).json();
    assert.ok(d.totals.requests > 0);
    assert.ok(Array.isArray(d.routes) && d.routes.length > 0);
    const analyzeRoute = d.routes.find(r => r.route.includes("/api/analyze"));
    assert.ok(analyzeRoute, "analyze route was measured");
    assert.equal(typeof analyzeRoute.p95, "number");
    assert.notEqual(d.version, "6.0.0", "metrics version is no longer stale");
  });
});

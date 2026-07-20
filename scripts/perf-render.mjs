#!/usr/bin/env node
/**
 * scripts/perf-render.mjs — v14 render-time gates (the "Playwright step")
 *
 * Boots the REAL server (serving the production build, AI_MOCK=1), drives a
 * REAL headless Chromium through the first-visit journey, and fails if what
 * the user feels regresses past the render targets in perf-budget.json:
 *
 *   lcpMs      — largest contentful paint on a cold visit
 *   analyzeMs  — click "วิเคราะห์ไฟล์" → AI report painted (measured by this
 *                harness with its own clock; not trusted from the app)
 *   apiP95Ms   — client-observed API latency p95 (from lib/perf.js, which
 *                times every request inside lib/api.js)
 *
 * Unlike the bundle/API budgets (regression ratchets calibrated per machine),
 * these are ABSOLUTE UX targets: LCP 2500ms is the Web Vitals "good"
 * threshold, and the others are product promises. A slow CI runner passing
 * generous absolute targets is meaningful; a ratchet on a noisy machine
 * would just flap.
 *
 * Browser: @sparticuz/chromium (the binary ships inside the npm tarball, so
 * no browser-CDN access is needed) driven by playwright-core. Override with
 * CHROMIUM_PATH to use a system browser instead.
 *
 * Usage: node scripts/perf-render.mjs [--json]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dirname, "..");
const DIST   = join(ROOT, "frontend", "dist");
const BUDGET = join(ROOT, "frontend", "perf-budget.json");
const PORT   = 3299;
const BASE   = `http://127.0.0.1:${PORT}`;
const RUNS   = 3;                     // median of 3 — absorbs one-off jitter

if (!existsSync(join(DIST, "index.html"))) {
  console.error("✗ frontend/dist not found — run `npm run build` first.");
  process.exit(1);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ── 1. boot the real server on the production build ────────
const dataDir = mkdtempSync(join(tmpdir(), "dab-perf-"));
const server = spawn(process.execPath, [join(ROOT, "backend", "src", "server.js")], {
  cwd: join(ROOT, "backend"),
  env: {
    ...process.env,
    NODE_ENV: "development",          // dev logger; AI_MOCK guard still applies
    AI_MOCK: "1",
    PORT: String(PORT),
    JWT_SECRET: "perf-secret-32-chars-xxxxxxxxxxxx",
    JWT_REFRESH_SECRET: "perf-refresh-32-chars-xxxxxxxxxx",
    SQLITE_DIR: dataDir,
    LOG_LEVEL: "error",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", d => process.env.PERF_DEBUG && console.error(String(d)));

async function waitHealthy() {
  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

function cleanup() {
  server?.kill("SIGKILL");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);

// ── 2. launch headless chromium ─────────────────────────────
const { chromium: pw } = await import("playwright-core");

async function launchBrowser() {
  if (process.env.CHROMIUM_PATH) {
    return pw.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  }
  const { default: sparticuz } = await import("@sparticuz/chromium");
  return pw.launch({
    executablePath: await sparticuz.executablePath(),
    args: sparticuz.args,
    headless: true,
  });
}

/**
 * One long-lived page for every sample. The lambda chromium build in some
 * sandboxes tears the whole browser down when the first context closes, so
 * we navigate the same page instead of opening fresh contexts. We clear
 * storage + the app's perf store between runs to keep samples independent.
 */
async function makePage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("dab_tour_done", "1"));
  return ctx.newPage();
}

async function coldReload(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 30_000 });
  // reset the app's in-page perf store so each sample stands alone
  await page.evaluate(() => {
    const s = window.__DAB_PERF__;
    if (s) { s.api = []; s.spans = {}; s.lcpMs = null; }
  });
}

/** Read the app's own instrumentation (lib/perf.js). */
const readPerf = (page) =>
  page.evaluate(() => {
    const s = window.__DAB_PERF__ || {};
    const times = (s.api || []).map(a => a.ms).sort((a, b) => a - b);
    const p = (q) => times.length ? times[Math.min(times.length - 1, Math.floor(times.length * q / 100))] : 0;
    return { lcpMs: s.lcpMs, spanAnalyzeMs: s.spans?.analyze?.ms ?? null, apiCount: times.length, apiP95: p(95) };
  });

await waitHealthy();
const browser = await launchBrowser();
const page = await makePage(browser);

// ── 3. sample LCP on cold visits ────────────────────────────
const lcpSamples = [];
for (let i = 0; i < RUNS; i++) {
  await page.goto(BASE, { waitUntil: "load", timeout: 30_000 });
  await page.waitForTimeout(600);              // let the buffered LCP entry land
  const { lcpMs } = await readPerf(page);
  if (typeof lcpMs === "number") lcpSamples.push(lcpMs);
}

// ── 4. sample the analyze journey: click → report painted ──
const analyzeSamples = [];
let apiP95 = 0, apiCount = 0, spanAnalyzeMs = null;
for (let i = 0; i < RUNS; i++) {
  await coldReload(page);

  await page.getByRole("button", { name: "ใช้ข้อมูลตัวอย่าง" }).click();
  await page.getByText("พร้อมตรวจ").waitFor({ timeout: 10_000 });   // file slip visible

  const t0 = performance.now();
  await page.getByRole("button", { name: "วิเคราะห์ไฟล์" }).click();
  await page.getByText("รายงานผู้ตรวจ · AI").waitFor({ timeout: 30_000 });  // report painted
  analyzeSamples.push(Math.round(performance.now() - t0));

  const perf = await readPerf(page);
  apiP95 = Math.max(apiP95, perf.apiP95);      // worst run — conservative
  apiCount += perf.apiCount;
  spanAnalyzeMs = perf.spanAnalyzeMs ?? spanAnalyzeMs;
}
await browser.close();
cleanup();

// ── 5. report + gate ────────────────────────────────────────
const actual = {
  lcpMs:     lcpSamples.length ? median(lcpSamples) : null,
  analyzeMs: median(analyzeSamples),
  apiP95Ms:  apiP95,
};

const budget = JSON.parse(readFileSync(BUDGET, "utf8")).render;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ actual, samples: { lcpSamples, analyzeSamples }, spanAnalyzeMs, apiCount, budget }, null, 2));
}

console.log("\nRender performance (real browser, production build, mock AI)\n");
console.log(`  LCP samples        ${lcpSamples.join(", ") || "(unavailable in this chromium build)"} ms`);
console.log(`  analyze samples    ${analyzeSamples.join(", ")} ms   (harness clock: click → report painted)`);
if (spanAnalyzeMs != null) console.log(`  app's own span     ${spanAnalyzeMs} ms   (lib/perf.js "analyze")`);
console.log(`  client API calls   ${apiCount} timed, worst-run p95 ${apiP95} ms\n`);

const checks = [
  ["LCP (median)",        actual.lcpMs,     budget.lcpMs],
  ["analyze (median)",    actual.analyzeMs, budget.analyzeMs],
  ["client API p95",      actual.apiP95Ms,  budget.apiP95Ms],
];

let failed = 0;
console.log("Targets (absolute UX budgets):");
for (const [label, got, limit] of checks) {
  if (got == null) { console.log(`  – ${label.padEnd(18)}   not measurable here (skipped)`); continue; }
  const ok = got <= limit;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(18)} ${String(got).padStart(6)} ms ≤ ${limit} ms`);
}

if (failed) {
  console.error(`\n✗ ${failed} render target(s) breached — users feel this. Profile before shipping.\n`);
  process.exit(1);
}
console.log("\n✓ All render targets met.\n");

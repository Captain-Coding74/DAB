/**
 * e2e/browser.test.mjs — v16: every critical user flow, in a real browser.
 *
 * The HTTP E2E suite (flows.test.mjs) proves the *server* is correct.
 * This proves the *product* is correct: a real Chromium, the real production
 * bundle, real clicks, real keyboard input. That distinction is not academic
 * — the v14 upload bug (every upload 400'd) was invisible to HTTP tests
 * because they bypassed the app's own fetch wrapper. Only a browser catches
 * that class of defect.
 *
 * Browser: @sparticuz/chromium (binary ships inside the npm tarball, so no
 * browser-CDN access is needed) driven by playwright-core. Set CHROMIUM_PATH
 * to use a system browser instead.
 *
 * Run: npm run test:browser
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");           // repo root
const DIST = join(ROOT, "frontend", "dist");
const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;

let server, browser, context, page, dataDir;

/**
 * v17 — the suite reports on itself.
 *
 * A browser suite that only says "pass/fail" wastes what it already knows.
 * We record pass rate, per-test duration, console errors, and write a
 * screenshot + a Playwright trace for every failure — then emit
 * metrics/browser.json for the quality dashboard to plot.
 *
 * Console errors are treated as first-class output, not noise. That decision
 * immediately paid for itself: it exposed that our own CSP was blocking the
 * Google Fonts stylesheet, so the app's typography never loaded in production.
 */
const ARTIFACTS = join(ROOT, "artifacts", "browser");
const METRICS_OUT = join(ROOT, "metrics", "browser.json");

const suite = {
  startedAt: 0,
  tests: [],            // { name, ok, ms, consoleErrors }
  consoleErrors: [],    // { test, text }
  screenshots: [],
  traces: [],
};
let currentTest = "(setup)";

/** Every test goes through here so nothing escapes measurement. */
function btest(name, fn) {
  test(name, async (t) => {
    currentTest = name;
    const before = suite.consoleErrors.length;
    const t0 = performance.now();
    let ok = true;
    try {
      await context?.tracing.startChunk({ title: name }).catch(() => {});
      await fn(t);
      await context?.tracing.stopChunk().catch(() => {});   // discard on success
    } catch (err) {
      ok = false;
      await captureFailure(name);
      throw err;
    } finally {
      suite.tests.push({
        name,
        ok,
        ms: Math.round(performance.now() - t0),
        consoleErrors: suite.consoleErrors.length - before,
      });
    }
  });
}

/** On failure: a screenshot you can look at and a trace you can replay. */
async function captureFailure(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  try {
    mkdirSync(ARTIFACTS, { recursive: true });
    const shot = join(ARTIFACTS, `${slug}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    suite.screenshots.push(shot);
  } catch {}
  try {
    const trace = join(ARTIFACTS, `${slug}.trace.zip`);
    await context.tracing.stopChunk({ path: trace });
    suite.traces.push(trace);
  } catch {}
}

async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  if (process.env.CHROMIUM_PATH) {
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  }
  /* Branded local browsers next. @sparticuz/chromium ships a LINUX-ONLY
     binary (built for Lambda); on Windows it resolves to Temp\chromium and
     spawn ENOENTs, which cancelled the entire suite on the machine this
     project is developed on. Chrome or Edge is already installed on
     effectively every dev machine and playwright-core knows how to find
     both, so the suite runs locally with zero downloads. */
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* not installed */ }
  }
  try {
    const { default: sparticuz } = await import("@sparticuz/chromium");
    return await chromium.launch({
      executablePath: await sparticuz.executablePath(),
      args: sparticuz.args,
      headless: true,
    });
  } catch (err) {
    throw new Error(
      "No launchable browser found. Install Google Chrome or Microsoft Edge, " +
      "or set CHROMIUM_PATH to a Chromium executable. " +
      "(@sparticuz/chromium only works on Linux.) Last error: " + (err && err.message));
  }
}

before(async () => {
  assert.ok(existsSync(join(DIST, "index.html")),
    "frontend/dist missing — run `npm run build` before the browser suite");

  dataDir = mkdtempSync(join(tmpdir(), "dab-browser-"));
  server = spawn(process.execPath, [join(ROOT, "backend", "src", "server.js")], {
    cwd: join(ROOT, "backend"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      AI_MOCK: "1",                       // no API key needed; refused in production
      PORT: String(PORT),
      JWT_SECRET: "browser-secret-32-chars-xxxxxxxx",
      JWT_REFRESH_SECRET: "browser-refresh-32-chars-xxxxx",
      SQLITE_DIR: dataDir,
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  suite.startedAt = performance.now();
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // Tracing runs for the whole suite; each test opens a chunk, and only the
  // chunks belonging to failures are written to disk.
  try { await context.tracing.start({ screenshots: true, snapshots: true }); }
  catch { /* tracing unsupported in this build — metrics simply report 0 */ }

  page = await context.newPage();

  // Client-side errors are recorded, not swallowed — and not thrown, so one
  // noisy page can't abort the suite before we've measured it.
  page.on("console", m => {
    if (m.type() === "error") suite.consoleErrors.push({ test: currentTest, text: m.text().slice(0, 200) });
  });
  page.on("pageerror", e => {
    suite.consoleErrors.push({ test: currentTest, text: `uncaught: ${e.message}`.slice(0, 200) });
  });
});

after(async () => {
  const suiteMs = Math.round(performance.now() - suite.startedAt);
  const passed  = suite.tests.filter(t => t.ok).length;
  const total   = suite.tests.length;
  const slowest = [...suite.tests].sort((a, b) => b.ms - a.ms)[0] || null;

  const report = {
    ts: new Date().toISOString(),
    total,
    passed,
    failed: total - passed,
    passRate: total ? +((passed / total) * 100).toFixed(1) : 0,
    suiteMs,
    avgTestMs: total ? Math.round(suite.tests.reduce((n, t) => n + t.ms, 0) / total) : 0,
    slowest: slowest ? { name: slowest.name, ms: slowest.ms } : null,
    consoleErrors: suite.consoleErrors.length,
    consoleErrorSamples: suite.consoleErrors.slice(0, 5),
    screenshots: suite.screenshots.length,
    traces: suite.traces.length,
  };

  try {
    mkdirSync(join(ROOT, "metrics"), { recursive: true });
    writeFileSync(METRICS_OUT, JSON.stringify(report, null, 2) + "\n");
  } catch {}

  console.log(`\n# browser: ${passed}/${total} passed (${report.passRate}%) · suite ${suiteMs}ms · ` +
              `avg ${report.avgTestMs}ms · slowest "${slowest?.name ?? "—"}" ${slowest?.ms ?? 0}ms · ` +
              `console errors ${report.consoleErrors} · screenshots ${report.screenshots} · traces ${report.traces}`);
  if (report.consoleErrors) {
    for (const e of report.consoleErrorSamples) console.log(`#   console error [${e.test}]: ${e.text}`);
  }

  try { await context?.tracing.stop(); } catch {}
  await browser?.close();
  server?.kill("SIGKILL");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

/** Fresh visit. `firstRun` keeps the onboarding tour enabled. */
async function visit({ firstRun = false } = {}) {
  await page.goto(BASE, { waitUntil: "load" });
  if (!firstRun) {
    await page.evaluate(() => localStorage.setItem("dab_tour_done", "1"));
    await page.reload({ waitUntil: "load" });
  }
  // Wait until React has mounted and attached its listeners. Firing keyboard
  // input before this races the app and produces flaky, meaningless failures.
  // v20.1+: the empty state is the demo-card grid, fetched from /api/demo/samples.
  await page.getByRole("button", { name: /ยอดขายร้านโชห่วย/ }).waitFor({ timeout: 15_000 });
}

/** The demo-tap journey (v20.1 "first 10 seconds") — the flagship flow. */
async function analyzeSample() {
  await page.getByRole("button", { name: /ยอดขายร้านโชห่วย/ }).click();
  // A demo tap lands on the insights tab with the readout strip powered on.
  await page.getByText("บันทึกข้างเล่ม · Insights").waitFor({ timeout: 15_000 });
}

describe("Critical flow: first-run onboarding", () => {
  btest("a new visitor sees the tour and can dismiss it", async () => {
    await page.goto(BASE, { waitUntil: "load" });
    await page.evaluate(() => localStorage.removeItem("dab_tour_done"));
    await page.reload({ waitUntil: "load" });

    const dialog = page.locator("[role=dialog]").first();
    await dialog.waitFor({ timeout: 10_000 });

    // v16 regression guard: the tour used to skip straight to step 2, so the
    // step explaining how to upload a file was never shown to anyone.
    const text = await dialog.innerText();
    assert.match(text, /1 \/ 4/, `tour must start at step 1, got: ${text.slice(0, 40)}`);
    assert.match(text, /วางไฟล์ของคุณ/, "step 1 explains the upload");

    await page.getByRole("button", { name: "ข้าม" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });

    // Dismissal must persist — nobody wants the tour on every reload.
    await page.reload({ waitUntil: "load" });
    assert.equal(await page.getByText("1 · วางไฟล์ของคุณ").count(), 0, "tour stays dismissed");
  });

  btest("the empty state invites the user to start", async () => {
    await visit();
    assert.ok(await page.getByText("เห็นผลตรวจจริงใน 10 วินาทีแรก").isVisible());
  });
});

describe("Critical flow: upload → analyze → read the report", () => {
  btest("a demo tap paints instant insights and the honest AI pitch", async () => {
    await visit();
    await analyzeSample();

    // The readout strip must show real numbers, not placeholders.
    const rows = await page.locator("text=Rows").first().isVisible();
    assert.ok(rows, "row readout rendered");

    // v20.1/20.3: the AI slot on the demo path is the conversion pitch,
    // under the same "รายงานผู้ตรวจ · AI" plate.
    await page.getByRole("tab", { name: "analysis" }).click();
    await page.getByText("รายงานผู้ตรวจ · AI").waitFor({ timeout: 10_000 });
    assert.ok(await page.getByText(/Insights Engine/).first().isVisible(), "demo pitch replaces AI text");
  });

  btest("insights tab shows deterministic findings", async () => {
    await page.getByRole("tab", { name: "insights" }).click();
    await page.getByText("บันทึกข้างเล่ม · Insights").waitFor({ timeout: 10_000 });
    // thai_shop.csv guarantees the v20 messy-layer finding: a Buddhist-Era
    // date column, detected and converted.
    assert.ok(await page.getByText(/เป็นคอลัมน์วันที่/).first().isVisible(), "daterange finding present");
  });

  btest("charts tab lazy-loads recharts and renders an SVG", async () => {
    await page.getByRole("tab", { name: "charts" }).click();
    // recharts is a lazily-fetched chunk (v13 perf work) — the chart must
    // still appear, which proves the Suspense boundary resolves.
    await page.locator("svg.recharts-surface").first().waitFor({ timeout: 15_000 });
    assert.ok(await page.locator("svg.recharts-surface").first().isVisible(), "chart rendered");
  });

  btest("quality tab shows a grade", async () => {
    await page.getByRole("tab", { name: "quality" }).click();
    await page.getByText(/GRADE [A-F]/).first().waitFor({ timeout: 10_000 });
    assert.ok(await page.getByText(/GRADE [A-F]/).first().isVisible());
  });
});

describe("Critical flow: keyboard + command palette", () => {
  btest("Ctrl+K opens the palette and it filters commands", async () => {
    await visit();
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder(/ค้นหาคำสั่ง/);
    await input.waitFor({ timeout: 5_000 });

    await input.fill("มืด");                       // Thai search term
    const results = await page.getByRole("option").count();
    assert.ok(results >= 1, "palette filters in Thai");

    await page.keyboard.press("Escape");
    assert.equal(await input.count(), 0, "Esc closes the palette");
  });

  btest("? opens the shortcuts help", async () => {
    // Make sure focus is on the document, not left inside a field: the global
    // shortcut handler deliberately ignores "?" while the user is typing.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await page.getByText("ปุ่มลัด · Shortcuts").waitFor({ timeout: 15_000 });
    await page.keyboard.press("Escape");
  });
});

describe("Critical flow: typography actually loads", () => {
  btest("IBM Plex faces are really available (not a system fallback)", async () => {
    await visit();
    // document.fonts.check() reports whether the face is USABLE — a CSS rule
    // naming a font that never downloaded would still "look" right in the
    // computed style, so this is the only assertion that proves it loaded.
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => ({
      sans: document.fonts.check('16px "IBM Plex Sans Thai"'),
      mono: document.fonts.check('12px "IBM Plex Mono"'),
    }));
    assert.ok(loaded.sans, "IBM Plex Sans Thai must be loaded (Thai glyphs + the Ledger identity)");
    assert.ok(loaded.mono, "IBM Plex Mono must be loaded (tabular figures)");
  });

  btest("no third-party font requests leave the page", async () => {
    const external = [];
    const listener = (req) => {
      const url = req.url();
      if (!url.startsWith(BASE) && !url.startsWith("data:")) external.push(url);
    };
    page.on("request", listener);
    await visit();
    page.off("request", listener);
    assert.deepEqual(external, [], `expected zero third-party requests, got: ${external.join(", ")}`);
  });
});

describe("Critical flow: the public landing page", () => {
  // /welcome is a separate static file, not the SPA — and until v21 NOTHING
  // navigated to it. It shipped three fonts.googleapis.com requests that
  // helmet's own CSP (styleSrc 'self', fontSrc 'self') blocked, so the Ledger
  // typography silently fell back to system fonts: exactly the v17 bug the
  // CSP comment documents as fixed. These tests exist so it cannot return.
  btest("loads with zero third-party requests", async () => {
    const external = [];
    const onReq = (r) => {
      const url = r.url();
      if (!url.startsWith(BASE) && !url.startsWith("data:")) external.push(url);
    };
    page.on("request", onReq);
    await page.goto(`${BASE}/welcome`, { waitUntil: "load" });
    page.off("request", onReq);
    assert.deepEqual(external, [], `landing page made third-party requests: ${external.join(", ")}`);
  });

  btest("IBM Plex really renders — not a system fallback", async () => {
    await page.goto(`${BASE}/welcome`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter(f => f.status === "loaded").map(f => f.family));
    assert.ok(loaded.some(f => /IBM Plex Sans Thai/.test(f)),
      `no IBM Plex face loaded — CSP may be blocking fonts. Loaded: ${loaded.join(", ") || "(none)"}`);
  });

  btest("no CSP violations — the page's own script actually executes", async () => {
    // The inline <script> was blocked by script-src 'self' until v21, which
    // left every .rv element at opacity:0 — the whole page below the hero was
    // invisible in production.
    const violations = [];
    const onMsg = (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); };
    page.on("console", onMsg);
    await page.goto(`${BASE}/welcome`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    page.off("console", onMsg);
    assert.deepEqual(violations, [], `CSP blocked resources on /welcome:\n${violations.join("\n")}`);

    // .rv elements reveal on scroll: IntersectionObserver at threshold .18,
    // then io.unobserve, so a revealed element stays revealed. Walk the page
    // before asserting — the first version of this test checked without
    // scrolling and only ever proved the handful already in the viewport.
    await page.evaluate(async () => {
      const step = window.innerHeight / 2;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 120));
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(900);

    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".rv")]
        .filter(el => getComputedStyle(el).opacity === "0").length);
    assert.equal(hidden, 0, `${hidden} reveal elements still invisible after scrolling the whole page — landing.js did not run`);
  });

  btest("has a skip link and a main landmark", async () => {
    await page.goto(`${BASE}/welcome`, { waitUntil: "load" });
    assert.equal(await page.locator("main#main").count(), 1, "missing <main id=main>");
    const skip = page.locator('a.skip[href="#main"]');
    assert.equal(await skip.count(), 1, "missing skip link");
    await page.keyboard.press("Tab");                 // first tab stop must reveal it
    assert.ok(await skip.isVisible(), "skip link does not appear on focus");
  });
});

describe("Critical flow: dark mode", () => {
  btest("toggling theme flips the root class and persists", async () => {
    await visit();
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    const before = await isDark();

    await page.getByRole("button", { name: "สลับโหมดสว่าง/มืด" }).click();
    assert.notEqual(await isDark(), before, "theme toggles");

    await page.reload({ waitUntil: "load" });
    assert.notEqual(await isDark(), before, "theme choice survives a reload");
  });
});

describe("Critical flow: auth", () => {
  btest("a user can register and their name appears in the nav", async () => {
    const username = `browser_${Date.now()}`;
    await visit();
    await page.getByRole("link", { name: /เข้าสู่ระบบ/ }).click();

    // The app ships in Thai: "สมัครสมาชิก" = register.
    await page.getByRole("button", { name: "สมัครสมาชิก" }).first().click();
    // The username input carries no explicit type attribute, so select it by
    // its placeholder rather than input[type=text] (which wouldn't match).
    await page.getByPlaceholder("your_username").fill(username);
    await page.locator('input[type="password"]').first().fill("Test1234!");
    await page.getByRole("button", { name: "สมัครสมาชิก" }).last().click();

    await page.getByText(username).waitFor({ timeout: 20_000 });
    assert.ok(await page.getByText(username).isVisible(), "registered user shown in nav");
  });

  btest("a signed-in user's analysis is saved and the deep-dive agent runs", async () => {
    // The demo path never saves (savedId:null by design) — the agent needs a
    // REAL upload while signed in, which also keeps the classic upload →
    // analyze journey covered now that analyzeSample() rides the demo tap.
    await page.locator("#fileIn").setInputFiles({
      name: "browser-e2e.csv", mimeType: "text/csv",
      buffer: Buffer.from("สินค้า,ยอดขาย\nน้ำปลา,120\nข้าวสาร,450\nน้ำตาล,80\n"),
    });
    await page.getByText("พร้อมตรวจ").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "วิเคราะห์ไฟล์" }).click();
    await page.getByText("รายงานผู้ตรวจ · AI").waitFor({ timeout: 30_000 });

    await page.getByRole("tab", { name: "deep dive" }).click();
    await page.getByPlaceholder(/คอลัมน์ไหนน่ากังวล/).waitFor({ timeout: 10_000 });

    await page.getByPlaceholder(/คอลัมน์ไหนน่ากังวล/).fill("คอลัมน์ไหนน่ากังวลที่สุด");
    await page.getByRole("button", { name: /เจาะลึก/ }).click();

    // The agent must show the checks it ran, then the grounded answer.
    await page.getByText(/ตรวจแล้ว \d+ ขั้น/).waitFor({ timeout: 30_000 });
    const steps = await page.getByText(/ตรวจแล้ว \d+ ขั้น/).textContent();
    assert.match(steps, /ตรวจแล้ว [1-9]/, "agent ran at least one tool check");
  });
});

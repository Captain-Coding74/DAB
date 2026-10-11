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
      /* Not --single-process: that Lambda flag puts every context in one
         process, and closing any context then takes the whole browser down
         ("Target page, context or browser has been closed") — this suite
         opens and closes several. */
      args: sparticuz.args.filter((a) => a !== "--single-process"),
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
    /* A software-rendered browser (the bundled Chromium) can paint slower
       than the walk scrolls, so an element can pass through the viewport
       between two IntersectionObserver checks. Bring any such element into
       view on its own — still landing.js revealing it on scroll — before
       counting. */
    await page.evaluate(async () => {
      for (const el of document.querySelectorAll(".rv")) {
        if (getComputedStyle(el).opacity !== "0") continue;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise(r => setTimeout(r, 250));
      }
    });
    await page.waitForTimeout(900);

    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".rv")]
        .filter(el => getComputedStyle(el).opacity === "0").length);
    assert.equal(hidden, 0, `${hidden} reveal elements still invisible after scrolling the whole page — landing.js did not run`);
  });

  /* The #how walkthrough. Each test gets its own context: the shared page has
     already fetched the media in the test above, and a media-cache hit fires
     no request event, so a shared page would see nothing either way. */
  async function walkPage(options) {
    const ctx = await browser.newContext(options);
    const p = await ctx.newPage();
    p.on("console", m => { if (m.type() === "error") suite.consoleErrors.push({ test: currentTest, text: m.text().slice(0, 200) }); });
    p.on("pageerror", e => { suite.consoleErrors.push({ test: currentTest, text: `uncaught: ${e.message}`.slice(0, 200) }); });
    const reqs = [];
    p.on("request", (r) => { if (/dab-walk[.-]/.test(r.url())) reqs.push(r.url()); });   // video, poster or still
    await p.goto(`${BASE}/welcome`, { waitUntil: "load" });
    return { ctx, p, reqs };
  }
  // Scroll instantly (the page sets scroll-behavior: smooth) to `top`, or so
  // that #walk sits `walkGap` px below the viewport; let two frames pass so
  // IntersectionObserver callbacks have run; return #walk's gap below the fold.
  const scrollPage = (p, { top = null, walkGap = 0 }) => p.evaluate(async ([top, walkGap]) => {
    const walkTop = () => document.getElementById("walk").getBoundingClientRect().top;
    window.scrollTo({ top: top ?? window.scrollY + walkTop() - window.innerHeight - walkGap, behavior: "instant" });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(walkTop() - window.innerHeight);
  }, [top, walkGap]);
  const scrollWholePage = async (p) => {
    const [h, vh] = await p.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    for (let y = 0; y <= h; y += vh / 2) { await scrollPage(p, { top: y }); await p.waitForTimeout(60); }
  };
  const VIDEO_OR_POSTER = /dab-walk\.(webm|mp4)|dab-walk-poster/;

  btest("the walkthrough video is not fetched until #walk is within 300 px", async () => {
    // #walk ships with no <source>, no poster and no autoplay; landing.js arms
    // it 300 px out. A regression here would put ~2 MB on every page load.
    // It measures #walk itself (the observed element), with a lower bound too:
    // the 50 px scan lands inside (250, 300] at the step that arms it.
    const { ctx, p, reqs } = await walkPage({ viewport: { width: 1440, height: 900 } });
    try {
      await p.waitForTimeout(500);
      assert.deepEqual(reqs, [], `walkthrough fetched at page load: ${reqs.join(", ")}`);
      let gapAtFirst = null;
      for (let y = 0; y < 10_000 && gapAtFirst === null; y += 50) {
        const gap = await scrollPage(p, { top: y });
        if (gap <= 400) await p.waitForTimeout(150);              // near the margin: give the fetch time to show
        if (reqs.length) gapAtFirst = gap;
      }
      assert.ok(gapAtFirst !== null, "the walkthrough never armed after scrolling to #walk");
      assert.ok(gapAtFirst <= 300 && gapAtFirst > 240,
        `walkthrough first fetched with #walk ${gapAtFirst} px below the viewport; expected within (240, 300]`);
    } finally {
      await ctx.close();
    }
  });

  btest("below 900 px the walkthrough fetches nothing, even after a full scroll", async () => {
    const { ctx, p, reqs } = await walkPage({ viewport: { width: 899, height: 800 } });
    try {
      await scrollWholePage(p);
      await p.waitForTimeout(200);
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("walk")).display), "none");
      assert.deepEqual(reqs, [], `walkthrough media fetched at 899 px: ${reqs.join(", ")}`);
    } finally {
      await ctx.close();
    }
  });

  btest("reduced motion gets the still, fetched only near #walk, and never the video", async () => {
    const { ctx, p, reqs } = await walkPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    try {
      await p.waitForTimeout(300);
      assert.deepEqual(reqs, [], `fetched at page load under reduced motion: ${reqs.join(", ")}`);
      await scrollPage(p, { walkGap: 450 });
      await p.waitForTimeout(150);
      assert.deepEqual(reqs, [], `fetched with #walk still 450 px below the viewport: ${reqs.join(", ")}`);
      const still = p.waitForRequest(/dab-walk-still\.jpg/, { timeout: 5_000 });
      await scrollPage(p, { walkGap: 200 });
      await still;
      await scrollWholePage(p);
      await p.waitForTimeout(200);
      const shown = await p.evaluate(() => {
        const w = document.getElementById("walk");
        return {
          still: w.classList.contains("walk--still"),
          bg: getComputedStyle(w.querySelector(".walk-stage")).backgroundImage,
          video: getComputedStyle(w.querySelector("video")).display,
          btn: getComputedStyle(document.getElementById("walkBtn")).display,
        };
      });
      assert.ok(shown.still && /dab-walk-still\.jpg/.test(shown.bg), `the still is not shown: ${JSON.stringify(shown)}`);
      assert.equal(shown.video, "none", "the video element is hidden");
      assert.equal(shown.btn, "none", "the Pause/Play button is hidden");
      const media = reqs.filter(u => VIDEO_OR_POSTER.test(u));
      assert.deepEqual(media, [], `video or poster fetched under reduced motion: ${media.join(", ")}`);
    } finally {
      await ctx.close();
    }
  });

  btest("the walkthrough and the hero video take turns, never both playing", async () => {
    // The hero has a source only at >= 1280 px with motion, so 1440x900.
    const { ctx, p } = await walkPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    try {
      const state = () => p.evaluate(() => {
        const w = document.querySelector("#walk video"), h = document.querySelector(".hero-bg video");
        return { walk: !w.paused, walkT: +w.currentTime.toFixed(2), hero: !h.paused, heroT: +h.currentTime.toFixed(2),
                 heroSrc: !!h.currentSrc, now: [...document.querySelectorAll("#how .step")].map(s => s.classList.contains("now")),
                 both: window.__bothPlaying };
      });
      const until = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 10_000 }).catch(() => {});   // the asserts below explain a timeout
      await p.evaluate(() => {          // samples every 50 ms for the whole test
        const w = document.querySelector("#walk video"), h = document.querySelector(".hero-bg video");
        window.__bothPlaying = 0;
        setInterval(() => { if (!w.paused && !h.paused) window.__bothPlaying++; }, 50);
      });
      await until(() => { const h = document.querySelector(".hero-bg video"); return !h.paused && h.currentTime > 0.2; });
      let s = await state();
      assert.ok(s.heroSrc && s.hero, `the hero should be playing at the top first: ${JSON.stringify(s)}`);

      await p.evaluate(() => document.getElementById("walk").scrollIntoView({ block: "center", behavior: "instant" }));
      await until(() => {
        const w = document.querySelector("#walk video");
        return !w.paused && w.currentTime > 1.6 && document.querySelector("#how .step").classList.contains("now");
      });
      s = await state();
      assert.ok(s.walk && s.walkT >= 1.5, `the walkthrough should be playing with #walk centred: ${JSON.stringify(s)}`);
      assert.ok(!s.hero, `the hero should be paused while the walkthrough plays: ${JSON.stringify(s)}`);
      assert.deepEqual(s.now, [true, false, false], "step 01 is the lit chapter early in the film");

      await scrollPage(p, { top: 0 });
      const heroT = s.heroT;
      await until((t) => {
        const w = document.querySelector("#walk video"), h = document.querySelector(".hero-bg video");
        return w.paused && !h.paused && h.currentTime !== t;
      }, heroT);
      s = await state();
      assert.ok(!s.walk, `the walkthrough should pause back at the top: ${JSON.stringify(s)}`);
      assert.ok(s.hero && s.heroT !== heroT, `the hero should resume back at the top: ${JSON.stringify(s)}`);
      assert.deepEqual(s.now, [false, false, false], "the chapter rail goes dark when the film pauses");
      assert.equal(s.both, 0, "the two videos were sampled playing at the same time");
    } finally {
      await ctx.close();
    }
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

describe("Critical flow: the legal pages (v21.30)", () => {
  // /privacy and /terms are server documents (backend/src/legalPages.js), not
  // SPA routes. They promise "no third-party scripts" and carry their own
  // small script (legal.js, the language toggle) — so the same three checks
  // as the landing page: nothing external, no CSP violation, a clean console.
  for (const path of ["/privacy", "/terms"]) {
    btest(`${path}: no console errors, no CSP violations, no third-party requests`, async () => {
      const external = [], errors = [];
      const onReq = (r) => { const url = r.url(); if (!url.startsWith(BASE) && !url.startsWith("data:")) external.push(url); };
      const onMsg = (m) => { if (m.type() === "error" || /Content Security Policy/i.test(m.text())) errors.push(m.text()); };
      const onErr = (e) => errors.push(`uncaught: ${e.message}`);
      page.on("request", onReq); page.on("console", onMsg); page.on("pageerror", onErr);
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        // legal.js really ran: the TH toggle switches the document language.
        await page.locator('[data-set-lang="th"]').click();
        await page.waitForFunction(() => document.body.dataset.lang === "th");
        await page.waitForTimeout(300);
      } finally {
        page.off("request", onReq); page.off("console", onMsg); page.off("pageerror", onErr);
      }
      assert.deepEqual(external, [], `${path} made third-party requests: ${external.join(", ")}`);
      assert.deepEqual(errors, [], `${path} console errors or CSP violations:\n${errors.join("\n")}`);
      assert.equal(await page.locator("h1").count(), 1);
    });
  }
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
    // v21.30: "Create account" stays disabled until both click-wrap boxes are ticked.
    const submit = page.getByRole("button", { name: "สมัครสมาชิก" }).last();
    assert.ok(await submit.isDisabled(), "sign-up is blocked until the Terms and age boxes are ticked");
    await page.locator('input[name="acceptTerms"]').check();
    await page.locator('input[name="ageConfirmed"]').check();
    await submit.click();

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


/* v21.30 — the privacy controls, driven like a user would. These follow the
   auth flow above: the same signed-in page, with the uploaded file's
   analysis on screen. */
describe("Critical flow: privacy controls (v21.30)", () => {
  btest("Save dataset asks first, then stores the file", async () => {
    await page.getByRole("tab", { name: "analysis" }).click();
    const save = page.getByRole("button", { name: "บันทึกชุดข้อมูล", exact: true });
    await save.waitFor({ timeout: 10_000 });
    await save.click();
    const dialog = page.getByRole("dialog", { name: "บันทึกชุดข้อมูลนี้หรือไม่" });
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.textContent(), /365/, "the dialog says how long the file is kept");
    await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 15_000 });
    // Saved: the action is gone and the owner's AI switch appears.
    await page.getByText("AI สำหรับชุดข้อมูลนี้").waitFor({ timeout: 15_000 });
    assert.equal(await save.count(), 0, "a saved result no longer offers Save");
  });

  btest("AI edit sends nothing until the confirmation dialog's Send", async () => {
    const sends = [];
    // The confirmation is what is under test. The AI mock cannot produce a
    // table, so the send itself is answered here — after recording it.
    await page.route("**/api/fixes/*/ai-edit", async (route) => {
      sends.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ applied: false, instruction: "trim", changes: [], changeCount: 0, rows: [], headers: [], protectedColumns: [], sensitiveColumns: [] }) });
    });
    try {
      await page.getByRole("tab", { name: "quality" }).click();
      const box = page.getByPlaceholder(/แปลงคอลัมน์วันที่/);
      await box.waitFor({ timeout: 15_000 });   // the fixes panel loads with the tab
      await box.fill("ตัดช่องว่างหน้าหลังทุกช่อง");
      await page.getByRole("button", { name: "ให้ AI เสนอการแก้ไข" }).click();
      const dialog = page.getByRole("dialog", { name: "ส่งข้อมูลเหล่านี้ให้ AI หรือไม่" });
      await dialog.waitFor({ timeout: 10_000 });
      assert.match(await dialog.textContent(), /Anthropic/, "the dialog names the recipient");
      assert.equal(sends.length, 0, "opening the dialog sent nothing");
      await dialog.getByRole("button", { name: "ส่ง", exact: true }).click();
      await page.getByText("รายการเปลี่ยนแปลงที่เสนอ").waitFor({ timeout: 15_000 });
      assert.equal(sends.length, 1, "one send, after the click");
      assert.equal(sends[0].confirmSend, true);
    } finally {
      await page.unroute("**/api/fixes/*/ai-edit");
    }
  });

  btest("a share link is made only through the dialog, with a warning and an expiry", async () => {
    await page.getByRole("tab", { name: "analysis" }).click();
    await page.getByRole("button", { name: "แชร์", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "แชร์รายงานนี้" });
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.textContent(), /ทุกคนที่มีลิงก์/, "says who can see it");
    assert.equal(await dialog.locator("#share-title").inputValue(), "รายงานผลการวิเคราะห์", "generic title, not the file name");
    assert.equal(await dialog.locator("#share-expiry").inputValue(), "30", "30 days by default");
    await dialog.locator("#share-expiry").selectOption("7");
    await dialog.getByRole("button", { name: "สร้างลิงก์และคัดลอก" }).click();
    const link = await dialog.locator("#share-url");
    await link.waitFor({ timeout: 15_000 });
    const url = await link.inputValue();
    assert.match(url, /\/share\/[^/]+$/);
    await dialog.getByRole("button", { name: "ปิด", exact: true }).click();

    // The public page: no file name, a way to report it, kept out of search.
    await page.goto(url, { waitUntil: "load" });
    await page.getByRole("link", { name: "แจ้งปัญหาหน้านี้" }).waitFor({ timeout: 15_000 });
    assert.equal(await page.locator('meta[name="robots"][content*="noindex"]').count(), 1);
    assert.ok(!(await page.content()).includes("browser-e2e"), "the file name is not on the public page");
  });

  btest("after a Terms/Privacy update, the app asks to accept before going on", async () => {
    // Pretend the account accepted an older version: /api/auth/me reports it.
    await page.route("**/api/auth/me", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, legal: { ...body.legal, accepted: "2000-01-01" } } });
    });
    try {
      await page.goto(BASE, { waitUntil: "load" });
      const dialog = page.getByRole("dialog", { name: "เราได้ปรับปรุงข้อกำหนดการใช้งานและประกาศความเป็นส่วนตัว" });
      await dialog.waitFor({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      assert.ok(await dialog.isVisible(), "Esc does not dismiss it");
      const accept = dialog.getByRole("button", { name: "ยอมรับและใช้งานต่อ" });
      assert.ok(await accept.isDisabled(), "Accept waits for the box");
      await dialog.locator('input[name="acceptTerms"]').check();
      await accept.click();
      await dialog.waitFor({ state: "detached", timeout: 15_000 });
    } finally {
      await page.unroute("**/api/auth/me");
    }
  });
});

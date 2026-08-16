/**
 * e2e/geometry.test.mjs — the visual bug hunt, made permanent (v21.9, item 2).
 *
 * The seven v21.8 visual bugs were all mechanically detectable before a human
 * saw them: horizontal page scroll, elements past the right edge, console
 * errors, failed requests. Those checks ran once, by hand, in a sandbox.
 * This file runs them on every CI push, at the two widths that matter —
 * a phone (390) and the projector (1024) — across the key screens.
 *
 * Deliberately geometry, not pixels: screenshot baselines flake on font and
 * antialiasing differences between machines; scrollWidth does not. Earn
 * pixel diffs later with a regression this file misses (IMPROVEMENTS.md §10).
 *
 * Run: npm run test:browser  (this file rides the same script)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const DIST = join(ROOT, "frontend", "dist");
const PORT = 3398;                       // browser.test.mjs owns 3399
const BASE = `http://127.0.0.1:${PORT}`;

let server, browser, dataDir;
let token, refreshToken, username;

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

  dataDir = mkdtempSync(join(tmpdir(), "dab-geometry-"));
  server = spawn(process.execPath, [join(ROOT, "backend", "src", "server.js")], {
    cwd: join(ROOT, "backend"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      AI_MOCK: "1",
      PORT: String(PORT),
      JWT_SECRET: "geometry-secret-32-chars-xxxxxxx",
      JWT_REFRESH_SECRET: "geometry-refresh-32-chars-xxxx",
      SQLITE_DIR: dataDir,
      LOG_LEVEL: "error",
      RATE_LIMIT_MAX: "1000000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    assert.notEqual(i, 74, "server never became healthy");
    await new Promise((r) => setTimeout(r, 200));
  }

  // Seed: a user and a real dataset, so signed-in screens have content.
  username = `geo_${Date.now()}`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "geometry123" }),
  });
  assert.ok(reg.ok, "register failed");
  ({ accessToken: token, refreshToken } = await reg.json());
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(join(ROOT, "backend", "sample-data", "big_sales.csv"))],
    { type: "text/csv" }), "big_sales.csv");
  const up = await fetch(`${BASE}/api/datasets`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  assert.ok(up.ok, "seed upload failed");

  /* A workspace with a real-world name. The v21.8 workspace overflow only
     reproduces when the switcher's longest option is long — a short default
     name lets even the broken layout fit at 390px, and the gate guards
     nothing. Thesis students name workspaces like thesis chapters. */
  const ws = await fetch(`${BASE}/api/workspaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "งานวิจัยปริญญาตรี ภาคเรียนที่ 2/2569 — ชุดข้อมูลแบบสอบถามฉบับแก้ไขล่าสุด" }),
  });
  assert.ok(ws.ok, "seed workspace failed");

  browser = await launchBrowser();
});

after(async () => {
  await browser?.close().catch(() => {});
  server?.kill("SIGKILL");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

/* The same probe the v21.8 hunt used. Anything past the right edge of the
   viewport, or any page-level horizontal scroll, is a failure with names.
   A real function, not a string: playwright evaluates strings as
   expressions, which returns the function unserialized instead of calling
   it. */
function geometryProbe() {
  const iw = window.innerWidth;
  const overflowX = document.documentElement.scrollWidth - iw;
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Inside an overflow-x container is fine; past the PAGE edge is not.
    if (r.right > iw + 1 || r.left < -1) {
      let scrollable = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) { scrollable = true; break; }
      }
      if (scrollable) continue;
      const cls = (typeof el.className === "string" && el.className)
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      offenders.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      if (offenders.length >= 6) break;
    }
  }
  return { overflowX, offenders };
}

const VIEWPORTS = [
  ["phone", 390, 844],
  ["projector", 1024, 768],
];

/** name → how to get there. Each returns after the screen is settled. */
const SCREENS = {
  landing: async (page) => {
    await page.goto(BASE); await page.waitForLoadState("networkidle");
  },
  auth: async (page) => {
    await page.goto(`${BASE}/auth`); await page.waitForLoadState("networkidle");
  },
  "results-tabs": async (page) => {
    await page.goto(BASE); await page.waitForLoadState("networkidle");
    // The anonymous demo path: first sample card → full results.
    await page.locator("text=ยอดขายร้านโชห่วย").first().click();
    await page.waitForSelector('[role="tablist"][aria-label="ผลการวิเคราะห์"]', { timeout: 45000 });
    await page.waitForLoadState("networkidle");
  },
  history: async (page) => {
    await page.goto(`${BASE}/history`); await page.waitForLoadState("networkidle");
  },
  workspace: async (page) => {
    await page.goto(`${BASE}/workspace`); await page.waitForLoadState("networkidle");
  },
};

for (const [vpName, width, height] of VIEWPORTS) {
  describe(`geometry @ ${vpName} (${width}px)`, () => {
    let context, page, consoleErrors, failedRequests;

    before(async () => {
      context = await browser.newContext({ viewport: { width, height }, locale: "th-TH" });
      page = await context.newPage();
      consoleErrors = [];
      failedRequests = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
      page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-80)}`); });
      // Session + tour flag before any screen renders.
      await page.goto(BASE);
      await page.evaluate(([at, rt, u]) => {
        localStorage.setItem("dab_at", at);
        localStorage.setItem("dab_rt", rt);
        localStorage.setItem("dab_user", JSON.stringify({ username: u }));
        localStorage.setItem("dab_tour_done", "1");
      }, [token, refreshToken, username]);
    });

    after(async () => { await context?.close().catch(() => {}); });

    for (const [screenName, visit] of Object.entries(SCREENS)) {
      test(`${screenName}: no page overflow, nothing offscreen, console clean`, async () => {
        consoleErrors.length = 0;
        failedRequests.length = 0;
        await visit(page);
        await page.waitForTimeout(500);

        // Results screen: sweep every tab, not just the first one.
        if (screenName === "results-tabs") {
          const tabs = page.locator('[role="tablist"][aria-label="ผลการวิเคราะห์"] button');
          const n = await tabs.count();
          for (let i = 0; i < n; i++) {
            await tabs.nth(i).click();
            await page.waitForTimeout(350);
            const g = await page.evaluate(geometryProbe);
            assert.equal(g.overflowX <= 1, true, `tab ${i}: page scrolls ${g.overflowX}px horizontally`);
            assert.deepEqual(g.offenders, [], `tab ${i}: elements past the viewport edge`);
          }
        }

        const g = await page.evaluate(geometryProbe);
        assert.equal(g.overflowX <= 1, true, `page scrolls ${g.overflowX}px horizontally`);
        assert.deepEqual(g.offenders, [], "elements past the viewport edge");
        assert.deepEqual(consoleErrors, [], "console errors on screen");
        assert.deepEqual(failedRequests, [], "failed requests on screen");
      });
    }
  });
}

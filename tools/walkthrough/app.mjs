// Boot the REAL DAB app for a capture: backend/src/server.js serving the production bundle (frontend/dist),
// AI_MOCK=1, a throwaway SQLite dir, port 3411 (WALK_PORT overrides). One server process and one browser context per
// capture session. localStorage is seeded by an init script, so the very first paint is already EN + tour-done.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { VIEWPORT, DPR } from "./schedule.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const PORT = +(process.env.WALK_PORT || 3411);   // WALK_PORT lets two captures run side by side

/** Newest mtime under a path (files only). */
function newest(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let m = 0;
  for (const e of fs.readdirSync(p)) m = Math.max(m, newest(path.join(p, e)));
  return m;
}

/** Refuse to capture a stale bundle: frontend/dist must be newer than every input of the app build. */
export function assertDistFresh() {
  const dist = path.join(ROOT, "frontend", "dist", "index.html");
  if (!fs.existsSync(dist)) throw new Error("frontend/dist is missing — run `npm run build -w frontend` from the repo root");
  const built = fs.statSync(dist).mtimeMs;
  const inputs = ["src", "index.html", "vite.config.js", "tailwind.config.js", "postcss.config.js"].map(p => path.join(ROOT, "frontend", p));
  const stale = inputs.map(p => [p, newest(p)]).filter(([, m]) => m > built);
  if (stale.length) throw new Error(`frontend/dist is older than ${stale.map(([p]) => path.relative(ROOT, p)).join(", ")} — run \`npm run build -w frontend\` first`);
  return { distBuiltAt: new Date(built).toISOString() };
}

/** Start backend/src/server.js on PORT with a throwaway SQLITE_DIR. Resolves once /api/health answers. */
export async function startServer({ port = PORT } = {}) {
  const BASE = `http://127.0.0.1:${port}`;
  // never capture against a server we did not start (a stale one would mix runs)
  try { await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) }); throw new Error(`port ${port} is already in use — stop that server first`); }
  catch (e) { if (/already in use/.test(e.message)) throw e; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dab-walk-"));
  let stderr = "";
  const proc = spawn(process.execPath, [path.join(ROOT, "backend", "src", "server.js")], {
    cwd: path.join(ROOT, "backend"),
    env: { ...process.env, NODE_ENV: "development", AI_MOCK: "1", PORT: String(port),
      JWT_SECRET: "walk-secret-32-chars-xxxxxxxxxxx", JWT_REFRESH_SECRET: "walk-refresh-32-chars-xxxxxxxxxx",
      SQLITE_DIR: dataDir, LOG_LEVEL: "error" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.stderr.on("data", d => { stderr += d; });
  let health = null;
  for (let i = 0; i < 150 && !health; i++) {
    if (proc.exitCode !== null) break;
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) health = await r.json(); } catch {}
    if (!health) await new Promise(r => setTimeout(r, 200));
  }
  const close = () => { try { proc.kill(); } catch {} fs.rmSync(dataDir, { recursive: true, force: true }); };
  if (!health) { close(); throw new Error(`server did not come up on ${BASE}\n${stderr.slice(-2000)}`); }
  return { BASE, health, close, stderr: () => stderr };
}

/** CHROMIUM=/path/to/chrome picks the build (playwright-core does not find a browser by itself). */
export function launchBrowser() {
  return chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
}

/** The one context of a session: 1440x900 @2x, dark, motion allowed, EN, onboarding tour already done. */
export async function newSessionContext(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, colorScheme: "dark", reducedMotion: "no-preference" });
  await context.addInitScript(() => {
    try { localStorage.setItem("dab_landing_lang", "en"); localStorage.setItem("dab_tour_done", "1"); } catch {}
  });
  return context;
}

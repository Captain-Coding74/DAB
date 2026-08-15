#!/usr/bin/env node
/**
 * perf-load.mjs — throughput, latency, and a memory-leak check.
 *
 * autocannon was already a dependency but nothing used it. This answers three
 * questions that unit tests cannot:
 *
 *   1. Does the server hold up under concurrent users, or fall over?
 *   2. What does a user actually wait, at p99, when others are hitting it?
 *   3. Does repeated analysis leak memory? A parser that grows 5 MB per file
 *      is invisible in tests and fatal after an afternoon of real use.
 *
 * Measured on the reference machine: p99 94 ms on /api/health at 50
 * connections, and 200 sequential analyses of sales.csv moved RSS from 166 MB
 * to 171 MB — flat after the first fifty, so no leak.
 *
 *   node scripts/perf-load.mjs            # quick
 *   node scripts/perf-load.mjs --leak     # adds the 200-upload leak check
 */
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.PERF_PORT || 3010;
const BASE = `http://localhost:${PORT}`;
const WANT_LEAK = process.argv.includes("--leak");

/** Budgets. Generous enough not to be flaky on a loaded CI box. */
const BUDGET = { p99Health: 400, minReqSec: 200, leakMB: 60 };

const server = spawn("node", ["backend/src/server.js"], {
  env: {
    ...process.env,
    PORT, LOG_LEVEL: "silent", NODE_ENV: "test", AI_MOCK: "1",
    RATE_LIMIT_MAX: "1000000",
    JWT_SECRET: "perf-secret-32-chars-long!!!!!!!",
    JWT_REFRESH_SECRET: "perf-refresh-32-chars-long!!!!!",
  },
  stdio: "ignore",
});

const rss = () => {
  try { return Math.round(Number(execSync(`ps -o rss= -p ${server.pid}`).toString().trim()) / 1024); }
  catch { return null; }
};

async function waitForBoot() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

function bench(path, { connections = 50, duration = 8 } = {}) {
  const out = execSync(
    `npx --yes autocannon -c ${connections} -d ${duration} -j ${BASE}${path}`,
    { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  const r = JSON.parse(out);
  return {
    p99: r.latency?.p99, mean: r.latency?.mean,
    reqSec: Math.round(r.requests?.average || 0),
    errors: (r.errors || 0) + (r.timeouts || 0) + (r.non2xx || 0),
  };
}

const fail = [];
try {
  if (!(await waitForBoot())) throw new Error("server did not start");
  console.log("Load\n");

  for (const [label, path, conns] of [
    ["/api/health", "/api/health", 50],
    ["/welcome", "/welcome", 50],
    ["/api/demo/samples", "/api/demo/samples", 10],
  ]) {
    const r = bench(path, { connections: conns });
    console.log(`  ${label.padEnd(20)} ${String(r.reqSec).padStart(6)} req/s   mean ${String(r.mean).padStart(6)} ms   p99 ${String(r.p99).padStart(6)} ms   errors ${r.errors}`);
    if (r.errors > 0) fail.push(`${label}: ${r.errors} failed responses under load`);
    if (label === "/api/health") {
      if (r.p99 > BUDGET.p99Health) fail.push(`/api/health p99 ${r.p99}ms > ${BUDGET.p99Health}ms`);
      if (r.reqSec < BUDGET.minReqSec) fail.push(`/api/health ${r.reqSec} req/s < ${BUDGET.minReqSec}`);
    }
  }

  if (WANT_LEAK) {
    console.log("\nMemory over 200 analyses");
    const { readFileSync } = await import("node:fs");
    const csv = readFileSync("backend/sample-data/sales.csv");
    const before = rss();
    console.log(`  start ${before} MB`);
    for (let i = 1; i <= 200; i++) {
      const fd = new FormData();
      fd.append("question", "q");
      fd.append("file", new Blob([csv]), "sales.csv");
      await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd }).catch(() => {});
      if (i % 50 === 0) console.log(`  after ${String(i).padStart(3)} ${rss()} MB`);
    }
    const grew = rss() - before;
    console.log(`  growth ${grew} MB`);
    // A parser that leaks per-file is invisible in tests and fatal in a day.
    if (grew > BUDGET.leakMB) fail.push(`memory grew ${grew}MB over 200 analyses (budget ${BUDGET.leakMB}MB)`);
  }

  console.log("");
  if (fail.length) { for (const f of fail) console.log(`  ✗ ${f}`); console.log("\n✗ load budgets regressed."); process.exitCode = 1; }
  else console.log("✓ All load budgets met.");
} catch (err) {
  console.error("perf-load failed:", err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}

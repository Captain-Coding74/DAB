/**
 * scripts/perf-api.mjs — v13 API latency budgets
 *
 * Spawns the real server (AI_MOCK=1, isolated DB), load-tests the hot paths
 * with autocannon, and fails if p95 latency or throughput regress past the
 * targets in perf-budget.json.
 *
 * We budget p95 (not the mean) because the mean hides exactly the users
 * having a bad time. Analyze is measured separately with a lower bar — it
 * parses a whole file, so it will always be the slow path.
 *
 * Usage: node scripts/perf-api.mjs [--update]
 */
import autocannon from "autocannon";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dirname, "..");
const BUDGET = join(ROOT, "perf-budget.json");
const PORT   = 3299;
const BASE   = `http://127.0.0.1:${PORT}`;

const dataDir = mkdtempSync(join(tmpdir(), "dab-perf-"));
const server = spawn(process.execPath, [join(ROOT, "src", "server.js")], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: "development",
    AI_MOCK: "1",
    PORT: String(PORT),
    JWT_SECRET: "perf-secret-32-chars-xxxxxxxxxxx",
    JWT_REFRESH_SECRET: "perf-refresh-32-chars-xxxxxxxxx",
    SQLITE_DIR: dataDir,
    LOG_LEVEL: "error",
    // Rate limiting would throttle the benchmark itself, not the code we're
    // measuring. Raise the ceiling so we measure the app, not the limiter.
    RATE_LIMIT_MAX: "1000000",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", d => process.env.PERF_DEBUG && console.error(String(d)));

const cleanup = () => { server.kill("SIGKILL"); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

async function waitHealthy() {
  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("server never became healthy");
}

// autocannon ignores a top-level `path` option: lib/run.js parses `url` and
// copies a whitelist of fields onto it (method, body, headers, …) — `path` is
// not on that list, so requests silently go to the url's own path. With BASE
// bare, every earlier run benchmarked GET / — the SPA fallback — under the
// labels "health" and "metrics". The 2xx guard below couldn't see it because
// index.html is a 200. The path now lives in the URL itself.
const run = ({ path, ...opts }) => new Promise((resolve, reject) =>
  autocannon({ url: BASE + path, connections: 10, duration: 5, ...opts }, (err, r) => err ? reject(err) : resolve(r)));

// Second layer: prove each target is the route we think it is — one real
// request whose body must carry the route's own marker — before spending five
// seconds benchmarking the wrong one. A status check alone is exactly the
// hole the old guard had.
async function preflight(path, marker) {
  const res  = await fetch(BASE + path);
  const body = await res.text();
  if (!res.ok || !body.includes(marker)) {
    console.error(`✗ preflight ${path}: HTTP ${res.status}, marker ${JSON.stringify(marker)} ${body.includes(marker) ? "present" : "missing"} — refusing to benchmark.`);
    console.error(`  body: ${body.slice(0, 120)}`);
    process.exit(2);
  }
}

await waitHealthy();

// Warm the process (JIT, first DB connect) so we measure steady state.
for (let i = 0; i < 20; i++) await fetch(`${BASE}/api/health`);

await preflight("/api/health",  '"status":"ok"');
await preflight("/api/metrics", '"uptimeSec"');

console.log("\nRunning API benchmarks (real server, mock AI)…\n");

// Analyze: the heavy path. Hand-rolling multipart for autocannon proved
// brittle (it silently benchmarked 404s), so we drive it with the platform's
// own FormData encoder and compute percentiles ourselves. Slower to run,
// but it measures the code path users actually hit.
const csv = ["a,b,c", ...Array.from({ length: 200 }, (_, i) => `${i},${i * 2},x${i % 7}`)].join("\n");

async function loadTest({ fn, concurrency = 4, iterations = 60 }) {
  const latencies = [];
  let ok = 0, bad = 0;
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next++ < iterations) {
      const s = performance.now();
      try {
        const res = await fn();
        (res.ok ? ok++ : bad++);
      } catch { bad++; }
      latencies.push(performance.now() - s);
    }
  }));
  const wallSec = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p / 100))]);
  return {
    "2xx": ok, non2xx: bad, errors: 0,
    latency: { p50: pct(50), p95: pct(95), p99: pct(99) },
    requests: { average: Math.round(iterations / wallSec) },
    statusCodeStats: { ok, bad },
  };
}

// One full measurement of all three targets. Normal mode runs it once;
// --update runs it several times, because one pass is one sample of a noisy
// machine, not a fact about the code.
async function measureOnce() {
  const health  = await run({ path: "/api/health", title: "health" });
  const metrics = await run({ path: "/api/metrics", title: "metrics", connections: 5, duration: 3 });
  const analyze = await loadTest({
    concurrency: 4, iterations: 60,
    fn: () => {
      const fd = new FormData();
      fd.append("file", new Blob([csv], { type: "text/csv" }), "p.csv");
      fd.append("question", "สรุป");
      return fetch(`${BASE}/api/analyze`, { method: "POST", body: fd });
    },
  });

  // A benchmark that measures the error path is worse than no benchmark.
  for (const [name, r] of [["health", health], ["metrics", metrics], ["analyze", analyze]]) {
    const bad = (r.non2xx ?? 0) + (r.errors ?? 0);
    if (bad > 0 || r["2xx"] === 0) {
      console.error(`✗ ${name}: ${bad} non-2xx/errors, ${r["2xx"]} successes — benchmark hit the failure path, numbers are meaningless.`);
      console.error(`  statusCodeStats:`, JSON.stringify(r.statusCodeStats ?? {}));
      process.exit(2);
    }
  }

  return {
    healthP95Ms:   health.latency.p95  ?? health.latency.p97_5  ?? health.latency.p99,
    metricsP95Ms:  metrics.latency.p95 ?? metrics.latency.p97_5 ?? metrics.latency.p99,
    analyzeP95Ms:  analyze.latency.p95 ?? analyze.latency.p97_5 ?? analyze.latency.p99,
    healthReqSec:  Math.round(health.requests.average),
    analyzeReqSec: Math.round(analyze.requests.average),
  };
}

const budget = JSON.parse(readFileSync(BUDGET, "utf8"));

if (process.argv.includes("--update")) {
  // Calibrating from a single pass burned us: a boosted, cache-warm pass
  // measured health at ~3ms p95, wrote budgets from it, and the very next
  // cold run on the same machine missed 3 of 5 (metrics 22ms vs 16, analyze
  // 64 req/s vs a floor of 108). Desktop machines swing 3–5x between
  // back-to-back runs — boost clocks decay, antivirus scans the fresh temp
  // dirs. So calibration takes three full passes and keys the budget off the
  // WORST latency and LOWEST throughput seen, then applies headroom on top.
  // A budget must be repeatable on a bad minute, not achievable on a good one.
  const passes = [];
  for (let i = 1; i <= 3; i++) {
    console.log(`Calibration pass ${i}/3…`);
    const p = await measureOnce();
    console.log(`  health ${p.healthP95Ms}ms p95 / ${p.healthReqSec} req/s · metrics ${p.metricsP95Ms}ms · analyze ${p.analyzeP95Ms}ms / ${p.analyzeReqSec} req/s`);
    passes.push(p);
  }
  const worst = {
    healthP95Ms:   Math.max(...passes.map(p => p.healthP95Ms)),
    metricsP95Ms:  Math.max(...passes.map(p => p.metricsP95Ms)),
    analyzeP95Ms:  Math.max(...passes.map(p => p.analyzeP95Ms)),
    healthReqSec:  Math.min(...passes.map(p => p.healthReqSec)),
    analyzeReqSec: Math.min(...passes.map(p => p.analyzeReqSec)),
  };
  budget.api = {
    healthP95Ms:   Math.ceil(worst.healthP95Ms  * 2 + 10),
    metricsP95Ms:  Math.ceil(worst.metricsP95Ms * 2 + 10),
    analyzeP95Ms:  Math.ceil(worst.analyzeP95Ms * 2 + 50),
    healthReqSecMin:  Math.floor(worst.healthReqSec  * 0.5),
    analyzeReqSecMin: Math.floor(worst.analyzeReqSec * 0.5),
  };
  writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + "\n");
  console.log("\n✓ perf-budget.json api targets updated from the worst of 3 passes:", budget.api);
  process.exit(0);
}

const actual = await measureOnce();

/**
 * CPU scaling factor (v21). These budgets were calibrated on developer
 * hardware (~77ms analyze p95, ~166 req/s). /api/analyze is CPU-bound — it
 * parses a 200-row CSV and computes stats per request — and a shared 2-core
 * CI runner measures ~4x slower on that path. Health and metrics are I/O-bound
 * and barely move, which is why they pass with huge margin on both.
 *
 * So the budgets are scaled rather than skipped — `|| true` would make the
 * benchmark decorative. Latency budgets multiply, throughput budgets divide.
 *
 * Be honest about what this buys. On shared-tenancy runners you cannot have
 * both flake resistance and 2x regression sensitivity: at PERF_CPU_FACTOR=4
 * the analyze ceiling is ~816ms against ~325ms observed, so CI catches GROSS
 * regressions (roughly 2.5x and worse) and tolerates runner variance. The
 * tight gate is the unscaled local one — run `npm run perf:api` on your own
 * machine before merging anything that touches the analyze path.
 */
const F = Number(process.env.PERF_CPU_FACTOR ?? 1) || 1;
const lat = (ms) => Math.ceil(ms * F);
const thr = (rps) => Math.floor(rps / F);
if (F !== 1) console.log(`  (PERF_CPU_FACTOR=${F} — budgets scaled for slower CI hardware)\n`);

const checks = [
  ["health p95",   actual.healthP95Ms,  lat(budget.api.healthP95Ms),  "≤", "ms"],
  ["metrics p95",  actual.metricsP95Ms, lat(budget.api.metricsP95Ms), "≤", "ms"],
  ["analyze p95",  actual.analyzeP95Ms, lat(budget.api.analyzeP95Ms), "≤", "ms"],
  ["health req/s", actual.healthReqSec, thr(budget.api.healthReqSecMin),  "≥", "req/s"],
  ["analyze req/s",actual.analyzeReqSec,thr(budget.api.analyzeReqSecMin), "≥", "req/s"],
];

let failed = 0;
console.log("Latency / throughput budgets:");
for (const [label, got, limit, op, unit] of checks) {
  const ok = op === "≤" ? got <= limit : got >= limit;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(14)} ${String(got).padStart(7)} ${unit.padEnd(5)} ${op} ${limit}`);
}

if (failed) {
  console.error(`\n✗ ${failed} API budget(s) missed. Investigate before merging.\n`);
  process.exit(1);
}
console.log("\n✓ All API latency budgets met.\n");
process.exit(0);

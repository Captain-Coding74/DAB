/**
 * scripts/perf-api.mjs — API latency budgets (v13, rebuilt v21.7)
 *
 * Spawns the real server (AI_MOCK=1, isolated DB), load-tests the hot paths,
 * and fails if p95 latency or throughput regress past perf-budget.json.
 *
 * We budget p95 (not the mean) because the mean hides exactly the users
 * having a bad time. Five targets:
 *   health, metrics  — cheap public routes, the canary for gross regressions
 *   analyze          — the anonymous demo path (multipart parse + full stats)
 *   upload           — the authenticated write path: multipart → streaming
 *                      parse → object storage → quality score (big_sales.csv)
 *   inference        — POST /api/inference/:id. parseAllRows reads EVERY row
 *                      per request by design (v21.2 — the tests need every
 *                      row), which makes it the heaviest per-request path in
 *                      the product and the first place an accidental O(n²)
 *                      would land. Nothing else gated it.
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
const ROOT    = join(__dirname, "..");
const BUDGET  = join(ROOT, "perf-budget.json");
const BIG_CSV = readFileSync(join(ROOT, "sample-data", "big_sales.csv"));

// One active server at a time; the exit hook cleans up whichever is current.
let active = null;
process.on("exit", () => {
  if (!active) return;
  active.server.kill("SIGKILL");
  try { rmSync(active.dataDir, { recursive: true, force: true }); } catch {}
});

// autocannon ignores a top-level `path` option: lib/run.js parses `url` and
// copies a whitelist of fields onto it (method, body, headers, …) — `path` is
// not on that list, so requests silently go to the url's own path. The path
// must live in the URL itself.
const run = (base, { path, ...opts }) => new Promise((resolve, reject) =>
  autocannon({ url: base + path, connections: 10, duration: 5, ...opts }, (err, r) => err ? reject(err) : resolve(r)));

// Prove each target is the route we think it is — one real request whose body
// must carry the route's own marker — before spending seconds benchmarking
// the wrong one. A status check alone is exactly the hole the old guard had:
// GET / returns 200 too.
async function preflight(base, path, marker) {
  const res  = await fetch(base + path);
  const body = await res.text();
  if (!res.ok || !body.includes(marker)) {
    console.error(`✗ preflight ${path}: HTTP ${res.status}, marker ${JSON.stringify(marker)} ${body.includes(marker) ? "present" : "missing"} — refusing to benchmark.`);
    console.error(`  body: ${body.slice(0, 120)}`);
    process.exit(2);
  }
}

/**
 * Boot a fresh server: new process, new temp dir, cold JIT — exactly what a
 * verify run or a CI run is. Returns an authenticated context for the
 * upload/inference targets.
 */
async function bootServer(port) {
  const base    = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "dab-perf-"));
  const server  = spawn(process.execPath, [join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      AI_MOCK: "1",
      PORT: String(port),
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
  active = { server, dataDir };

  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (i === 74) throw new Error("server never became healthy");
    await new Promise(r => setTimeout(r, 200));
  }

  // Warm the process (JIT, first DB connect) so we measure steady state.
  for (let i = 0; i < 20; i++) await fetch(`${base}/api/health`);

  await preflight(base, "/api/health",  '"status":"ok"');
  await preflight(base, "/api/metrics", '"uptimeSec"');

  const reg = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `perf_${Date.now()}`, password: "perfbench123" }),
  });
  if (!reg.ok) {
    console.error(`✗ register failed (HTTP ${reg.status}) — cannot benchmark authenticated routes.`);
    process.exit(2);
  }
  const { accessToken } = await reg.json();

  const stop = () => {
    server.kill("SIGKILL");
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    active = null;
  };
  return { base, token: accessToken, stop };
}

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

// One full measurement of all five targets against a running server.
// Normal mode runs it once on one server; --update runs it on several
// freshly-booted servers, because one pass is one sample of a noisy machine,
// not a fact about the code.
async function measureOnce({ base, token }) {
  const health  = await run(base, { path: "/api/health", title: "health" });
  const metrics = await run(base, { path: "/api/metrics", title: "metrics", connections: 5, duration: 3 });

  // Analyze: the anonymous demo path. Hand-rolling multipart for autocannon
  // proved brittle (it silently benchmarked 404s), so we drive it with the
  // platform's own FormData encoder and compute percentiles ourselves.
  const analyze = await loadTest({
    concurrency: 4, iterations: 60,
    fn: () => {
      const fd = new FormData();
      fd.append("file", new Blob([csv], { type: "text/csv" }), "p.csv");
      fd.append("question", "สรุป");
      return fetch(`${base}/api/analyze`, { method: "POST", body: fd });
    },
  });

  // Upload: the authenticated write path with a real 732 KB file. Captures a
  // dataset id so inference can hit a dataset that exists in THIS pass's DB.
  let datasetId = null;
  const upload = await loadTest({
    concurrency: 2, iterations: 6,
    fn: async () => {
      const fd = new FormData();
      fd.append("file", new Blob([BIG_CSV], { type: "text/csv" }), "big_sales.csv");
      const res = await fetch(`${base}/api/datasets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.id) datasetId = j.id;
      }
      return res;
    },
  });
  if (!datasetId) {
    console.error("✗ upload phase returned no dataset id — cannot benchmark inference.");
    process.exit(2);
  }

  // Inference: full-rows statistics on the saved dataset, every request.
  const inference = await loadTest({
    concurrency: 3, iterations: 24,
    fn: () => fetch(`${base}/api/inference/${datasetId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ test: "regression", xColumn: "Price", yColumn: "Revenue" }),
    }),
  });

  // A benchmark that measures the error path is worse than no benchmark.
  for (const [name, r] of [["health", health], ["metrics", metrics], ["analyze", analyze], ["upload", upload], ["inference", inference]]) {
    const bad = (r.non2xx ?? 0) + (r.errors ?? 0);
    if (bad > 0 || r["2xx"] === 0) {
      console.error(`✗ ${name}: ${bad} non-2xx/errors, ${r["2xx"]} successes — benchmark hit the failure path, numbers are meaningless.`);
      console.error(`  statusCodeStats:`, JSON.stringify(r.statusCodeStats ?? {}));
      process.exit(2);
    }
  }

  return {
    healthP95Ms:    health.latency.p95  ?? health.latency.p97_5  ?? health.latency.p99,
    metricsP95Ms:   metrics.latency.p95 ?? metrics.latency.p97_5 ?? metrics.latency.p99,
    analyzeP95Ms:   analyze.latency.p95,
    uploadP95Ms:    upload.latency.p95,
    inferenceP95Ms: inference.latency.p95,
    healthReqSec:    Math.round(health.requests.average),
    analyzeReqSec:   Math.round(analyze.requests.average),
    inferenceReqSec: Math.round(inference.requests.average),
  };
}

const budget = JSON.parse(readFileSync(BUDGET, "utf8"));

if (process.argv.includes("--update")) {
  // Two calibration lessons, both paid for:
  //   1. One pass burned us — a boosted, cache-warm pass measured health at
  //      ~3ms p95 and the very next cold run missed 3 of 5 budgets.
  //   2. Three passes inside ONE warm process burned us again: all three
  //      measured hot (worst still 3ms → healthP95Ms 16) because the slow
  //      mode on a desktop lives BETWEEN invocations — cold node spawn,
  //      antivirus scanning the fresh temp dir, boost clocks decaying — not
  //      between back-to-back passes in a warm process.
  // So every calibration pass now boots its own fresh server, which is
  // exactly what every future verify run and every CI run is. The budget
  // keys off the WORST latency and LOWEST throughput seen, plus headroom.
  // A budget must be repeatable on a bad minute, not achievable on a good one.
  const passes = [];
  for (let i = 1; i <= 3; i++) {
    console.log(`Calibration pass ${i}/3 (fresh server)…`);
    const ctx = await bootServer(3299 + i);
    const p = await measureOnce(ctx);
    ctx.stop();
    console.log(`  health ${p.healthP95Ms}ms/${p.healthReqSec}rps · metrics ${p.metricsP95Ms}ms · analyze ${p.analyzeP95Ms}ms/${p.analyzeReqSec}rps · upload ${p.uploadP95Ms}ms · inference ${p.inferenceP95Ms}ms/${p.inferenceReqSec}rps`);
    passes.push(p);
  }
  const worst = (k, dir) => dir === "max" ? Math.max(...passes.map(p => p[k])) : Math.min(...passes.map(p => p[k]));
  budget.api = {
    healthP95Ms:      Math.ceil(worst("healthP95Ms", "max")    * 2 + 10),
    metricsP95Ms:     Math.ceil(worst("metricsP95Ms", "max")   * 2 + 10),
    analyzeP95Ms:     Math.ceil(worst("analyzeP95Ms", "max")   * 2 + 50),
    uploadP95Ms:      Math.ceil(worst("uploadP95Ms", "max")    * 2 + 100),
    inferenceP95Ms:   Math.ceil(worst("inferenceP95Ms", "max") * 2 + 50),
    healthReqSecMin:    Math.floor(worst("healthReqSec", "min")    * 0.5),
    analyzeReqSecMin:   Math.floor(worst("analyzeReqSec", "min")   * 0.5),
    inferenceReqSecMin: Math.floor(worst("inferenceReqSec", "min") * 0.5),
  };
  writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + "\n");
  console.log("\n✓ perf-budget.json api targets updated from the worst of 3 cold passes:", budget.api);
  process.exit(0);
}

// Normal mode: refuse to run half-blind. A missing key means new targets were
// added without recalibrating — silently skipping them is the decorative-
// benchmark trap this script keeps escaping.
for (const k of ["healthP95Ms", "metricsP95Ms", "analyzeP95Ms", "uploadP95Ms", "inferenceP95Ms", "healthReqSecMin", "analyzeReqSecMin", "inferenceReqSecMin"]) {
  if (budget.api[k] == null) {
    console.error(`✗ perf-budget.json is missing api.${k} — run: npm run perf:api -w backend -- --update`);
    process.exit(1);
  }
}

console.log("\nRunning API benchmarks (real server, mock AI)…\n");
const ctx = await bootServer(3299);
const actual = await measureOnce(ctx);
ctx.stop();

/**
 * CPU scaling factor (v21). /api/analyze, upload, and inference are CPU-bound
 * and a shared 2-core CI runner measures several times slower on them, while
 * I/O-bound health/metrics barely move. Budgets are scaled rather than
 * skipped — `|| true` would make the benchmark decorative. Latency budgets
 * multiply, throughput budgets divide. The tight gate is the unscaled local
 * one — run `npm run perf:api` on your own machine before merging anything
 * that touches these paths.
 */
const F = Number(process.env.PERF_CPU_FACTOR ?? 1) || 1;
const lat = (ms) => Math.ceil(ms * F);
const thr = (rps) => Math.floor(rps / F);
if (F !== 1) console.log(`  (PERF_CPU_FACTOR=${F} — budgets scaled for slower CI hardware)\n`);

const checks = [
  ["health p95",      actual.healthP95Ms,     lat(budget.api.healthP95Ms),      "≤", "ms"],
  ["metrics p95",     actual.metricsP95Ms,    lat(budget.api.metricsP95Ms),     "≤", "ms"],
  ["analyze p95",     actual.analyzeP95Ms,    lat(budget.api.analyzeP95Ms),     "≤", "ms"],
  ["upload p95",      actual.uploadP95Ms,     lat(budget.api.uploadP95Ms),      "≤", "ms"],
  ["inference p95",   actual.inferenceP95Ms,  lat(budget.api.inferenceP95Ms),   "≤", "ms"],
  ["health req/s",    actual.healthReqSec,    thr(budget.api.healthReqSecMin),    "≥", "req/s"],
  ["analyze req/s",   actual.analyzeReqSec,   thr(budget.api.analyzeReqSecMin),   "≥", "req/s"],
  ["inference req/s", actual.inferenceReqSec, thr(budget.api.inferenceReqSecMin), "≥", "req/s"],
];

let failed = 0;
console.log("Latency / throughput budgets:");
for (const [label, got, limit, op, unit] of checks) {
  const ok = op === "≤" ? got <= limit : got >= limit;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(16)} ${String(got).padStart(7)} ${unit.padEnd(5)} ${op} ${limit}`);
}

if (failed) {
  console.error(`\n✗ ${failed} API budget(s) missed. Investigate before merging.\n`);
  process.exit(1);
}
console.log("\n✓ All API latency budgets met.\n");
process.exit(0);

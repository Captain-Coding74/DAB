#!/usr/bin/env node
/**
 * scripts/coverage.mjs — v13 test coverage, measured honestly
 *
 * Runs the in-process suites under Node's built-in V8 coverage and writes
 * metrics/coverage.json for scripts/quality.mjs to enforce.
 *
 * THE HONESTY PROBLEM this solves:
 *   V8 coverage only reports files that were *loaded*. Any module a test
 *   never imports simply vanishes from the report — so "86% coverage" can
 *   silently exclude the biggest file in the repo. (server.js is exactly
 *   that: the in-process tests mount testApp.js instead, and server.js is
 *   only exercised by the E2E suite, which runs in a child process V8 can't
 *   instrument from here.)
 *
 *   So we also walk the source tree and report every file the run never
 *   touched — `uncounted`. A coverage number without that list is a vanity
 *   metric, and CI watches the list so the untested surface can't quietly
 *   grow.
 *
 * Usage: node scripts/coverage.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT  = join(ROOT, "metrics", "coverage.json");

const SKIP = new Set(["node_modules", "dist", "data", ".git", "coverage"]);
const EXT  = new Set([".js", ".jsx", ".mjs"]);
const isTest = (f) => /\.test\.(m?js|jsx)$/.test(f);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : (EXT.has(extname(p)) && out.push(p));
  }
  return out;
}

/**
 * Node prints coverage as an indented tree:
 *   # src            |        |  ...      ← directory (no numbers)
 *   #  auth.js       |  97.62 |  ...      ← file, depth = leading spaces
 * Rebuild full paths by tracking a stack keyed on indent depth.
 */
function parseCoverage(stdout) {
  const files = new Map();
  let all = null;
  const stack = [];

  for (const raw of stdout.split("\n")) {
    if (!raw.startsWith("# ")) continue;
    const body = raw.slice(2);
    if (!body.includes("|")) continue;

    // NB: do NOT trim namePart — its leading whitespace encodes tree depth.
    const parts    = body.split("|");
    const namePart = parts[0];
    const linePct   = (parts[1] || "").trim();
    const branchPct = (parts[2] || "").trim();
    const funcPct   = (parts[3] || "").trim();
    const label = namePart.trim();
    if (!label || label === "file") continue;

    if (label === "all files") {
      all = { lines: +linePct, branches: +branchPct, functions: +funcPct };
      continue;
    }

    const indent = namePart.length - namePart.trimStart().length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();

    if (linePct === "") {                    // directory row
      stack.push({ indent, name: label });
      continue;
    }
    const path = [...stack.map(s => s.name), label].join("/");
    files.set(path, { lines: +linePct, branches: +branchPct, functions: +funcPct });
  }
  return { all, files };
}

function run(label, cwd, cmd) {
  process.stdout.write(`  running ${label} suite under coverage…\n`);
  let out = "";
  try {
    out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    out = (err.stdout || "") + (err.stderr || "");
    if (!out.includes("all files")) {
      console.error(`✗ ${label} tests failed — coverage not collected.\n`);
      process.exit(1);
    }
  }
  return parseCoverage(out);
}

const COV_FLAGS = "--test --experimental-test-coverage --test-coverage-exclude='**/*.test.js' --test-concurrency=1";
const TEST_ENV  = "JWT_SECRET=test-secret-32chars-long!!!! JWT_REFRESH_SECRET=test-refresh-32chars-long! NODE_ENV=test";

const backend = run("backend", join(ROOT, "backend"),
  `${TEST_ENV} node ${COV_FLAGS} src/stats.test.js src/insights.test.js src/agent.test.js src/streaming.test.js src/integration.test.js src/routes.test.js`);

const frontend = run("frontend", join(ROOT, "frontend"),
  `node ${COV_FLAGS} src/lib/api.test.js src/lib/grade.test.js`);

// ── which source files did the run never even load? ────────
const allSrc = [
  ...walk(join(ROOT, "backend", "src")),
  ...walk(join(ROOT, "frontend", "src")),
].filter(f => !isTest(f)).map(f => relative(ROOT, f));

const touched = new Set();
for (const rep of [backend, frontend]) {
  for (const p of rep.files.keys()) {
    // report paths are relative to each package root (e.g. "src/auth.js")
    touched.add(p);
  }
}
const uncounted = allSrc.filter(f => {
  const withoutPkg = f.replace(/^(backend|frontend)\//, "");
  return !touched.has(withoutPkg);
});

const result = {
  ts: new Date().toISOString(),
  backend:  backend.all  || { lines: 0, branches: 0, functions: 0 },
  frontend: frontend.all || { lines: 0, branches: 0, functions: 0 },
  filesCounted:   touched.size,
  filesUncounted: uncounted.length,
  uncounted,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");

console.log(`\nCoverage (V8, in-process suites)\n`);
console.log(`  backend    lines ${result.backend.lines.toFixed(2)}%  branches ${result.backend.branches.toFixed(2)}%  funcs ${result.backend.functions.toFixed(2)}%`);
console.log(`  frontend   lines ${result.frontend.lines.toFixed(2)}%  branches ${result.frontend.branches.toFixed(2)}%  funcs ${result.frontend.functions.toFixed(2)}%`);
console.log(`\n  files counted     ${result.filesCounted}`);
console.log(`  files NEVER loaded by any in-process test: ${result.filesUncounted}`);
for (const f of uncounted.slice(0, 8)) console.log(`    · ${f}`);
if (uncounted.length > 8) console.log(`    … and ${uncounted.length - 8} more`);
console.log(`\n  Note: server.js is exercised by the 17 E2E tests in a child process,`);
console.log(`  which V8 cannot instrument from here — tested, but not counted.\n`);
console.log(`  → ${relative(ROOT, OUT)}\n`);

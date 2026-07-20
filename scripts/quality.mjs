#!/usr/bin/env node
/**
 * scripts/quality.mjs — v13 code-quality metrics, tracked over time
 *
 * Computes and enforces:
 *   - size        largest file (the god-component alarm)
 *   - complexity  worst-function cyclomatic complexity (approximate)
 *   - duplication % of lines inside repeated 6-line blocks
 *   - tests       total test count across suites
 *
 * Every run appends to metrics/history.jsonl, so trends are visible and a
 * regression is a diff, not a vibe. Thresholds live in quality-budget.json.
 *
 * Deliberately dependency-free: no eslint/jscpd/sonar to install, pin, or
 * keep in sync — this runs anywhere Node runs, including CI, in <1s.
 *
 * Usage: node scripts/quality.mjs [--update] [--json]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dirname, "..");
const BUDGET = join(ROOT, "quality-budget.json");
const HIST   = join(ROOT, "metrics", "history.jsonl");

const SRC_DIRS = ["backend/src", "frontend/src"];
const SKIP_DIR = new Set(["node_modules", "dist", "data", ".git"]);
const CODE_EXT = new Set([".js", ".jsx", ".mjs"]);

// ── collect source files ──────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (CODE_EXT.has(extname(p))) out.push(p);
  }
  return out;
}

const files = SRC_DIRS.flatMap(d => {
  const abs = join(ROOT, d);
  return existsSync(abs) ? walk(abs) : [];
});
const isTest = (f) => /\.test\.(m?js|jsx)$/.test(f);
const srcFiles = files.filter(f => !isTest(f));

// Strip comments + blank lines so metrics measure code, not prose.
function codeLines(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")     // block comments
    .split("\n")
    .map(l => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
}

// ── 1. size ───────────────────────────────────────────────
const sizes = srcFiles.map(f => ({
  file: relative(ROOT, f),
  lines: codeLines(readFileSync(f, "utf8")).length,
})).sort((a, b) => b.lines - a.lines);

// ── 2. cyclomatic complexity (approximate, per function) ──
// Counts decision points; good enough to catch a function turning into a maze.
const DECISION = /\b(if|for|while|case|catch|&&|\|\||\?\?)\b|\?[^.:]/g;
function complexityOf(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const fnStart = /(function\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(|([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{)/;
  const results = [];
  let cur = null, depth = 0;

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, "");
    if (!cur) {
      const m = line.match(fnStart);
      if (m && line.includes("{")) {
        cur = { name: m[2] || m[3] || m[4] || "anonymous", cc: 1 };
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        cur.cc += (line.match(DECISION) || []).length;
      }
      continue;
    }
    cur.cc += (line.match(DECISION) || []).length;
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth <= 0) { results.push(cur); cur = null; }
  }
  if (cur) results.push(cur);
  return results.map(r => ({ ...r, file: relative(ROOT, file) }));
}
const complexities = srcFiles.flatMap(complexityOf).sort((a, b) => b.cc - a.cc);

// ── 3. duplication (normalized 6-line window hashing) ─────
const WINDOW = 6;
const seen = new Map();          // hash → [{file, line}]
let dupLines = 0, totalLines = 0;

for (const f of srcFiles) {
  const lines = codeLines(readFileSync(f, "utf8"))
    .map(l => l.replace(/\s+/g, " ").replace(/["'`][^"'`]*["'`]/g, "S"));  // normalize strings/space
  totalLines += lines.length;
  const marked = new Set();
  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const key = lines.slice(i, i + WINDOW).join("\n");
    if (key.length < 60) continue;                 // ignore trivial windows
    if (seen.has(key)) {
      for (let k = i; k < i + WINDOW; k++) marked.add(k);
      seen.get(key).push({ file: relative(ROOT, f), line: i + 1 });
    } else {
      seen.set(key, [{ file: relative(ROOT, f), line: i + 1 }]);
    }
  }
  dupLines += marked.size;
}
const dupBlocks = [...seen.values()].filter(v => v.length > 1);
const dupPct = totalLines ? +((dupLines / totalLines) * 100).toFixed(2) : 0;

// ── 4. tests ──────────────────────────────────────────────
function countTests() {
  let n = 0;
  for (const f of files.filter(isTest)) {
    n += (readFileSync(f, "utf8").match(/^\s*test\(/gm) || []).length;
  }
  // E2E lives outside src/
  const e2e = join(ROOT, "backend", "e2e", "flows.test.mjs");
  if (existsSync(e2e)) n += (readFileSync(e2e, "utf8").match(/^\s*test\(/gm) || []).length;
  return n;
}

// ── 5. coverage (written by scripts/coverage.mjs) ─────────
// Optional: quality still runs without it, but CI always produces it first.
const COV = join(ROOT, "metrics", "coverage.json");
let coverage = null;
if (existsSync(COV)) {
  try { coverage = JSON.parse(readFileSync(COV, "utf8")); } catch {}
}

// v17: the Playwright suite reports on itself (metrics/browser.json).
// Pass rate and console errors are gated; suite duration is recorded but not
// gated — it's machine-dependent, and a flaky time budget trains people to
// ignore the gate (see ADR-0004).
const BROWSER = join(ROOT, "metrics", "browser.json");
let browser = null;
if (existsSync(BROWSER)) {
  try { browser = JSON.parse(readFileSync(BROWSER, "utf8")); } catch {}
}

const actual = {
  files:         srcFiles.length,
  codeLines:     totalLines,
  largestFile:   sizes[0]?.lines ?? 0,
  maxComplexity: complexities[0]?.cc ?? 0,
  duplicationPct: dupPct,
  tests:         countTests(),
  ...(coverage ? {
    coverageLinesPct: +coverage.backend.lines.toFixed(2),
    filesUncounted:   coverage.filesUncounted,
  } : {}),
  ...(browser ? {
    browserPassRate:      browser.passRate,
    browserConsoleErrors: browser.consoleErrors,
    browserSuiteMs:       browser.suiteMs,
    browserAvgTestMs:     browser.avgTestMs,
    browserSlowestMs:     browser.slowest?.ms ?? 0,
    browserSlowestName:   browser.slowest?.name ?? "",
    browserScreenshots:   browser.screenshots,
    browserTraces:        browser.traces,
  } : {}),
};

// ── report ────────────────────────────────────────────────
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ actual, sizes: sizes.slice(0, 5), complexities: complexities.slice(0, 5) }, null, 2));
  process.exit(0);
}

console.log("\nCode quality\n");
console.log(`  source files      ${actual.files}`);
console.log(`  code lines        ${actual.codeLines.toLocaleString()}`);
console.log(`  tests             ${actual.tests}`);
console.log(`  duplication       ${actual.duplicationPct}%  (${dupBlocks.length} repeated blocks)`);
console.log("\n  Largest files:");
for (const s of sizes.slice(0, 5)) console.log(`    ${String(s.lines).padStart(4)}  ${s.file}`);
console.log("\n  Most complex functions:");
for (const c of complexities.slice(0, 5)) console.log(`    cc=${String(c.cc).padStart(3)}  ${c.name}  (${c.file})`);
if (dupBlocks.length) {
  console.log("\n  Top duplicated blocks:");
  for (const b of dupBlocks.slice(0, 3)) console.log(`    ×${b.length}  ${b.map(x => `${x.file}:${x.line}`).join("  ↔  ")}`);
}

if (browser) {
  console.log("\n  Browser (Playwright):");
  console.log(`    ${browser.passed}/${browser.total} passed (${browser.passRate}%) · suite ${browser.suiteMs}ms · avg ${browser.avgTestMs}ms`);
  console.log(`    slowest: "${browser.slowest?.name ?? "—"}" ${browser.slowest?.ms ?? 0}ms`);
  console.log(`    console errors ${browser.consoleErrors} · screenshots ${browser.screenshots} · traces ${browser.traces}`);
}

if (coverage) {
  console.log("\n  Coverage (backend, in-process):");
  console.log(`    lines ${coverage.backend.lines.toFixed(2)}%  branches ${coverage.backend.branches.toFixed(2)}%  funcs ${coverage.backend.functions.toFixed(2)}%`);
  console.log(`    ${coverage.filesUncounted} source files never loaded by an in-process test (E2E covers server.js separately)`);
}

// ── trend: what changed since the last recorded run? ───────
// This is the whole point of the history file — a regression should be a
// diff you can see, not something you notice three releases later.
function previousRun() {
  if (!existsSync(HIST)) return null;
  const lines = readFileSync(HIST, "utf8").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return null;
}
const prev = previousRun();
if (prev) {
  const TREND = [
    ["largest file",   "largestFile",      "lines", "down"],
    ["max complexity", "maxComplexity",    "cc",    "down"],
    ["duplication",    "duplicationPct",   "%",     "down"],
    ["tests",          "tests",            "tests", "up"],
    ["coverage",       "coverageLinesPct", "%",     "up"],
    ["browser pass",   "browserPassRate",  "%",     "up"],
    ["console errors", "browserConsoleErrors", "",  "down"],
    ["browser suite",  "browserSuiteMs",   "ms",    "down"],
  ];
  const rows = [];
  for (const [label, key, unit, better] of TREND) {
    if (actual[key] == null || prev[key] == null) continue;
    const delta = +(actual[key] - prev[key]).toFixed(2);
    if (delta === 0) continue;
    const improved = better === "up" ? delta > 0 : delta < 0;
    rows.push(`    ${improved ? "▲" : "▼"} ${label.padEnd(15)} ${prev[key]} → ${actual[key]} ${unit} (${delta > 0 ? "+" : ""}${delta})`);
  }
  console.log("\n  Since last run:");
  console.log(rows.length ? rows.join("\n") : "    (no change)");
}

const budget = JSON.parse(readFileSync(BUDGET, "utf8"));

if (process.argv.includes("--update")) {
  budget.quality = {
    largestFile:    Math.ceil(actual.largestFile * 1.15),
    maxComplexity:  Math.ceil(actual.maxComplexity * 1.2),
    duplicationPct: +(actual.duplicationPct + 1).toFixed(2),
    minTests:       actual.tests,
    ...(actual.coverageLinesPct != null ? {
      minCoverageLinesPct: Math.floor(actual.coverageLinesPct - 2),   // 2pt slack
      maxFilesUncounted:   actual.filesUncounted,                     // can't grow
    } : {}),
    ...(actual.browserPassRate != null ? {
      minBrowserPassRate:      100,   // absolute: a failing user flow is never OK
      maxBrowserConsoleErrors: 0,     // absolute: the app must not shout at users
    } : {}),
  };
  writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + "\n");
  console.log("\n✓ quality-budget.json updated:", budget.quality);
}

// ── history (trend over time) ─────────────────────────────
let sha = "nogit";
try { sha = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
mkdirSync(dirname(HIST), { recursive: true });
appendFileSync(HIST, JSON.stringify({ ts: new Date().toISOString(), sha, ...actual }) + "\n");

// ── enforce ───────────────────────────────────────────────
if (process.argv.includes("--update")) process.exit(0);

const checks = [
  ["largest file",  actual.largestFile,    budget.quality.largestFile,    "≤", "lines"],
  ["max complexity",actual.maxComplexity,  budget.quality.maxComplexity,  "≤", "cc"],
  ["duplication",   actual.duplicationPct, budget.quality.duplicationPct, "≤", "%"],
  ["tests",         actual.tests,          budget.quality.minTests,       "≥", "tests"],
];
if (coverage && budget.quality.minCoverageLinesPct != null) {
  checks.push(["coverage lines", actual.coverageLinesPct, budget.quality.minCoverageLinesPct, "≥", "%"]);
  checks.push(["files uncounted", actual.filesUncounted,  budget.quality.maxFilesUncounted,   "≤", "files"]);
}
if (browser && budget.quality.minBrowserPassRate != null) {
  checks.push(["browser pass rate", actual.browserPassRate,      budget.quality.minBrowserPassRate,      "≥", "%"]);
  checks.push(["console errors",    actual.browserConsoleErrors, budget.quality.maxBrowserConsoleErrors, "≤", ""]);
}

let failed = 0;
console.log("\nBudgets:");
for (const [label, got, limit, op, unit] of checks) {
  const ok = op === "≤" ? got <= limit : got >= limit;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(15)} ${String(got).padStart(7)} ${unit.padEnd(6)} ${op} ${limit}`);
}

if (failed) {
  console.error(`\n✗ ${failed} quality budget(s) regressed. Split the file, simplify the function, or extract the duplication.\n  If the change is deliberate: npm run quality -- --update\n`);
  process.exit(1);
}
console.log("\n✓ All quality budgets met.  (history → metrics/history.jsonl)\n");

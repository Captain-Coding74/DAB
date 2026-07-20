#!/usr/bin/env node
/**
 * scripts/perf-bundle.mjs — v13 bundle-size budgets
 *
 * Measures the *gzipped* size of everything Vite emits (gzip is what users
 * actually download; raw KB flatters you by ~3×) and fails if the initial
 * payload regresses past the budget in perf-budget.json.
 *
 * "Initial payload" = what the browser must fetch before the dashboard can
 * paint: the entry chunk + its eager imports (react, recharts) + CSS.
 * Lazily-loaded routes (History/Workspace/Auth/Share) are reported but not
 * charged to the initial budget — that's the whole point of splitting them.
 *
 * Usage: node scripts/perf-bundle.mjs [--update] [--json]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dirname, "..");
const DIST   = join(ROOT, "dist");
const BUDGET = join(ROOT, "perf-budget.json");

if (!existsSync(DIST)) {
  console.error("✗ dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const kb = (bytes) => +(bytes / 1024).toFixed(1);

// ── measure every emitted asset, gzipped ──────────────────
const assetDir = join(DIST, "assets");
const assets = readdirSync(assetDir).map(f => {
  const buf = readFileSync(join(assetDir, f));
  return { file: f, raw: kb(buf.length), gzip: kb(gzipSync(buf).length) };
});
const html = readFileSync(join(DIST, "index.html"));
assets.push({ file: "index.html", raw: kb(html.length), gzip: kb(gzipSync(html).length) });

// Don't guess which chunks block first paint — Vite already declares it.
// index.html lists the entry <script> plus every eager dependency as a
// <link rel="modulepreload">. Anything not referenced there is fetched on
// demand. Deriving the split from the build output means a new eager import
// shows up in the budget automatically, instead of hiding behind a regex.
const htmlText  = html.toString();
const referenced = new Set(
  [...htmlText.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(m => m[1])
);
const isInitial = (f) => f === "index.html" || referenced.has(f);

// v17: fonts get their own category. Counting every emitted .woff2 in a
// "total" budget punishes correct font practice: @fontsource emits one file per
// (weight × unicode-range), and a browser downloads only the ranges the page
// actually renders — a Thai user never fetches the Latin-ext file, and vice
// versa. Summing them all would describe a download nobody performs.
const isFont = (f) => /\.(woff2?|ttf|otf|eot)$/i.test(f);

const fonts   = assets.filter(a =>  isFont(a.file));
const initial = assets.filter(a => !isFont(a.file) &&  isInitial(a.file));
const lazy    = assets.filter(a => !isFont(a.file) && !isInitial(a.file));

const sum = (list, k) => +list.reduce((n, a) => n + a[k], 0).toFixed(1);

const actual = {
  initialGzipKb: sum(initial, "gzip"),
  totalGzipKb:   sum([...initial, ...lazy], "gzip"),   // code only — see isFont above
  lazyGzipKb:    sum(lazy,    "gzip"),
  fontsGzipKb:   sum(fonts,   "gzip"),                 // all subsets; nobody downloads them all
  fontCount:     fonts.length,
  assetCount:    assets.length,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ actual, assets }, null, 2));
  process.exit(0);
}

// ── report ────────────────────────────────────────────────
console.log("\nBundle size (gzipped — what users actually download)\n");
console.log("  Initial payload (blocks first paint):");
for (const a of initial.sort((x, y) => y.gzip - x.gzip))
  console.log(`    ${String(a.gzip).padStart(7)} kB  ${a.file}   (raw ${a.raw} kB)`);
console.log(`    ${String(actual.initialGzipKb).padStart(7)} kB  ── TOTAL`);

if (lazy.length) {
  console.log("\n  Lazy routes (fetched on demand — not charged to the budget):");
  for (const a of lazy.sort((x, y) => y.gzip - x.gzip))
    console.log(`    ${String(a.gzip).padStart(7)} kB  ${a.file}`);
}

if (fonts.length) {
  const heaviest = [...fonts].sort((x, y) => y.gzip - x.gzip)[0];
  console.log(`\n  Self-hosted fonts: ${fonts.length} files, ${actual.fontsGzipKb} kB total`);
  console.log(`    A browser fetches only the unicode-ranges it renders, so no user`);
  console.log(`    downloads this total. Heaviest single file: ${heaviest.gzip} kB (${heaviest.file}).`);
}

const budget = JSON.parse(readFileSync(BUDGET, "utf8"));

if (process.argv.includes("--update")) {
  budget.bundle = {
    initialGzipKb: Math.ceil(actual.initialGzipKb * 1.1),   // 10% headroom
    totalGzipKb:   Math.ceil(actual.totalGzipKb   * 1.1),   // code only, fonts excluded
    fontsGzipKb:   Math.ceil(actual.fontsGzipKb   * 1.1),
  };
  writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + "\n");
  console.log("\n✓ perf-budget.json bundle budgets updated:", budget.bundle);
  process.exit(0);
}

const checks = [
  ["initial payload", actual.initialGzipKb, budget.bundle.initialGzipKb],
  ["total code",      actual.totalGzipKb,   budget.bundle.totalGzipKb],
  ...(budget.bundle.fontsGzipKb != null
    ? [["fonts (all subsets)", actual.fontsGzipKb, budget.bundle.fontsGzipKb]]
    : []),
];

let failed = 0;
console.log("\nBudgets:");
for (const [label, got, limit] of checks) {
  const ok = got <= limit;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(16)} ${String(got).padStart(7)} kB gzip ≤ ${limit} kB`);
}

if (failed) {
  console.error(`\n✗ ${failed} bundle budget(s) regressed.\n  Lazy-load the new dependency, or if the weight is deliberate: npm run perf:bundle -- --update\n`);
  process.exit(1);
}
console.log("\n✓ All bundle budgets met.\n");

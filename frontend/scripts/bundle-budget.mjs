/**
 * scripts/bundle-budget.mjs — v13
 *
 * Fails the build when the shipped JS/CSS grows past budget. Measures the
 * GZIPPED size of what users actually download, because that's the number
 * that costs real people real seconds.
 *
 * Budgets live in perf-budget.json so a change to them is a visible,
 * reviewable diff — not a silent drift.
 *
 * Usage:  node scripts/bundle-budget.mjs [--update]
 *   --update  rewrite the budget to current sizes (use deliberately)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, "..");
const DIST       = join(ROOT, "dist", "assets");
const BUDGET     = join(ROOT, "perf-budget.json");

const kb = (bytes) => +(bytes / 1024).toFixed(1);

function measure() {
  let files;
  try { files = readdirSync(DIST); }
  catch { console.error("✗ dist/assets not found — run `npm run build` first."); process.exit(1); }

  // Group by role: the entry chunk is what every visitor pays on first paint.
  const groups = { entry: 0, vendor: 0, lazy: 0, css: 0 };
  const detail = [];

  for (const f of files) {
    const bytes = gzipSync(readFileSync(join(DIST, f))).length;
    const role =
      f.endsWith(".css")                        ? "css"
      : /^(react|charts)-/.test(f)              ? "vendor"
      : /^(index)-.*\.js$/.test(f)              ? "entry"
      : "lazy";
    groups[role] += bytes;
    detail.push({ file: f, role, gzipKB: kb(bytes) });
  }

  const total = Object.values(groups).reduce((a, b) => a + b, 0);
  return {
    detail: detail.sort((a, b) => b.gzipKB - a.gzipKB),
    actual: {
      entryKB:  kb(groups.entry),
      vendorKB: kb(groups.vendor),
      lazyKB:   kb(groups.lazy),
      cssKB:    kb(groups.css),
      totalKB:  kb(total),
    },
  };
}

const { detail, actual } = measure();
const budget = JSON.parse(readFileSync(BUDGET, "utf8"));

if (process.argv.includes("--update")) {
  budget.bundle = actual;
  writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + "\n");
  console.log("✓ perf-budget.json updated to current sizes:", actual);
  process.exit(0);
}

console.log("\nBundle (gzipped):");
for (const d of detail) console.log(`  ${String(d.gzipKB).padStart(7)} KB  ${d.role.padEnd(6)} ${d.file}`);

let failed = 0;
console.log("\nBudget check:");
for (const [key, limit] of Object.entries(budget.bundle)) {
  const got = actual[key];
  const ok  = got <= limit;
  if (!ok) failed++;
  const delta = (got - limit).toFixed(1);
  console.log(`  ${ok ? "✓" : "✗"} ${key.padEnd(9)} ${String(got).padStart(7)} KB / ${limit} KB${ok ? "" : `  (+${delta} KB OVER)`}`);
}

if (failed) {
  console.error(`\n✗ ${failed} bundle budget(s) exceeded.\n  Fix the regression, or if the growth is intentional run:\n    npm run perf:bundle -- --update   (and justify it in the PR)\n`);
  process.exit(1);
}
console.log("\n✓ All bundle budgets met.\n");

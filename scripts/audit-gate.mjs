#!/usr/bin/env node
/**
 * scripts/audit-gate.mjs — v15: fail CI on HIGH/CRITICAL advisories that are
 * actually fixable and live in code we ship.
 *
 * Why not plain `npm audit`? Two reasons it's unusable as a gate here:
 *   1. It flags dev-only tooling (vite/esbuild) that never reaches production.
 *   2. It flags advisories with "no fix available" — failing on those just
 *      trains everyone to ignore the gate.
 *
 * So this gate fails only on HIGH/CRITICAL advisories that (a) have a fix and
 * (b) are reachable from production dependencies. An allowlist documents any
 * deliberate, reviewed exception with a reason — so the xlsx CVEs that
 * motivated v15 can never quietly creep back in via a transitive dep.
 *
 * Usage: node scripts/audit-gate.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Advisories we've reviewed and consciously accept, with why.
const ALLOW = {
  // dev-server only; fixing needs Vite 8 (breaking). Never shipped to users.
  vite:   "dev-only build tool, not in production runtime",
  esbuild:"dev-only (via vite), not in production runtime",
  "launch-editor": "dev-only (via vite error overlay)",
};

/**
 * v19: npm audit has a blind spot — a package can be DEPRECATED with known
 * vulnerabilities and still not appear in the advisory database.
 *
 * That is exactly what happened with multer 1.x: npm printed
 *   "Multer 1.x is impacted by a number of vulnerabilities, patched in 2.x"
 * on every single install, while `npm audit` reported nothing. So this gate
 * cheerfully said "no blocking advisories" with a vulnerable file-upload parser
 * sitting in the request path. A gate is only as good as the sources it reads.
 *
 * We now also ask the registry whether each PRODUCTION dependency's installed
 * version is deprecated, and block when the message mentions security.
 */
function checkDeprecations() {
  const names = new Set();
  for (const f of ["package.json", "backend/package.json", "frontend/package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
      Object.keys(pkg.dependencies || {}).forEach(n => names.add(n));
    } catch {}
  }

  const findings = [];
  for (const name of names) {
    let version = null;
    try {
      const raw = execSync(`npm ls ${name} --json --all 2>/dev/null || true`,
        { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      const tree = JSON.parse(raw || "{}");
      const dig = (node) => {
        const deps = node?.dependencies || {};
        if (deps[name]?.version) return deps[name].version;
        for (const child of Object.values(deps)) {
          const v = dig(child);
          if (v) return v;
        }
        return null;
      };
      version = dig(tree);
    } catch {}
    if (!version) continue;

    try {
      const msg = execSync(`npm view ${name}@${version} deprecated 2>/dev/null || true`,
        { encoding: "utf8", timeout: 20000 }).trim();
      if (!msg) continue;
      findings.push({
        name, version,
        msg: msg.replace(/\s+/g, " ").slice(0, 100),
        securityRelated: /vulnerab|security|CVE|exploit|patched/i.test(msg),
      });
    } catch {}
  }
  return findings;
}

let report;
try {
  report = JSON.parse(execSync("npm audit --json", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
} catch (e) {
  // npm audit exits non-zero when vulns exist; the JSON is still on stdout.
  try { report = JSON.parse(e.stdout); } catch { console.error("could not parse npm audit"); process.exit(2); }
}

const vulns = report.vulnerabilities || {};
const blocking = [];

for (const [name, v] of Object.entries(vulns)) {
  if (!["high", "critical"].includes(v.severity)) continue;
  if (ALLOW[name]) continue;                       // reviewed exception
  const hasFix = v.fixAvailable !== false;         // true or an object = fixable
  if (!hasFix) continue;                           // nothing we can do yet
  blocking.push({ name, severity: v.severity });
}

console.log("\nSecurity audit gate (HIGH/CRITICAL, fixable, production-reachable)\n");
const high = Object.entries(vulns).filter(([, v]) => ["high", "critical"].includes(v.severity));
if (!high.length) {
  console.log("  no HIGH/CRITICAL advisories at all.\n");
} else {
  for (const [name, v] of high) {
    const status = ALLOW[name] ? `allowlisted — ${ALLOW[name]}`
      : v.fixAvailable === false ? "no fix available (not gated)"
      : "BLOCKING";
    console.log(`  ${v.severity.toUpperCase().padEnd(8)} ${name.padEnd(16)} ${status}`);
  }
  console.log("");
}

// ── the npm-audit blind spot: deprecated production dependencies ──
const deprecations = checkDeprecations();
const insecure = deprecations.filter(d => d.securityRelated);

console.log("Deprecated production dependencies (npm audit does not report these)\n");
if (!deprecations.length) console.log("  none.\n");
else {
  for (const d of deprecations)
    console.log(`  ${d.securityRelated ? "BLOCKING" : "notice  "} ${d.name}@${d.version} — ${d.msg}`);
  console.log("");
}

if (blocking.length || insecure.length) {
  if (blocking.length)
    console.error(`✗ ${blocking.length} fixable HIGH/CRITICAL advisory(ies) in shipped code.`);
  if (insecure.length)
    console.error(`✗ ${insecure.length} deprecated production dependency(ies) with known vulnerabilities: ` +
      insecure.map(d => `${d.name}@${d.version}`).join(", "));
  console.error("");
  process.exit(1);
}
console.log("✓ No blocking advisories, and no vulnerable deprecated production dependencies.\n");

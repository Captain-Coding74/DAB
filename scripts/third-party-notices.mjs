#!/usr/bin/env node
/**
 * scripts/third-party-notices.mjs — v21.30: the licence notices DAB ships with
 *
 * MIT, BSD, Apache and the OFL all ask the same thing of whoever passes the
 * software on: keep the copyright notice and the licence with it. DAB serves
 * a browser bundle and runs a server built from ~400 open-source packages and
 * two IBM Plex font families, and it carried none of those notices. This
 * script writes them, from package-lock.json and the installed packages:
 *
 *   THIRD_PARTY_NOTICES.md                     package · version · licence · source, then the licence texts
 *   frontend/public/licenses/third-party.txt   the same as plain text, served at /licenses/third-party.txt
 *   LICENSES/OFL-1.1-IBM-Plex.txt              the fonts' OFL text + IBM's notices (+ a public copy)
 *   tools/hero-bg/assets/OFL.txt               the same for the renamed, MODIFIED outlines there
 *
 * Only PRODUCTION dependencies of backend/ and frontend/: the graph is walked
 * from their "dependencies" over the lockfile's own paths, so build and test
 * tools never appear. Deterministic — sorted by code unit (not locale), no
 * timestamps, nothing machine-specific — so --check can compare bytes.
 *
 * --check exits 1 when an output is stale, when a licence is outside ALLOW and
 * not in REVIEWED, or when a modified font uses the reserved name again.
 * Anything outside the allow-list is reported for a person to look at, never
 * silently accepted: a REVIEWED entry pins the exact licence string, so a new
 * version that changes its licence is reported again.
 *
 * Usage: node scripts/third-party-notices.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderMarkdown, renderText, renderFontLicence, tidy } from "./lib/notices-render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = ["backend", "frontend"];

/** Licences DAB may ship without asking anyone. Everything else goes to REVIEWED. */
export const ALLOW = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1",
  "CC0-1.0", "Unlicense", "BlueOak-1.0.0", "Python-2.0", "CC-BY-4.0"]);

/** Outside the allow-list, looked at, shipped for the stated reason. Keyed by name; `licence` must match exactly. */
export const REVIEWED = {
  "buffers": { licence: "", note: "Declares no licence and ships no licence file (0.1.1, 2011). Pulled in by exceljs → unzipper → binary, all MIT; its author also wrote binary (MIT) and chainsaw and traverse (MIT/X11) in the same period. No grant is on record, so the owner should confirm with upstream or replace the chain." },
  "chainsaw": { licence: "MIT/X11", note: "MIT/X11 is the MIT licence under its older name; no licence file in the package (via exceljs → unzipper → binary)." },
  "traverse": { licence: "MIT/X11", note: "MIT/X11 is the MIT licence under its older name; its LICENSE file is the MIT text." },
  "png-js": { licence: "", note: "No licence field in package.json, but its LICENSE file is the MIT licence (Devon Govett). Used by pdfkit." },
  "pako": { licence: "(MIT AND Zlib)", note: "Both permissive: MIT for pako's own code, the zlib licence for the parts ported from zlib, whose notice stays in pako's source files. Its LICENSE file (MIT) is below." },
  "victory-vendor": { licence: "MIT AND ISC", note: "Both terms are in the allow-list: MIT for Victory, ISC for the d3 modules it bundles (used by recharts)." },
};

/**
 * "allowed" for an allow-listed id or an SPDX OR-expression with an allowed
 * alternative ("(MIT OR GPL-3.0-or-later)" may be taken as MIT); "review" for
 * anything else — AND, WITH, nesting, a non-SPDX string, or nothing at all.
 */
export function licenceVerdict(expr) {
  const e = String(expr ?? "").trim().replace(/^\((.*)\)$/, "$1").trim();
  if (ALLOW.has(e)) return "allowed";
  if (/[()]|\s(AND|WITH)\s/.test(e)) return "review";
  const alternatives = e.split(/\s+OR\s+/);
  return alternatives.length > 1 && alternatives.some((id) => ALLOW.has(id)) ? "allowed" : "review";
}

/** The declared licence: "license" (string or {type}), else the legacy "licenses" array (several = a choice). */
export function licenceOf(pkg = {}, lock = {}) {
  const l = pkg.license ?? lock.license;
  if (typeof l === "string") return l.trim();
  if (typeof l?.type === "string") return l.type.trim();
  const types = (Array.isArray(pkg.licenses) ? pkg.licenses : [])
    .map((x) => (typeof x === "string" ? x : x?.type)).filter(Boolean);
  return types.length > 1 ? `(${types.join(" OR ")})` : (types[0] || "");
}

/** Where the source lives, as a browsable https URL: the repository, else the homepage. */
export function sourceOf(pkg = {}) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  let u = String(repo || pkg.homepage || "").trim();
  if (!u) return "";
  const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };
  const short = u.match(/^(github|gitlab|bitbucket):(.+)$/);
  if (short) u = `https://${host[short[1]]}/${short[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`;   // "user/repo" shorthand
  u = u.replace(/^git\+/, "").replace(/^git@([^:]+):/, "https://$1/").replace(/^(git|ssh):\/\/(git@)?/, "https://")
       .replace(/^http:\/\//, "https://");
  return /github\.com|gitlab\.com|bitbucket\.org/.test(u) ? u.replace(/#.*$/, "").replace(/\.git$/, "") : u;
}

const authorOf = (pkg) => (typeof pkg.author === "string" ? pkg.author.replace(/\s*[<(].*$/, "") : pkg.author?.name || "").trim();
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
export const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // not localeCompare: same order on every machine

/** Node's lookup over lockfile paths: a/node_modules/b looks in its own node_modules, then a's, then the root's. */
function resolveIn(packages, from, name) {
  for (let dir = from; ; ) {
    const key = `${dir ? `${dir}/` : ""}node_modules/${name}`;
    if (packages[key]) return key;
    if (!dir) return null;
    const i = dir.lastIndexOf("/node_modules/");
    dir = i >= 0 ? dir.slice(0, i) : "";
  }
}

/** Lockfile key → key of the package that first pulled it in, for everything the workspaces need at runtime. */
export function productionKeys(packages, workspaces = WORKSPACES) {
  const found = new Map();
  const visit = (from) => {
    const p = packages[from] || {};
    const deps = { ...p.peerDependencies, ...p.optionalDependencies, ...p.dependencies };
    for (const name of Object.keys(deps).sort(byCodeUnit)) {
      const key = resolveIn(packages, from, name);
      // missing: an optional peer nobody installed (pg-native, bufferutil …); link: a workspace, i.e. DAB itself
      if (!key || found.has(key) || packages[key].link) continue;
      found.set(key, from);
      visit(key);
    }
  };
  for (const ws of workspaces) visit(ws);
  return found;
}

// LICENSE, LICENCE.md, LICENSE-MIT, COPYING, NOTICE (Apache-2.0 §4(d) asks for it to travel too),
// and the *.LICENSE.txt files bundlers extract from minified code (swagger-ui-dist).
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(?![a-z])|\.licen[cs]e\.txt$|notice\.txt$/i;
function licenceTexts(dir) {
  const files = readdirSync(dir).filter((f) => LICENCE_FILE.test(f) && statSync(join(dir, f)).isFile()).sort(byCodeUnit);
  const read = (f) => tidy(readFileSync(join(dir, f), "utf8"));
  if (files.length < 2) return files.length ? read(files[0]) : "";
  return files.map((f) => `--- ${f} ---\n\n${read(f)}`).join("\n\n");
}

const nameOf = (packages, key) => packages[key]?.name || key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);

/** One row per installed production package, sorted by name then version. */
export function collect(root = ROOT) {
  const packages = readJson(join(root, "package-lock.json")).packages;
  const rows = [];
  for (const [key, via] of productionKeys(packages)) {
    const lock = packages[key], name = nameOf(packages, key);
    // A prebuilt binary for one OS/CPU (@libsql/linux-x64-gnu …): every machine installs a different
    // one, so it is described from the lockfile alone and the output is the same everywhere.
    if (lock.optional && (lock.os || lock.cpu)) {
      rows.push({ name, version: lock.version, licence: licenceOf({}, lock), source: "", via: nameOf(packages, via), texts: null });
      continue;
    }
    const dir = join(root, key);
    if (!existsSync(join(dir, "package.json"))) throw new Error(`${key} is not installed — run npm ci first`);
    const pkg = readJson(join(dir, "package.json"));
    rows.push({ name, version: pkg.version ?? lock.version, licence: licenceOf(pkg, lock), source: sourceOf(pkg),
                author: authorOf(pkg), texts: licenceTexts(dir) });
  }
  return rows.sort((a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.version, b.version));
}

/** Split rows outside the allow-list into reviewed (with the note) and unreviewed. */
export function review(rows, reviewed = REVIEWED) {
  const out = { reviewed: [], unreviewed: [] };
  for (const r of rows) {
    if (licenceVerdict(r.licence) === "allowed") continue;
    const entry = reviewed[r.name];
    if (entry && entry.licence === r.licence) out.reviewed.push({ ...r, note: entry.note });
    else out.unreviewed.push(r);
  }
  return out;
}

// ── fonts ─────────────────────────────────────────────────
const FONT_PACKAGES = [["IBM Plex Sans Thai", "@fontsource/ibm-plex-sans-thai"], ["IBM Plex Mono", "@fontsource/ibm-plex-mono"]];
const OFL_START = "This Font Software is licensed under the SIL Open Font License, Version 1.1.";
const HERO_ASSETS = "tools/hero-bg/assets";

/** IBM's copyright notices and the OFL body, exactly as the installed font packages ship them. */
function fontNotices(root) {
  const fonts = FONT_PACKAGES.map(([family, pkgName]) => {
    const dir = join(root, "node_modules", pkgName);
    const text = tidy(readFileSync(join(dir, "LICENSE"), "utf8"));
    const at = text.indexOf(OFL_START);
    if (at < 0) throw new Error(`${pkgName}/LICENSE is not the SIL OFL 1.1 text`);
    return { family, pkgName, version: readJson(join(dir, "package.json")).version,
             copyright: text.slice(0, at).trim(), body: text.slice(at) };
  });
  if (fonts.some((f) => f.body !== fonts[0].body)) throw new Error("the font packages ship different licence texts");
  return fonts;
}

/** The modified outlines in tools/hero-bg/assets, and any that still use the reserved name "Plex". */
export function derivedFonts(root = ROOT) {
  const dir = join(root, HERO_ASSETS);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".typeface.json")).sort(byCodeUnit) : [];
  const list = files.map((file) => {
    const j = readJson(join(dir, file));
    return { file, family: j.familyName, names: [file, j.familyName, j.original_font_information?.fontFamily] };
  });
  const problems = list.filter((d) => d.names.some((n) => /plex/i.test(String(n ?? ""))))
    .map((d) => `${HERO_ASSETS}/${d.file}: a modified font may not use the Reserved Font Name "Plex"`);
  return { list, problems };
}

/** Path (from the repo root) → exact file contents. */
export function buildOutputs(root = ROOT) {
  const rows = collect(root);
  const verdicts = review(rows);
  const fonts = fontNotices(root);
  const derived = derivedFonts(root);
  const ofl = renderFontLicence(fonts);
  return {
    rows, verdicts, problems: derived.problems,
    files: {
      "THIRD_PARTY_NOTICES.md": renderMarkdown(rows, verdicts.reviewed),
      "frontend/public/licenses/third-party.txt": renderText(rows, verdicts.reviewed),
      "LICENSES/OFL-1.1-IBM-Plex.txt": ofl,
      "frontend/public/licenses/OFL-1.1-IBM-Plex.txt": ofl,
      [`${HERO_ASSETS}/OFL.txt`]: renderFontLicence(fonts, derived.list),
    },
  };
}

function main() {
  const check = process.argv.includes("--check");
  const { rows, verdicts, problems, files } = buildOutputs();
  const stale = [];
  for (const [rel, text] of Object.entries(files)) {
    const file = join(ROOT, rel);
    // CRLF-tolerant: a Windows checkout with core.autocrlf must not read as stale
    const current = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === text) continue;
    if (check) { stale.push(rel); continue; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`  wrote ${rel}`);
  }
  const counts = {};
  for (const r of rows) counts[r.licence || "(none)"] = (counts[r.licence || "(none)"] || 0) + 1;
  console.log(`\nThird-party notices: ${rows.length} production packages`);
  console.log(`  ${Object.entries(counts).sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0])).map(([l, n]) => `${l} ${n}`).join(" · ")}`);
  for (const r of verdicts.reviewed) console.log(`  reviewed  ${r.name}@${r.version}  "${r.licence}"`);
  for (const r of verdicts.unreviewed) console.error(`✗ needs review: ${r.name}@${r.version} declares "${r.licence || "no licence"}" — add it to REVIEWED with a reason, or replace it`);
  for (const p of problems) console.error(`✗ ${p}`);
  for (const rel of stale) console.error(`✗ stale: ${rel} — run npm run licenses and commit the result`);
  const failed = stale.length + verdicts.unreviewed.length + problems.length;
  if (!failed) console.log(`✓ ${check ? "notices are current and every licence is allowed or reviewed" : "notices are up to date"}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

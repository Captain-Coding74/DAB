#!/usr/bin/env node
/**
 * scripts/dashboard.mjs — v16 quality dashboard
 *
 * metrics/history.jsonl is appended on every `npm run quality`, but a JSONL
 * file is a log nobody reads. This renders it as a single self-contained HTML
 * page: current values against their budgets, plus a sparkline per metric so a
 * slow drift is visible before it becomes a breach.
 *
 * No dependencies, no build step, no chart library — inline SVG. Open the file.
 *
 * Usage: node scripts/dashboard.mjs   → metrics/dashboard.html
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const HIST = join(ROOT, "metrics", "history.jsonl");
const OUT  = join(ROOT, "metrics", "dashboard.html");

if (!existsSync(HIST)) {
  console.error("✗ metrics/history.jsonl not found — run `npm run quality` first.");
  process.exit(1);
}

const runs = readFileSync(HIST, "utf8").trim().split("\n")
  .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

if (!runs.length) { console.error("✗ no runs recorded yet."); process.exit(1); }

const budget   = JSON.parse(readFileSync(join(ROOT, "quality-budget.json"), "utf8")).quality;
const BROWSER  = join(ROOT, "metrics", "browser.json");
const browser  = existsSync(BROWSER) ? JSON.parse(readFileSync(BROWSER, "utf8")) : null;
const perfFE   = JSON.parse(readFileSync(join(ROOT, "frontend", "perf-budget.json"), "utf8"));
const latest   = runs[runs.length - 1];
const previous = runs.length > 1 ? runs[runs.length - 2] : null;

// direction: "up" = higher is better
const METRICS = [
  { key: "coverageLinesPct", label: "Backend line coverage", unit: "%",     limit: budget.minCoverageLinesPct, cmp: "min", better: "up"   },
  { key: "tests",            label: "Tests",                 unit: "",      limit: budget.minTests,            cmp: "min", better: "up"   },
  { key: "filesUncounted",   label: "Files with no test",    unit: "",      limit: budget.maxFilesUncounted,   cmp: "max", better: "down" },
  { key: "duplicationPct",   label: "Duplicated code",       unit: "%",     limit: budget.duplicationPct,      cmp: "max", better: "down" },
  { key: "maxComplexity",    label: "Max complexity",        unit: " cc",   limit: budget.maxComplexity,       cmp: "max", better: "down" },
  { key: "largestFile",      label: "Largest file",          unit: " lines",limit: budget.largestFile,         cmp: "max", better: "down" },
];

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Inline sparkline; the budget line is drawn in red so a trend toward it is obvious. */
function sparkline(values, limit, better) {
  const W = 150, H = 34, P = 3;
  if (values.length < 2) return `<div class="spark-empty">one run — no trend yet</div>`;
  const all  = [...values, limit];
  const lo   = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i) => P + (i / (values.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / span) * (H - 2 * P);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const ok = better === "up" ? last >= limit : last <= limit;
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="trend">
    <line x1="${P}" y1="${y(limit).toFixed(1)}" x2="${W - P}" y2="${y(limit).toFixed(1)}"
          stroke="#C13B27" stroke-width="1" stroke-dasharray="3 2" opacity=".55"/>
    <polyline points="${pts}" fill="none" stroke="${ok ? "#2F6B4F" : "#C13B27"}" stroke-width="1.6"
              stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.4" fill="${ok ? "#2F6B4F" : "#C13B27"}"/>
  </svg>`;
}

const cards = METRICS.map(m => {
  const series = runs.map(r => r[m.key]).filter(v => typeof v === "number");
  const value  = latest[m.key];
  if (typeof value !== "number") return "";
  const prev   = previous?.[m.key];
  const delta  = typeof prev === "number" ? +(value - prev).toFixed(2) : null;
  const pass   = m.cmp === "min" ? value >= m.limit : value <= m.limit;
  const improved = delta === null || delta === 0 ? null : (m.better === "up" ? delta > 0 : delta < 0);

  const deltaHtml = delta === null || delta === 0
    ? `<span class="delta flat">no change</span>`
    : `<span class="delta ${improved ? "good" : "bad"}">${improved ? "▲" : "▼"} ${delta > 0 ? "+" : ""}${delta}${m.unit.trim()}</span>`;

  return `<article class="card ${pass ? "" : "fail"}">
    <p class="eyebrow">${esc(m.label)}</p>
    <div class="row">
      <span class="value">${esc(value)}<span class="unit">${esc(m.unit)}</span></span>
      ${sparkline(series, m.limit, m.better)}
    </div>
    <div class="foot">
      <span class="budget ${pass ? "ok" : "bad"}">${pass ? "✓" : "✗"} budget ${m.cmp === "min" ? "≥" : "≤"} ${esc(m.limit)}${esc(m.unit)}</span>
      ${deltaHtml}
    </div>
  </article>`;
}).join("\n");

// ── browser cards (v17) ────────────────────────────────────
const BROWSER_METRICS = [
  { key: "browserPassRate",      label: "Playwright pass rate", unit: "%",  limit: budget.minBrowserPassRate,      cmp: "min", better: "up"   },
  { key: "browserConsoleErrors", label: "Browser console errors", unit: "", limit: budget.maxBrowserConsoleErrors, cmp: "max", better: "down" },
  { key: "browserSuiteMs",       label: "Suite duration",       unit: " ms", limit: null,                          cmp: null,  better: "down" },
  { key: "browserAvgTestMs",     label: "Avg test duration",    unit: " ms", limit: null,                          cmp: null,  better: "down" },
  { key: "browserScreenshots",   label: "Failure screenshots",  unit: "",    limit: null,                          cmp: null,  better: "down" },
  { key: "browserTraces",        label: "Failure traces",       unit: "",    limit: null,                          cmp: null,  better: "down" },
];

const browserCards = !browser ? "" : BROWSER_METRICS.map(m => {
  const value = latest[m.key];
  if (typeof value !== "number") return "";
  const series = runs.map(r => r[m.key]).filter(v => typeof v === "number");
  const prev   = previous?.[m.key];
  const delta  = typeof prev === "number" ? +(value - prev).toFixed(2) : null;
  const gated  = m.limit != null;
  const pass   = !gated || (m.cmp === "min" ? value >= m.limit : value <= m.limit);
  const improved = delta === null || delta === 0 ? null : (m.better === "up" ? delta > 0 : delta < 0);

  const deltaHtml = delta === null || delta === 0
    ? `<span class="delta flat">no change</span>`
    : `<span class="delta ${improved ? "good" : "bad"}">${improved ? "▲" : "▼"} ${delta > 0 ? "+" : ""}${delta}${m.unit.trim()}</span>`;

  return `<article class="card ${pass ? "" : "fail"}">
    <p class="eyebrow">${esc(m.label)}</p>
    <div class="row">
      <span class="value">${esc(value)}<span class="unit">${esc(m.unit)}</span></span>
      ${gated ? sparkline(series, m.limit, m.better) : sparkline(series, Math.max(...series, 1) * 1.15, m.better)}
    </div>
    <div class="foot">
      <span class="budget ${gated ? (pass ? "ok" : "bad") : "untracked"}">${
        gated ? `${pass ? "✓" : "✗"} budget ${m.cmp === "min" ? "≥" : "≤"} ${esc(m.limit)}${esc(m.unit)}`
              : "tracked, not gated"
      }</span>
      ${deltaHtml}
    </div>
  </article>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Data Analysis Bot — Quality Dashboard</title>
<style>
  :root { --paper:#F2F4EC; --ink:#171C17; --rule:#C13B27; --stamp:#2F6B4F; --line:#D6DECE; --muted:#5F695E; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 20px 60px; background:var(--paper); color:var(--ink);
         font-family:"IBM Plex Sans Thai",ui-sans-serif,system-ui,sans-serif;
         background-image:repeating-linear-gradient(to bottom,transparent 0 27px,rgba(47,107,79,.05) 27px 28px); }
  .wrap { max-width:1000px; margin:0 auto; }
  header { border-left:2px solid var(--rule); padding-left:14px; margin-bottom:28px; }
  h1 { margin:0; font-size:19px; }
  .sub { margin:4px 0 0; font-size:12px; color:var(--muted); font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 16px;
          box-shadow:0 1px 2px rgba(27,33,29,.06); }
  .card.fail { border-color:var(--rule); box-shadow:0 0 0 1px rgba(193,59,39,.14); }
  .eyebrow { margin:0 0 8px; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10px;
             text-transform:uppercase; letter-spacing:.14em; color:var(--muted); }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .value { font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:26px; font-variant-numeric:tabular-nums; }
  .unit { font-size:13px; color:var(--muted); }
  .spark { width:150px; height:34px; }
  .spark-empty { font-family:"IBM Plex Mono",monospace; font-size:10px; color:#AEB8A9; }
  .foot { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:10px;
          padding-top:9px; border-top:1px solid #EDF0E8;
          font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10px; }
  .budget.ok { color:var(--stamp); } .budget.bad { color:var(--rule); font-weight:600; }
  .delta.good { color:var(--stamp); } .delta.bad { color:var(--rule); } .delta.flat { color:#AEB8A9; }
  .targets { margin-top:26px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:6px 4px; border-bottom:1px solid #EDF0E8; }
  th { font-family:"IBM Plex Mono",monospace; font-size:10px; text-transform:uppercase;
       letter-spacing:.1em; color:var(--muted); font-weight:500; }
  td.num { font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; }
  h2.section { margin:30px 0 12px; font-size:13px; font-family:"IBM Plex Mono",monospace;
               text-transform:uppercase; letter-spacing:.14em; color:var(--muted); font-weight:500;
               border-left:2px solid var(--rule); padding-left:10px; }
  .budget.untracked { color:#AEB8A9; }
  .hint { margin:10px 0 0; font-family:"IBM Plex Mono",monospace; font-size:10px; color:var(--muted); }
  footer { margin-top:22px; font-family:"IBM Plex Mono",monospace; font-size:10px; color:#AEB8A9; }
</style></head>
<body><div class="wrap">
  <header>
    <h1>Quality Dashboard</h1>
    <p class="sub">${runs.length} recorded run${runs.length === 1 ? "" : "s"} ·
       latest ${esc(new Date(latest.ts || Date.now()).toLocaleString("en-GB"))} ·
       dashed red line = budget</p>
  </header>

  <div class="grid">${cards}</div>

  ${browser ? `
  <h2 class="section">Browser suite — Playwright</h2>
  <div class="grid">
    ${browserCards}
  </div>
  <section class="targets">
    <p class="eyebrow">Slowest test in the last run</p>
    <table>
      <tr><th>Test</th><th>Duration</th></tr>
      <tr><td>${esc(browser.slowest?.name ?? "—")}</td><td class="num">${esc(browser.slowest?.ms ?? 0)} ms</td></tr>
    </table>
    ${browser.consoleErrors ? `
    <p class="eyebrow" style="margin-top:14px">Console errors (the app shouting at users)</p>
    <table>${(browser.consoleErrorSamples || []).map(e =>
      `<tr><td>${esc(e.test)}</td><td>${esc(e.text)}</td></tr>`).join("")}</table>` : ""}
    ${browser.screenshots || browser.traces ? `
    <p class="eyebrow" style="margin-top:14px">Failure artifacts</p>
    <table>
      <tr><td>Screenshots</td><td class="num">${browser.screenshots}</td></tr>
      <tr><td>Playwright traces</td><td class="num">${browser.traces}</td></tr>
    </table>
    <p class="hint">Replay a trace: <b>npx playwright show-trace artifacts/browser/&lt;test&gt;.trace.zip</b></p>` : `
    <p class="hint">No failures — no screenshots or traces were written. Both are captured automatically when a test fails.</p>`}
  </section>` : ""}

  <section class="targets">
    <p class="eyebrow">Absolute UX targets — gated in a real browser (scripts/perf-render.mjs)</p>
    <table>
      <tr><th>Metric</th><th>Target</th><th>Why this number</th></tr>
      <tr><td>Largest Contentful Paint</td><td class="num">≤ ${perfFE.render.lcpMs} ms</td><td>Web Vitals "good" threshold</td></tr>
      <tr><td>Analyze — click to painted</td><td class="num">≤ ${perfFE.render.analyzeMs} ms</td><td>product promise</td></tr>
      <tr><td>Client API p95</td><td class="num">≤ ${perfFE.render.apiP95Ms} ms</td><td>includes network, not just server time</td></tr>
      <tr><td>Initial bundle (gzip)</td><td class="num">≤ ${perfFE.bundle.initialGzipKb} kB</td><td>ratchet — recharts is lazy-loaded</td></tr>
    </table>
  </section>

  <footer>Generated by scripts/dashboard.mjs from metrics/history.jsonl — regenerate with <b>npm run dashboard</b></footer>
</div></body></html>`;

writeFileSync(OUT, html);

const failing = [...METRICS, ...(browser ? BROWSER_METRICS.filter(m => m.limit != null) : [])].filter(m => {
  const v = latest[m.key];
  if (typeof v !== "number") return false;
  return m.cmp === "min" ? v < m.limit : v > m.limit;
});

console.log(`\nQuality dashboard → metrics/dashboard.html`);
console.log(`  ${runs.length} run(s) plotted · ${METRICS.length + (browser ? BROWSER_METRICS.length : 0)} metrics`);
console.log(failing.length
  ? `  ✗ ${failing.length} metric(s) outside budget: ${failing.map(f => f.label).join(", ")}\n`
  : `  ✓ every metric inside budget\n`);

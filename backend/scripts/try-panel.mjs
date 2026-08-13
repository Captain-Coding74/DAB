/**
 * Try the panel models on a real file, before there is any UI.
 *
 *   node backend/scripts/try-panel.mjs <file.csv> <unit> <y> <x1> [x2 …]
 *
 * Example — a shop's monthly sales:
 *   node backend/scripts/try-panel.mjs sales.csv shop revenue promo_spend
 *
 * Your CSV must be in LONG format: one row per unit per period.
 *
 *   shop,month,revenue,promo_spend
 *   A,1,120,5
 *   A,2,135,8
 *   B,1,210,3
 *
 * If your spreadsheet has one row per shop and twelve month columns across
 * (wide format), it has to be reshaped first — that is the usual sticking
 * point, and this script will tell you rather than guess.
 */
import { readFileSync } from "node:fs";
import { fixedEffects, randomEffects, hausmanTest } from "../src/services/panel.js";

const [file, unit, y, ...x] = process.argv.slice(2);

if (!file || !unit || !y || x.length === 0) {
  console.log(`
  usage: node backend/scripts/try-panel.mjs <file.csv> <unit> <y> <x1> [x2 …]

    file   a CSV in long format (one row per unit per period)
    unit   the column identifying the unit  (shop, student, branch…)
    y      the outcome you are explaining   (revenue, score…)
    x…     the predictors                   (promo_spend, hours…)

  example:
    node backend/scripts/try-panel.mjs sales.csv shop revenue promo_spend
`);
  process.exit(1);
}

/* minimal CSV read — quoted fields, comma or tab */
const text = readFileSync(file, "utf-8");
const delim = (text.match(/\t/g) || []).length > (text.match(/,/g) || []).length ? "\t" : ",";
const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
const split = (line) => {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
};

const headers = split(lines[0]).map((h) => h.trim());
const rows = lines.slice(1).map((l) => {
  const cells = split(l);
  return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
});

const missing = [unit, y, ...x].filter((c) => !headers.includes(c));
if (missing.length) {
  console.log(`\n  column(s) not found: ${missing.join(", ")}`);
  console.log(`  the file has: ${headers.join(", ")}\n`);
  process.exit(1);
}

const spec = { y, x, unit };
const fe = fixedEffects(rows, spec);

if (fe.error) {
  console.log(`\n  cannot fit a fixed-effects model:\n    ${fe.errorEn}\n    ${fe.error}\n`);
  process.exit(1);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : "—");

console.log(`\n  FIXED EFFECTS  —  ${fe.n} units, ${fe.nObs} rows${fe.balanced ? ", balanced" : ", unbalanced"}`);
console.log(`  within R² ${num(fe.r2Within, 3)}   df ${fe.df}\n`);
console.log(`    ${pad("variable", 20)}${pad("coefficient", 14)}${pad("std. error", 14)}t`);
for (const c of x) {
  console.log(`    ${pad(c, 20)}${pad(num(fe.coefficients[c]), 14)}${pad(num(fe.se[c]), 14)}${num(fe.tStat[c], 2)}`);
}
if (fe.warningEn) console.log(`\n  note: ${fe.warningEn}`);

console.log(`
  Read this as: WITHIN the same ${unit}, a one-unit rise in each predictor
  moves ${y} by the coefficient shown. Everything permanent about a ${unit}
  — size, location, management — has already been cancelled out.
`);

const re = randomEffects(rows, spec);
if (re.error) {
  console.log(`  random effects not available: ${re.errorEn}\n`);
} else {
  console.log(`  RANDOM EFFECTS  —  theta ${num(re.theta, 4)}, ${(re.shareIndividual * 100).toFixed(1)}% of variance is between units\n`);
  for (const c of x) {
    console.log(`    ${pad(c, 20)}${pad(num(re.coefficients[c]), 14)}${num(re.se[c], 4)}`);
  }

  const h = hausmanTest(fe, re);
  if (h.error) {
    console.log(`\n  Hausman test: ${h.errorEn}\n`);
  } else {
    console.log(`\n  HAUSMAN  chi² ${num(h.chi2, 3)}  df ${h.df}  p ${num(h.p, 4)}`);
    console.log(`    ${h.recommendationEn}`);
    console.log(`    ${h.recommendationTh}\n`);
  }
}

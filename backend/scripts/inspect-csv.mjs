/**
 * Ground truth about a CSV, computed independently of DAB's parser.
 *
 *   node backend/scripts/inspect-csv.mjs <file.csv>
 *
 * Written because "MISSING = 0" on a 113,036-row file is either correct or a
 * bug, and the only way to know is to count with different code. This reads
 * the file line by line with no sampling, no accumulators, and no shared
 * logic with services/streaming.js — so if the two disagree, one of them is
 * wrong and the disagreement itself is the finding.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const file = process.argv[2];
if (!file) {
  console.log("\n  usage: node backend/scripts/inspect-csv.mjs <file.csv>\n");
  process.exit(1);
}

/** Split one CSV line, honouring quotes. */
function split(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

let headers = null, delim = ",";
let rows = 0, shortRows = 0, longRows = 0;
let emptyCells = 0, missingFromShort = 0;
const perCol = [];
const widths = new Map();
const seen = new Set();
let exactDupes = 0;

for await (const line of rl) {
  if (line.trim() === "") continue;

  if (headers === null) {
    delim = (line.match(/\t/g) || []).length > (line.match(/,/g) || []).length ? "\t" : ",";
    headers = split(line, delim).map((h) => h.trim());
    headers.forEach(() => perCol.push({ empty: 0, absent: 0 }));
    continue;
  }

  const cells = split(line, delim);
  rows++;
  widths.set(cells.length, (widths.get(cells.length) || 0) + 1);
  if (cells.length < headers.length) shortRows++;
  if (cells.length > headers.length) longRows++;

  for (let i = 0; i < headers.length; i++) {
    if (i >= cells.length) { perCol[i].absent++; missingFromShort++; }
    else if (cells[i].trim() === "") { perCol[i].empty++; emptyCells++; }
  }

  const key = cells.join("\u0000");
  if (seen.has(key)) exactDupes++; else seen.add(key);
}

const pad = (s, n) => String(s).padEnd(n);
const totalMissing = emptyCells + missingFromShort;

console.log(`\n  ${file}`);
console.log(`  ${rows.toLocaleString()} data rows · ${headers.length} columns\n`);

console.log("  ROW WIDTHS");
for (const [w, n] of [...widths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  const tag = w === headers.length ? "(matches header)" : w < headers.length ? "SHORT" : "LONG";
  console.log(`    ${pad(w + " cells", 12)} ${pad(n.toLocaleString() + " rows", 16)} ${tag}`);
}

console.log(`\n  MISSING`);
console.log(`    empty cells written as ""      ${emptyCells.toLocaleString()}`);
console.log(`    cells absent from short rows   ${missingFromShort.toLocaleString()}`);
console.log(`    TOTAL                          ${totalMissing.toLocaleString()}`);

if (totalMissing > 0) {
  console.log(`\n    by column:`);
  headers.forEach((h, i) => {
    const m = perCol[i].empty + perCol[i].absent;
    if (m > 0) console.log(`      ${pad(h, 24)} ${pad(m.toLocaleString(), 10)} ${(m / rows * 100).toFixed(1)}%`);
  });
}

console.log(`\n  DUPLICATES (entire row identical)`);
console.log(`    ${exactDupes.toLocaleString()}  (${(exactDupes / rows * 100).toFixed(2)}% of rows)\n`);

console.log("  Compare these against what DAB reports. A disagreement is a bug in one of us.\n");

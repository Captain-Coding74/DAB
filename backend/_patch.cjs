const fs = require("fs");
let s = fs.readFileSync("src/services/analysisPipeline.js", "utf8");

const qLine = '  const q = String(question ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION) || "\u0e2a\u0e23\u0e38\u0e1b\u0e20\u0e32\u0e1e\u0e23\u0e27\u0e21\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14";';
if (!s.includes(qLine)) { console.error("ANCHOR 1 NOT FOUND"); process.exit(1); }
const inject = qLine + `
  /* School edition: the AI never needs ANY identifier. The parse guard has
     already x'd citizen IDs and phones; the strict pass here additionally
     blanks names, birthdates and student ids before the sample leaves for
     the model. Detection re-runs on the sample rows because this function is
     called with plain arrays — header patterns still catch identifier
     columns whose values are already masked. */
  const sensitive = classifySensitiveColumns(headers, sampleRows);
  const safeRows  = sensitive.length ? maskRows(headers, sampleRows, sensitive, { strict: true }) : sampleRows;`;
s = s.replace(qLine, inject);

const sampleLine = "`${headers.join(\",\")}\n${sampleRows.map(r => r.join(\",\")).join(\"\n\")}\n\n` +";
if (!s.includes(sampleLine)) { console.error("ANCHOR 2 NOT FOUND"); process.exit(1); }
s = s.replace(sampleLine, "`${headers.join(\",\")}\n${safeRows.map(r => r.join(\",\")).join(\"\n\")}\n\n` +");

fs.writeFileSync("src/services/analysisPipeline.js", s);
console.log("patched both anchors");

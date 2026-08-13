/**
 * Read EVERY row of an uploaded file.
 *
 * parseFileStreaming returns `sampleRows`, a bounded reservoir sample — five
 * rows regardless of file size. That is right for a preview and wrong for
 * anything that computes a number a user will act on. Four separate features
 * were silently running on those five rows before this existed: charts,
 * trends, correlations, and the hypothesis tests.
 *
 * Shared by routes/fixes.js and routes/inference.js so the two cannot drift.
 */
/**
 * Read every row. CSV only, and deliberately so: an xlsx would need the whole
 * workbook in memory, and the fix catalogue is aimed at survey exports.
 * Returns { headers: null } for anything else so the caller can say why.
 */
function parseAllRows(buffer, fileName) {
  if (!/\.(csv|tsv|txt)$/i.test(fileName || "")) return { headers: null, rows: null };

  const text = buffer.toString("utf-8");
  const delim = (text.match(/\t/g) || []).length > (text.match(/,/g) || []).length ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };

  const split = (line) => {
    const out = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === delim && !inQ) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };

  const headers = split(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

export { parseAllRows };

/**
 * services/chartSeries.js — aggregated chart data (v21.9, roadmap item 1)
 *
 * v21.4 moved stats, trends and correlations to full rows, but the CHARTS
 * tab kept drawing `sampleRows` — at most 12 rows of a random reservoir
 * sample. For a 10,000-row file the "chart of your data" was 5 arbitrary
 * rows, and a thesis student puts that chart in a defence slide.
 *
 * This enriches each autoChartConfig entry with `data`: real aggregates
 * over EVERY row, grouped by the chart's own xAxis. The frontend prefers
 * `config.data` and falls back to sample shaping only when it is absent
 * (xlsx uploads — parseAllRows is CSV-only by design — and analyses saved
 * before this existed keep rendering).
 *
 * Aggregation rules, kept small and stated in the payload:
 *   - date-like x       → month buckets (YYYY-MM), chronological, last 24
 *   - categorical x     → top 12 buckets by the first measure
 *   - measure columns   → sum, except names that read as a rate or price
 *                         (rating, score, %, price, ราคา, คะแนน …) → mean
 *   - scatter           → no aggregation; real points, evenly strided ≤300
 * The chosen rule ships as `aggregations` so the UI can label the series
 * (รวม/เฉลี่ย) instead of implying raw values. Truncation ships as
 * `truncatedFrom` for the same reason: a labelled cut beats a silent one.
 */

/** Whole-string numeric coercion — same contract as routes/inference.js,
    plus the two things a Thai shop file actually contains: Thai numerals
    (๑๒๓ → 123) and a leading ฿. */
const THAI_DIGITS = { "๐":"0","๑":"1","๒":"2","๓":"3","๔":"4","๕":"5","๖":"6","๗":"7","๘":"8","๙":"9" };
const toNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const s = v.replace(/[๐-๙]/g, (d) => THAI_DIGITS[d]).replace(/[,฿\s]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Messy files put report banners above the real header row, so parseAllRows'
 * first line is junk and none of the chart columns resolve. The streaming
 * parser already worked out the true column names (colAnalysis); find the raw
 * row that matches them and re-anchor. No match → return input unchanged and
 * the caller's guards decline enrichment gracefully.
 */
export function alignHeaders({ headers, rows }, expectedCols = []) {
  if (!headers || !rows?.length || !expectedCols.length) return { headers, rows };
  const hit = (arr) => arr.filter((h) => expectedCols.includes(String(h).trim())).length;
  if (hit(headers) >= Math.ceil(expectedCols.length / 2)) return { headers, rows };
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (hit(rows[i]) >= Math.ceil(expectedCols.length / 2)) {
      return { headers: rows[i].map((h) => String(h).trim()), rows: rows.slice(i + 1) };
    }
  }
  return { headers, rows };
}

const AVG_RE      = /rate|ratio|rating|score|percent|pct|avg|mean|price|ราคา|คะแนน|เฉลี่ย|อัตรา|ร้อยละ/i;
const DATE_VAL_RE = /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?/;

const CAT_CAP   = 12;   // categorical buckets shown
const DATE_CAP  = 24;   // months shown (most recent)
const SCAT_CAP  = 300;  // scatter points shown

export function enrichChartsWithData(autoCharts, headers, rows) {
  if (!Array.isArray(autoCharts) || !autoCharts.length) return autoCharts;
  if (!Array.isArray(headers) || !headers.length || !rows?.length) return autoCharts;
  return autoCharts.map((c) => enrichOne(c, headers, rows));
}

function enrichOne(chart, headers, rows) {
  const xi  = headers.indexOf(chart.xAxis);
  const yis = (chart.yAxis || [])
    .map((col) => [col, headers.indexOf(col)])
    .filter(([, i]) => i >= 0);
  if (xi < 0 || !yis.length) return chart;

  if (chart.type === "scatter") {
    const stride = Math.max(1, Math.ceil(rows.length / SCAT_CAP));
    const pts = [];
    for (let r = 0; r < rows.length; r += stride) {
      const x = toNumber(rows[r][xi]);
      const y = toNumber(rows[r][yis[0][1]]);
      if (x !== null && y !== null) pts.push({ [chart.xAxis]: x, [yis[0][0]]: y });
    }
    return pts.length ? { ...chart, data: pts, sampledEvery: stride } : chart;
  }

  const firstVal = rows.find((r) => String(r[xi] ?? "").trim() !== "")?.[xi];
  /* Values decide, never column names: a name test would send DD/MM/พ.ศ.
     strings through ISO slicing and produce garbage buckets. Non-ISO date
     columns aggregate as categories, which is at least truthful. */
  const dateLike = DATE_VAL_RE.test(String(firstVal ?? ""));
  let keyOf = (v) => String(v ?? "").trim();
  let daily = false;
  if (dateLike) {
    /* Day buckets while the days fit on an axis; month buckets after.
       One month of daily traffic must be ~30 points, not 1 blob. */
    const days = new Set();
    for (const r of rows) { const d = String(r[xi] ?? "").trim().slice(0, 10); if (d) days.add(d); if (days.size > 31) break; }
    daily = days.size <= 31;
    keyOf = daily
      ? (v) => String(v ?? "").trim().slice(0, 10)  // YYYY-MM-DD
      : (v) => String(v ?? "").trim().slice(0, 7);  // YYYY-MM
  }

  const buckets = new Map();
  for (const row of rows) {
    const k = keyOf(row[xi]);
    if (!k) continue;
    let b = buckets.get(k);
    if (!b) { b = { sums: new Array(yis.length).fill(0), counts: new Array(yis.length).fill(0) }; buckets.set(k, b); }
    yis.forEach(([, idx], j) => {
      const v = toNumber(row[idx]);
      if (v !== null) { b.sums[j] += v; b.counts[j] += 1; }
    });
  }
  if (!buckets.size) return chart;
  /* If the first measure never parsed a single number (e.g. a column of
     free text), attaching data would chart confident zeros. Decline. */
  const anyCounted = [...buckets.values()].some((b) => b.counts[0] > 0);
  if (!anyCounted) return chart;

  const aggregations = {};
  yis.forEach(([col]) => { aggregations[col] = AVG_RE.test(col) ? "avg" : "sum"; });

  let entries = [...buckets.entries()].map(([k, b]) => {
    const o = { [chart.xAxis]: k };
    yis.forEach(([col], j) => {
      /* A bucket where the measure never parsed is null, not 0 — recharts
         gaps the line instead of asserting zero revenue that never existed. */
      o[col] = b.counts[j]
        ? Number((aggregations[col] === "avg" ? b.sums[j] / b.counts[j] : b.sums[j]).toFixed(2))
        : null;
    });
    return o;
  });

  const firstY = yis[0][0];
  if (dateLike) entries.sort((a, b) => String(a[chart.xAxis]).localeCompare(String(b[chart.xAxis])));
  else          entries.sort((a, b) => (b[firstY] ?? 0) - (a[firstY] ?? 0));

  const cap = dateLike ? (daily ? 31 : DATE_CAP) : CAT_CAP;
  const truncatedFrom = entries.length > cap ? entries.length : undefined;
  entries = dateLike ? entries.slice(-cap) : entries.slice(0, cap);

  return { ...chart, data: entries, aggregations, ...(truncatedFrom ? { truncatedFrom } : {}) };
}

/**
 * src/services/insights.js — Deterministic Insights Engine (v9)
 *
 * Turns the raw stats pipeline output into a ranked list of
 * human-readable findings — no AI call needed, so it's instant,
 * free, and fully unit-testable.
 *
 * Input shapes (produced by streaming.js / analyze.js):
 *   colAnalysis  numeric: { col, type:"numeric", count, missing, missingPct,
 *                           min, max, avg, median, stdDev, q1, q3, iqr, outlierCount }
 *                text:    { col, type:"text", count, missing, missingPct,
 *                           unique, top:[{value,count,pct}] }
 *   corr         { cols, matrix, strong:[{col1,col2,r}] } | null
 *   forecasts    [{ col, slope, r2, forecast:[{step,predicted}] }]
 *
 * Output:
 *   [{ id, severity, icon, title, detail, metric }]
 *   severity: "critical" > "warning" > "info" > "positive"
 *
 * Titles/details are in Thai to match the product's analysis language.
 */

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, positive: 3 };

const fmt = (n) =>
  typeof n === "number" && isFinite(n)
    ? Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : +n.toFixed(2) === Math.round(n) ? String(Math.round(n))
    : n.toFixed(2)
    : String(n);

export function generateInsights({ colAnalysis = [], totalRows = 0, dupeCount = 0, corr = null, forecasts = [] } = {}) {
  const out = [];
  const push = (id, severity, icon, title, detail, metric = null) =>
    out.push({ id, severity, icon, title, detail, metric });

  // ── 1. Missing data hotspots ────────────────────────────
  for (const c of colAnalysis) {
    const pct = parseFloat(c.missingPct);
    if (!isFinite(pct) || pct <= 0) continue;
    if (pct >= 30) {
      push(`missing:${c.col}`, "critical", "🕳️",
        `คอลัมน์ "${c.col}" ขาดข้อมูลมาก`,
        `หายไป ${c.missing.toLocaleString()} แถว (${pct}%) — ควรตรวจสอบแหล่งข้อมูลหรือพิจารณาตัดคอลัมน์นี้ออกก่อนวิเคราะห์`,
        { missingPct: pct });
    } else if (pct >= 10) {
      push(`missing:${c.col}`, "warning", "⚠️",
        `คอลัมน์ "${c.col}" มีข้อมูลหาย ${pct}%`,
        `หายไป ${c.missing.toLocaleString()} แถว — แนะนำเติมค่า (median/mode) หรือกรองออกก่อนสรุปผล`,
        { missingPct: pct });
    }
  }

  // ── 2. Duplicate rows ───────────────────────────────────
  if (totalRows > 0 && dupeCount > 0) {
    const dupPct = (dupeCount / totalRows) * 100;
    if (dupPct >= 5) {
      push("dupes", "warning", "🔁",
        `พบแถวซ้ำ ${dupeCount.toLocaleString()} แถว (${dupPct.toFixed(1)}%)`,
        `ข้อมูลซ้ำสัดส่วนสูงอาจทำให้ค่าเฉลี่ยและยอดรวมเพี้ยน — ควร deduplicate ก่อนใช้งานจริง`,
        { dupeCount, dupPct: +dupPct.toFixed(1) });
    } else {
      push("dupes", "info", "🔁",
        `พบแถวซ้ำ ${dupeCount.toLocaleString()} แถว`,
        `คิดเป็น ${dupPct.toFixed(1)}% ของข้อมูลทั้งหมด — น้อยแต่ควรทราบไว้`,
        { dupeCount, dupPct: +dupPct.toFixed(1) });
    }
  }

  // ── 3. Outlier-heavy numeric columns ────────────────────
  for (const c of colAnalysis) {
    if (c.type !== "numeric" || !c.count) continue;
    const ratio = (c.outlierCount || 0) / c.count;
    if (c.outlierCount >= 3 && ratio >= 0.05) {
      push(`outliers:${c.col}`, "warning", "📍",
        `"${c.col}" มี outliers ${c.outlierCount.toLocaleString()} จุด (${(ratio * 100).toFixed(1)}%)`,
        `ค่าปกติอยู่ช่วง ${fmt(c.q1)}–${fmt(c.q3)} (IQR) แต่มีค่าที่หลุดช่วงมาก — ตรวจสอบว่าเป็นข้อมูลจริงหรือ error ในการบันทึก`,
        { outlierCount: c.outlierCount, ratio: +(ratio * 100).toFixed(1) });
    }
  }

  // ── 4. Constant / zero-variance columns ─────────────────
  for (const c of colAnalysis) {
    if (c.type === "numeric" && c.count > 1 && c.stdDev === 0) {
      push(`constant:${c.col}`, "info", "➖",
        `"${c.col}" มีค่าเดียวตลอด (${fmt(c.min)})`,
        `คอลัมน์ที่ไม่มีความแปรปรวนไม่ช่วยในการวิเคราะห์ — พิจารณาตัดออกเพื่อลด noise`);
    } else if (c.type === "text" && c.unique === 1 && (c.count || 0) > 1) {
      push(`constant:${c.col}`, "info", "➖",
        `"${c.col}" มีค่าเดียวตลอด`,
        `ทุกแถวมีค่า "${c.top?.[0]?.value}" เหมือนกันหมด — พิจารณาตัดออก`);
    }
  }

  // ── 5. Likely ID columns (high-cardinality text) ────────
  for (const c of colAnalysis) {
    if (c.type !== "text" || !c.count || c.count <= 20) continue;
    if (c.unique / c.count >= 0.95) {
      push(`idcol:${c.col}`, "info", "🆔",
        `"${c.col}" น่าจะเป็นรหัส (ID)`,
        `ค่าไม่ซ้ำ ${c.unique.toLocaleString()} จาก ${c.count.toLocaleString()} แถว (${((c.unique / c.count) * 100).toFixed(0)}%) — ไม่เหมาะกับการทำกราฟแบบจัดกลุ่ม`);
    }
  }

  // ── 6. Dominant category (one value > 70% of a text col) ─
  for (const c of colAnalysis) {
    if (c.type !== "text" || !c.top?.length || c.unique <= 1) continue;
    const t0 = c.top[0];
    const pct = parseFloat(t0.pct);
    if (isFinite(pct) && pct >= 70 && c.unique > 1) {
      push(`dominant:${c.col}`, "info", "👑",
        `"${t0.value}" ครองสัดส่วนใน "${c.col}"`,
        `คิดเป็น ${pct}% ของข้อมูล — กลุ่มอื่นมีตัวอย่างน้อย การเปรียบเทียบระหว่างกลุ่มอาจไม่น่าเชื่อถือ`,
        { value: t0.value, pct });
    }
  }

  // ── 7. Strong correlations ──────────────────────────────
  for (const s of corr?.strong || []) {
    const dir = s.r > 0 ? "ไปทางเดียวกัน" : "สวนทางกัน";
    push(`corr:${s.col1}:${s.col2}`,
      Math.abs(s.r) >= 0.9 ? "positive" : "info", "🔗",
      `"${s.col1}" กับ "${s.col2}" สัมพันธ์กันแรง (r=${s.r})`,
      `เคลื่อนไหว${dir}อย่างชัดเจน — ใช้ทำนายกันได้ หรือถ้าใช้ทั้งคู่ในโมเดลเดียวกันระวัง multicollinearity`,
      { r: s.r });
  }

  // ── 8. Trends from linear forecasts ─────────────────────
  for (const f of forecasts) {
    if (!f || Math.abs(f.slope) < 1e-9 || f.r2 < 0.6) continue;
    const rising = f.slope > 0;
    const next = f.forecast?.[0]?.predicted;
    push(`trend:${f.col}`, rising ? "positive" : "warning", rising ? "📈" : "📉",
      `"${f.col}" มีแนวโน้ม${rising ? "ขาขึ้น" : "ขาลง"}ชัดเจน (R²=${f.r2})`,
      `slope=${f.slope}${next != null ? ` — คาดการณ์ช่วงถัดไป ≈ ${fmt(next)}` : ""}`,
      { slope: f.slope, r2: f.r2 });
  }

  // ── 8.5 Date columns (v20: semantic detection + พ.ศ. handling) ──
  // The parser marks date-majority columns with semantic:"date" and, when
  // Buddhist-Era years were seen, converts them to ค.ศ. for the range.
  for (const c of colAnalysis) {
    if (c.semantic !== "date" || !c.dateRange?.min) continue;
    const be = c.buddhistEra ? " — พบปีแบบ พ.ศ. และแปลงเป็น ค.ศ. ให้อัตโนมัติ" : "";
    push(`daterange:${c.col}`, "info", "📅",
      `"${c.col}" เป็นคอลัมน์วันที่`,
      `ข้อมูลครอบคลุมช่วง ${c.dateRange.min} ถึง ${c.dateRange.max}${be}`,
      { min: c.dateRange.min, max: c.dateRange.max, buddhistEra: !!c.buddhistEra });
  }

  // ── 9. Clean-data bonus ─────────────────────────────────
  const anyMissing = colAnalysis.some(c => parseFloat(c.missingPct) > 0);
  if (totalRows > 0 && !anyMissing && dupeCount === 0) {
    push("clean", "positive", "✅",
      "ข้อมูลสะอาดมาก",
      "ไม่พบค่าหายและไม่มีแถวซ้ำเลย — พร้อมวิเคราะห์ได้ทันที");
  }

  // ── Rank: severity first, then keep insertion order ─────
  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return out.slice(0, 12); // cap so the UI stays digestible
}

/**
 * Data fixes — deterministic operations the AI may PROPOSE but never write.
 *
 * WHY THIS SHAPE
 * --------------
 * "Let the AI clean my data" is the obvious feature and the wrong design. An
 * AI that edits rows directly breaks ADR-0006 (the agent reads computed
 * statistics, never raw rows), and — worse for this product's audience — it
 * produces a thesis the student cannot defend. A committee asking "what did
 * you change and why?" deserves an exact answer.
 *
 * So the split is:
 *   • The AI reads statistics and picks from the CATALOGUE below.
 *   • This module executes the operation. Deterministically. Same input,
 *     same output, every time.
 *   • The caller previews the effect before anything is applied.
 *   • Applying writes a NEW dataset version. The original is never mutated.
 *
 * Every operation returns a `log` line written for a methodology chapter,
 * because that is what the change is ultimately for.
 */

import { parseFlexibleNumber } from "./normalize.js";

/** Resolve a header name to its column index. Rows are positional arrays. */
const idx = (headers, name) => headers.indexOf(name);

/* The ANALYZER's numeric coercion, not a local one. The drop-outliers
   suggestion comes from stats computed with parseFlexibleNumber ("฿1,234.50",
   "1,200 บาท", Thai digits ๐-๙, "(500)"), so the fix must parse exactly the
   values the analysis counted — a comma-only strip rejected every ฿-formatted
   cell and either refused the fix or silently examined the wrong rows. */
const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return parseFlexibleNumber(v);
};

const isBlank = (v) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * The catalogue. The AI may only name one of these — it cannot invent an
 * operation, and it cannot supply code. Adding one here is a deliberate act.
 */
export const OPERATIONS = {
  "drop-missing": {
    th: "ลบแถวที่มีค่าว่างในคอลัมน์ที่เลือก",
    en: "Drop rows with a missing value in the chosen column",
    needs: ["column"],
  },
  "drop-outliers": {
    th: "ลบค่าผิดปกติ (นอกช่วง 1.5 เท่าของพิสัยควอไทล์)",
    en: "Remove outliers outside 1.5 × IQR (Tukey)",
    needs: ["column"],
  },
  "drop-duplicates": {
    th: "ลบแถวที่ซ้ำกันทั้งหมด",
    en: "Remove fully duplicated rows",
    needs: [],
  },
  "merge-categories": {
    th: "รวมค่าที่สะกดต่างกันให้เป็นค่าเดียว",
    en: "Merge values that differ only by spacing or case",
    needs: ["column"],
  },
  "trim-whitespace": {
    th: "ตัดช่องว่างหน้า-หลังในทุกช่อง",
    en: "Trim leading and trailing whitespace everywhere",
    needs: [],
  },
};

/** Normalise a category label for comparison: strip spaces, fold case. */
const foldLabel = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * Run an operation and report what it WOULD do. Pure — never writes.
 * Returns { rows, removed, changed, log, logTh, error }.
 */
export function applyFix(rows, headers, op, params = {}) {
  if (!OPERATIONS[op]) {
    return { error: `ไม่รู้จักการแก้ไข "${op}"`, errorEn: `unknown operation "${op}"` };
  }
  if (!Array.isArray(rows) || !Array.isArray(headers)) {
    return { error: "ข้อมูลไม่ถูกต้อง", errorEn: "rows and headers are required" };
  }

  const spec = OPERATIONS[op];
  if (spec.needs.includes("column")) {
    if (!params.column) {
      return { error: "ต้องเลือกคอลัมน์", errorEn: "a column must be chosen" };
    }
    if (idx(headers, params.column) < 0) {
      return { error: `ไม่พบคอลัมน์ "${params.column}"`, errorEn: `column "${params.column}" not found` };
    }
  }

  const before = rows.length;

  switch (op) {
    case "drop-missing": {
      const i = idx(headers, params.column);
      const kept = rows.filter((r) => !isBlank(r[i]));
      return report(kept, before, 0,
        `Removed ${before - kept.length} row(s) with a missing value in "${params.column}".`,
        `ลบ ${before - kept.length} แถวที่ไม่มีค่าในคอลัมน์ "${params.column}"`);
    }

    case "drop-outliers": {
      const i = idx(headers, params.column);
      const vals = rows.map((r) => toNum(r[i])).filter((v) => v !== null);
      if (vals.length < 4) {
        return { error: "ข้อมูลตัวเลขน้อยเกินไป", errorEn: "not enough numeric values" };
      }

      // Tukey's 1.5 x IQR, NOT 3 standard deviations.
      //
      // The SD rule masks the very values it is meant to catch: one wild
      // number inflates the SD enough to fall inside its own bound. Measured
      // on a realistic fixture — nine values near 100 plus a single 5000 —
      // the 3-SD bound reached 5544, so the 5000 survived. Quartiles are
      // resistant to that, and describeNumeric already flags outliers this
      // way, so the fix now removes exactly what the report flagged.
      const sorted = [...vals].sort((a, b) => a - b);
      const at = (p) => {
        const pos = (sorted.length - 1) * p;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      };
      const q1 = at(0.25), q3 = at(0.75), iqr = q3 - q1;
      if (iqr === 0) {
        return { error: "ไม่มีความแปรปรวน — ไม่มีค่าผิดปกติ", errorEn: "no spread, so no outliers" };
      }
      const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;

      const kept = rows.filter((r) => {
        const v = toNum(r[i]);
        return v === null || (v >= lo && v <= hi);   // blanks are not outliers
      });
      return report(kept, before, 0,
        `Removed ${before - kept.length} outlier row(s) in "${params.column}" outside 1.5 x IQR (Q1 ${q1.toFixed(2)}, Q3 ${q3.toFixed(2)}, kept ${lo.toFixed(2)}-${hi.toFixed(2)}).`,
        `ลบ ${before - kept.length} แถวที่เป็นค่าผิดปกติในคอลัมน์ "${params.column}" (นอกช่วง 1.5 IQR, ช่วงที่เก็บไว้ ${lo.toFixed(2)}-${hi.toFixed(2)})`);
    }

    case "drop-duplicates": {
      const seen = new Set();
      const kept = rows.filter((r) => {
        const key = JSON.stringify(r);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return report(kept, before, 0,
        `Removed ${before - kept.length} fully duplicated row(s).`,
        `ลบ ${before - kept.length} แถวที่ซ้ำกันทั้งหมด`);
    }

    case "merge-categories": {
      const i = idx(headers, params.column);
      // Group by folded label; the most frequent original spelling wins, so
      // the surviving value is one the user actually typed.
      const groups = new Map();
      for (const r of rows) {
        const raw = String(r[i] ?? "");
        if (raw.trim() === "") continue;
        const k = foldLabel(raw);
        if (!groups.has(k)) groups.set(k, new Map());
        const counts = groups.get(k);
        counts.set(raw, (counts.get(raw) || 0) + 1);
      }
      const canonical = new Map();
      let mergedLabels = 0;
      for (const [k, counts] of groups) {
        if (counts.size < 2) continue;
        const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        for (const orig of counts.keys()) if (orig !== winner) { canonical.set(orig, winner); mergedLabels++; }
      }
      if (mergedLabels === 0) {
        return report(rows, before, 0,
          `No near-duplicate values found in "${params.column}".`,
          `ไม่พบค่าที่สะกดต่างกันในคอลัมน์ "${params.column}"`);
      }
      let changed = 0;
      const out = rows.map((r) => {
        const raw = String(r[i] ?? "");
        if (!canonical.has(raw)) return r;
        changed++;
        const copy = [...r];
        copy[i] = canonical.get(raw);
        return copy;
      });
      return report(out, before, changed,
        `Merged ${mergedLabels} spelling variant(s) in "${params.column}", affecting ${changed} row(s).`,
        `รวม ${mergedLabels} รูปแบบการสะกดในคอลัมน์ "${params.column}" กระทบ ${changed} แถว`);
    }

    case "trim-whitespace": {
      let changed = 0;
      const out = rows.map((r) => {
        let touched = false;
        const copy = r.map((v) => {
          if (typeof v !== "string") return v;
          const t = v.trim();
          if (t !== v) touched = true;
          return t;
        });
        if (touched) changed++;
        return touched ? copy : r;
      });
      return report(out, before, changed,
        `Trimmed whitespace in ${changed} row(s).`,
        `ตัดช่องว่างใน ${changed} แถว`);
    }

    default:
      return { error: "ยังไม่รองรับ", errorEn: "not implemented" };
  }
}

function report(rows, before, changed, log, logTh) {
  return {
    rows,
    rowsBefore: before,
    rowsAfter: rows.length,
    removed: before - rows.length,
    changed,
    log,     // for the methodology chapter
    logTh,
  };
}

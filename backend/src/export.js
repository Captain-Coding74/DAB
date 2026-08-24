/**
 * export.js — PDF and Excel report generators
 */

import PDFDocument from "pdfkit";
import ExcelJS     from "exceljs";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { serviceLogger } from "./logger.js";

const log = serviceLogger("export");

/* Thai glyphs in the PDF.
 * ---------------------------------------------------------------------------
 * PDFKit's built-in fonts (Helvetica*) are WinAnsi AFM fonts with NO Thai
 * glyphs — every Thai string (the AI analysis body, Thai column names, a Thai
 * filename, the th-TH date) came out as blank boxes, in a Thai-first product.
 * We embed IBM Plex Sans Thai, which is already a frontend dependency. It ships
 * pre-subsetted: the "thai" file has only Thai glyphs, the "latin" file only
 * Latin/digits/punctuation, and PDFKit cannot fall back within one font — so
 * text is split into Thai vs non-Thai runs (see writeMixed) and each run drawn
 * with the matching subset. If the files can't be loaded we fall back to
 * Helvetica so export still works for Latin content rather than crashing. */
const _require = createRequire(import.meta.url);
const FONTS = (() => {
  try {
    const dir = path.join(path.dirname(_require.resolve("@fontsource/ibm-plex-sans-thai/package.json")), "files");
    const read = (n) => fs.readFileSync(path.join(dir, n));
    return {
      body:   read("ibm-plex-sans-thai-latin-400-normal.woff"),
      bold:   read("ibm-plex-sans-thai-latin-700-normal.woff"),
      bodyTH: read("ibm-plex-sans-thai-thai-400-normal.woff"),
      boldTH: read("ibm-plex-sans-thai-thai-700-normal.woff"),
    };
  } catch (err) {
    log.warn({ err: err.message }, "Thai PDF font not found — PDF export falls back to Helvetica (Thai will not render)");
    return null;
  }
})();

// ── PDF Export ────────────────────────────────────────────
export function generatePDF({ fileName, totalRows, headers, rows, colAnalysis, missing, dupes, corr, forecasts, aiAnalysis, prompt }) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data",  c => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Register the four subset faces (or alias to Helvetica if unavailable).
    // "body"/"bold" carry Latin; "bodyTH"/"boldTH" carry Thai.
    if (FONTS) {
      doc.registerFont("body",   FONTS.body);
      doc.registerFont("bold",   FONTS.bold);
      doc.registerFont("bodyTH", FONTS.bodyTH);
      doc.registerFont("boldTH", FONTS.boldTH);
    } else {
      doc.registerFont("body", "Helvetica");     doc.registerFont("bold", "Helvetica-Bold");
      doc.registerFont("bodyTH", "Helvetica");   doc.registerFont("boldTH", "Helvetica-Bold");
    }

    const isThai = (ch) => ch >= "฀" && ch <= "๿";
    /* Split a string into maximal Thai / non-Thai runs and draw each with the
       matching subset via continued:true, since a single PDFKit font can't
       cover both scripts. Position (x,y) applies to the first run; the caller's
       own `continued` flag closes the last run. */
    function writeMixed(text, { bold = false, x, y, ...opts } = {}) {
      const s = String(text ?? "");
      const runs = [];
      for (const ch of s) {
        const th = isThai(ch);
        const last = runs[runs.length - 1];
        if (last && last.th === th) last.text += ch;
        else runs.push({ text: ch, th });
      }
      if (!runs.length) runs.push({ text: "", th: false });
      runs.forEach((r, i) => {
        const isLast = i === runs.length - 1;
        doc.font(r.th ? (bold ? "boldTH" : "bodyTH") : (bold ? "bold" : "body"));
        const o = { ...opts, continued: isLast ? (opts.continued || false) : true };
        if (i === 0 && x !== undefined) doc.text(r.text, x, y, o);
        else doc.text(r.text, o);
      });
    }

    const GREEN  = "#0d6e56";
    const LGRAY  = "#f3f4f6";
    const DGRAY  = "#374151";
    const pageW  = doc.page.width - 100;
    const date   = new Date().toLocaleDateString("th-TH", { year:"numeric", month:"long", day:"numeric" });

    // ── Header banner
    doc.rect(50, 50, pageW, 60).fill(GREEN);
    doc.fillColor("#fff").fontSize(18);
    writeMixed("Data Analysis Report", { bold: true, x: 65, y: 65 });
    doc.fontSize(10);
    writeMixed(`${fileName}  ·  ${totalRows.toLocaleString()} rows  ·  ${date}`, { x: 65, y: 88 });
    doc.fillColor(DGRAY);
    doc.y = 130;

    function sectionTitle(title) {
      doc.moveDown(0.5)
         .rect(50, doc.y, pageW, 20).fill(LGRAY).fillColor(GREEN)
         .fontSize(11);
      writeMixed(title, { bold: true, x: 56, y: doc.y - 16 });
      doc.fillColor(DGRAY).moveDown(0.5);
    }

    function row2col(label, value) {
      doc.fontSize(9).fillColor("#6b7280");
      writeMixed(label, { x: 56, y: doc.y, continued: true, width: 140 });
      doc.fillColor(DGRAY);
      writeMixed(String(value), { bold: true });
    }

    // ── File info
    sectionTitle("File Information");
    row2col("Filename:",  fileName);
    row2col("Total rows:", totalRows.toLocaleString());
    row2col("Columns:",   headers.length);
    row2col("Prompt:",    prompt);

    // ── Column statistics
    sectionTitle("Column Statistics");
    colAnalysis.forEach(c => {
      if (doc.y > 680) doc.addPage();
      doc.fontSize(10).fillColor(GREEN);
      writeMixed(`> ${c.col}`, { bold: true, x: 56 });   // ">" not "▸": the subset has no U+25B8 (nor did Helvetica)
      doc.fillColor(DGRAY);
      if (c.type === "numeric") {
        doc.fontSize(8.5).font("body")
           .text(`Type: numeric  |  Count: ${c.count?.toLocaleString()}  |  Missing: ${c.missing} (${c.missingPct}%)`, 66)
           .text(`Min: ${c.min}   Max: ${c.max}   Avg: ${c.avg?.toFixed(2)}   Median: ${c.median}   StdDev: ${c.stdDev?.toFixed(2)}`, 66)
           .text(`Q1: ${c.q1}   Q3: ${c.q3}   IQR: ${c.iqr}   Outliers: ${c.outlierCount}`, 66);
      } else {
        const top = c.top?.slice(0,5).map(t=>`${t.value}(${t.pct}%)`).join(", ");
        doc.fontSize(8.5).font("body").text(`Type: text  |  Unique: ${c.unique}  |  Missing: ${c.missing} (${c.missingPct}%)`, 66);
        writeMixed(`Top: ${top}`, { x: 66 });   // categorical values may be Thai
      }
      doc.moveDown(0.3);
    });

    // ── Missing values
    if (missing.length > 0) {
      sectionTitle("Missing Values");
      doc.fontSize(9);
      missing.forEach(m => {
        writeMixed(`${m.col}: ${m.missing} rows missing (${m.pct}%)`, { x: 56 });
      });
    }

    // ── Duplicates
    sectionTitle("Duplicate Rows");
    doc.fontSize(9).font("body").text(`Found ${dupes.count} duplicate rows`, 56);

    // ── Correlation
    if (corr && corr.strong.length > 0) {
      sectionTitle("Strong Correlations (|r| >= 0.7)");   // ">=": the subset has no U+2265
      doc.fontSize(9);
      corr.strong.forEach(s => {
        writeMixed(`${s.col1}  <->  ${s.col2}:  r = ${s.r}`, { x: 56 });   // "<->": no U+2194 glyph
      });
    }

    // ── Forecast
    if (forecasts.length > 0) {
      sectionTitle("Regression & Forecast");
      forecasts.forEach(f => {
        if (doc.y > 680) doc.addPage();
        doc.fontSize(10).fillColor(GREEN);
        writeMixed(`> ${f.col}`, { bold: true, x: 56 });
        doc.fillColor(DGRAY).fontSize(8.5).font("body")
           .text(`Slope: ${f.slope}   Intercept: ${f.intercept}   R²: ${f.r2}`, 66);
        f.forecast.forEach(p => doc.text(`  +${p.step} steps: predicted = ${p.predicted}`, 66));
        doc.moveDown(0.3);
      });
    }

    // ── Sample data
    sectionTitle("Data Preview (5 rows)");
    doc.addPage();
    doc.fontSize(8);
    writeMixed(headers.join("  |  "), { bold: true, x: 50 });
    doc.moveDown(0.2);
    rows.slice(0, 5).forEach(r => {
      writeMixed(r.join("  |  "), { x: 50 });
      doc.moveDown(0.1);
    });

    // ── AI analysis
    sectionTitle("AI Analysis");
    doc.fontSize(9);
    writeMixed(aiAnalysis || "—", { x: 56, y: doc.y, width: pageW - 12, lineGap: 3 });

    // ── Footer
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor("#9ca3af").font("body")
         .text(`Page ${i+1} of ${range.count}  ·  Powered by Data Analysis Bot`, 50, doc.page.height - 40, { align: "center", width: pageW });
    }

    doc.end();
  });
}

// ── Excel Export ──────────────────────────────────────────
export async function generateExcel({ fileName, totalRows, headers, rows, colAnalysis, missing, dupes, corr, forecasts, aiAnalysis }) {
  // v15: exceljs instead of SheetJS (unpatched HIGH CVEs). Each sheet is
  // still built as an array-of-arrays, then handed to addRows — so the
  // report's content and layout are unchanged.
  const wb = new ExcelJS.Workbook();
  wb.creator = "Data Analysis Bot";
  const addSheet = (name, aoa) => wb.addWorksheet(name).addRows(aoa);

  // Sheet 1: Raw data (first 500 rows max)
  addSheet("Data", [headers, ...rows.slice(0, 500)]);

  // Sheet 2: Column stats
  const statsRows = [["Column","Type","Count","Missing","Missing%","Min","Max","Avg","Median","StdDev","Q1","Q3","IQR","Outliers","Unique"]];
  colAnalysis.forEach(c => {
    statsRows.push([
      c.col, c.type, c.count ?? c.count, c.missing, c.missingPct,
      c.type === "numeric" ? c.min : "",
      c.type === "numeric" ? c.max : "",
      c.type === "numeric" ? c.avg?.toFixed(2) : "",
      c.type === "numeric" ? c.median : "",
      c.type === "numeric" ? c.stdDev?.toFixed(2) : "",
      c.type === "numeric" ? c.q1 : "",
      c.type === "numeric" ? c.q3 : "",
      c.type === "numeric" ? c.iqr : "",
      c.type === "numeric" ? c.outlierCount : "",
      c.type === "text"    ? c.unique : "",
    ]);
  });
  addSheet("Statistics", statsRows);

  // Sheet 3: Quality report
  const qualityRows = [
    ["=== Missing Values ==="],
    ["Column","Missing Rows","Total Rows","Missing %"],
    ...missing.map(m => [m.col, m.missing, m.total, m.pct + "%"]),
    [],
    ["=== Duplicates ==="],
    ["Duplicate rows found", dupes.count],
  ];
  addSheet("Quality", qualityRows);

  // Sheet 4: Correlation matrix
  if (corr) {
    const corrRows = [["", ...corr.cols]];
    corr.matrix.forEach((row, i) => corrRows.push([corr.cols[i], ...row]));
    corrRows.push([]);
    corrRows.push(["Strong correlations (|r| ≥ 0.7)"]);
    corrRows.push(["Col 1","Col 2","r"]);
    corr.strong.forEach(s => corrRows.push([s.col1, s.col2, s.r]));
    addSheet("Correlation", corrRows);
  }

  // Sheet 5: Forecasts
  if (forecasts.length > 0) {
    const fcRows = [["Column","Slope","Intercept","R²","Step+1","Step+2","Step+3"]];
    forecasts.forEach(f => {
      fcRows.push([f.col, f.slope, f.intercept, f.r2, f.forecast[0].predicted, f.forecast[1].predicted, f.forecast[2].predicted]);
    });
    addSheet("Forecast", fcRows);
  }

  // Sheet 6: AI analysis
  addSheet("AI Analysis", [["AI Analysis"], [aiAnalysis || "—"]]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

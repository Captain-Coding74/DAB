/**
 * export.js — PDF and Excel report generators
 */

import PDFDocument from "pdfkit";
import ExcelJS     from "exceljs";

// ── PDF Export ────────────────────────────────────────────
export function generatePDF({ fileName, totalRows, headers, rows, colAnalysis, missing, dupes, corr, forecasts, aiAnalysis, prompt }) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data",  c => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN  = "#0d6e56";
    const LGRAY  = "#f3f4f6";
    const DGRAY  = "#374151";
    const pageW  = doc.page.width - 100;
    const date   = new Date().toLocaleDateString("th-TH", { year:"numeric", month:"long", day:"numeric" });

    // ── Header banner
    doc.rect(50, 50, pageW, 60).fill(GREEN);
    doc.fillColor("#fff").fontSize(18).font("Helvetica-Bold")
       .text("Data Analysis Report", 65, 65);
    doc.fontSize(10).font("Helvetica")
       .text(`${fileName}  ·  ${totalRows.toLocaleString()} rows  ·  ${date}`, 65, 88);
    doc.fillColor(DGRAY);
    doc.y = 130;

    function sectionTitle(title) {
      doc.moveDown(0.5)
         .rect(50, doc.y, pageW, 20).fill(LGRAY).fillColor(GREEN)
         .fontSize(11).font("Helvetica-Bold")
         .text(title, 56, doc.y - 16).fillColor(DGRAY)
         .moveDown(0.5);
    }

    function row2col(label, value) {
      doc.fontSize(9).font("Helvetica").fillColor("#6b7280").text(label, 56, doc.y, { continued: true, width: 140 })
         .fillColor(DGRAY).font("Helvetica-Bold").text(String(value)).font("Helvetica");
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
      doc.fontSize(10).font("Helvetica-Bold").fillColor(GREEN).text(`▸ ${c.col}`, 56).fillColor(DGRAY);
      if (c.type === "numeric") {
        doc.fontSize(8.5).font("Helvetica")
           .text(`Type: numeric  |  Count: ${c.count?.toLocaleString()}  |  Missing: ${c.missing} (${c.missingPct}%)`, 66)
           .text(`Min: ${c.min}   Max: ${c.max}   Avg: ${c.avg?.toFixed(2)}   Median: ${c.median}   StdDev: ${c.stdDev?.toFixed(2)}`, 66)
           .text(`Q1: ${c.q1}   Q3: ${c.q3}   IQR: ${c.iqr}   Outliers: ${c.outlierCount}`, 66);
      } else {
        const top = c.top?.slice(0,5).map(t=>`${t.value}(${t.pct}%)`).join(", ");
        doc.fontSize(8.5).font("Helvetica")
           .text(`Type: text  |  Unique: ${c.unique}  |  Missing: ${c.missing} (${c.missingPct}%)`, 66)
           .text(`Top: ${top}`, 66);
      }
      doc.moveDown(0.3);
    });

    // ── Missing values
    if (missing.length > 0) {
      sectionTitle("Missing Values");
      missing.forEach(m => {
        doc.fontSize(9).text(`${m.col}: ${m.missing} rows missing (${m.pct}%)`, 56);
      });
    }

    // ── Duplicates
    sectionTitle("Duplicate Rows");
    doc.fontSize(9).text(`Found ${dupes.count} duplicate rows`, 56);

    // ── Correlation
    if (corr && corr.strong.length > 0) {
      sectionTitle("Strong Correlations (|r| ≥ 0.7)");
      corr.strong.forEach(s => {
        doc.fontSize(9).text(`${s.col1}  ↔  ${s.col2}:  r = ${s.r}`, 56);
      });
    }

    // ── Forecast
    if (forecasts.length > 0) {
      sectionTitle("Regression & Forecast");
      forecasts.forEach(f => {
        if (doc.y > 680) doc.addPage();
        doc.fontSize(10).font("Helvetica-Bold").fillColor(GREEN).text(`▸ ${f.col}`, 56).fillColor(DGRAY);
        doc.fontSize(8.5).font("Helvetica")
           .text(`Slope: ${f.slope}   Intercept: ${f.intercept}   R²: ${f.r2}`, 66);
        f.forecast.forEach(p => doc.text(`  +${p.step} steps: predicted = ${p.predicted}`, 66));
        doc.moveDown(0.3);
      });
    }

    // ── Sample data
    sectionTitle("Data Preview (5 rows)");
    doc.addPage();
    doc.fontSize(8).font("Helvetica-Bold").text(headers.join("  |  "), 50).moveDown(0.2);
    rows.slice(0, 5).forEach(r => {
      doc.font("Helvetica").text(r.join("  |  "), 50).moveDown(0.1);
    });

    // ── AI analysis
    sectionTitle("AI Analysis");
    doc.fontSize(9).font("Helvetica").text(aiAnalysis || "—", 56, doc.y, { width: pageW - 12, lineGap: 3 });

    // ── Footer
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor("#9ca3af")
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

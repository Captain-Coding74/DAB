/**
 * routes/export.js — v12 extraction from server.js
 * PDF / Excel report downloads (rate-limited since v9).
 */
import { parseFileStreaming } from "../services/streaming.js";
import { computeQualityScore } from "../services/qualityScore.js";
import { generatePDF, generateExcel } from "../export.js";
import { analyzeLimiter, speedLimiter } from "../middleware/rateLimiter.js";

export function mountExportRoutes(app, { upload }) {
  // v9: exports now share the analyze limiter — PDF generation is CPU-heavy
  // and previously had no limits at all (easy DoS vector).
  app.post("/api/export/pdf", analyzeLimiter(), speedLimiter(), upload.single("file"), async (req, res, next) => {
    try {
      const { headers, colAnalysis, totalRows, sampleRows } = await parseFileStreaming(req.file.buffer, req.file.originalname);
      const quality = computeQualityScore(colAnalysis, totalRows, 0);
      const buf = await generatePDF({ fileName: req.file.originalname, totalRows, headers, rows: sampleRows, colAnalysis, missing: [], dupes: { count:0 }, corr: null, forecasts: [], aiAnalysis: req.body.analysis||"", prompt: req.body.prompt||"—" });
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="report.pdf"' }).send(buf);
    } catch (err) { next(err); }
  });

  app.post("/api/export/excel", analyzeLimiter(), speedLimiter(), upload.single("file"), async (req, res, next) => {
    try {
      const { headers, colAnalysis, totalRows, sampleRows } = await parseFileStreaming(req.file.buffer, req.file.originalname);
      const buf = await generateExcel({ fileName: req.file.originalname, totalRows, headers, rows: sampleRows, colAnalysis, missing: [], dupes: { count:0 }, corr: null, forecasts: [], aiAnalysis: req.body.analysis||"" });
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="report.xlsx"' }).send(buf);
    } catch (err) { next(err); }
  });
}

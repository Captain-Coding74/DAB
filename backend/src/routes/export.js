/**
 * routes/export.js — v12 extraction from server.js
 * PDF / Excel report downloads (rate-limited since v9).
 */
import { parseFileStreaming } from "../services/streaming.js";
import { computeQualityScore } from "../services/qualityScore.js";
import { computeStatsBundle } from "../services/analysisPipeline.js";
import { generatePDF, generateExcel } from "../export.js";
import { analyzeLimiter, speedLimiter } from "../middleware/rateLimiter.js";
import { optionalAuth } from "../auth.js";

export function mountExportRoutes(app, { upload }) {
  // v9: exports now share the analyze limiter — PDF generation is CPU-heavy
  // and previously had no limits at all (easy DoS vector).
  /* optionalAuth so the rate limiter can key by USER, exactly as
     /api/analyze does. Without it req.user is undefined, maxByAuth falls to
     the anonymous allowance of 20, and every signed-in user is capped as if
     they were anonymous — while everyone behind one office NAT shares a
     single bucket. Export stays open to anonymous callers by design (the
     demo needs it); this is about correct accounting, not locking it. */
  app.post("/api/export/pdf", analyzeLimiter(), speedLimiter(), upload.single("file"), optionalAuth, async (req, res, next) => {
    try {
      /* The findings were hardcoded empty here: missing [], dupes 0, corr null,
         forecasts []. A student downloading their report got one that always
         claimed perfect data, with the quality score computed on dupeCount 0 —
         so a file with 1,000 duplicates still scored as clean. */
      const parsed = await parseFileStreaming(req.file.buffer, req.file.originalname);
      const { headers, colAnalysis, totalRows, dupeCount, sampleRows } = parsed;
      const bundle = computeStatsBundle(parsed);
      const quality = computeQualityScore(colAnalysis, totalRows, dupeCount);
      const buf = await generatePDF({ fileName: req.file.originalname, totalRows, headers, rows: sampleRows, colAnalysis, missing: bundle.missing, dupes: bundle.dupes, corr: bundle.corr, forecasts: bundle.forecasts, aiAnalysis: req.body.analysis||"", prompt: req.body.prompt||"—" });
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="report.pdf"' }).send(buf);
    } catch (err) { next(err); }
  });

  /* optionalAuth so the rate limiter can key by USER, exactly as
     /api/analyze does. Without it req.user is undefined, maxByAuth falls to
     the anonymous allowance of 20, and every signed-in user is capped as if
     they were anonymous — while everyone behind one office NAT shares a
     single bucket. Export stays open to anonymous callers by design (the
     demo needs it); this is about correct accounting, not locking it. */
  app.post("/api/export/excel", analyzeLimiter(), speedLimiter(), upload.single("file"), optionalAuth, async (req, res, next) => {
    try {
      /* The findings were hardcoded empty here: missing [], dupes 0, corr null,
         forecasts []. A student downloading their report got one that always
         claimed perfect data, with the quality score computed on dupeCount 0 —
         so a file with 1,000 duplicates still scored as clean. */
      const parsed = await parseFileStreaming(req.file.buffer, req.file.originalname);
      const { headers, colAnalysis, totalRows, dupeCount, sampleRows } = parsed;
      const bundle = computeStatsBundle(parsed);
      const buf = await generateExcel({ fileName: req.file.originalname, totalRows, headers, rows: sampleRows, colAnalysis, missing: bundle.missing, dupes: bundle.dupes, corr: bundle.corr, forecasts: bundle.forecasts, aiAnalysis: req.body.analysis||"" });
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="report.xlsx"' }).send(buf);
    } catch (err) { next(err); }
  });
}

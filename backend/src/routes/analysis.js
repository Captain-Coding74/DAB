/**
 * routes/analysis.js — v16 extraction from the createApp() god-factory.
 * The two analyze entry points: a stored dataset, and a direct upload.
 * Both run the SAME pipeline (services/analysisPipeline.js).
 */
import crypto from "crypto";
import * as R from "../db/repository.js";
import { requireAuth, optionalAuth } from "../auth.js";
import { analyzeLimiter, speedLimiter } from "../middleware/rateLimiter.js";
import { parseFileStreaming } from "../services/streaming.js";
import { cache, cacheKey }     from "../services/cache.js";
import { computeStatsBundle, buildAnalysisPrompt, analysisResponse } from "../services/analysisPipeline.js";
import { recordUpload } from "../services/telemetry.js";
import { tryConsumeAI } from "../services/aiBudget.js";
import { serviceLogger, requestLogger } from "../logger.js";

/** One place the analysis model is named and called — both endpoints go through here. */
const ANALYSIS_MODEL = "claude-sonnet-4-6";
async function generateAnalysis(ai, promptArgs) {
  const msg = await ai.messages.create({
    model: ANALYSIS_MODEL, max_tokens: 1500,
    messages: [{ role: "user", content: buildAnalysisPrompt(promptArgs) }],
  });
  return msg.content[0].text;
}


const log = serviceLogger("analyze");

export function mountAnalysisRoutes(app, { upload, ai }) {
  // ── Analyze from a STORED dataset — no re-upload needed ──────
  app.post("/api/datasets/:id/analyze", analyzeLimiter(), speedLimiter(), requireAuth, async (req, res, next) => {
    const t0  = performance.now();
    const log = requestLogger(req);
    try {
      const { getUserDatasetRole, getDatasetWithContent } = await import("../db/datasetRepository.js");
      const role = await getUserDatasetRole(req.params.id, req.user.userId);
      if (!role) return res.status(403).json({ error: "No access to this dataset" });

      const ds = await getDatasetWithContent(req.params.id);
      if (!ds?.version) return res.status(404).json({ error: "Dataset not found" });

      const question = req.body.question || "สรุปภาพรวมข้อมูลทั้งหมด";
      const buffer    = Buffer.from(ds.version.file_content, "utf-8");
      const { headers, colAnalysis, totalRows, dupeCount, sampleRows } = await parseFileStreaming(buffer, ds.version.file_name);

      const parsed = { headers, colAnalysis, totalRows, dupeCount, sampleRows };
      const bundle = computeStatsBundle(parsed);
      const { autoCharts, quality, corr, forecasts } = bundle;

      // v20.3: the global daily AI budget applies here too
      let aiAnalysis = null, aiBudget = null;
      const b = await tryConsumeAI();
      if (!b.allowed) {
        aiBudget = "exceeded";
        log.warn({ used: b.used, budget: b.budget }, "AI daily budget exhausted — serving stats-only");
      } else {
        aiAnalysis = await generateAnalysis(ai, { question, totalRows, headers, bundle, sampleRows });
      }
      const durationMs = Math.round(performance.now() - t0);

      const rec = await R.saveAnalysis({
        userId: req.user.userId, workspaceId: ds.workspace_id, datasetId: ds.id,
        fileName: ds.version.file_name, fileType: ds.version.file_type,
        totalRows, totalCols: headers.length, prompt: question, analysis: aiAnalysis ?? "",
        statsJson: { colAnalysis, corr, forecasts }, chartConfig: autoCharts[0],
        qualityScore: quality?.score, durationMs, ipAddress: req.ip,
      });
      await cache.delPattern(`user:${req.user.userId}:history:`);

      const { logActivity } = await import("../db/collabRepository.js");
      await logActivity({ workspaceId: ds.workspace_id, datasetId: ds.id, userId: req.user.userId, action: "analysis_created", metadata: { name: ds.name } });

      log.info({ datasetId: ds.id, rows: totalRows, durationMs }, "Re-analyzed stored dataset (no upload)");
      res.json({ ...analysisResponse({ aiAnalysis, totalRows, headers, durationMs, parsed, bundle, savedId: rec.id }), aiBudget });
    } catch (err) { next(err); }
  });

  // ── Analyze (legacy: direct upload, no storage) ──────────────
  app.post("/api/analyze", analyzeLimiter(), speedLimiter(), upload.single("file"), optionalAuth, async (req, res, next) => {
    const t0  = performance.now();
    const log = requestLogger(req);
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const question   = req.body.question || "สรุปภาพรวมข้อมูลทั้งหมด";
      const fileType   = req.file.originalname.split(".").pop().toLowerCase();
      const workspaceId = req.body.workspaceId || null;
      const datasetId   = req.body.datasetId   || null;

      const { headers, colAnalysis, totalRows, dupeCount, sampleRows, normalization } =
        await parseFileStreaming(req.file.buffer, req.file.originalname);

      const parsed = { headers, colAnalysis, totalRows, dupeCount, sampleRows };
      const bundle = computeStatsBundle(parsed);
      const { autoCharts, quality, corr, forecasts } = bundle;

      // v20.2: privacy-safe usage fingerprint — shapes + dictionary tags only
      recordUpload({ source: "analyze", fileType, sizeBytes: req.file.size,
                     parsed: { headers, colAnalysis, totalRows, normalization }, userId: req.user?.userId });

      // v20.3 launch safety: AI prose is the signed-in tier of this endpoint.
      //   anonymous → full deterministic bundle, analysis:null, aiGated flag
      //   signed-in → AI within the global daily budget, else graceful degrade
      // Either way the user gets instant statistical results — the product
      // never returns less than the demo promised.
      let aiAnalysis = null, aiGated = false, aiBudget = null;
      if (!req.user) {
        aiGated = true;
      } else {
        const b = await tryConsumeAI();
        if (!b.allowed) {
          aiBudget = "exceeded";
          log.warn({ used: b.used, budget: b.budget }, "AI daily budget exhausted — serving stats-only");
        } else {
          aiAnalysis = await generateAnalysis(ai, { question, totalRows, headers, fileType, bundle, sampleRows });
        }
      }
      const durationMs = Math.round(performance.now() - t0);

      let savedId = null;
      if (req.user) {
        const rec = await R.saveAnalysis({ userId: req.user.userId, workspaceId, datasetId, fileName: req.file.originalname, fileType, totalRows, totalCols: headers.length, prompt: question, analysis: aiAnalysis ?? "", statsJson: { colAnalysis, corr, forecasts }, chartConfig: autoCharts[0], qualityScore: quality?.score, durationMs, ipAddress: req.ip });
        savedId = rec.id;
        await cache.delPattern(`user:${req.user.userId}:history:`);
      }

      log.info({ rows: totalRows, durationMs, quality: quality?.score, savedId }, "Analyze complete");
      res.json({ ...analysisResponse({ aiAnalysis, totalRows, headers, durationMs, parsed, bundle, savedId }), aiGated, aiBudget });
    } catch (err) { next(err); }
  });
}

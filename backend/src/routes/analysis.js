/**
 * routes/analysis.js — v16 extraction from the createApp() god-factory.
 * The two analyze entry points: a stored dataset, and a direct upload.
 * Both run the SAME pipeline (services/analysisPipeline.js).
 */
import crypto from "crypto";
import * as R from "../db/repository.js";
import { requireAuth, optionalAuth } from "../auth.js";
import { requireFileMagic } from "../services/fileMagic.js";
import { analyzeLimiter, speedLimiter } from "../middleware/rateLimiter.js";
import { parseFileStreaming } from "../services/streaming.js";
import { cache, cacheKey }     from "../services/cache.js";
import { computeStatsBundle, buildAnalysisPrompt, analysisResponse } from "../services/analysisPipeline.js";
import { recordUpload } from "../services/telemetry.js";
import { tryConsumeAI } from "../services/aiBudget.js";
import { flagOn, datasetAiEnabled } from "../services/aiGate.js";
import { getUserDatasetRole } from "../db/datasetRepository.js";
import { serviceLogger, requestLogger } from "../logger.js";

/** One place the analysis model is named and called — both endpoints go through here. */
import { AI_MODEL as ANALYSIS_MODEL } from "../config.js";
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
      const { getDatasetWithContent, getVersionBytes, touchDataset } = await import("../db/datasetRepository.js");
      const role = await getUserDatasetRole(req.params.id, req.user.userId);
      if (!role) return res.status(403).json({ error: "No access to this dataset" });

      const ds = await getDatasetWithContent(req.params.id);
      if (!ds?.version) return res.status(404).json({ error: "Dataset not found" });

      const question = req.body.question || "สรุปภาพรวมข้อมูลทั้งหมด";
      // v21.1: bytes come from object storage; getVersionBytes falls back to
      // the legacy file_content column for rows written before the migration.
      const buffer    = await getVersionBytes(ds.version);
      const { headers, colAnalysis, totalRows, dupeCount, sampleRows, pairwise, sensitive, headRows } = await parseFileStreaming(buffer, ds.version.file_name);

      const parsed = { headers, colAnalysis, totalRows, dupeCount, sampleRows, pairwise, sensitive, headRows, buffer, fileName: ds.version.file_name };
      const bundle = computeStatsBundle(parsed);
      const { autoCharts, quality, corr, forecasts } = bundle;

      /* v21.30: the owner's AI switch, or the caller's "statistics only"
         (noAi — the SPA re-sends the upload's choice when it re-analyzes the
         saved copy after a fix, so a stats-only upload stays stats-only).
         Either → the stats-only result, the same graceful floor as an
         exhausted budget, decided BEFORE the budget is touched; the saved
         analysis is marked so chat and the agent refuse it too. v20.3: the
         global daily AI budget applies here too. */
      const aiDisabled = flagOn(req.body?.noAi) || !(await datasetAiEnabled(ds.id));
      let aiAnalysis = null, aiBudget = null;
      const b = aiDisabled ? null : await tryConsumeAI();
      if (b && !b.allowed) {
        aiBudget = "exceeded";
        log.warn({ used: b.used, budget: b.budget }, "AI daily budget exhausted — serving stats-only");
      } else if (b) {
        aiAnalysis = await generateAnalysis(ai, { question, totalRows, headers, bundle });
      }
      const durationMs = Math.round(performance.now() - t0);

      const rec = await R.saveAnalysis({
        userId: req.user.userId, workspaceId: ds.workspace_id, datasetId: ds.id,
        fileName: ds.version.file_name, fileType: ds.version.file_type,
        totalRows, totalCols: headers.length, prompt: question, analysis: aiAnalysis ?? "",
        statsJson: { colAnalysis, corr, forecasts }, chartConfig: autoCharts[0],
        qualityScore: quality?.score, durationMs, ipAddress: null, aiDisabled,
      });
      await touchDataset(ds.id);   // v21.30: analysing is use — see services/retention.js
      await cache.delPattern(`user:${req.user.userId}:history:`);

      const { logActivity } = await import("../db/collabRepository.js");
      await logActivity({ workspaceId: ds.workspace_id, datasetId: ds.id, userId: req.user.userId, action: "analysis_created", metadata: { name: ds.name } });

      log.info({ datasetId: ds.id, rows: totalRows, durationMs }, "Re-analyzed stored dataset (no upload)");
      res.json({ ...analysisResponse({ aiAnalysis, totalRows, headers, durationMs, parsed, bundle, savedId: rec.id }), aiBudget, aiDisabled });
    } catch (err) { next(err); }
  });

  // ── Analyze (legacy: direct upload, no storage) ──────────────
  // requireFileMagic: the extension filter on `upload` is spoofable, and this
  // route is reachable anonymously — the same byte-level gate as /api/datasets.
  app.post("/api/analyze", analyzeLimiter(), speedLimiter(), upload.single("file"), requireFileMagic, optionalAuth, async (req, res, next) => {
    const t0  = performance.now();
    const log = requestLogger(req);
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const question   = req.body.question || "สรุปภาพรวมข้อมูลทั้งหมด";
      const fileType   = req.file.originalname.split(".").pop().toLowerCase();
      const workspaceId = req.body.workspaceId || null;
      const datasetId   = req.body.datasetId   || null;
      /* v21.30: both ids come from the client and land on the saved record.
         A dataset link decides which AI switch applies, keeps that dataset
         "in use" for retention and puts the analysis in its cascade; a
         workspace link puts its branding on share pages. So each must be
         one the caller can reach — the same 403 as the dataset routes. */
      if (datasetId && !(req.user && await getUserDatasetRole(datasetId, req.user.userId)))
        return res.status(403).json({ error: "No access to this dataset" });
      if (workspaceId && !(req.user && await R.isMember(workspaceId, req.user.userId)))
        return res.status(403).json({ error: "Not a member of this workspace" });

      const { headers, colAnalysis, totalRows, dupeCount, sampleRows, pairwise, normalization, sensitive, headRows } =
        await parseFileStreaming(req.file.buffer, req.file.originalname);

      const parsed = { headers, colAnalysis, totalRows, dupeCount, sampleRows, pairwise, sensitive, headRows, buffer: req.file.buffer, fileName: req.file.originalname };
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
      // v21.30: a signed-in user may opt out per upload ("Statistics only" —
      // noAi), and a linked dataset's owner may have switched AI off; either
      // way the anonymous-shaped result, no budget spent, flagged on the record.
      const aiDisabled = !!req.user && (flagOn(req.body.noAi) || !(await datasetAiEnabled(datasetId)));
      let aiAnalysis = null, aiGated = false, aiBudget = null;
      if (!req.user) {
        aiGated = true;
      } else if (!aiDisabled) {
        const b = await tryConsumeAI();
        if (!b.allowed) {
          aiBudget = "exceeded";
          log.warn({ used: b.used, budget: b.budget }, "AI daily budget exhausted — serving stats-only");
        } else {
          aiAnalysis = await generateAnalysis(ai, { question, totalRows, headers, fileType, bundle });
        }
      }
      const durationMs = Math.round(performance.now() - t0);

      /* v21.30: no IP is stored with an analysis, on either analyze path —
         History never used it, and an analysis can live a year. The column
         stays (migrate.js clears old values). Saving the FILE is a separate,
         explicit choice: the SPA offers "Save dataset" (POST /api/datasets)
         and nothing here stores it. */
      let savedId = null;
      if (req.user) {
        const rec = await R.saveAnalysis({ userId: req.user.userId, workspaceId, datasetId, fileName: req.file.originalname, fileType, totalRows, totalCols: headers.length, prompt: question, analysis: aiAnalysis ?? "", statsJson: { colAnalysis, corr, forecasts }, chartConfig: autoCharts[0], qualityScore: quality?.score, durationMs, ipAddress: null, aiDisabled });
        savedId = rec.id;
        await cache.delPattern(`user:${req.user.userId}:history:`);
      }

      log.info({ rows: totalRows, durationMs, quality: quality?.score, savedId }, "Analyze complete");
      res.json({ ...analysisResponse({ aiAnalysis, totalRows, headers, durationMs, parsed, bundle, savedId }), aiGated, aiBudget, aiDisabled });
    } catch (err) { next(err); }
  });
}

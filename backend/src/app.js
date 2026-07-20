/**
 * app.js — Data Analysis Bot v16 — the ONE Express app factory.
 *
 * v16: previously the app was built at module scope in server.js, so tests
 * could not import it without booting a server. That forced testApp.js to
 * RE-IMPLEMENT 14 routes — meaning the "integration" tests exercised a
 * parallel implementation, not production code. Two real bugs slipped
 * through that gap (v13 error mapping, v14 upload content-type).
 *
 * Now there is exactly one construction path. server.js boots it; the
 * integration tests import it. Test/prod drift is structurally impossible.
 *
 * (was: server.js — Data Analysis Bot v15
 * React Dashboard + AI Chat + Insights Engine + Quality Score + Multi-file
 * + Shares + Teams + Scheduler + Security hardening (helmet, global rate limits)
 */

import express        from "express";
import helmet         from "helmet";
import multer         from "multer";
import dotenv         from "dotenv";
import bcrypt         from "bcryptjs";
import swaggerUi      from "swagger-ui-express";
import YAML           from "yamljs";
import path           from "path";
import { readFileSync } from "node:fs";

// v20.4.1: /api/health reported a hardcoded "19.0.0" — the exact bug class
// logger.js fixed back in v18. One read, straight from package.json.
const PKG_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; }
  catch { return "0.0.0"; }
})();
import crypto         from "crypto";
import { fileURLToPath } from "url";

import { initPool, closePool }   from "./db/pool.js";
import { migrate }               from "./db/migrate.js";
import { initCache, cache, cacheKey } from "./services/cache.js";
import { parseFileStreaming }    from "./services/streaming.js";
import { computeQualityScore }   from "./services/qualityScore.js";
import { generatePromptSuggestions, autoChartConfig } from "./services/promptSuggestions.js";
import { generateInsights }      from "./services/insights.js";
import { computeStatsBundle, buildAnalysisPrompt, analysisResponse } from "./services/analysisPipeline.js";
import { createAIClient } from "./services/aiClient.js";
import { runAgent } from "./services/agent.js";
import { mountAuthRoutes }   from "./routes/auth.js";
import { mountExportRoutes } from "./routes/export.js";
import { mountWorkspaceRoutes } from "./routes/workspaces.js";
import { mountAnalysisRoutes }  from "./routes/analysis.js";
import { mountChatRoutes }      from "./routes/chat.js";
import { mountShareRoutes }     from "./routes/shares.js";
import { mountScheduleRoutes }  from "./routes/schedules.js";
import { mountHistoryRoutes }   from "./routes/history.js";
import { mountDemoRoutes }      from "./routes/demo.js";
import { mountTelemetryRoutes } from "./routes/telemetry.js";
import { startScheduler }        from "./services/scheduler.js";
import { logger, httpLogger, requestLogger, serviceLogger } from "./logger.js";
import { requestMetrics, metricsHandler, errorHandler } from "./middleware/monitoring.js";
import { apiLimiter, analyzeLimiter, authLimiter, speedLimiter } from "./middleware/rateLimiter.js";
import { signAccess, signRefresh, verifyRefresh, hashToken,
         refreshExpiresAt, requireAuth, optionalAuth } from "./auth.js";
import { analyzeColumns, detectMissing, detectDuplicates,
         correlationMatrix, autoForecast, recommendCharts, buildSummaryString } from "./analyze.js";
import { generatePDF, generateExcel } from "./export.js";
import * as R from "./db/repository.js";
import datasetRoutes from "./routes/datasets.js";
import collabRoutes   from "./routes/collaboration.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svcLog    = serviceLogger("server");
const ai        = createAIClient();   // v13: honours AI_MOCK=1 (blocked in production)

/**
 * Build the Express app. No listening, no migrations, no scheduler —
 * those are the caller's job (see server.js), which keeps this importable.
 */
export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  // Security headers. CSP is tuned for the built React SPA + Swagger UI:
  //  - 'unsafe-inline' styles: Swagger UI + Recharts inject inline styles
  //  - blob:/data: images: chart exports + branding logo previews
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        // v17: fonts are self-hosted (@fontsource), so the CSP needs NO
        // third-party origins. The original bug: styleSrc allowed only 'self'
        // while index.html loaded a Google Fonts stylesheet — so our own CSP
        // blocked the app's typography and the Ledger design silently fell back
        // to system fonts. The fix was not to punch a hole for Google, but to
        // stop depending on them: tighter CSP, no third-party request, works
        // offline. Browser console errors are now a gated metric (must be 0),
        // so this class of silent failure cannot return.
        styleSrc:   ["'self'", "'unsafe-inline'"],
        fontSrc:    ["'self'", "data:"],
        imgSrc:     ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        objectSrc:  ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Swagger UI assets
  }));

  app.use(express.json({ limit: "1mb" }));
  app.use(httpLogger);
  app.use(requestMetrics);

  // v9 fix: apiLimiter was imported but never mounted in v7/v8, so general
  // API routes had NO rate limiting at all. Now every /api route gets the
  // baseline limit (anon 30 / auth 100 per 15 min); heavier per-route
  // limiters (analyze, auth) still stack on top.
  // optionalAuth must run FIRST so the limiter can key by userId and grant
  // authenticated users their higher quota (otherwise everyone counts as anon).
  app.use("/api", optionalAuth, apiLimiter());

  // Swagger
  try {
    const swaggerDoc = YAML.load(path.join(__dirname, "../openapi.yaml"));
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc, { customSiteTitle: "DAB API v19", customCss: ".swagger-ui .topbar { background:#2F6B4F }" }));
  } catch {}

  // Serve React build in production
  const distPath = path.join(__dirname, "../../frontend/dist");
  app.use(express.static(distPath));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_, file, cb) => /\.(csv|xlsx|xls)$/i.test(file.originalname) ? cb(null, true) : cb(new Error("CSV/Excel only")),
  });
  const uploadMulti = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ── Auth routes → src/routes/auth.js (v12) ───────────────
  mountAuthRoutes(app);

  // ── Workspaces → routes/workspaces.js (v16) ───────────────
  mountWorkspaceRoutes(app);

  // ── Dataset Management (Google Drive-style) + Collaboration ──
  // Single source of truth for /api/datasets/* — old inline v7 handlers removed
  // (they used a different field name and shadowed these routes; see datasets.js)
  app.use("/api/datasets", datasetRoutes);
  app.use("/api/collab",   collabRoutes);

  // ── Analyze (stored dataset + direct upload) → routes/analysis.js (v16) ──
  mountAnalysisRoutes(app, { upload, ai });

  // ── Chat + streaming + agent → routes/chat.js (v16) ───────
  mountChatRoutes(app, { ai });

  // ── Export routes → src/routes/export.js (v12) ───────────
  mountExportRoutes(app, { upload });

  // ── Shared reports → routes/shares.js (v16) ───────────────
  mountShareRoutes(app);

  // ── Scheduled reports → routes/schedules.js (v16) ─────────
  mountScheduleRoutes(app);

  // ── History → routes/history.js (v16) ─────────────────────
  mountHistoryRoutes(app);

  // ── Public demo — no auth, no AI → routes/demo.js (v20.1) ─
  mountDemoRoutes(app);

  // ── Upload telemetry summary (auth) → routes/telemetry.js (v20.2) ─
  mountTelemetryRoutes(app);

  // ── System ────────────────────────────────────────────────
  app.get("/api/metrics", metricsHandler);
  app.get("/api/health",  async (_,res) => {
    const { getBackend } = await import("./db/pool.js");
    res.json({ status:"ok", version: PKG_VERSION, db: getBackend(), cache: cache.getBackend(), ts: new Date().toISOString() });
  });

  // Public landing page (v20.4.1) — a real file in dist, EN-default bilingual
  app.get("/welcome", (_, res) => {
    try { res.sendFile(path.join(distPath, "landing.html")); } catch { res.redirect("/"); }
  });

  // Serve React for all non-API routes (SPA fallback)
  app.get(/^(?!\/api).*/, (_, res) => {
    try { res.sendFile(path.join(distPath, "index.html")); } catch { res.status(200).send("Frontend not built. Run: npm run build -w frontend"); }
  });

  app.use(errorHandler);

  return app;
}

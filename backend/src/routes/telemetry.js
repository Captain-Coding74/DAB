/**
 * routes/telemetry.js — v20.2
 * One authenticated, aggregates-only window into upload telemetry.
 * Individual rows never leave the server — and by construction the rows
 * themselves never contained data (shapes, dictionary tags, flags only).
 */
import { requireAuth } from "../auth.js";
import { getTelemetrySummary } from "../db/repository.js";

export function mountTelemetryRoutes(app) {
  app.get("/api/telemetry/summary", requireAuth, async (_req, res, next) => {
    try { res.json(await getTelemetrySummary()); } catch (err) { next(err); }
  });
}

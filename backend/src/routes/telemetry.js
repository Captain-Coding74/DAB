/**
 * routes/telemetry.js — v20.2
 * One authenticated, aggregates-only window into upload telemetry.
 * Individual rows never leave the server — and by construction the rows
 * themselves never contained data (shapes, dictionary tags, flags only).
 */
import { requireAuth } from "../auth.js";
import { getTelemetrySummary } from "../db/repository.js";

export function mountTelemetryRoutes(app) {
/**
 * Who may read the aggregate telemetry.
 *
 * It was requireAuth only, so ANY registered user could read the global
 * summary. The payload carries no raw names — that part holds up under
 * adversarial input — but it does report things like
 * {"bySegment":{"pharmacy":1},"categories":{"patient":1,"salary":1}}, which
 * tells a stranger that someone on this deployment uploaded a pharmacy file
 * with patient and salary columns. On a small deployment that is close to
 * identifying, and it is product intelligence handed to anyone who registers.
 *
 * No admin role exists in DAB and nothing in the frontend calls this, so the
 * guard is an operator allowlist rather than an invented role system. With
 * TELEMETRY_ADMINS unset the endpoint is closed to everyone.
 */
function isTelemetryAdmin(req) {
  const allow = String(process.env.TELEMETRY_ADMINS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allow.length) return false;
  return allow.includes(String(req.user?.username || "").toLowerCase());
}

  app.get("/api/telemetry/summary", requireAuth, async (req, res, next) => {
    if (!isTelemetryAdmin(req)) {
      return res.status(403).json({
        error: "ต้องเป็นผู้ดูแลระบบ",
        errorEn: "telemetry is restricted to operators (set TELEMETRY_ADMINS)",
      });
    }
    try { res.json(await getTelemetrySummary()); } catch (err) { next(err); }
  });
}

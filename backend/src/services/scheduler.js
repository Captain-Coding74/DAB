/**
 * src/services/scheduler.js — periodic housekeeping (node-cron)
 *
 * v21.30: the scheduled-report runner is gone. It was a stub — no analysis
 * ran, no email was sent — that still bumped run_count every minute and
 * logged each report's recipient email addresses at info level. Scheduled
 * Reports is "coming soon" (routes/schedules.js answers FEATURE_UNAVAILABLE)
 * and the stored rows were purged (db/migrate.js DATA_FIXES). Its next-run
 * cron parser went with it; recover both from git history with the feature.
 */

import cron from "node-cron";
import { pruneRefreshTokens } from "../db/repository.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("scheduler");

async function pruneTokens() {
  try {
    await pruneRefreshTokens();
  } catch (err) {
    log.error({ err }, "Refresh-token prune failed");
  }
}

export function startScheduler() {
  // Hourly housekeeping: every login/refresh writes a refresh_tokens row and
  // nothing deleted revoked/expired ones, so the table grew without bound.
  cron.schedule("7 * * * *", pruneTokens, { timezone: "Asia/Bangkok" });
  pruneTokens();   // once at startup so a long-running instance doesn't wait an hour
  log.info("Scheduler started (token prune hourly)");
}

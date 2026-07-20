/**
 * src/services/scheduler.js — Scheduled report runner
 *
 * Uses node-cron to check every minute for due reports.
 * Runs analysis → generates PDF/Excel → logs completion.
 * In production, send email via SMTP (stubbed here — plug in nodemailer).
 */

import cron from "node-cron";
import { getDueScheduledReports, updateScheduledRun } from "../db/repository.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("scheduler");

// Compute next run time from cron expression
function nextRunDate(cronExpr) {
  try {
    const now   = new Date();
    const parts = cronExpr.split(" ");
    // Simplified: add 1 hour by default (full cron-next-date omitted for brevity)
    // In production, use 'croner' or 'cron-parser' library
    const next = new Date(now.getTime() + 60 * 60 * 1000);
    return next.toISOString();
  } catch {
    return null;
  }
}

async function runDueReports() {
  try {
    const due = await getDueScheduledReports();
    if (!due.length) return;

    log.info({ count: due.length }, "Running due scheduled reports");

    for (const report of due) {
      try {
        const recipients = JSON.parse(report.recipients || "[]");
        log.info({ reportId: report.id, name: report.name, recipients }, "Running scheduled report");

        // TODO: plug in real analysis + email delivery here
        // 1. Load dataset from DB → parseFileStreaming
        // 2. analyzeColumns + buildSummaryString
        // 3. Call Claude API
        // 4. generatePDF / generateExcel
        // 5. Send email with attachment via nodemailer

        // Stub: just log and mark as run
        await updateScheduledRun(report.id);
        log.info({ reportId: report.id }, "Scheduled report completed (stub)");

      } catch (err) {
        log.error({ err, reportId: report.id }, "Scheduled report failed");
      }
    }
  } catch (err) {
    log.error({ err }, "Scheduler tick failed");
  }
}

export function startScheduler() {
  // Run every minute — checks DB for due reports
  cron.schedule("* * * * *", runDueReports, { timezone: "Asia/Bangkok" });
  log.info("Scheduler started (checks every minute)");
}

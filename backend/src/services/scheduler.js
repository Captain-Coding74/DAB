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

/* Bangkok is UTC+7 with no DST, so a fixed offset is exact — the tick below
 * runs in the same timezone, and this keeps the next-run math dependency-free
 * (node-cron can fire a schedule but cannot report its next occurrence). */
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** One cron field ("*", "5", "1-5", "*​/15", "1,3,5-9/2") → Set of values, or null if invalid. */
function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[2] ? parseInt(m[2], 10) : 1;
    if (!step) return null;
    let lo = min, hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] ? max : a);   // "5/15" means "from 5 to max, step 15"
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/**
 * Compute the next fire time (ISO, UTC) for a 5-field cron expression,
 * evaluated in Asia/Bangkok wall-clock time. Scans minute-by-minute up to a
 * year ahead — it runs once per report per fire, so the cost is irrelevant.
 * An unparseable expression degrades to now+1h so a bad cron re-checks
 * hourly instead of machine-gunning every minute.
 */
export function nextRunDate(cronExpr) {
  const fallback = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const parts = String(cronExpr || "").trim().split(/\s+/);
  if (parts.length !== 5) return fallback;

  const minute = parseCronField(parts[0], 0, 59);
  const hour   = parseCronField(parts[1], 0, 23);
  const dom    = parseCronField(parts[2], 1, 31);
  const month  = parseCronField(parts[3], 1, 12);
  const dow    = parseCronField(parts[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return fallback;
  if (dow.has(7)) dow.add(0);   // cron: both 0 and 7 mean Sunday

  const domAny = parts[2] === "*", dowAny = parts[4] === "*";
  let t = (Math.floor(Date.now() / 60_000) + 1) * 60_000;   // next whole minute
  const end = t + 366 * 24 * 60 * 60_000;
  for (; t < end; t += 60_000) {
    const d = new Date(t + BKK_OFFSET_MS);   // UTC getters now read Bangkok wall-clock
    if (!minute.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours()) || !month.has(d.getUTCMonth() + 1)) continue;
    const domHit = dom.has(d.getUTCDate()), dowHit = dow.has(d.getUTCDay());
    // Standard cron: when BOTH day fields are restricted, either may match.
    const dayOk = domAny && dowAny ? true : domAny ? dowHit : dowAny ? domHit : (domHit || dowHit);
    if (dayOk) return new Date(t).toISOString();
  }
  return fallback;
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

        // Stub: just log and mark as run. Persisting the computed next fire
        // time is what stops getDueScheduledReports matching this report on
        // every subsequent one-minute tick.
        await updateScheduledRun(report.id, nextRunDate(report.cron_expr));
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

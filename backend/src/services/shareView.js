/**
 * services/shareView.js — the rules for public share links (v21.30).
 *
 * A share link is a bearer URL: whoever holds it reads the report, and links
 * get forwarded, pasted into chats and picked up by crawlers. So a link is
 * created with an expiry (no "never"), a generic title instead of the file
 * name, and the public payload carries only what SharePage renders.
 */

import { detectedKinds, legacyAiText } from "./aiSafe.js";
import { classifySensitiveColumns } from "./sensitive.js";

export const SHARE_EXPIRY_DAYS = Object.freeze([1, 7, 30, 90]);
/* X-Robots-Tag for the share API and the /share/* page document (app.js):
   a crawler that follows a link posted in a forum must not put the report
   in search results. */
export const SHARE_ROBOTS = "noindex, nofollow";
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;

/* File names often name a person, a class or a client, and until v21.30 the
   file name WAS the title of every link the SPA made. The generic title is
   what a link gets when the owner does not type one. */
export const DEFAULT_SHARE_TITLE = "Analysis report";
const MAX_TITLE = 120;

/** Days until expiry from a request body value: absent → the default, one
 *  of SHARE_EXPIRY_DAYS → itself, anything else → null (the route answers
 *  400). Strings, booleans and 0 are refused rather than coerced. */
export function parseExpiryDays(value) {
  if (value === undefined || value === null) return DEFAULT_SHARE_EXPIRY_DAYS;
  return SHARE_EXPIRY_DAYS.includes(value) ? value : null;
}

/* The spellings a stored file name may have. Before v21.30 multer decoded
   upload names as latin1, so analyses.file_name holds "à¸£à¸²à¸¢…" for a Thai
   name while a client sends the real one; each is compared in both forms. */
function spellings(name) {
  if (typeof name !== "string" || !name) return [];
  return [name, Buffer.from(name, "latin1").toString("utf8"), Buffer.from(name, "utf8").toString("latin1")];
}

/** The stored title: what the owner typed, trimmed — unless it is empty or
 *  the analysis file name. An older SPA sent `title: file.name` on every
 *  share, so the server refuses to copy the name onto a public page even
 *  when a cached bundle still asks it to — under either encoding of it. */
export function shareTitle(title, fileName) {
  const t = typeof title === "string" ? title.trim().slice(0, MAX_TITLE) : "";
  return t && !spellings(fileName).some((n) => n.trim() === t) ? t : DEFAULT_SHARE_TITLE;
}

/* The only fields a detected personal-data column keeps on a public page:
   what it is and how complete it is. Everything else on a colAnalysis entry
   is either a raw value from someone's row (top values, min/max, median,
   quartiles, date range) or derived from them (avg, sum, trend sums), and
   the masking that protects the owner's own view (initials for names, x'd
   phone digits) is not enough for strangers holding a forwarded link. */
const SENSITIVE_KEEP = ["col", "type", "sensitive", "count", "missing", "missingPct", "unique", "uniqueApprox", "semantic"];

/* `kind` comes from aiSafe.js detectedKinds, not from the stored entry alone:
   stats_json saved before v21.30 knows only the five School Edition kinds, so
   an old analysis's "email" or "religion" column carries no `sensitive` and
   its raw top values. The same re-classification the AI payloads use (column
   name plus the stored values) decides here too. */
function publicColumn(c, kind) {
  if (!kind) return c;
  return { ...Object.fromEntries(SENSITIVE_KEEP.filter((k) => k in c).map((k) => [k, c[k]])), sensitive: kind };
}

/* The saved chart is drawn from the same rows. autoChartConfig never charts
   a column it knew was personal data, but an old analysis's chart may have
   an axis that is only detected now — its category labels are that
   column's values, so the chart is left off the public page. The plotted
   values themselves are tested too: an old scatter of a "ref" column held
   one point per row, each a card number the column's stats may not reveal. */
function publicChart(chart, kinds) {
  if (!chart) return null;
  const axes = [chart.xAxis, ...(Array.isArray(chart.yAxis) ? chart.yAxis : [chart.yAxis])].filter(Boolean);
  const points = Array.isArray(chart.data) ? chart.data : [];
  const plotsPersonalData = (col) => kinds.has(col) ||
    classifySensitiveColumns([col], points.map((d) => [d?.[col] == null ? null : String(d[col])])).length > 0;
  return axes.some(plotsPersonalData) ? null : chart;
}

const parse = (json) => {
  if (!json) return null;
  try { return typeof json === "string" ? JSON.parse(json) : json; } catch { return null; }
};

/**
 * The public payload for one share row (from getSharedReport).
 *
 * An allowlist, not a delete-list: v16 found that `SELECT sr.*` plus "strip
 * password_hash" handed the owner's user_id and the analysis_id to anyone
 * with the link, and any column added to shared_reports later would leak
 * the same way. No file_name: the title stands in for it. stats_json keeps
 * colAnalysis only — the correlations and forecasts are not rendered by
 * SharePage, so they are not published either. The AI text of an analysis
 * made before v21.30 is left off (aiSafe.js legacyAiText): its prompt carried
 * raw rows, and the report can quote them.
 */
export function publicShareView(row) {
  const colAnalysis = parse(row.stats_json)?.colAnalysis || [];
  const kinds = detectedKinds(colAnalysis);
  return {
    title:        shareTitle(row.title, row.file_name),   // checked again on the way out: rows made before the rule
    analysis:     legacyAiText(row) ? null : row.analysis,
    total_rows:   row.total_rows,
    stats_json:   { colAnalysis: colAnalysis.map((c) => publicColumn(c, kinds.get(c?.col))) },
    chart_config: publicChart(parse(row.chart_config), kinds),
    view_count:   row.view_count,
    created_at:   row.created_at,
    expires_at:   row.expires_at,
    brand_color:  row.brand_color,
    brand_name:   row.brand_name,
    brand_logo:   row.brand_logo,
  };
}

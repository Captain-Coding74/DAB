/**
 * services/aiSafe.js — the ONE view of the statistics an AI payload may be
 * built from (v21.30).
 *
 * WHY ONE HELPER
 * --------------
 * Before v21.30 every AI entry point built its own context: chat pasted the
 * first five stored column objects (frequency tables included), the agent's
 * get_column_detail returned the whole stored object, fix-suggest listed
 * top values for every column. Each was "statistics only", and each carried
 * the raw values of columns the parse guard had flagged as personal data —
 * the guard masks what a USER sees, not what leaves for the model. Analyze,
 * chat (both forms), the agent and fix-suggest now all start here, so the
 * rule is written once:
 *
 *   A column with a truthy `sensitive` keeps its NAME and KIND, nothing
 *   else — the privacy notice promises exactly that. Its frequency table,
 *   aggregates, counts, outliers, trend and date range are dropped, and so
 *   are correlations, forecasts and findings that name it.
 *
 * OLD ANALYSES
 * ------------
 * stats_json saved before v21.30 knows only the five School Edition kinds:
 * a stored "customer_email" column has no `sensitive` and raw addresses in
 * its top values. So classification re-runs here on every call — on the
 * column NAME (header patterns) and on the stored top values (the value
 * tests: checksum, Luhn, email shape). Any detection hides the column; a
 * kind already stored is kept as the name for it.
 */
import { classifySensitiveColumns } from "./sensitive.js";

/** Column name → kind for every column the AI must not see values of. */
export function detectedKinds(colAnalysis = []) {
  const kinds = new Map();
  for (const c of colAnalysis) {
    if (!c?.col) continue;
    const topRows = Array.isArray(c.top) ? c.top.map((t) => [t?.value]) : [];
    const kind = c.sensitive || classifySensitiveColumns([c.col], topRows)[0]?.kind;
    if (kind) kinds.set(c.col, kind);
  }
  return kinds;
}

/**
 * aiSafeColumns(colAnalysis) -> new array, input untouched. Columns with no
 * detected kind pass through as they are; detected ones become
 * { col, sensitive: kind } and nothing more.
 */
export function aiSafeColumns(colAnalysis = []) {
  const kinds = detectedKinds(colAnalysis);
  return colAnalysis.map((c) => {
    const kind = kinds.get(c?.col);
    return kind ? { col: c.col, sensitive: kind } : c;
  });
}

/**
 * aiSafeStats(statsJson) -> { colAnalysis, corr, forecasts, hidden }.
 * The shape the agent's tools and the chat context read. `hidden` is the
 * set of detected column names, for callers filtering their own lists.
 * The full correlation matrix is not carried: no AI consumer reads it, and
 * it holds every pair, detected columns included.
 */
export function aiSafeStats(statsJson = {}) {
  const colAnalysis = aiSafeColumns(statsJson?.colAnalysis || []);
  const hidden = new Set(colAnalysis.filter((c) => c?.sensitive).map((c) => c.col));
  const strong = (statsJson?.corr?.strong || []).filter((s) => !hidden.has(s.col1) && !hidden.has(s.col2));
  return {
    colAnalysis,
    corr: statsJson?.corr ? { strong } : null,
    forecasts: (statsJson?.forecasts || []).filter((f) => !hidden.has(f?.col)),
    hidden,
  };
}

/**
 * aiSafeInsights(insights, hidden) -> the findings that name no detected
 * column. Insight ids are "<rule>:<column>" (and "corr:<a>:<b>"), see
 * services/insights.js; a finding about a detected column can quote its
 * values ("diabetes" dominates "diagnosis"), so it is dropped whole.
 * aiSafe.test.js generates real insights to keep this in step with the ids.
 */
export function aiSafeInsights(insights = [], hidden = new Set()) {
  if (!hidden.size) return insights;
  const about = (id, col) => id.endsWith(`:${col}`) || id.startsWith(`corr:${col}:`);
  return insights.filter((i) => ![...hidden].some((col) => about(String(i?.id ?? ""), col)));
}

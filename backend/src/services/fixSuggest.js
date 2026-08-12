/**
 * Ask the AI which fixes this dataset needs.
 *
 * THE SHAPE THAT MAKES THIS SAFE
 * ------------------------------
 * The model reads COMPUTED STATISTICS, never rows (ADR-0006). It returns
 * nothing but operation names drawn from the closed catalogue in
 * dataFixes.js, and every suggestion is validated against that catalogue and
 * against the real column list before the user ever sees it. A hallucinated
 * operation or an invented column name is dropped, not executed.
 *
 * So the model's entire power is: choosing from a menu, and explaining why.
 * It cannot write a transformation, cannot touch a row, and cannot apply
 * anything — apply is a separate, user-confirmed call that writes a new
 * dataset version.
 *
 * OFFLINE
 * -------
 * If the model is unavailable, mocked, or returns unusable output, the
 * deterministic suggester below runs instead. It reads the same statistics
 * and applies plain rules. That matters more than it sounds: the demo runs
 * without internet, and a suggester that vanishes when the wifi drops is
 * worse than one that was never clever.
 */
import { OPERATIONS } from "./dataFixes.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("fix-suggest");
const MODEL = "claude-sonnet-4-6";

/**
 * Deterministic suggestions from the column statistics.
 *
 * This is the floor, not a degraded mode — it runs offline, costs nothing,
 * and its reasoning is inspectable. The AI path exists to phrase things more
 * naturally and catch combinations these rules miss.
 */
export function suggestDeterministic(colAnalysis = [], totalRows = 0, dupeCount = 0) {
  const out = [];

  if (dupeCount > 0) {
    out.push({
      op: "drop-duplicates", params: {},
      reasonTh: `พบ ${dupeCount} แถวที่ซ้ำกันทั้งหมด`,
      reasonEn: `${dupeCount} fully duplicated row(s) found`,
      severity: dupeCount / Math.max(totalRows, 1) > 0.05 ? "high" : "medium",
    });
  }

  for (const c of colAnalysis) {
    const missing = c.missing ?? c.missingCount ?? 0;
    const pct = totalRows ? missing / totalRows : 0;

    // Only worth suggesting when it is a real hole, not one stray blank.
    if (missing > 0 && pct >= 0.02) {
      out.push({
        op: "drop-missing", params: { column: c.col },
        reasonTh: `คอลัมน์ "${c.col}" มีค่าว่าง ${missing} แถว (${(pct * 100).toFixed(1)}%)`,
        reasonEn: `"${c.col}" has ${missing} missing value(s) (${(pct * 100).toFixed(1)}%)`,
        severity: pct > 0.2 ? "high" : "medium",
      });
    }

    const outliers = Array.isArray(c.outliers) ? c.outliers.length : (c.outlierCount ?? 0);
    if (c.type === "numeric" && outliers > 0) {
      out.push({
        op: "drop-outliers", params: { column: c.col },
        reasonTh: `คอลัมน์ "${c.col}" มีค่าผิดปกติ ${outliers} จุด`,
        reasonEn: `"${c.col}" has ${outliers} outlier(s)`,
        severity: outliers / Math.max(totalRows, 1) > 0.1 ? "high" : "medium",
      });
    }

    // Near-duplicate labels: same text once spacing and case are folded.
    if (c.type !== "numeric" && Array.isArray(c.top)) {
      const folded = new Map();
      for (const t of c.top) {
        const k = String(t.value ?? "").replace(/\s+/g, "").toLowerCase();
        if (!k) continue;
        folded.set(k, (folded.get(k) || 0) + 1);
      }
      if ([...folded.values()].some((n) => n > 1)) {
        out.push({
          op: "merge-categories", params: { column: c.col },
          reasonTh: `คอลัมน์ "${c.col}" มีค่าที่สะกดต่างกันแต่น่าจะหมายถึงสิ่งเดียวกัน`,
          reasonEn: `"${c.col}" has values that differ only by spacing or case`,
          severity: "medium",
        });
      }
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
}

/**
 * Drop anything the model invented.
 *
 * The model is told to pick from the catalogue, and mostly does. This is what
 * happens when it does not: unknown operations, columns that are not in the
 * dataset, and missing required params are discarded rather than passed on to
 * a user who would reasonably trust them.
 */
export function validateSuggestions(raw, headers) {
  if (!Array.isArray(raw)) return [];
  const cols = new Set(headers || []);
  const clean = [];

  for (const s of raw) {
    const op = s?.op;
    if (!OPERATIONS[op]) { log.debug({ op }, "dropped: not in catalogue"); continue; }

    const spec = OPERATIONS[op];
    const params = {};
    if (spec.needs.includes("column")) {
      const col = s?.params?.column ?? s?.column;
      if (!col || !cols.has(col)) { log.debug({ op, col }, "dropped: unknown column"); continue; }
      params.column = col;
    }

    clean.push({
      op, params,
      reasonTh: typeof s.reasonTh === "string" ? s.reasonTh.slice(0, 200) : "",
      reasonEn: typeof s.reasonEn === "string" ? s.reasonEn.slice(0, 200) : "",
      severity: ["high", "medium", "low"].includes(s.severity) ? s.severity : "medium",
      source: "ai",
    });
    if (clean.length >= 6) break;
  }
  return clean;
}

function buildPrompt({ headers, colAnalysis, totalRows, dupeCount }) {
  // Statistics only. No rows, no cell values beyond the frequency tables that
  // were already computed — ADR-0006.
  const summary = colAnalysis.map((c) => ({
    column: c.col,
    type: c.type,
    missing: c.missing ?? c.missingCount ?? 0,
    unique: c.unique ?? c.uniqueCount ?? null,
    outliers: Array.isArray(c.outliers) ? c.outliers.length : (c.outlierCount ?? 0),
    topValues: Array.isArray(c.top) ? c.top.slice(0, 5).map((t) => t.value) : undefined,
  }));

  const catalogue = Object.entries(OPERATIONS)
    .map(([id, o]) => `  "${id}" — ${o.en}${o.needs.includes("column") ? " (requires params.column)" : ""}`)
    .join("\n");

  return `You are helping a Thai university student clean a dataset before thesis analysis.

You may ONLY choose operations from this catalogue. Do not invent operations.
${catalogue}

Columns available: ${JSON.stringify(headers)}
Total rows: ${totalRows}. Fully duplicated rows: ${dupeCount}.
Column statistics:
${JSON.stringify(summary, null, 1)}

Suggest at most 4 fixes that would genuinely improve this dataset. Suggest
nothing if the data is already clean — an empty array is a valid answer, and
is better than a fix nobody needs.

Never suggest removing data merely because it is unusual; outliers are only
worth removing when they look like recording errors.

Respond with ONLY a JSON array, no prose and no markdown fence:
[{"op":"drop-missing","params":{"column":"..."},"reasonTh":"...","reasonEn":"...","severity":"high|medium|low"}]`;
}

/**
 * Ask the model, validate hard, fall back to rules if anything goes wrong.
 * Always resolves — a suggester that throws is a suggester nobody trusts.
 */
export async function suggestFixes(ai, { headers, colAnalysis, totalRows, dupeCount }) {
  const fallback = () => ({
    suggestions: suggestDeterministic(colAnalysis, totalRows, dupeCount).map((s) => ({ ...s, source: "rules" })),
    source: "rules",
  });

  if (!ai?.messages?.create) return fallback();

  try {
    const msg = await ai.messages.create({
      model: MODEL, max_tokens: 900,
      messages: [{ role: "user", content: buildPrompt({ headers, colAnalysis, totalRows, dupeCount }) }],
    });

    const text = msg?.content?.[0]?.text ?? "";
    // The model sometimes fences its JSON despite being asked not to.
    const json = text.replace(/```(?:json)?/g, "").trim();
    const first = json.indexOf("["), last = json.lastIndexOf("]");
    if (first < 0 || last < first) return fallback();

    const parsed = JSON.parse(json.slice(first, last + 1));
    const clean = validateSuggestions(parsed, headers);

    // An empty array from the model is a legitimate "nothing to fix". But if
    // validation stripped everything the model said, its output was unusable
    // and the rules are a better answer than silence.
    if (clean.length === 0 && parsed.length > 0) {
      log.warn({ proposed: parsed.length }, "all AI suggestions failed validation");
      return fallback();
    }
    return { suggestions: clean, source: "ai" };
  } catch (err) {
    log.warn({ err: err.message }, "AI suggest failed — using deterministic rules");
    return fallback();
  }
}

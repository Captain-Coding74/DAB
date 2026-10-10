/**
 * services/analysisPipeline.js — v12
 *
 * THE single source of truth for the analyze flow. Before v12 this logic
 * lived in three places (both server endpoints + testApp), which meant the
 * integration tests could silently drift from production behaviour.
 *
 * v12 also makes the AI analysis *smarter*: the prompt now includes the
 * deterministic Insights Engine findings as verified facts, so the model
 * grounds its report in checked statistics instead of re-deriving them.
 */
import { analyzeColumns, detectMissing, detectDuplicates,
         correlationMatrix, autoForecast, autoForecastFromAnalysis, recommendCharts,
         buildSummaryString } from "../analyze.js";
import { parseAllRows } from "./fullRows.js";
import { parseFlexibleNumber } from "./normalize.js";
import { enrichChartsWithData, alignHeaders } from "./chartSeries.js";
import { generatePromptSuggestions, autoChartConfig } from "./promptSuggestions.js";
import { computeQualityScore } from "./qualityScore.js";
import { generateInsights }    from "./insights.js";
import { buildClassReport } from "./classReport.js";
import { aiSafeStats, aiSafeInsights } from "./aiSafe.js";

/**
 * Everything derivable from a parsed file, in one call.
 * Input: the output of parseFileStreaming().
 */
export function computeStatsBundle({ headers, colAnalysis, totalRows, dupeCount, sampleRows, pairwise = null, buffer = null, fileName = "", sensitive = [], headRows = [] }) {
  const missing     = colAnalysis.filter(c => c.missing > 0)
    .map(c => ({ col: c.col, missing: c.missing, total: totalRows, pct: c.missingPct }));
  const dupes       = { count: dupeCount };
  /* Prefer the exact matrix built over EVERY row during parsing.
     correlationMatrix(headers, sampleRows) correlates a FIVE-ROW reservoir
     sample: with n=5 two unrelated columns clear the 0.7 "strong" threshold
     20% of the time, so an 8-column file invented roughly six findings. */
  const corr        = pairwise ?? correlationMatrix(headers, sampleRows);
  /* Prefer the full-column sums: autoForecast(headers, sampleRows) fits its
     line to a reservoir SAMPLE in sampling order, which had every bundled
     demo file reporting no trend at all despite R2 around 0.8 in the real
     data. Fall back only if the parser produced no trend sums. */
  const fromAnalysis = autoForecastFromAnalysis(colAnalysis);
  /* v21.9: the SAMPLE fallback is gone. autoForecast(headers, sampleRows)
     fabricated a trend from 5 random rows whenever the parser produced no
     trend sums — with n=5 a random series clears the r2 bar by luck, so the
     Forecast tab showed forecast-shaped guesses. Now the fallback runs on
     EVERY row (parsed once below, shared with the chart series) and an empty
     result stays empty: the tab's empty state is the honest answer. */
  let forecasts     = fromAnalysis;
  let classReport   = null;
  const chartRecs   = recommendCharts(colAnalysis);
  let autoCharts    = autoChartConfig(colAnalysis);
  /* v21.9 (roadmap item 1): charts draw the DATA, not the sample. CSV only —
     parseAllRows declines xlsx by design (this function is sync and has sync
     callers, so it cannot await the async xlsx reader) — and old saved
     analyses simply lack `data`, so the frontend keeps its sample fallback
     for both. */
  if (buffer) {
    const full = alignHeaders(parseAllRows(buffer, fileName), colAnalysis.map((c) => c.col));
    if (full.rows?.length) {
      autoCharts = enrichChartsWithData(autoCharts, full.headers, full.rows);
      /* School edition: the teacher's deterministic ranking view (ใครได้
         มากสุด/น้อยสุด/เกียรติบัตร) — computed from EVERY row, UI-bound only:
         it is not in summaryStr, not in the prompt, not in saved stats_json. */
      classReport = buildClassReport({ headers: full.headers, rows: full.rows, colAnalysis, sensitive, fileName });
      /* The fallback only sees columns the PARSER classified numeric, with
         cells pre-coerced by the parser's own number rules. autoForecast's
         raw parseFloat read "2026-01-14" as 2026, so an ISO date column whose
         name escaped isIndexColumn ("OrderDate", "วันขาย") became a year-valued
         step function with a confident R² — the exact leak the dates-first
         parser design exists to prevent. */
      if (!forecasts.length) {
        const numericCols = new Set(colAnalysis
          .filter((c) => c.type === "numeric" && c.semantic !== "date" && !c.sensitive)
          .map((c) => c.col));
        const keep = full.headers.map((h, i) => (numericCols.has(h) ? i : -1)).filter((i) => i >= 0);
        if (keep.length) {
          const coerced = full.rows.map((r) => keep.map((i) => {
            const n = parseFlexibleNumber(r[i]);
            return n === null ? "" : n;
          }));
          forecasts = autoForecast(keep.map((i) => full.headers[i]), coerced);
        }
      }
    } else if (headRows.length && totalRows <= headRows.length) {
      /* xlsx uploads: parseAllRows returned nothing (CSV-only, see above) but
         the streaming parser handed us headRows — the FIRST 500 rows in file
         order. Charts keep their CSV-only behaviour, and forecasts already
         come from the parser's full-column trend sums. The class report,
         though, caps a class at 500 rows anyway (a "class", not a warehouse),
         so for any classroom-sized sheet headRows IS every row — a teacher
         uploading the gradebook as .xlsx gets the same report as CSV. The
         totalRows guard keeps the parity exact: past 500 rows headRows is a
         truncation, and ranking a truncated class would be a wrong answer,
         not a partial one — CSV returns null there, so xlsx must too. */
      classReport = buildClassReport({ headers, rows: headRows, colAnalysis, sensitive, fileName });
    }
  }
  /* Quality BEFORE suggestions: generatePromptSuggestions gates its
     "quality issues" prompt on the score, and a hard-coded null made that
     branch unreachable no matter how bad the file was. */
  const quality     = computeQualityScore(colAnalysis, totalRows, dupeCount);
  const suggestions = generatePromptSuggestions(colAnalysis, quality);
  const insights    = generateInsights({ colAnalysis, totalRows, dupeCount, corr, forecasts });
  /* summaryStr and aiInsights are the AI-bound half of the bundle (both are
     stripped from the HTTP response by analysisResponse). Detected
     personal-data columns carry no statistics into them — not their
     frequency tables, aggregates or missing counts, not a correlation,
     forecast or finding that names them. v21.30 widened this from the five School
     Edition identifiers to every detected kind, s.26 sensitive data
     included, through the same aiSafe view chat and the agent use. The
     model still learns the columns exist, by name and kind, in one line. */
  const safe       = aiSafeStats({ colAnalysis, corr, forecasts });
  const openCols   = safe.colAnalysis.filter((c) => !c.sensitive);
  const maskedCols = safe.colAnalysis.filter((c) => c.sensitive);
  const openMissing = missing.filter((m) => !safe.hidden.has(m.col));
  const summaryStr = buildSummaryString(openCols, openMissing, dupes, safe.corr, safe.forecasts) +
    (maskedCols.length
      ? "\n[masked ตาม PDPA] " + maskedCols.map((c) => `${c.col} (${c.sensitive})`).join(", ")
      : "");
  const aiInsights = aiSafeInsights(insights, safe.hidden);
  return { missing, dupes, corr, forecasts, chartRecs, autoCharts, suggestions, quality, insights, summaryStr, aiInsights, classReport };
}

/**
 * The analysis prompt. v12: deterministic findings ride along as verified
 * facts — the model comments on and extends them rather than guessing.
 * v21.30: statistics ONLY. The prompt used to end with the header row and
 * five reservoir-sampled raw rows, strict-masked for the five School
 * Edition identifiers and nothing else — so an email address, a street
 * address or a diagnosis in a business file reached the model verbatim.
 * Every number the model may cite is already in summaryStr; the rows added
 * nothing it was allowed to use (the rules below forbid computing from
 * them), so they are gone rather than masked.
 */
/** A question longer than this is not a question. */
const MAX_QUESTION = 500;

export function buildAnalysisPrompt({ question, totalRows, headers, fileType, bundle }) {
  /* req.body.question reached the prompt unbounded, and express.json allows a
     1 MB body — so a single request could bury the statistics under a wall of
     text and burn the AI budget on every call. Capped here rather than in the
     routes so every caller is covered. */
  const q = String(question ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION) || "สรุปภาพรวมข้อมูลทั้งหมด";
  const { quality, summaryStr, aiInsights } = bundle;
  const findings = aiInsights?.length
    ? `\nผลตรวจเชิงสถิติที่ยืนยันแล้ว (อ้างอิงได้เลย):\n` +
      aiInsights.slice(0, 5).map(i => `- [${i.severity}] ${i.title} — ${i.detail}`).join("\n") + "\n"
    : "";
  return (
    `คุณคือนักวิเคราะห์ข้อมูลมืออาชีพ วิเคราะห์ข้อมูลนี้แล้ว${q}\n\n` +
    `Dataset: ${totalRows.toLocaleString()} rows | ${headers.length} cols${fileType ? ` | ${fileType}` : ""} | quality: ${quality?.score || "?"}/100\n\n` +
      `${summaryStr}\n${findings}\n` +
    /* ADR-0001 says the statistics are deterministic and the model only
         interprets them. The prompt handed over verified numbers but never said
         the model must not compute its own, so it could quietly produce an
         average or a percentage nobody checked — indistinguishable, to the
         reader, from the ones this codebase proved correct. */
      `กติกา:\n` +
      `- ใช้เฉพาะตัวเลขที่ให้มาข้างต้น ห้ามคำนวณตัวเลขใหม่เอง และห้ามเดาค่าที่ไม่มีในข้อมูล\n` +
      `- ถ้าจะอ้างตัวเลข ต้องเป็นตัวเลขที่ปรากฏด้านบนเท่านั้น\n` +
      `- ถ้าข้อมูลไม่พอจะสรุป ให้บอกตรง ๆ ว่าไม่พอ ดีกว่าเดา\n\n` +
      `วิเคราะห์ภาษาไทย 4 ส่วน:\n1)สรุปภาพรวม\n2)สิ่งน่าสนใจ (เชื่อมโยงกับผลตรวจที่ยืนยันแล้วถ้ามี)\n3)ปัญหาที่พบ\n4)คำแนะนำ`
  );
}

/** Standard shape every analyze endpoint responds with. */
export function analysisResponse({ aiAnalysis, totalRows, headers, durationMs, parsed, bundle, savedId }) {
  return {
    success: true, analysis: aiAnalysis, rows: totalRows, columns: headers.length, durationMs,
    colAnalysis: parsed.colAnalysis, sampleRows: parsed.sampleRows,
    sensitiveColumns: parsed.sensitive || [],
    ...bundle, summaryStr: undefined, aiInsights: undefined, savedId,
  };
}

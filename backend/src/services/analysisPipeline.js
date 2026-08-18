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

/**
 * Everything derivable from a parsed file, in one call.
 * Input: the output of parseFileStreaming().
 */
export function computeStatsBundle({ headers, colAnalysis, totalRows, dupeCount, sampleRows, pairwise = null, buffer = null, fileName = "" }) {
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
  const chartRecs   = recommendCharts(colAnalysis);
  let autoCharts    = autoChartConfig(colAnalysis);
  /* v21.9 (roadmap item 1): charts draw the DATA, not the sample. CSV only —
     parseAllRows declines xlsx by design — and old saved analyses simply
     lack `data`, so the frontend keeps its sample fallback for both. */
  if (buffer) {
    const full = alignHeaders(parseAllRows(buffer, fileName), colAnalysis.map((c) => c.col));
    if (full.rows?.length) {
      autoCharts = enrichChartsWithData(autoCharts, full.headers, full.rows);
      /* The fallback only sees columns the PARSER classified numeric, with
         cells pre-coerced by the parser's own number rules. autoForecast's
         raw parseFloat read "2026-01-14" as 2026, so an ISO date column whose
         name escaped isIndexColumn ("OrderDate", "วันขาย") became a year-valued
         step function with a confident R² — the exact leak the dates-first
         parser design exists to prevent. */
      if (!forecasts.length) {
        const numericCols = new Set(colAnalysis
          .filter((c) => c.type === "numeric" && c.semantic !== "date")
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
    }
  }
  /* Quality BEFORE suggestions: generatePromptSuggestions gates its
     "quality issues" prompt on the score, and a hard-coded null made that
     branch unreachable no matter how bad the file was. */
  const quality     = computeQualityScore(colAnalysis, totalRows, dupeCount);
  const suggestions = generatePromptSuggestions(colAnalysis, quality);
  const insights    = generateInsights({ colAnalysis, totalRows, dupeCount, corr, forecasts });
  const summaryStr  = buildSummaryString(colAnalysis, missing, dupes, corr, forecasts);
  return { missing, dupes, corr, forecasts, chartRecs, autoCharts, suggestions, quality, insights, summaryStr };
}

/**
 * The analysis prompt. v12: deterministic findings ride along as verified
 * facts — the model comments on and extends them rather than guessing.
 */
/** A question longer than this is not a question. */
const MAX_QUESTION = 500;

export function buildAnalysisPrompt({ question, totalRows, headers, fileType, bundle, sampleRows }) {
  /* req.body.question reached the prompt unbounded, and express.json allows a
     1 MB body — so a single request could bury the statistics under a wall of
     text and burn the AI budget on every call. Capped here rather than in the
     routes so every caller is covered. */
  const q = String(question ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION) || "สรุปภาพรวมข้อมูลทั้งหมด";
  const { quality, summaryStr, insights } = bundle;
  const findings = insights?.length
    ? `\nผลตรวจเชิงสถิติที่ยืนยันแล้ว (อ้างอิงได้เลย):\n` +
      insights.slice(0, 5).map(i => `- [${i.severity}] ${i.title} — ${i.detail}`).join("\n") + "\n"
    : "";
  return (
    `คุณคือนักวิเคราะห์ข้อมูลมืออาชีพ วิเคราะห์ข้อมูลนี้แล้ว${q}\n\n` +
    `Dataset: ${totalRows.toLocaleString()} rows | ${headers.length} cols${fileType ? ` | ${fileType}` : ""} | quality: ${quality?.score || "?"}/100\n\n` +
    /* The sample block used to be labelled just "Sample:", which reads as "here
         is the start of the data". It is a RANDOM reservoir sample of five rows,
         in sampling order, so a model narrating it ("January started strong…")
         would be inventing a sequence that does not exist. Say what it is. */
      `${summaryStr}\n${findings}\n` +
      `ตัวอย่างข้อมูล ${sampleRows.length} แถว (สุ่มมาจาก ${totalRows.toLocaleString()} แถว — ไม่ใช่แถวแรกและไม่เรียงตามลำดับ ห้ามใช้สรุปแนวโน้มหรือลำดับเวลา):\n` +
      `${headers.join(",")}\n${sampleRows.map(r => r.join(",")).join("\n")}\n\n` +
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
    ...bundle, summaryStr: undefined, savedId,
  };
}

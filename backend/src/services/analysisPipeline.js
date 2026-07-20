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
         correlationMatrix, autoForecast, recommendCharts,
         buildSummaryString } from "../analyze.js";
import { generatePromptSuggestions, autoChartConfig } from "./promptSuggestions.js";
import { computeQualityScore } from "./qualityScore.js";
import { generateInsights }    from "./insights.js";

/**
 * Everything derivable from a parsed file, in one call.
 * Input: the output of parseFileStreaming().
 */
export function computeStatsBundle({ headers, colAnalysis, totalRows, dupeCount, sampleRows }) {
  const missing     = colAnalysis.filter(c => c.missing > 0)
    .map(c => ({ col: c.col, missing: c.missing, total: totalRows, pct: c.missingPct }));
  const dupes       = { count: dupeCount };
  const corr        = correlationMatrix(headers, sampleRows);
  const forecasts   = autoForecast(headers, sampleRows);
  const chartRecs   = recommendCharts(colAnalysis);
  const autoCharts  = autoChartConfig(colAnalysis);
  const suggestions = generatePromptSuggestions(colAnalysis, null);
  const quality     = computeQualityScore(colAnalysis, totalRows, dupeCount);
  const insights    = generateInsights({ colAnalysis, totalRows, dupeCount, corr, forecasts });
  const summaryStr  = buildSummaryString(colAnalysis, missing, dupes, corr, forecasts);
  return { missing, dupes, corr, forecasts, chartRecs, autoCharts, suggestions, quality, insights, summaryStr };
}

/**
 * The analysis prompt. v12: deterministic findings ride along as verified
 * facts — the model comments on and extends them rather than guessing.
 */
export function buildAnalysisPrompt({ question, totalRows, headers, fileType, bundle, sampleRows }) {
  const { quality, summaryStr, insights } = bundle;
  const findings = insights?.length
    ? `\nผลตรวจเชิงสถิติที่ยืนยันแล้ว (อ้างอิงได้เลย):\n` +
      insights.slice(0, 5).map(i => `- [${i.severity}] ${i.title} — ${i.detail}`).join("\n") + "\n"
    : "";
  return (
    `คุณคือนักวิเคราะห์ข้อมูลมืออาชีพ วิเคราะห์ข้อมูลนี้แล้ว${question}\n\n` +
    `Dataset: ${totalRows.toLocaleString()} rows | ${headers.length} cols${fileType ? ` | ${fileType}` : ""} | quality: ${quality?.score || "?"}/100\n\n` +
    `${summaryStr}\n${findings}\nSample:\n${headers.join(",")}\n${sampleRows.map(r => r.join(",")).join("\n")}\n\n` +
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

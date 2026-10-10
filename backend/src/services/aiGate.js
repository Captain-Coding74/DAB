/**
 * services/aiGate.js — the two AI switches (v21.30).
 *
 *   • Per saved dataset: datasets.ai_enabled, toggled by the owner only
 *     (PATCH /api/datasets/:id/ai). Off means nothing from that dataset —
 *     its rows, its statistics, the analyses made from it — goes to the AI
 *     provider.
 *   • Per upload: "Statistics only — don't send to AI" on /api/analyze,
 *     recorded on the saved analysis as analyses.ai_disabled.
 *
 * Every AI entry point asks here BEFORE it reserves AI budget, so a refused
 * call costs nothing and sends nothing. Features that are AI and nothing
 * else (chat, the agent, AI edit) refuse with AI_DISABLED; features with a
 * deterministic floor (analyze, fix-suggest) serve the floor instead, the
 * same way they already degrade when the daily budget runs out.
 */
import { getDataset } from "../db/datasetRepository.js";

/** The refusal body, `{ error, errorEn, code }` like every other route. */
export const AI_DISABLED = {
  error: "ปิดการใช้ AI กับข้อมูลชุดนี้ไว้ — ไม่มีข้อมูลใดถูกส่งไปยังผู้ให้บริการ AI",
  errorEn: "AI is turned off for this data — nothing was sent to the AI provider",
  code: "AI_DISABLED",
};

/** Multipart fields arrive as strings: "1" / "true" switch a flag on. */
export const flagOn = (v) => v === true || /^(1|true)$/i.test(String(v ?? "").trim());

/** A dataset row's switch. Rows read before the migration have no column: on. */
export const aiEnabledRow = (ds) => Number(ds?.ai_enabled ?? 1) !== 0;

/** False only when the dataset exists and its owner switched AI off. */
export async function datasetAiEnabled(datasetId) {
  if (!datasetId) return true;
  const ds = await getDataset(datasetId);
  return !ds || aiEnabledRow(ds);
}

/** An analysis may use AI unless it was "statistics only" or its dataset's switch is off. */
export async function analysisAiEnabled(analysis) {
  if (Number(analysis?.ai_disabled ?? 0) !== 0) return false;
  return datasetAiEnabled(analysis?.dataset_id);
}

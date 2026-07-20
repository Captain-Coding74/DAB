/**
 * services/agent.js — v12 Intelligence
 *
 * A tool-use agent for "deep dive" questions: instead of answering from a
 * flattened prompt, the model *queries the computed statistics* through
 * tools and cites which checks it ran. The Anthropic client is injected,
 * so the loop, dispatch, and iteration cap are unit-tested with a fake
 * client — no API key needed to verify the machinery.
 *
 * Tools read from statsJson (persisted at analyze time). They never touch
 * raw file contents, so the agent is cheap, fast, and side-effect free.
 */

export const AGENT_TOOLS = [
  {
    name: "list_columns",
    description: "รายชื่อคอลัมน์ทั้งหมดพร้อมชนิด (numeric/text) และจำนวนค่าที่หาย ใช้เพื่อสำรวจโครงสร้างข้อมูลก่อนเจาะลึก",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_column_detail",
    description: "สถิติละเอียดของคอลัมน์เดียว: min/max/avg/median/stdDev/quartiles/outliers (numeric) หรือ unique/top values (text)",
    input_schema: { type: "object", properties: { column: { type: "string", description: "ชื่อคอลัมน์ตามจริง" } }, required: ["column"] },
  },
  {
    name: "get_correlations",
    description: "คู่คอลัมน์ตัวเลขที่สัมพันธ์กันแรง (|r| ≥ 0.7) พร้อมค่า r",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_forecasts",
    description: "ผล linear regression ต่อคอลัมน์: slope, R² และค่าคาดการณ์ช่วงถัดไป",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

export function runTool(name, input, statsJson = {}) {
  const cols = statsJson.colAnalysis || [];
  switch (name) {
    case "list_columns":
      return cols.map(c => ({ col: c.col, type: c.type, missing: c.missing, missingPct: c.missingPct }));
    case "get_column_detail": {
      const c = cols.find(x => x.col === input?.column);
      return c || { error: `ไม่พบคอลัมน์ "${input?.column}" — ใช้ list_columns ดูชื่อที่ถูกต้อง` };
    }
    case "get_correlations":
      return statsJson.corr?.strong?.length ? statsJson.corr.strong : { note: "ไม่มีคู่ที่ |r| ≥ 0.7" };
    case "get_forecasts":
      return statsJson.forecasts?.length ? statsJson.forecasts : { note: "ไม่มีคอลัมน์ที่มีแนวโน้มเชิงเส้นพอ (R² ≥ 0.5)" };
    default:
      return { error: `unknown tool: ${name}` };
  }
}

/**
 * The agent loop.
 * @param {object} deps
 * @param {object} deps.client     Anthropic-compatible client ({ messages: { create } })
 * @param {object} deps.statsJson  Persisted stats for the analysis
 * @param {string} deps.analysisText  The original AI report (context)
 * @param {string} deps.question   The user's deep-dive question
 * @param {number} [deps.maxSteps] Tool-round cap (default 5)
 * @returns {Promise<{reply: string, steps: Array<{tool: string, input: object}>}>}
 */
export async function runAgent({ client, statsJson, analysisText, question, maxSteps = 5, model = "claude-sonnet-4-6" }) {
  const steps = [];
  const messages = [
    { role: "user", content:
      `คุณคือนักวิเคราะห์ข้อมูลที่ตรวจสอบได้ คุณเคยวิเคราะห์ชุดข้อมูลนี้ไว้ว่า:\n${(analysisText || "").slice(0, 1200)}\n\n` +
      `ตอบคำถามต่อไปนี้โดย "ใช้ tools ตรวจสถิติจริงก่อนตอบ" อย่าเดาตัวเลข ถ้าตัวเลขสำคัญให้เรียก tool ยืนยันเสมอ ` +
      `ตอบภาษาไทย กระชับ อ้างอิงค่าที่ตรวจแล้ว\n\nคำถาม: ${question}` },
  ];

  for (let round = 0; round <= maxSteps; round++) {
    const msg = await client.messages.create({ model, max_tokens: 900, tools: AGENT_TOOLS, messages });

    if (msg.stop_reason !== "tool_use") {
      const reply = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      return { reply: reply || "(ไม่มีคำตอบ)", steps };
    }
    if (round === maxSteps) break; // out of budget: fall through to final answer

    messages.push({ role: "assistant", content: msg.content });
    const results = [];
    for (const block of msg.content) {
      if (block.type !== "tool_use") continue;
      steps.push({ tool: block.name, input: block.input });
      const out = runTool(block.name, block.input, statsJson);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 4000) });
    }
    messages.push({ role: "user", content: results });
  }

  // Budget exhausted — ask for the best answer from what was gathered
  messages.push({ role: "user", content: "หมดรอบการตรวจแล้ว สรุปคำตอบที่ดีที่สุดจากข้อมูลที่ตรวจมา" });
  const finalMsg = await client.messages.create({ model, max_tokens: 900, messages });
  const reply = finalMsg.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return { reply: reply || "(ไม่มีคำตอบ)", steps };
}

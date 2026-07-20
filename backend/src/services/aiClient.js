/**
 * services/aiClient.js — v13
 *
 * One place the Anthropic client is constructed, so the whole app can run
 * with a deterministic stub when AI_MOCK=1. This is what makes real
 * end-to-end tests possible (upload → analyze → export → share) without
 * burning tokens or requiring a key in CI.
 *
 * SAFETY: the mock is refused in production. A misconfigured deploy must
 * never silently serve fake analysis to real users.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger.js";

const MOCK_TEXT =
  "[MOCK] สรุปภาพรวม: ข้อมูลชุดนี้ถูกวิเคราะห์ในโหมดทดสอบ (AI_MOCK=1)\n" +
  "1) สรุปภาพรวม — ระบบอ่านสถิติครบทุกแถวแล้ว\n" +
  "2) สิ่งน่าสนใจ — อ้างอิงผลตรวจเชิงสถิติที่แนบมากับ prompt\n" +
  "3) ปัญหาที่พบ — ดูแท็บ insights\n" +
  "4) คำแนะนำ — ตรวจสอบคอลัมน์ที่มีค่าหายก่อนใช้งานจริง";

/** A minimal Anthropic-compatible stub: messages.create + messages.stream. */
function createMockClient() {
  const mockMessage = (text = MOCK_TEXT) => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  });

  return {
    __mock: true,
    messages: {
      // Tool-use aware: if tools are offered, run exactly one check so the
      // agent's trail is exercised end-to-end, then answer on the next turn.
      create: async ({ tools, messages }) => {
        const alreadyUsedTool = messages?.some(m =>
          Array.isArray(m.content) && m.content.some(b => b.type === "tool_result"));
        if (tools?.length && !alreadyUsedTool) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "mock_tu_1", name: "list_columns", input: {} }],
          };
        }
        return mockMessage("[MOCK] ตรวจคอลัมน์แล้ว — คำตอบเชิงลึกในโหมดทดสอบ");
      },
      stream: (_opts) => {
        const chunks = ["[MOCK] ", "กำลังตอบ", "แบบสตรีม", " ครับ"];
        const handlers = {};
        const p = (async () => {
          await new Promise(r => setImmediate(r));
          for (const c of chunks) handlers.text?.(c);
          return mockMessage(chunks.join(""));
        })();
        return {
          on: (evt, fn) => { handlers[evt] = fn; },
          finalMessage: () => p,
        };
      },
    },
  };
}

export function createAIClient(env = process.env) {
  const wantsMock = env.AI_MOCK === "1";

  if (wantsMock && env.NODE_ENV === "production") {
    throw new Error("FATAL: AI_MOCK=1 is not allowed in production");
  }
  if (wantsMock) {
    logger.warn("AI_MOCK=1 — serving deterministic stub responses (no Anthropic calls)");
    return createMockClient();
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

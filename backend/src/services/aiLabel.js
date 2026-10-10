/**
 * The label on AI-generated text (v21.30).
 *
 * Every place that shows text written by the AI says so in the same words:
 * the dashboard report, chat replies, agent answers, public share pages, and
 * PDF / Excel exports. A reader who meets the text without the app around it
 * (a forwarded PDF, a share link) still learns that a model wrote it and that
 * it can be wrong. The SPA carries the same text as i18n key `ai.label`;
 * frontend/src/lib/i18n.test.js fails if the two drift apart.
 *
 * AI_GENERATED is the machine-readable flag exports carry in their document
 * metadata (PDF Keywords/Subject, workbook keywords), so a tool can tell AI
 * content apart without reading the visible label.
 */
export const AI_LABEL = Object.freeze({
  en: "AI-generated — may be wrong. Check it before you rely on it.",
  th: "สร้างโดย AI — อาจผิดพลาดได้ โปรดตรวจสอบก่อนนำไปใช้",
});

export const AI_GENERATED = "ai_generated";

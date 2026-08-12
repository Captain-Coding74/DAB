/**
 * AI row editing — the model reads and rewrites actual cell values.
 *
 * WHAT THIS DEPARTS FROM
 * ----------------------
 * ADR-0006 says the agent queries computed statistics and never sees raw
 * rows. This module deliberately breaks that, so the departure is written
 * down rather than discovered later:
 *
 *   • Raw cell values leave the server and go to the Anthropic API. If a
 *     dataset holds participant names, phone numbers or student IDs, those
 *     are transmitted. Callers must be told before it happens.
 *   • The model chooses the new values. Unlike dataFixes.js, there is no
 *     catalogue constraining what it may do — the instruction is free text.
 *
 * WHAT IS NOT NEGOTIABLE
 * ----------------------
 * Everything else stays. The model's output is validated for SHAPE before it
 * is trusted, every changed cell is diffed so the user sees exactly what
 * moved, nothing is written until a separate confirmed apply, and apply
 * creates a new dataset version so the original survives.
 *
 * The reason is not caution for its own sake. A thesis whose data changed by
 * a process the student cannot explain is not defensible. The diff is what
 * makes this usable in a defence: every edit has a before, an after, and a
 * stated instruction that produced it.
 */
import { serviceLogger } from "../logger.js";

const log = serviceLogger("ai-edit");
const MODEL = "claude-sonnet-4-6";

/**
 * Hard cap on rows sent to the model.
 *
 * Not a style preference: a 25 MB upload can hold hundreds of thousands of
 * rows, and sending those would blow the context window, cost a fortune, and
 * time out. Beyond this the caller is told to use the deterministic catalogue
 * in dataFixes.js, which has no such limit because it never leaves the server.
 */
export const MAX_AI_EDIT_ROWS = 300;

/** Cheap detector for columns that look like they identify a person. */
const PII_HINTS = [
  /name|ชื่อ|นามสกุล/i, /phone|tel|เบอร์|โทร/i, /email|อีเมล/i,
  /id\b|เลขที่|รหัส|บัตร/i, /address|ที่อยู่/i, /line\s?id/i,
];

/** Columns whose header suggests personal data, so the caller can warn. */
export function detectSensitiveColumns(headers = []) {
  return headers.filter((h) => PII_HINTS.some((re) => re.test(String(h))));
}

/**
 * Validate the model's rewrite before anything is shown as truth.
 *
 * The model can return the wrong number of rows, the wrong number of columns,
 * or prose where a table should be. Any of those silently corrupt a dataset,
 * so the shape is checked first and the whole response rejected if it fails.
 */
export function validateEdit(original, proposed) {
  if (!Array.isArray(proposed)) {
    return { ok: false, error: "โมเดลไม่ได้ตอบเป็นตาราง", errorEn: "model did not return a table" };
  }
  if (proposed.length !== original.length) {
    return {
      ok: false,
      error: `จำนวนแถวเปลี่ยนจาก ${original.length} เป็น ${proposed.length}`,
      errorEn: `row count changed from ${original.length} to ${proposed.length} — rejected`,
    };
  }
  for (let i = 0; i < proposed.length; i++) {
    if (!Array.isArray(proposed[i]) || proposed[i].length !== original[i].length) {
      return {
        ok: false,
        error: `แถวที่ ${i + 1} มีจำนวนคอลัมน์ไม่ตรง`,
        errorEn: `row ${i + 1} has the wrong number of columns — rejected`,
      };
    }
  }
  return { ok: true };
}

/**
 * Every cell that differs, with its coordinates. This is the artifact that
 * makes an AI edit defensible — without it, "the AI cleaned it" is all the
 * student can say.
 */
export function diffRows(original, proposed, headers) {
  const changes = [];
  for (let r = 0; r < original.length; r++) {
    for (let c = 0; c < original[r].length; c++) {
      const before = String(original[r][c] ?? "");
      const after = String(proposed[r][c] ?? "");
      if (before !== after) {
        changes.push({ row: r + 1, column: headers[c] ?? `col${c + 1}`, before, after });
      }
    }
  }
  return changes;
}

function buildPrompt(headers, rows, instruction) {
  return `You are cleaning a Thai dataset for a university thesis.

Instruction from the user: ${instruction}

Rules you must follow exactly:
- Return the SAME number of rows, in the SAME order, with the SAME number of columns.
- Change only cells the instruction actually requires. Leave everything else byte-identical.
- Never invent data. If a value is missing and the instruction does not say how to fill it, leave it empty.
- Do not reorder, sort, add or delete rows. If the instruction asks you to remove rows, do not — reply with the text NEEDS_ROW_OPERATION instead.

Columns: ${JSON.stringify(headers)}
Rows (${rows.length}):
${JSON.stringify(rows)}

Respond with ONLY a JSON array of arrays. No prose, no markdown fence.`;
}

/**
 * Ask the model to rewrite the rows. Always resolves; never throws.
 * Returns { ok, rows, changes, error } — and on any doubt, ok:false.
 */
export async function aiEditRows(ai, { headers, rows, instruction }) {
  if (!instruction || typeof instruction !== "string" || instruction.trim().length < 3) {
    return { ok: false, error: "ต้องระบุคำสั่ง", errorEn: "an instruction is required" };
  }
  if (rows.length > MAX_AI_EDIT_ROWS) {
    return {
      ok: false,
      error: `ชุดข้อมูลใหญ่เกินไปสำหรับการแก้ด้วย AI (${rows.length} แถว, สูงสุด ${MAX_AI_EDIT_ROWS})`,
      errorEn: `too many rows for AI editing (${rows.length}, max ${MAX_AI_EDIT_ROWS}) — use the deterministic fixes instead`,
    };
  }
  if (!ai?.messages?.create) {
    return { ok: false, error: "AI ไม่พร้อมใช้งาน", errorEn: "no AI client available" };
  }

  try {
    const msg = await ai.messages.create({
      model: MODEL, max_tokens: 8000,
      messages: [{ role: "user", content: buildPrompt(headers, rows, instruction) }],
    });
    const text = msg?.content?.[0]?.text ?? "";

    if (/NEEDS_ROW_OPERATION/.test(text)) {
      return {
        ok: false,
        error: "คำสั่งนี้ต้องลบหรือเพิ่มแถว — ใช้การแก้ไขแบบกำหนดไว้แทน",
        errorEn: "that instruction adds or removes rows — use the deterministic fix catalogue instead",
      };
    }

    const cleaned = text.replace(/```(?:json)?/g, "").trim();
    const first = cleaned.indexOf("["), last = cleaned.lastIndexOf("]");
    if (first < 0 || last < first) {
      return { ok: false, error: "โมเดลตอบไม่ถูกรูปแบบ", errorEn: "model returned unparseable output" };
    }

    let proposed;
    try { proposed = JSON.parse(cleaned.slice(first, last + 1)); }
    catch { return { ok: false, error: "โมเดลตอบไม่ถูกรูปแบบ", errorEn: "model returned invalid JSON" }; }

    const shape = validateEdit(rows, proposed);
    if (!shape.ok) { log.warn({ err: shape.errorEn }, "AI edit rejected on shape"); return { ok: false, ...shape }; }

    const changes = diffRows(rows, proposed, headers);
    log.info({ changed: changes.length, rows: rows.length }, "AI edit produced a diff");
    return { ok: true, rows: proposed, changes, instruction };
  } catch (err) {
    log.warn({ err: err.message }, "AI edit failed");
    return { ok: false, error: "เรียก AI ไม่สำเร็จ", errorEn: `AI call failed: ${err.message}` };
  }
}

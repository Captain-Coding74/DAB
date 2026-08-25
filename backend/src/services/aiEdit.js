/**
 * AI row editing — the model reads and rewrites actual cell values.
 *
 * WHAT THIS DEPARTS FROM
 * ----------------------
 * ADR-0006 says the agent queries computed statistics and never sees raw
 * rows. This module deliberately breaks that, so the departure is written
 * down rather than discovered later:
 *
 *   • Raw cell values leave the server and go to the Anthropic API — but ONLY
 *     from columns that carry no identifier. Columns classified as personal
 *     data (citizen ID, student ID, name, birthdate, phone) are stripped from
 *     the payload before it is built: not masked, ABSENT. Their headers do
 *     not appear either, so the model cannot even learn the dataset HAS a
 *     citizen-ID column.
 *   • The model chooses the new values. Unlike dataFixes.js, there is no
 *     catalogue constraining what it may do — the instruction is free text.
 *
 * THE PDPA BOUNDARY (why subset-then-splice, not masking)
 * -------------------------------------------------------
 * The data subjects are school children. Masking still transmits shape and
 * position; omission transmits nothing. So:
 *
 *   1. classifySensitiveColumns (value-aware, checksum-backed — see
 *      sensitive.js) decides which columns are PROTECTED.
 *   2. Only the unprotected subset (headers + rows, original order) is sent.
 *   3. The model's answer is shape-validated against that SUBSET, then
 *      spliced back into copies of the full original rows. Protected cells
 *      are byte-identical by construction — they never left, so they cannot
 *      come back altered.
 *   4. An instruction that names a protected column is refused before any
 *      call: the user is asking the AI to edit identifiers, which PDPA rules
 *      out entirely — there is no compliant way to grant that.
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
import { AI_MODEL } from "../config.js";
import { classifySensitiveColumns } from "./sensitive.js";

const log = serviceLogger("ai-edit");

/* One Thai sentence for every PDPA refusal — the UI shows the same banner
   whether the user named a protected column or the whole table is
   identifiers. errorEn carries the case-specific detail for logs/devs. */
const PDPA_ERROR_TH = "คอลัมน์ข้อมูลส่วนบุคคลแก้ไขผ่าน AI ไม่ได้ (PDPA)";

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

/**
 * Columns whose header suggests personal data, so the caller can warn.
 * Header-only and intentionally loose — the AUTHORITATIVE decision about
 * what may reach the model is classifySensitiveColumns (value-aware), used
 * inside aiEditRows. This stays for the route's warning banner.
 */
export function detectSensitiveColumns(headers = []) {
  return headers.filter((h) => PII_HINTS.some((re) => re.test(String(h))));
}

/**
 * Validate the model's rewrite before anything is shown as truth.
 *
 * The model can return the wrong number of rows, the wrong number of columns,
 * or prose where a table should be. Any of those silently corrupt a dataset,
 * so the shape is checked first and the whole response rejected if it fails.
 * (Under the PDPA subset flow, `original` is the unprotected SUBSET — the
 * model must mirror exactly what it was given, nothing wider.)
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

/**
 * assertProtectedUnchanged(headers, originalRows, editedRows)
 *   -> { ok, violations: [{ row, col }] }
 *
 * The server-side backstop for the apply step. The preview flow guarantees
 * protected cells by construction, but /ai-edit/apply accepts rows from the
 * CLIENT — a tampered request could smuggle an edited citizen ID past the
 * shape check. So protection is re-derived here from the ORIGINAL rows (the
 * edited copy might have been altered precisely to dodge detection) and any
 * protected cell that differs is reported. `row` is 1-based to match
 * diffRows; `col` is the header name. Pure — no I/O, never throws.
 */
export function assertProtectedUnchanged(headers = [], originalRows = [], editedRows = []) {
  const detections = classifySensitiveColumns(headers, originalRows);
  const violations = [];
  for (let r = 0; r < originalRows.length; r++) {
    for (const d of detections) {
      /* Same string-coercion the diff uses: "100" posted back as 100 is the
         same cell, not a violation. A missing edited row leaves every
         non-empty protected cell "changed" — which is exactly right. */
      const before = String(originalRows[r]?.[d.index] ?? "");
      const after = String(editedRows[r]?.[d.index] ?? "");
      if (before !== after) violations.push({ row: r + 1, col: d.col });
    }
  }
  return { ok: violations.length === 0, violations };
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
 * Returns { ok, rows, changes, protectedColumns, error } — on any doubt,
 * ok:false. `rows` is always full-width: protected columns are carried over
 * from the originals untouched, only unprotected cells can differ.
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

  /* The PDPA boundary. Value-aware detection on the actual rows — a column
     of valid citizen-ID checksums is protected whatever its header claims. */
  const detections = classifySensitiveColumns(headers, rows);
  const protectedColumns = detections.map(({ col, kind }) => ({ col, kind }));

  /* Refusal 1: the instruction names a protected column. Substring match is
     deliberately blunt — "ชื่อ" inside a longer sentence still refuses. For
     minors' data, over-refusing costs a rephrase; under-refusing implies we
     would edit identifiers, which we never do. */
  const targeted = detections.find((d) => {
    const col = String(d.col ?? "").trim();
    return col !== "" && instruction.toLowerCase().includes(col.toLowerCase());
  });
  if (targeted) {
    log.warn({ kind: targeted.kind }, "AI edit refused: instruction targets a protected column");
    return {
      ok: false,
      error: PDPA_ERROR_TH,
      errorEn: `"${targeted.col}" is personal data (${targeted.kind}) — identifier columns cannot be edited through the AI (PDPA)`,
      protectedColumns,
    };
  }

  /* Refusal 2: everything is an identifier — the compliant payload would be
     empty, so there is nothing the AI may edit. Same Thai banner. */
  const keepIdx = headers.map((_, i) => i)
    .filter((i) => !detections.some((d) => d.index === i));
  if (keepIdx.length === 0) {
    log.warn({ columns: headers.length }, "AI edit refused: every column is protected");
    return {
      ok: false,
      error: PDPA_ERROR_TH,
      errorEn: "every column is personal data — nothing the AI is allowed to edit (PDPA)",
      protectedColumns,
    };
  }

  /* The model sees ONLY this subset — protected headers and values are
     absent from the payload, not masked. Order within the subset follows
     the original column order so splice-back is a simple index map. */
  const subHeaders = keepIdx.map((i) => headers[i]);
  const subRows = rows.map((row) => keepIdx.map((i) => row[i]));

  try {
    const msg = await ai.messages.create({
      model: AI_MODEL, max_tokens: 8000,
      messages: [{ role: "user", content: buildPrompt(subHeaders, subRows, instruction) }],
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

    /* Shape is validated against the SUBSET — the model must return exactly
       the table it was shown. A full-width response (or any other width)
       is a protocol violation and is rejected wholesale. */
    const shape = validateEdit(subRows, proposed);
    if (!shape.ok) { log.warn({ err: shape.errorEn }, "AI edit rejected on shape"); return { ok: false, ...shape }; }

    /* Splice the edited subset back into copies of the full originals.
       Protected cells are the ORIGINAL values — they never left the server,
       so byte-identity is guaranteed by construction, not by checking. */
    const merged = rows.map((row, r) => {
      const copy = [...row];
      keepIdx.forEach((origIdx, j) => { copy[origIdx] = proposed[r][j]; });
      return copy;
    });

    /* The diff runs on FULL rows, same as always — coordinates and column
       names in `changes` refer to the real table the user sees. */
    const changes = diffRows(rows, merged, headers);
    log.info(
      { changed: changes.length, rows: rows.length, protected: detections.length },
      "AI edit produced a diff",
    );
    return { ok: true, rows: merged, changes, instruction, protectedColumns };
  } catch (err) {
    log.warn({ err: err.message }, "AI edit failed");
    return { ok: false, error: "เรียก AI ไม่สำเร็จ", errorEn: `AI call failed: ${err.message}` };
  }
}

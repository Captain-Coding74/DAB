/**
 * Data-fix endpoints (v21.3) — "ask the AI to fix it", done defensibly.
 *
 * THE DESIGN CONSTRAINT
 * ---------------------
 * An AI that rewrites rows breaks ADR-0006 and, worse, produces a thesis the
 * student cannot defend. So the AI never touches data. It reads the computed
 * statistics, names an operation from the closed catalogue in
 * services/dataFixes.js, and this route performs it deterministically.
 *
 * Two endpoints, and the order matters:
 *   POST /preview — pure. Reports what WOULD change. Writes nothing.
 *   POST /apply   — writes a NEW dataset version. The original is untouched
 *                   and remains selectable, so any fix is reversible.
 *
 * Every applied fix records a log line written for a methodology chapter,
 * because "what did you change and why" is a question with a right answer.
 */
import { requireAuth } from "../auth.js";
import { analyzeLimiter, speedLimiter } from "../middleware/rateLimiter.js";
import { serviceLogger } from "../logger.js";
import { parseAllRows } from "../services/fullRows.js";
import { applyFix, OPERATIONS } from "../services/dataFixes.js";
import { suggestFixes } from "../services/fixSuggest.js";
import { aiEditRows, detectSensitiveColumns, MAX_AI_EDIT_ROWS } from "../services/aiEdit.js";

const log = serviceLogger("fixes");

/** Re-serialise rows to CSV so the fixed version parses like any upload. */
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function mountFixRoutes(app, { ai } = {}) {
  /** What can be fixed, for the UI to offer. */
  app.get("/api/fixes/catalogue", requireAuth, (_req, res) => {
    res.json({
      operations: Object.entries(OPERATIONS).map(([id, o]) => ({ id, ...o })),
      note: "AI เสนอได้ แต่การแก้ไขทั้งหมดคำนวณแบบตายตัว และต้องยืนยันก่อนเสมอ",
      noteEn: "The AI may propose; every fix is deterministic and requires confirmation.",
    });
  });

  /**
   * Ask what this dataset needs. The model picks from the catalogue and
   * explains why; every suggestion is validated before it is returned, and
   * nothing is applied. Falls back to deterministic rules when the model is
   * unavailable, so this works offline.
   */
  app.post("/api/fixes/:id/suggest", analyzeLimiter(), requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res); if (!ctx) return;
      const { parseFileStreaming } = await import("../services/streaming.js");
      const { getVersionBytes } = await import("../db/datasetRepository.js");
      const parsed = await parseFileStreaming(await getVersionBytes(ctx.version), ctx.version.file_name);

      const { suggestions, source } = await suggestFixes(ai, {
        headers: parsed.headers,
        colAnalysis: parsed.colAnalysis,
        totalRows: parsed.totalRows,
        dupeCount: parsed.dupeCount,
      });

      log.info({ datasetId: req.params.id, count: suggestions.length, source }, "fixes suggested");
      res.json({
        suggestions, source,
        note: "ยังไม่มีอะไรถูกแก้ — กด preview เพื่อดูผลก่อน",
        noteEn: "Nothing has been changed. Preview a suggestion to see its effect.",
      });
    } catch (err) { next(err); }
  });

  /** Dry run — never writes. */
  app.post("/api/fixes/:id/preview", requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res); if (!ctx) return;
      const { op, params } = req.body || {};
      const result = applyFix(ctx.rows, ctx.headers, op, params || {});
      if (result.error) return res.status(400).json(result);

      res.json({
        op, params,
        rowsBefore: result.rowsBefore, rowsAfter: result.rowsAfter,
        removed: result.removed, changed: result.changed,
        log: result.log, logTh: result.logTh,
        sample: result.rows.slice(0, 10),
        headers: ctx.headers,
        applied: false,
      });
    } catch (err) { next(err); }
  });

  /**
   * Free-text AI edit — the model rewrites actual cell values.
   *
   * This is the one place raw rows leave the server (see the header of
   * services/aiEdit.js). It PREVIEWS only: the response carries a cell-level
   * diff and the edited rows, and nothing is stored until the caller posts
   * them back to /ai-edit/apply. Sensitive-looking columns are named in the
   * response so a UI can warn before the user commits.
   */
  app.post("/api/fixes/:id/ai-edit", analyzeLimiter(), speedLimiter(), requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res); if (!ctx) return;
      const { instruction } = req.body || {};

      const result = await aiEditRows(ai, { headers: ctx.headers, rows: ctx.rows, instruction });
      if (!result.ok) return res.status(400).json(result);

      res.json({
        applied: false,
        instruction: result.instruction,
        changes: result.changes,
        changeCount: result.changes.length,
        rows: result.rows,
        headers: ctx.headers,
        sensitiveColumns: detectSensitiveColumns(ctx.headers),
        warningTh: "ข้อมูลดิบถูกส่งไปยัง AI เพื่อแก้ไข — ตรวจสอบรายการเปลี่ยนแปลงก่อนยืนยัน",
        warningEn: "Raw cell values were sent to the AI. Review every change before confirming.",
        maxRows: MAX_AI_EDIT_ROWS,
      });
    } catch (err) { next(err); }
  });

  /** Commit an AI edit the caller has reviewed. Writes a new version. */
  app.post("/api/fixes/:id/ai-edit/apply", requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res); if (!ctx) return;
      const { rows, instruction } = req.body || {};

      // Re-validate: the client could post back anything, and the shape rules
      // exist to protect the dataset, not just the model's output.
      const { validateEdit, diffRows } = await import("../services/aiEdit.js");
      const shape = validateEdit(ctx.rows, rows);
      if (!shape.ok) return res.status(400).json(shape);

      const changes = diffRows(ctx.rows, rows, ctx.headers);
      if (changes.length === 0) {
        return res.status(400).json({ error: "ไม่มีอะไรเปลี่ยนแปลง", errorEn: "nothing would change" });
      }

      const DR = await import("../db/datasetRepository.js");
      const storage = await import("../services/storage.js");
      const { parseFileStreaming } = await import("../services/streaming.js");
      const { computeQualityScore } = await import("../services/qualityScore.js");

      const csv = Buffer.from(toCsv(ctx.headers, rows), "utf-8");
      const parsed = await parseFileStreaming(csv, ctx.version.file_name);
      const quality = computeQualityScore(parsed.colAnalysis, parsed.totalRows, parsed.dupeCount);
      const stored = await storage.put(
        storage.buildKey({ datasetId: req.params.id, versionNum: Date.now(), fileName: ctx.version.file_name }), csv);

      const note = `AI edit: ${String(instruction || "").slice(0, 80)} — ${changes.length} cell(s) changed`;
      const version = await DR.addDatasetVersion({
        datasetId: req.params.id, fileName: ctx.version.file_name,
        storageKey: stored.key, storageSha256: stored.sha256,
        fileType: ctx.version.file_type,
        totalRows: parsed.totalRows, totalCols: parsed.headers.length,
        colAnalysis: parsed.colAnalysis, qualityScore: quality?.score ?? null,
        changeNote: note, uploadedBy: req.user.userId, sizeBytes: csv.length,
      });

      log.info({ datasetId: req.params.id, changed: changes.length }, "AI edit applied as new version");
      res.status(201).json({
        applied: true, version, changes, changeCount: changes.length, log: note,
        reversibleEn: "the original version is untouched and still selectable",
      });
    } catch (err) { next(err); }
  });

  /** Apply — writes a NEW version, never mutates the existing one. */
  app.post("/api/fixes/:id/apply", requireAuth, async (req, res, next) => {
    try {
      const ctx = await load(req, res); if (!ctx) return;
      const { op, params } = req.body || {};
      const result = applyFix(ctx.rows, ctx.headers, op, params || {});
      if (result.error) return res.status(400).json(result);
      if (result.removed === 0 && result.changed === 0) {
        return res.status(400).json({ error: "ไม่มีอะไรเปลี่ยนแปลง", errorEn: "nothing would change" });
      }

      const DR = await import("../db/datasetRepository.js");
      const storage = await import("../services/storage.js");
      const { parseFileStreaming } = await import("../services/streaming.js");
      const { computeQualityScore } = await import("../services/qualityScore.js");

      const csv = Buffer.from(toCsv(ctx.headers, result.rows), "utf-8");
      const parsed = await parseFileStreaming(csv, ctx.version.file_name);
      const quality = computeQualityScore(parsed.colAnalysis, parsed.totalRows, parsed.dupeCount);

      const stored = await storage.put(
        storage.buildKey({ datasetId: req.params.id, versionNum: Date.now(), fileName: ctx.version.file_name }),
        csv
      );

      const version = await DR.addDatasetVersion({
        datasetId: req.params.id,
        fileName: ctx.version.file_name,
        storageKey: stored.key, storageSha256: stored.sha256,
        fileType: ctx.version.file_type,
        totalRows: parsed.totalRows, totalCols: parsed.headers.length,
        colAnalysis: parsed.colAnalysis,
        qualityScore: quality?.score ?? null,
        changeNote: result.logTh,          // the methodology line, on the version itself
        uploadedBy: req.user.userId,
        sizeBytes: csv.length,
      });

      log.info({ datasetId: req.params.id, op, removed: result.removed, changed: result.changed }, "fix applied as new version");
      res.status(201).json({
        applied: true, version,
        rowsBefore: result.rowsBefore, rowsAfter: result.rowsAfter,
        removed: result.removed, changed: result.changed,
        log: result.log, logTh: result.logTh,
        reversible: "เวอร์ชันเดิมยังอยู่ครบ",
        reversibleEn: "the original version is untouched and still selectable",
      });
    } catch (err) { next(err); }
  });
}

/** Shared load + permission check. Returns null after sending a response. */
async function load(req, res) {
  const { getUserDatasetRole, getDatasetWithContent, getVersionBytes } =
    await import("../db/datasetRepository.js");
  const { parseFileStreaming } = await import("../services/streaming.js");

  const role = await getUserDatasetRole(req.params.id, req.user.userId);
  if (!role) { res.status(403).json({ error: "No access to this dataset" }); return null; }

  const ds = await getDatasetWithContent(req.params.id);
  if (!ds?.version) { res.status(404).json({ error: "Dataset not found" }); return null; }

  const buffer = await getVersionBytes(ds.version);

  // NOT parseFileStreaming's sampleRows — that is a bounded reservoir SAMPLE
  // (five rows out of nine on a small test file), sized so a 50 MB upload
  // cannot exhaust memory. Correct for statistics, catastrophic for fixes: a
  // "remove outliers" that only saw a sample would silently rewrite the file
  // based on rows the user never chose. Fixes read every row.
  const { headers, rows } = parseAllRows(buffer, ds.version.file_name);
  if (!rows) {
    res.status(415).json({
      error: "แก้ไขอัตโนมัติรองรับเฉพาะไฟล์ CSV",
      errorEn: "automatic fixes currently support CSV only — export the sheet as CSV first",
    });
    return null;
  }
  return { rows, headers, version: ds.version };
}



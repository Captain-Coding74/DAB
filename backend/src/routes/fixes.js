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
import { serviceLogger } from "../logger.js";
import { applyFix, OPERATIONS } from "../services/dataFixes.js";

const log = serviceLogger("fixes");

/** Re-serialise rows to CSV so the fixed version parses like any upload. */
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function mountFixRoutes(app) {
  /** What can be fixed, for the UI to offer. */
  app.get("/api/fixes/catalogue", requireAuth, (_req, res) => {
    res.json({
      operations: Object.entries(OPERATIONS).map(([id, o]) => ({ id, ...o })),
      note: "AI เสนอได้ แต่การแก้ไขทั้งหมดคำนวณแบบตายตัว และต้องยืนยันก่อนเสมอ",
      noteEn: "The AI may propose; every fix is deterministic and requires confirmation.",
    });
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

/**
 * Read every row. CSV only, and deliberately so: an xlsx would need the whole
 * workbook in memory, and the fix catalogue is aimed at survey exports.
 * Returns { headers: null } for anything else so the caller can say why.
 */
function parseAllRows(buffer, fileName) {
  if (!/\.(csv|tsv|txt)$/i.test(fileName || "")) return { headers: null, rows: null };

  const text = buffer.toString("utf-8");
  const delim = (text.match(/\t/g) || []).length > (text.match(/,/g) || []).length ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };

  const split = (line) => {
    const out = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === delim && !inQ) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };

  const headers = split(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

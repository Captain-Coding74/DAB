/**
 * Inferential statistics endpoints (v21.2).
 *
 * DAB could describe a dataset but not answer "is this difference real?" —
 * the question a thesis defence actually asks. These run the tests a Thai
 * thesis needs: t-tests, ANOVA, chi-square, correlation, regression, and
 * Cronbach's alpha for questionnaire reliability.
 *
 * ADR-0001 holds: every number here is computed deterministically in
 * services/inference.js. The AI is not involved. It may later write prose
 * about these results, but it never produces them.
 *
 * Auth required — these run against a stored dataset, and dataset access is
 * already role-checked.
 */
import { requireAuth } from "../auth.js";
import { serviceLogger } from "../logger.js";
import { parseAllRows } from "../services/fullRows.js";
import {
  independentTTest, pairedTTest, oneWayAnova, chiSquareTest,
  pearsonCorrelation, linearRegression, cronbachAlpha,
} from "../services/inference.js";

const log = serviceLogger("inference");

/**
 * parseFileStreaming returns rows as POSITIONAL ARRAYS, not objects keyed by
 * column name — ["A", "120"], not { สาขา: "A" }. Every accessor here resolves
 * a header name to its index first. (An earlier version indexed by name and
 * silently found nothing, which surfaced as "0 groups" rather than an error.)
 */
const indexOf = (headers, name) => headers.indexOf(name);

const toNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Pull several columns out of parsed rows as ROW-ALIGNED numeric arrays.
 *
 * Listwise deletion: a row is kept only when every requested column parses.
 * The tests fed from here (paired-t, correlation, regression, Cronbach) all
 * pair values by array index — dropping blanks per column re-paired row 5's
 * x with row 7's y and produced a confident, wrong statistic.
 */
function columns(rows, headers, names) {
  const idx = names.map((n) => indexOf(headers, n));
  const out = names.map(() => []);
  if (idx.some((i) => i < 0)) return out;
  for (const r of rows) {
    const vals = idx.map((i) => toNumber(r[i]));
    if (vals.some((v) => v === null)) continue;   // incomplete row — drop whole row
    vals.forEach((v, j) => out[j].push(v));
  }
  return out;
}

/** Split a numeric column by the distinct values of a grouping column. */
function groupBy(rows, headers, valueCol, groupCol) {
  const vi = indexOf(headers, valueCol), gi = indexOf(headers, groupCol);
  const buckets = new Map();
  if (vi < 0 || gi < 0) return buckets;
  for (const r of rows) {
    const g = String(r[gi] ?? "").trim();
    if (!g) continue;
    const v = toNumber(r[vi]);
    if (v === null) continue;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(v);
  }
  return buckets;
}

export function mountInferenceRoutes(app) {
  /**
   * POST /api/inference/:id
   * body: { test, ...params }
   *
   * Runs one statistical test against a stored dataset's rows.
   */
  app.post("/api/inference/:id", requireAuth, async (req, res, next) => {
    try {
      const { getUserDatasetRole, getDatasetWithContent, getVersionBytes } =
        await import("../db/datasetRepository.js");
      const { parseFileStreaming } = await import("../services/streaming.js");

      const role = await getUserDatasetRole(req.params.id, req.user.userId);
      if (!role) return res.status(403).json({ error: "No access to this dataset" });

      const ds = await getDatasetWithContent(req.params.id);
      if (!ds?.version) return res.status(404).json({ error: "Dataset not found" });

      const buffer = await getVersionBytes(ds.version);
      /* Every row, not sampleRows.
         sampleRows is a five-row reservoir sample. Running a t-test on it gave
         "each group needs at least 2 values" on a 600-respondent survey — and
         where it did not refuse, it would have produced a p-value from five
         rows that a student might put in a thesis. */
      const { headers, rows: allRows } = parseAllRows(buffer, ds.version.file_name);
      if (!allRows) {
        return res.status(415).json({
          error: "การทดสอบทางสถิติรองรับเฉพาะไฟล์ CSV — กรุณาบันทึกเป็น CSV ก่อน",
          errorEn: "statistical tests currently support CSV only — export the sheet as CSV first",
        });
      }
      const sampleRows = allRows;

      const { test, valueColumn, groupColumn, xColumn, yColumn, beforeColumn, afterColumn, itemColumns } = req.body || {};
      let result;

      switch (test) {
        case "t-test": {
          const buckets = groupBy(sampleRows, headers, valueColumn, groupColumn);
          const keys = [...buckets.keys()];
          if (keys.length !== 2) {
            return res.status(400).json({
              error: `t-test ต้องมี 2 กลุ่มพอดี (พบ ${keys.length})`,
              errorEn: `a t-test needs exactly 2 groups, found ${keys.length}`,
              groupsFound: keys,
            });
          }
          result = { ...independentTTest(buckets.get(keys[0]), buckets.get(keys[1])), groupNames: keys };
          break;
        }
        case "paired-t": {
          const [before, after] = columns(sampleRows, headers, [beforeColumn, afterColumn]);
          result = pairedTTest(before, after);
          break;
        }
        case "anova": {
          const buckets = groupBy(sampleRows, headers, valueColumn, groupColumn);
          result = { ...oneWayAnova([...buckets.values()]), groupNames: [...buckets.keys()] };
          break;
        }
        case "chi-square": {
          // Build the contingency table from two categorical columns.
          const xi = indexOf(headers, xColumn), yi = indexOf(headers, yColumn);
          if (xi < 0 || yi < 0) {
            return res.status(400).json({ error: "ไม่พบคอลัมน์ที่เลือก", errorEn: "selected column not found" });
          }
          const rowVals = [...new Set(sampleRows.map((r) => String(r[xi] ?? "").trim()).filter(Boolean))];
          const colVals = [...new Set(sampleRows.map((r) => String(r[yi] ?? "").trim()).filter(Boolean))];
          const table = rowVals.map((rv) =>
            colVals.map((cv) => sampleRows.filter(
              (r) => String(r[xi] ?? "").trim() === rv && String(r[yi] ?? "").trim() === cv
            ).length)
          );
          result = { ...chiSquareTest(table), rowLabels: rowVals, colLabels: colVals };
          break;
        }
        case "correlation": {
          const [xs, ys] = columns(sampleRows, headers, [xColumn, yColumn]);
          result = pearsonCorrelation(xs, ys);
          break;
        }
        case "regression": {
          const [xs, ys] = columns(sampleRows, headers, [xColumn, yColumn]);
          result = linearRegression(xs, ys);
          break;
        }
        case "cronbach":
          if (!Array.isArray(itemColumns) || itemColumns.length < 2) {
            return res.status(400).json({
              error: "ต้องเลือกข้อคำถามอย่างน้อย 2 ข้อ",
              errorEn: "select at least 2 questionnaire items",
            });
          }
          result = cronbachAlpha(columns(sampleRows, headers, itemColumns));
          break;
        default:
          return res.status(400).json({
            error: `ไม่รู้จักการทดสอบ "${test}"`,
            errorEn: `unknown test "${test}"`,
            available: ["t-test", "paired-t", "anova", "chi-square", "correlation", "regression", "cronbach"],
          });
      }

      if (result?.error) return res.status(400).json(result);

      log.info({ test, datasetId: req.params.id, significant: result.significant }, "inference run");
      res.json({ ...result, datasetId: req.params.id, headers, computedBy: "deterministic" });
    } catch (err) { next(err); }
  });

  /** What can this dataset support? Drives the UI's test picker. */
  app.get("/api/inference/:id/available", requireAuth, async (req, res, next) => {
    try {
      const { getUserDatasetRole, getDatasetWithContent } = await import("../db/datasetRepository.js");
      const role = await getUserDatasetRole(req.params.id, req.user.userId);
      if (!role) return res.status(403).json({ error: "No access to this dataset" });

      const ds = await getDatasetWithContent(req.params.id);
      if (!ds?.version) return res.status(404).json({ error: "Dataset not found" });

      // col_analysis comes back already parsed from some code paths and as a
      // JSON string from others — handle both rather than assuming.
      const raw = ds.version.col_analysis;
      const cols = Array.isArray(raw) ? raw
        : (typeof raw === "string" ? JSON.parse(raw || "[]") : []);
      const numeric = cols.filter((c) => c.type === "numeric").map((c) => c.col);
      const text    = cols.filter((c) => c.type !== "numeric").map((c) => c.col);

      res.json({
        numericColumns: numeric,
        categoricalColumns: text,
        tests: [
          { id: "t-test",      th: "เปรียบเทียบ 2 กลุ่ม (t-test)",       needs: "1 ตัวเลข + 1 กลุ่ม (2 ค่า)", available: numeric.length >= 1 && text.length >= 1 },
          { id: "anova",       th: "เปรียบเทียบ 3 กลุ่มขึ้นไป (ANOVA)",  needs: "1 ตัวเลข + 1 กลุ่ม",          available: numeric.length >= 1 && text.length >= 1 },
          { id: "chi-square",  th: "ความสัมพันธ์ของหมวดหมู่ (Chi-square)", needs: "2 คอลัมน์หมวดหมู่",         available: text.length >= 2 },
          { id: "correlation", th: "สหสัมพันธ์ (Pearson r)",             needs: "2 คอลัมน์ตัวเลข",            available: numeric.length >= 2 },
          { id: "regression",  th: "การถดถอยเชิงเส้น (Regression)",       needs: "2 คอลัมน์ตัวเลข",            available: numeric.length >= 2 },
          { id: "cronbach",    th: "ความเชื่อมั่นแบบสอบถาม (Cronbach's α)", needs: "2 ข้อคำถามขึ้นไป",          available: numeric.length >= 2 },
        ],
      });
    } catch (err) { next(err); }
  });
}

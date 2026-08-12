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
import {
  independentTTest, pairedTTest, oneWayAnova, chiSquareTest,
  pearsonCorrelation, linearRegression, cronbachAlpha,
} from "../services/inference.js";

const log = serviceLogger("inference");

/** Pull one column out of parsed rows as numbers, dropping blanks. */
function column(rows, name) {
  return rows.map((r) => {
    const v = r[name];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }).filter((v) => v !== null);
}

/** Split a numeric column by the distinct values of a grouping column. */
function groupBy(rows, valueCol, groupCol) {
  const buckets = new Map();
  for (const r of rows) {
    const g = String(r[groupCol] ?? "").trim();
    if (!g) continue;
    const raw = r[valueCol];
    const v = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
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
      const { sampleRows, headers } = await parseFileStreaming(buffer, ds.version.file_name);

      const { test, valueColumn, groupColumn, xColumn, yColumn, beforeColumn, afterColumn, itemColumns } = req.body || {};
      let result;

      switch (test) {
        case "t-test": {
          const buckets = groupBy(sampleRows, valueColumn, groupColumn);
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
        case "paired-t":
          result = pairedTTest(column(sampleRows, beforeColumn), column(sampleRows, afterColumn));
          break;
        case "anova": {
          const buckets = groupBy(sampleRows, valueColumn, groupColumn);
          result = { ...oneWayAnova([...buckets.values()]), groupNames: [...buckets.keys()] };
          break;
        }
        case "chi-square": {
          // Build the contingency table from two categorical columns.
          const rowVals = [...new Set(sampleRows.map((r) => String(r[xColumn] ?? "").trim()).filter(Boolean))];
          const colVals = [...new Set(sampleRows.map((r) => String(r[yColumn] ?? "").trim()).filter(Boolean))];
          const table = rowVals.map((rv) =>
            colVals.map((cv) => sampleRows.filter(
              (r) => String(r[xColumn] ?? "").trim() === rv && String(r[yColumn] ?? "").trim() === cv
            ).length)
          );
          result = { ...chiSquareTest(table), rowLabels: rowVals, colLabels: colVals };
          break;
        }
        case "correlation":
          result = pearsonCorrelation(column(sampleRows, xColumn), column(sampleRows, yColumn));
          break;
        case "regression":
          result = linearRegression(column(sampleRows, xColumn), column(sampleRows, yColumn));
          break;
        case "cronbach":
          if (!Array.isArray(itemColumns) || itemColumns.length < 2) {
            return res.status(400).json({
              error: "ต้องเลือกข้อคำถามอย่างน้อย 2 ข้อ",
              errorEn: "select at least 2 questionnaire items",
            });
          }
          result = cronbachAlpha(itemColumns.map((c) => column(sampleRows, c)));
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

      const cols = JSON.parse(ds.version.col_analysis || "[]");
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

/**
 * routes/demo.js — v20.1 "First 10 seconds"
 *
 * The public front door. A stranger should see real insights BEFORE they
 * see a signup form — so these endpoints are deliberately:
 *
 *   · no auth        (they sit under the global /api optionalAuth + limiter)
 *   · no AI call     (the deterministic Insights Engine IS the demo:
 *                     instant, free, and impossible to rate-limit into a
 *                     bad first impression)
 *   · no user input  (sample ids resolve through a fixed registry —
 *                     nothing from the request ever touches the filesystem)
 *   · cached forever (samples are static files; compute once per process)
 *
 * The response is the SAME shape as /api/analyze (analysisResponse), with
 * analysis:null and demo:true — the dashboard renders it with zero special
 * plumbing, and "thai-shop" doubles as a live showcase of the v20 messy-file
 * layer (banner row skipped, ฿ amounts, พ.ศ. dates converted).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFileStreaming } from "../services/streaming.js";
import { computeStatsBundle, analysisResponse } from "../services/analysisPipeline.js";
import { serviceLogger } from "../logger.js";
import { recordUpload } from "../services/telemetry.js";

const log = serviceLogger("demo");
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "sample-data");

const SAMPLES = {
  "thai-shop": {
    file: "thai_shop.csv", emoji: "🏪",
    title: "ยอดขายร้านโชห่วย",
    desc: "ไฟล์แบบที่ร้านส่งมาจริง — มีหัวรายงานคั่น วันที่ พ.ศ. ราคา ฿ เลขไทย",
    badge: "messy Thai file",
  },
  "inventory": {
    file: "inventory.csv", emoji: "📦",
    title: "สต็อกสินค้า",
    desc: "คงเหลือ ขายออก และรายได้ต่อสินค้า — เห็นตัวทำเงินทันที",
    badge: "clean",
  },
  "traffic": {
    file: "traffic.csv", emoji: "📈",
    title: "ทราฟฟิกเว็บไซต์",
    desc: "ผู้เข้าชมรายวัน คอนเวอร์ชัน bounce rate — เต็มไปด้วย correlation",
    badge: "time series",
  },
};

const memo = new Map();

async function analyzeSample(id) {
  if (memo.has(id)) return { ...memo.get(id), cached: true };

  const { file, ...meta } = SAMPLES[id];
  const t0     = performance.now();
  const buffer = await readFile(path.join(DATA_DIR, file));
  const { headers, colAnalysis, totalRows, dupeCount, sampleRows, normalization } =
    await parseFileStreaming(buffer, file);

  const parsed = { headers, colAnalysis, totalRows, dupeCount, sampleRows };
  const bundle = computeStatsBundle(parsed);
  const durationMs = Math.round(performance.now() - t0);

  const payload = {
    ...analysisResponse({ aiAnalysis: null, totalRows, headers, durationMs, parsed, bundle, savedId: null }),
    demo: true,
    normalization,
    sample: { id, ...meta },
  };
  memo.set(id, payload);
  log.info({ id, rows: totalRows, durationMs }, "Demo sample analyzed & cached");
  return payload;
}

export function mountDemoRoutes(app) {
  // ── Sample catalogue (warms the cache so cards can show real numbers) ──
  app.get("/api/demo/samples", async (_req, res, next) => {
    try {
      const samples = [];
      for (const id of Object.keys(SAMPLES)) {
        const a = await analyzeSample(id);
        const { emoji, title, desc, badge } = SAMPLES[id];
        samples.push({ id, emoji, title, desc, badge,
                       rows: a.rows, columns: a.columns, quality: a.quality?.score ?? null });
      }
      res.json({ samples });
    } catch (err) { next(err); }
  });

  // ── Full stats bundle for one sample — the 10-second wow ──
  app.get("/api/demo/samples/:id/analysis", async (req, res, next) => {
    try {
      if (!Object.prototype.hasOwnProperty.call(SAMPLES, req.params.id)) {
        return res.status(404).json({ error: "ไม่พบชุดข้อมูลตัวอย่างนี้" });
      }
      const payload = await analyzeSample(req.params.id);
      // v20.2: a demo tap is top-of-funnel signal — record it like an upload
      recordUpload({ source: "demo", fileType: "csv",
                     parsed: { colAnalysis: payload.colAnalysis, totalRows: payload.rows, normalization: payload.normalization },
                     sampleId: req.params.id, userId: req.user?.userId });
      res.json(payload);
    } catch (err) { next(err); }
  });
}

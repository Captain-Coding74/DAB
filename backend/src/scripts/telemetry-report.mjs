#!/usr/bin/env node
/**
 * scripts/telemetry-report.mjs — v20.2
 *
 * The monthly "which vertical showed up?" report, in the terminal:
 *
 *   npm run telemetry -w backend
 *
 * Reads ONLY aggregate shapes and dictionary tags (the rows never contained
 * filenames, column names, or values — see services/telemetry.js).
 */
import { initPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { getTelemetrySummary } from "../db/repository.js";

const pad = (s, n) => String(s).padEnd(n);
const bar = (n, max, w = 24) => "█".repeat(max ? Math.round((n / max) * w) : 0);

function section(title, counts, note = "") {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`\n  ${title}${note ? `  ·  ${note}` : ""}`);
  if (!entries.length) return console.log("    (ยังไม่มีข้อมูล)");
  const max = entries[0][1];
  for (const [k, v] of entries) console.log(`    ${pad(k, 16)} ${pad(v, 6)} ${bar(v, max)}`);
}

await initPool();
await migrate();
const s = await getTelemetrySummary();

console.log(`\n═══ Upload Telemetry — ${s.total} uploads (newest 5,000) ═══`);
section("Segment ที่โผล่มาใช้จริง", s.bySegment, "อันดับนี้คือคำตอบเรื่อง vertical");
section("Source", s.bySource);
section("Demo taps (top of funnel)", s.demoTaps);
section("Column categories", s.categories);
section("File types", s.byFileType);
section("Encodings", s.byEncoding);
console.log(`\n  Messy-file reality check`);
console.log(`    ไฟล์ที่ใช้ปี พ.ศ.        ${s.messy.buddhistEra} / ${s.total}`);
console.log(`    ไฟล์ที่มีหัวรายงานคั่น   ${s.messy.skippedHeaderRows} / ${s.total}\n`);

await closePool();

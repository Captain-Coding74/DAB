/**
 * Move existing dataset_versions.file_content into object storage.
 *
 * Run once after deploying v21.1:
 *   node backend/scripts/backfill-storage.mjs           # report only
 *   node backend/scripts/backfill-storage.mjs --apply   # write
 *
 * WHAT CAN AND CANNOT BE RECOVERED
 * --------------------------------
 * Rows were written with `buffer.toString("utf-8")`. For CSV that is lossless
 * — the bytes were text to begin with — so those rows migrate perfectly.
 *
 * For XLSX it was not. An xlsx is a ZIP archive, and every byte that was not
 * valid UTF-8 became U+FFFD on write. That information is gone: nothing here
 * can rebuild it. Such rows are REPORTED, not silently migrated, so you know
 * exactly which datasets need re-uploading rather than discovering it when a
 * user opens one.
 *
 * The script is idempotent — rows that already carry a storage_key are
 * skipped, so it is safe to re-run.
 */
import { initPool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import * as storage from "../src/services/storage.js";
import { serviceLogger } from "../src/logger.js";

const log = serviceLogger("backfill");
const APPLY = process.argv.includes("--apply");

/**
 * Is the stored content still usable?
 *
 * Checking the magic bytes is NOT enough: `PK` is ASCII, so a ZIP header
 * survives a UTF-8 round-trip intact while the compressed body behind it is
 * shredded. The only honest test is to open the workbook.
 *
 * U+FFFD is the other tell — the replacement character cannot appear in a
 * genuine binary read back as UTF-8 unless substitution happened.
 */
async function looksIntact(buf, fileType, raw) {
  const t = String(fileType || "").toLowerCase();
  if (t === "csv" || t === "tsv" || t === "txt") return true;   // text: lossless
  if (raw.includes("\uFFFD")) return false;                     // bytes were replaced
  if (t === "xlsx" || t === "xls") {
    try {
      const ExcelJS = (await import("exceljs")).default;
      await new ExcelJS.Workbook().xlsx.load(buf);              // throws if shredded
      return true;
    } catch { return false; }
  }
  return true;
}

await initPool();
// The storage_key column arrives with v21.1's additive migration. The test
// suites boot the app (which migrates), but this script does not — so it has
// to migrate itself or it fails with "no such column" on any database that
// predates the release.
await migrate();

const rows = await query(
  `SELECT id, dataset_id, version_num, file_name, file_type, file_content, storage_key
     FROM dataset_versions
    WHERE (storage_key IS NULL OR storage_key = '')
      AND file_content IS NOT NULL AND file_content <> ''`
);

let migrated = 0, damaged = 0, skipped = 0;
const casualties = [];

for (const r of rows) {
  const buf = Buffer.from(r.file_content, "utf-8");

  if (!(await looksIntact(buf, r.file_type, r.file_content))) {
    damaged++;
    casualties.push(`${r.dataset_id} v${r.version_num} — ${r.file_name}`);
    continue;                          // never migrate corrupt bytes forward
  }

  if (!APPLY) { migrated++; continue; }

  const key = storage.buildKey({
    datasetId: r.dataset_id, versionNum: r.version_num, fileName: r.file_name,
  });
  const { sha256 } = await storage.put(key, buf);
  await query(`UPDATE dataset_versions SET storage_key=$1, storage_sha256=$2 WHERE id=$3`, [key, sha256, r.id]);
  migrated++;
}

const already = await query(
  `SELECT COUNT(*) AS n FROM dataset_versions WHERE storage_key IS NOT NULL AND storage_key <> ''`
);
skipped = already[0]?.n ?? 0;

console.log(`\nBackfill ${APPLY ? "(applied)" : "(dry run — pass --apply to write)"}`);
console.log(`  driver              ${storage.driver()}`);
console.log(`  already in storage  ${skipped}`);
console.log(`  ${APPLY ? "migrated" : "would migrate"}      ${migrated}`);
console.log(`  unrecoverable       ${damaged}`);

if (damaged) {
  console.log(`\n  These were corrupted on write by the pre-v21.1 TEXT column and`);
  console.log(`  cannot be repaired. The owners must re-upload:\n`);
  for (const c of casualties.slice(0, 40)) console.log(`    · ${c}`);
  if (casualties.length > 40) console.log(`    … and ${casualties.length - 40} more`);
}

console.log("");
log.info({ migrated, damaged, applied: APPLY }, "backfill complete");
process.exit(0);

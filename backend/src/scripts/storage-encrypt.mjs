#!/usr/bin/env node
/**
 * scripts/storage-encrypt.mjs — v21.30
 *
 * Setting STORAGE_ENCRYPTION_KEY encrypts every object written FROM THEN ON;
 * files saved before stay readable but sit in the clear. This seals them in
 * place, with the same key and format the server uses (services/storageCrypto.js),
 * so a deployment can turn encryption on without leaving its history behind.
 *
 * Usage (from backend/, with the same .env as the server — the key and the
 * STORAGE_DRIVER / S3_* settings must be the ones the server runs with):
 *
 *   npm run storage-encrypt -w backend -- [--dry-run]
 *   node src/scripts/storage-encrypt.mjs [--dry-run]
 *
 *   --dry-run   count what would be sealed; write nothing.
 *
 * Safe to run more than once: objects that are already sealed are skipped,
 * each object is checked to decrypt back to the same bytes before it is
 * replaced, and the stored sha256 (the hash of the plaintext) does not
 * change. Run it at a quiet time — a dataset deleted while it runs can leave
 * its (now encrypted) object behind. KEEP THE KEY: an encrypted object cannot
 * be read without it, and nothing — this script included — can recover it.
 *
 * v21.30: files saved before v21.1 can also sit in the DATABASE, in
 * dataset_versions.file_content — copied to storage by the v21.1 backfill but
 * never cleared, or never moved at all. Sealing objects alone left those in
 * the clear, so the script now moves each into sealed storage and clears the
 * column once the object reads back as the same file (db/legacyContent.js).
 */
import "../loadEnv.js";   // MUST be first: storage.js reads the key at import
import { parseArgs } from "node:util";
import * as storage from "../services/storage.js";
import { initPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { sealLegacyContent } from "../db/legacyContent.js";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });
const dryRun = Boolean(values["dry-run"]);

if (!storage.encrypted()) {
  console.error("\n  STORAGE_ENCRYPTION_KEY is not set — nothing to encrypt with.");
  console.error("  Generate one with: openssl rand -base64 32   (and keep a copy somewhere safe)\n");
  process.exitCode = 1;
} else {
  const counts = { sealed: 0, "would-seal": 0, skipped: 0, failed: 0 };
  for await (const key of storage.listKeys()) {
    try {
      counts[await storage.sealInPlace(key, { dryRun })]++;
    } catch (err) {
      counts.failed++;
      console.error(`  ✗ ${key}: ${err.message}`);
    }
  }
  console.log(`\n  ${storage.driver()} storage${dryRun ? " (dry run — nothing written)" : ""}`);
  console.log(dryRun
    ? `  would encrypt: ${counts["would-seal"]}`
    : `  encrypted:     ${counts.sealed}`);
  console.log(`  already encrypted, skipped: ${counts.skipped}`);
  if (counts.failed) console.log(`  failed: ${counts.failed} — see above; run again to retry them`);

  await initPool();
  await migrate();   // a database from before v21.1 has no storage_key column yet
  const db = await sealLegacyContent({ dryRun });
  await closePool();
  console.log(`\n  plaintext copies in the database (pre-v21.1 file_content)${dryRun ? " — dry run" : ""}`);
  console.log(`  ${dryRun ? "would move to sealed storage" : "moved to sealed storage"}: ${db.moved}`);
  console.log(`  ${dryRun ? "would clear (object already stored)" : "cleared (object already stored)"}: ${db.cleared}`);
  if (db.kept) console.log(`  kept: ${db.kept} — the stored object is missing or does not match; the database copy is the only one`);
  console.log("");
  if (counts.failed || db.kept) process.exitCode = 1;
}

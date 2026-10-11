/**
 * db/legacyContent.js — the plaintext file copies still sitting in the
 * database (v21.30, run by scripts/storage-encrypt.mjs).
 *
 * Before v21.1 a saved file lived in dataset_versions.file_content. The v21.1
 * backfill (backend/scripts/backfill-storage.mjs) copied those rows into
 * object storage but never cleared the column, and a deployment that never
 * ran it has the file ONLY there. storage-encrypt sealed objects and nothing
 * else, so after "encrypt everything" a pre-v21.1 roster was still readable
 * in the clear in the database — and in every backup of it — while the
 * README and the Privacy Notice said stored files were encrypted.
 *
 * For each row that still holds content:
 *   no storage_key   → store it (put() seals it under the configured key),
 *                      check it reads back as the same bytes, then point the
 *                      row at it and clear the column ("moved");
 *   with storage_key → clear the column once the object reads back as the
 *                      file the row recorded (storage_sha256) ("cleared");
 *                      an object that is missing or does not match keeps the
 *                      column, the only copy left ("kept"), to be looked at.
 * Idempotent: a second run finds no row with content.
 */
import { createHash } from "node:crypto";
import { query } from "./pool.js";
import * as storage from "../services/storage.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function readsBack(store, key, expectedSha) {
  try { return sha256(await store.get(key)) === expectedSha; } catch { return false; }
}

/** Returns { moved, cleared, kept } — counts only. dryRun writes nothing.
 *  `store` is services/storage.js (a test passes an instance with a key). */
export async function sealLegacyContent({ dryRun = false, store = storage } = {}) {
  const rows = await query(
    `SELECT id, dataset_id, version_num, file_name, file_content, storage_key, storage_sha256
       FROM dataset_versions WHERE file_content IS NOT NULL AND file_content <> ''`);
  const counts = { moved: 0, cleared: 0, kept: 0 };
  for (const r of rows) {
    const plain = Buffer.from(r.file_content, "utf-8");
    if (!r.storage_key) {
      if (!dryRun) {
        const key = store.buildKey({ datasetId: r.dataset_id, versionNum: r.version_num, fileName: r.file_name });
        const { sha256: sum } = await store.put(key, plain);
        if (!(await readsBack(store, key, sum))) { counts.kept++; continue; }
        await query(`UPDATE dataset_versions SET storage_key=$1, storage_sha256=$2, file_content='' WHERE id=$3`, [key, sum, r.id]);
      }
      counts.moved++;
    } else if (await readsBack(store, r.storage_key, r.storage_sha256 || sha256(plain))) {
      if (!dryRun) await query(`UPDATE dataset_versions SET file_content='' WHERE id=$1`, [r.id]);
      counts.cleared++;
    } else {
      counts.kept++;
    }
  }
  return counts;
}

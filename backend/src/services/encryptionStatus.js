/**
 * services/encryptionStatus.js — whether every stored file is encrypted at
 * rest, for the Privacy Notice (v21.31).
 *
 * Setting STORAGE_ENCRYPTION_KEY seals new writes only. Files saved before it
 * stay plaintext until storage-encrypt.mjs seals them, and so do pre-v21.1
 * copies in dataset_versions.file_content (db/legacyContent.js). A notice
 * that said "encrypted" from the moment the key was set would be false for
 * exactly the oldest files — the ones earlier versions stored without asking.
 * So the notice reads the state this module checks:
 *
 *   "off"     no key: DAB does not encrypt stored files;
 *   "partial" key set, but plaintext remains — or not checked yet;
 *   "all"     key set and the last check found nothing in the clear.
 *
 * Checked shortly after boot and daily (scheduler.js), because storage-encrypt
 * runs as a separate process. A failed check leaves "partial": never claim
 * more than was verified.
 */
import { query } from "../db/pool.js";
import * as storage from "./storage.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("storage");

let verified = null;   // "all" | "partial" after a check; null before the first one

export function encryptionState(keySet = storage.encrypted()) {
  if (!keySet) return "off";
  return verified === "all" ? "all" : "partial";
}

export async function checkEncryptionAtRest({ keySet = storage.encrypted(), countObjects = storage.countUnsealed, countRows = countPlaintextRows } = {}) {
  if (!keySet) { verified = null; return "off"; }
  try {
    const objects = await countObjects();
    const rows = await countRows();
    verified = objects + rows === 0 ? "all" : "partial";
    // Counts only: an old object key can hold the uploaded file name.
    if (verified === "partial") log.warn({ objects, rows }, "stored files are not all encrypted yet — run storage-encrypt (see .env.example)");
  } catch (err) {
    verified = "partial";
    log.warn({ code: err.code || err.name }, "encryption-at-rest check failed; the Privacy Notice keeps the partial wording");
  }
  return verified;
}

async function countPlaintextRows() {
  const r = await query(`SELECT COUNT(*) AS n FROM dataset_versions WHERE file_content IS NOT NULL AND file_content <> ''`);
  return Number(r[0]?.n ?? 0);
}

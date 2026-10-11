/**
 * Object storage — raw bytes in, raw bytes out.
 *
 * WHY THIS EXISTS (v21.1)
 * ----------------------
 * Uploads used to be persisted as `dataset_versions.file_content TEXT` via
 * `req.file.buffer.toString("utf-8")`. XLSX is a ZIP archive — arbitrary
 * binary — so every byte that was not valid UTF-8 became U+FFFD and the file
 * could never be reopened. Measured: a 6,462-byte workbook came back as
 * 10,477 bytes and ExcelJS reported "Corrupted zip". Every stored .xlsx in
 * the product was damaged at rest, and no test caught it because the tests
 * only ever re-analyzed CSVs.
 *
 * Storing bytes outside the row also keeps 10 MB blobs out of backups,
 * replication and every SELECT that touches a version.
 *
 * DRIVERS
 * -------
 * Selected by STORAGE_DRIVER, mirroring how db/pool.js picks sqlite|postgres:
 *
 *   local (default) — writes under DATA_DIR/objects. Zero configuration,
 *                     works on a laptop and in CI with no credentials.
 *   s3              — any S3-compatible endpoint: AWS, Cloudflare R2, MinIO.
 *                     Needs S3_BUCKET plus the usual AWS_* credentials, and
 *                     S3_ENDPOINT for non-AWS providers.
 *
 * The s3 driver imports @aws-sdk/client-s3 lazily, so the dependency is only
 * required by deployments that actually select it.
 *
 * ENCRYPTION AT REST (v21.30)
 * ---------------------------
 * With STORAGE_ENCRYPTION_KEY set, put() seals bytes before either driver
 * sees them and get() opens them again — see storageCrypto.js for the format.
 * Callers always deal in plaintext; only this module and the operator's
 * scripts/storage-encrypt.mjs ever touch the stored form.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serviceLogger } from "../logger.js";
import { parseEncryptionKey, seal, open, isSealed } from "./storageCrypto.js";

const log = serviceLogger("storage");

const DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();

/* Parsed at import, so a malformed key stops the boot instead of the first upload. */
const KEY = parseEncryptionKey(process.env.STORAGE_ENCRYPTION_KEY);

/**
 * Objects live beside the SQLite file, under the SAME root db/pool.js uses.
 * pool.js resolves `SQLITE_DIR || backend/data` from its own module path, not
 * from cwd — an earlier version of this file used a separate DATA_DIR rooted
 * at process.cwd(), which put the database and its objects in different
 * directories depending on where node was invoked from.
 */
const DATA_DIR = process.env.SQLITE_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const ROOT = path.join(DATA_DIR, "objects");

/**
 * Keys are `datasets/<uuid>/<version>.<ext>`.
 *
 * v21.30: the key used to end in the sanitised original filename
 * ("1-รายชื่อนักเรียน ม.3.xlsx"), so a bucket listing, an access log or a
 * backup manifest disclosed what every user had uploaded. Only the file type
 * survives now, from a fixed list, so nothing a user typed reaches the path —
 * which also keeps `../../etc/passwd` out by construction. Rows written
 * earlier keep the keys they were stored under.
 */
const KEY_EXTENSIONS = new Set(["csv", "tsv", "txt", "xlsx", "xls", "json"]);

export function buildKey({ datasetId, versionNum, fileName }) {
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  return `datasets/${datasetId || randomUUID()}/${versionNum || 1}${KEY_EXTENSIONS.has(ext) ? `.${ext}` : ""}`;
}

/* Defence in depth: a key must never resolve outside ROOT. */
function localPath(key) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error(`storage: key escapes root: ${key}`);
  }
  return full;
}

let _s3 = null;
async function s3Client() {
  if (_s3) return _s3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  _s3 = new S3Client({
    region: process.env.AWS_REGION || "auto",
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  });
  return _s3;
}

/* The stored form, as the driver holds it — sealed or legacy plaintext. */
async function readRaw(key) {
  if (DRIVER === "s3") {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await s3Client();
    const r = await c.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const chunks = [];
    for await (const chunk of r.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return readFile(localPath(key));           // Buffer, not string
}

async function writeRaw(key, buffer) {
  if (DRIVER === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await s3Client();
    await c.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET, Key: key, Body: buffer,
      ContentType: "application/octet-stream",
    }));
    return;
  }
  const full = localPath(key);
  await mkdir(path.dirname(full), { recursive: true });
  // Write-then-rename: an object is either the old bytes or the new ones, never
  // half of each — what lets storage-encrypt.mjs rewrite objects in place.
  const tmp = `${full}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, buffer);            // no encoding: bytes stay bytes
    await rename(tmp, full);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Store bytes. Returns { key, bytes, sha256 } — bytes and sha256 of the PLAINTEXT. */
export async function put(key, buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("storage.put expects a Buffer");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  await writeRaw(key, KEY ? seal(buffer, KEY) : buffer);
  log.debug({ key, bytes: buffer.length, driver: DRIVER, encrypted: Boolean(KEY) }, "object stored");
  return { key, bytes: buffer.length, sha256 };
}

/**
 * Retrieve bytes as a Buffer. Throws if the key is absent, and throws an error
 * with code STORAGE_KEY_MISSING / STORAGE_DECRYPT_FAILED when a sealed object
 * cannot be opened (no key, wrong key, or altered bytes).
 */
export async function get(key) {
  return open(await readRaw(key), KEY);
}

export async function exists(key) {
  if (DRIVER === "s3") {
    try { await readRaw(key); return true; } catch { return false; }
  }
  return existsSync(localPath(key));
}

export async function remove(key) {
  try {
    if (DRIVER === "s3") {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await s3Client();
      await c.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    } else {
      await unlink(localPath(key));
    }
  } catch (err) {
    // Deleting an object that is already gone is not an error worth raising:
    // callers delete during cleanup paths that must stay idempotent.
    // v21.30: the error code only — a key written before v21.30 holds the
    // uploaded file name, and an fs error message repeats the full path.
    log.debug({ code: err.code || err.name }, "object delete skipped");
  }
}

export function driver() { return DRIVER; }
export function encrypted() { return Boolean(KEY); }

/** Every stored dataset object's key — what storage-encrypt.mjs walks. */
export async function* listKeys() {
  if (DRIVER === "s3") {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const c = await s3Client();
    let ContinuationToken;
    do {
      const r = await c.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: "datasets/", ContinuationToken }));
      for (const o of r.Contents || []) yield o.Key;
      ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return;
  }
  const walk = async function* (dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(full);
      else if (!e.name.includes(".tmp-")) yield path.relative(ROOT, full).split(path.sep).join("/");
    }
  };
  yield* walk(path.join(ROOT, "datasets"));
}

/**
 * Seal one legacy plaintext object in place (v21.30, for storage-encrypt.mjs).
 * Returns "sealed", "would-seal" (dryRun) or "skipped" (already sealed).
 * Idempotent: running it twice leaves the second run with nothing to do.
 */
export async function sealInPlace(key, { dryRun = false } = {}) {
  if (!KEY) throw new Error("storage: set STORAGE_ENCRYPTION_KEY before encrypting stored objects");
  const raw = await readRaw(key);
  if (isSealed(raw)) return "skipped";
  if (dryRun) return "would-seal";
  const sealed = seal(raw, KEY);
  // Prove the sealed copy opens to the same bytes before replacing the only copy.
  if (!open(sealed, KEY).equals(raw)) throw new Error(`storage: sealing ${key} did not round-trip`);
  await writeRaw(key, sealed);
  return "sealed";
}

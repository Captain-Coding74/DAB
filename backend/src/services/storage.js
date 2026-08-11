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
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("storage");

const DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();

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
 * Keys are `datasets/<uuid>/<version>-<safe-name>`. The uuid keeps user
 * filenames out of the path, so a name like `../../etc/passwd` cannot
 * escape: the segment is also sanitised below.
 */
export function buildKey({ datasetId, versionNum, fileName }) {
  const safe = String(fileName || "file")
    .replace(/[^\w.\-\u0E00-\u0E7F]+/g, "_")   // keep Thai; collapse the rest
    .replace(/^\.+/, "")                        // no leading dots
    .slice(-120);
  return `datasets/${datasetId || randomUUID()}/${versionNum || 1}-${safe}`;
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

/** Store bytes. Returns { key, bytes, sha256 }. */
export async function put(key, buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("storage.put expects a Buffer");
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  if (DRIVER === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await s3Client();
    await c.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET, Key: key, Body: buffer,
      ContentType: "application/octet-stream",
    }));
  } else {
    const full = localPath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);           // no encoding: bytes stay bytes
  }

  log.debug({ key, bytes: buffer.length, driver: DRIVER }, "object stored");
  return { key, bytes: buffer.length, sha256 };
}

/** Retrieve bytes as a Buffer. Throws if the key is absent. */
export async function get(key) {
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

export async function exists(key) {
  if (DRIVER === "s3") {
    try { await get(key); return true; } catch { return false; }
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
    log.debug({ key, err: err.message }, "object delete skipped");
  }
}

export function driver() { return DRIVER; }

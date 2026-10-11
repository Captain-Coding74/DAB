/**
 * Encryption at rest for stored objects (v21.30).
 *
 * WHY
 * ---
 * A saved dataset is the user's original file — often a class roster or a
 * customer list. Before this, anyone who could read the objects directory or
 * the bucket (a leaked backup, a mis-set bucket policy, a shared host) read
 * every file in the clear. With STORAGE_ENCRYPTION_KEY set, new objects are
 * sealed with AES-256-GCM before they leave the process, so the storage
 * alone gives up nothing and any change to a stored byte is detected on read.
 *
 * FORMAT (one self-describing blob, same for the local and s3 drivers)
 * ------
 *   "DABENC1" (7 bytes ASCII) | IV (12) | GCM tag (16) | ciphertext
 *
 * The magic is what lets reads tell a sealed object from a legacy plaintext
 * one: objects written before the key was set stay readable, and
 * scripts/storage-encrypt.mjs seals them in place when the operator is ready.
 * The stored sha256 stays the hash of the PLAINTEXT — it identifies the
 * user's file, not one particular encryption of it.
 *
 * The key is optional so a laptop or CI needs no setup; production boot warns
 * when it is missing (warnStorageUnencrypted, called by server.js).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serviceLogger } from "../logger.js";

export const MAGIC = Buffer.from("DABENC1", "ascii");
const IV_BYTES  = 12;
const TAG_BYTES = 16;
const HEADER    = MAGIC.length + IV_BYTES + TAG_BYTES;

const KEY_HELP = "STORAGE_ENCRYPTION_KEY must be 32 bytes written as base64 (44 characters) "
  + "or hex (64 characters) — generate one with: openssl rand -base64 32";

/**
 * The 32-byte key from its env form, or null when unset. Anything else throws:
 * a mistyped key must stop the boot, not quietly store files in the clear or
 * under a key nobody can reproduce.
 */
export function parseEncryptionKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(s)) {
    const key = Buffer.from(s, "base64");
    if (key.length === 32) return key;
  }
  throw new Error(KEY_HELP);
}

/* The magic alone decides: a sealed object cut short must fail to open, not pass as plaintext. */
export function isSealed(buf) {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function seal(plain, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function storageError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Plaintext of a stored object. Legacy (unsealed) objects come back as they are. */
export function open(buf, key) {
  if (!isSealed(buf)) return buf;
  if (!key) {
    throw storageError("STORAGE_KEY_MISSING",
      "storage: this object is encrypted but STORAGE_ENCRYPTION_KEY is not set");
  }
  const iv  = buf.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = buf.subarray(MAGIC.length + IV_BYTES, HEADER);
  try {
    if (buf.length < HEADER) throw new Error("truncated");
    // authTagLength pins the full 16 bytes: GCM would otherwise accept a shortened tag.
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(HEADER)), decipher.final()]);
  } catch {
    // GCM cannot tell a wrong key from altered bytes; both mean "do not trust this".
    throw storageError("STORAGE_DECRYPT_FAILED",
      "storage: could not decrypt an object — STORAGE_ENCRYPTION_KEY is not the key it was written with, or the stored bytes were altered");
  }
}

export function warnStorageUnencrypted(env = process.env, log = serviceLogger("storage")) {
  if (env.NODE_ENV !== "production" || String(env.STORAGE_ENCRYPTION_KEY ?? "").trim()) return false;
  log.warn("STORAGE_ENCRYPTION_KEY is not set — saved files are stored unencrypted (see .env.example)");
  return true;
}

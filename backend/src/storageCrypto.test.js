/**
 * storageCrypto.test.js — v21.30: encryption at rest for stored objects.
 *
 * The format is "DABENC1" | IV (12) | GCM tag (16) | ciphertext. These tests
 * pin the promises the Privacy Notice and the operator rely on: a sealed
 * object round-trips, objects written before the key existed stay readable,
 * a wrong or missing key fails with a clear error rather than garbage, any
 * altered byte is caught, and the stored form never holds the plaintext.
 *
 * storage.js reads STORAGE_ENCRYPTION_KEY once at import (a bad key must stop
 * the boot), so each configuration is imported as its own module instance —
 * the query string makes Node load a fresh copy with the env of that moment.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEncryptionKey, seal, open, isSealed, MAGIC, warnStorageUnencrypted } from "./services/storageCrypto.js";

// A key exported in the developer's shell would make the "default" instance below keyed.
delete process.env.STORAGE_ENCRYPTION_KEY;

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const PLAIN = Buffer.from("ชื่อ,เบอร์โทร\nสมชาย,0812345678\n", "utf-8");
const ROOT = path.join(process.env.SQLITE_DIR || fileURLToPath(new URL("../data", import.meta.url)), "objects");
const onDisk = (key) => path.join(ROOT, key);

let n = 0;
async function storageWith(rawKey) {
  const before = process.env.STORAGE_ENCRYPTION_KEY;
  if (rawKey === undefined) delete process.env.STORAGE_ENCRYPTION_KEY;
  else process.env.STORAGE_ENCRYPTION_KEY = rawKey;
  try {
    return await import(`./services/storage.js?instance=${++n}`);
  } finally {
    if (before === undefined) delete process.env.STORAGE_ENCRYPTION_KEY;
    else process.env.STORAGE_ENCRYPTION_KEY = before;
  }
}
const freshKey = (s) => s.buildKey({ datasetId: `t-enc-${randomUUID()}`, versionNum: 1, fileName: "roster.csv" });

describe("STORAGE_ENCRYPTION_KEY parsing", () => {
  test("unset or blank means no encryption", () => {
    assert.equal(parseEncryptionKey(undefined), null);
    assert.equal(parseEncryptionKey("  "), null);
  });

  test("accepts 32 bytes as base64 (padded or not, url-safe too) or as 64 hex characters", () => {
    assert.ok(parseEncryptionKey(K1.toString("base64")).equals(K1));
    assert.ok(parseEncryptionKey(K1.toString("base64url")).equals(K1));
    assert.ok(parseEncryptionKey(K1.toString("hex")).equals(K1));
    assert.ok(parseEncryptionKey(K1.toString("hex").toUpperCase()).equals(K1));
  });

  test("anything else is refused with a message that says how to make a key", () => {
    for (const bad of ["secret", randomBytes(16).toString("base64"), randomBytes(31).toString("hex"), K1.toString("hex") + "00"]) {
      assert.throws(() => parseEncryptionKey(bad), /STORAGE_ENCRYPTION_KEY must be 32 bytes.*openssl rand -base64 32/);
    }
  });

  test("a malformed key stops storage.js loading — the boot fails instead of the first upload", async () => {
    await assert.rejects(storageWith("not-a-key"), /STORAGE_ENCRYPTION_KEY must be 32 bytes/);
  });
});

describe("seal / open", () => {
  test("round trip, with the documented header and a fresh IV every time", () => {
    const a = seal(PLAIN, K1), b = seal(PLAIN, K1);
    assert.ok(a.subarray(0, 7).equals(Buffer.from("DABENC1")));
    assert.equal(a.length, PLAIN.length + MAGIC.length + 12 + 16);
    assert.ok(!a.equals(b), "same IV reused");
    assert.ok(open(a, K1).equals(PLAIN));
    assert.ok(!a.includes(Buffer.from("0812345678")), "plaintext visible in the sealed form");
  });

  test("legacy plaintext passes through untouched, with or without a key", () => {
    assert.ok(!isSealed(PLAIN));
    assert.ok(open(PLAIN, K1).equals(PLAIN));
    assert.ok(open(PLAIN, null).equals(PLAIN));
  });

  test("the wrong key fails cleanly — an error with a code, never wrong bytes", () => {
    assert.throws(() => open(seal(PLAIN, K1), K2),
      (err) => err.code === "STORAGE_DECRYPT_FAILED" && /not the key it was written with/.test(err.message));
  });

  test("no key at all says so", () => {
    assert.throws(() => open(seal(PLAIN, K1), null),
      (err) => err.code === "STORAGE_KEY_MISSING" && /STORAGE_ENCRYPTION_KEY is not set/.test(err.message));
  });

  test("any altered byte — IV, tag or ciphertext — is detected", () => {
    const sealed = seal(PLAIN, K1);
    for (const at of [MAGIC.length + 1, MAGIC.length + 12 + 3, sealed.length - 1]) {
      const tampered = Buffer.from(sealed);
      tampered[at] ^= 0x01;
      assert.throws(() => open(tampered, K1), { code: "STORAGE_DECRYPT_FAILED" }, `byte ${at} altered unnoticed`);
    }
    assert.throws(() => open(sealed.subarray(0, sealed.length - 4), K1), { code: "STORAGE_DECRYPT_FAILED" });
    // Cut inside the header: still recognised as sealed, still refused — never returned as "plaintext".
    for (const len of [MAGIC.length, MAGIC.length + 12 + 4]) {
      assert.throws(() => open(sealed.subarray(0, len), K1), { code: "STORAGE_DECRYPT_FAILED" }, `cut to ${len} bytes passed`);
    }
  });
});

describe("storage.js with a key", () => {
  test("put seals on disk, get returns the plaintext, sha256 is the plaintext's", async () => {
    const s = await storageWith(K1.toString("base64"));
    const key = freshKey(s);
    const stored = await s.put(key, PLAIN);
    assert.equal(stored.sha256, createHash("sha256").update(PLAIN).digest("hex"));
    assert.equal(stored.bytes, PLAIN.length);
    const raw = await readFile(onDisk(key));
    assert.ok(isSealed(raw), "object written in the clear");
    assert.ok(!raw.includes(Buffer.from("สมชาย")), "plaintext visible on disk");
    assert.ok((await s.get(key)).equals(PLAIN));
    await s.remove(key);
  });

  test("objects stored before the key was set still read", async () => {
    const plain = await storageWith(undefined);
    const keyed = await storageWith(K1.toString("hex"));
    const key = freshKey(plain);
    await plain.put(key, PLAIN);
    assert.ok(!isSealed(await readFile(onDisk(key))));
    assert.ok((await keyed.get(key)).equals(PLAIN));
    await plain.remove(key);
  });

  test("a sealed object read with the wrong key or no key rejects with a clear error", async () => {
    const keyed = await storageWith(K1.toString("base64"));
    const key = freshKey(keyed);
    await keyed.put(key, PLAIN);
    await assert.rejects((await storageWith(K2.toString("base64"))).get(key), { code: "STORAGE_DECRYPT_FAILED" });
    await assert.rejects((await storageWith(undefined)).get(key), { code: "STORAGE_KEY_MISSING" });
    await keyed.remove(key);
  });

  test("a stored object altered on disk is refused", async () => {
    const s = await storageWith(K1.toString("base64"));
    const key = freshKey(s);
    await s.put(key, PLAIN);
    const raw = await readFile(onDisk(key));
    raw[raw.length - 2] ^= 0xff;
    await writeFile(onDisk(key), raw);
    await assert.rejects(s.get(key), { code: "STORAGE_DECRYPT_FAILED" });
    await s.remove(key);
  });

  test("getVersionBytes reports an undecryptable object as itself, not as a missing file", async () => {
    const keyed = await storageWith(K1.toString("base64"));
    const key = freshKey(keyed);
    await keyed.put(key, PLAIN);
    const { getVersionBytes } = await import("./db/datasetRepository.js");   // the default, key-less instance
    await assert.rejects(getVersionBytes({ id: "v", storage_key: key, file_content: "stale" }), { code: "STORAGE_KEY_MISSING" });
    await keyed.remove(key);
  });
});

describe("sealing existing objects in place (storage-encrypt.mjs)", () => {
  test("dry run writes nothing; a real run seals; a second run skips; the bytes read back unchanged", async () => {
    const plain = await storageWith(undefined);
    const keyed = await storageWith(K1.toString("base64"));
    const key = freshKey(plain);
    await plain.put(key, PLAIN);

    const listed = [];
    for await (const k of keyed.listKeys()) listed.push(k);
    assert.ok(listed.includes(key), "listKeys missed a stored object");

    assert.equal(await keyed.sealInPlace(key, { dryRun: true }), "would-seal");
    assert.ok(!isSealed(await readFile(onDisk(key))), "dry run wrote");
    assert.equal(await keyed.sealInPlace(key), "sealed");
    assert.ok(isSealed(await readFile(onDisk(key))));
    assert.equal(await keyed.sealInPlace(key), "skipped");
    assert.ok((await keyed.get(key)).equals(PLAIN));
    await keyed.remove(key);
  });

  test("refuses to run without a key", async () => {
    const plain = await storageWith(undefined);
    await assert.rejects(plain.sealInPlace("datasets/x/1.csv"), /set STORAGE_ENCRYPTION_KEY/);
  });
});

/* v21.31: the Privacy Notice says files are encrypted only when a check
   finds nothing in the clear — not merely because the key is set. */
describe("encryption-at-rest check (services/encryptionStatus.js)", () => {
  /** A storage instance over its own empty objects directory, so the count is exact. */
  async function isolated(rawKey, dir) {
    const before = process.env.SQLITE_DIR;
    process.env.SQLITE_DIR = dir;
    try { return await storageWith(rawKey); }
    finally { if (before === undefined) delete process.env.SQLITE_DIR; else process.env.SQLITE_DIR = before; }
  }

  test("countUnsealed counts plaintext objects and reaches 0 once they are sealed", async () => {
    const dir = path.join(ROOT, "..", `enc-check-${randomUUID()}`);
    const plain = await isolated(undefined, dir);
    const keyed = await isolated(K1.toString("base64"), dir);
    const old = freshKey(plain);
    await plain.put(old, PLAIN);               // saved before the key was set
    const fresh = freshKey(keyed);
    await keyed.put(fresh, PLAIN);             // saved after: sealed on write
    assert.equal(await keyed.countUnsealed(), 1);
    await keyed.sealInPlace(old);
    assert.equal(await keyed.countUnsealed(), 0);
    await keyed.remove(old); await keyed.remove(fresh);
    await rm(dir, { recursive: true, force: true });
  });

  test("the notice's state: off without a key, partial until a clean check, all after one", async () => {
    const { encryptionState, checkEncryptionAtRest } = await import(`./services/encryptionStatus.js?instance=${++n}`);
    assert.equal(encryptionState(false), "off");
    assert.equal(encryptionState(true), "partial", "not checked yet: never claim more than was verified");
    const zero = async () => 0;
    assert.equal(await checkEncryptionAtRest({ keySet: true, countObjects: async () => 2, countRows: zero }), "partial");
    assert.equal(await checkEncryptionAtRest({ keySet: true, countObjects: zero, countRows: async () => 1 }), "partial", "pre-v21.1 copies in the database count too");
    assert.equal(await checkEncryptionAtRest({ keySet: true, countObjects: zero, countRows: zero }), "all");
    assert.equal(encryptionState(true), "all");
    assert.equal(await checkEncryptionAtRest({ keySet: true, countObjects: async () => { throw new Error("bucket down"); }, countRows: zero }), "partial");
    assert.equal(encryptionState(true), "partial", "a failed check falls back to the cautious wording");
    assert.equal(await checkEncryptionAtRest({ keySet: false }), "off");
  });
});

describe("production boot warning", () => {
  const sink = () => { const lines = []; return { lines, warn: (m) => lines.push(m) }; };

  test("warns once in production when the key is unset", () => {
    const log = sink();
    assert.equal(warnStorageUnencrypted({ NODE_ENV: "production" }, log), true);
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0], /STORAGE_ENCRYPTION_KEY is not set/);
  });

  test("silent with a key, and silent outside production (tests, dev)", () => {
    const log = sink();
    assert.equal(warnStorageUnencrypted({ NODE_ENV: "production", STORAGE_ENCRYPTION_KEY: K1.toString("base64") }, log), false);
    assert.equal(warnStorageUnencrypted({ NODE_ENV: "test" }, log), false);
    assert.equal(warnStorageUnencrypted({}, log), false);
    assert.equal(log.lines.length, 0);
  });
});

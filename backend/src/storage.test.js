/**
 * storage.test.js — the round-trip that was missing.
 *
 * DAB stored uploads as `dataset_versions.file_content TEXT` via
 * `buffer.toString("utf-8")`. XLSX is a ZIP archive, so any byte that was not
 * valid UTF-8 became U+FFFD: a 6,462-byte workbook came back as 10,477 bytes
 * and ExcelJS reported "Corrupted zip". Every stored .xlsx was damaged at
 * rest. It survived because the suite only ever re-analyzed CSVs.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as storage from "./services/storage.js";

const OBJECTS = path.join(process.env.SQLITE_DIR || fileURLToPath(new URL("../data", import.meta.url)), "objects");

describe("object storage", () => {
  test("binary bytes survive a round-trip byte-for-byte", async () => {
    const bytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0xFF, 0xFE, 0x00, 0x80, 0xC0, 0xE0]);
    const key = storage.buildKey({ datasetId: "t-bin", versionNum: 1, fileName: "x.xlsx" });
    await storage.put(key, bytes);
    assert.ok(bytes.equals(await storage.get(key)), "bytes changed in storage");
    await storage.remove(key);
  });

  test("a real .xlsx still opens after storage — the regression itself", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["สินค้า", "ยอดขาย"]);
    ws.addRow(["น้ำปลา", 1234]);
    const original = Buffer.from(await wb.xlsx.writeBuffer());

    const key = storage.buildKey({ datasetId: "t-xlsx", versionNum: 1, fileName: "ยอดขาย.xlsx" });
    await storage.put(key, original);
    const back = await storage.get(key);

    assert.equal(back.length, original.length, "size changed — UTF-8 replacement is back");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(back);                       // throws if corrupt
    assert.equal(reopened.getWorksheet("s").getCell("A2").value, "น้ำปลา");
    await storage.remove(key);
  });

  test("the old TEXT-column path is genuinely lossy (why this exists)", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("s").addRow(["a", 1]);
    const original = Buffer.from(await wb.xlsx.writeBuffer());
    const legacy = Buffer.from(original.toString("utf-8"), "utf-8");
    assert.ok(!original.equals(legacy),
      "if this ever passes, TEXT storage became safe and this suite can be revisited");
  });

  test("keys cannot escape the storage root", async () => {
    await assert.rejects(() => storage.put("../../escape", Buffer.from("x")), /escapes root/);
  });

  // v21.30: keys used to end in the filename, so a bucket listing or backup
  // manifest told anyone who uploaded what. Only a known file type is kept.
  test("keys carry no part of the user's filename — only a known file type", () => {
    assert.equal(storage.buildKey({ datasetId: "d", versionNum: 2, fileName: "รายชื่อนักเรียน ม.3.xlsx" }), "datasets/d/2.xlsx");
    assert.equal(storage.buildKey({ datasetId: "d", versionNum: 1, fileName: "Patients_2026.CSV" }), "datasets/d/1.csv");
    assert.equal(storage.buildKey({ datasetId: "d", versionNum: 1, fileName: "../../etc/passwd" }), "datasets/d/1");
    assert.equal(storage.buildKey({ datasetId: "d", versionNum: 1, fileName: "notes.secret-name" }), "datasets/d/1");
    assert.match(storage.buildKey({ versionNum: 3, fileName: "x.csv" }), /^datasets\/[0-9a-f-]{36}\/3\.csv$/);
  });
});

/* v21.30: remove() used to swallow every error at debug level, so a failed
   delete let the cascade drop the rows that recorded the key and report the
   erasure done while the file stayed in storage. */
describe("storage.remove", () => {
  test("an object that is already gone counts as removed — cleanup stays idempotent", async () => {
    const key = storage.buildKey({ datasetId: "t-gone", versionNum: 1, fileName: "x.csv" });
    await storage.put(key, Buffer.from("a\n1\n"));
    await storage.remove(key);
    await storage.remove(key);
    assert.equal(await storage.exists(key), false);
  });

  test("any other failure throws, with a code and no key or path in the message", async () => {
    const key = storage.buildKey({ datasetId: "t-stuck-รายชื่อ", versionNum: 1, fileName: "x.csv" });
    const full = path.join(OBJECTS, key);
    await mkdir(full, { recursive: true });   // unlink() of a directory fails: EISDIR / EPERM
    try {
      await assert.rejects(storage.remove(key), (err) => {
        assert.equal(err.code, "STORAGE_DELETE_FAILED");
        assert.ok(!err.message.includes("t-stuck") && !err.message.includes(OBJECTS), err.message);
        return true;
      });
    } finally {
      await rm(path.dirname(full), { recursive: true, force: true });
    }
  });
});

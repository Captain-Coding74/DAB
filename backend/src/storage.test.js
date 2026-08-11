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
import * as storage from "./services/storage.js";

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

  test("Thai filenames are preserved in the key", () => {
    const key = storage.buildKey({ datasetId: "d", versionNum: 2, fileName: "ยอดขาย ม.ค..xlsx" });
    assert.match(key, /ยอดขาย/, "Thai characters stripped from the key");
    assert.match(key, /^datasets\/d\/2-/);
  });
});

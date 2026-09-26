/**
 * zipGuard.test.js — the decompression-bomb guard on .xlsx uploads.
 *
 * MAX_UPLOAD_MB bounds compressed bytes; a workbook is a ZIP and ExcelJS
 * inflates all of it into memory. The guard MEASURES inflation with a
 * streaming, output-discarding inflater, so an archive whose central
 * directory lies about its sizes gains nothing. These tests hand-roll the
 * archives (src/testZip.js) precisely so they can lie.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildZip, buildXlsxBomb } from "./testZip.js";
import { readCentralDirectory, measureInflatedSize, assertInflatable, ZipBombError } from "./services/zipGuard.js";

const MB = 1048576;

describe("zipGuard — honest archives", () => {
  test("a real ExcelJS workbook passes and measures exactly what it declares", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ยอดขาย");
    ws.addRow(["สินค้า", "จำนวน"]);
    for (let i = 0; i < 500; i++) ws.addRow([`สินค้า ${i}`, i]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

    const entries = readCentralDirectory(xlsx);
    assert.ok(entries.some((e) => e.name === "xl/worksheets/sheet1.xml"), "central directory parsed");
    const declared = entries.reduce((s, e) => s + e.declaredSize, 0);
    const measured = await measureInflatedSize(xlsx, { maxBytes: 64 * MB });
    assert.equal(measured, declared, "an honest archive measures what it declares");
    assert.equal(await assertInflatable(xlsx, { maxBytes: 64 * MB }), measured);
  });

  test("a stored (uncompressed) entry counts its physical size", async () => {
    const zip = buildZip([{ name: "a.bin", data: Buffer.alloc(MB, 0x41), method: 0 }]);
    assert.equal(await measureInflatedSize(zip, { maxBytes: 2 * MB }), MB);
    await assert.rejects(assertInflatable(zip, { maxBytes: MB / 2 }), ZipBombError);
  });

  test("ZIP64 sizes in the extra field are honoured", () => {
    const zip = buildZip([{ name: "big.xml", data: Buffer.alloc(3000, 0x20), zip64: true }]);
    const [e] = readCentralDirectory(zip);
    assert.equal(e.declaredSize, 3000);
    assert.ok(e.compressedSize > 0 && e.compressedSize < 3000, "real compressed size read from the extra");
  });

  test("not a ZIP at all: measures 0 and does not throw — ExcelJS reports that itself", async () => {
    assert.equal(await measureInflatedSize(Buffer.from("a,b\n1,2\n")), 0);
    assert.equal(await assertInflatable(Buffer.alloc(0)), 0);
    assert.deepEqual(readCentralDirectory(Buffer.from("PK\x03\x04 truncated")), []);
  });
});

describe("zipGuard — bombs", () => {
  test("32 MB of spaces in a 40 KB workbook is refused with 413", async () => {
    const bomb = buildXlsxBomb(32 * MB);
    assert.ok(bomb.length < 100_000, `bomb is small on disk (${bomb.length} bytes)`);
    await assert.rejects(assertInflatable(bomb, { maxBytes: 8 * MB }), (err) => {
      assert.ok(err instanceof ZipBombError);
      assert.equal(err.status, 413);
      assert.equal(err.limit, 8 * MB);
      assert.match(err.message, /8 MB/);
      return true;
    });
  });

  test("measurement stops shortly past the budget instead of inflating everything", async () => {
    const bomb = buildXlsxBomb(32 * MB);
    const measured = await measureInflatedSize(bomb, { maxBytes: 4 * MB });
    assert.ok(measured > 4 * MB, "over budget is reported");
    assert.ok(measured < 8 * MB, `stopped early (measured ${measured})`);
  });

  test("a central directory that declares 10 bytes over a 32 MB stream is still refused", async () => {
    const liar = buildXlsxBomb(32 * MB, { declaredSize: 10 });
    const [, , ss] = readCentralDirectory(liar);
    assert.equal(ss.declaredSize, 10, "the header lies");
    await assert.rejects(assertInflatable(liar, { maxBytes: 8 * MB }), ZipBombError);
  });

  test("an honest archive just under the budget passes; just over is refused", async () => {
    const under = buildXlsxBomb(6 * MB);
    const over  = buildXlsxBomb(10 * MB);
    assert.ok(await assertInflatable(under, { maxBytes: 8 * MB }) > 6 * MB);
    await assert.rejects(assertInflatable(over, { maxBytes: 8 * MB }), ZipBombError);
  });

  test("an archive claiming 20,000 entries is refused before any entry is read", () => {
    const zip = buildZip([{ name: "x", data: Buffer.from("x") }], { entryCountOverride: 20_000 });
    assert.throws(() => readCentralDirectory(zip), ZipBombError);
  });

  test("a compressedSize that reaches past the end of the upload is clamped, not trusted", async () => {
    // Central directory says the deflate stream is 4 GB; the buffer is 40 KB.
    const bomb = buildXlsxBomb(32 * MB);
    const entries = readCentralDirectory(bomb);
    const ss = entries.find((e) => e.name === "xl/sharedStrings.xml");
    // Patch the central-directory compressedSize field in place.
    let p = bomb.length - 22; while (bomb.readUInt32LE(p) !== 0x06054b50) p--;
    let cd = bomb.readUInt32LE(p + 16);
    for (let i = 0; i < entries.length; i++) {
      const nLen = bomb.readUInt16LE(cd + 28), xLen = bomb.readUInt16LE(cd + 30);
      if (bomb.toString("utf8", cd + 46, cd + 46 + nLen) === ss.name) { bomb.writeUInt32LE(0xFFFFFFF0, cd + 20); break; }
      cd += 46 + nLen + xLen + bomb.readUInt16LE(cd + 32);
    }
    await assert.rejects(assertInflatable(bomb, { maxBytes: 8 * MB }), ZipBombError);
  });
});

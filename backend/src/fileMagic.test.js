/**
 * fileMagic.test.js — the content gate every upload route shares.
 *
 * The gap this guards: the old CSV rule was a blacklist (ZIP, OLE, ELF) and
 * nobody had listed the Windows "MZ" signature, so malware.exe renamed to
 * report.csv passed the check and landed in object storage. The rule is now
 * positive — refuse known binaries, then require the bytes to read as text —
 * and "text" has to mean everything DAB's decoder accepts: UTF-8, BOM'd
 * UTF-16, and TIS-620, whose Thai letters are high bytes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { verifyFileMagic, looksLikeText, requireFileMagic } from "./services/fileMagic.js";

/* A realistic PE header: "MZ", DOS stub fields, mostly NULs — what a real .exe
   starts with, not just the two magic letters. */
const PE = Buffer.concat([
  Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF\x00\x00", "latin1"),
  Buffer.alloc(48, 0),
  Buffer.from("This program cannot be run in DOS mode.\r\n$", "latin1"),
]);
const ELF = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
const ZIP = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
const OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x00]);
const CSV = Buffer.from("วันที่,สินค้า,จำนวน,ยอดขาย\n2026-01-14,น้ำปลา,12,1234.50\n", "utf8");

describe("verifyFileMagic — .csv", () => {
  test("rejects a Windows executable renamed to .csv (the missing MZ signature)", () => {
    assert.equal(verifyFileMagic(PE, "malware.csv"), false);
  });
  test("rejects the two-byte MZ prefix alone — a truncated .exe is still not text", () => {
    assert.equal(verifyFileMagic(Buffer.from("MZ\x90\x00", "latin1"), "tiny.csv"), false);
  });
  test("still rejects ELF, ZIP and OLE renamed to .csv", () => {
    assert.equal(verifyFileMagic(ELF, "a.csv"), false);
    assert.equal(verifyFileMagic(ZIP, "b.csv"), false);
    assert.equal(verifyFileMagic(OLE, "c.csv"), false);
  });
  test("rejects unsigned binary junk — NULs and control bytes are not text", () => {
    const junk = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37) & 0xFF));
    assert.equal(verifyFileMagic(junk, "noise.csv"), false);
  });
  test("accepts a UTF-8 CSV with Thai text", () => {
    assert.equal(verifyFileMagic(CSV, "sales.csv"), true);
  });
  test("accepts a TIS-620 (windows-874) CSV — Thai is high bytes, not binary", () => {
    // "วันที่,ยอด\n" in TIS-620: every Thai letter is a single byte in 0xA1–0xFB.
    const tis = Buffer.from([0xC7, 0xD1, 0xB9, 0xB7, 0xD5, 0xE8, 0x2C, 0xC2, 0xCD, 0xB4, 0x0A, 0x31, 0x2C, 0x32, 0x0A]);
    assert.equal(verifyFileMagic(tis, "shop.csv"), true);
  });
  test("accepts a UTF-16LE CSV with BOM — its NULs are code-unit padding, not binary", () => {
    const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from("a,b\n1,2\n", "utf16le")]);
    assert.equal(verifyFileMagic(utf16, "excel-export.csv"), true);
  });
  test("accepts a UTF-16BE CSV with BOM", () => {
    const le = Buffer.from("a,b\n1,2\n", "utf16le");
    const be = Buffer.alloc(le.length);
    for (let i = 0; i + 1 < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i]; }
    assert.equal(verifyFileMagic(Buffer.concat([Buffer.from([0xFE, 0xFF]), be]), "x.csv"), true);
  });
  test("tolerates the control characters real text files carry (tab, CR, LF, DOS EOF)", () => {
    assert.equal(verifyFileMagic(Buffer.from("a\tb\r\n1\t2\r\n\x1a"), "dos.csv"), true);
  });
  test("an empty buffer is not the gate's problem — the parser rejects it", () => {
    assert.equal(verifyFileMagic(Buffer.alloc(0), "empty.csv"), true);
  });
});

describe("verifyFileMagic — Excel", () => {
  test("an executable renamed to .xlsx is rejected (must be a ZIP container)", () => {
    assert.equal(verifyFileMagic(PE, "malware.xlsx"), false);
    assert.equal(verifyFileMagic(CSV, "text.xlsx"), false);
  });
  test(".xlsx accepts a ZIP container", () => {
    assert.equal(verifyFileMagic(ZIP, "book.xlsx"), true);
  });
  test(".xls accepts OLE or a mislabelled ZIP, rejects an executable", () => {
    assert.equal(verifyFileMagic(OLE, "legacy.xls"), true);
    assert.equal(verifyFileMagic(ZIP, "renamed.xls"), true);
    assert.equal(verifyFileMagic(PE, "malware.xls"), false);
  });
});

describe("looksLikeText", () => {
  test("a single NUL outside UTF-16 is decisive", () => {
    assert.equal(looksLikeText(Buffer.from("a,b\n1,\x002\n", "latin1")), false);
  });
  test("only the leading sample is inspected, so a large file is cheap to judge", () => {
    const big = Buffer.concat([Buffer.from("h1,h2\n"), Buffer.alloc(2 * 1024 * 1024, 0x41)]);
    assert.equal(looksLikeText(big), true);
  });
});

describe("requireFileMagic middleware", () => {
  const run = (req) => new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    requireFileMagic(req, res, () => resolve({ next: true }));
  });

  test("answers 400 for a single mismatched file and never calls next", async () => {
    const r = await run({ file: { buffer: PE, originalname: "malware.csv" } });
    assert.equal(r.code, 400);
    assert.match(r.body.error, /does not match/i);
  });
  test("names the offending file in a multi-upload", async () => {
    const r = await run({ files: [
      { buffer: CSV, originalname: "ok.csv" },
      { buffer: PE,  originalname: "bad.csv" },
    ] });
    assert.equal(r.code, 400);
    assert.match(r.body.error, /^bad\.csv: /);
  });
  test("passes genuine files, and passes a request with no file (the route owns that 400)", async () => {
    assert.deepEqual(await run({ file: { buffer: CSV, originalname: "ok.csv" } }), { next: true });
    assert.deepEqual(await run({ files: [{ buffer: CSV, originalname: "a.csv" }, { buffer: ZIP, originalname: "b.xlsx" }] }), { next: true });
    assert.deepEqual(await run({}), { next: true });
  });
});

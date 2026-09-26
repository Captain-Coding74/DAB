/**
 * testZip.js — a deliberately minimal ZIP writer for the test suites.
 *
 * The zip-bomb guard has to be tested against archives that LIE (a central
 * directory declaring ten bytes over a stream that inflates to megabytes),
 * and no packaging library will write one of those for us. Thirty lines of
 * PKZIP structure is cheaper than a dependency and lets a test control every
 * byte: compression method, declared sizes, entry count, ZIP64 extras.
 *
 * Not for production use — no data descriptors, no encryption, no comments.
 */
import { deflateRawSync, crc32 } from "node:zlib";

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;

/**
 * @param {Array<{name:string, data:Buffer, method?:0|8, declaredSize?:number, zip64?:boolean}>} entries
 * @param {{ entryCountOverride?: number }} [opts]  lie about the entry count in the EOCD
 */
export function buildZip(entries, { entryCountOverride } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const name   = Buffer.from(e.name, "utf8");
    const comp   = method === 8 ? deflateRawSync(e.data) : e.data;
    const crc    = crc32(e.data);
    const usize  = e.declaredSize ?? e.data.length;

    // ZIP64: saturate the 32-bit fields and carry the real values in an extra.
    let extra = Buffer.alloc(0);
    let cUsize = usize, cCsize = comp.length;
    if (e.zip64) {
      extra = Buffer.alloc(20);
      extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(usize), 4); extra.writeBigUInt64LE(BigInt(comp.length), 12);
      cUsize = 0xFFFFFFFF; cCsize = 0xFFFFFFFF;
    }

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOCAL, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CENTRAL, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(cCsize, 20); ch.writeUInt32LE(cUsize, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(extra.length, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);

    locals.push(lh, name, comp);
    centrals.push(ch, name, extra);
    offset += 30 + name.length + comp.length;
  }
  const cd   = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const n    = entryCountOverride ?? entries.length;
  eocd.writeUInt32LE(SIG_EOCD, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(n, 8); eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * A decompression bomb shaped like a workbook: a sharedStrings.xml of
 * `inflatedBytes` spaces. Deflate takes it to roughly 1/1000th.
 */
export function buildXlsxBomb(inflatedBytes, extra = {}) {
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "xl/workbook.xml",     data: Buffer.from("<workbook/>") },
    { name: "xl/sharedStrings.xml", data: Buffer.alloc(inflatedBytes, 0x20), ...extra },
  ]);
}

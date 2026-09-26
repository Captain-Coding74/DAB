/**
 * services/fileMagic.js — content-based upload gate, shared by every upload route.
 *
 * The extension filter on multer is spoofable: rename malware.exe to
 * report.csv and it passes. This module looks at the BYTES.
 *
 *   .xlsx  must be a ZIP container       (PK\x03\x04)
 *   .xls   must be OLE, or a mislabelled ZIP (D0 CF 11 E0)
 *   .csv   must look like text
 *
 * The CSV rule used to be a blacklist (reject ZIP, OLE, ELF) — which let a
 * Windows executable (MZ header) through, because nobody had listed it. A
 * blacklist can never be complete, so the rule is now positive: known binary
 * signatures are refused outright, and beyond that the leading bytes have to
 * read as text. "Text" must tolerate everything DAB's decoder accepts —
 * UTF-8, UTF-16 with a BOM, and TIS-620 (windows-874), whose Thai letters are
 * high bytes (0xA1–0xFB). So the heuristic does not ask for ASCII; it asks
 * for the ABSENCE of what text never contains: NUL bytes (outside UTF-16) and
 * a meaningful share of C0 control characters.
 *
 * Why not sniff the delimiter or parse a row? A file with one column and no
 * delimiter is a legal CSV. Cheap byte rules are enough to keep executables
 * out of storage; the parser handles the rest.
 */

const SAMPLE_BYTES = 8 * 1024;

/** Control characters that appear in real text files. */
const TEXT_CONTROLS = new Set([0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x1A /* DOS EOF */, 0x1B /* ESC */]);

function hasSig(buf, sig) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

export const isZip = (buf) => hasSig(buf, [0x50, 0x4B, 0x03, 0x04]);
export const isOle = (buf) => hasSig(buf, [0xD0, 0xCF, 0x11, 0xE0]);
export const isElf = (buf) => hasSig(buf, [0x7F, 0x45, 0x4C, 0x46]);
/** Windows PE / DOS executable ("MZ"). The signature that was missing. */
export const isPE  = (buf) => hasSig(buf, [0x4D, 0x5A]);

const hasUtf16Bom = (buf) =>
  buf.length >= 2 && ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF));

/**
 * Does the leading sample read as text? True for UTF-8, TIS-620 and BOM'd
 * UTF-16; false for anything with NULs (outside UTF-16) or a control-byte
 * density no text file has.
 */
export function looksLikeText(buf) {
  const sample = buf.subarray(0, SAMPLE_BYTES);
  if (sample.length === 0) return true;

  if (hasUtf16Bom(sample)) {
    // UTF-16 legitimately carries a NUL in every other byte. Decode the sample
    // and judge the code units instead of the bytes.
    const le = sample[0] === 0xFF;
    let ctrl = 0, units = 0;
    for (let i = 2; i + 1 < sample.length; i += 2) {
      const u = le ? sample[i] | (sample[i + 1] << 8) : (sample[i] << 8) | sample[i + 1];
      units++;
      if (u === 0 || (u < 0x20 && !TEXT_CONTROLS.has(u))) ctrl++;
    }
    return units === 0 || ctrl / units < 0.05;
  }

  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0x00) return false;                         // text never has NULs
    if (b < 0x20 && !TEXT_CONTROLS.has(b)) ctrl++;
  }
  return ctrl / sample.length < 0.05;
}

/**
 * Do the bytes agree with the extension? Pure; no I/O.
 * @param {Buffer} buf   file contents (or its leading bytes)
 * @param {string} name  original filename, used only for its extension
 */
export function verifyFileMagic(buf, name) {
  if (!buf || buf.length === 0) return true;             // nothing to judge; the parser rejects empties
  const isXlsxName = /\.xlsx$/i.test(name || ""), isXlsName = /\.xls$/i.test(name || "");
  if (isXlsxName) return isZip(buf);                     // .xlsx must be a real ZIP container
  if (isXlsName)  return isZip(buf) || isOle(buf);       // .xls: legacy OLE, or xlsx mislabelled
  // .csv / .tsv / anything text: refuse known binaries, then require text.
  if (isZip(buf) || isOle(buf) || isElf(buf) || isPE(buf)) return false;
  return looksLikeText(buf);
}

/**
 * Express middleware. Mount AFTER multer: inspects req.file (single) and
 * req.files (array) and answers 400 when any file's bytes contradict its
 * extension. Routes with no file fall through — "No file uploaded" stays the
 * route's own 400.
 */
export function requireFileMagic(req, res, next) {
  if (req.file && !verifyFileMagic(req.file.buffer, req.file.originalname)) {
    return res.status(400).json({ error: "File content does not match its extension" });
  }
  for (const f of Array.isArray(req.files) ? req.files : []) {
    if (!verifyFileMagic(f.buffer, f.originalname)) {
      return res.status(400).json({ error: `${f.originalname}: content does not match extension` });
    }
  }
  next();
}

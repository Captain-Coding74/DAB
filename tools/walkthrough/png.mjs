// Minimal PNG decode + pixel comparisons for the capture's locality and continuity gates (no native deps).
// Handles what Chromium writes: 8-bit greyscale / RGB / RGBA (+ grey-alpha), non-interlaced, all five filters.
import fs from "node:fs";
import zlib from "node:zlib";

export function decodePNG(buf) {
  if (typeof buf === "string") buf = fs.readFileSync(buf);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || !chans || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * chans, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? cur[i - chans] : 0, b = prev[i], c = i >= chans ? prev[i - chans] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * chans;
      if (chans === 1) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      else if (chans === 2) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      else { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = chans === 4 ? cur[s + 3] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { width: w, height: h, data: out };
}

/** Crop (device px) → new image. */
export function crop(img, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) throw new Error(`crop ${x},${y},${w},${h} outside ${img.width}x${img.height}`);
  const out = Buffer.alloc(w * h * 4);
  for (let r = 0; r < h; r++) img.data.copy(out, r * w * 4, ((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4);
  return { width: w, height: h, data: out };
}

/**
 * Compare two images over the region where `include(x, y)` is true (device px; default: everywhere both exist,
 * limited to rows < maxY when given). Returns { n, diffPx, mean, p999, max, bbox } with |Δ| in 0–255 units over RGB.
 */
export function compare(a, b, { include = null, maxY = Infinity, sameSize = true } = {}) {
  if (sameSize && (a.width !== b.width || a.height !== b.height)) return { sizeMismatch: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height, maxY);
  const hist = new Float64Array(256);
  let n = 0, diffPx = 0, sum = 0, max = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (include && !include(x, y)) continue;
    const oa = (y * a.width + x) * 4, ob = (y * b.width + x) * 4;
    let px = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[oa + c] - b.data[ob + c]); hist[d]++; sum += d; if (d > px) px = d; }
    n++;
    if (px) { diffPx++; if (px > max) max = px; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  const total = n * 3; let acc = 0, p999 = 0;
  for (let d = 0; d < 256; d++) { acc += hist[d]; if (acc >= total * 0.999) { p999 = d; break; } }
  return { n, diffPx, mean: total ? sum / total : 0, p999, max, bbox: diffPx ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}

/** The capture session id a plate carries (tEXt "dab-walk-session"), or null. Reads chunk headers only. */
export function readSession(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8);
    if (type === "tEXt") {
      const data = buf.subarray(off + 8, off + 8 + len), z = data.indexOf(0);
      if (data.toString("latin1", 0, z) === "dab-walk-session") return data.toString("latin1", z + 1);
    }
    if (type === "IDAT" || type === "IEND") break;
    off += 12 + len;
  }
  return null;
}

/** Encode an { width, height, data (RGBA) } image as an 8-bit RGB PNG (filter 0). */
export function encodePNG(img) {
  const { width: w, height: h, data } = img, stride = w * 3 + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, r = y * stride + 1 + x * 3;
    raw[r] = data[o]; raw[r + 1] = data[o + 1]; raw[r + 2] = data[o + 2];
  }
  const chunk = (type, body) => {
    const c = Buffer.alloc(12 + body.length);
    c.writeUInt32BE(body.length, 0); c.write(type, 4, "latin1"); body.copy(c, 8);
    c.writeUInt32BE(zlib.crc32(c.subarray(4, 8 + body.length)), 8 + body.length);
    return c;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Extend an image to w x h (bottom/right) with a solid [r, g, b]. */
export function padTo(img, w, h, rgb) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 255; }
  for (let y = 0; y < Math.min(h, img.height); y++) img.data.copy(out, y * w * 4, y * img.width * 4, y * img.width * 4 + Math.min(w, img.width) * 4);
  return { width: w, height: h, data: out };
}

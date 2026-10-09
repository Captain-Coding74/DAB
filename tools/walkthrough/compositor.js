// Compositor for the 23 s "How it works" walkthrough. renderAt(t) is a pure function of t: it awaits every bitmap
// the frame needs, then draws the whole frame in one go, so frames can render in any order and in parallel.
//
// Layers, back to front (index.html):
//   1. <canvas id=plate>  the app plates: PASS A stills, hover plates and PASS B burst frames
//   2. <svg id=ov>        spotlight, brackets, ripples, cursor
//   3. <div id=scrim>     the caption scrim
//   4. <div id=cap>       margin rule, eyebrow, headline, sub
//
// Plates are composited at the capture's own resolution (DPR 2, integer device px, no resampling: every layer is a
// 1:1 copy of captured pixels, cross-faded only where schedule.js says so), then the camera rect is resampled ONCE
// to 1600x900. So every layer shares one camera mapping and a clip edge can never show a seam.
// Every number in a caption comes from meta.json (captionTexts throws on any mismatch, which aborts the render).
import * as S from "./schedule.js";

const INK = "#0B1220";
const fail = (msg) => { window.__error = msg; throw new Error(msg); };
const meta = await fetch("capture/meta.json", { cache: "no-store" }).then(r => r.ok ? r.json() : fail(`capture/meta.json: HTTP ${r.status}`));

/* ── consistency with the capture: anything that would make the film disagree with its own run aborts ── */
for (const [id, def] of Object.entries(S.BURSTS)) {
  const b = meta.bursts?.[id];
  if (!b) fail(`meta.bursts.${id} missing`);
  if (JSON.stringify(b.clip) !== JSON.stringify(def.clip)) fail(`burst ${id}: meta clip ${b.clip} ≠ schedule clip ${def.clip}`);
  if (!b.usable) console.warn(`burst ${id} failed its continuity gate: the schedule falls back to a 150 ms dissolve`);
  if (b.files.length !== b.n) fail(`burst ${id}: ${b.files.length} files for n = ${b.n}`);
}
if (meta.toastCutFrame !== S.toastCutFrame(meta.perceivedMs)) fail(`toast cut: meta ${meta.toastCutFrame} ≠ schedule ${S.toastCutFrame(meta.perceivedMs)}`);
const CAPS = S.captionTexts(meta);   // throws on any unmatched regex / unknown key
for (const c of CAPS) {
  const m = (meta.captions || []).find(x => x.id === c.id);
  if (!m || m.eyebrow !== c.eyebrow || m.headline !== c.headline || m.sub !== c.sub) fail(`caption ${c.id} differs from the capture's own fill`);
}

/* ── bitmaps: createImageBitmap(fetch blob), LRU of 20 per page; colours passed through untouched ── */
const LRU = 20, cache = new Map();
async function bitmap(name, keep) {
  if (cache.has(name)) { const v = cache.get(name); cache.delete(name); cache.set(name, v); return v; }
  const r = await fetch(`capture/${name}`);
  if (!r.ok) fail(`capture/${name}: HTTP ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  cache.set(name, bmp);
  for (const k of cache.keys()) {
    if (cache.size <= LRU) break;
    if (!keep.has(k)) { cache.get(k).close(); cache.delete(k); }
  }
  return bmp;
}

/* ── plate compositing ── */
const plate = document.getElementById("plate"), ctx = plate.getContext("2d", { alpha: false });
const comp = document.createElement("canvas");
comp.width = 2880; comp.height = 1640;   // the widest framing (S3, 1400 CSS px) is 2800 x 1575 device px + margins
const cc = comp.getContext("2d", { alpha: false, willReadFrequently: false });

/** Device-px window of the camera, snapped outward to whole pixels plus a MARGIN of real plate pixels: the resampling
 *  filter reads a few taps past its source rect, and those taps must see the true neighbours, never stale pixels. */
const MARGIN = 8;
const windowOf = (cam) => ({
  X0: Math.floor(cam.x0 * S.DPR) - MARGIN, Y0: Math.floor(cam.y0 * S.DPR) - MARGIN,
  X1: Math.ceil((cam.x0 + cam.w) * S.DPR) + MARGIN, Y1: Math.ceil((cam.y0 + cam.h) * S.DPR) + MARGIN,
});
/** Composite the layers 1:1 (device px) into comp over the window. */
function composite(layers, bmps, win) {
  const { X0, Y0, X1, Y1 } = win;
  if (X1 - X0 > comp.width || Y1 - Y0 > comp.height) fail(`camera window ${X1 - X0}x${Y1 - Y0} exceeds the composite canvas`);
  cc.globalAlpha = 1; cc.imageSmoothingEnabled = false;
  cc.fillStyle = INK; cc.fillRect(0, 0, comp.width, comp.height);   // the whole canvas: nothing survives from a previous frame
  layers.forEach((L, i) => {
    if (!(L.alpha > 0)) return;
    const bmp = bmps[i], sx = Math.round(L.src[0] * S.DPR), sy = Math.round(L.src[1] * S.DPR);
    let x0 = Math.max(sx, X0), y0 = Math.max(sy, Y0), x1 = Math.min(sx + bmp.width, X1), y1 = Math.min(sy + bmp.height, Y1);
    if (L.clip) {   // clips are page CSS px; snapped outward (a hover plate equals its base outside its diff box)
      const [cx, cy, cw, ch] = L.clip;
      x0 = Math.max(x0, Math.floor(cx * S.DPR)); y0 = Math.max(y0, Math.floor(cy * S.DPR));
      x1 = Math.min(x1, Math.ceil((cx + cw) * S.DPR)); y1 = Math.min(y1, Math.ceil((cy + ch) * S.DPR));
    }
    if (x1 <= x0 || y1 <= y0) return;
    cc.globalAlpha = Math.min(1, L.alpha);
    cc.drawImage(bmp, x0 - sx, y0 - sy, x1 - x0, y1 - y0, x0 - X0, y0 - Y0, x1 - x0, y1 - y0);
  });
  cc.globalAlpha = 1;
}

/* ── overlays (SVG, frame px) ── */
const ov = document.getElementById("ov");
const n = (v) => (Math.round(v * 100) / 100).toString();
// cursor glyphs, tip / hotspot at (0,0), 30 frame px tall
const ARROW = "M0 0V26.3L6.2 20.4L10.3 29.6L14.5 27.8L10.5 18.7H18.6Z";
const HAND_BODY = "M9 3.2a2.3 2.3 0 0 1 4.6 0V11.6a1.9 1.9 0 0 1 3.8 .4a1.9 1.9 0 0 1 3.8 .6a1.75 1.75 0 0 1 3.5 .9V20.5C24.7 24.8 23 27.2 21.6 28.4V30.6H11.6V28.6C10.2 27.4 8.2 25.4 6.6 23.2L3.4 18.8a1.9 1.9 0 0 1 2.9 -2.4L9 19.2Z";
const HAND_LINES = "M13.6 11.6V16.4M17.4 12V16.6M21.2 12.6V16.9";
const HAND_TIP = [11.3, 0.9];
const DEFS = `<defs>
<filter id="fb" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1800" height="1100"><feGaussianBlur stdDeviation="${S.SPOT.feather}"/></filter>
<filter id="ds" x="-60%" y="-40%" width="220%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".5"/></filter>
</defs>`;
function overlaySVG(o, cam) {
  const F = (x, y) => S.toFrame(cam, x, y), k = cam.s;
  let s = DEFS;
  if (o.spotlight) {
    const b = o.spotlight.box, [x, y] = F(b.x, b.y);
    s += `<mask id="spm" maskUnits="userSpaceOnUse" x="0" y="0" width="${S.W}" height="${S.H}">`
      + `<rect width="${S.W}" height="${S.H}" fill="#fff"/>`
      + `<rect x="${n(x)}" y="${n(y)}" width="${n(b.w * k)}" height="${n(b.h * k)}" rx="${o.spotlight.r}" fill="#000" filter="url(#fb)"/></mask>`
      + `<rect width="${S.W}" height="${S.H}" fill="${INK}" fill-opacity="${n4(o.spotlight.ink * o.spotlight.alpha)}" mask="url(#spm)"/>`;
  }
  if (o.brackets && o.brackets.arm > 0.05) {
    const B = o.brackets, b = B.box, [bx, by] = F(b.x, b.y), g = B.gap, a = B.arm;
    const x0 = bx - g, y0 = by - g, x1 = bx + b.w * k + g, y1 = by + b.h * k + g;
    const d = `M${n(x0)} ${n(y0 + a)}V${n(y0)}H${n(x0 + a)}M${n(x1 - a)} ${n(y0)}H${n(x1)}V${n(y0 + a)}`
      + `M${n(x1)} ${n(y1 - a)}V${n(y1)}H${n(x1 - a)}M${n(x0 + a)} ${n(y1)}H${n(x0)}V${n(y1 - a)}`;
    s += `<path d="${d}" fill="none" stroke="${B.color}" stroke-width="${B.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${n4(B.alpha)}"/>`;
  }
  for (const r of o.ripples) {
    const [x, y] = F(r.x, r.y);
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r.discR)}" fill="${S.BRACKET.color}" fill-opacity="${n4(r.discAlpha)}"/>`
      + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r.r)}" fill="none" stroke="${S.BRACKET.color}" stroke-width="${r.stroke}" opacity="${n4(r.opacity)}"/>`;
  }
  const c = o.cursor, [cx, cy] = F(c.x, c.y), hand = c.hand;
  s += `<g filter="url(#ds)" transform="translate(${n(cx)} ${n(cy)}) scale(${n4(c.scale)})">`;
  if (hand < 1) s += `<path d="${ARROW}" fill="#E9EEF7" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" opacity="${n4(1 - hand)}"/>`;
  if (hand > 0) s += `<g transform="translate(${-HAND_TIP[0]} ${-HAND_TIP[1]})" opacity="${n4(hand)}"><path d="${HAND_BODY}" fill="#E9EEF7" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<path d="${HAND_LINES}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/></g>`;
  s += `</g>`;
  return s;
}
function n4(v) { return (Math.round(v * 10000) / 10000).toString(); }

/* ── scrim + caption (DOM) ── */
const scrim = document.getElementById("scrim"), rule = document.getElementById("rule");
const eb = document.getElementById("eb"), hl = document.getElementById("hl"), sb = document.getElementById("sb");
const hexRGB = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const AMBER = hexRGB(S.CAPTION_STYLE.rule.amber), GREEN = hexRGB(S.CAPTION_STYLE.rule.green);
function setLine(el, v) {
  if (!v || !(v.alpha > 0)) { el.style.opacity = "0"; return; }
  el.style.opacity = n4(v.alpha); el.style.transform = `translateY(${n(v.dy || 0)}px)`;
}
function captionDOM(cap, scrimA) {
  scrim.style.opacity = n4(scrimA);
  const mix = cap.rule.mix, rgb = AMBER.map((a, i) => Math.round(a + (GREEN[i] - a) * mix));
  rule.style.background = `rgb(${rgb.join(",")})`; rule.style.opacity = n4(cap.rule.alpha);
  eb.textContent = cap.eyebrow?.text ?? ""; setLine(eb, cap.eyebrow);
  hl.textContent = cap.headline?.text ?? ""; setLine(hl, cap.headline);
  sb.textContent = "";
  if (cap.sub) {
    const sev = cap.sub.severity, col = sev && S.CAPTION_STYLE.sub.severity[sev];
    if (col && cap.sub.text.startsWith(sev)) {
      const sp = document.createElement("span"); sp.style.color = col; sp.textContent = sev;
      sb.append(sp, document.createTextNode(cap.sub.text.slice(sev.length)));
    } else sb.textContent = cap.sub.text;
  }
  setLine(sb, cap.sub);
}

/* ── one frame ── */
function frameInfo(t) {
  const tt = S.wrap(t), f = Math.round(tt * S.FPS);
  return { tt, f, cam: S.camera(tt), layers: S.plates(tt, meta), ov: S.overlays(tt, meta), cap: S.caption(tt, meta), state: S.stateAt(tt, meta) };
}
async function bitmapsFor(layers) {
  const keep = new Set(layers.map(L => L.img)), out = [];
  for (const L of layers) out.push(await bitmap(L.img, keep));   // sequential: the LRU never evicts this frame's own plates
  return out;
}
window.renderAt = async (t) => {
  const I = frameInfo(t);
  const bmps = await bitmapsFor(I.layers);   // everything the frame needs, before anything is drawn
  const win = windowOf(I.cam);
  composite(I.layers, bmps, win);
  ctx.globalAlpha = 1; ctx.fillStyle = INK; ctx.fillRect(0, 0, S.W, S.H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(comp, I.cam.x0 * S.DPR - win.X0, I.cam.y0 * S.DPR - win.Y0, I.cam.w * S.DPR, I.cam.h * S.DPR, 0, 0, S.W, S.H);
  ov.innerHTML = overlaySVG(I.ov, I.cam);
  captionDOM(I.cap, I.ov.scrim);
  return { f: I.f, state: I.state, layers: I.layers.map(L => `${L.img}@${n4(L.alpha)}`) };
};
/** For checks: the plate composite (before resampling) over a page-px rect, as a PNG data URL. */
window.__composite = async (t, rect) => {
  const I = frameInfo(t), bmps = await bitmapsFor(I.layers);
  const win = { X0: rect[0] * S.DPR, Y0: rect[1] * S.DPR, X1: (rect[0] + rect[2]) * S.DPR, Y1: (rect[1] + rect[3]) * S.DPR };
  composite(I.layers, bmps, win);
  const out = document.createElement("canvas"); out.width = win.X1 - win.X0; out.height = win.Y1 - win.Y0;
  out.getContext("2d").drawImage(comp, 0, 0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
};
window.__info = (t) => { const I = frameInfo(t); return { f: I.f, state: I.state, cam: I.cam, layers: I.layers, ov: I.ov, cap: I.cap }; };
window.__period = S.PERIOD;
window.__session = meta.session;

/* ── ready: the three faces, meta + schedule, and L01 decoded ── */
const FACES = ['600 42px "PlexSans"', '400 21px "PlexMono"', '500 17px "PlexMono"'];
await Promise.all(FACES.map(f => document.fonts.load(f, "Aa0“”…×·—")));
for (const f of FACES) if (!document.fonts.check(f, "Aa0“”…×·—")) fail(`font ${f} did not load`);
await bitmap("L01.png", new Set(["L01.png"]));
window.__ready = true;

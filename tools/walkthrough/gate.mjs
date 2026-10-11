// node gate.mjs [--frames frames] [--session <uuid>] [--plates 10] [--purity 24] [--no-frames 1] [--no-plates 1] [--no-purity 1]
// Every check runs over all 690 frames (the plate-exactness proof samples every --plates-th frame plus every burst
// frame boundary and hover entry). Exits non-zero on any failure; prints GATE OK when everything passes.
//
//   header      camera y0 ≥ 60 (the app header and its version chip never enter the frame)
//   upsampling  camera w ≥ 800 CSS px (the DPR-2 plates are never upsampled)
//   coverage    every plate drawn with α > 0 covers the camera rect inside its clip
//   safe zone   brackets (box + gap + arms + stroke) end at frame y ≤ 650; the toast's bottom ≤ 655 during holds
//   hover       the cursor tip is inside a hoverable rect only where a captured hover covers it (fading in, showing,
//               or a captured hover that changes no pixels); a hover plate shows only while the tip is inside or
//               fading out; the hand glyph appears only over pointer rects (+ its 80 ms crossfade out)
//   figures     every number in a caption appears as a number in the innerText of the state it describes;
//               the caption text equals the capture's own fill
//   landing     frontend/public/landing.js CHAPTERS equals schedule.js CHAPTERS, and every figure in its walkDesc
//               (EN and TH) and in landing.html's TH <figcaption> appears in the capture's innerText (read only)
//   session     every asset carries meta.session and matches its recorded sha256
//   continuity  each burst's last frame equals its PASS A still at the clip (re-checked from the PNGs)
//   plates      an independent re-composite in Node equals the compositor's own plate composite (before the one
//               resample): every plate pixel on screen is a captured pixel, cross-faded only where scheduled
//   loop        22.70–23.00 and 0.00–0.60 are one static state; f0689 is pixel- and byte-identical to f0000
//   purity      a shuffled sample re-rendered in one fresh page (disturbed between frames) equals the full render
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { serve, launch, args, HERE, FONTS, sessionDir } from "./serve.mjs";
import { decodePNG, crop, compare, readSession } from "./png.mjs";
import * as S from "./schedule.js";
const A = args(process.argv.slice(2));
const SES = sessionDir(A.session), meta = JSON.parse(fs.readFileSync(path.join(SES, "meta.json"), "utf8"));
const FRAMES = path.resolve(A.frames || path.join(HERE, "frames"));
const N = S.NFRAMES, T = (f) => f / S.FPS;
const results = [];
const check = (name, ok, note = "") => { results.push({ name, ok, note }); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
const r2 = (v) => Math.round(v * 100) / 100;
const pngSize = (file) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const moving = (t) => S.CAMERA.some(m => t > m.t[0] && t < m.t[1]);
const frameRect = (cam, b) => { const [x0, y0] = S.toFrame(cam, b.x, b.y); return { x0, y0, x1: x0 + b.w * cam.s, y1: y0 + b.h * cam.s }; };
const info = Array.from({ length: N }, (_, f) => {
  const t = T(f);
  return { f, t, cam: S.camera(t), layers: S.plates(t, meta), ov: S.overlays(t, meta), cap: S.caption(t, meta), state: S.stateAt(t, meta) };
});

/* ── header / upsampling ── */
{
  const y0 = Math.min(...info.map(i => i.cam.y0)), w = Math.min(...info.map(i => i.cam.w));
  check("header: camera y0 ≥ 60 on every frame", y0 >= 60, `min y0 ${r2(y0)}`);
  check("no upsampling: camera w ≥ 800 on every frame", w >= 800, `min w ${r2(w)}`);
}

/* ── plate coverage ── */
{
  const sizes = {}, bad = [];
  const size = (img) => (sizes[img] ||= pngSize(path.join(SES, img)));
  for (const i of info) {
    const c = i.cam, cr = { x0: c.x0, y0: c.y0, x1: c.x0 + c.w, y1: c.y0 + c.h };
    i.layers.forEach((L, k) => {
      if (!(L.alpha > 0)) return;
      const { w, h } = size(L.img), sx = L.src[0], sy = L.src[1], ex = sx + w / S.DPR, ey = sy + h / S.DPR;
      let need = { ...cr };
      if (L.clip) need = { x0: Math.max(cr.x0, L.clip[0]), y0: Math.max(cr.y0, L.clip[1]), x1: Math.min(cr.x1, L.clip[0] + L.clip[2]), y1: Math.min(cr.y1, L.clip[1] + L.clip[3]) };
      if (k === 0 && L.clip) bad.push(`f${i.f} base layer ${L.img} is clipped`);
      if (need.x1 <= need.x0 || need.y1 <= need.y0) return;
      if (need.x0 < sx - 1e-6 || need.y0 < sy - 1e-6 || need.x1 > ex + 1e-6 || need.y1 > ey + 1e-6)
        bad.push(`f${i.f} ${L.img} covers ${sx},${sy}–${r2(ex)},${r2(ey)} but the frame needs ${r2(need.x0)},${r2(need.y0)}–${r2(need.x1)},${r2(need.y1)}`);
    });
  }
  check("plate coverage: every plate with α > 0 covers the camera rect (inside its clip)", !bad.length, bad.slice(0, 4).join("; "));
}

/* ── safe zone ── */
{
  const bad = [], toastBad = [], underScrim = []; let maxBr = -1e9, maxToast = -1e9;
  const SCRIM_DENSE = S.SCRIM.stops.find(([, a]) => a >= 0.95)[0];
  const toast = meta.states.L03.boxes.toast;
  for (const i of info) {
    const b = i.ov.brackets;
    if (b && b.alpha > 0) {
      const r = frameRect(i.cam, b.box), out = b.gap + b.width / 2;
      const ext = { x0: r.x0 - out, y0: r.y0 - out, x1: r.x1 + out, y1: r.y1 + out };
      maxBr = Math.max(maxBr, ext.y1);
      if (ext.y1 > S.SAFE_Y || ext.x0 < 0 || ext.y0 < 0 || ext.x1 > S.W) bad.push(`f${i.f} ${b.target} ${r2(ext.x0)},${r2(ext.y0)}–${r2(ext.x1)},${r2(ext.y1)}`);
    }
    const k = i.f - S.CLICKS.card.frame, b0 = meta.bursts.B0;
    const toastOn = i.layers.some(L => L.img === "L03.png" && L.alpha > 0) && (k >= b0.n || !b0.frames[k] || b0.frames[k].toast);
    if (toastOn && !moving(i.t)) {
      // read above the scrim (bottom ≤ 655), or wholly inside its dense band (top ≥ 760, ink ≥ .95): never half-cut
      const r = frameRect(i.cam, toast);
      if (r.y1 <= S.TOAST_SAFE_Y) maxToast = Math.max(maxToast, r.y1);
      else if (r.y0 >= SCRIM_DENSE) underScrim.push(i.f);
      else toastBad.push(`f${i.f} toast ${r2(r.y0)}–${r2(r.y1)}`);
    }
  }
  check(`safe zone: brackets (box + gap + arms + stroke) end at frame y ≤ ${S.SAFE_Y} and stay in frame`, !bad.length, bad.length ? bad.slice(0, 4).join("; ") : `max ${r2(maxBr)}`);
  check(`safe zone: during holds the toast's bottom is ≤ ${S.TOAST_SAFE_Y} (or it sits wholly under the scrim's dense band)`, !toastBad.length,
    toastBad.length ? toastBad.slice(0, 4).join("; ") : `max bottom ${r2(maxToast)} when readable${underScrim.length ? `; wholly under the scrim at f${underScrim.join(",")} (its first frames, before the camera rises)` : ""}`);
}

/* ── hover honesty + pointer glyph ── */
{
  const inside = (p, r) => S.inside(p, r), contains = (o, r) => r.x >= o.x - 0.5 && r.y >= o.y - 0.5 && r.x + r.w <= o.x + o.w + 0.5 && r.y + r.h <= o.y + o.h + 0.5;
  const tipAt = (t) => { const c = S.cursor(t); return [c.x, c.y]; };
  const bad = [], plateBad = [], handBad = [], arrowOver = [], creditedReal = new Set();
  // where the real mouse was when each plate was captured (stills record it; PASS B clicks at the schedule's point)
  const mouseOf = (img) => {
    const name = img.replace(/\.png$/, "");
    if (meta.stills[name]?.mouse) return meta.stills[name].mouse;
    const id = name.split("/")[0], def = S.BURSTS[id];
    return def ? S.POINTS[S.CLICKS[def.click].at] : null;
  };
  const underTip = (L, p) => { const b = L.clip || L.src; return p[0] >= Math.max(b[0], L.src[0]) && p[1] >= Math.max(b[1], L.src[1]) && p[0] <= b[0] + b[2] && p[1] <= b[1] + b[3]; };
  for (const i of info) {
    const tip = tipAt(i.t), st = meta.states[i.state];
    // hovers that may account for a hoverable under the tip: same state, tip inside their box, and either showing
    // (α > 0: the crossfade starts on the first frame inside) or a captured hover that changes no pixels
    const live = Object.entries(S.HOVERS).filter(([h, d]) => {
      const hv = meta.hover[h];
      return hv && d.state === i.state && inside(tip, hv.box) && (S.hoverAlpha(h, i.t, meta) > 0 || hv.differs === false);
    }).map(([h, d]) => ({ h, clip: S.inflate(meta.hover[h].box, d.inflate) }));
    // the plate on top under the tip: if it was captured with the real mouse inside the same rect, the hover state it
    // shows is the real one (B1/B2 frames: PASS B keeps the mouse resting on the tab it clicked)
    const top = [...i.layers].reverse().find(L => L.alpha >= 1 && underTip(L, tip));
    const real = top && mouseOf(top.img);
    for (const r of st.hoverables) {
      if (r.w <= 1 && r.h <= 1) continue;                     // the visually hidden skip link
      if (!inside(tip, r)) continue;
      if (live.some(l => contains(l.clip, r))) continue;
      if (real && inside(real, r)) { creditedReal.add(top.img.split("/")[0]); continue; }
      bad.push(`f${i.f} (${i.state}) tip ${tip.map(r2)} in ${r.what.slice(0, 40)}`);
    }
    for (const [h, d] of Object.entries(S.HOVERS)) {
      const a = S.hoverAlpha(h, i.t, meta);
      if (!(a > 0)) continue;
      let ok = false;
      for (let k = 0; k <= Math.ceil(S.HOVER_FADE * 240) && !ok; k++) ok = inside(tipAt(i.t - k / 240), meta.hover[h].box);
      if (!ok) plateBad.push(`f${i.f} ${h} α ${r2(a)} with the tip outside for > ${S.HOVER_FADE * 1000} ms`);
    }
    const hand = i.ov.cursor.hand, onPtr = (t) => meta.states[S.stateAt(t, meta)].pointers.some(r => r.w > 1 && inside(tipAt(t), r));
    if (hand > 0) {
      let ok = false;
      for (let k = 0; k <= Math.ceil(0.080 * 240) && !ok; k++) ok = onPtr(i.t - k / 240);
      if (!ok) handBad.push(`f${i.f} hand ${r2(hand)} off any pointer rect`);
    }
    if (onPtr(i.t) && hand <= 0) arrowOver.push(i.f);
  }
  check("hover honesty: the tip is inside a hoverable only where a captured hover covers it", !bad.length,
    bad.length ? bad.slice(0, 4).join("; ") : creditedReal.size ? `${[...creditedReal].join(", ")} frames show the real mouse on the clicked element` : "");
  // a burst captured with the real mouse resting on a hoverable must end exactly on its still (captured with the mouse
  // parked at PR): so the resting mouse leaves no hover styling the film's departing cursor could misattribute
  const rest = [];
  for (const [id, def] of Object.entries(S.BURSTS)) {
    const m = S.POINTS[S.CLICKS[def.click].at], st = meta.states[def.over];
    const on = st.hoverables.filter(r => r.w > 1 && inside(m, r));
    if (on.length) rest.push(`${id}: mouse on ${on.map(r => r.what.slice(0, 24)).join(" / ")}, continuity ${meta.bursts[id].continuity.exact ? "exact" : "NOT exact"}`);
    if (on.length && !meta.bursts[id].continuity.exact) bad.push(`${id} rests the mouse on a hoverable and does not end exactly on ${def.over}`);
  }
  check("hover honesty: a burst's resting mouse leaves no hover styling (its last frame ≡ the still with the mouse parked)", !rest.some(r => /NOT/.test(r)), rest.join("; "));
  check("hover honesty: a hover plate shows only while the tip is inside (or within its 150 ms fade-out)", !plateBad.length, plateBad.slice(0, 4).join("; "));
  check("pointer glyph: the hand appears only over pointer rects (or within its 80 ms crossfade)", !handBad.length, handBad.slice(0, 4).join("; "));
  check("pointer glyph: over a pointer rect the hand is (at least partly) shown", !arrowOver.length, arrowOver.length ? `arrow-only frames ${arrowOver.slice(0, 8).join(",")}` : "");
}

/* ── figures ── */
{
  const caps = S.captionTexts(meta), nums = (s) => (String(s).match(/\d+(?:\.\d+)?/g) || []);
  const bad = [], notes = [];
  for (const c of caps) {
    const mine = meta.captions.find(x => x.id === c.id);
    if (!mine || mine.headline !== c.headline || mine.sub !== c.sub || mine.eyebrow !== c.eyebrow) bad.push(`caption ${c.id} ≠ the capture's fill`);
    const st = S.stateAt(c.start + S.CAPTION_STYLE.in, meta), have = new Set(nums(meta.states[st].innerText));
    for (const n of [...nums(c.headline), ...nums(c.sub)]) if (!have.has(n)) bad.push(`caption ${c.id} "${n}" not in ${st} innerText`);
    // the states the caption lingers over (e.g. caption 2 reads on for 0.7 s while the results power on)
    const over = new Set(info.filter(i => i.cap.headline && i.cap.headline.text === c.headline && i.cap.headline.alpha > 0).map(i => i.state));
    for (const s2 of over) if (s2 !== st) { const h2 = new Set(nums(meta.states[s2].innerText)); const miss = [...nums(c.headline), ...nums(c.sub)].filter(n => !h2.has(n)); if (miss.length) notes.push(`caption ${c.id} over ${s2}: ${miss.join(",")} belong to ${st}`); }
  }
  check("figures: every caption number is in the innerText of the state it describes", !bad.length, bad.join("; ") || caps.map(c => c.headline).join(" | "));
  if (notes.length) console.log(`      note: ${notes.join("; ")}`);
}

/* ── landing: the page's hand-kept copies of the film (CHAPTERS, the screen-reader description) still match it.
   Read only: landing.js and landing.html belong to the page. ── */
{
  const PUB = path.resolve(HERE, "../../frontend/public");
  const js = fs.readFileSync(path.join(PUB, "landing.js"), "utf8"), html = fs.readFileSync(path.join(PUB, "landing.html"), "utf8");
  const m = /const CHAPTERS = (\[\[.*?\]\]);/.exec(js), ours = JSON.stringify(S.CHAPTERS);
  let theirs = null; try { theirs = m && JSON.stringify(JSON.parse(m[1])); } catch {}
  check("landing: landing.js CHAPTERS equals schedule.js CHAPTERS", theirs === ours,
    theirs ? `landing.js ${theirs}${theirs === ours ? "" : `, schedule.js ${ours}`}` : "no parsable `const CHAPTERS = [[…]];` in landing.js");
  const nums = (s) => String(s).replace(/\{mb\}/g, "").match(/\d+(?:\.\d+)?/g) || [];
  const have = new Set(Object.values(meta.states).flatMap(st => nums(st.innerText)));
  const keys = [...js.matchAll(/\n\s*(th|en):\s*\{/g)].map(k => ({ lang: k[1], at: k.index }));
  const descs = [...js.matchAll(/walkDesc:\s*"((?:[^"\\]|\\.)*)"/g)].map(d => ({ where: `landing.js walkDesc ${keys.filter(k => k.at < d.index).at(-1)?.lang ?? "?"}`, text: d[1] }));
  const fig = /<figcaption[^>]*data-i18n="walkDesc"[^>]*>([\s\S]*?)<\/figcaption>/.exec(html);
  if (fig) descs.push({ where: "landing.html figcaption", text: fig[1] });
  const langs = descs.map(d => d.where).join(", "), bad = [];
  if (!["landing.js walkDesc th", "landing.js walkDesc en", "landing.html figcaption"].every(w => descs.some(d => d.where === w))) bad.push(`expected walkDesc th + en and the figcaption, found: ${langs || "none"}`);
  for (const d of descs) { const miss = nums(d.text).filter(n => !have.has(n)); if (miss.length) bad.push(`${d.where}: ${miss.join(", ")} not in any captured innerText`); }
  check("landing: every figure in walkDesc (EN, TH) and the TH figcaption appears in the capture's innerText", !bad.length,
    bad.length ? bad.join("; ") : `${[...new Set(descs.flatMap(d => nums(d.text)))].join(" ")} in ${langs}`);
}

/* ── session + integrity ── */
{
  const bad = [];
  for (const [file, a] of Object.entries(meta.assets)) {
    const p = path.join(SES, file);
    if (!fs.existsSync(p)) { bad.push(`${file} missing`); continue; }
    const sha = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    if (sha !== a.sha256) bad.push(`${file} sha256 changed`);
    if (a.session !== meta.session) bad.push(`${file} meta session ${a.session}`);
    if (file.endsWith(".png") && readSession(p) !== meta.session) bad.push(`${file} tEXt session ${readSession(p)}`);
  }
  const used = new Set(info.flatMap(i => i.layers.map(L => L.img)));
  for (const u of used) if (!meta.assets[u]) bad.push(`${u} drawn but not a recorded asset`);
  check("session: one capture session across every asset (tEXt + meta), sha256 unchanged", !bad.length, bad.length ? bad.slice(0, 4).join("; ") : `${Object.keys(meta.assets).length} assets, ${used.size} drawn, session ${meta.session}`);
}

/* ── burst continuity (re-checked from the PNGs) ── */
const decoded = new Map();
const img = (file) => { if (!decoded.has(file)) decoded.set(file, decodePNG(path.join(SES, file))); return decoded.get(file); };
for (const [id, def] of Object.entries(S.BURSTS)) {
  const b = meta.bursts[id], last = img(b.files[b.n - 1]), still = img(`${def.over}.png`);
  const [x, y, w, h] = def.clip.map(v => v * S.DPR);
  const c = compare(last, crop(still, x, y, Math.min(w, still.width - x), Math.min(h, still.height - y)));
  const ok = !c.sizeMismatch && c.mean <= S.CONTINUITY.mean && c.p999 <= S.CONTINUITY.p999;
  check(`continuity: ${id} f${String(b.n - 1).padStart(2, "0")} ≡ ${def.over} at its clip`, ok && b.usable, c.sizeMismatch || `${c.diffPx} px differ, mean ${c.mean.toFixed(3)}, p99.9 ${c.p999}${c.diffPx ? "" : " (exact)"}`);
}

/* ── loop: one static state over 22.70–23.00 ∪ 0.00–0.60 ── */
{
  const key = (i) => JSON.stringify({ c: i.cam, l: i.layers, o: i.ov, cap: i.cap });
  const k0 = key(info[0]), hold = info.filter(i => i.t >= S.LOOP_WINDOW[1] - 1e-9 || i.t <= S.LOOP_WINDOW[0] + 1e-9);
  const diff = hold.filter(i => key(i) !== k0).map(i => i.f);
  check(`loop: frames ${hold.map(i => i.f).filter(f => f > 300)[0]}–${N - 1} and 0–${Math.round(S.LOOP_WINDOW[0] * S.FPS)} are one static state`, !diff.length, diff.length ? `differs at ${diff.join(",")}` : `${hold.length} frames, ${(hold.length / S.FPS).toFixed(2)} s of stillness across the loop point`);
}

/* ── rendered frames: seam ── */
if (!A["no-frames"]) {
  const fp = (f) => path.join(FRAMES, `f${String(f).padStart(4, "0")}.png`);
  const missing = Array.from({ length: N }, (_, f) => f).filter(f => !fs.existsSync(fp(f)));
  check(`frames: all ${N} rendered in ${path.relative(process.cwd(), FRAMES) || "."}`, !missing.length, missing.length ? `${missing.length} missing, first f${missing[0]}` : "");
  if (!missing.length) {
    const a = decodePNG(fp(N - 1)), b = decodePNG(fp(0)), c = compare(a, b);
    const bytes = Buffer.compare(fs.readFileSync(fp(N - 1)), fs.readFileSync(fp(0))) === 0;
    check(`seam: f${N - 1} ≡ f0000`, !c.sizeMismatch && c.diffPx === 0, `${c.diffPx} px differ, mean |Δ| ${c.mean.toFixed(3)}${bytes ? ", byte-identical PNGs" : ", PNG bytes differ"}`);
    const sz = pngSize(fp(0));
    check(`frames are ${S.W}x${S.H}`, sz.w === S.W && sz.h === S.H, `${sz.w}x${sz.h}`);
  }
}

/* ── plates: independent re-composite vs the compositor's own (browser) ── */
if (!A["no-plates"]) {
  const step = +(A.plates || 10);
  const pick = new Set(Array.from({ length: Math.ceil(N / step) }, (_, k) => k * step));
  for (const [, c] of Object.entries(S.CLICKS)) { const b = meta.bursts[c.burst]; for (const k of [0, 1, b.n - 1, b.n]) pick.add(c.frame + k); }
  pick.add(meta.toastCutFrame - 1); pick.add(meta.toastCutFrame);
  for (const h of Object.keys(S.HOVERS)) { const e = meta.hoverEntries?.[h]; if (e) for (const d of [0, 2, 5]) pick.add(Math.ceil(e.enter * S.FPS) + d); }
  for (const f of [Math.round(S.RESET.t[0] * S.FPS) + 3, Math.round(S.RESET.t[1] * S.FPS) - 2]) pick.add(f);
  for (const t of S.RESET.t) { const c = Math.ceil(t * S.FPS - 1e-9); pick.add(c - 1); pick.add(c); }   // both sides of the reset (a cut: f666 | f667)
  const frames = [...pick].filter(f => f >= 0 && f < N).sort((a, b) => a - b);
  const { srv, port } = serve(HERE, { "/fonts/": FONTS, "/capture/": SES });
  const browser = await launch(), page = await browser.newPage({ viewport: { width: S.W, height: S.H } });
  await page.goto(`http://127.0.0.1:${port()}/index.html`);
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 120000 });
  const bad = []; let blended = 0, maxBlend = 0;
  for (const f of frames) {
    const i = info[f], X0 = Math.floor(i.cam.x0 * S.DPR), Y0 = Math.floor(i.cam.y0 * S.DPR);
    const X1 = Math.ceil((i.cam.x0 + i.cam.w) * S.DPR), Y1 = Math.ceil((i.cam.y0 + i.cam.h) * S.DPR);
    const url = await page.evaluate(([t, r]) => window.__composite(t, r), [i.t, [X0 / S.DPR, Y0 / S.DPR, (X1 - X0) / S.DPR, (Y1 - Y0) / S.DPR]]);
    const got = decodePNG(Buffer.from(url.split(",")[1], "base64"));
    // expected, composed here from the PNGs: ink, then each layer 1:1 inside src ∩ clip (snapped outward)
    const W = X1 - X0, H = Y1 - Y0, exp = new Float32Array(W * H * 3), A2 = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) { exp[p * 3] = 11; exp[p * 3 + 1] = 18; exp[p * 3 + 2] = 32; }
    for (const L of i.layers) {
      if (!(L.alpha > 0)) continue;
      const im = img(L.img), sx = Math.round(L.src[0] * S.DPR), sy = Math.round(L.src[1] * S.DPR);
      let x0 = Math.max(sx, X0), y0 = Math.max(sy, Y0), x1 = Math.min(sx + im.width, X1), y1 = Math.min(sy + im.height, Y1);
      if (L.clip) { x0 = Math.max(x0, Math.floor(L.clip[0] * S.DPR)); y0 = Math.max(y0, Math.floor(L.clip[1] * S.DPR)); x1 = Math.min(x1, Math.ceil((L.clip[0] + L.clip[2]) * S.DPR)); y1 = Math.min(y1, Math.ceil((L.clip[1] + L.clip[3]) * S.DPR)); }
      const a = Math.min(1, Math.round(L.alpha * 255) / 255);   // canvas globalAlpha is 8-bit
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = ((y - Y0) * W + (x - X0)), s = ((y - sy) * im.width + (x - sx)) * 4;
        for (let ch = 0; ch < 3; ch++) exp[o * 3 + ch] = a >= 1 ? im.data[s + ch] : exp[o * 3 + ch] * (1 - a) + im.data[s + ch] * a;
        if (a < 1) A2[o] = 1;
      }
    }
    let diff = 0, max = 0;
    for (let p = 0; p < W * H; p++) for (let ch = 0; ch < 3; ch++) {
      const d = Math.abs(got.data[p * 4 + ch] - exp[p * 3 + ch]);
      if (A2[p]) { blended++; maxBlend = Math.max(maxBlend, d); if (d > 2.01) { diff++; max = Math.max(max, d); } }   // 8-bit premultiplied blend rounding
      else if (d > 0) { diff++; max = Math.max(max, d); }
    }
    if (diff) bad.push(`f${f} ${diff} channel values differ (max ${r2(max)}) [${i.layers.map(L => L.img + "@" + r2(L.alpha)).join(" + ")}]`);
    for (const L of i.layers) if (L.img.startsWith("B")) decoded.delete(L.img);   // burst frames are used once
  }
  await browser.close(); srv.close();
  check(`plates: the compositor's plate composite equals an independent re-composite (${frames.length} frames)`, !bad.length,
    bad.length ? bad.slice(0, 3).join("; ") : `exact copies of captured pixels; cross-faded pixels within ±2 of the exact blend (max ${r2(maxBlend)})`);
}

/* ── purity: renderAt(t) depends on t alone. Re-render a shuffled sample in one fresh page, interleaved with plate
   composites over other frames, and compare with the full render pixel for pixel. ── */
if (!A["no-frames"] && !A["no-purity"] && fs.existsSync(path.join(FRAMES, "f0000.png"))) {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const sample = [0, N - 1, S.CLICKS.card.frame, meta.toastCutFrame, S.CLICKS.quality.frame + 29, S.CLICKS.charts.frame + 5];
  while (sample.length < +(A.purity || 24)) sample.push(Math.floor(rnd() * N));
  sample.sort(() => rnd() - 0.5);
  const { srv, port } = serve(HERE, { "/fonts/": FONTS, "/capture/": SES });
  const browser = await launch(), page = await browser.newPage({ viewport: { width: S.W, height: S.H }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port()}/index.html`);
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 120000 });
  const bad = [];
  for (const f of sample) {
    const g = Math.floor(rnd() * N), gi = info[g];   // disturb the page with another frame's composite first
    await page.evaluate(([t, r]) => window.__composite(t, r), [gi.t, [Math.floor(gi.cam.x0), Math.floor(gi.cam.y0), Math.ceil(gi.cam.w), Math.ceil(gi.cam.h)]]);
    await page.evaluate(t => window.renderAt(t), T(f));
    const shot = decodePNG(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: S.W, height: S.H } }));
    const c = compare(shot, decodePNG(path.join(FRAMES, `f${String(f).padStart(4, "0")}.png`)));
    if (c.sizeMismatch || c.diffPx) bad.push(`f${f} after f${g}: ${c.sizeMismatch || c.diffPx + " px"}`);
  }
  await browser.close(); srv.close();
  check(`purity: ${sample.length} frames re-rendered out of order equal the full render`, !bad.length, bad.slice(0, 4).join("; "));
}

const fails = results.filter(r => !r.ok);
console.log(fails.length ? `GATE FAIL: ${fails.length} of ${results.length} checks failed` : `GATE OK — ${results.length} checks, session ${meta.session}`);
if (fails.length) process.exitCode = 1;

// node capture.mjs — two-pass capture of the REAL app for the walkthrough film. Writes capture/<session>/.
//   PASS A (truth):  real clock, nothing faked or intercepted. Every still and every figure comes from here.
//   PASS B (motion): Playwright's fake clock + stepped document.getAnimations(), replaying PASS A's recorded
//                    analysis response at PASS A's measured PERCEIVED span → three real bursts B0/B1/B2, each
//                    gated to end on PASS A's exact pixels.
// Exits non-zero (and prints CAPTURE FAILED) if any locality / consistency check fails; a burst that misses its
// continuity gate is kept but marked unusable (meta.bursts.<id>.usable = false) so the film falls back.
// Env: CHROMIUM=/path/to/chrome (required unless playwright's own browsers are installed).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { HERE, ROOT, PORT, assertDistFresh, startServer, launchBrowser, newSessionContext } from "./app.mjs";
import { measureState } from "./measure.js";
import { decodePNG, encodePNG, padTo, crop, compare } from "./png.mjs";
import * as S from "./schedule.js";

const T00 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T00) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const checks = [];
const check = (name, ok, detail = {}) => { checks.push({ name, ok: !!ok, ...detail }); log(`${ok ? "ok  " : "FAIL"} ${name}${detail.note ? " — " + detail.note : ""}`); return ok; };

/* ── session ── */
const dist = assertDistFresh();
const session = crypto.randomUUID();
const DIR = path.join(HERE, "capture", session);
fs.mkdirSync(DIR, { recursive: true });
for (const b of Object.keys(S.BURSTS)) fs.mkdirSync(path.join(DIR, b), { recursive: true });
log(`session ${session} → ${path.relative(ROOT, DIR)}`);

/* Every PNG carries the session id in a tEXt chunk (keyword "dab-walk-session"), so a plate can never be mixed
   into another run's film unnoticed. */
function tagPNG(buf) {
  const kw = Buffer.from("dab-walk-session\0" + session, "latin1");
  const chunk = Buffer.alloc(12 + kw.length);
  chunk.writeUInt32BE(kw.length, 0); chunk.write("tEXt", 4, "latin1"); kw.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + kw.length)), 8 + kw.length);
  const ihdrEnd = 8 + 12 + buf.readUInt32BE(8);
  return Buffer.concat([buf.subarray(0, ihdrEnd), chunk, buf.subarray(ihdrEnd)]);
}
const assets = {};
function writeAsset(rel, buf, extra = {}) {
  const out = rel.endsWith(".png") ? tagPNG(buf) : buf;
  fs.writeFileSync(path.join(DIR, rel), out);
  assets[rel] = { sha256: sha256(out), bytes: out.length, session, ...extra };
  return out;
}

const meta = {
  session, createdAt: new Date().toISOString(), tool: "tools/walkthrough/capture.mjs",
  app: { distBuiltAt: dist.distBuiltAt, commit: (() => { try { return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"]).toString().trim(); } catch { return null; } })() },
  capture: { viewport: S.VIEWPORT, dpr: S.DPR, colorScheme: "dark", reducedMotion: "no-preference", localStorage: { dab_landing_lang: "en", dab_tour_done: "1" }, port: PORT },
  points: S.POINTS,
};

/* ──────────────────────────── helpers ──────────────────────────── */

const clipOf = ([x, y, w, h]) => ({ x, y, width: w, height: h });
async function shoot(page, name, opts) {
  const buf = await page.screenshot({ fullPage: true, type: "png", ...(opts.clip ? { clip: clipOf(opts.clip) } : {}) });
  const img = decodePNG(buf);
  writeAsset(`${name}.png`, buf, { w: img.width, h: img.height, ...(opts.clip ? { clip: opts.clip } : { full: true }) });
  return img;
}
/** Move the real mouse along a schedule path, at the film's pace. */
async function glide(page, name, { pace = true } = {}) {
  const steps = S.mouseSteps(name, 40), dur = (S.PATHS[name].t[1] - S.PATHS[name].t[0]) * 1000;
  for (const s of steps) { await page.mouse.move(s.pt[0], s.pt[1]); if (pace) await sleep(dur / 40); }
}
/** Poll a page predicate in REAL time (never through the page's own, possibly faked, timers). */
async function until(page, fn, arg, { timeout = 15000, every = 10, what = "condition" } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}
const D = S.DPR;
const dev = ([x, y, w, h]) => [x * D, y * D, w * D, h * D];
const insideDev = (r) => (x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const outsideDev = (r) => { const f = insideDev(r); return (x, y) => !f(x, y); };
const fmtCmp = (c) => c.sizeMismatch ? `size ${c.sizeMismatch}` : `${c.diffPx} px differ, mean ${c.mean.toFixed(3)}, p99.9 ${c.p999}, max ${c.max}${c.bbox ? `, bbox css ${JSON.stringify(cssBox(c.bbox))}` : ""}`;
const cssBox = (b) => ({ x: b.x / D, y: b.y / D, w: b.w / D, h: b.h / D });

/* ──────────────────────────── PASS A — truth ──────────────────────────── */
async function passA() {
  log("PASS A (truth): real clock, nothing faked or intercepted");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const stills = meta.stills = {}, states = meta.states = {};
  const imgs = {};
  const still = async (name, mouse) => {
    const def = S.STILLS[name];
    imgs[name] = await shoot(page, name, def.full ? {} : { clip: def.clip });
    stills[name] = { file: `${name}.png`, ...(def.full ? { full: true } : { clip: def.clip }), w: imgs[name].width, h: imgs[name].height, mouse, desc: def.desc, ...(def.state ? { state: def.state } : {}) };
    log(`  ${name}.png ${imgs[name].width}x${imgs[name].height}`);
  };
  const measure = async (name) => { states[name] = await page.evaluate(measureState); return states[name]; };
  const P = S.POINTS;

  await page.goto(server.BASE + "/", { waitUntil: "load" });
  await page.getByRole("button", { name: /ยอดขายร้านโชห่วย/ }).waitFor({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  meta.idleAnimations = await page.evaluate(() => document.getAnimations().map(a => `${a.constructor.name} ${a.animationName || a.transitionProperty || ""} on ${a.effect?.target?.className || a.effect?.target?.tagName}`));
  await sleep(800);

  // A1 — empty state, mouse parked at P
  await page.mouse.move(...P.P);
  await sleep(300);
  await still("L01", P.P);
  await measure("L01");
  meta.sample = { title: states.L01.strings.sampleTitle, meta: states.L01.strings.sampleMeta };

  // A2 — dropzone hover
  await glide(page, "toDrop");
  await sleep(400);
  await still("H1", P.D);

  // A3 — sample card hover, press, real tap
  await glide(page, "toCard");
  await sleep(400);
  await still("L02", P.C);
  await page.mouse.down();
  await sleep(200);
  await still("L02-down", P.C);
  await page.evaluate(() => {   // passive observers only: when did the click / commit / toast happen (real clock)
    const W = window.__walkA = { click: null, commit: null, toastOn: null, toastOff: null };
    addEventListener("click", () => { W.click = performance.now(); }, { capture: true, once: true });
    new MutationObserver(() => {
      const now = performance.now();
      if (W.commit === null && document.querySelector('div[class*="md:grid-cols-6"]')) W.commit = now;
      const n = document.querySelector('[role="status"][aria-live="polite"]')?.children.length || 0;
      if (n && W.toastOn === null) W.toastOn = now;
      if (!n && W.toastOn !== null && W.toastOff === null) W.toastOff = now;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const respP = page.waitForResponse(r => /\/api\/demo\/samples\/[^/]+\/analysis$/.test(new URL(r.url()).pathname), { timeout: 15000 });
  await page.mouse.up();
  const resp = await respP;
  const body = await resp.body();
  const data = JSON.parse(body.toString("utf8"));
  writeAsset("response.json", body);
  meta.response = { file: "response.json", url: new URL(resp.url()).pathname, status: resp.status(), contentType: resp.headers()["content-type"], sha256: sha256(body), bytes: body.length };
  meta.sample.id = meta.response.url.split("/")[4];
  meta.serverMs = data.durationMs;
  log(`  response ${meta.response.url} ${body.length} B sha256 ${meta.response.sha256.slice(0, 12)}… durationMs ${data.durationMs}`);

  // A4 — results with the toast showing
  await page.getByText("บันทึกข้างเล่ม · Insights").waitFor({ timeout: 15000 });
  await sleep(1000);
  await still("L03", P.C);
  const L03 = await measure("L03");
  meta.perceivedMs = await page.evaluate(() => window.__DAB_PERF__?.spans?.demo?.ms);
  const ro = Object.fromEntries(L03.strings.readout || []);
  check("A4 PERCEIVED cell = __DAB_PERF__.spans.demo.ms", ro.PERCEIVED === `${meta.perceivedMs} ms`, { note: `cell "${ro.PERCEIVED}", span ${meta.perceivedMs}` });
  check("A4 SERVER cell = response durationMs", ro.SERVER === `${meta.serverMs} ms`, { note: `cell "${ro.SERVER}", durationMs ${meta.serverMs}` });
  const toastWant = `ตรวจเสร็จใน ${meta.serverMs} ms — สถิติล้วน ไม่ใช้ AI ⚡`;
  check("A4 toast = 'ตรวจเสร็จใน <serverMs> ms — …'", L03.strings.toast === toastWant, { note: `"${L03.strings.toast}"` });
  log(`  serverMs ${meta.serverMs}  perceivedMs ${meta.perceivedMs}`);

  // A5 — the toast's 3.5 s hard cut, then park at PR along the gap
  await until(page, () => !(document.querySelector('[role="status"][aria-live="polite"]')?.children.length), null, { what: "toast to leave", timeout: 8000 });
  await sleep(300);
  await glide(page, "cardToPark");
  await sleep(300);
  await still("L03b", P.PR);
  await measure("L03b");
  meta.timingA = await page.evaluate(() => window.__walkA);
  const tA = meta.timingA;
  meta.timingA.clickToCommitMs = +(tA.commit - tA.click).toFixed(1);
  meta.timingA.toastShownMs = +(tA.toastOff - tA.toastOn).toFixed(1);

  // A6 — QUALITY: hover, press, click, settle, park
  await glide(page, "toQuality");
  await sleep(400);
  await still("H3", P.Q);
  await page.mouse.down();
  await sleep(200);
  await still("H3-down", P.Q);
  await page.mouse.up();
  await sleep(2500);
  await glide(page, "qualityOut");
  await sleep(400);
  await still("L04q", P.PR);
  await measure("L04q");

  // A7 — CHARTS (cold lazy chunk): hover, press, click, settle, park. Passive timing of the chunk and the mount.
  await glide(page, "toCharts");
  await sleep(400);
  await still("H4", P.K);
  await page.mouse.down();
  await sleep(200);
  await still("H4-down", P.K);
  await page.evaluate(() => {
    const W = window.__walkK = { click: null, fallback: null, surface: null, bars: null };
    addEventListener("click", () => { W.click = performance.now(); }, { capture: true, once: true });
    new MutationObserver(() => {
      const now = performance.now();
      if (W.fallback === null && document.querySelector('[role="tabpanel"] [aria-busy="true"], .anim-tab [aria-busy="true"]')) W.fallback = now;
      if (W.surface === null && document.querySelector(".recharts-surface")) W.surface = now;
      if (W.bars === null && document.querySelector(".recharts-bar-rectangle path")) W.bars = now;
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  await page.mouse.up();
  await sleep(2500);
  await glide(page, "chartsOut");
  await sleep(400);
  await still("L04c", P.PR);
  await measure("L04c");
  const k = await page.evaluate(() => {
    const W = window.__walkK;
    const res = performance.getEntriesByType("resource").filter(e => e.startTime >= W.click - 1)
      .map(e => ({ path: new URL(e.name).pathname, type: e.initiatorType, startMs: +(e.startTime - W.click).toFixed(1), responseEndMs: +(e.responseEnd - W.click).toFixed(1) }));
    return { ...W, resources: res };
  });
  meta.chartsA = { fallbackMs: k.fallback === null ? null : +(k.fallback - k.click).toFixed(1), surfaceMs: +(k.surface - k.click).toFixed(1), barsMs: +(k.bars - k.click).toFixed(1), resources: k.resources };
  log(`  charts (real): surface at +${meta.chartsA.surfaceMs} ms, bars at +${meta.chartsA.barsMs} ms; chunk requests ${k.resources.map(r => `${r.path}@${r.responseEndMs}`).join(", ") || "none"}`);
  meta.errorsA = errors;
  await page.close();

  // ── strings the captions need (from the states they are read in) ──
  const L01 = states.L01.strings, L03b = states.L03b.strings, L04q = states.L04q.strings, L04c = states.L04c.strings;
  meta.strings = {
    fileMeta: L01.fileMeta, fileTitle: L01.fileTitle, sampleTitle: L01.sampleTitle, sampleMeta: L01.sampleMeta,
    readout: L03.strings.readout, toast: L03.strings.toast,
    insightsMeta: L03b.insightsMeta, findings: L03b.findings, finding1Title: L03b.finding1Title, finding1Badge: L03b.finding1Badge,
    stamp: L04q.stamp, qualityLabel: L04q.qualityLabel, subscores: L04q.subscores, subscoreLabels: L04q.subscoreLabels,
    legend: L04c.legend, chartType: L04c.chartType, firstChip: L04c.firstChip, chips: L04c.chips,
    xKey: data.autoCharts?.[0]?.xAxis ?? null,
  };
  meta.toastCutFrame = S.toastCutFrame(meta.perceivedMs);

  // ── A9 locality checks (any failure fails the capture) ──
  const above = S.IDENTICAL_ABOVE_Y * D;
  for (const [a, b] of [["L01", "L02"], ["L01", "L03"], ["L02", "L03"]]) {
    const c = compare(imgs[a], imgs[b], { sameSize: false, maxY: above });
    check(`A9 ${a} ≡ ${b} above y ${S.IDENTICAL_ABOVE_Y}`, c.diffPx === 0, { note: fmtCmp(c) });
  }
  {
    const c = compare(imgs.L01, imgs.L02, { include: outsideDev(dev(S.STILLS["L02-down"].clip)) });
    check("A9 L01 ≡ L02 outside the card clip", !c.sizeMismatch && c.diffPx === 0, { note: fmtCmp(c) });
  }
  for (const [a, b, burst] of [["L03b", "L04q", "B1"], ["L04q", "L04c", "B2"]]) {
    const c = compare(imgs[a], imgs[b], { include: outsideDev(dev(S.BURSTS[burst].clip)) });
    check(`A9 ${a} ≡ ${b} outside the ${burst} clip`, !c.sizeMismatch && c.diffPx === 0, { note: fmtCmp(c) });
  }
  {   // the toast cut is a whole-plate swap: L03 → L03b may differ only where the toast was
    const tb = states.L03.boxes.toast, pad = 24;
    const r = dev([tb.x - pad, tb.y - pad, tb.w + 2 * pad, tb.h + 2 * pad]);
    const c = compare(imgs.L03, imgs.L03b, { include: outsideDev(r) });
    check("A9 L03 ≡ L03b outside the toast (+24 px)", !c.sizeMismatch && c.diffPx === 0, { note: fmtCmp(c) });
    const t = compare(imgs.L03, imgs.L03b, { include: insideDev(r) });
    check("A9 the toast is the L03 → L03b change", t.diffPx > 0, { note: fmtCmp(t) });
  }
  {   // the loop reset dissolves L04c → L01 below y 380 only
    const c = compare(imgs.L01, imgs.L04c, { sameSize: false, maxY: above });
    check(`A9 L01 ≡ L04c above y ${S.IDENTICAL_ABOVE_Y}`, c.diffPx === 0, { note: fmtCmp(c) });
  }
  {   // B0's clip must hold every change of the power-on: L03 vs L01 outside it (the toast is inside it)
    const c = compare(imgs.L01, imgs.L03, { sameSize: false, include: outsideDev(dev(S.BURSTS.B0.clip)), maxY: imgs.L01.height });
    check("A9 L01 ≡ L03 outside the B0 clip (within L01's height)", c.diffPx === 0, { note: fmtCmp(c) });
  }

  // ── hover plates: real (they differ from their state) and confined to the inflated box the film crossfades in ──
  meta.hover = {};
  for (const [h, def] of Object.entries(S.HOVERS)) {
    const st = states[def.state], box = st.boxes[def.box];
    if (!check(`hover ${h}: box "${def.box}" measured in ${def.state}`, !!box)) continue;
    const plateName = h, plateClip = S.STILLS[h].clip;   // L02 is full-page
    const base = imgs[def.state];
    const plate = imgs[plateName];
    const region = plateClip ? dev(plateClip) : [0, 0, base.width, base.height];
    const baseCrop = crop(base, ...region);
    const inf = S.inflate(box, def.inflate);
    const infDev = [inf.x * D - region[0], inf.y * D - region[1], inf.w * D, inf.h * D];
    const all = compare(baseCrop, plate);
    const out = compare(baseCrop, plate, { include: outsideDev(infDev) });
    meta.hover[h] = { state: def.state, box, inflate: def.inflate, differs: all.diffPx > 0, diffBoxCss: all.bbox && cssBox({ ...all.bbox, x: all.bbox.x + region[0], y: all.bbox.y + region[1] }) };
    // reported, not fatal: an identical plate is harmless (its crossfade is a no-op), but the film must not claim it
    if (all.diffPx > 0) check(`hover ${h} is a real change of ${def.state}`, true, { note: fmtCmp(all) });
    else checks.push({ name: `hover ${h} shows NO visible change in ${def.state} (reported; meta.hover.${h}.differs = false)`, ok: true, warn: true }), log(`WARN hover ${h}: the real ${def.box} hover changes no pixels in ${def.state}`);
    check(`hover ${h} confined to ${def.box} + ${def.inflate} px`, out.diffPx === 0, { note: fmtCmp(out) });
    if (def.press) {
      const down = imgs[def.press], dClip = S.STILLS[def.press].clip;
      let hoverCrop;
      if (!plateClip) hoverCrop = crop(plate, ...dev(dClip));
      else if (dClip.join() === plateClip.join()) hoverCrop = plate;
      else throw new Error(`press plate ${def.press} must share ${h}'s clip`);
      const pc = compare(hoverCrop, down);
      meta.hover[h].press = { plate: def.press, differs: pc.diffPx > 0, note: fmtCmp(pc) };
      log(`  ${def.press} ${pc.diffPx > 0 ? "differs from" : "is identical to"} ${h} (${fmtCmp(pc)})`);
    }
  }
  // the burst clips are inside the full-page plates
  for (const [b, def] of Object.entries(S.BURSTS)) {
    const im = imgs[def.over], [x, y, w, h] = dev(def.clip);
    check(`${b} clip inside ${def.over} (${im.width}x${im.height})`, x + w <= im.width && y + h <= im.height);
  }
  meta._imgsA = imgs;   // dropped before writing
}

/* ──────────────────────────── PASS B — motion ──────────────────────────── */
async function passB() {
  log("PASS B (motion): fake clock, replaying PASS A's response at PASS A's PERCEIVED span");
  const imgs = meta._imgsA; delete meta._imgsA;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const body = fs.readFileSync(path.join(DIR, "response.json"));
  await page.clock.install();                                   // the app boots on a naturally flowing fake clock

  let pendingAnalysis = null, analysisSeen;
  const analysisP = new Promise(r => { analysisSeen = r; });
  await page.route("**/api/demo/samples/*/analysis", (route) => { pendingAnalysis = route; analysisSeen(); });

  await page.goto(server.BASE + "/", { waitUntil: "load" });
  await until(page, () => !!document.querySelector('[data-tour="upload"]') && [...document.querySelectorAll("button")].some(b => /ยอดขายร้านโชห่วย/.test(b.innerText)), null, { what: "sample cards" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);
  await page.mouse.move(...S.POINTS.P);
  await glide(page, "toDrop");
  await glide(page, "toCard");
  await sleep(400);                                             // the card hover settles in real time

  // in-page burst driver: every animation is paused when first seen and stamped with the fake time of its birth;
  // each output frame sets currentTime = frame time − birth.
  await page.evaluate(() => {
    window.__wb = {
      reg: new Map(), pre: new Set(document.getAnimations()),
      register() {
        const now = performance.now(); let n = 0;
        for (const a of document.getAnimations()) { if (this.pre.has(a) || this.reg.has(a)) continue; a.pause(); this.reg.set(a, now); n++; }
        return n;
      },
      seek() {
        const now = performance.now(), live = new Set(document.getAnimations()); let n = 0;
        for (const [a, b] of this.reg) if (live.has(a)) { a.currentTime = Math.max(0, now - b); n++; }
        return n;
      },
      arm() { this.reg.clear(); this.pre = new Set(document.getAnimations()); return this.pre.size; },
      finish() {
        const live = new Set(document.getAnimations()); let n = 0;
        for (const [a] of this.reg) if (live.has(a)) { try { a.finish(); } catch { a.play(); } n++; }
        this.reg.clear(); this.pre = new Set(document.getAnimations()); return n;
      },
      describe() { return [...this.reg].map(([a, b]) => ({ kind: a.constructor.name, name: a.animationName || a.transitionProperty, birth: b, target: (a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? "").toString().slice(0, 60) })); },
    };
  });
  const flushRegister = () => page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    return window.__wb.register();
  });
  const fakeNow = () => page.evaluate(() => performance.now());

  meta.bursts = {};
  /**
   * Drive one burst. clickAtFake: performance.now() at the click. extra: sorted list of { ms, fn } events
   * (relative to the click) that must land exactly on a sub-step boundary. frame k samples click + (k+.5)/30 s.
   */
  async function burst(id, { perFrame, extra = [], nFor }) {
    const def = S.BURSTS[id];
    const t0 = await fakeNow();
    await flushRegister();
    const rec = meta.bursts[id] = { click: def.click, clip: def.clip, over: def.over, clickFake: t0, files: [], sampleMs: [], frames: [] };
    let cur = 0, k = 0;
    const nMax = def.nMax || def.n;
    const evs = [...extra];
    const advance = async (to) => {   // ≤ 8 ms sub-steps; new animations are registered at every one
      const gap = to - cur; if (gap <= 0) return;
      const n = Math.ceil(gap / 8);
      let at = cur;
      for (let i = 1; i <= n; i++) {
        const b = cur + Math.round(gap * i / n);
        if (b > at) { await page.clock.runFor(b - at); at = b; }
        await flushRegister();
      }
      cur = to;
    };
    for (;;) {
      const sample = Math.round((k + 0.5) * 1000 / S.FPS);
      while (evs.length && evs[0].ms <= sample) { const ev = evs.shift(); await advance(ev.ms); await ev.fn(); await flushRegister(); }
      await advance(sample);
      const drift = (await fakeNow()) - t0 - sample;
      if (Math.abs(drift) > 0.5) throw new Error(`${id}: fake clock drifted ${drift} ms at frame ${k}`);
      await page.evaluate(() => window.__wb.seek());
      const name = `${id}/f${String(k).padStart(2, "0")}.png`;
      let buf = await page.screenshot({ fullPage: true, type: "png", clip: clipOf(def.clip) });
      const info = perFrame ? await perFrame(k, sample) : {};
      // a transient state can make the document shorter than the clip (B0's loading frame: 1058 px); Playwright then
      // trims the shot. Pad it with the canvas colour the browser itself paints past the document end.
      const shot = decodePNG(buf), [cw, ch] = [def.clip[2] * D, def.clip[3] * D];
      if (shot.width !== cw || shot.height !== ch) {
        if (shot.width > cw || shot.height > ch) throw new Error(`${id} f${k}: shot ${shot.width}x${shot.height} exceeds clip`);
        const rgb = await page.evaluate(() => {
          const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
          const root = parse(getComputedStyle(document.documentElement).backgroundColor);
          return (root.length === 4 && root[3] === 0) || !root.length ? parse(getComputedStyle(document.body).backgroundColor).slice(0, 3) : root.slice(0, 3);
        });
        buf = encodePNG(padTo(shot, cw, ch, rgb));
        info.padded = { rows: (ch - shot.height) / D, rgb };
        log(`  ${id} f${k}: document shorter than the clip — padded ${info.padded.rows} css rows with the canvas colour rgb(${rgb})`);
      }
      writeAsset(name, buf, { burst: id, k, sampleMs: sample });
      rec.files.push(name); rec.sampleMs.push(sample);
      rec.frames.push(info);
      // pixel proof that the clip holds every change: at frame 0, mid, the planned last frame, and any frame that
      // samples a transient state, a full-page shot must equal the PASS A still outside the clip. When the document
      // height differs, the proof covers what the film's camera shows at that frame, which must exist in both.
      if (k === 0 || k === (def.n >> 1) || k === def.n - 1 || info.transient) {
        const full = decodePNG(await page.screenshot({ fullPage: true, type: "png" }));
        const tag = `${id} f${String(k).padStart(2, "0")}`;
        let c;
        if (full.width === imgs[def.over].width && full.height === imgs[def.over].height) {
          c = compare(imgs[def.over], full, { include: outsideDev(dev(def.clip)) });
          check(`${tag} ≡ ${def.over} outside the clip (full-page proof)`, c.diffPx === 0, { note: fmtCmp(c) });
        } else {
          const cam = S.camera((S.CLICKS[def.click].frame + k) / S.FPS), camDev = dev([cam.x0, cam.y0, cam.w, cam.h]);
          const inCam = insideDev(camDev), outClip = outsideDev(dev(def.clip));
          c = compare(imgs[def.over], full, { sameSize: false, include: (x, y) => inCam(x, y) && outClip(x, y) });
          const shortH = Math.min(full.height, imgs[def.over].height) / D, clipBottom = def.clip[1] + def.clip[3];
          const covered = cam.y0 + cam.h <= shortH || (cam.y0 + cam.h <= clipBottom && def.clip[1] <= shortH);
          check(`${tag} ≡ ${def.over} outside the clip within the camera (document ${full.height / D} vs ${imgs[def.over].height / D} css px)`, c.diffPx === 0 && covered,
            { note: `${fmtCmp(c)}; camera y ${cam.y0.toFixed(0)}–${(cam.y0 + cam.h).toFixed(0)}` });
        }
        (rec.outsideProof ||= {})[k] = c.diffPx;
      }
      k++;
      if (k >= (nFor ? nFor(k, rec) : def.n) || k >= nMax) break;
    }
    rec.n = k;
    rec.animations = await page.evaluate(() => window.__wb.describe().map(d => ({ ...d, birth: d.birth })));
    rec.animations.forEach(a => { a.birthMs = +(a.birth - t0).toFixed(2); delete a.birth; });
    rec.finished = await page.evaluate(() => window.__wb.finish());
    // continuity gate: the last frame vs the PASS A still cropped to the same clip
    const last = decodePNG(path.join(DIR, rec.files.at(-1)));
    const truth = crop(imgs[def.over], ...dev(def.clip));
    const c = compare(truth, last);
    rec.continuity = { vs: def.over, exact: c.diffPx === 0, mean: +c.mean.toFixed(4), p999: c.p999, max: c.max, diffPx: c.diffPx, bboxCss: c.bbox && cssBox({ ...c.bbox, x: c.bbox.x + def.clip[0] * D, y: c.bbox.y + def.clip[1] * D }) };
    rec.usable = !c.sizeMismatch && c.mean <= S.CONTINUITY.mean && c.p999 <= S.CONTINUITY.p999;
    log(`  ${id}: ${k} frames, continuity vs ${def.over}: ${fmtCmp(c)} → ${rec.usable ? "usable" : "UNUSABLE (film falls back to a 150 ms dissolve)"}`);
    if (!rec.usable) checks.push({ name: `${id} continuity (reported; burst marked unusable)`, ok: true, warn: true, note: fmtCmp(c) });
    return rec;
  }

  // ── B0: the results power on ──
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
  meta.preAnimationsB = await page.evaluate(() => window.__wb.arm());
  await page.mouse.down();
  await page.mouse.up();
  await Promise.race([analysisP, sleep(10000)]);
  if (!pendingAnalysis) throw new Error("B0: the analysis request never reached the route");
  const loadingProbe = () => page.evaluate(() => ({
    loading: !!document.querySelector('[aria-busy="true"][aria-label]') || /กำลังตรวจสอบ/.test(document.querySelector('[data-tour="prompt"]')?.innerText || ""),
    results: !!document.querySelector('div[class*="md:grid-cols-6"]'),
    toast: document.querySelector('[role="status"][aria-live="polite"]')?.innerText.trim() || null,
  }));
  const b0 = await burst("B0", {
    extra: [{ ms: meta.perceivedMs, fn: async () => {
      await pendingAnalysis.fulfill({ status: 200, contentType: meta.response.contentType || "application/json", body });
      await until(page, () => !!document.querySelector('div[class*="md:grid-cols-6"]'), null, { what: "B0 results commit", every: 2 });
    } }],
    perFrame: async () => { const p = await loadingProbe(); return { ...p, transient: p.loading }; },
  });
  b0.perceivedMs = meta.perceivedMs;
  const loadingFrames = b0.frames.map((f, i) => f.loading ? i : -1).filter(i => i >= 0);
  b0.loadingFrames = loadingFrames;   // real: PERCEIVED ≥ the first sample time; proven inside the clip above
  log(`  B0 samples the loading state in ${loadingFrames.length ? "frames " + loadingFrames.join(",") : "no frame"} (PERCEIVED ${meta.perceivedMs} ms, first sample ${b0.sampleMs[0]} ms)`);
  const roB = await page.evaluate(() => [...document.querySelector('div[class*="md:grid-cols-6"]').children].map(c => [c.querySelector(".eyebrow").innerText.trim(), c.querySelector(".num").innerText.trim()]));
  const roBm = Object.fromEntries(roB);
  meta.perceivedMsB = await page.evaluate(() => window.__DAB_PERF__?.spans?.demo?.ms);
  check("B0 PERCEIVED (app-computed on the fake clock) = PASS A", meta.perceivedMsB === meta.perceivedMs && roBm.PERCEIVED === `${meta.perceivedMs} ms`, { note: `span ${meta.perceivedMsB}, cell "${roBm.PERCEIVED}"` });
  check("B0 SERVER cell = PASS A durationMs", roBm.SERVER === `${meta.serverMs} ms`, { note: `cell "${roBm.SERVER}"` });

  // ── B1: QUALITY mounts ──
  await page.clock.runFor(4000);                                // the toast clears on schedule
  await flushRegister(); await page.evaluate(() => window.__wb.finish());
  const toastLeft = await page.evaluate(() => !(document.querySelector('[role="status"][aria-live="polite"]')?.children.length));
  check("B1 toast cleared after runFor(4000)", toastLeft);
  await glide(page, "cardToPark");
  await glide(page, "toQuality");
  await sleep(400);
  await page.evaluate(() => window.__wb.arm());
  await page.mouse.down();
  await page.mouse.up();
  await burst("B1", {});

  // ── B2: CHARTS mounts cold. The lazy chunk requests are held until PASS A's measured mount offset. ──
  const chunkPaths = new Set(meta.chartsA.resources.filter(r => /\.js$/.test(r.path)).map(r => r.path));
  const held = [];
  await page.route("**/assets/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (chunkPaths.has(p)) held.push(route); else route.fallback();
  });
  await glide(page, "qualityOut");
  await glide(page, "toCharts");
  await sleep(400);
  const releaseMs = Math.max(1, Math.round(meta.chartsA.surfaceMs));
  const finalBars = meta.states.L04c.strings.bars || [];
  if (!finalBars.length) throw new Error("PASS A measured no chart bars in L04c");
  const barProbe = () => page.evaluate(() => ({
    fallback: !!document.querySelector('.anim-tab [aria-busy="true"]'),
    surface: !!document.querySelector(".recharts-surface"),
    bars: [...document.querySelectorAll(".recharts-bar-rectangle path")].map(p => p.getAttribute("d")),
  }));
  await page.evaluate(() => window.__wb.arm());
  await page.mouse.down();
  await page.mouse.up();
  let settleFrame = null;
  const b2 = await burst("B2", {
    extra: [{ ms: releaseMs, fn: async () => {
      const n = held.length;
      await Promise.all(held.splice(0).map(r => r.continue()));
      // the chart mounts in frozen fake time; its bars start at zero height (no <path> yet) and grow on the fake rAF
      await until(page, () => !!document.querySelector(".anim-tab .recharts-surface") && !document.querySelector('.anim-tab [aria-busy="true"]'), null, { what: "B2 chart mount", every: 5, timeout: 15000 });
      meta.chartsB = { released: n, releaseMs };
    } }],
    perFrame: async (k) => {
      const pr = await barProbe();
      const settled = pr.bars.length > 0 && pr.bars.length === finalBars.length && pr.bars.every((d, i) => d === finalBars[i]);
      if (settled && settleFrame === null) settleFrame = k;
      return { fallback: pr.fallback, surface: pr.surface, bars: pr.bars.length, settled, transient: pr.fallback };
    },
    nFor: (k) => {
      const def = S.BURSTS.B2;
      if (settleFrame === null) return k < def.nMax ? k + 1 : def.nMax;     // keep going until settled (cap)
      if (settleFrame <= def.settleBy) return def.n;
      return Math.min(def.nMax, settleFrame + 4);                          // settle + 3 frames
    },
  });
  b2.settleFrame = settleFrame;
  b2.settleMs = settleFrame === null ? null : b2.sampleMs[settleFrame];
  b2.extended = b2.n > S.BURSTS.B2.n;
  b2.fallbackFrames = b2.frames.map((f, i) => f.fallback ? i : -1).filter(i => i >= 0);
  b2.chunkReleaseMs = releaseMs;
  check("B2 bars settled within the burst", settleFrame !== null, { note: settleFrame === null ? "never matched PASS A's final bar geometry" : `settled at frame ${settleFrame} (${b2.settleMs} ms)` });
  meta.errorsB = errors;
  await page.close();
}

/* ──────────────────────────── final consistency ──────────────────────────── */
function finalChecks() {
  // captions fill from the captured strings (regexes + explicit map; any miss throws)
  let caps = null;
  try { caps = S.captionTexts(meta); } catch (e) { check("captions fill from meta", false, { note: e.message }); }
  if (caps) {
    meta.captions = caps.map(c => ({ id: c.id, eyebrow: c.eyebrow, headline: c.headline, sub: c.sub }));
    check("captions fill from meta", true, { note: caps.map(c => `${c.headline} | ${c.sub}`).join(" ‖ ") });
    // every number in a caption appears in the innerText of a state where it is on screen
    const where = { 1: ["L01"], 2: ["L01"], 3: ["L03"], 4: ["L03", "L03b"], 5: ["L04q"], 6: ["L04c"] };
    for (const c of caps) {
      const nums = `${c.headline} ${c.sub}`.match(/\d+(?:\.\d+)?/g) || [];
      const text = where[c.id].map(s => meta.states[s].innerText).join("\n");
      const miss = nums.filter(n => !new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(text));
      check(`caption ${c.id} figures appear in ${where[c.id].join("/")} innerText`, miss.length === 0, { note: miss.length ? `missing ${miss.join(", ")}` : nums.join(", ") || "no figures" });
    }
    if (meta.strings.xKey) check("chart x key appears on screen (L04c)", meta.states.L04c.innerText.includes(meta.strings.xKey), { note: meta.strings.xKey });
  }
  // the volatile figures agree everywhere
  check("toast cut frame computed", Number.isInteger(meta.toastCutFrame), { note: `frame ${meta.toastCutFrame} (${(meta.toastCutFrame / S.FPS).toFixed(3)} s)` });
  // every overlay target can be built from the measured boxes
  for (const [k, def] of Object.entries(S.OVERLAY_TARGETS)) {
    const miss = def.union.filter(n => !meta.states[def.state]?.boxes[n]);
    check(`overlay target ${k} measurable in ${def.state}`, miss.length === 0, { note: miss.length ? `missing ${miss.join(", ")}` : JSON.stringify(S.union(def.union.map(n => meta.states[def.state].boxes[n]))) });
  }
  // the cursor never enters a hoverable rect of the state on screen, except the hover it is there to show. The state
  // is the one stateAt() puts on screen at each sample, so `home` is checked against L04c and then L01 (the reset cut).
  meta.pathHits = {};
  const intended = { toDrop: ["dropzone"], toCard: ["dropzone", "sampleCard"], toQuality: ["tab_quality"], qualityOut: ["tab_quality"], toCharts: ["tab_charts"], chartsOut: ["tab_charts"], cardToPark: [], home: [] };
  for (const name of S.PATH_ORDER) {
    const sameRect = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
    const hits = new Map(), seen = new Set();
    const [a, b] = S.PATHS[name].t;
    for (let i = 0; i <= Math.ceil((b - a) * 240); i++) {
      const t = Math.min(b, a + i / 240), q = S.pathPoint(name, t), st = S.stateAt(t, meta), state = meta.states[st];
      seen.add(st);
      const okBoxes = (intended[name] || []).map(n => state.boxes[n]).filter(Boolean);
      for (const r of state.hoverables) {
        if (!S.inside(q, r)) continue;
        if (okBoxes.some(ob => sameRect(ob, r) || (S.inside([r.x, r.y], ob) && S.inside([r.x + r.w, r.y + r.h], ob)))) continue;   // the target or its own descendants
        if (!hits.has(r.what)) hits.set(r.what, +t.toFixed(3));
      }
    }
    meta.pathHits[name] = Object.fromEntries(hits);
    check(`path ${name} hovers nothing unintended in ${[...seen].join(" → ")}`, hits.size === 0, { note: hits.size ? [...hits].map(([w, t]) => `${w} @${t}`).join("; ") : "" });
  }
  // hover entries along the film's paths (gate.mjs samples its plate-check frames at these)
  meta.hoverEntries = {};
  for (const [h, def] of Object.entries(S.HOVERS)) {
    const box = meta.states[def.state].boxes[def.box];
    if (box) meta.hoverEntries[h] = S.hoverEntry(def.path, box);
  }
  meta.errors = { A: meta.errorsA, B: meta.errorsB }; delete meta.errorsA; delete meta.errorsB;
  check("no page errors in either pass", !meta.errors.A.length && !meta.errors.B.length, { note: [...meta.errors.A, ...meta.errors.B].join(" | ").slice(0, 300) });
  check("one session id across all assets", Object.values(assets).every(a => a.session === session), { note: `${Object.keys(assets).length} assets` });
}

/* ──────────────────────────── main ──────────────────────────── */
let server = null, browser = null, context = null;
async function main() {
  server = await startServer();
  meta.health = server.health;
  meta.app.version = server.health.version;
  meta.app.maxUploadMb = server.health.maxUploadMb;
  log(`server ${server.BASE} — version ${server.health.version}, maxUploadMb ${server.health.maxUploadMb}`);
  let failed = false;
  try {
    browser = await launchBrowser();
    meta.app.chromium = browser.version();
    context = await newSessionContext(browser);
    await passA();
    await passB();
    finalChecks();
  } catch (e) {
    failed = true;
    console.error(e.stack || e);
    check("capture ran to completion", false, { note: e.message.split("\n")[0] });
  } finally {
    meta.checks = checks;
    meta.assets = assets;
    meta.elapsedS = +((Date.now() - T00) / 1000).toFixed(1);
    fs.writeFileSync(path.join(DIR, "meta.json"), JSON.stringify(meta, null, 1));
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
  const bad = checks.filter(c => !c.ok);
  if (failed || bad.length) {
    console.log(`\nCAPTURE FAILED — ${bad.length} check(s): ${bad.map(c => c.name).join("; ")}\nsession ${session} (${path.relative(ROOT, DIR)})`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(HERE, "capture", "LATEST"), session + "\n");   // what render/gate/serve read by default
  const unusable = Object.entries(meta.bursts || {}).filter(([, b]) => !b.usable).map(([k]) => k);
  console.log(`\nCAPTURE OK — session ${session}${unusable.length ? ` (bursts marked unusable: ${unusable.join(", ")})` : ""}\n${DIR}`);
}
await main();

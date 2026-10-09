// Master schedule for the 23 s "How it works" walkthrough. Single source of truth: capture.mjs, compositor.js (the
// compositor), render.mjs and gate.mjs all import it, and frontend/public/landing.js mirrors CHAPTERS.
// Everything is in PAGE CSS px of the real app at 1440x900 (DPR 2 captures) or in seconds of loop time.
// Every scheduled window lies inside [0.60, 22.70]; over 22.70–23.00 ∪ 0.00–0.60 the frame is S0 + L01 + the
// arrow at P with no overlays, so frame 689 equals frame 0 and nothing needs to be periodic.
//
//   0.00 –  0.60  seam hold            S0, L01, arrow parked at P
//   0.60 –  3.50  01 the dropzone      S0→S1, cursor P→W1→W2→D, real H1 hover, spotlight + brackets, caption 1
//   3.50 –  5.90  01 tap the sample    S1→S2, cursor D→(500,450)→C, real L02 hover, press, click at 5.900 (f177)
//   5.90 –  6.90  02 power-on (B0)     30 real burst frames over L03, S2→S3, cursor C→PR along the gap
//   6.90 –  9.90  02 inspected         S3 hold on L03, readout spotlight, SERVER brackets, toast hard cut (≈9.40)
//   9.90 – 13.50  03 margin notes      S3→S4, insights spotlight, finding-1 brackets
//  13.50 – 17.40  03 the grade (B1)    cursor PR→Q, click 14.500 (f435), 30 real frames, S4→S5, green rule
//  17.40 – 21.50  03 a chart (B2)      cursor PR→K, click 18.400 (f552), 24–36 real frames, S5→S6
//  21.50 – 23.00  reset                overlays/caption/scrim out, S6→S0, cursor PR→P, L04c→L01 cut below y 380
const f = Object.freeze;

export const PERIOD = 23;
export const FPS = 30;
export const NFRAMES = PERIOD * FPS;                      // 690
export const W = 1600, H = 900;                            // output frame
export const VIEWPORT = f({ width: 1440, height: 900 });   // capture viewport (CSS px)
export const DPR = 2;                                      // capture device scale: plates are 2880 px wide
export const LOOP_WINDOW = f([0.60, 22.70]);

/* Landing-page chapter rail: which .step card in #how is lit while the video plays. Mirrored verbatim by
   frontend/public/landing.js (const CHAPTERS; gate.mjs checks the copy). [start, end) in seconds of video time,
   aligned to the burned-in eyebrows: STEP 01 from caption 1 (1.50) to caption 2's end (6.62), STEP 02 to caption 3's
   end (10.42), STEP 03 until the last caption is gone (21.62). */
export const CHAPTERS = f([f([1.5, 6.62]), f([6.62, 10.42]), f([10.42, 21.62])]);

/* ── camera ── framing = [x0, y0, w] in page CSS px; h = w·9/16; s = 1600/w frame px per CSS px.
   Every framing is ≥ 800 CSS px wide (never upsamples the DPR-2 plates) and starts at y0 ≥ 60 (no app header). */
export const FRAMINGS = f({
  S0: f([64, 72, 1312]),   // establishing shot and seam
  S1: f([4, 64, 800]),     // file card
  S2: f([240, 340, 960]),  // demo heading and sample row
  S3: f([28, 310, 1400]),  // readout, prompts, tabs, toast
  S4: f([59, 625, 900]),   // tab bar and insights card
  S5: f([89, 626, 840]),   // quality block
  S6: f([79, 640, 860]),   // chart
});
/* holds are fully static; moves ease (easeInOutCubic) with w interpolated in log space and the centre linearly */
export const CAMERA = f([
  f({ from: "S0", to: "S1", t: f([0.60, 1.80]) }),
  f({ from: "S1", to: "S2", t: f([3.50, 4.70]) }),
  f({ from: "S2", to: "S3", t: f([6.00, 7.30]) }),
  f({ from: "S3", to: "S4", t: f([9.90, 11.10]) }),
  f({ from: "S4", to: "S5", t: f([14.60, 15.60]) }),
  f({ from: "S5", to: "S6", t: f([18.45, 19.45]) }),
  f({ from: "S6", to: "S0", t: f([21.70, 22.70]) }),
]);

/* ── points (page CSS px) ── */
export const POINTS = f({
  P: f([1180, 648]),   // empty-state park (seam hold, start of toDrop): demo-panel padding right of the sample cards
  PR: f([900, 648]),   // results park: the empty 638–658 gap above the tab bar, right of DEEP DIVE (ends x 697), in
                       // every results framing (S3–S6). In L01 it lies inside sample card 3, so `home` leaves first.
  D: f([520, 240]),    // lower right of the dropzone, clear of its text
  C: f([566, 648]),    // lower right of the ยอดขายร้านโชห่วย card; after the click it sits in the same gap
  Q: f([351, 671]),    // QUALITY tab
  K: f([282, 671]),    // CHARTS tab
  W1: f([1100, 500]),  // P→D waypoints: right of the sample cards, below the prompt card
  W2: f([700, 420]),
  DC: f([500, 450]),   // D→C waypoint
  GQ: f([351, 648]),   // gap corner above QUALITY
  GK: f([282, 648]),   // gap corner above CHARTS
});
const p = POINTS;
/* ── cursor paths ── the capture moves the real mouse along exactly these (except `home`, which runs during the
   film's reset, after the last still; capture.mjs and gate.mjs check it against both states it crosses).
   catmull = centripetal Catmull-Rom through the waypoints; poly = polyline with 12 px fillets (the gap runs).
   Traversed by arc length with easeInOutSine over t. */
export const FILLET = 12;
export const PATHS = f({
  toDrop:     f({ kind: "catmull", pts: f([p.P, p.W1, p.W2, p.D]), t: f([1.00, 2.10]) }),
  toCard:     f({ kind: "catmull", pts: f([p.D, p.DC, p.C]),       t: f([3.50, 4.50]) }),
  cardToPark: f({ kind: "poly",    pts: f([p.C, p.PR]),            t: f([6.05, 6.85]) }),
  toQuality:  f({ kind: "poly",    pts: f([p.PR, p.GQ, p.Q]),      t: f([13.50, 14.30]) }),
  qualityOut: f({ kind: "poly",    pts: f([p.Q, p.GQ, p.PR]),      t: f([14.65, 15.35]) }),
  toCharts:   f({ kind: "poly",    pts: f([p.PR, p.GK, p.K]),      t: f([17.40, 18.15]) }),
  chartsOut:  f({ kind: "poly",    pts: f([p.K, p.GK, p.PR]),      t: f([18.55, 19.25]) }),
  // back to the empty-state park inside the S6→S0 whip: the tip is past sample card 3 (x 1056) by the L01 cut at
  // 22.20 (x 1094; the hand crossfade scans back at 240 Hz, so frame times alone are not enough), and in frame px it
  // never goes right of where it rested (x 1527)
  home:       f({ kind: "poly",    pts: f([p.PR, p.P]),            t: f([21.95, 22.35]) }),
});
export const PATH_ORDER = f(["toDrop", "toCard", "cardToPark", "toQuality", "qualityOut", "toCharts", "chartsOut", "home"]);

/* ── clicks ── press scales the cursor to .86 about the tip (67 ms down from `down`, 67 ms up from `click`).
   The click (release) frame is where the burst starts: frame = round(click·30). `ripple: false` draws no ripple: the
   card click swaps the whole layout, which is its feedback, and a ring at C would land on the results' FORECAST tab. */
export const PRESS_SCALE = 0.86, PRESS_RAMP = 0.067;
export const CLICKS = f({
  card:    f({ down: 5.80, click: 5.900, frame: 177, at: "C", burst: "B0", ripple: false }),
  quality: f({ down: 14.40, click: 14.500, frame: 435, at: "Q", burst: "B1" }),
  charts:  f({ down: 18.30, click: 18.400, frame: 552, at: "K", burst: "B2" }),
});
export const RIPPLE = f({ dur: 0.50, r0: 8, dr: 30, stroke: 2.5, opacity: 0.85, discR: 0.6, discAlpha: 0.18 });

/* ── real bursts (PASS B) ── clip = [x, y, w, h] page CSS px; frame k samples the app at click + (k + 0.5)/30 s.
   `over` is the PASS A still the last frame must equal (continuity gate) and the base plate under the burst.
   meta.bursts.<id>.n is the captured count (B2 may extend to settle + 3, cap nMax). */
export const BURSTS = f({
  // B0 starts at y 300 (spec: 380) so it also holds the analyze button: when PERCEIVED ≥ 17 ms frame 0 samples the
  // real loading state, whose busy button (y 317–353) lies above 380. Above 380 the frames equal L01/L03 otherwise.
  B0: f({ click: "card",    n: 30, clip: f([0, 300, 1440, 810]), over: "L03" }),
  // B1/B2 run to y 1197 (spec: 470 / 530 high): the QUALITY tab also mounts FixPanel's sign-in card at y 1125–1191
  // and the CHARTS card ends higher, so shorter clips would let that swap pop outside the burst (A9 locality).
  B1: f({ click: "quality", n: 30, clip: f([80, 645, 852, 552]), over: "L04q" }),
  B2: f({ click: "charts",  n: 24, nMax: 36, settleBy: 20, clip: f([80, 645, 852, 552]), over: "L04c" }),
});
export const CONTINUITY = f({ mean: 0.5, p999: 8 });       // /255, last burst frame vs PASS A still

/* ── PASS A stills ── full = full-page 2880 px wide; clip = [x, y, w, h] page CSS px */
export const STILLS = f({
  L01:       f({ full: true, desc: "empty state, mouse at P" }),
  H1:        f({ clip: f([88, 73, 632, 309]), desc: "dropzone hover (amber dashed border)", state: "L01" }),
  L02:       f({ full: true, desc: "sample card hover: 2 px lift, amber glow, amber title", state: "L01" }),
  "L02-down": f({ clip: f([354, 514, 276, 216]), desc: "sample card pressed", state: "L01" }),
  L03:       f({ full: true, desc: "results, INSIGHTS, toast showing" }),
  L03b:      f({ full: true, desc: "results after the toast's 3.5 s cut, mouse at P" }),
  H3:        f({ clip: f([88, 650, 852, 42]), desc: "QUALITY tab hover", state: "L03b" }),
  "H3-down": f({ clip: f([88, 650, 852, 42]), desc: "QUALITY tab pressed", state: "L03b" }),
  L04q:      f({ full: true, desc: "QUALITY tab settled, mouse at P" }),
  H4:        f({ clip: f([88, 650, 852, 42]), desc: "CHARTS tab hover", state: "L04q" }),
  "H4-down": f({ clip: f([88, 650, 852, 42]), desc: "CHARTS tab pressed", state: "L04q" }),
  L04c:      f({ full: true, desc: "CHARTS tab settled, mouse at P" }),
});

/* ── hover plates ── crossfade linearly over 150 ms (the app's transition-colors/duration-150), confined to the
   measured box inflated by `inflate`, starting on the first frame the cursor tip is inside the box. */
export const HOVER_FADE = 0.150;
export const HOVERS = f({
  H1:  f({ box: "dropzone",    inflate: 6,  state: "L01",  path: "toDrop",    press: null,       click: null }),
  L02: f({ box: "sampleCard",  inflate: 30, state: "L01",  path: "toCard",    press: "L02-down", click: "card" }),
  H3:  f({ box: "tab_quality", inflate: 4,  state: "L03b", path: "toQuality", press: "H3-down",  click: "quality" }),
  H4:  f({ box: "tab_charts",  inflate: 4,  state: "L04q", path: "toCharts",  press: "H4-down",  click: "charts" }),
});

/* ── base plates ── L01 → L03 (after B0) → L03b (toast cut) → L04q (click 1) → L04c (click 2) → L01 (reset cut) */
export const TOAST_MS = 3500;                               // store/index.js toast() default duration
// L04c→L01 below page y 380 (above it the two are identical). A hard cut at the S6→S0 whip's peak velocity (22.20 s):
// f666 is pure L04c, f667 pure L01, so no frame blends two app states. plates() still supports a dissolve window.
export const RESET = f({ t: f([22.20, 22.2001]), belowY: 380 });
export const IDENTICAL_ABOVE_Y = 380;                       // L01, L02, L03 are pixel-identical above this

/** Frame on which the toast hard-cuts (L03 → L03b): fClick0 + ceil(((perceivedMs + 3500)/1000)·30 − 0.5). */
export const toastCutFrame = (perceivedMs) => CLICKS.card.frame + Math.ceil(((perceivedMs + TOAST_MS) / 1000) * FPS - 0.5);

/* ── overlays ── windows: spotlight fades in 200 ms from `in`, out 150 ms from `out` (outDur overrides);
   brackets grow 250 ms (easeOutCubic) from `in`, fade 150 ms from `out`. `box` names an OVERLAY_TARGETS entry. */
export const SPOT = f({ alpha: 0.42, pad: 14, r: 12, feather: 5, fadeIn: 0.200, fadeOut: 0.150 });
export const BRACKET = f({ color: "#F5A00B", width: 2.5, gap: 10, arm: 16, grow: 0.250, fadeOut: 0.150 });
export const SPOTLIGHTS = f([
  f({ box: "dropzone",      in: 2.05,  out: 3.40 }),
  f({ box: "sampleCard",    in: 4.60,  out: 5.75 }),
  f({ box: "readoutGrid",   in: 7.20,  out: 9.30 }),
  f({ box: "insightsCard",  in: 11.00, out: 13.40 }),
  f({ box: "qualityHeader", in: 15.45, out: 17.30 }),
  f({ box: "chartCard",     in: 19.35, out: 21.50, outDur: 0.30 }),
]);
export const BRACKETS = f([
  f({ box: "dropzone",   in: 2.10,  out: 3.40 }),
  f({ box: "sampleCard", in: 4.65,  out: 5.75 }),
  f({ box: "serverCell", in: 7.35,  out: 9.30 }),
  f({ box: "finding1",   in: 11.15, out: 13.40 }),
  f({ box: "gradeGroup", in: 15.50, out: 17.30 }),
  f({ box: "plot",       in: 19.40, out: 21.50, outDur: 0.30 }),
]);
/* overlay target = union of these meta box names, measured in the named state */
export const OVERLAY_TARGETS = f({
  dropzone:      f({ state: "L01",  union: f(["dropzone"]) }),
  sampleCard:    f({ state: "L01",  union: f(["sampleCard"]) }),
  readoutGrid:   f({ state: "L03",  union: f(["readoutGrid"]) }),
  serverCell:    f({ state: "L03",  union: f(["readoutCell_server"]) }),
  insightsCard:  f({ state: "L03b", union: f(["insightsCard"]) }),
  finding1:      f({ state: "L03b", union: f(["finding1"]) }),
  qualityHeader: f({ state: "L04q", union: f(["q_ring", "q_excellent", "q_stamp", "q_subscores"]) }),
  gradeGroup:    f({ state: "L04q", union: f(["q_ring", "q_excellent", "q_stamp"]) }),
  chartCard:     f({ state: "L04c", union: f(["c_typeRow", "c_plot"]) }),
  plot:          f({ state: "L04c", union: f(["c_grid", "c_xAxis", "c_yAxis"]) }),
});

/* ── scrim + captions ── frame px. Scrim ink alpha stops [frameY, alpha]; safe zone: brackets end at y ≤ 650. */
export const SCRIM = f({ stops: f([f([650, 0]), f([712, 0.60]), f([760, 0.95]), f([900, 0.97])]), in: f([1.50, 1.80]), out: f([21.62, 21.92]) });
export const SAFE_Y = 650, TOAST_SAFE_Y = 655;
export const CAPTION_STYLE = f({
  x: 64, rule: f({ w: 3, y0: 760, y1: 866, amber: "#F5A00B", green: "#34D399" }), textX: 86, maxW: 1000,
  eyebrow: f({ font: "500 17px PlexMono", tracking: "0.22em", color: "#F5A00B", top: 762 }),
  headline: f({ font: "600 42px/46px PlexSans", color: "#E9EEF7", top: 790 }),
  sub: f({ font: "400 21px PlexMono", color: "#8C99B5", top: 846, severity: f({ WARNING: "#F5A00B" }) }),
  out: 0.120, outDy: -4, in: 0.220, inDy: 6, ruleFade: 0.220, lastOutDy: 6,
});
/* caption windows: in over CAPTION_STYLE.in from `start`, out over CAPTION_STYLE.out ending at `end`
   (the first fades in with the scrim, 1.50–1.80; the last fades over the scrim's 0.30 s, 21.32–21.62, dropping 6 px,
   and is gone before the scrim lifts, 21.62–21.92). Captions 4 and 5 leave before their tab does (QUALITY click
   14.50, CHARTS click 18.40); through the gaps only the unchanged STEP 03 eyebrow stays. */
export const CAPTIONS = f([
  f({ id: 1, start: 1.50,  end: 3.82,  rule: "amber", eyebrow: "STEP 01 / 03 · DROP A FILE, OR TAP A SAMPLE", headline: "Drop in a CSV or Excel file", sub: "{fileMeta}" }),
  f({ id: 2, start: 3.84,  end: 6.62,  rule: "amber", eyebrow: "STEP 01 / 03 · DROP A FILE, OR TAP A SAMPLE", headline: "…or tap a sample. No signup.", sub: "“{sampleTitle}” sample · {sampleRows} rows · quality {sampleQuality}/100" }),
  f({ id: 3, start: 6.64,  end: 10.42, rule: "amber", eyebrow: "STEP 02 / 03 · INSIGHTS ENGINE INSPECTS", headline: "Inspected in {serverMs} ms", sub: "Pure statistics, no AI · {rows} rows × {cols} columns" }),
  f({ id: 4, start: 10.44, end: 14.45, rule: "amber", eyebrow: "STEP 03 / 03 · READ THE FINDINGS", headline: "Margin notes, in plain Thai", sub: "{finding1Badge} · {finding1}" }),
  f({ id: 5, start: 15.34, end: 18.40, rule: "green", eyebrow: "STEP 03 / 03 · READ THE FINDINGS", headline: "Graded {grade} · {score}/100", sub: "{subscoreLabels}" }),
  f({ id: 6, start: 18.94, end: 21.62, rule: "amber", eyebrow: "STEP 03 / 03 · READ THE FINDINGS", headline: "Then a chart, ready to export", sub: "{legend} by {xKey} · the recommended {chartType} chart" }),
]);

/* Thai → English: an explicit map plus regexes; anything unmatched throws (aborts the render). */
export const TRANSLATE = f({ "ยอดขายร้านโชห่วย": "Corner-shop sales", "ยอดขาย": "Sales", "จำนวน": "Quantity", "วันที่": "Date", "สินค้า": "product" });
export const CHART_TYPES = f({ "แท่ง": "bar", "เส้น": "line", "พื้นที่": "area", "กระจาย": "scatter", "วงกลม": "pie" });
const tr = (k) => { if (!(k in TRANSLATE)) throw new Error(`caption: no translation for "${k}"`); return TRANSLATE[k]; };
const must = (re, s, what) => { const m = re.exec(String(s ?? "")); if (!m) throw new Error(`caption: ${what} "${s}" does not match ${re}`); return m; };

/** Fill every caption template from meta.strings (PASS A DOM). Throws on any unmatched regex or unknown key. */
export function captionValues(meta) {
  const S = meta.strings;
  const mb = must(/≤ (\d+) MB/, S.fileMeta, "file-card meta")[1];
  const card = must(/^(\d[\d,]*) แถว · คุณภาพ (\d+)\/100$/, S.sampleMeta, "sample meta line");
  const fnd = must(/^"(.+)" มี outliers (\d+) จุด \(([\d.]+)%\)$/, S.finding1Title, "finding 1");
  const grade = must(/GRADE\s*([A-F][+-]?)\s*·\s*(\d+)\/100/, S.stamp, "grade stamp");
  const legend = must(/^(.+) \(รวม\)$/, S.legend, "chart legend");
  const ro = Object.fromEntries((S.readout || []).map(([k, v]) => [k, v]));
  const ms = must(/^(\d+) ms$/, ro.SERVER, "SERVER cell")[1];
  if (+ms !== meta.serverMs) throw new Error(`caption: SERVER cell ${ms} ≠ serverMs ${meta.serverMs}`);
  if (!(S.chartType in CHART_TYPES)) throw new Error(`caption: unknown chart type "${S.chartType}"`);
  const labels = (S.subscoreLabels || []).map(s => s.toLowerCase());
  if (labels.length !== 5) throw new Error(`caption: expected 5 sub-score labels, got ${labels.length}`);
  return {
    fileMeta: S.fileMeta.replace(/≤ (\d+) MB/, `up to ${mb} MB`),
    sampleTitle: tr(S.sampleTitle), sampleRows: card[1], sampleQuality: card[2],
    serverMs: ms, rows: must(/^[\d,]+$/, ro.ROWS, "ROWS cell")[0], cols: must(/^\d+$/, ro.COLUMNS, "COLUMNS cell")[0],
    finding1Badge: must(/^(CRITICAL|WARNING|NOTE|GOOD)$/, S.finding1Badge, "finding 1 badge")[1],
    finding1: `“${tr(fnd[1])}” has ${fnd[2]} outliers (${fnd[3]}%)`,
    grade: grade[1], score: grade[2],
    subscoreLabels: labels.map((s, i) => (i ? s : s[0].toUpperCase() + s.slice(1))).join(" · "),
    legend: `${tr(legend[1])} (total)`, xKey: tr(S.xKey), chartType: CHART_TYPES[S.chartType],
  };
}
/** The six captions as concrete text: [{ id, start, end, rule, eyebrow, headline, sub }].
 *  Caption 6 ("Then a chart") comes in at 18.94 s, or on the first frame the real bars have settled if that is later
 *  (meta.bursts.B2.settleFrame). Caption 5 has already left at 18.40, with the CHARTS click. */
export function captionTexts(meta) {
  const v = captionValues(meta);
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => { if (!(k in v)) throw new Error(`caption: unknown key ${k}`); return v[k]; });
  const caps = CAPTIONS.map(c => ({ ...c, eyebrow: fill(c.eyebrow), headline: fill(c.headline), sub: fill(c.sub) }));
  const settle = meta.bursts?.B2?.settleFrame;
  if (Number.isInteger(settle)) {
    const tSettle = (CLICKS.charts.frame + settle) / FPS, c5 = caps.find(c => c.id === 5), c6 = caps.find(c => c.id === 6);
    if (tSettle > c6.start) { c6.start = tSettle; }
  }
  return caps;
}

/* ── easing / geometry helpers (pure) ── */
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
export const easeInOutSine = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
export const easeInQuad = (u) => u * u;
export const lerp = (a, b, u) => a + (b - a) * u;
export const wrap = (t) => ((t % PERIOD) + PERIOD) % PERIOD;
export const inflate = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
export const inside = (pt, b) => pt[0] >= b.x && pt[0] <= b.x + b.w && pt[1] >= b.y && pt[1] <= b.y + b.h;
export const union = (bs) => {
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/* ── camera(t) ── { x0, y0, w, h, cx, cy, s } */
const framing = (name) => { const [x0, y0, w] = FRAMINGS[name]; const h = w * 9 / 16; return { x0, y0, w, h, cx: x0 + w / 2, cy: y0 + h / 2 }; };
export function camera(t) {
  const tt = wrap(t);
  let cur = "S0";
  for (const m of CAMERA) {
    if (tt < m.t[0]) break;
    if (tt < m.t[1]) {
      const e = easeInOutCubic((tt - m.t[0]) / (m.t[1] - m.t[0]));
      const A = framing(m.from), B = framing(m.to);
      const w = Math.pow(A.w, 1 - e) * Math.pow(B.w, e), h = w * 9 / 16;
      const cx = lerp(A.cx, B.cx, e), cy = lerp(A.cy, B.cy, e);
      return { x0: cx - w / 2, y0: cy - h / 2, w, h, cx, cy, s: W / w };
    }
    cur = m.to;
  }
  const F = framing(cur);
  return { ...F, s: W / F.w };
}
/** page CSS px → frame px for a camera */
export const toFrame = (cam, x, y) => [(x - cam.cx + cam.w / 2) * W / cam.w, (y - cam.cy + cam.h / 2) * W / cam.w];

/* ── paths ── dense polylines (≈1 px spacing) with cumulative arc length */
function catmull(pts, perSeg = 400) {
  const P = [[2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]], ...pts,
    [2 * pts.at(-1)[0] - pts.at(-2)[0], 2 * pts.at(-1)[1] - pts.at(-2)[1]]];
  const out = [];
  const tj = (ti, a, b) => ti + Math.max(1e-6, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));   // centripetal α = .5
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let k = i === 1 ? 0 : 1; k <= perSeg; k++) {
      const t = t1 + (t2 - t1) * k / perSeg;
      const L = (a, b, ta, tb) => [0, 1].map(j => ((tb - t) * a[j] + (t - ta) * b[j]) / (tb - ta));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  return out;
}
function filleted(pts, r = FILLET, perArc = 24) {
  if (pts.length < 3) return pts.map(q => [...q]);
  const out = [[...pts[0]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, v, b] = [pts[i - 1], pts[i], pts[i + 1]];
    const da = Math.hypot(a[0] - v[0], a[1] - v[1]), db = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const rr = Math.min(r, da / 2, db / 2);
    const s = [v[0] + (a[0] - v[0]) * rr / da, v[1] + (a[1] - v[1]) * rr / da];
    const e = [v[0] + (b[0] - v[0]) * rr / db, v[1] + (b[1] - v[1]) * rr / db];
    for (let k = 0; k <= perArc; k++) {   // quadratic fillet with the corner as control point
      const u = k / perArc;
      out.push([(1 - u) ** 2 * s[0] + 2 * (1 - u) * u * v[0] + u * u * e[0], (1 - u) ** 2 * s[1] + 2 * (1 - u) * u * v[1] + u * u * e[1]]);
    }
  }
  out.push([...pts.at(-1)]);
  return out;
}
const _paths = new Map();
export function pathPolyline(name) {
  if (_paths.has(name)) return _paths.get(name);
  const def = PATHS[name];
  const raw = def.kind === "catmull" ? catmull(def.pts) : filleted(def.pts);
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const v = { pts: raw, cum, len: cum.at(-1) };
  _paths.set(name, v);
  return v;
}
/** Point at arc-length fraction a ∈ [0,1] of a path. */
export function pathAt(name, a) {
  const { pts, cum, len } = pathPolyline(name);
  const s = clamp01(a) * len;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const u = cum[hi] > cum[lo] ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return [lerp(pts[lo][0], pts[hi][0], u), lerp(pts[lo][1], pts[hi][1], u)];
}
/** Cursor tip at loop time t along a named path (eased by arc length). */
export const pathPoint = (name, t) => { const [a, b] = PATHS[name].t; return pathAt(name, easeInOutSine(clamp01((t - a) / (b - a)))); };

/* ── cursor(t) ── { x, y (page CSS px), scale, path|null } — the glyph (arrow / hand) is decided by the
   compositor from the pointer rects of the state on screen. */
export function cursor(t) {
  const tt = wrap(t);
  let pos = [...POINTS.P], path = null;
  for (const name of PATH_ORDER) {
    const [a, b] = PATHS[name].t;
    if (tt >= a) { pos = pathPoint(name, tt); if (tt <= b) path = name; }
  }
  let scale = 1;
  for (const c of Object.values(CLICKS)) {
    if (tt >= c.down && tt < c.click) scale = lerp(1, PRESS_SCALE, clamp01((tt - c.down) / PRESS_RAMP));
    else if (tt >= c.click && tt < c.click + PRESS_RAMP) scale = lerp(PRESS_SCALE, 1, (tt - c.click) / PRESS_RAMP);
  }
  return { x: pos[0], y: pos[1], scale, path };
}
/** First/last time (sampled at 240 Hz) the cursor tip is inside box along a path → { enter, exit } or null. */
export function hoverEntry(pathName, box, hz = 240) {
  const [a, b] = PATHS[pathName].t;
  let enter = null, exit = null;
  for (let i = 0; i <= Math.ceil((b - a) * hz); i++) {
    const t = Math.min(b, a + i / hz), q = pathPoint(pathName, t);
    if (inside(q, box)) { if (enter === null) enter = t; exit = null; }
    else if (enter !== null && exit === null) exit = t;
  }
  return enter === null ? null : { enter, exit };
}
/** Points of a path for driving the real mouse: n+1 samples by eased arc length, with their loop times. */
export function mouseSteps(pathName, n = 48) {
  const [a, b] = PATHS[pathName].t;
  return Array.from({ length: n + 1 }, (_, i) => { const t = a + (b - a) * i / n; return { t, pt: pathPoint(pathName, t) }; });
}

/* ── which captured app state is on screen at t (for hover honesty, pointer glyph and figure checks) ── */
export function stateAt(t, meta) {
  const tt = wrap(t), fr = Math.round(tt * FPS);
  const cut = toastCutFrame(meta.perceivedMs);
  if (tt >= RESET.t[1] || fr < CLICKS.card.frame) return "L01";
  if (fr >= CLICKS.charts.frame) return "L04c";
  if (fr >= CLICKS.quality.frame) return "L04q";
  if (fr >= cut) return "L03b";
  return "L03";
}

/* ── overlay targets: union of measured boxes in their state (page CSS px) ── */
export function targetBox(name, meta) {
  const def = OVERLAY_TARGETS[name];
  if (!def) throw new Error(`unknown overlay target ${name}`);
  const st = meta.states[def.state];
  const bs = def.union.map(n => { const b = st?.boxes[n]; if (!b) throw new Error(`overlay target ${name}: ${n} not measured in ${def.state}`); return b; });
  return union(bs);
}

/* ── plates(t, meta) ── back-to-front layers: { img, src, clip, alpha }
   img  = file in the capture session dir; src = [x, y, w, h] page CSS px the image covers (full-page plates start
   at 0,0); clip = [x, y, w, h] page CSS px the layer is confined to (null = everywhere). Every layer uses the one
   camera mapping, so a layer is drawn as: source rect = (clip ∩ camera) − src origin, at DPR. */
const FULL = (meta, name) => [0, 0, VIEWPORT.width, meta.stills[name].h / DPR];
const fullPlate = (meta, name, alpha = 1, clip = null) => ({ img: `${name}.png`, src: FULL(meta, name), clip, alpha });
const insideState = (t, meta, def, box) => stateAt(t, meta) === def.state && inside([cursor(t).x, cursor(t).y], box);
/** linear 0→1 over `dur` after `pred` turns true, 1→0 after it turns false (scanned back at 240 Hz) */
function crossfade(t, pred, dur) {
  const now = pred(t);
  for (let i = 1; i <= Math.ceil(dur * 240); i++) {
    const tb = t - i / 240;
    if (pred(tb) !== now) { const u = clamp01((t - (tb + 1 / 480)) / dur); return now ? u : 1 - u; }
  }
  return now ? 1 : 0;
}
export function hoverAlpha(h, t, meta) {
  const def = HOVERS[h], hv = meta.hover?.[h];
  if (!hv || !hv.differs) return 0;               // a hover that changes no pixels is never claimed (H1 in dark mode)
  if (stateAt(t, meta) !== def.state) return 0;   // the click hands over to the burst instantly
  const box = hv.box;
  return crossfade(t, (tb) => insideState(tb, meta, def, box), HOVER_FADE);
}
export function plates(t, meta) {
  const tt = wrap(t), fr = Math.round(tt * FPS), out = [];
  const cut = toastCutFrame(meta.perceivedMs);
  if (tt >= RESET.t[1] || fr < CLICKS.card.frame) out.push(fullPlate(meta, "L01"));
  else if (tt >= RESET.t[0]) {   // the loop reset: L04c → L01 below y 380 (above it the two are identical)
    out.push(fullPlate(meta, "L04c"));
    out.push(fullPlate(meta, "L01", (tt - RESET.t[0]) / (RESET.t[1] - RESET.t[0]), [0, RESET.belowY, VIEWPORT.width, 1e5]));
    return out;
  } else if (fr >= CLICKS.charts.frame) out.push(fullPlate(meta, "L04c"));
  else if (fr >= CLICKS.quality.frame) out.push(fullPlate(meta, "L04q"));
  else if (fr >= cut) out.push(fullPlate(meta, "L03b"));      // the toast's hard cut: no fade, like the app
  else out.push(fullPlate(meta, "L03"));
  // hover plates (confined to the measured box + inflate); press plates only where they differ from the hover
  for (const [h, def] of Object.entries(HOVERS)) {
    const a = hoverAlpha(h, tt, meta);
    if (a <= 0) continue;
    const box = inflate(meta.hover[h].box, def.inflate), clip = [box.x, box.y, box.w, box.h];
    out.push({ img: `${h}.png`, src: STILLS[h].clip || FULL(meta, h), clip, alpha: a });
    const c = def.click && CLICKS[def.click];
    if (c && def.press && meta.hover[h].press?.differs && tt >= c.down && tt < c.click)
      out.push({ img: `${def.press}.png`, src: STILLS[def.press].clip || FULL(meta, def.press), clip, alpha: a });
  }
  // bursts: frame k = f − fClick for 0 ≤ k < n, drawn into its clip over the base (which equals its last frame);
  // a burst that failed its continuity gate falls back to a 150 ms dissolve (B0: from L02 below y 380; B1/B2:
  // inside the clip, from the previous state)
  for (const [id, def] of Object.entries(BURSTS)) {
    const c = CLICKS[def.click], b = meta.bursts?.[id], k = fr - c.frame;
    if (k < 0) continue;
    if (b?.usable) { if (k < b.n) out.push({ img: b.files[k], src: def.clip, clip: def.clip, alpha: 1 }); }
    else {
      const u = clamp01((tt - c.click) / 0.150);
      if (u < 1) out.push(fullPlate(meta, { B0: "L02", B1: "L03b", B2: "L04q" }[id], 1 - u, id === "B0" ? [0, IDENTICAL_ABOVE_Y, VIEWPORT.width, 1e5] : def.clip));
    }
  }
  return out;
}

/* ── overlays(t, meta) ── page-space geometry; the compositor maps it through camera(t) every frame. */
const windowAlpha = (t, w, inDur, outDur) => {
  if (t < w.in || t >= w.out + outDur) return 0;
  if (t < w.in + inDur) return (t - w.in) / inDur;
  if (t >= w.out) return 1 - (t - w.out) / outDur;
  return 1;
};
export function scrimAlpha(t) {
  const tt = wrap(t);
  if (tt < SCRIM.in[0] || tt >= SCRIM.out[1]) return 0;
  if (tt < SCRIM.in[1]) return (tt - SCRIM.in[0]) / (SCRIM.in[1] - SCRIM.in[0]);
  if (tt >= SCRIM.out[0]) return 1 - (tt - SCRIM.out[0]) / (SCRIM.out[1] - SCRIM.out[0]);
  return 1;
}
/** hand glyph opacity (0 = arrow, 1 = hand): the tip inside a pointer rect of the state on screen, 80 ms crossfade */
export function handAlpha(t, meta) {
  const pred = (tb) => { const c = cursor(tb), st = meta.states[stateAt(tb, meta)]; return st.pointers.some(r => inside([c.x, c.y], r)); };
  return crossfade(wrap(t), pred, 0.080);
}
export function overlays(t, meta) {
  const tt = wrap(t);
  const spot = SPOTLIGHTS.map(w => ({ w, a: windowAlpha(tt, w, SPOT.fadeIn, w.outDur ?? SPOT.fadeOut) })).find(x => x.a > 0);
  const br = BRACKETS.map(w => ({ w, a: windowAlpha(tt, w, 1e-9, w.outDur ?? BRACKET.fadeOut) })).find(x => x.a > 0);
  const ripples = Object.values(CLICKS).filter(c => c.ripple !== false && tt >= c.click && tt < c.click + RIPPLE.dur).map(c => {
    const p = (tt - c.click) / RIPPLE.dur, r = RIPPLE.r0 + RIPPLE.dr * easeOutCubic(p);
    return { x: POINTS[c.at][0], y: POINTS[c.at][1], r, stroke: RIPPLE.stroke, opacity: RIPPLE.opacity * (1 - p), discR: RIPPLE.discR * r, discAlpha: RIPPLE.discAlpha * (1 - p) };
  });
  const cur = cursor(tt);
  return {
    spotlight: spot ? { target: spot.w.box, box: inflate(targetBox(spot.w.box, meta), SPOT.pad), r: SPOT.r, feather: SPOT.feather, ink: SPOT.alpha, alpha: spot.a } : null,
    brackets: br ? { target: br.w.box, box: targetBox(br.w.box, meta), gap: BRACKET.gap, arm: BRACKET.arm * easeOutCubic(clamp01((tt - br.w.in) / BRACKET.grow)), width: BRACKET.width, color: BRACKET.color, alpha: br.a } : null,
    ripples,
    cursor: { x: cur.x, y: cur.y, scale: cur.scale, hand: handAlpha(tt, meta) },
    scrim: scrimAlpha(tt),
  };
}

/* ── caption(t, meta) ── { eyebrow, headline, sub: { text, alpha, dy } | null, rule: { amber→green mix, alpha } } */
let _capCache = null;
export function caption(t, meta) {
  if (!_capCache || _capCache.meta !== meta) _capCache = { meta, caps: captionTexts(meta) };
  const caps = _capCache.caps, tt = wrap(t), st = CAPTION_STYLE;
  const i = caps.findIndex(c => tt >= c.start && tt < c.end);
  const scrim = scrimAlpha(tt);
  const ruleMix = (() => {   // 0 = amber, 1 = green; crossfades over 220 ms from the start of the caption that changes it
    let mix = 0;
    for (const c of caps) {
      if (tt < c.start) break;
      const prev = mix, want = c.rule === "green" ? 1 : 0;
      mix = prev + (want - prev) * clamp01((tt - c.start) / st.ruleFade);
    }
    return mix;
  })();
  // the margin rule comes in with the scrim but leaves with the last caption (gone at 21.62, before the scrim lifts),
  // so it never hangs beside the app content the lifting scrim uncovers
  const capN = caps.at(-1), lastOut = SCRIM.out[1] - SCRIM.out[0];
  const ruleAlpha = tt >= capN.end ? 0 : tt >= capN.end - lastOut ? scrim * (1 - easeInQuad((tt - (capN.end - lastOut)) / lastOut)) : scrim;
  const rule = { mix: ruleMix, alpha: ruleAlpha };
  if (i < 0) {   // between two captions (swap gap): only an unchanged eyebrow stays
    const prev = [...caps].reverse().find(c => c.end <= tt), next = caps.find(c => c.start > tt);
    const keep = prev && next && prev.eyebrow === next.eyebrow ? { text: prev.eyebrow, alpha: 1, dy: 0 } : null;
    return { eyebrow: keep, headline: null, sub: null, rule };
  }
  const c = caps[i], first = i === 0, last = i === caps.length - 1;
  const inDur = first ? SCRIM.in[1] - SCRIM.in[0] : st.in, outDur = last ? SCRIM.out[1] - SCRIM.out[0] : st.out;
  const outStart = c.end - outDur;
  let alpha = 1, dy = 0;
  if (tt < c.start + inDur) { const e = easeOutCubic((tt - c.start) / inDur); alpha = e; dy = st.inDy * (1 - e); }
  if (tt >= outStart) { const e = easeInQuad((tt - outStart) / outDur); alpha = Math.min(alpha, 1 - e); dy = last ? st.lastOutDy * e : st.outDy * e; }
  const prevSame = i > 0 && caps[i - 1].eyebrow === c.eyebrow, nextSame = !last && caps[i + 1].eyebrow === c.eyebrow;
  const eyebrowAlpha = (tt < c.start + inDur && prevSame) || (tt >= outStart && nextSame) ? 1 : alpha;
  const eyebrowDy = eyebrowAlpha === 1 && (prevSame || nextSame) ? 0 : dy;
  const sev = /^(WARNING|CRITICAL|NOTE|GOOD) · /.exec(c.sub);
  return {
    eyebrow: { text: c.eyebrow, alpha: eyebrowAlpha, dy: eyebrowDy },
    headline: { text: c.headline, alpha, dy },
    sub: { text: c.sub, alpha, dy, severity: sev ? sev[1] : null },
    rule, id: c.id,
  };
}

// node gate.mjs [step=1] — legibility gate. Projects every visible mesh of both flanks (instanced cells one by one)
// for every frame and fails if anything enters the headline zones of the 1920x1080 frame.
// Zones come from measuring landing.html at 1280-2560 px viewports through object-fit: cover.
import { serve, launch, HERE, FONTS } from "./serve.mjs";
const STEP = +(process.argv[2] || 1), EXTRA = process.argv[3] ? "&" + process.argv[3] : "";
const ZONES = { K1a: [440, 90, 1480, 300], K1b: [560, 180, 1360, 410], K2: [540, 300, 1380, 560] }; // x0,y0,x1,y1
const { srv, port } = serve(HERE, { "/fonts/": FONTS });
const b = await launch(); const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
pg.on("pageerror", e => console.error("[pageerror]", e.message));
await pg.goto(`http://127.0.0.1:${port()}/index.html?w=1920&h=1080${EXTRA}`);
await pg.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const hits = {}, ext = { GL: [1e9, 1e9, -1e9, -1e9], GR: [1e9, 1e9, -1e9, -1e9] }, tok = {};
// readable tokens: how close each one gets to the frame edges decides how narrow a viewport can show it whole
const tokenOf = (n) => (n.match(/^(card-\w+\/(?:body\/)?raw-token|card-\w+\/fig-\w+|card-\w+\/tag|E8 stamp|E9 rail|E7 header|E7 HEADER tag|E7 month \d|E6 cells)/) || [])[1];
// the page's opaque console panel, in frame px, at 1440 cover, the 1280 width-fit (TH, worst case) and 1920: [x edge, y top]
const CONSOLE = { GL: [[467, 606], [412, 650], [570, 589]], GR: [[1452, 606], [1509, 650], [1350, 589]] };
const conHits = {};
const NF = Math.round((await pg.evaluate(() => window.__period)) * 30);
for (let f = 0; f < NF; f += STEP) {
  for (const bx of await pg.evaluate(t => window.boxesAt(t), f / 30)) {
    const tk = tokenOf(bx.name);
    if (tk && bx.op >= 0.25) {   // textFrac narrows a canvas plane to the ink it actually carries
      const w = bx.x1 - bx.x0, x0 = bx.tf ? bx.x0 + bx.tf[0] * w : bx.x0, x1 = bx.tf ? bx.x0 + bx.tf[1] * w : bx.x1;
      const r = (tok[tk] ||= [1e9, -1e9]); r[0] = Math.min(r[0], x0); r[1] = Math.max(r[1], x1);
      if (tk !== "E6 cells") for (const [X, Y] of CONSOLE[bx.g]) {
        const under = bx.g === "GL" ? x1 > X && bx.y1 > Y : x0 < X && bx.y1 > Y;
        if (under) { const k = `${tk} under console edge (${X},${Y})`; (conHits[k] ||= []).push(f); }
      }
    }
    const e = ext[bx.g]; e[0] = Math.min(e[0], bx.x0); e[1] = Math.min(e[1], bx.y0); e[2] = Math.max(e[2], bx.x1); e[3] = Math.max(e[3], bx.y1);
    for (const [z, [zx0, zy0, zx1, zy1]] of Object.entries(ZONES)) {
      const ov = Math.min(bx.x1, zx1) - Math.max(bx.x0, zx0), oh = Math.min(bx.y1, zy1) - Math.max(bx.y0, zy0);
      if (ov > 0 && oh > 0) { const k = `${z} ${bx.g}:${bx.name}`; (hits[k] ||= { frames: [], px: 0 }); hits[k].frames.push(f); hits[k].px = Math.max(hits[k].px, Math.round(ov)); }
    }
  }
}
await b.close(); srv.close();
const VIS = [60, 1860];   // frame x the page shows whole from 1280 px up (landing.html fits x 60-1860 at 1280-1439)
console.log(`token x-range over the loop (must stay inside ${VIS[0]}..${VIS[1]}):`);
let cropped = 0;
for (const [k, [a, z]] of Object.entries(tok)) { const bad = a < VIS[0] || z > VIS[1]; cropped += bad; console.log(`  ${k.padEnd(30)} ${Math.round(a)}..${Math.round(z)}${bad ? "  CROPPED" : ""}`); }
if (cropped) process.exitCode = 1;
for (const [k, fr] of Object.entries(conHits)) { console.log(`  CONSOLE ${k}: ${fr.length} frames [${fr[0]}..${fr.at(-1)}]`); process.exitCode = 1; }
console.log("extents (frame px x0,y0,x1,y1):", JSON.stringify(Object.fromEntries(Object.entries(ext).map(([k, v]) => [k, v.map(Math.round)]))));
if (!Object.keys(hits).length) console.log("GATE OK: nothing enters K1a, K1b or K2");
else { console.log("GATE FAIL:"); for (const [k, h] of Object.entries(hits)) console.log(" ", k, `${h.frames.length} frames [${h.frames[0]}..${h.frames.at(-1)}]`, `max overlap ${h.px}px`); process.exitCode = 1; }

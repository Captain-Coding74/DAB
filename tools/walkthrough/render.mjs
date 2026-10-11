// node render.mjs [--out frames] [--from 0] [--to 690] [--step 1] [--workers 3] [--times 6.4,16.8] [--session <uuid>]
// Writes f0000.png .. f0689.png (or tXX.XXX.png for --times), 1600x900. Every frame is renderAt(frame/30), a pure
// function of t, so frames may be rendered in any order, in chunks, or in parallel. A copy of tools/hero-bg/render.mjs:
// canvas 2D instead of WebGL, and each worker takes a contiguous run of frames so its bitmap LRU stays warm.
import fs from "node:fs"; import path from "node:path";
import { serve, launch, args, HERE, FONTS, sessionDir } from "./serve.mjs";
import { PERIOD, FPS, W, H } from "./schedule.js";
const A = args(process.argv.slice(2));
const OUT = path.resolve(A.out || path.join(HERE, "frames")), workers = +(A.workers || 3);
const SESSION = sessionDir(A.session);
const NFRAMES = Math.round(PERIOD * FPS);
let frames;
if (A.times) frames = A.times.split(",").map(Number).map(t => ({ t, name: `t${t.toFixed(3).padStart(6, "0")}` }));
else { frames = []; for (let f = +(A.from || 0); f < +(A.to || NFRAMES); f += +(A.step || 1)) frames.push({ t: f / FPS, name: `f${String(f).padStart(4, "0")}` }); }
fs.mkdirSync(OUT, { recursive: true });
const { srv, port } = serve(HERE, { "/fonts/": FONTS, "/capture/": SESSION });
const browser = await launch();
const t0 = Date.now(); let done = 0, failed = false;
async function work(slice) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("console", m => { if ((m.type() === "error" || m.type() === "warning") && !/favicon/.test(m.text())) console.error("[page]", m.text()); });
  page.on("pageerror", e => { console.error("[pageerror]", e.message); failed = true; });
  await page.goto(`http://127.0.0.1:${port()}/index.html`);
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(`compositor refused: ${err}`);
  for (const fr of slice) {
    await page.evaluate(t => window.renderAt(t), fr.t);
    await page.screenshot({ path: path.join(OUT, fr.name + ".png"), type: "png", clip: { x: 0, y: 0, width: W, height: H } });
    if (++done % 30 === 0 || done === frames.length) {
      const el = (Date.now() - t0) / 1000; console.log(`${done}/${frames.length}  ${(el / done).toFixed(2)}s/frame  eta ${Math.round(el / done * (frames.length - done))}s`);
    }
  }
  await page.close();
}
const per = Math.ceil(frames.length / workers);
const slices = Array.from({ length: workers }, (_, i) => frames.slice(i * per, (i + 1) * per));
await Promise.all(slices.filter(s => s.length).map(work));
await browser.close(); srv.close();
console.log(`done: ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}  (session ${path.basename(SESSION)})`);
if (failed) process.exitCode = 1;

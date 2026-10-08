// node render.mjs [--out frames] [--from 0] [--to 450] [--step 1] [--workers 3] [--times 0,5.6,11.65] [--q "modules=intake"]
// Writes f0000.png .. f0449.png (or tXXX.XXX.png for --times). Every frame is renderAt(frame/30), a pure function of t.
import fs from "node:fs"; import path from "node:path"; import { serve, launch, args, HERE, FONTS } from "./serve.mjs";
const A = args(process.argv.slice(2));
const W = +(A.w || 1920), H = +(A.h || 1080), FPS = 30, OUT = path.resolve(A.out || path.join(HERE, "frames"));
const workers = +(A.workers || 3), EXTRA = A.q ? "&" + A.q : "";
let frames;
if (A.times) frames = A.times.split(",").map(Number).map(t => ({ t, name: `t${t.toFixed(3).padStart(7, "0")}` }));
else { frames = []; for (let f = +(A.from || 0); f < +(A.to || 450); f += +(A.step || 1)) frames.push({ t: f / FPS, name: `f${String(f).padStart(4, "0")}` }); }
fs.mkdirSync(OUT, { recursive: true });
const { srv, port } = serve(HERE, { "/fonts/": FONTS });
const browser = await launch();
const t0 = Date.now(); let done = 0;
async function work(slice) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("console", m => { if ((m.type() === "error" || m.type() === "warning") && !/favicon|404/.test(m.text())) console.error("[page]", m.text()); });
  page.on("pageerror", e => console.error("[pageerror]", e.message));
  await page.goto(`http://127.0.0.1:${port()}/index.html?w=${W}&h=${H}${EXTRA}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  for (const fr of slice) {
    await page.evaluate(t => window.renderAt(t), fr.t);
    await page.screenshot({ path: path.join(OUT, fr.name + ".png"), type: "png" });
    if (++done % 25 === 0 || done === frames.length) {
      const el = (Date.now() - t0) / 1000; console.log(`${done}/${frames.length}  ${(el / done).toFixed(2)}s/frame  eta ${Math.round(el / done * (frames.length - done))}s`);
    }
  }
  await page.close();
}
const slices = Array.from({ length: workers }, (_, i) => frames.filter((_, j) => j % workers === i));
await Promise.all(slices.filter(s => s.length).map(work));
await browser.close(); srv.close();
console.log(`done: ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);

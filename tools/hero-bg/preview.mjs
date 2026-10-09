// [VIEWPORTS=1280x800,390x844] node preview.mjs OUT_DIR 3.3,10.8,14.3,17.4,22.9,26.3,27.97 [--lang en|th] — screenshots the REAL landing page (frontend/public) with the
// video paused at each t, at desktop and phone sizes, to judge the headline over the background.
import fs from "node:fs"; import path from "node:path"; import { serve, launch, HERE } from "./serve.mjs";
const [OUT, TS] = process.argv.slice(2); const lang = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : "en";
fs.mkdirSync(OUT, { recursive: true });
const { srv, port } = serve(path.resolve(HERE, "../../frontend/public"));
const browser = await launch(false);
const VPS = (process.env.VIEWPORTS || "1280x800,1440x900,1920x1080,390x844").split(",").map(v => v.split("x").map(Number));
for (const [w, h] of VPS) { const label = String(w), vp = { width: w, height: h };
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port()}/landing.html`, { waitUntil: "load" });
  await page.evaluate(l => localStorage.setItem("dab_landing_lang", l), lang); await page.reload({ waitUntil: "load" });
  // phones never fetch the video (each <source> has a media query), so there is nothing to seek: shoot once
  if (!(await page.evaluate(() => document.querySelector(".hero-bg video").currentSrc))) {
    await page.screenshot({ path: path.join(OUT, `${label}-${lang}-poster.png`), clip: { x: 0, y: 0, width: vp.width, height: Math.min(vp.height, 1400) } });
    await page.close(); continue;
  }
  await page.waitForFunction(() => document.querySelector(".hero-bg video").readyState >= 2, null, { timeout: 30000 });
  for (const t of TS.split(",").map(Number)) {
    await page.evaluate(async t => { const v = document.querySelector(".hero-bg video"); v.pause(); v.currentTime = t;
      await new Promise(r => v.addEventListener("seeked", r, { once: true })); }, t);
    await page.waitForTimeout(150);
    const h = await page.evaluate(() => document.querySelector(".hero-stage").getBoundingClientRect().height);
    await page.screenshot({ path: path.join(OUT, `${label}-${lang}-t${t}.png`), clip: { x: 0, y: 0, width: vp.width, height: Math.min(h, 1400) } });
  }
  await page.close();
}
await browser.close(); srv.close();

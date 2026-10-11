// Static server + browser launcher shared by render / gate / preview.
// /fonts/* is served from the app's own self-hosted fonts, so the video uses exactly the faces the page ships.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { chromium } from "playwright-core";
export const HERE = path.dirname(fileURLToPath(import.meta.url));   // survives spaces / Thai in the checkout path
export const FONTS = path.resolve(HERE, "../../frontend/public/fonts");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".woff2": "font/woff2",
  ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4" };
export function serve(root, mounts = {}) {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let base = root, rel = url;
    for (const [prefix, dir] of Object.entries(mounts)) if (url.startsWith(prefix)) { base = dir; rel = url.slice(prefix.length - 1); }
    const p = path.join(base, rel);
    if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const st = fs.statSync(p), type = MIME[path.extname(p)] || "application/octet-stream", range = req.headers.range;
    if (range) { // <video> seeks with byte ranges
      const [a, b] = range.replace("bytes=", "").split("-"); const s = +a, e = b ? +b : st.size - 1;
      res.writeHead(206, { "content-type": type, "content-range": `bytes ${s}-${e}/${st.size}`, "accept-ranges": "bytes", "content-length": e - s + 1 });
      return fs.createReadStream(p, { start: s, end: e }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes" }); fs.createReadStream(p).pipe(res);
  }).listen(0, "127.0.0.1");
  return { srv, port: () => srv.address().port };
}
/** Software WebGL (SwiftShader): frames are bit-identical on any machine running the same Chromium build, GPU or not.
 *  CHROMIUM=/path/to/chrome picks the build (playwright-core does not find a system Chrome by itself). */
export function launch(webgl = true) {
  return chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
    args: webgl ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-vsync"]
                : ["--autoplay-policy=no-user-gesture-required"] });
}
export const args = (argv) => Object.fromEntries(argv.reduce((acc, v, i, arr) => (v.startsWith("--") ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));

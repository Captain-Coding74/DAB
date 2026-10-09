// node scripts/textcrops.mjs [--session <uuid>] → JSON on stdout: the frames and frame-px text crops textcheck.py scores.
// Crops come from the capture's own measured boxes (meta.json) mapped through camera(t), so they follow a re-capture.
// Hold frames: 3.0, 5.4, 8.5, 12.5, 16.8, 20.5. Move frames: the midpoint of every camera move.
import fs from "node:fs"; import path from "node:path";
import { args, sessionDir } from "../serve.mjs";
import * as S from "../schedule.js";
const meta = JSON.parse(fs.readFileSync(path.join(sessionDir(args(process.argv.slice(2)).session), "meta.json"), "utf8"));
const st = meta.states, U = S.union;
const APP = {   // [name, state, box]
  readoutValues: ["L03", U(["rows", "columns", "server", "perceived", "missing", "duplicates"].map(k => st.L03.boxes[`readoutValue_${k}`]))],
  serverCell: ["L03", st.L03.boxes.readoutCell_server],
  sampleMeta: ["L01", st.L01.boxes.sampleMetaLine],
  finding1: ["L03b", st.L03b.boxes.finding1],
  stamp: ["L04q", st.L04q.boxes.q_stamp],
  subscores: ["L04q", st.L04q.boxes.q_subscores],
  chartTicks: ["L04c", U([st.L04c.boxes.c_yAxis, st.L04c.boxes.c_xAxis])],
};
const CAP = { captionHeadline: [S.CAPTION_STYLE.textX - 4, 786, 1100, 840], captionSub: [S.CAPTION_STYLE.textX - 4, 844, 1100, 874] };
const holds = [3.0, 5.4, 8.5, 12.5, 16.8, 20.5].map(t => ({ t, kind: "hold" }));
const moves = S.CAMERA.map(m => ({ t: (m.t[0] + m.t[1]) / 2, kind: "move", move: `${m.from}→${m.to}` }));
const out = [];
for (const c of [...holds, ...moves]) {
  const f = Math.round(c.t * S.FPS), t = f / S.FPS, cam = S.camera(t), state = S.stateAt(t, meta), cap = S.caption(t, meta);
  const crops = [];
  for (const [name, [s, b]] of Object.entries(APP)) {
    if (s !== state) continue;
    const [x0, y0] = S.toFrame(cam, b.x, b.y), x1 = x0 + b.w * cam.s, y1 = y0 + b.h * cam.s;
    if (x0 < 0 || y0 < 0 || x1 > S.W || y1 > S.SAFE_Y) continue;   // only text that is wholly in view above the scrim
    crops.push({ name, box: [x0, y0, x1, y1].map(Math.round) });
  }
  if (c.kind === "move") crops.push({ name: "viewAboveScrim", box: [0, 0, S.W, S.SAFE_Y] });   // everything in shot moves
  if (cap.headline?.alpha >= 0.99) crops.push({ name: "captionHeadline", box: CAP.captionHeadline });
  if (cap.sub?.alpha >= 0.99) crops.push({ name: "captionSub", box: CAP.captionSub });
  out.push({ ...c, f, state, crops });
}
process.stdout.write(JSON.stringify(out, null, 1));

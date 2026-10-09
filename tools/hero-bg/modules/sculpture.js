// E6 ledger-cell sculpture (96 instanced cells + a second instanced mesh of glowing rule strips) and
// E7 annotations (header words + underline, HEADER ✓ tag, bar baseline, month labels). Everything lives in GR.
// 30 s loop "NIGHT AUDIT: Line by Line". Every absolute time comes from SCH (schedule.js):
//   01 PARSE  CLOUD → GRID from SCH.grid, header strip + HEADER ✓ (SCH.header)
//   02 CLEAN  three flagged cells flip red → amber → green under the header word that echoes each left-page fix (SCH.flags, SCH.glow)
//   03 CHART  GRID → BARS (SCH.bars), baseline, Jan/Feb/Mar typed under their groups, breathing hold (SCH.breathe)
//   04 GRADE  BARS → RING (SCH.ring), ring flash (SCH.flash); reset: RING → CLOUD peel, flags red again (SCH.peel)
// The loose cloud drifts on th15 = 2πt/15 (harmonic 2 of the loop). update(t) is a pure function of t in [0,30):
// no state is carried between calls except canvas content caches (months redraw only when the typed count changes).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** test hook: the QA script imports this module (same URL = same instance) and drives update(t) without rendering */
export const __debug = {};

export async function build(ctx) {
  const { L, S, W, deg, GR, canvasTex, roundRect, setOpacity, graphemes, hdr, C, TAU, SCH } = ctx;
  const R = L.rng(0xDAB); // own stream, so the layout does not depend on other modules' build order
  const NC = 12, NR = 8, N = NC * NR, PI = Math.PI;
  // flagged cells [c, r], remapped under the header word whose fix they echo (ordered by row within each echo):
  //   k0-2 'Date' (B.E.→C.E.), k3-5 'Sales' (฿→number), k6-8 'Sales' (acct negative). (8,0) is no longer flagged:
  //   it still turns into bar 8's red top cell (barColour).
  const FLAGS = [[1, 2], [0, 5], [2, 6], [9, 1], [11, 3], [10, 5], [10, 2], [9, 6], [11, 7]];
  const H = [0.95, 1.20, 1.05, 1.45, 1.30, 1.70, 1.55, 1.95, 0.70, 2.10, 1.95, 2.25];
  const TILT = deg(-3);
  const colX = (c) => (c - 5.5) * 0.225;

  /* ── durations and staggers (start times all come from SCH; ends are derived where SCH holds them) ── */
  const GRID_STAG = 0.5, GRID_DUR = 1.5;                               // nearest cells first: fully GRID by SCH.grid + 2.0
  const FLIP_DUR = 0.45, GLINT_AT = 0.60, GLINT_DUR = 0.25, GLINT_RISE = 0.125;
  const BAR_STAG = 0.06, BAR_DUR = SCH.breathe[0] - SCH.bars - 11 * BAR_STAG;          // 1.54: done exactly when the breathing hold starts
  const RING_STAG = 0.05, RING_DUR = SCH.ring[2] - SCH.ring[0] - 11 * RING_STAG;       // 1.25: done exactly when the ring is green
  const PEEL_STAG = 0.6, PEEL_DUR = 1.2;                               // peel lands at SCH.peel[0] + 1.8 = 29.90 (seam calm starts)
  const [BR_T0, BR_DUR] = SCH.breathe;
  const [FL_T0, FL_T1] = SCH.flash, FL_DUR = FL_T1 - FL_T0;
  const MONTH_STAG = 0.2, MONTH_TYPE = 0.2;
  const ECHO_UP = 0.15, ECHO_DECAY = 0.80;                             // header word tint: up 0.15 s, decays by e + 0.95

  /* ── CLOUD rest points: rejection-sampled in the ellipsoid, min spacing 0.16 ── */
  const pts = [];
  for (let guard = 0; pts.length < N && guard < 400000; guard++) {
    const u = 2 * R() - 1, v = 2 * R() - 1, w = 2 * R() - 1;
    if (u * u + v * v + w * w > 1) continue;
    const p = new THREE.Vector3(1.10 * u, 0.10 + 1.00 * v, 0.15 + 0.55 * w);
    if (pts.every((q) => q.distanceToSquared(p) >= 0.16 * 0.16)) pts.push(p);
  }
  if (pts.length < N) throw new Error("sculpture: cloud sampling failed");
  // Spatially coherent assignment: x-sorted slabs of 8 become columns, y-sorted within a slab become rows,
  // so the settle reads as loose papers dropping into place rather than criss-crossing the sheet.
  pts.sort((a, b) => a.x - b.x);
  const restOf = new Array(N);
  for (let c = 0; c < NC; c++) {
    const slab = pts.slice(8 * c, 8 * c + 8).sort((a, b) => b.y - a.y);
    for (let r = 0; r < NR; r++) restOf[8 * c + r] = slab[r];
  }

  /* ── per-cell constants ── */
  const flagK = new Int8Array(N).fill(-1);
  FLAGS.forEach(([c, r], k) => { flagK[8 * c + r] = k; });
  const cells = [];
  for (let c = 0; c < NC; c++) for (let r = 0; r < NR; r++) {
    const i = 8 * c + r, rb = 7 - r, k = flagK[i];
    const s = 4 * c + (rb % 4), Rr = rb < 4 ? 1.15 : 0.97, phi = PI / 2 - TAU * (s + 0.5) / 48;
    cells.push({
      i, c, r, rb, k, s,
      fk: k >= 0 ? SCH.flags[k] : 0,                                   // flip start
      p: restOf[i],
      n: R() < 0.5 ? 1 : 2, a: R() * TAU, b: R() * TAU, e: R() * TAU,
      rx: deg(-50 + 100 * R()), ry: deg(-50 + 100 * R()), rz: deg(-50 + 100 * R()),
      grid: new THREE.Vector3(colX(c), 0.50 - 0.13 * r, 0),
      ringP: new THREE.Vector3(Rr * Math.cos(phi + TILT), Rr * Math.sin(phi + TILT) + 0.05, 0),
      ringQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi - PI / 2 + TILT),
      ringS: new THREE.Vector3(TAU * Rr / 48 * 0.80 / 0.20, 0.45, 0.6),
      d1: 0, d4: PEEL_STAG * s / 47,
    });
  }

  /* ── scratch objects ── */
  const ONE = new THREE.Vector3(1, 1, 1), IDQ = new THREE.Quaternion();
  const eul = new THREE.Euler(), qFlip = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0);
  const pA = new THREE.Vector3(), qA = new THREE.Quaternion(), sA = new THREE.Vector3();
  const pB = new THREE.Vector3(), sB = new THREE.Vector3();
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
  const mCell = new THREE.Matrix4(), mStripLocal = new THREE.Matrix4(), mStrip = new THREE.Matrix4();
  const col = new THREE.Color(), colB = new THREE.Color();

  /** loose cloud: th is th15 = 2πt/15, so the drift keeps its shipped speed while the camera runs on the 30 s orbit */
  function cloudAt(cl, th, outP, outQ) {
    const { p, n, a, b, e } = cl;
    outP.set(p.x + 0.06 * Math.sin(n * th + a), p.y + 0.06 * Math.sin(2 * th + b), p.z + 0.06 * Math.cos(n * th + e));
    eul.set(cl.rx, cl.ry + 0.20 * Math.sin(th + a), cl.rz); outQ.setFromEuler(eul);
  }
  /** spec TRANSITION A→B: lerp + lift·sin(πw)·z, then rotate about the local vertical axis by swirl·sin(πw) */
  function blend(pa, qa, sa, pb, qb, sb, w, lift, swirl) {
    const k = Math.sin(PI * w);
    P.lerpVectors(pa, pb, w); P.z += lift * k;
    if (swirl) { const ang = swirl * k, ca = Math.cos(ang), sn = Math.sin(ang), x = P.x, z = P.z; P.x = x * ca + z * sn; P.z = -x * sn + z * ca; }
    Q.slerpQuaternions(qa, qb, w); SC.lerpVectors(sa, sb, w);
  }
  function barsAt(cl, h, outP, outS) {
    outP.set(colX(cl.c), -1.15 + (cl.rb + 0.5) * h / 8, 0);
    outS.set(1, (h / 8 - 0.012) / 0.10, 1);
  }
  // rank by distance from the cloud position at SCH.grid (when the settle starts) to the grid slot: nearest cells land first
  {
    const th = TAU * SCH.grid / 15;
    const order = cells.map((cl) => { cloudAt(cl, th, pA, qA); return { cl, d: pA.distanceTo(cl.grid) }; }).sort((x, y) => x.d - y.d);
    order.forEach((o, rank) => { o.cl.d1 = GRID_STAG * rank / 95; });
  }

  /* ── colours (linear, HDR) ── */
  const NEUTRAL = hdr(C.edge, 1.0), RED14 = hdr(C.red, 1.4), GREEN = hdr(C.green, 1.0);
  const AMB10 = hdr(C.amber, 1.0), AMB11 = hdr(C.amber, 1.1), AMB12 = hdr(C.amber, 1.2), AMB13 = hdr(C.amber, 1.3);
  const GREEN11 = hdr(C.green, 1.1), GREEN12 = hdr(C.green, 1.2);
  const barColour = (cl) => cl.c === 8 ? RED14 : cl.c === 11 ? AMB13 : AMB10;   // the whole week-9 bar reads as the outlier
  /** raw red flags breathe on the 1.25 s rhythm of the left page's raw margin rules (24 per loop) */
  const pulse = (t) => 0.85 + 0.15 * Math.cos(TAU * t / 1.25);
  // Ring flash amplitude. Spec: 1.0 (peak green ×2.2). After ~16% fog that crosses the bloom's hard 0.80 threshold
  // (UnrealBloom smoothWidth 0.01) on all 96 wide dashes at once: the glow pops on/off within 1-2 frames, hazes the
  // disc where the B+ stamps, and lifts the frame mean 0.085 → 0.101 (> the 0.09 budget) by itself. 0.6 (peak ×1.8,
  // ≈0.77 after fog) brightens the ring to pale mint without blooming; E8's B+ flash and shock ring carry the bloom.
  const FLASH = 0.6;

  /* ── E6 meshes ── */
  // Emissive floor: with metalness 0.5 and no env map, face-on bodies return ~0 and ACES crushes them to pure ink,
  // darker than the page behind them. Linear (0.0137, 0.0176, 0.0307) lands an unlit face at ≈#141E35 after
  // fog + ACES + vignette + ink screen, i.e. inside the spec's "cell bodies read ≈#121C30-#16213A" target.
  const cellMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(0.20, 0.10, 0.05, 2, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x16213A, metalness: 0.5, roughness: 0.48, emissive: 0x1F2431 }), N);   // 0.48: no one-frame rim glint on tumbling cells
  cellMesh.name = "E6 cells";
  const stripMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.086),
    new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), N);
  stripMesh.name = "E6 rule strips";
  for (let i = 0; i < N; i++) stripMesh.setColorAt(i, NEUTRAL); // allocates instanceColor (Float32, HDR-capable)
  for (const m of [cellMesh, stripMesh]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); GR.add(m); }
  stripMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  /* ── E7 header: group of four word planes (0.675 × 0.20, 512×152 canvas each) + the underline plane ── */
  // Each word is drawn once in white α0.75; its material colour carries the tint (TXT at rest, amber ×1.4 while the
  // word echoes a left-page fix), so the echo never redraws a canvas. White × TXT renders exactly like the old TXT ink.
  const TXT = new THREE.Color(C.txt), AMB14 = hdr(C.amber, 1.4);
  const header = new THREE.Group(); header.name = "E7 header"; header.position.set(0, 0.72, 0.02); GR.add(header);
  const WORDS = ["Date", "Item", "Qty", "Sales"];
  const words = WORDS.map((text, j) => {
    let ink = 0;
    const tex = canvasTex(512, 152, (c2) => {
      c2.font = '600 84px "Plex Thai"'; c2.textAlign = "center"; c2.textBaseline = "alphabetic";
      c2.fillStyle = "rgba(255,255,255,0.75)"; c2.fillText(text, 256, 104);
      ink = c2.measureText(text).width;
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex.tex, color: TXT, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.675, 0.20), mat);
    mesh.name = text; mesh.position.set(-1.0125 + 0.675 * j, 0, 0);      // over columns 0-2, 3-5, 6-8, 9-11
    mesh.userData.textFrac = [(256 - ink / 2) / 512, (256 + ink / 2) / 512];
    header.add(mesh);
    return { text, mat, echoes: SCH.glow.filter(([, wd]) => wd === text).map(([e]) => e) };
  });
  {
    const ulTex = canvasTex(2048, 152, (c2, w) => { c2.fillStyle = "#1F2B45"; c2.fillRect(8, 136, w - 16, 8); }); // ≈ 1 px on the frame, like the page rules
    const ul = new THREE.Mesh(new THREE.PlaneGeometry(2.70, 0.20), new THREE.MeshBasicMaterial({ map: ulTex.tex, transparent: true, depthWrite: false }));
    ul.name = "underline"; header.add(ul);
  }
  /** echo tint for one header word: up over 0.15 s at each of its SCH.glow times, decays over the next 0.80 s */
  const echoOf = (t, es) => { let g = 0; for (const e of es) g = Math.max(g, W(t, e, e + ECHO_UP) * (1 - W(t, e + ECHO_UP, e + ECHO_UP + ECHO_DECAY))); return g; };

  /* ── E7 HEADER ✓ tag: 0.66 × 0.16, canvas at 853 px/u (2× the card density) ── */
  const tagTex = canvasTex(564, 136, (c2, w, h) => {
    c2.lineWidth = 4; c2.strokeStyle = "rgba(52,211,153,0.45)"; roundRect(c2, 3, 3, w - 6, h - 6, 10); c2.stroke();
    c2.font = '500 80px "Plex Mono"'; c2.letterSpacing = "9.6px"; c2.textAlign = "left"; c2.textBaseline = "alphabetic";
    const tw = c2.measureText("HEADER").width - 9.6, gap = 46, cw = 50, x0 = Math.round((w - (tw + gap + cw)) / 2);
    c2.fillStyle = "#34D399"; c2.fillText("HEADER", x0, 96);
    // ✓ drawn as a path (U+2713 is in none of the Plex subsets)
    const cx = x0 + tw + gap;
    c2.lineWidth = 9; c2.lineCap = "round"; c2.lineJoin = "round"; c2.strokeStyle = "#34D399";
    c2.beginPath(); c2.moveTo(cx, 69); c2.lineTo(cx + 16, 87); c2.lineTo(cx + cw, 45); c2.stroke();
  });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.16),
    new THREE.MeshBasicMaterial({ map: tagTex.tex, transparent: true, depthWrite: false }));
  tag.name = "E7 HEADER tag"; tag.position.set(0.95, 0.93, 0.02); GR.add(tag);

  /* ── E7 bar baseline ── */
  const baseline = new THREE.Mesh(new THREE.BoxGeometry(2.80, 0.008, 0.008),
    new THREE.MeshBasicMaterial({ color: hdr(C.edge, 1.5), transparent: true, depthWrite: false }));
  baseline.name = "E7 baseline"; baseline.position.set(0, -1.16, 0); GR.add(baseline);

  /* ── E7 month labels: 0.32 × 0.16 planes (208×104 canvas, 650 px/u as before), typed letter by letter ── */
  // Right-aligned at canvas x 202: the plane centre sits 0.148 left of the group's last column, so the text's right
  // edge lands on that column's centre. Each prefix is drawn from the fixed left x0 = 202 − fullWidth (no re-centring).
  const MX = 202;
  const months = ["Jan", "Feb", "Mar"].map((text, m) => {
    const gs = graphemes(text);
    const tex = canvasTex(208, 104);
    let full = 0;
    tex.redraw((c2) => { c2.font = '500 76px "Plex Thai"'; full = c2.measureText(text).width; });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.16),
      new THREE.MeshBasicMaterial({ map: tex.tex, transparent: true, depthWrite: false }));
    mesh.name = `E7 month ${m}`; mesh.position.set(colX(4 * m + 3) - 0.148, -1.25, 0.02); GR.add(mesh);
    mesh.userData.textFrac = [(MX - full) / 208, MX / 208];
    const o = { gs, tex, mesh, shown: -1 };
    o.draw = (n) => {
      if (n === o.shown) return;
      o.shown = n;
      tex.redraw((c2) => {
        c2.font = '500 76px "Plex Thai"'; c2.fillStyle = "#8C99B5"; c2.textAlign = "left"; c2.textBaseline = "alphabetic";
        c2.fillText(gs.slice(0, n).join(""), MX - full, 80);
      });
    };
    return o;
  });

  /* ── schedule ── */
  const T_GRID = SCH.grid, T_BARS = SCH.bars, [T_RING, T_RGREEN0, T_RGREEN1] = SCH.ring, [T_PEEL, T_RED0, T_RED1] = SCH.peel;
  const [H_IN0, H_IN1, TG_IN0, TG_IN1, H_OUT0, H_OUT1] = SCH.header;
  const [BL_IN0, BL_IN1, BL_OUT0, BL_OUT1] = SCH.baseline, [MO_T0, MO_OUT0, MO_OUT1] = SCH.months;

  function update(t) {
    const th15 = TAU * t / 15, pl = pulse(t);
    const breath = (t >= BR_T0 && t <= BR_T0 + BR_DUR) ? 1 + 0.04 * Math.sin(PI * (t - BR_T0) / BR_DUR) ** 2 : 1;

    for (const cl of cells) {
      let wr = 0;
      if (t < T_BARS) {
        // 01 PARSE: CLOUD → GRID from SCH.grid (nearest first); 02 CLEAN: three flags flip per left-page fix
        cloudAt(cl, th15, pA, qA);
        const w = S((t - T_GRID - cl.d1) / GRID_DUR);
        blend(pA, qA, ONE, cl.grid, IDQ, ONE, w, 0.30, 0.6);
        if (cl.k < 0) col.copy(NEUTRAL);
        else {
          const x = (t - cl.fk) / FLIP_DUR;
          if (x > 0 && x < 1) Q.multiply(qFlip.setFromAxisAngle(AX, TAU * S(x))); // exact full turn, lands identical
          col.copy(RED14).multiplyScalar(pl);
          if (x > 0) col.lerp(AMB12, S((x - 0.3) / 0.4)); // middle 40% of the flip (cell face turned away)
          const tau = t - cl.fk - GLINT_AT;
          if (tau > 0) {
            const gk = tau < GLINT_DUR ? 1.1 + 0.7 * Math.sin(PI * tau / GLINT_DUR) ** 2 : 1.1;
            colB.copy(GREEN).multiplyScalar(gk);
            col.copy(AMB12).lerp(colB, S(tau / GLINT_RISE)); // amber→green crossfade inside the glint's rise
            wr = 0.55 * Math.sin(PI * L.clamp(tau / 0.90)) ** 2;  // the fixed cell briefly fills green: a visible answer to the left-page fix
          }
        }
      } else if (t < T_RING) {
        // 03 CHART: GRID → BARS (done at SCH.breathe[0]), breathing hold
        const w = S((t - T_BARS - BAR_STAG * cl.c) / BAR_DUR);
        barsAt(cl, H[cl.c] * breath, pB, sB);
        blend(cl.grid, IDQ, ONE, pB, IDQ, sB, w, 0.25, 0);
        col.copy(cl.k >= 0 ? GREEN11 : NEUTRAL).lerp(barColour(cl), w);
      } else if (t < T_PEEL) {
        // 04 GRADE: BARS → RING (polar order by column), amber → green, ring flash under the B+ impact
        const w = S((t - T_RING - RING_STAG * cl.c) / RING_DUR);
        barsAt(cl, H[cl.c], pA, sA);
        blend(pA, IDQ, sA, cl.ringP, cl.ringQ, cl.ringS, w, 0.35, 0);
        wr = w;
        col.copy(barColour(cl)).lerp(AMB11, w).lerp(GREEN12, W(t, T_RGREEN0, T_RGREEN1));
        if (t > FL_T0 && t < FL_T1) col.copy(GREEN).multiplyScalar(1.2 + FLASH * Math.sin(PI * (t - FL_T0) / FL_DUR) ** 2);
      } else {
        // reset: RING → CLOUD clockwise peel (lands at 29.90 = the t = 0 cloud); flagged cells turn red again
        const w = S((t - T_PEEL - cl.d4) / PEEL_DUR);
        cloudAt(cl, th15, pB, qA);
        blend(cl.ringP, cl.ringQ, cl.ringS, pB, qA, ONE, w, 0.30, -0.6);
        wr = 1 - w;
        col.copy(GREEN12).lerp(NEUTRAL, w);
        if (cl.k >= 0) col.lerp(colB.copy(RED14).multiplyScalar(pl), W(t, T_RED0, T_RED1));
      }
      mCell.compose(P, Q, SC);
      cellMesh.setMatrixAt(cl.i, mCell);
      // strip = cell · T(mix(−0.087, 0, w_ring), 0, 0.0255) · S(mix(0.022, 0.19, w_ring), 1, 1)
      mStripLocal.makeScale(L.lerp(0.022, 0.19, wr), 1, 1).setPosition(L.lerp(-0.087, 0, wr), 0, 0.0255);
      mStrip.multiplyMatrices(mCell, mStripLocal);
      stripMesh.setMatrixAt(cl.i, mStrip);
      stripMesh.setColorAt(cl.i, col);
    }
    cellMesh.instanceMatrix.needsUpdate = true;
    stripMesh.instanceMatrix.needsUpdate = true;
    stripMesh.instanceColor.needsUpdate = true;

    /* E7 */
    const out = 1 - W(t, H_OUT0, H_OUT1);
    const hl = W(t, H_IN0, H_IN1);
    header.position.y = 0.72 + 0.10 * (1 - hl);
    setOpacity(header, hl * out);
    for (const wd of words) wd.mat.color.copy(TXT).lerp(AMB14, echoOf(t, wd.echoes));
    const tg = W(t, TG_IN0, TG_IN1);
    tag.position.y = 0.93 - 0.05 * (1 - tg);
    setOpacity(tag, tg * out);
    setOpacity(baseline, W(t, BL_IN0, BL_IN1) * (1 - W(t, BL_OUT0, BL_OUT1)));
    const mOut = 1 - W(t, MO_OUT0, MO_OUT1);
    months.forEach((mo, m) => {
      const n = Math.min(mo.gs.length, Math.floor(mo.gs.length * L.clamp((t - MO_T0 - MONTH_STAG * m) / MONTH_TYPE) + 1e-6));
      if (n <= 0 || mOut <= 0) { setOpacity(mo.mesh, 0); return; }
      mo.draw(n);
      setOpacity(mo.mesh, mOut);
    });
  }

  __debug.update = update;
  __debug.meshes = { cellMesh, stripMesh, header, tag, baseline, months: months.map((m) => m.mesh) };
  return { update };
}

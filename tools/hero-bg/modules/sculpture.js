// E6 ledger-cell sculpture (96 instanced cells + a second instanced mesh of glowing rule strips) and
// E7 annotations (header strip, HEADER ✓ tag, bar baseline, month labels). Everything lives in GR.
// update(t) is a pure function of t in [0,15): no state is carried between calls except canvas
// content caches (redraw only when the typed grapheme count changes).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** test hook: the QA script imports this module (same URL = same instance) and drives update(t) without rendering */
export const __debug = {};

export async function build(ctx) {
  const { L, S, W, deg, GR, canvasTex, roundRect, setOpacity, graphemes, hdr, C, TAU, PERIOD } = ctx;
  const R = L.rng(0xDAB); // own stream, so the layout does not depend on other modules' build order
  const NC = 12, NR = 8, N = NC * NR, PI = Math.PI;
  const FLAGS = [[1, 2], [2, 5], [4, 1], [5, 6], [6, 3], [8, 0], [9, 4], [10, 7], [11, 2]];
  const H = [0.95, 1.20, 1.05, 1.45, 1.30, 1.70, 1.55, 1.95, 0.70, 2.10, 1.95, 2.25];
  const TILT = deg(-3);
  const colX = (c) => (c - 5.5) * 0.225;

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
    const i = 8 * c + r, rb = 7 - r;
    const s = 4 * c + (rb % 4), Rr = rb < 4 ? 1.15 : 0.97, phi = PI / 2 - TAU * (s + 0.5) / 48;
    cells.push({
      i, c, r, rb, k: flagK[i], s,
      p: restOf[i],
      n: R() < 0.5 ? 1 : 2, a: R() * TAU, b: R() * TAU, e: R() * TAU,
      rx: deg(-50 + 100 * R()), ry: deg(-50 + 100 * R()), rz: deg(-50 + 100 * R()),
      grid: new THREE.Vector3(colX(c), 0.50 - 0.13 * r, 0),
      ringP: new THREE.Vector3(Rr * Math.cos(phi + TILT), Rr * Math.sin(phi + TILT) + 0.05, 0),
      ringQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi - PI / 2 + TILT),
      ringS: new THREE.Vector3(TAU * Rr / 48 * 0.80 / 0.20, 0.45, 0.6),
      d1: 0, d4: 0.60 * s / 47,
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
  // rank by distance from the cloud position at t = 1.2 to the grid slot: nearest cells land first
  {
    const th = TAU * 1.2 / PERIOD;
    const order = cells.map((cl) => { cloudAt(cl, th, pA, qA); return { cl, d: pA.distanceTo(cl.grid) }; }).sort((x, y) => x.d - y.d);
    order.forEach((o, rank) => { o.cl.d1 = 0.6 * rank / 95; });
  }

  /* ── colours (linear, HDR) ── */
  const NEUTRAL = hdr(C.edge, 1.0), RED14 = hdr(C.red, 1.4), GREEN = hdr(C.green, 1.0);
  const AMB10 = hdr(C.amber, 1.0), AMB11 = hdr(C.amber, 1.1), AMB12 = hdr(C.amber, 1.2), AMB13 = hdr(C.amber, 1.3);
  const GREEN11 = hdr(C.green, 1.1), GREEN12 = hdr(C.green, 1.2);
  const barColour = (cl) => (cl.c === 8 && cl.r === 0) ? RED14 : cl.c === 11 ? AMB13 : AMB10;
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
    new THREE.MeshStandardMaterial({ color: 0x16213A, metalness: 0.5, roughness: 0.38, emissive: 0x1F2431 }), N);
  cellMesh.name = "E6 cells";
  const stripMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.086),
    new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), N);
  stripMesh.name = "E6 rule strips";
  for (let i = 0; i < N; i++) stripMesh.setColorAt(i, NEUTRAL); // allocates instanceColor (Float32, HDR-capable)
  for (const m of [cellMesh, stripMesh]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); GR.add(m); }
  stripMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  /* ── E7 header strip: 2.70 × 0.20, 2048×152 canvas ── */
  const headerTex = canvasTex(2048, 152, (c2, w) => {
    c2.font = '600 84px "Plex Thai"'; c2.textAlign = "center"; c2.textBaseline = "alphabetic";
    c2.fillStyle = "rgba(233,238,247,0.75)";
    ["วันที่", "สินค้า", "จำนวน", "ยอดขาย"].forEach((s, j) => c2.fillText(s, 256 + 512 * j, 104)); // over c 0-2, 3-5, 6-8, 9-11
    c2.fillStyle = "#1F2B45"; c2.fillRect(8, 136, w - 16, 8); // underline ≈ 1 px on the frame, like the page rules
  });
  const header = new THREE.Mesh(new THREE.PlaneGeometry(2.70, 0.20),
    new THREE.MeshBasicMaterial({ map: headerTex.tex, transparent: true, depthWrite: false }));
  header.name = "E7 header"; header.position.set(0, 0.72, 0.02); GR.add(header);

  /* ── E7 HEADER ✓ tag: 0.66 × 0.16, canvas at 853 px/u (2× the card density) ── */
  const tagTex = canvasTex(564, 136, (c2, w, h) => {
    c2.lineWidth = 4; c2.strokeStyle = "rgba(52,211,153,0.45)"; roundRect(c2, 3, 3, w - 6, h - 6, 10); c2.stroke();
    c2.font = '500 80px "Plex Mono"'; c2.letterSpacing = "9.6px"; c2.textAlign = "left"; c2.textBaseline = "alphabetic";
    const tw = c2.measureText("HEADER").width - 9.6, gap = 26, cw = 50, x0 = Math.round((w - (tw + gap + cw)) / 2);
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

  /* ── E7 month labels: 0.80 × 0.16 planes, typed grapheme by grapheme ── */
  const months = ["ม.ค.", "ก.พ.", "มี.ค."].map((text, m) => {
    const gs = graphemes(text);
    const tex = canvasTex(520, 104);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.80, 0.16),
      new THREE.MeshBasicMaterial({ map: tex.tex, transparent: true, depthWrite: false }));
    mesh.name = `E7 month ${m}`; mesh.position.set(-0.90 + 0.90 * m, -1.30, 0.02); GR.add(mesh);
    const o = { gs, tex, mesh, shown: -1 };
    o.draw = (n) => {
      if (n === o.shown) return;
      o.shown = n;
      tex.redraw((c2, w) => {
        c2.font = '500 76px "Plex Thai"'; c2.fillStyle = "#8C99B5"; c2.textAlign = "left"; c2.textBaseline = "alphabetic";
        const x0 = (w - c2.measureText(text).width) / 2; // final layout fixed, so typing does not re-centre
        c2.fillText(gs.slice(0, n).join(""), x0, 80);
      });
    };
    return o;
  });

  function update(t) {
    const th = TAU * t / PERIOD;
    const breath = (t >= 8.4 && t <= 9.6) ? 1 + 0.04 * Math.sin(PI * (t - 8.4) / 1.2) ** 2 : 1;

    for (const cl of cells) {
      let wr = 0;
      if (t < 6.2) {
        // CLOUD → GRID (1.20-3.60), then repairs (4.20-5.37) on the grid
        cloudAt(cl, th, pA, qA);
        const w = S((t - 1.2 - cl.d1) / 1.8);
        blend(pA, qA, ONE, cl.grid, IDQ, ONE, w, 0.30, 0.6);
        if (cl.k < 0) col.copy(NEUTRAL);
        else {
          const x = (t - 4.20 - 0.09 * cl.k) / 0.45;
          if (x > 0 && x < 1) Q.multiply(qFlip.setFromAxisAngle(AX, TAU * S(x))); // exact full turn, lands identical
          col.copy(RED14);
          if (x > 0) col.lerp(AMB12, S((x - 0.3) / 0.4)); // middle 40% of the flip (cell face turned away)
          const tau = t - 5.20 - 0.09 * cl.k;
          if (tau > 0) {
            const gk = tau < 0.25 ? 1.1 + 0.7 * Math.sin(PI * tau / 0.25) ** 2 : 1.1;
            colB.copy(GREEN).multiplyScalar(gk);
            col.copy(AMB12).lerp(colB, S(tau / 0.125)); // amber→green crossfade inside the glint's rise
          }
        }
      } else if (t < 9.6) {
        // GRID → BARS (6.20-8.40), breathing 8.40-9.60
        const w = S((t - 6.2 - 0.06 * cl.c) / 1.54);
        barsAt(cl, H[cl.c] * breath, pB, sB);
        blend(cl.grid, IDQ, ONE, pB, IDQ, sB, w, 0.25, 0);
        col.copy(cl.k >= 0 ? GREEN11 : NEUTRAL).lerp(barColour(cl), w);
      } else if (t < 12.9) {
        // BARS → RING (9.60-11.40), amber→green 10.80-11.40, ring flash 11.62-12.20
        const w = S((t - 9.6 - 0.05 * cl.c) / 1.25);
        barsAt(cl, H[cl.c], pA, sA);
        blend(pA, IDQ, sA, cl.ringP, cl.ringQ, cl.ringS, w, 0.35, 0);
        wr = w;
        col.copy(barColour(cl)).lerp(AMB11, w).lerp(GREEN12, W(t, 10.8, 11.4));
        if (t > 11.62 && t < 12.20) col.copy(GREEN).multiplyScalar(1.2 + FLASH * Math.sin(PI * (t - 11.62) / 0.58) ** 2);
      } else {
        // RING → CLOUD clockwise peel (12.90-14.70); flagged cells turn red again 13.60-14.60
        const w = S((t - 12.9 - cl.d4) / 1.2);
        cloudAt(cl, th, pB, qA);
        blend(cl.ringP, cl.ringQ, cl.ringS, pB, qA, ONE, w, 0.30, -0.6);
        wr = 1 - w;
        col.copy(GREEN12).lerp(NEUTRAL, w);
        if (cl.k >= 0) col.lerp(RED14, W(t, 13.6, 14.6));
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
    const out = 1 - W(t, 6.0, 6.4);
    const hl = W(t, 3.2, 3.8);
    header.position.y = 0.72 + 0.10 * (1 - hl);
    setOpacity(header, hl * out);
    const tg = W(t, 3.7, 4.0);
    tag.position.y = 0.93 - 0.05 * (1 - tg);
    setOpacity(tag, tg * out);
    setOpacity(baseline, W(t, 7.40, 7.90) * (1 - W(t, 9.60, 10.00)));
    const mOut = 1 - W(t, 9.40, 9.70);
    months.forEach((mo, m) => {
      const n = Math.min(mo.gs.length, Math.floor(mo.gs.length * L.clamp((t - 8.20 - 0.2 * m) / 0.2) + 1e-6));
      if (n <= 0 || mOut <= 0) { setOpacity(mo.mesh, 0); return; }
      mo.draw(n);
      setOpacity(mo.mesh, mOut);
    });
  }

  __debug.update = update;
  __debug.meshes = { cellMesh, stripMesh, header, tag, baseline, months: months.map((m) => m.mesh) };
  return { update };
}

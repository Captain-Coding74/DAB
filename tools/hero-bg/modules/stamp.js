// NIGHT AUDIT: Line by Line — module "stamp" (GR, right page), 30 s loop. Every absolute time comes from SCH (schedule.js).
//   E8  extruded B+ grade stamp, shock ring, green point light, sweep light S2, split exit
//       (SCH.stamp, SCH.glight, SCH.flash, SCH.s2).
//   E9  step rail under the sculpture, always visible: 01 PARSE · 02 CLEAN · 03 CHART · 04 GRADE.
//       • number drums roll to an extruded green check when a step completes (SCH.steps.tE);
//       • one shared margin-rule cursor slides to the next row and runs red → amber → warn → green;
//       • the active row shows a segment track whose segments fill on the real events they report (SCH.steps.fills);
//       • the reset rewinds it all back to 01 PARSE (SCH.steps.rewind).
//       States never change scale, so the four-row layout never shifts; pending rows are mute at full opacity.
// update(t) is a pure function of t in [0,30): no canvases, nothing carried between calls. Both point lights exist from
// frame 0 and stay visible at intensity 0 when idle (no shader recompiles).
import * as THREE from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

/** test hook (same pattern as sculpture.js) */
export const __debug = {};

export async function build(ctx) {
  const { L, S, W, deg, GR, fonts, hdr, C, SCH } = ctx;
  const { clamp, lerp } = L;
  const PI = Math.PI, HALF_PI = PI / 2;
  const E = (x) => 1 - Math.pow(1 - clamp(x), 3);           // spec E0: E(x) = 1 − (1 − clamp x)³
  const sin2 = (x) => { const s = Math.sin(PI * clamp(x)); return s * s; };

  /* ─────────────────────────── E8 B+ grade stamp ─────────────────────────── */
  const [ST_IN, ST_PEAK, ST_DECAY, ST_SPLIT, ST_OUT] = SCH.stamp;   // in, flash peak (drop done), flash decayed, split start, split end
  const ST_FADE = 0.10;                                              // opacity rises over the first 0.10 s of the drop
  const [GL_UP, GL_TOP, GL_DECAY, GL_OFF] = SCH.glight;              // green light: up, peak, decayed to 32 %, out
  const [SH_T0, SH_T1] = SCH.flash;                                  // shock ring shares the ring-flash window (sculpture.js)
  const [S2_T0, S2_DUR] = SCH.s2;

  // plex-mono-500 (the console's .grade font): size 0.80, depth 0.16, mono pitch 0.48 (600/1000 em).
  const TG_BP = { font: fonts.mono500, size: 0.80, depth: 0.16, curveSegments: 8, bevelEnabled: true,
    bevelThickness: 0.016, bevelSize: 0.012, bevelSegments: 3 };
  const BP_PITCH = 0.48;
  const gB = new TextGeometry("B", TG_BP); gB.computeBoundingBox();
  const bpCapC = (gB.boundingBox.min.y + gB.boundingBox.max.y) / 2;   // cap centre of 'B' (shared by '+': keeps its typographic height)
  const bpZC = (gB.boundingBox.min.z + gB.boundingBox.max.z) / 2;
  const gPlus = new TextGeometry("+", TG_BP);
  // pivot = advance centre / B cap centre / depth centre, so scale and the split exit act about each glyph's own middle
  for (const g of [gB, gPlus]) { g.translate(-BP_PITCH / 2, -bpCapC, -bpZC); g.computeBoundingBox(); g.computeBoundingSphere(); }

  const stamp = new THREE.Group(); stamp.name = "E8 stamp";
  stamp.position.set(0, 0.05, 0.12); stamp.rotation.z = deg(-3);    // centred on the ring, fixed −3° tilt (CSS stampIn)
  GR.add(stamp);
  const glyphsBP = [["B", gB, -1], ["+", gPlus, +1]].map(([ch, g, side]) => {
    const mats = [
      new THREE.MeshStandardMaterial({ color: C.green, emissive: C.green, emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.10, transparent: true }),
      new THREE.MeshStandardMaterial({ color: 0x0F5A44, emissive: C.green, emissiveIntensity: 0.10, metalness: 0.25, roughness: 0.80, transparent: true }),   // deep-green walls read as depth; 0.80 kills the S2 and rim glints
    ];
    const pivot = new THREE.Group(); pivot.position.x = side * BP_PITCH / 2;
    const mesh = new THREE.Mesh(g, mats); mesh.name = `E8 ${ch}`; mesh.renderOrder = 4;
    pivot.add(mesh); stamp.add(pivot);
    return { side, pivot, mesh, mats };
  });

  // shock ring: TorusGeometry(1.06, 0.008, 6, 96) at the ring centre, sits in the gap of the double border
  const shockMat = new THREE.MeshBasicMaterial({ color: hdr(C.green, 2.0), transparent: true, opacity: 0, depthWrite: false });
  const shock = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.008, 6, 96), shockMat);
  shock.name = "E8 shock ring"; shock.position.set(0, 0.05, 0.03); shock.renderOrder = 4; shock.visible = false; GR.add(shock);

  // event lights: direct children of GR (never inside a group that setOpacity/visibility may hide)
  const gLight = new THREE.PointLight(C.green, 0, 4, 2); gLight.position.set(0, 0.05, 0.90); gLight.name = "E8 green light"; GR.add(gLight);
  const s2 = new THREE.PointLight(C.warn, 0, 3, 2); s2.position.set(-0.75, 0.63, 0.9); s2.name = "E8 sweep S2"; GR.add(s2);

  // Light / flash amplitudes (tuned on full-scene frames in the 15 s review rounds, kept):
  //  • green light 1.0 (spec once 2.5), B+ face emissive 0.55 → 1.50 (EM_FLASH 0.95), S2 3.0 raking linearly B → +:
  //    a short green bloom around the glyph edges, the frame mean stays inside budget and K1 is untouched.
  //  • shock ring ×1.16 (was 1.22): with GR raised 0.24 for the rail its AABB top reaches frame y 304; ×1.22 would be 296,
  //    inside K1a (ends 300).
  const S2_PEAK = 1.2, GL_PEAK = 1.0, EM_FLASH = 0.95, SHOCK_GROW = 0.16;   // S2 1.2: at 3.0 the 'B' bloomed brighter than the impact itself
  function updateStamp(t) {
    // green light: peaks with the stamp, decays to 32 % by GL_DECAY, out by GL_OFF
    gLight.intensity = GL_PEAK * (t < GL_TOP ? W(t, GL_UP, GL_TOP) : 1 - 0.68 * W(t, GL_TOP, GL_DECAY)) * (1 - W(t, GL_DECAY, GL_OFF));
    // sweep S2: diagonal rake, sin envelope (0 at both ends)
    if (t > S2_T0 && t < S2_T0 + S2_DUR) {
      const k = (t - S2_T0) / S2_DUR;   // linear: a constant-speed rake reads as one travelling glint
      s2.position.set(lerp(-0.75, 0.75, k), lerp(0.63, -0.47, k), 0.9);
      s2.intensity = S2_PEAK * Math.sin(PI * k);
    } else { s2.position.set(-0.75, 0.63, 0.9); s2.intensity = 0; }
    // shock ring: scale 1 → 1.16 (E), opacity 0.6 → 0
    if (t > SH_T0 && t < SH_T1) {
      const x = (t - SH_T0) / (SH_T1 - SH_T0);
      shock.scale.setScalar(1 + SHOCK_GROW * E(x));
      shockMat.opacity = 0.6 * (1 - S(x));
      shock.visible = shockMat.opacity >= 0.004;
    } else { shock.scale.setScalar(1); shockMat.opacity = 0; shock.visible = false; }

    // B+: drops in ST_IN → ST_PEAK, flash (emissive 0.55 → 0.55 + EM_FLASH) decays by ST_DECAY, split exit ST_SPLIT → ST_OUT;
    // hidden outside [ST_IN, ST_OUT)
    if (t < ST_IN || t >= ST_OUT) { stamp.visible = false; return; }
    const e = E((t - ST_IN) / (ST_PEAK - ST_IN));
    stamp.scale.setScalar(lerp(1.25, 1.0, e));
    stamp.position.z = 0.12 + 0.50 * (1 - e);
    stamp.rotation.set(deg(10) * (1 - e), deg(-20) * (1 - e), deg(-3));
    const x2 = W(t, ST_SPLIT, ST_OUT);
    const op = W(t, ST_IN, ST_IN + ST_FADE) * (1 - x2);
    const em = (0.55 + EM_FLASH * (t < ST_PEAK ? W(t, ST_IN, ST_PEAK) : 1 - W(t, ST_PEAK, ST_DECAY))) * (1 - x2);
    stamp.visible = op >= 0.004;
    for (const g of glyphsBP) {
      g.pivot.position.set(g.side * (BP_PITCH / 2 + 0.25 * x2), 0, -0.80 * x2);
      g.pivot.scale.setScalar(1 - 0.15 * x2);
      g.mats[0].emissiveIntensity = em;
      g.mats[0].opacity = g.mats[1].opacity = op;
    }
  }

  /* ─────────────────────────── E9 step rail ─────────────────────────── */
  const { tE: TE, fills: EV, rewind: RW } = SCH.steps;
  const NROW = 4;
  const WORDS = ["PARSE", "CLEAN", "CHART", "GRADE"];
  const STEP = [C.red, C.amber, C.warn, C.green].map((h) => new THREE.Color(h));   // severity hue of each step (linear)
  const CUR = STEP.map((c) => c.clone().multiplyScalar(1.1));                        // cursor stops: each hue ×1.1
  const MUTE = new THREE.Color(C.mute), TXT = new THREE.Color(C.txt);
  const rowY = (r) => -1.58 - 0.24 * r;                                              // baselines −1.58, −1.82, −2.06, −2.30

  // Hand-over after each tE_k (offsets in seconds after the event; the absolute anchors are SCH.steps.tE / .rewind):
  const ROLL = 0.40, LAG = 0.05;                   // number → check roll; units and check trail the tens by 0.05
  const SLIDE = [0.10, 0.45];                      // cursor slide starts tE + 0.10, takes 0.45
  const RELAX = [0.10, 0.50], ACT = [0.20, 0.60];  // finished row relaxes (and counts as done) / next row goes active
  const T_OUT = [0.10, 0.35], T_IN = [0.20, 0.60]; // finished row's track fades out / next row's track fades in
  const GLINT = [0.20, 0.30];                      // check glint: starts tE + 0.20, lasts 0.30
  const FILL = 0.30, FILL_GLOW = 0.60;             // segment fill time; its colour lift (×1.10 → ×1.35 → ×1.10)
  // Rewind (offsets after SCH.steps.rewind): checks roll back on rows 3, 2, 1, 0, 0.08 s apart, 0.35 s each; the cursor
  // glides 3 → 0; GRADE relaxes and its track fades; PARSE goes active and its track returns.
  const RB_STAG = 0.08, RB_DUR = 0.35, RW_CUR = [0.05, 0.60], RW_RELAX = [0.05, 0.45], RW_T_OUT = [0.05, 0.30], RW_ACT = [0.30, 0.70];
  const rb = (k) => RW + RB_STAG * (NROW - 1 - k);   // 29.39, 29.31, 29.23, 29.15 for rows 0-3
  // each row's "leave" window (relax, track out): its own tE for rows 0-2; the rewind for GRADE, which holds the all-checked state
  const relaxWin = (k) => (k < NROW - 1 ? [TE[k] + RELAX[0], TE[k] + RELAX[1]] : [RW + RW_RELAX[0], RW + RW_RELAX[1]]);
  const tOutWin = (k) => (k < NROW - 1 ? [TE[k] + T_OUT[0], TE[k] + T_OUT[1]] : [RW + RW_T_OUT[0], RW + RW_T_OUT[1]]);

  /** active weight a_k: row 0 is active from the rewind through tE_0; row k > 0 from tE_{k−1} until it is left */
  function activeW(k, t) {
    const [r0, r1] = relaxWin(k);
    if (k === 0) return 1 - W(t, r0, r1) + W(t, RW + RW_ACT[0], RW + RW_ACT[1]);
    return W(t, TE[k - 1] + ACT[0], TE[k - 1] + ACT[1]) * (1 - W(t, r0, r1));
  }
  /** track visibility v_k */
  function trackV(k, t) {
    const [o0, o1] = tOutWin(k);
    if (k === 0) return 1 - W(t, o0, o1) + W(t, RW + RW_ACT[0], RW + RW_ACT[1]);
    return W(t, TE[k - 1] + T_IN[0], TE[k - 1] + T_IN[1]) * (1 - W(t, o0, o1));
  }
  const doneW = (k, t) => W(t, TE[k] + RELAX[0], TE[k] + RELAX[1]) * (1 - W(t, RW + RW_RELAX[0], RW + RW_RELAX[1]));
  const rho = (k, t) => W(t, TE[k], TE[k] + ROLL) * (1 - W(t, rb(k), rb(k) + RB_DUR));
  /** cursor row r(t) ∈ [0, 3], continuous */
  const cursorR = (t) => S((t - TE[0] - SLIDE[0]) / SLIDE[1]) + S((t - TE[1] - SLIDE[0]) / SLIDE[1]) + S((t - TE[2] - SLIDE[0]) / SLIDE[1])
    - 3 * S((t - RW - RW_CUR[0]) / RW_CUR[1]);

  const rail = new THREE.Group(); rail.name = "E9 rail"; rail.position.set(0, 0, 0.02); GR.add(rail);

  // Mono TextGeometry: numbers size 0.16 (pitch 0.096), words size 0.21 (pitch 0.126, 'PARSE' spans 0.28-0.91)
  const TG_N = { font: fonts.mono500, size: 0.16, depth: 0.035, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2 };
  const TG_R = { font: fonts.mono500, size: 0.21, depth: 0.045, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 2 };
  const N_PITCH = 0.096, N_AXLE = 0.06, WORD_X = 0.28;
  const geoCache = {};
  const geo = (ch, tg) => {
    const k = ch + "|" + tg.size;
    if (!geoCache[k]) { const g = new TextGeometry(ch, tg); g.computeBoundingBox(); g.computeBoundingSphere(); geoCache[k] = g; }
    return geoCache[k];
  };
  const capCentre = (ch, tg) => { const b = geo(ch, tg).boundingBox; return (b.min.y + b.max.y) / 2; };
  const capN = capCentre("0", TG_N);   // ≈ 0.056

  // captionMats of the 15 s caption, with matte walls: at rail size (≈ 14-18 px caps) the 0.5 / 0.35 panel-metal walls caught the
  // amber rim lights as 1-px orange slivers along every mute letter (0.2 / 0.7 still did), so the pending rows read dirty.
  const SIDE = { metalness: 0.0, roughness: 0.9 };
  const captionMats = () => [
    new THREE.MeshStandardMaterial({ color: C.mute, emissive: C.mute, emissiveIntensity: 0.06, roughness: 0.5, metalness: 0.0, transparent: true }),
    new THREE.MeshStandardMaterial({ color: C.panel, metalness: SIDE.metalness, roughness: SIDE.roughness, transparent: true }),
  ];
  /** one drum glyph: pivot sits on the horizontal axle (slot centre x, cap centre y, `axle` behind the front face) */
  function drumGlyph(ch, tg, pitch, capC, axle, x, name, baseY, parent) {
    const zF = tg.depth + tg.bevelThickness;                 // front face z of the TextGeometry
    const mats = captionMats();
    const mesh = new THREE.Mesh(geo(ch, tg), mats); mesh.name = name; mesh.renderOrder = 3;
    mesh.position.set(-pitch / 2, -capC, axle - zF);
    const pivot = new THREE.Group(); pivot.position.set(x, baseY + capC, zF - axle); pivot.add(mesh);
    parent.add(pivot);
    return { pivot, mesh, mats };
  }
  const setDrum = (o, angle) => {                            // rotation.x about the axle; fades only near edge-on
    const a = S((Math.cos(angle) - 0.62) / 0.30);   // a face is gone well before its neighbour arrives: no stacked glyphs mid-roll
    o.pivot.rotation.x = angle;
    o.pivot.visible = a >= 0.004;
    o.mats[0].opacity = o.mats[1].opacity = a;
  };

  // green check (U+2713 is in no Plex subset): a mitred stroke 0.026 wide, ≈ 0.14 × 0.12, centred on the origin
  const checkShape = new THREE.Shape([[-0.0482, 0.0125], [-0.0197, -0.0204], [0.0524, 0.0588], [0.0716, 0.0412], [-0.0203, -0.0596], [-0.0678, -0.0045]]
    .map(([x, y]) => new THREE.Vector2(x, y)));
  const CHK = { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 1 };
  const checkGeo = new THREE.ExtrudeGeometry(checkShape, CHK); checkGeo.computeBoundingBox(); checkGeo.computeBoundingSphere();
  const CHK_ZF = CHK.depth + CHK.bevelThickness;

  // segment tracks under each word: y_k − 0.05, 0.016 high, 0.006 deep, x 0.28-0.91 split with 0.03 gaps
  const SEGS = [[[0.28, 0.58], [0.61, 0.91]], [[0.28, 0.47], [0.50, 0.69], [0.72, 0.91]], [[0.28, 0.91]], [[0.28, 0.91]]];
  const TRK_H = 0.016, TRK_D = 0.006, TRK_DY = -0.05;
  const fillGeo = new THREE.BoxGeometry(1, TRK_H, TRK_D); fillGeo.translate(0.5, 0, 0);   // x ∈ [0, 1]: scale.x = length × fill
  const trackBaseCol = hdr(C.edge, 1.3);
  const tmpC = new THREE.Color();

  const rows = WORDS.map((word, k) => {
    const y = rowY(k);
    const row = new THREE.Group(); row.name = `row ${k}`; rail.add(row);
    const tens = drumGlyph("0", TG_N, N_PITCH, capN, N_AXLE, N_PITCH / 2, `E9 num ${k} tens`, y, row);
    const units = drumGlyph(String(k + 1), TG_N, N_PITCH, capN, N_AXLE, 1.5 * N_PITCH, `E9 num ${k} units`, y, row);
    // check: its own drum pivot centred between the two digit slots, on the digits' cap centre
    const cMats = [
      new THREE.MeshStandardMaterial({ color: C.green, emissive: C.green, emissiveIntensity: 0.45, roughness: 0.55, metalness: 0.10, transparent: true }),
      new THREE.MeshStandardMaterial({ color: 0x0F5A44, emissive: C.green, emissiveIntensity: 0.10, metalness: 0.25, roughness: 0.55, transparent: true }),
    ];
    const cMesh = new THREE.Mesh(checkGeo, cMats); cMesh.name = `E9 check ${k}`; cMesh.renderOrder = 3;
    cMesh.position.set(0, 0, N_AXLE - CHK_ZF);
    const cPivot = new THREE.Group(); cPivot.position.set(N_PITCH, y + capN, CHK_ZF - N_AXLE); cPivot.add(cMesh); row.add(cPivot);
    const check = { pivot: cPivot, mesh: cMesh, mats: cMats };
    // word: one static TextGeometry, full opacity in every state
    const wMats = captionMats(); wMats.forEach((m) => { m.transparent = false; });
    const wMesh = new THREE.Mesh(geo(word, TG_R), wMats); wMesh.name = `E9 word ${word}`; wMesh.renderOrder = 3;
    wMesh.position.set(WORD_X, y, 0); row.add(wMesh);
    // track: base segments + fills (one fill per event of this step)
    const track = new THREE.Group(); track.name = `E9 track ${k}`; track.position.set(0, y + TRK_DY, 0); row.add(track);
    const baseMat = new THREE.MeshBasicMaterial({ color: trackBaseCol, transparent: true, depthWrite: false });
    const segs = SEGS[k].map(([x0, x1], j) => {
      const base = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, TRK_H, TRK_D), baseMat);
      base.name = `E9 seg ${k}.${j}`; base.position.set((x0 + x1) / 2, 0, 0); base.renderOrder = 2; track.add(base);
      const fMat = new THREE.MeshBasicMaterial({ color: STEP[k].clone(), transparent: true, depthWrite: false });
      const fill = new THREE.Mesh(fillGeo, fMat); fill.name = `E9 fill ${k}.${j}`;
      fill.position.set(x0, 0, 0.002); fill.renderOrder = 3; track.add(fill);
      return { len: x1 - x0, fill, fMat, ev: EV[k][j] };
    });
    if (segs.length !== EV[k].length) throw new Error(`stamp: row ${k} has ${segs.length} segments but ${EV[k].length} events`);
    // the fills empty again (t ≥ out) once the track has faded, so they are 0 before it reappears
    const out = tOutWin(k)[1];
    return { k, tens, units, check, wMats, track, baseMat, segs, out };
  });

  // cursor: one margin rule shared by all rows, left of the numbers
  const curMat = new THREE.MeshBasicMaterial({ color: CUR[0].clone() });
  const cursor = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.19, 0.012), curMat);
  cursor.name = "E9 cursor"; cursor.position.set(-0.06, rowY(0) + 0.074, 0); cursor.renderOrder = 3; rail.add(cursor);

  // Emissive of a pending row (number and word). Spec: 0.06 + 0.26·a (word) / 0.06 + 0.39·a (number). Measured through the real
  // landing-page scrim (.66 video, edge + bottom gradients) the pending rows sat at contrast ≈ 1.08-1.11 against the page, so
  // '04 GRADE' all but vanished. 0.28 lifts the pending rows, and landing.html now limits its bottom fade to the last 150 px
  // (it used to start at 60% of the stage and sat right on the rail at 1920-2560 px). The active row keeps 0.32 / 0.45.
  const PEND = 0.28;
  const CUR_PULSE = 1.25;   // s: the raw red rhythm (flags, margin rules); 24 per loop
  function updateRail(t) {
    // cursor
    const r = clamp(cursorR(t), 0, NROW - 1);
    cursor.position.y = rowY(r) + 0.074;
    const i = Math.min(NROW - 2, Math.floor(r));
    curMat.color.copy(CUR[i]).lerp(CUR[i + 1], r - i).multiplyScalar(0.85 + 0.15 * Math.cos(2 * PI * t / CUR_PULSE));

    for (const R of rows) {
      const { k } = R;
      const a = activeW(k, t), d = doneW(k, t);
      // word: mute → text while active, a touch more glow once done
      tmpC.copy(MUTE).lerp(TXT, a);
      R.wMats[0].color.copy(tmpC); R.wMats[0].emissive.copy(tmpC); R.wMats[0].emissiveIntensity = lerp(PEND, 0.32, a) + 0.06 * d;
      // number: mute → step hue while active
      tmpC.copy(MUTE).lerp(STEP[k], a);
      for (const o of [R.tens, R.units]) { o.mats[0].color.copy(tmpC); o.mats[0].emissive.copy(tmpC); o.mats[0].emissiveIntensity = lerp(PEND, 0.45, a); }
      // drums: the number rolls up and away, the check rolls in from below (and back in the rewind)
      // forward: tens, then units, then the check rolls in. Rewind: the check leaves first and the digits return 2·LAG later.
      const fwd = (dt) => W(t - dt, TE[k], TE[k] + ROLL), back = (dt) => W(t - dt, rb(k), rb(k) + RB_DUR);
      setDrum(R.tens, -HALF_PI * fwd(0) * (1 - back(2 * LAG)));
      setDrum(R.units, -HALF_PI * fwd(LAG) * (1 - back(2 * LAG)));
      setDrum(R.check, HALF_PI * (1 - fwd(LAG) * (1 - back(0))));
      R.check.mats[0].emissiveIntensity = 0.45 + 0.9 * sin2((t - TE[k] - GLINT[0]) / GLINT[1]);
      // track
      const v = clamp(trackV(k, t));
      R.track.visible = v >= 0.004;
      R.baseMat.opacity = v;
      for (const sg of R.segs) {
        const f = t < R.out ? W(t, sg.ev, sg.ev + FILL) : 0;
        sg.fill.visible = f > 0;
        sg.fill.scale.x = Math.max(1e-4, sg.len * f);
        sg.fMat.opacity = v;
        sg.fMat.color.copy(STEP[k]).multiplyScalar(1.10 + 0.25 * sin2((t - sg.ev) / FILL_GLOW));
      }
    }
  }

  function update(t) { updateStamp(t); updateRail(t); }
  __debug.update = update;
  __debug.objects = { stamp, shock, gLight, s2, rail, cursor, rows };
  __debug.fn = { activeW, trackV, doneW, rho, cursorR };
  return { update };
}

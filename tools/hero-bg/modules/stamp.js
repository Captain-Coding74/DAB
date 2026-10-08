// NIGHT AUDIT — module "stamp" (GR, right page):
//   E8 extruded B+ grade stamp, shock ring, green point light, sweep light S2, split exit.
//   E9 act caption below the sculpture: 0N step drum, 5-slot drum-roll mono word, crossfading Thai word, under-rule.
// update(t) is a pure function of t in [0,15). Every canvas is drawn once at build time; nothing is carried between
// calls. Both point lights exist from frame 0 and stay visible at intensity 0 when idle (no shader recompiles).
import * as THREE from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

/** test hook (same pattern as sculpture.js) */
export const __debug = {};

export async function build(ctx) {
  const { L, S, W, deg, GR, fonts, canvasTex, hdr, C } = ctx;
  const { clamp, lerp } = L;
  const PI = Math.PI, HALF_PI = PI / 2;
  const E = (x) => 1 - Math.pow(1 - clamp(x), 3);           // spec E0: E(x) = 1 − (1 − clamp x)³

  /* ─────────────────────────── E8 B+ grade stamp ─────────────────────────── */
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
      new THREE.MeshStandardMaterial({ color: 0x0F5A44, emissive: C.green, emissiveIntensity: 0.10, metalness: 0.25, roughness: 0.55, transparent: true }),   // deep-green walls read as depth, not a black drop shadow
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

  // Light / flash amplitudes (measured on full-scene frames, all three modules loaded):
  //  • Spec values (green light 2.5, face emissive 0.55 → 2.0, S2 3.0) push the frame mean from 0.088 to 0.103 at 11.65
  //    (budget ≤ 0.09), the B+ face to 0.91 post-grade (budget ≤ 0.85), wash it to white-mint (ACES desaturates), and the
  //    bloom spreads a green haze over the whole ring disc and +0.006 into K1. At 12.40 S2 passes 0.33 u in front of the
  //    face and floods it into a second yellow-white bloom blob that is not in the spec's list of bloom events.
  //  • GL_PEAK 1.0 + EM_FLASH 0.95 (face emissive peak 1.5) keep a short green bloom around the glyph edges: mean 0.094 at
  //    the peak frame, 0.092 by 11.90, K1 +0.0015, B+ peak 0.88. S2 now rakes linearly at 3.0 over rougher bevels, so the glint travels B → + without flicker.
  const S2_PEAK = 3.0, GL_PEAK = 1.0, EM_FLASH = 0.95;
  function updateStamp(t) {
    // green light: peaks at 11.65 (spec 2.5, see GL_PEAK), decays to 32% by 12.40, out by 13.40
    gLight.intensity = GL_PEAK * (t < 11.65 ? W(t, 11.45, 11.65) : 1 - 0.68 * W(t, 11.65, 12.40)) * (1 - W(t, 12.40, 13.40));
    // sweep S2 11.90-12.90: diagonal rake, sin envelope (0 at both ends)
    if (t > 11.90 && t < 12.90) {
      const k = (t - 11.90) / 1.0;   // linear: a constant-speed rake reads as one travelling glint
      s2.position.set(lerp(-0.75, 0.75, k), lerp(0.63, -0.47, k), 0.9);
      s2.intensity = S2_PEAK * Math.sin(PI * (t - 11.90) / 1.0);
    } else { s2.position.set(-0.75, 0.63, 0.9); s2.intensity = 0; }
    // shock ring 11.62-12.20: scale 1→1.22 (E), opacity 0.6→0
    if (t > 11.62 && t < 12.20) {
      const x = (t - 11.62) / 0.58;
      shock.scale.setScalar(1 + 0.22 * E(x));   // 1.35 reached into the sub-line zone with the wider camera move
      shockMat.opacity = 0.6 * (1 - S(x));
      shock.visible = shockMat.opacity >= 0.004;
    } else { shock.scale.setScalar(1); shockMat.opacity = 0; shock.visible = false; }

    // B+ : stamp 11.35-11.65, flash (emissive 0.55 → 0.55 + EM_FLASH) decays to 12.40, split exit 12.90-13.60; zero outside [11.35, 13.60]
    if (t < 11.35 || t >= 13.60) { stamp.visible = false; return; }
    const e = E((t - 11.35) / 0.30);
    stamp.scale.setScalar(lerp(1.25, 1.0, e));
    stamp.position.z = 0.12 + 0.50 * (1 - e);
    stamp.rotation.set(deg(10) * (1 - e), deg(-20) * (1 - e), deg(-3));
    const x2 = W(t, 12.90, 13.60);
    const op = W(t, 11.35, 11.45) * (1 - x2);
    const em = (0.55 + EM_FLASH * (t < 11.65 ? W(t, 11.35, 11.65) : 1 - W(t, 11.65, 12.40))) * (1 - x2);
    stamp.visible = op >= 0.004;
    for (const g of glyphsBP) {
      g.pivot.position.set(g.side * (BP_PITCH / 2 + 0.25 * x2), 0, -0.80 * x2);
      g.pivot.scale.setScalar(1 - 0.15 * x2);
      g.mats[0].emissiveIntensity = em;
      g.mats[0].opacity = g.mats[1].opacity = op;
    }
  }

  /* ─────────────────────────── E9 act caption ─────────────────────────── */
  const WORDS = ["PARSE", "CLEAN", "CHART", "GRADE"];
  const THAI = ["อ่านไฟล์", "แก้ค่า", "วาดกราฟ", "ให้เกรด"];
  const TR = [3.60, 7.35, 11.10, 13.90];                     // roll window starts
  const RULE = [hdr(C.red, 1.1), hdr(C.amber, 1.1), hdr(C.warn, 1.1), hdr(C.green, 1.1)];
  const BASE_Y = -1.88;
  const TG_W = { font: fonts.mono500, size: 0.26, depth: 0.05, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2 };
  const TG_D = { font: fonts.mono500, size: 0.18, depth: 0.04, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.003, bevelSegments: 2 };
  const W_PITCH = 0.6 * TG_W.size, D_PITCH = 0.6 * TG_D.size;   // 0.156, 0.108
  const W_AXLE = 0.12, D_AXLE = 0.12 * TG_D.size / TG_W.size;   // axle 0.12 behind the face (digits: scaled to their size)

  const geoCache = {};
  const geo = (ch, tg) => {
    const k = ch + "|" + tg.size;
    if (!geoCache[k]) { const g = new TextGeometry(ch, tg); g.computeBoundingBox(); g.computeBoundingSphere(); geoCache[k] = g; }
    return geoCache[k];
  };
  const capCentre = (ch, tg) => { const b = geo(ch, tg).boundingBox; return (b.min.y + b.max.y) / 2; };
  const capW = capCentre("E", TG_W), capD = capCentre("0", TG_D);

  const caption = new THREE.Group(); caption.name = "E9 caption"; caption.position.x = 0.50; GR.add(caption);   // +0.50: clears the console edge when narrow laptops width-fit the video
  const captionMats = () => [
    new THREE.MeshStandardMaterial({ color: C.txt, emissive: C.txt, emissiveIntensity: 0.15, roughness: 0.5, metalness: 0.0, transparent: true }),
    new THREE.MeshStandardMaterial({ color: C.panel, metalness: 0.5, roughness: 0.35, transparent: true }),
  ];
  /** one drum glyph: pivot sits on the horizontal axle (slot centre x, cap centre y, `axle` behind the front face) */
  function drumGlyph(ch, tg, pitch, capC, axle, x, name) {
    const zF = tg.depth + tg.bevelThickness;                 // front face z of the TextGeometry
    const mats = captionMats();
    const mesh = new THREE.Mesh(geo(ch, tg), mats); mesh.name = name; mesh.renderOrder = 3;
    mesh.position.set(-pitch / 2, -capC, axle - zF);
    const pivot = new THREE.Group(); pivot.position.set(x, BASE_Y + capC, zF - axle); pivot.add(mesh);
    caption.add(pivot);
    return { pivot, mesh, mats };
  }
  const setDrum = (o, angle) => {                            // rotation.x about the axle; fades only near edge-on
    const a = S((Math.cos(angle) - 0.45) / 0.40);
    o.pivot.rotation.x = angle;
    o.pivot.visible = a >= 0.004;
    o.mats[0].opacity = o.mats[1].opacity = a;
  };

  // word: 5 slots from x −0.30, each slot holds one glyph per act (outgoing + incoming are two of these)
  const slots = [];
  for (let s = 0; s < 5; s++) {
    const x = -0.30 + (s + 0.5) * W_PITCH;
    slots.push(WORDS.map((w, k) => drumGlyph(w[s], TG_W, W_PITCH, capW, W_AXLE, x, `E9 word ${s}${w[s]}${k}`)));
  }
  // step number '0N' at (−0.62, −1.88): '0' static, units digit is a drum
  const zero = new THREE.Mesh(geo("0", TG_D), captionMats()); zero.name = "E9 step 0"; zero.renderOrder = 3;
  zero.position.set(-0.62, BASE_Y, 0); caption.add(zero);
  const stepDrum = [1, 2, 3, 4].map((n, k) => drumGlyph(String(n), TG_D, D_PITCH, capD, D_AXLE, -0.62 + 1.5 * D_PITCH, `E9 step ${n}`));

  // Thai word: one 1024×160 canvas per word (Plex Thai 600, #E9EEF7 α0.80) on a 1.40 × 0.22 plane at (0.40, −1.55).
  // Font size: spec says 96 px, but on a 160 px canvas mapped to 0.22 u that gives a ≈8 px consonant body on the frame
  // (unreadable through the page scrim). 140 px fills the plane: tallest stack (ไ/ใ + tone) ≈ 0.90 em = 126 px, consonant
  // body ≈ 0.56 em ≈ 13.5 px on the frame. One shared baseline 4 px under the tallest ink, ≈ 6 px above the word's caps.
  const THAI_FONT = '600 140px "Plex Thai"';
  const meas = document.createElement("canvas").getContext("2d"); meas.font = THAI_FONT;
  let asc = 0;
  for (const w of THAI) asc = Math.max(asc, meas.measureText(w).actualBoundingBoxAscent);
  const THAI_BASE = Math.min(156, Math.ceil(4 + asc));
  const thaiGeo = new THREE.PlaneGeometry(1.40, 0.22);
  const thai = THAI.map((w, k) => {
    const ct = canvasTex(1024, 160, (c2) => {
      c2.font = THAI_FONT; c2.fillStyle = "rgba(233,238,247,0.80)"; c2.textAlign = "left"; c2.textBaseline = "alphabetic";
      c2.fillText(w, 10, THAI_BASE);                         // left-aligned at x −0.30 (ให้ overhangs its origin by ≈6 px)
    });
    const mesh = new THREE.Mesh(thaiGeo, new THREE.MeshBasicMaterial({ map: ct.tex, transparent: true, depthWrite: false }));
    mesh.name = `E9 thai ${k}`; mesh.position.set(0.40, -1.55, 0.01); mesh.renderOrder = 2; mesh.visible = false;
    caption.add(mesh);
    return mesh;
  });
  const setThai = (k, a, dy) => { const m = thai[k]; m.visible = a >= 0.004; m.material.opacity = a; m.position.y = -1.55 + dy; };

  // under-rule: Box 1.62 × 0.02 × 0.01 at (0.15, −1.97), act colour ×1.1 (linear lerp)
  const ruleMat = new THREE.MeshBasicMaterial({ color: RULE[0].clone() });
  const rule = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.02, 0.01), ruleMat);
  rule.name = "E9 under-rule"; rule.position.set(0.15, -1.97, 0); caption.add(rule);

  function updateCaption(t) {
    // which roll are we in (or past)? before 3.60 (and after 14.73, via the k=3 roll ending on act 0) the state is PARSE / red
    let k = -1;
    for (let i = 0; i < 4; i++) if (t >= TR[i]) k = i;
    const from = k < 0 ? 0 : k, to = k < 0 ? 0 : (k + 1) % 4, tr = k < 0 ? -1e9 : TR[k];

    for (let s = 0; s < 5; s++) {
      const p = S((t - tr - 0.07 * s) / 0.40);
      slots[s].forEach((o, j) => {
        if (j === to) setDrum(o, HALF_PI * (1 - p));          // incoming: +90° → 0
        else if (j === from) setDrum(o, -HALF_PI * p);        // outgoing: 0 → −90°
        else { o.pivot.visible = false; }
      });
    }
    const pd = S((t - tr) / 0.40);                           // step digit rolls with slot 0
    stepDrum.forEach((o, j) => {
      if (j === to) setDrum(o, HALF_PI * (1 - pd));
      else if (j === from) setDrum(o, -HALF_PI * pd);
      else o.pivot.visible = false;
    });

    const w = S((t - tr - 0.15) / 0.25);                     // Thai crossfade [t_r + 0.15, t_r + 0.40]
    thai.forEach((m) => { m.visible = false; });
    if (from === to) setThai(to, 1, 0);
    else { setThai(from, 1 - S(2 * w), 0.05 * w); setThai(to, S(2 * w - 1), -0.05 * (1 - w)); }

    ruleMat.color.copy(RULE[from]).lerp(RULE[to], S((t - tr) / 0.83));
  }

  function update(t) { updateStamp(t); updateCaption(t); }
  __debug.update = update;
  __debug.objects = { stamp, shock, gLight, s2, caption, rule, thai, slots, stepDrum };
  return { update };
}

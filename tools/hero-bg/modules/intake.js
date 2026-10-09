// NIGHT AUDIT — module "intake" (GL, left page), 30 s "Line by Line", all English:
//   E2 raw rows (a still ledger: A1 banner, A3 date, D3 price, D4 negative), E3 the reading-head scan line,
//   E4 extruded clean figures (assembly, B.E.->C.E. reels, baht/comma squeeze, paren->minus), E5 sweep light L.
// update(t) is a pure function of absolute loop time t in [0, 30): every card property comes from that card's
// SCH.cards record and the scan line from SCH.scan (schedule.js), so the left page cannot drift from the right page
// and the rail. The only cache is "which grapheme count is currently drawn on each text canvas"; it never changes the output.
import * as THREE from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

export async function build(ctx) {
  const { L, S, deg, GL, fonts, canvasTex, roundRect, graphemes, noiseTex, hdr, C, TAU, SCH, herm } = ctx;
  const Wn = ctx.W;                        // Wn(t, a, b) = smootherstep 0 -> 1 over [a, b]
  const { clamp, lerp } = L;
  const PXU = 1024 / 2.40;                 // canvas px per unit on the card planes (426.7)
  const sin2 = (x) => Math.sin(Math.PI * clamp(x)) ** 2;
  const AMBER = new THREE.Color(C.amber), RED = new THREE.Color(C.red), GREEN = new THREE.Color(C.green);
  const FAINT06 = new THREE.Color(C.faint).multiplyScalar(0.6);
  const _c = new THREE.Color(), _v = new THREE.Vector3();
  const SCN = SCH.scan, COL = SCH.column, EXIT = SCH.exitDur;

  /* ───────────────────────── helpers ───────────────────────── */
  const setOp = (mesh, a) => {           // explicit opacity (no baseOpacity), hides below 0.004 (spec E0)
    mesh.visible = a >= 0.004;
    const m = mesh.material; if (Array.isArray(m)) { for (const mm of m) mm.opacity = a; } else m.opacity = a;
  };
  const basic = (color, k = 1, extra = {}) => new THREE.MeshBasicMaterial({ color: hdr(color, k), transparent: true, ...extra });

  /** E3 reading head: GL-local y of the scan line. C¹ Hermite reads, then the S-eased carriage return home. */
  const RH = SCN.returnHome, KEND = SCN.keys[SCN.keys.length - 1][1];
  const scanY = (t) => t < RH[0] ? herm(t, SCN.keys) : lerp(KEND, SCN.home, S((t - RH[0]) / RH[1]));

  /** text plane material with the E2 "scan burn" onBeforeCompile patch. One shared uniform carries the moving line's
      world y; glyph pixels above it are consumed and the amber edge glows just below it. */
  const scanU = { value: GL.position.y + SCN.home };
  function burnMaterial(map, burn) {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
    const uni = { uBurn: { value: burn }, uScanY: scanU, uNoise: { value: noiseTex }, uEdge: { value: hdr(C.amber, 2.4) } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vWorldY;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vWorldY; uniform float uBurn; uniform float uScanY; uniform sampler2D uNoise; uniform vec3 uEdge;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          {
            float nz = texture2D(uNoise, vMapUv * vec2(4.0, 1.0)).r;
            float dB = vWorldY - uScanY + 0.05 * (nz - 0.5);
            if (uBurn > 0.5 && dB > 0.0) discard;
            float edge = uBurn * (1.0 - smoothstep(0.0, 0.03, -dB));
            diffuseColor.rgb = mix(diffuseColor.rgb, uEdge, edge);   // glyph pixels only (transparent elsewhere)
          }`);
    };
    m.customProgramCacheKey = () => "intake-burn-v2";
    return m;
  }

  /** tag plane (E2 (6)): 56 px Mono 500 (฿ falls back to Plex Thai 500), letter-spacing .10em, 2.8 px border, r 12 px,
      canvas H 94 px (0.22 u), width = text + 0.12 u.
      segs: strings, or {arrow:true} / {dash:true} drawn as paths (U+2192 / U+2014 are not in every Plex subset). */
  const TAG_X = -0.78, TAG_Y = -0.24;      // left edge on the raw-text column; spans y -0.35 .. -0.13 under the figure
  function makeTag(segs, textCol, borderCol) {
    const font = '500 56px "Plex Mono","Plex Thai"', LS = 5.6, ARW = 64, DSH = 48;
    const m2 = document.createElement("canvas").getContext("2d"); m2.font = font; m2.letterSpacing = LS + "px";
    const parts = segs.map(s => typeof s === "string" ? { s, w: m2.measureText(s).width } : { ...s, w: (s.arrow ? ARW : DSH) + LS });
    const tw = parts.reduce((a, p) => a + p.w, 0) - LS;          // no trailing letter-space
    const H = Math.round(0.22 * PXU), Wd = Math.ceil(tw + 0.12 * PXU);
    const ct = canvasTex(Wd, H, (c2, w, h) => {
      roundRect(c2, 1.4, 1.4, w - 2.8, h - 2.8, 12);
      c2.globalAlpha = 0.08; c2.fillStyle = textCol; c2.fill();
      c2.globalAlpha = 0.5; c2.lineWidth = 2.8; c2.strokeStyle = borderCol; c2.stroke();
      c2.globalAlpha = 1; c2.font = font; c2.letterSpacing = LS + "px"; c2.textBaseline = "middle";
      c2.fillStyle = textCol; c2.strokeStyle = textCol; c2.lineCap = "round"; c2.lineJoin = "round";
      let x = (w - tw) / 2; const y = h / 2 + 2;
      for (const p of parts) {
        if (p.s !== undefined) c2.fillText(p.s, x, y);
        else if (p.arrow) {
          c2.lineWidth = 4.5; c2.beginPath(); c2.moveTo(x + 6, y - 2); c2.lineTo(x + ARW - 8, y - 2);
          c2.moveTo(x + ARW - 20, y - 13); c2.lineTo(x + ARW - 8, y - 2); c2.lineTo(x + ARW - 20, y + 9); c2.stroke();
        } else { c2.lineWidth = 4.2; c2.beginPath(); c2.moveTo(x + 6, y - 2); c2.lineTo(x + DSH - 6, y - 2); c2.stroke(); }
        x += p.w;
      }
    });
    const w = Wd / PXU, h = H / PXU;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: ct.tex, transparent: true, depthWrite: false }));
    mesh.renderOrder = 2;
    return { mesh, w, h, x: TAG_X + w / 2, y: TAG_Y };
  }

  /* ───────────────────────── E4 glyph kit ───────────────────────── */
  const TG = { font: fonts.mono500, size: 0.38, depth: 0.09, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.010, bevelSize: 0.007, bevelSegments: 2 };
  // BASE_Y -0.13 -> -0.07: the figure spans -0.077 .. +0.195, leaving a 0.05 gap above the tag
  const PITCH = 0.228, HALF = PITCH / 2, BASE_Y = -0.07, EM = 0.38;
  const geos = {};
  /** mode "base": baseline-centre pivot (advance centre, baseline, z centre). mode "bbox": bbox-centre pivot; .ox/.oy put it back in place. */
  function glyph(ch, mode = "base") {
    const k = ch + "|" + mode; if (geos[k]) return geos[k];
    const g = new TextGeometry(ch, TG); g.computeBoundingBox();
    const b = g.boundingBox, cz = (b.min.z + b.max.z) / 2;
    let ox = 0, oy = 0;
    if (mode === "base") g.translate(-HALF, 0, -cz);
    else { const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2; g.translate(-cx, -cy, -cz); ox = cx - HALF; oy = cy; }
    g.computeBoundingBox(); g.computeBoundingSphere();
    return (geos[k] = { g, ox, oy, b: b.clone() });
  }
  const CAPC = (() => { const b = glyph("0").b; return (b.min.y + b.max.y) / 2; })();   // cap-centre height of the digits
  function glyphMats() {
    return [
      new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 0.55, roughness: 0.42, metalness: 0.10, transparent: true }),
      new THREE.MeshStandardMaterial({ color: 0x8A5A0C, emissive: C.amber, emissiveIntensity: 0.14, roughness: 0.5, metalness: 0.25, transparent: true }),
    ];
  }
  /** one character: pivot group sits on the slot baseline (assembly transform), mesh inside (squeeze/fold transform) */
  function makeChar(ch, mode = "base") {
    const gd = glyph(ch, mode), mats = glyphMats();
    const pivot = new THREE.Group(), mesh = new THREE.Mesh(gd.g, mats);
    mesh.position.set(gd.ox, gd.oy, 0); mesh.renderOrder = 3; pivot.add(mesh);
    return { pivot, mesh, mats, ox: gd.ox, oy: gd.oy };
  }
  const setGlyphOp = (o, a, em) => { o.mesh.visible = a >= 0.004; o.mats[0].opacity = a; o.mats[1].opacity = a; o.mats[0].emissiveIntensity = em; };
  // assembly for char i of n (E4), A = [start, spread, duration] from SCH: returns q
  const asmQ = (t, i, n, A) => S((t - (A[0] + A[1] * i / (n - 1))) / A[2]);
  function placeAsm(pivot, x, q) {
    pivot.position.set(x, BASE_Y + 0.20 * (1 - q), 0.45 * (1 - q));
    pivot.rotation.set(deg(70) * (1 - q), 0, 0);
  }
  // the set-type flash comes from the glyph's own emissive swell (smooth over the assembly, peak 2.55 crosses the bloom knee)
  const asmOp = (q) => S(2 * q), asmEm = (q) => 0.55 + 2.0 * 4 * q * (1 - q);
  /** figure emissive: assembly swell, x0.73 in the CHART spotlight dim (dimEm), + the GRADE 'certified' lift (echo) */
  const figEm = (q, dimEm, echo) => asmEm(q) * dimEm + echo;

  /* DATE '2569-01-14' -> '2026-01-14' (4 odometer reels + 6 plain glyphs) */
  function buildDate(s) {
    const grp = new THREE.Group(); const reels = [], plain = [];
    const FROM = [2, 5, 6, 9], DELTA = [0, 5, 4, 3];
    for (let j = 0; j < 4; j++) {
      const pivot = new THREE.Group(), drum = new THREE.Group(); drum.position.set(0, CAPC, 0); pivot.add(drum);
      const digits = [], clip = [new THREE.Plane(), new THREE.Plane()];
      for (let k = 0; k < 10; k++) {
        const gd = glyph(String(k)), mats = glyphMats(), mesh = new THREE.Mesh(gd.g, mats); mesh.renderOrder = 3;
        for (const m of mats) m.clippingPlanes = clip;
        drum.add(mesh); digits.push({ mesh, mats });
      }
      grp.add(pivot); reels.push({ pivot, digits, clip, from: FROM[j], delta: DELTA[j] });
    }
    "-01-14".split("").forEach((ch) => { const o = makeChar(ch); grp.add(o.pivot); plain.push(o); });
    // R0 0.50 (was 0.40) separates neighbouring digits; WIN ±0.17 about the cap centre is the odometer window
    const n = 10, slotX = (i) => (i - 4.5) * PITCH, R0 = 0.50, WIN = 0.17, _up = new THREE.Vector3();
    return {
      grp,
      update(t, O, dimEm, echo) {
        reels.forEach((r, j) => {
          const q = asmQ(t, j, n, s.asm); placeAsm(r.pivot, slotX(j), q);
          r.pivot.updateWorldMatrix(true, false);
          r.clip[0].set(_up.set(0, -1, 0), CAPC + WIN).applyMatrix4(r.pivot.matrixWorld);
          r.clip[1].set(_up.set(0, 1, 0), -(CAPC - WIN)).applyMatrix4(r.pivot.matrixWorld);
          const A = asmOp(q) * O, em = figEm(q, dimEm, echo);
          const d = r.from - r.delta * S((t - (s.reels + 0.12 * j)) / 0.70);   // 5→0, 6→2, 9→6: 10.22-10.92, 10.34-11.04, 10.46-11.16
          r.digits.forEach((dg, k) => {
            let a = (k - d) * 36; a = ((a + 180) % 360 + 360) % 360 - 180;
            const vis = S((35 - Math.abs(a)) / 20), op = A * vis;   // S((50-|a|)/30) left 44% ghosts of the +-1 digits at rest
            dg.mesh.visible = op >= 0.004;
            if (!dg.mesh.visible) return;
            const ar = deg(a), ca = Math.cos(ar), sa = Math.sin(ar);
            // drum point at angle a (axle R0 behind the face, at cap-centre height); glyph rotated -a about its cap centre
            dg.mesh.position.set(0, R0 * sa - CAPC * ca, R0 * ca - R0 + CAPC * sa);
            dg.mesh.rotation.set(-ar, 0, 0);
            dg.mats[0].opacity = dg.mats[1].opacity = op; dg.mats[0].emissiveIntensity = em;
          });
        });
        plain.forEach((o, i) => {
          const q = asmQ(t, i + 4, n, s.asm); placeAsm(o.pivot, slotX(i + 4), q);
          setGlyphOp(o, asmOp(q) * O, figEm(q, dimEm, echo));
        });
      },
    };
  }

  /* PRICE '฿1,234.50' -> '1234.50' (฿ = mono B + extruded bar) */
  function buildPrice(s) {
    const grp = new THREE.Group(); const chars = [];
    const src = ["B", "1", ",", "2", "3", "4", ".", "5", "0"];
    src.forEach((ch) => {
      const o = makeChar(ch, (ch === "B" || ch === ",") ? "bbox" : "base");
      if (ch === "B") {   // U+0E3F is not in the typeface: add the vertical bar (0.075 em x 0.98 em, -0.10..0.88 em)
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.075 * EM, 0.98 * EM, TG.depth + 2 * TG.bevelThickness), o.mats[0]);
        bar.position.set(0, (0.39 * EM) - o.oy, 0); bar.renderOrder = 3; o.mesh.add(bar);
      }
      grp.add(o.pivot); chars.push(o);
    });
    const n = 9;
    return {
      grp,
      update(t, O, dimEm, echo) {
        chars.forEach((o, i) => {
          const q = asmQ(t, i, n, s.asm);
          let x = (i - 4) * PITCH, k = 1;
          if (i === 0) k = 1 - S((t - s.baht) / 0.35);                       // ฿ collapses about its centre 13.90-14.25
          else if (i === 2) k = 1 - S((t - s.comma) / 0.35);                 // comma 13.95-14.30
          else if (i >= 3) x -= PITCH * S((t - (s.zip + 0.03 * (i - 3))) / 0.30);   // zipper close 14.10-14.55
          placeAsm(o.pivot, x, q);
          o.mesh.scale.setScalar(Math.max(k, 1e-4));
          setGlyphOp(o, asmOp(q) * O * k, figEm(q, dimEm, echo));
        });
      },
    };
  }

  /* NEG '(500)' -> '-500' */
  /** '(' for the paren->minus fold. Scaling the TextGeometry crescent (scale.x .34, scale.y .336) only gives a thin
      bent hairline, and morphing it flips a fifth of its earcut cap triangles. So the paren is built here as a
      structured strip (rows across the stroke, from the font outline: same silhouette, no bevel) whose morph target
      straightens it into a bar; after scale.x .34 the bar is exactly as thick as the '-' stroke, after scale.y .336 as long. */
  function parenGeo() {
    const poly = fonts.mono500.generateShapes("(", TG.size)[0].extractPoints(TG.curveSegments).shape;
    let ymin = 1e9, ymax = -1e9; for (const p of poly) { ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
    const cross = (y) => {
      let l = 1e9, r = -1e9;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) { const x = p.x + (y - p.y) / (q.y - p.y) * (q.x - p.x); l = Math.min(l, x); r = Math.max(r, x); }
      }
      return [l, r];
    };
    const N = 32, rows = [];
    for (let i = 0; i <= N; i++) { const y = lerp(ymin + 1e-4, ymax - 1e-4, i / N); rows.push([y, ...cross(y)]); }
    let xmin = 1e9, xmax = -1e9; for (const [, l, r] of rows) { xmin = Math.min(xmin, l); xmax = Math.max(xmax, r); }
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2, D = TG.depth / 2 + TG.bevelThickness;
    const mpoly = fonts.mono500.generateShapes("-", TG.size)[0].extractPoints(TG.curveSegments).shape;
    let my0 = 1e9, my1 = -1e9; for (const p of mpoly) { my0 = Math.min(my0, p.y); my1 = Math.max(my1, p.y); }
    const T = (my1 - my0) / 0.34;
    const build = (lx, rx) => {
      const caps = [], walls = [];
      const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < N; i++) {
        const y0 = rows[i][0] - cy, y1 = rows[i + 1][0] - cy, l0 = lx(i), r0 = rx(i), l1 = lx(i + 1), r1 = rx(i + 1);
        quad(caps, [l0, y0, D], [r0, y0, D], [r1, y1, D], [l1, y1, D]);          // front
        quad(caps, [l0, y0, -D], [l1, y1, -D], [r1, y1, -D], [r0, y0, -D]);      // back
        quad(walls, [l0, y0, -D], [l0, y0, D], [l1, y1, D], [l1, y1, -D]);       // left wall
        quad(walls, [r0, y0, -D], [r1, y1, -D], [r1, y1, D], [r0, y0, D]);       // right wall
      }
      const yb = rows[0][0] - cy, yt = rows[N][0] - cy;
      quad(walls, [lx(0), yb, -D], [rx(0), yb, -D], [rx(0), yb, D], [lx(0), yb, D]);   // bottom terminal
      quad(walls, [lx(N), yt, -D], [lx(N), yt, D], [rx(N), yt, D], [rx(N), yt, -D]);   // top terminal
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([...caps, ...walls], 3));
      g.computeVertexNormals(); g.addGroup(0, caps.length / 3, 0); g.addGroup(caps.length / 3, walls.length / 3, 1);
      return g;
    };
    const g = build((i) => rows[i][1] - cx, (i) => rows[i][2] - cx), m = build(() => -T / 2, () => T / 2);
    g.morphAttributes.position = [m.attributes.position]; g.morphAttributes.normal = [m.attributes.normal];
    g.computeBoundingBox(); g.computeBoundingSphere();
    geos["(|bbox"] = { g, ox: cx - HALF, oy: cy, b: g.boundingBox.clone() };
  }

  function buildNeg(s) {
    const grp = new THREE.Group();
    parenGeo();
    const lp = makeChar("(", "bbox"), d5 = makeChar("5"), d0a = makeChar("0"), d0b = makeChar("0"), rp = makeChar(")", "bbox"), minus = makeChar("-");
    const chars = [lp, d5, d0a, d0b, rp];
    for (const o of [...chars, minus]) grp.add(o.pivot);
    minus.mesh.renderOrder = 4;
    const mb = glyph("-").b, MINUS_CY = (mb.min.y + mb.max.y) / 2;   // minus centre (x = advance centre)
    const n = 5, F = s.fold;
    return {
      grp,
      update(t, O, dimEm, echo) {
        const cf = S((t - F - 0.45) / 0.17);                            // crossfade to the true '-' 17.60-17.77
        chars.forEach((o, i) => {
          const q = asmQ(t, i, n, s.asm);
          let x = (i - 2) * PITCH, a = asmOp(q) * O;
          if (i === 0) {                                                // '(' rotates -90° and flattens 17.15-17.55
            const r = S((t - F) / 0.40), f = r;
            x = lerp(-0.456, -0.342, f);
            o.mesh.rotation.set(0, 0, -deg(90) * r);
            o.mesh.scale.set(lerp(1, 0.34, f), lerp(1, 0.336, f), 1);
            o.mesh.morphTargetInfluences[0] = f;
            o.mesh.position.set(lerp(o.ox, 0, f), lerp(o.oy, MINUS_CY, f), 0);
            a *= 1 - cf;
          } else if (i === 4) {                                         // ')' shrinks 17.15-17.50
            const k = 1 - S((t - F) / 0.35);
            o.mesh.scale.setScalar(Math.max(k, 1e-4)); a *= k;
          } else x += 0.114 * S((t - F - 0.05) / 0.45);                 // digits re-centre 17.20-17.65
          placeAsm(o.pivot, x, q);
          setGlyphOp(o, a, figEm(q, dimEm, echo));
        });
        placeAsm(minus.pivot, -0.342, 1); minus.pivot.position.z = 0.003;   // just in front of the bar and drawn after it: no z-fight in the crossfade
        setGlyphOp(minus, cf * O, figEm(1, dimEm, echo));
      },
    };
  }

  /* ───────────────────────── E2 cards (one still ledger row each; times from SCH.cards) ───────────────────────── */
  const CARDS = [
    { key: "banner", ref: "A1", token: "Monthly sales report", font: null, burn: 0,
      tag: ["SKIPPED ", { dash: true }, " banner row"], tagCol: "#5E6B80", tagBorder: "#1F2B45" },
    { key: "date", ref: "A3", token: "14/01/2569", font: '500 92px "Plex Mono"', burn: 1,
      tag: ["B.E.", { arrow: true }, "C.E."], tagCol: "#F5A00B", tagBorder: "#F5A00B", fig: buildDate },
    { key: "price", ref: "D3", token: "฿1,234.50", font: '500 92px "Plex Mono","Plex Thai"', burn: 1,
      tag: ["฿", { arrow: true }, "number"], tagCol: "#F5A00B", tagBorder: "#F5A00B", fig: buildPrice },
    { key: "neg", ref: "D4", token: "(500)", font: '500 92px "Plex Mono"', burn: 1,
      tag: ["acct negative"], tagCol: "#F5A00B", tagBorder: "#F5A00B", fig: buildNeg },
  ];
  const TEXT_X = 180, plateGeo = new THREE.PlaneGeometry(2.40, 0.50);
  const meas = document.createElement("canvas").getContext("2d");

  for (const cd of CARDS) {
    cd.s = SCH.cards[cd.key];
    // banner auto-fit (Plex Thai 500 = the latin-500 face, <= 80 px) inside x 180 .. 980
    if (!cd.font) {
      meas.font = '500 80px "Plex Thai"'; const w80 = meas.measureText(cd.token).width;
      cd.font = `500 ${Math.min(80, Math.floor(80 * (1024 - TEXT_X - 44) / w80))}px "Plex Thai"`;
    }
    cd.gr = graphemes(cd.token);
    meas.font = cd.font; meas.letterSpacing = "0px";
    cd.widths = cd.gr.map((_, i) => meas.measureText(cd.gr.slice(0, i).join("")).width); cd.widths.push(meas.measureText(cd.token).width);

    const g = new THREE.Group(); g.name = "card-" + cd.key; GL.add(g); cd.g = g;
    const body = new THREE.Group(); g.add(body); cd.body = body;
    // (1) plate
    const pt = canvasTex(1024, 214, (c2, w, h) => {
      roundRect(c2, 1, 1, w - 2, h - 2, 24); c2.fillStyle = "#121C30"; c2.fill();
      c2.lineWidth = 2; c2.strokeStyle = "#1F2B45"; c2.stroke();
      c2.font = '400 40px "Plex Mono"'; c2.fillStyle = "#5E6B80"; c2.textBaseline = "middle"; c2.fillText(cd.ref, 34, h / 2 + 1);
    });
    cd.plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ map: pt.tex, transparent: true, depthWrite: false }));
    cd.plate.renderOrder = 1; cd.plate.name = "plate"; body.add(cd.plate);
    if (cd.key === "banner") {   // the junk row's end state: a flat #5E6B80 rule at alpha .45 (crossfaded from the plate)
      cd.grey = new THREE.Mesh(plateGeo, basic(C.faint, 1, { depthWrite: false })); cd.grey.renderOrder = 1; cd.grey.name = "grey-rule"; cd.grey.position.z = 0.001; body.add(cd.grey);
    }
    // (2) raw-token text plane with the scan-burn patch; textFrac tells the gate where the ink is on the 1024 px plane
    cd.txt = canvasTex(1024, 214); cd.lastN = -1;
    cd.text = new THREE.Mesh(plateGeo, burnMaterial(cd.txt.tex, cd.burn)); cd.text.position.z = 0.004; cd.text.renderOrder = 2; cd.text.name = "raw-token"; body.add(cd.text);
    cd.text.userData.textFrac = [TEXT_X / 1024, (TEXT_X + cd.widths[cd.gr.length]) / 1024];
    // (3) margin rule
    cd.rule = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.40, 0.012), basic(C.red, 1)); cd.rule.position.set(-1.155, 0, 0.006); cd.rule.name = "margin-rule"; body.add(cd.rule);
    // (4) caret
    cd.caret = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.19, 0.01), basic(C.amber, 0.9)); cd.caret.position.set(-0.75, 0, 0.01); cd.caret.name = "caret"; body.add(cd.caret);
    // (5) strike (banner)
    if (cd.key === "banner") {
      const sg = new THREE.BoxGeometry(1, 0.014, 0.01); sg.translate(0.5, 0, 0);
      cd.strike = new THREE.Mesh(sg, basic(C.red, 1.3)); cd.strike.position.set(-0.78, 0.01, 0.009); cd.strike.name = "strike"; body.add(cd.strike);
      cd.textW = cd.widths[cd.gr.length] / PXU;
    }
    // (6) tag: outside the squashed body, left-aligned on the raw-text column, kept to the exit (evidence stays)
    cd.tagObj = makeTag(cd.tag, cd.tagCol, cd.tagBorder); cd.tagObj.mesh.position.set(cd.tagObj.x, cd.tagObj.y, 0.01); cd.tagObj.mesh.name = "tag"; g.add(cd.tagObj.mesh);
    // (7) clean figure (E4)
    if (cd.fig) { cd.F = cd.fig(cd.s); cd.F.grp.position.set(0.14, 0, 0.10); cd.F.grp.name = "fig-" + cd.key; g.add(cd.F.grp); }
  }
  function drawToken(cd, n) {
    cd.txt.redraw((c2, w, h) => {
      c2.font = cd.font; c2.fillStyle = "#8C99B5"; c2.textBaseline = "middle";
      c2.fillText(cd.gr.slice(0, n).join(""), TEXT_X, h / 2 + 4);
    });
  }

  /* ───────────────────────── E3 scan line (reading head) ───────────────────────── */
  // trimmed at the gutter end: core 2.55 wide at SC.x 0.125 spans GL x -1.15 .. +1.40; HOME +1.22 keeps the halo below K1a
  const CW = 2.55, CH = CW / 2, HWD = 2.75, HH = HWD / 2;
  const SC = new THREE.Group(); SC.name = "scan"; SC.position.set(0.125, SCN.home, 0.46); GL.add(SC);
  const taper = (f) => lerp(1.0, 0.35, f);          // f: 0 at the outer (frame-edge) end, 1 at the gutter end
  const coreGeo = new THREE.BoxGeometry(CW, 0.012, 0.012);
  { const p = coreGeo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const v = taper((p.getX(i) + CH) / CW); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    coreGeo.setAttribute("color", new THREE.BufferAttribute(col, 3)); }
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  const core = new THREE.Mesh(coreGeo, coreMat); core.name = "scan-core"; SC.add(core);
  const tickGeo = new THREE.BoxGeometry(0.012, 0.10, 0.012);
  const tickO = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial()); tickO.position.x = -CH; tickO.name = "scan-tick"; SC.add(tickO);
  const tickI = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial()); tickI.position.x = +CH; tickI.name = "scan-tick"; SC.add(tickI);
  const haloT = canvasTex(512, 64, (c2, w, h) => {
    const img = c2.createImageData(w, h), d = img.data, sig = 0.05 / 0.26 * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w, ux = fx * HWD - HH;                            // halo-local u, ±1.375
      const ends = L.smooth((ux + HH) / (HH - CH)) * L.smooth((HH - ux) / (HH - CH));   // fades in to full at the core ends ±1.275
      const vy = Math.exp(-0.5 * (((y + 0.5 - h / 2) / sig) ** 2)) * L.smooth(Math.min(y + 0.5, h - y - 0.5) / 6);
      const v = vy * ends * taper(clamp((ux + CH) / CW)), k = (y * w + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = Math.round(v * 255); d[k + 3] = 255;
    }
    c2.putImageData(img, 0, 0);
  });
  haloT.tex.colorSpace = THREE.NoColorSpace;
  const haloMat = new THREE.MeshBasicMaterial({ map: haloT.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.08 });
  // The 2.75 x 0.26 halo is built as two abutting planes (split at halo u = +0.70, UVs continuous, shared edge: no seam).
  // At HOME the outer end is nearer the camera and its top corner projects to y 296, so one plane's AABB would clip
  // K1a (y < 300) at x 440-472 although the halo's top edge there is at y 309-313. Split, each box is honest.
  const HSPLIT = 0.70;
  for (const [u0, u1] of [[-HH, HSPLIT], [HSPLIT, HH]]) {
    const hg = new THREE.PlaneGeometry(u1 - u0, 0.26); hg.translate((u0 + u1) / 2, 0, 0);
    const uv = hg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, lerp((u0 + HH) / HWD, (u1 + HH) / HWD, uv.getX(i)));
    const halo = new THREE.Mesh(hg, haloMat); halo.position.z = -0.005; halo.name = "scan-halo"; halo.renderOrder = 2.5; SC.add(halo);
  }
  // halo draws after plates/text and before the extruded figures (which sit in front of it)

  /* ───────────────────────── E5 sweep light L ───────────────────────── */
  const sweep = new THREE.PointLight(C.warn, 0, 2.0, 2); GL.add(sweep);
  // z 1.0, not 0.55: closer, the amber faces bloomed into a hot blob. At 1.0 it reads as a warm highlight raking the bevels.
  const SWZ = 1.0;
  // CHART hand-off: one warm glint rakes the whole clean column (GL-local endpoints). End x +0.2, not the spec's +1.2:
  // on that path the light crossed D4's row at x +0.83, 1.4 u right of '-500', so '-500' got ~6% of the flare of '1234.50'.
  // Ending at +0.2 it passes '2026' (19.8), '1234' (19.95) and '-500' (20.1), each brightening by about the same amount.
  const HO0 = new THREE.Vector3(-1.0, +0.62, SWZ), HO1 = new THREE.Vector3(+0.2, -1.25, SWZ);

  /* ───────────────────────── per frame ───────────────────────── */
  return {
    update(t) {
      let swI = 0;
      sweep.position.set(0, 0, 1);   // parked when no window is open (intensity 0), so the scene state is a pure function of t
      const blink = 0.625 + 0.375 * Math.cos(TAU * t / 1.0);       // the page console's 1 s caret, opacity 0.25-1
      const pulse = 0.75 + 0.25 * Math.cos(TAU * t / 1.25);        // raw red rhythm, in phase with the right page's red flags
      const dimW = Wn(t, COL.dim[0], COL.dim[1]);                   // CHART / GRADE spotlight: the filed column steps back
      const dimEm = 1 - 0.27 * dimW, dimTag = 1 - 0.25 * dimW, dimRule = 1 - 0.2 * dimW;

      for (const cd of CARDS) {
        const s = cd.s, g = cd.g, isB = cd.key === "banner";
        // POSE: still ledger slot; messy tilt/jitter until the focus lift; lift 0.30 toward the camera, settle back; file away
        const Lin = Wn(t, s.lift[0], s.lift[1]), Lf = Lin * (1 - Wn(t, s.settle[0], s.settle[1])), X = Wn(t, s.exit, s.exit + EXIT);
        const O = Wn(t, s.in, s.in + 0.25) * (1 - X);
        g.position.set(s.slot[0] + s.dx * (1 - Lin) + 0.06 * Lf,
          s.slot[1] + 0.06 * (1 - Wn(t, s.in, s.in + 0.30)) - 0.05 * X,
          0.30 * Lf - 0.40 * X);
        g.rotation.set(0, -deg(6) * Lf, deg(s.rho) * (1 - Lin));
        g.visible = O >= 0.004;
        g.updateMatrix();
        if (!g.visible) continue;

        // TYPING (graphemes) + the one caret that hops row to row
        const N = cd.gr.length, [ts, te] = s.type;
        const n = clamp(Math.ceil(N * (t - ts) / (te - ts)), 0, N);
        if (n !== cd.lastN) { cd.lastN = n; drawToken(cd, n); }
        const tOut = isB ? s.textFade : s.textOut, textK = 1 - Wn(t, tOut[0], tOut[1]);
        setOp(cd.text, n > 0 ? O * textK : 0);
        cd.caret.position.x = -0.78 + cd.widths[n] / PXU + 0.03;
        // one caret at a time: it leaves a row over te .. te+0.06 and lands on the next over ts-0.04 .. ts+0.02. Every next
        // row starts typing 0.05 s after the previous one ends, so this is a 2-frame hop. (The spec's W(ts-0.10, ts) and
        // 1-W(te+0.02, te+0.12) overlap by 0.10-0.17 s and showed two carets at once, e.g. at t 1.6.)
        setOp(cd.caret, O * blink * Wn(t, ts - 0.04, ts + 0.02) * (1 - Wn(t, te, te + 0.06)));

        // MARGIN RULE: pulsing red while raw -> amber (fixed) or faint (banner); x0.8 in CHART; green 'certified' in GRADE
        _c.copy(RED).multiplyScalar(pulse);
        if (isB) _c.lerp(FAINT06, Wn(t, s.ruleFade[0], s.ruleFade[1]));
        else _c.lerp(AMBER, Wn(t, s.rule[0], s.rule[1])).multiplyScalar(dimRule).lerp(GREEN, Wn(t, s.green, s.green + 0.30));
        cd.rule.material.color.copy(_c);
        setOp(cd.rule, O);

        // plate (banner: struck, then squashed into a grey rule)
        if (isB) {
          const kg = Wn(t, s.collapse[0], s.collapse[1]);
          cd.body.scale.y = lerp(1, 0.05, kg);
          setOp(cd.plate, O * 0.92 * (1 - kg)); setOp(cd.grey, O * 0.45 * kg);
          const sx = cd.textW * S((t - s.strike[0]) / s.strike[1]);
          cd.strike.scale.x = Math.max(sx, 1e-4); setOp(cd.strike, sx > 1e-3 ? O * textK : 0);
        } else setOp(cd.plate, O * lerp(0.92, 0.12, Wn(t, s.plate[0], s.plate[1])));

        // TAG: slides up 0.05 over 0.30 s and stays to the exit; alpha x0.75 in the spotlight dim
        const kt = S((t - s.tag) / 0.30);
        cd.tagObj.mesh.position.y = cd.tagObj.y - 0.05 * (1 - kt);
        setOp(cd.tagObj.mesh, O * kt * dimTag);

        // clean figure (E4); D4 slides -0.342 so '-500' sits units-aligned under '1234'
        if (cd.F) {
          if (s.align) cd.F.grp.position.x = 0.14 + s.align[2] * Wn(t, s.align[0], s.align[1]);
          cd.F.update(t, O, dimEm, 0.35 * sin2((t - s.green) / 0.40));
        }

        // SWEEP LIGHT L: this card's window, along its own path through g's transform
        if (s.sweep) {
          const sg = (t - s.sweep[0]) / s.sweep[1];
          if (sg > 0 && sg < 1) {
            const e = S(sg);
            _v.set(-1.3 + 2.8 * e, 0.45 - 0.60 * e, SWZ).applyMatrix4(g.matrix);
            sweep.position.copy(_v); swI = s.sweep[2] * Math.sin(Math.PI * sg) ** 2;
          }
        }
      }
      { // CHART hand-off: a warm glint rakes down the clean column before the bars rise
        const [h0, hd, hA] = COL.handoff, sg = (t - h0) / hd;
        if (sg > 0 && sg < 1) { sweep.position.lerpVectors(HO0, HO1, S(sg)); swI = hA * Math.sin(Math.PI * sg) ** 2; }
      }
      sweep.intensity = swI;

      // E3 reading head: position, brightness (reads flare, audit-done dim), banner red flush; the burn follows it
      const y = scanY(t);
      SC.position.y = y;
      scanU.value = GL.position.y + y;
      let M = 0;
      for (const [k1, k2] of SCN.reads) M += sin2((t - (k1 - 0.15)) / (k2 - k1 + 0.30));
      const Dm = 1 - SCN.dim[2] * Wn(t, SCN.dim[0], SCN.dim[1]) * (1 - Wn(t, RH[0], RH[0] + RH[1]));
      const [rmK, rm0, rm1, rm2, rm3] = SCN.redMix;
      _c.copy(AMBER).lerp(RED, rmK * Wn(t, rm0, rm1) * (1 - Wn(t, rm2, rm3)));
      const kc = (1.15 + 0.20 * Math.cos(TAU * t / 3.75)) * Dm + 1.40 * M;
      coreMat.color.copy(_c).multiplyScalar(kc);
      tickO.material.color.copy(_c).multiplyScalar(kc * taper(0));
      tickI.material.color.copy(_c).multiplyScalar(kc * taper(1));
      haloMat.color.copy(_c); haloMat.opacity = 0.08 * Dm + 0.12 * M;
    },
  };
}

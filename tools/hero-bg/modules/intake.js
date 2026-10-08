// NIGHT AUDIT — module "intake" (GL, left page): E2 intake conveyor, E3 scan line + scan light,
// E4 extruded clean figures (assembly, B.E.->C.E. reels, baht/comma squeeze, paren->minus), E5 sweep light L.
// update(t) is a pure function of t: every property is derived from the card phase u_k(t) = (t/3.75 + c_k) mod 4.
// The only cache is "which grapheme count is currently drawn on each text canvas"; it never changes the output.
import * as THREE from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

export async function build(ctx) {
  const { L, S, deg, GL, fonts, canvasTex, roundRect, graphemes, noiseTex, hdr, C, SCAN_Y, TAU } = ctx;
  const { clamp, lerp } = L;
  const PXU = 1024 / 2.40;                 // canvas px per unit on the card planes (426.7)
  const gauss = (x, c, s) => Math.exp(-(((x - c) / s) ** 2));
  const AMBER = new THREE.Color(C.amber), RED = new THREE.Color(C.red), FAINT06 = new THREE.Color(C.faint).multiplyScalar(0.6);
  const _c = new THREE.Color(), _v = new THREE.Vector3();

  /* ───────────────────────── helpers ───────────────────────── */
  const setOp = (mesh, a) => {           // explicit opacity (no baseOpacity), hides below 0.004 (spec E0)
    mesh.visible = a >= 0.004;
    const m = mesh.material; if (Array.isArray(m)) { for (const mm of m) mm.opacity = a; } else m.opacity = a;
  };
  const basic = (color, k = 1, extra = {}) => new THREE.MeshBasicMaterial({ color: hdr(color, k), transparent: true, ...extra });

  /** text plane material with the E2 "scan burn" onBeforeCompile patch */
  function burnMaterial(map, burn) {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
    const uni = { uBurn: { value: burn }, uScanY: { value: SCAN_Y }, uNoise: { value: noiseTex }, uEdge: { value: hdr(C.amber, 2.4) } };
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
            if (uBurn > 0.5 && dB < 0.0) discard;
            float edge = uBurn * (1.0 - smoothstep(0.0, 0.03, dB));
            diffuseColor.rgb = mix(diffuseColor.rgb, uEdge, edge);   // glyph pixels only (transparent elsewhere)
          }`);
    };
    m.customProgramCacheKey = () => "intake-burn-v1";
    return m;
  }

  /** tag plane (E2 (6)): 40 px Mono 500 / Thai 500, letter-spacing .12em, 2 px border alpha .5, r 10 px.
      segs: strings, or {arrow:true} / {dash:true} drawn as paths (U+2192 / U+2014 are not in every Plex subset). */
  function makeTag(segs, textCol, borderCol) {
    const font = '500 40px "Plex Mono","Plex Thai"', LS = 4.8, ARW = 46, DSH = 34;
    const m2 = document.createElement("canvas").getContext("2d"); m2.font = font; m2.letterSpacing = LS + "px";
    const parts = segs.map(s => typeof s === "string" ? { s, w: m2.measureText(s).width } : { ...s, w: (s.arrow ? ARW : DSH) + LS });
    const tw = parts.reduce((a, p) => a + p.w, 0) - LS;          // no trailing letter-space
    const H = Math.round(0.17 * PXU), Wd = Math.ceil(tw + 0.12 * PXU);
    const ct = canvasTex(Wd, H, (c2, w, h) => {
      roundRect(c2, 1.5, 1.5, w - 3, h - 3, 10);
      c2.globalAlpha = 0.08; c2.fillStyle = textCol; c2.fill();
      c2.globalAlpha = 0.5; c2.lineWidth = 2; c2.strokeStyle = borderCol; c2.stroke();
      c2.globalAlpha = 1; c2.font = font; c2.letterSpacing = LS + "px"; c2.textBaseline = "middle";
      c2.fillStyle = textCol; c2.strokeStyle = textCol; c2.lineCap = "round"; c2.lineJoin = "round";
      let x = (w - tw) / 2; const y = h / 2 + 1;
      for (const p of parts) {
        if (p.s !== undefined) c2.fillText(p.s, x, y);
        else if (p.arrow) {
          c2.lineWidth = 3.2; c2.beginPath(); c2.moveTo(x + 4, y); c2.lineTo(x + ARW - 6, y);
          c2.moveTo(x + ARW - 15, y - 8); c2.lineTo(x + ARW - 6, y); c2.lineTo(x + ARW - 15, y + 8); c2.stroke();
        } else { c2.lineWidth = 3; c2.beginPath(); c2.moveTo(x + 4, y); c2.lineTo(x + DSH - 4, y); c2.stroke(); }
        x += p.w;
      }
    });
    const w = Wd / PXU, h = 0.17;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: ct.tex, transparent: true, depthWrite: false }));
    mesh.renderOrder = 2;
    return { mesh, w, h, x: 0.95 - w / 2, y: 0.27 + h / 2 };   // 0.95, not 1.20: keeps tags clear of the TH console corner at 1280-1340 px
  }

  /* ───────────────────────── E4 glyph kit ───────────────────────── */
  const TG = { font: fonts.mono500, size: 0.38, depth: 0.09, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.010, bevelSize: 0.007, bevelSegments: 2 };
  const PITCH = 0.228, HALF = PITCH / 2, BASE_Y = -0.13, EM = 0.38;
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
  // assembly for char i of n (E4): returns q
  const asmQ = (tau, i, n) => S((tau - (0.90 + 0.80 * i / (n - 1))) / 0.60);
  function placeAsm(pivot, x, q) {
    pivot.position.set(x, BASE_Y + 0.20 * (1 - q), 0.45 * (1 - q));
    pivot.rotation.set(deg(70) * (1 - q), 0, 0);
  }
  // the set-type flash comes from the glyph's own emissive swell (smooth over 0.6 s, peak 2.55 crosses the bloom knee),
  // not from the scan light, whose 1/d² falloff on a tipped glyph popped for 1-2 frames
  const asmOp = (q) => S(2 * q), asmEm = (q) => 0.55 + 2.0 * 4 * q * (1 - q);

  /* DATE '2569-01-14' -> '2026-01-14' (4 odometer reels + 6 plain glyphs) */
  function buildDate() {
    const grp = new THREE.Group(); const reels = [], plain = [];
    const FROM = [2, 5, 6, 9], DELTA = [0, 5, 4, 3];
    for (let j = 0; j < 4; j++) {
      const pivot = new THREE.Group(), drum = new THREE.Group(); drum.position.set(0, CAPC, 0); pivot.add(drum);
      const digits = [];
      for (let k = 0; k < 10; k++) {
        const gd = glyph(String(k)), mats = glyphMats(), mesh = new THREE.Mesh(gd.g, mats); mesh.renderOrder = 3;
        drum.add(mesh); digits.push({ mesh, mats });
      }
      grp.add(pivot); reels.push({ pivot, digits, from: FROM[j], delta: DELTA[j] });
    }
    "-01-14".split("").forEach((ch, i) => { const o = makeChar(ch); grp.add(o.pivot); plain.push(o); });
    const n = 10, slotX = (s) => (s - 4.5) * PITCH, R0 = 0.40;
    return {
      grp,
      update(tau, O) {
        reels.forEach((r, j) => {
          const q = asmQ(tau, j, n); placeAsm(r.pivot, slotX(j), q);
          const A = asmOp(q) * O, em = asmEm(q);
          const d = r.from - r.delta * S((tau - (2.30 + 0.15 * j)) / 0.80);
          r.digits.forEach((dg, k) => {
            let a = (k - d) * 36; a = ((a + 180) % 360 + 360) % 360 - 180;
            const vis = S((35 - Math.abs(a)) / 20), op = A * vis;   // spec S((50-|a|)/30) left 44% ghosts of the +-1 digits at rest
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
          const q = asmQ(tau, i + 4, n); placeAsm(o.pivot, slotX(i + 4), q);
          setGlyphOp(o, asmOp(q) * O, asmEm(q));
        });
      },
    };
  }

  /* PRICE '฿1,234.50' -> '1234.50' (฿ = mono B + extruded bar) */
  function buildPrice() {
    const grp = new THREE.Group(); const chars = [];
    const src = ["B", "1", ",", "2", "3", "4", ".", "5", "0"];
    src.forEach((ch, s) => {
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
      update(tau, O) {
        chars.forEach((o, s) => {
          const q = asmQ(tau, s, n);
          let x = (s - 4) * PITCH, k = 1;
          if (s === 0) k = 1 - S((tau - 2.35) / 0.35);                 // ฿ collapses about its centre 10.225-10.575
          else if (s === 2) k = 1 - S((tau - 2.40) / 0.35);            // comma 10.275-10.625
          else if (s >= 3) x -= PITCH * S((tau - (2.55 + 0.03 * (s - 3))) / 0.30); // zipper close 10.425-10.875
          placeAsm(o.pivot, x, q);
          o.mesh.scale.setScalar(Math.max(k, 1e-4));
          setGlyphOp(o, asmOp(q) * O * k, asmEm(q));
        });
      },
    };
  }

  /* NEG '(500)' -> '-500' */
  /** '(' for the paren->minus fold. Scaling the TextGeometry crescent (spec: scale.x .34, scale.y .336) only gives a thin
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

  function buildNeg() {
    const grp = new THREE.Group();
    parenGeo();
    const lp = makeChar("(", "bbox"), d5 = makeChar("5"), d0a = makeChar("0"), d0b = makeChar("0"), rp = makeChar(")", "bbox"), minus = makeChar("-");
    const chars = [lp, d5, d0a, d0b, rp];
    for (const o of [...chars, minus]) grp.add(o.pivot);
    minus.mesh.renderOrder = 4;
    const mb = glyph("-").b, MINUS_CY = (mb.min.y + mb.max.y) / 2;   // minus centre (x = advance centre)
    const n = 5;
    return {
      grp,
      update(tau, O) {
        chars.forEach((o, s) => {
          const q = asmQ(tau, s, n);
          let x = (s - 2) * PITCH, a = asmOp(q) * O;
          if (s === 0) {
            const r = S((tau - 2.35) / 0.40), f = S((tau - 2.35) / 0.40), cf = S((tau - 2.80) / 0.17);
            x = lerp(-0.456, -0.342, f);
            o.mesh.rotation.set(0, 0, -deg(90) * r);
            o.mesh.scale.set(lerp(1, 0.34, f), lerp(1, 0.336, f), 1);
            o.mesh.morphTargetInfluences[0] = f;
            o.mesh.position.set(lerp(o.ox, 0, f), lerp(o.oy, MINUS_CY, f), 0);
            a *= 1 - cf;
          } else if (s === 4) {
            const k = 1 - S((tau - 2.35) / 0.35);
            o.mesh.scale.setScalar(Math.max(k, 1e-4)); a *= k;
          } else x += 0.114 * S((tau - 2.40) / 0.45);
          placeAsm(o.pivot, x, q);
          setGlyphOp(o, a, asmEm(q));
        });
        const cf = S((tau - 2.80) / 0.17);
        placeAsm(minus.pivot, -0.342, 1); minus.pivot.position.z = 0.003;   // just in front of the bar and drawn after it: no z-fight in the crossfade
        setGlyphOp(minus, cf * O, 0.55);
      },
    };
  }

  /* ───────────────────────── E2 cards ───────────────────────── */
  const CARDS = [
    { key: "banner", c: 1.2, dy: +0.05, rho: -4.0, ref: "A1", token: "รายงานยอดขาย ร้านป้าศรี", font: null, burn: 0,
      tag: ["SKIPPED ", { dash: true }, " หัวรายงาน"], tagCol: "#5E6B80", tagBorder: "#1F2B45", tagIn: 1.3 },
    { key: "date", c: 0.2, dy: -0.04, rho: +3.0, ref: "A3", token: "14 ม.ค. 2569", font: '500 92px "Plex Thai"', burn: 1,
      tag: ["พ.ศ.", { arrow: true }, "ค.ศ."], tagCol: "#F5A00B", tagBorder: "#F5A00B", tagIn: 3.60, sweep: { ts: 3.70, A: 2.4, dur: 0.80 }, fig: buildDate },
    { key: "price", c: 3.2, dy: +0.03, rho: -2.5, ref: "D3", token: "฿1,234.50", font: '500 92px "Plex Mono","Plex Thai"', burn: 1,
      tag: ["฿", { arrow: true }, "number"], tagCol: "#F5A00B", tagBorder: "#F5A00B", tagIn: 3.00, sweep: { ts: 3.10, A: 1.8, dur: 0.80 }, fig: buildPrice },
    { key: "neg", c: 2.2, dy: -0.05, rho: +2.0, ref: "D4", token: "(500)", font: '500 92px "Plex Mono"', burn: 1,
      // window shortened 0.80 -> 0.70 so the sweep ends at 14.925 as the timeline states (0.80 would run to 15.025)
      tag: ["ติดลบบัญชี"], tagCol: "#F5A00B", tagBorder: "#F5A00B", tagIn: 3.00, sweep: { ts: 2.60, A: 2.0, dur: 0.70 }, fig: buildNeg },
  ];
  const TEXT_X = 180, plateGeo = new THREE.PlaneGeometry(2.40, 0.50);
  const meas = document.createElement("canvas").getContext("2d");

  for (const cd of CARDS) {
    // banner auto-fit (Plex Thai 500, <= 80 px) inside x 180 .. 1024-44
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
    // (2) raw-token text plane with the scan-burn patch
    cd.txt = canvasTex(1024, 214); cd.lastN = -1;
    cd.text = new THREE.Mesh(plateGeo, burnMaterial(cd.txt.tex, cd.burn)); cd.text.position.z = 0.004; cd.text.renderOrder = 2; cd.text.name = "raw-token"; body.add(cd.text);
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
    // (6) tag (outside the squashed body so the SKIPPED tag reads until it fades)
    cd.tagObj = makeTag(cd.tag, cd.tagCol, cd.tagBorder); cd.tagObj.mesh.position.set(cd.tagObj.x, cd.tagObj.y, 0.01); cd.tagObj.mesh.name = "tag"; g.add(cd.tagObj.mesh);
    // (7) clean figure (E4)
    if (cd.fig) { cd.F = cd.fig(); cd.F.grp.position.set(0.14, 0, 0.10); cd.F.grp.name = "fig-" + cd.key; g.add(cd.F.grp); }
  }
  function drawToken(cd, n) {
    cd.txt.redraw((c2, w, h) => {
      c2.font = cd.font; c2.fillStyle = "#8C99B5"; c2.textBaseline = "middle";
      c2.fillText(cd.gr.slice(0, n).join(""), TEXT_X, h / 2 + 4);
    });
  }

  /* ───────────────────────── E3 scan line ───────────────────────── */
  const SC = new THREE.Group(); SC.name = "scan"; SC.position.set(0.20, -0.064, 0.46); GL.add(SC);
  const taper = (f) => lerp(1.0, 0.35, f);          // f: 0 at the outer (frame-edge) end, 1 at the gutter end
  const coreGeo = new THREE.BoxGeometry(2.70, 0.012, 0.012);
  { const p = coreGeo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const v = taper((p.getX(i) + 1.35) / 2.70); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    coreGeo.setAttribute("color", new THREE.BufferAttribute(col, 3)); }
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  const core = new THREE.Mesh(coreGeo, coreMat); core.name = "scan-core"; SC.add(core);
  const tickGeo = new THREE.BoxGeometry(0.012, 0.10, 0.012);
  const tickO = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial()); tickO.position.x = -1.35; tickO.name = "scan-tick"; SC.add(tickO);
  const tickI = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial()); tickI.position.x = +1.35; tickI.name = "scan-tick"; SC.add(tickI);
  const haloT = canvasTex(512, 64, (c2, w, h) => {
    const img = c2.createImageData(w, h), d = img.data, sig = 0.05 / 0.26 * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w, ux = fx * 2.90 - 1.45;                         // halo-local u
      const ends = L.smooth((ux + 1.45) / 0.12) * L.smooth((1.45 - ux) / 0.12);
      const vy = Math.exp(-0.5 * (((y + 0.5 - h / 2) / sig) ** 2)) * L.smooth(Math.min(y + 0.5, h - y - 0.5) / 6);
      const v = vy * ends * taper(clamp((ux + 1.35) / 2.70)), k = (y * w + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = Math.round(v * 255); d[k + 3] = 255;
    }
    c2.putImageData(img, 0, 0);
  });
  haloT.tex.colorSpace = THREE.NoColorSpace;
  const haloMat = new THREE.MeshBasicMaterial({ map: haloT.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.08 });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.90, 0.26), haloMat); halo.position.z = -0.005; halo.name = "scan-halo"; halo.renderOrder = 2.5; SC.add(halo);
  // halo draws after plates/text and before the extruded figures (which sit in front of it)
  const scanLight = new THREE.PointLight(C.amber, 0.25, 3.2, 2); scanLight.position.set(0.0, 0.05, 1.3);   // 1.3, not 1.0: tipped glyphs passed so close the 1/d² light popped the bloom GL.add(scanLight);

  /* ───────────────────────── E5 sweep light L ───────────────────────── */
  const sweep = new THREE.PointLight(C.warn, 0, 2.0, 2); GL.add(sweep);
  // spec z 0.55 put the light 0.4 u in front of the faces: the amber faces bloomed into a hot blob (the sweep is not a
  // bloom source in the spec). At z 1.0 it reads as a warm highlight raking across the figure, below the bloom threshold.
  const SWZ = 1.0;

  /* ───────────────────────── per frame ───────────────────────── */
  return {
    update(t) {
      let P = 0, Rb = 0, swI = 0;
      sweep.position.set(0, 0, 1);   // parked when no window is open (intensity 0), so the scene state is a pure function of t
      const blink = 0.55 + 0.45 * Math.cos(TAU * t / 0.9375), pulse = 0.75 + 0.25 * Math.cos(TAU * t / 1.25);
      for (const cd of CARDS) {
        const u = (((t / 3.75 + cd.c) % 4) + 4) % 4, tau = 3.75 * (u - 1.3);
        const O = S(u / 0.5) * (1 - S((u - 3.3) / 0.6));
        const g = cd.g;
        // track + rotation
        g.position.set(
          0.36 * gauss(u, 1.75, 0.85) - 0.22 * S((u - 2.1) / 1.2) - 0.24 * (1 - S(u / 1.3)),   // spec: 0.08*(1-S(u/0.8)); widened so the entering plate AABB clears K1a
          1.50 - 0.92 * u + cd.dy * (1 - S((u - 1.3) / 0.8)),
          0.40 * gauss(u, 1.7, 1.1) - 0.40 * S((u - 3.0) / 0.9));
        g.rotation.set(0, -deg(8) * gauss(u, 1.7, 1.0), deg(cd.rho) * (1 - S((u - 1.3) / 0.8)));
        g.visible = O >= 0.004;
        g.updateMatrix();
        const prox = gauss(u, 1.7, 0.22);
        if (cd.key === "banner") Rb = prox; else P = Math.max(P, prox);
        if (!g.visible) continue;
        const isB = cd.key === "banner";

        // typing (graphemes) + caret
        const N = cd.gr.length, n = clamp(Math.ceil(N * (u - 0.05) / 0.40), 0, N);
        if (n !== cd.lastN) { cd.lastN = n; drawToken(cd, n); }
        const textFade = isB ? 1 - S((tau - 1.7) / 0.5) : 1 - S((tau - 0.95) / 0.45);
        setOp(cd.text, n > 0 ? O * textFade : 0);
        cd.caret.position.x = -0.78 + cd.widths[n] / PXU + 0.03;
        setOp(cd.caret, O * blink * (1 - S((u - 0.45) / 0.15)));

        // margin rule: pulsing red while raw, then amber (figure) or faint (banner) over tau 1.5-2.0
        const kr = S((tau - 1.5) / 0.5);
        _c.copy(RED).multiplyScalar(pulse);
        if (isB) cd.rule.material.color.copy(_c).lerp(FAINT06, kr);
        else cd.rule.material.color.copy(_c).lerp(AMBER, kr);
        setOp(cd.rule, O);

        // plate
        if (isB) {
          const kg = S((tau - 1.7) / 0.8);
          cd.body.scale.y = lerp(1, 0.05, kg);
          setOp(cd.plate, O * 0.92 * (1 - kg)); setOp(cd.grey, O * 0.45 * kg);
          const sx = cd.textW * S((tau - 0.9) / 0.5);
          cd.strike.scale.x = Math.max(sx, 1e-4); setOp(cd.strike, sx > 1e-3 ? O * textFade : 0);
        } else setOp(cd.plate, O * lerp(0.92, 0.12, S((tau - 1.8) / 0.8)));

        // tag
        const kt = S((tau - cd.tagIn) / 0.30), kOut = isB ? 1 - S((tau - 2.3) / 0.3) : 1;
        cd.tagObj.mesh.position.y = cd.tagObj.y - 0.05 * (1 - kt);
        setOp(cd.tagObj.mesh, O * kt * kOut);

        // clean figure
        if (cd.F) cd.F.update(tau, O);

        // sweep light window
        if (cd.sweep) {
          const sg = (tau - cd.sweep.ts) / cd.sweep.dur;
          if (sg > 0 && sg < 1) {
            const e = S(sg);
            _v.set(-1.3 + 2.8 * e, 0.45 - 0.60 * e, SWZ).applyMatrix4(g.matrix);
            sweep.position.copy(_v); swI = cd.sweep.A * Math.sin(Math.PI * sg) ** 2;
          }
        }
      }
      sweep.intensity = swI;

      // E3 scan line
      const M = Math.max(P, Rb);
      _c.copy(AMBER).lerp(RED, 0.3 * Rb);
      const kc = 1.15 + 0.20 * Math.cos(TAU * t / 3.75) + 1.40 * M;
      coreMat.color.copy(_c).multiplyScalar(kc);
      tickO.material.color.copy(_c).multiplyScalar(kc * taper(0));
      tickI.material.color.copy(_c).multiplyScalar(kc * taper(1));
      haloMat.color.copy(_c); haloMat.opacity = 0.08 + 0.12 * M;
      scanLight.color.copy(_c); scanLight.intensity = 0.25 + 1.4 * M;
    },
  };
}

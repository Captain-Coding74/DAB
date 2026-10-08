// NIGHT AUDIT: The Open Ledger — 15 s loop for the DAB hero. renderAt(t) is a pure function of t.
// Framework (spec E0, E1, E10-E13, camera, post). Animated subsystems live in modules/*.js:
//   intake.js (E2-E5), sculpture.js (E6-E7), stamp.js (E8-E9). Contract: export async function build(ctx) -> { update(t) }.
import * as THREE from "three";
import * as L from "./lib.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const q = new URLSearchParams(location.search);
const W = +(q.get("w") || 1920), H = +(q.get("h") || 1080);
const MODS = (q.get("modules") ?? "intake,sculpture,stamp").split(",").filter(Boolean);
const { TAU, PERIOD, S: _unused } = L;
const S = L.smoother, Wn = (t, a, b) => L.smoother((t - a) / (b - a));
const deg = THREE.MathUtils.degToRad;

/* ── fonts ── */
const THAI = "ม.ค. วันที่ ให้เกรด ป้าศรี ฿";
await Promise.all([
  document.fonts.load('500 92px "Plex Thai"', THAI), document.fonts.load('600 96px "Plex Thai"', THAI),
  document.fonts.load('500 92px "Plex Mono"', "0123(),.-"), document.fonts.load('400 40px "Plex Mono"', "A1"),
  document.fonts.load('500 40px "Plex Mono"', "HEADER"), document.fonts.load('500 40px "Plex Thai"', THAI),
]);
const loadFont = async (n) => new FontLoader().parse(await (await fetch(`assets/${n}.typeface.json`)).json());
const fonts = { mono500: await loadFont("plex-mono-500"), latin700: await loadFont("plex-latin-700"), latin600: await loadFont("plex-latin-600") };

/* ── renderer / scene ── */
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const gl = renderer.getContext();
const MAX_SAMPLES = gl.getParameter(gl.MAX_SAMPLES);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.026);
const camera = new THREE.PerspectiveCamera(28.3, W / H, 0.1, 120);

/* ── two open-book groups (spec E0) ── */
const GL = new THREE.Group(); GL.position.set(-5.45, 0.95, 0); GL.rotation.y = deg(16); scene.add(GL);
const GR = new THREE.Group(); GR.position.set(4.95, 0.92, 0); GR.rotation.y = deg(-16); scene.add(GR);

/* ── camera (spec "camera") ── */
const P0 = new THREE.Vector3(0, 0.55, 0);
// 10° orbit, no look-at counter-sway: the move reads as a real camera drift (flanks travel ~70-90 px, lamp parallax ~370 px).
const CAM_AZ = 10, CAM_SWAY = 0;
const _C = new THREE.Vector3(), _L = new THREE.Vector3();
function cameraAt(t, cam = camera) {
  const th = TAU * t / PERIOD;
  const D = 16.0 + 1.4 * Math.cos(th), a = deg(CAM_AZ) * Math.sin(th), b = deg(3) + deg(2) * Math.sin(2 * th);
  _C.set(D * Math.sin(a) * Math.cos(b), D * Math.sin(b), D * Math.cos(a) * Math.cos(b)).add(P0);
  _L.set(CAM_SWAY * Math.sin(th - 0.25), 0.06 * Math.sin(2 * th - 0.25), 0).add(P0);
  cam.position.copy(_C); cam.up.set(0, 1, 0); cam.lookAt(_L);
  cam.rotateZ(deg(0.35) * Math.sin(th + Math.PI / 4));
  cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(4.287 * (1 + 0.02 * Math.cos(th)) / _C.distanceTo(_L)));
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}

/* ── helpers handed to modules ── */
const R = L.rng(0xDAB);
function canvasTex(w, h, draw) {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c2 = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const api = { canvas, c2, tex, w, h, redraw(fn) { c2.clearRect(0, 0, w, h); fn(c2, w, h); tex.needsUpdate = true; } };
  if (draw) api.redraw(draw);
  return api;
}
function roundRect(c2, x, y, w, h, r) { c2.beginPath(); c2.roundRect(x, y, w, h, r); }
/** set opacity on a material or an object tree; hides at < 0.004 (spec E0) */
function setOpacity(obj, a) {
  const vis = a >= 0.004; obj.visible = vis;
  const apply = (m) => { if (!m) return; (Array.isArray(m) ? m : [m]).forEach(mm => { mm.opacity = a * (mm.userData.baseOpacity ?? 1); }); };
  if (obj.isMesh || obj.isPoints || obj.isLine) apply(obj.material);
  else obj.traverse(o => { if (o !== obj && (o.isMesh || o.isPoints)) apply(o.material); });
}
const seg = new Intl.Segmenter("th", { granularity: "grapheme" });
const graphemes = (s) => [...seg.segment(s)].map(x => x.segment);
// static value-noise texture (spec E2 scan burn)
const noiseTex = (() => {
  const w = 128, h = 32, d = new Uint8Array(w * h * 4), rr = L.rng(0xB0B);
  const g = Array.from({ length: 17 * 5 }, () => rr());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / 8, fy = y / 8, ix = Math.floor(fx), iy = Math.floor(fy), tx = L.smooth(fx - ix), ty = L.smooth(fy - iy);
    const v = (i, j) => g[(j % 5) * 17 + (i % 17)];
    const n = L.lerp(L.lerp(v(ix, iy), v(ix + 1, iy), tx), L.lerp(v(ix, iy + 1), v(ix + 1, iy + 1), tx), ty);
    const k = (y * w + x) * 4; d[k] = d[k + 1] = d[k + 2] = Math.round(n * 255); d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, w, h); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
})();
/** HDR colour helper: linear colour × k (spec: "colour ×k") */
const hdr = (hexv, k = 1) => new THREE.Color(hexv).multiplyScalar(k);

const ctx = { THREE, L, S, W: Wn, deg, scene, camera, cameraAt, GL, GR, fonts, R, canvasTex, roundRect, setOpacity, graphemes,
  noiseTex, hdr, C: L.C, PERIOD, TAU, width: W, height: H, SCAN_Y: 0.886 };
window.__ctx = ctx;

/* ── E1 open-book ledger pages ── */
function makePage(outerLeft) {
  const cw = 1024, ch = 1396, pu = cw / 4.4; // px per unit
  const t = canvasTex(cw, ch, (c2) => {
    c2.globalAlpha = 0.20; c2.fillStyle = "#121C30"; roundRect(c2, 0, 0, cw, ch, 28); c2.fill();
    c2.globalAlpha = 0.55; c2.fillStyle = "#1F2B45";
    for (let y = 0.25 * pu; y < ch; y += 0.30 * pu) c2.fillRect(0, Math.round(y), cw, 3);
    c2.globalAlpha = 0.30; c2.fillStyle = "#E0563E";
    const mx = outerLeft ? 0.40 * pu : cw - 0.40 * pu;
    c2.fillRect(mx - 1.5 - 6, 0, 3, ch); c2.fillRect(mx - 1.5 + 6, 0, 3, ch);
    c2.globalAlpha = 1;
    const img = c2.getImageData(0, 0, cw, ch), d = img.data, ss = (a, b, x) => L.smooth((x - a) / (b - a));
    for (let y = 0; y < ch; y++) {
      const dt = y / ch, db = 1 - dt, my = ss(0, 0.12, dt) * ss(0, 0.25, db);
      for (let x = 0; x < cw; x++) {
        const fx = x / cw, dIn = outerLeft ? 1 - fx : fx, dOut = outerLeft ? fx : 1 - fx;
        const m = my * ss(0, 0.40, dIn) * ss(0, 0.10, dOut), k = (y * cw + x) * 4 + 3;
        d[k] = Math.round(d[k] * m);
      }
    }
    c2.putImageData(img, 0, 0);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 6.0),
    new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, depthWrite: false, fog: true }));
  m.renderOrder = -10;
  return m;
}
const pageL = makePage(true); pageL.position.set(-0.15, 0.10, -0.45); GL.add(pageL);
const pageR = makePage(false); pageR.position.set(0.15, 0.10, -0.45); GR.add(pageR);

/* ── E10 gutter hairlines ── */
const hairMat = new THREE.MeshBasicMaterial({ color: 0x1F2B45, transparent: true, opacity: 0, depthWrite: false });
const hair = new THREE.Group(); scene.add(hair);
for (const y of [1.681, 1.336, 0.991, 0.645, 0.298]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 0.008), hairMat); m.position.set(0, y, -1.2); hair.add(m); }

/* ── E11 far lamp halo ── */
const lampTex = canvasTex(512, 512, (c2) => {
  const img = c2.createImageData(512, 512), d = img.data;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const r = Math.hypot(x - 255.5, y - 255.5) / 512, v = L.smooth(1 - r / 0.5), k = (y * 512 + x) * 4;
    d[k] = d[k + 1] = d[k + 2] = Math.round(v * 255); d[k + 3] = 255;
  }
  c2.putImageData(img, 0, 0);
});
lampTex.tex.colorSpace = THREE.NoColorSpace;
// Cool ink-family lamp: an additive amber went through ACES + the ink composite as a muddy rust/mauve behind the CTAs.
const lamp = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), new THREE.MeshBasicMaterial({ color: 0x2F4677, map: lampTex.tex,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.16 }));
lamp.position.set(0, 0.3, -18); lamp.renderOrder = -20; scene.add(lamp);

/* ── E13 light rig (event point lights are created by the modules, from frame 0) ── */
scene.add(new THREE.HemisphereLight(0x22304F, 0x05080F, 0.55));
const fill = new THREE.DirectionalLight(0x8C99B5, 0.50); fill.position.set(-6, 7, 10); scene.add(fill);
const rimA = new THREE.DirectionalLight(0xF5A00B, 2.0); rimA.position.set(9, 3, -9); scene.add(rimA);
const rimB = new THREE.DirectionalLight(0xF5A00B, 1.3); rimB.position.set(-9, 2.5, -9); scene.add(rimB);
const key = new THREE.DirectionalLight(0xF5A00B, 0.55); scene.add(key);

/* ── modules ── */
const modules = [];
for (const name of MODS) {
  const mod = await import(`./modules/${name}.js`);
  modules.push({ name, ...(await mod.build(ctx)) });
}

/* ── E12 dust (built after camera exists so the headline-well attenuation can project p0 at t=0) ── */
cameraAt(0);
{
  const N = 160, rr = L.rng(0xD057);
  const p0 = new Float32Array(N * 3), ph = new Float32Array(N * 3), hm = new Float32Array(N * 2), sz = new Float32Array(N), al = new Float32Array(N), col = new Float32Array(N * 3);
  const v = new THREE.Vector3(), amber = new THREE.Color(0xF5A00B), mute = new THREE.Color(0x8C99B5);
  for (let i = 0; i < N; i++) {
    const x = -11 + 22 * rr(), y = -3 + 7 * rr(), z = -14 + 19 * rr();
    p0.set([x, y, z], i * 3); ph.set([rr() * TAU, rr() * TAU, rr() * TAU], i * 3);
    hm.set([rr() < .5 ? 1 : 2, rr() < .5 ? 1 : 2], i * 2);
    sz[i] = 2.0 + 1.2 * rr(); let a = 0.10 + 0.20 * rr();
    v.set(x, y, z).project(camera);
    const ux = (v.x + 1) / 2, yt = 1 - (v.y + 1) / 2;
    if (Math.exp(-(((ux - 0.5) / 0.27) ** 2 + ((yt - 0.22) / 0.13) ** 2)) > 0.25 && v.z < 1) a *= 0.35;
    if (Math.abs(x) < 3) a *= 0.5;
    al[i] = a; (rr() < 0.15 ? amber : mute).toArray(col, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p0, 3)); g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 3));
  g.setAttribute("aHarm", new THREE.BufferAttribute(hm, 2)); g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(al, 1)); g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  var dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTheta: { value: 0 } },
    vertexShader: `uniform float uTheta; attribute vec3 aPhase; attribute vec2 aHarm; attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position + vec3(0.25*sin(aHarm.x*uTheta + aPhase.x), 0.18*sin(aHarm.y*uTheta + aPhase.y), 0.30*sin(aHarm.x*uTheta + aPhase.z));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = -mv.z;
        vA = aAlpha * exp(-pow(0.026*d, 2.0)); vC = aColor;
        gl_PointSize = aSize; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 c = gl_PointCoord - .5; float r = length(c); float a = smoothstep(.5, .1, r) * vA; gl_FragColor = vec4(vC * a, a); }`,
  });
  const dust = new THREE.Points(g, dustMat); dust.frustumCulled = false; dust.renderOrder = 5; scene.add(dust);
}

/* ── post (spec "post") ── */
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: Math.min(4, MAX_SAMPLES) });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.55, 0.45, 0.80);
bloom.highPassUniforms.smoothWidth.value = 0.25; // soft knee: halos fade in/out with intensity instead of popping
const _bs = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => _bs(Math.round(w / 2), Math.round(h / 2)); bloom.setSize(W, H);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass(L.GradeShader); grade.uniforms.uRes.value.set(W, H);
if (q.get("well") === "0") grade.uniforms.uWell.value = 0;
composer.addPass(grade);

/* ── per-frame ── */
window.updateAt = (tIn) => {
  const t = L.wrapT(tIn), th = TAU * t / PERIOD;
  cameraAt(t);
  key.position.set(-4 + 1.5 * Math.sin(th), 5, 6 + 1.5 * Math.cos(th));
  lamp.material.opacity = 0.16 * (1 + 0.10 * Math.sin(th));
  const ha = 0.18 * Wn(t, 6.40, 7.40) * (1 - Wn(t, 13.80, 14.60)); hairMat.opacity = ha; hair.visible = ha >= 0.004;
  dustMat.uniforms.uTheta.value = th;
  for (const m of modules) m.update(t);
  scene.updateMatrixWorld(true);
};
window.renderAt = (tIn) => { window.updateAt(tIn); composer.render(); };
/** world -> 1920x1080 frame pixel projection at time t (used by the legibility gate) */
window.projectAt = (t, pts) => { cameraAt(L.wrapT(t)); return pts.map(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) / 2 * 1920, (1 - v.y) / 2 * 1080, v.z]; }); };
/** frame-space bounding boxes of every visible mesh inside GL and GR at time t */
window.boxesAt = (t) => {
  window.updateAt(t);
  const out = []; const v = new THREE.Vector3(), im = new THREE.Matrix4();
  for (const [gname, grp] of [["GL", GL], ["GR", GR]]) grp.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || o === pageL || o === pageR) return;
    let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis || (o.material && !Array.isArray(o.material) && o.material.opacity < 0.02 && o.material.transparent)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const gb = o.geometry.boundingBox;
    const chain = []; for (let p = o; p && p !== grp; p = p.parent) if (p.name) chain.unshift(p.name);
    const path = chain.join("/") || o.type;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < n; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); im.premultiply(o.matrixWorld); if (Math.abs(im.determinant()) < 1e-12) continue; }
      else im.copy(o.matrixWorld);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < 8; i++) { v.set(i & 1 ? gb.max.x : gb.min.x, i & 2 ? gb.max.y : gb.min.y, i & 4 ? gb.max.z : gb.min.z).applyMatrix4(im).project(camera);
        const px = (v.x + 1) / 2 * 1920, py = (1 - v.y) / 2 * 1080; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
        const op = !o.material ? 1 : Array.isArray(o.material) ? Math.max(...o.material.map(m => (m.transparent ? m.opacity : 1))) : (o.material.transparent ? o.material.opacity : 1);
      out.push({ g: gname, name: path, path, op, x0, y0, x1, y1 });
    }
  });
  return out;
};
window.__info = { MAX_SAMPLES, samples: rt.samples, modules: modules.map(m => m.name) };
window.__ready = true;

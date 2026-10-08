// Shared helpers for the loop. Everything is a pure function of t in [0, PERIOD).
import * as THREE from "three";
export const PERIOD = 15, TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOutCubic = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeOutBack = (x, s = 1.4) => { x = clamp(x) - 1; return 1 + (s + 1) * x * x * x + s * x * x; };
/** wrapped time: signed distance from `a` going forward, in (-P/2, P/2] */
export const wrapT = (t) => ((t % PERIOD) + PERIOD) % PERIOD;
/** 0..1 ramp from a to b, wrap-aware (a may be > b across the seam) */
export function ramp(t, a, b) {
  t = wrapT(t); const len = wrapT(b - a); const d = wrapT(t - a);
  return d <= len ? d / len : (d > len + (PERIOD - len) / 2 ? 0 : 1);
}
/** envelope: 0 before a, rises over `fi`, holds, falls over `fo` ending at b. wrap-aware. */
export function env(t, a, b, fi = .6, fo = .6, ease = smoother) {
  t = wrapT(t); const len = wrapT(b - a) || PERIOD; const d = wrapT(t - a);
  if (d > len) return 0;
  return Math.min(ease(d / fi), ease((len - d) / fo));
}
export function rng(seed) { // mulberry32
  return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
    x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}
export const hex = (h) => new THREE.Color(h);
export const C = { ink: 0x0B1220, panel: 0x121C30, panel2: 0x0E1728, edge: 0x1F2B45, amber: 0xF5A00B, red: 0xE0563E,
  green: 0x34D399, warn: 0xF5C044, txt: 0xE9EEF7, mute: 0x8C99B5, faint: 0x5E6B80 };

/** Final grade: chromatic aberration at the edges, vignette, static-free dither, then composite over brand ink
    with a screen blend so the frame edges are exactly #0B1220 like the page. */
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uInk: { value: new THREE.Vector3(11 / 255, 18 / 255, 32 / 255) } /* sRGB, this pass runs after OutputPass */, uRes: { value: new THREE.Vector2(1920, 1080) },
    uCA: { value: 0.0003 }, uVig: { value: 0.30 }, uTime: { value: 0 }, uGrain: { value: 0.010 }, uExposure: { value: 1.0 }, uWell: { value: 1.0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uInk; uniform vec2 uRes; uniform float uCA, uVig, uTime, uGrain, uExposure, uWell;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
    void main(){
      vec2 c = vUv - .5; float r2 = dot(c*vec2(1.0, .5625), c*vec2(1.0,.5625));
      vec2 off = c * uCA * (1.0 + 6.0*r2);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b) * uExposure;
      float vig = smoothstep(0.75, 0.15, length(c*vec2(1.0,0.82)));
      col *= mix(1.0 - uVig, 1.0, vig);
      // headline well: darken + desaturate only where the H1 sits (union of H1 boxes at 1280-2560 viewports)
      float yt = 1.0 - vUv.y;
      float Wl = uWell * exp(-(pow((vUv.x - 0.5) / 0.27, 2.0) + pow((yt - 0.22) / 0.13, 2.0)));
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lum), 0.3 * Wl) * (1.0 - 0.40 * Wl);
      // ink composite (screen): black -> ink exactly; brights stay bright
      col = 1.0 - (1.0 - uInk) * (1.0 - col);
      // gentle static dither against banding in the dark gradients
      float n = hash(floor(vUv*uRes)) - .5;  // static: temporal grain would cost bitrate
      col += n * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

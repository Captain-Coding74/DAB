# Hero background: "Night Audit — The Open Ledger"

Source for the 15-second loop behind the `/welcome` hero
(`frontend/public/dab-bg.webm`, `dab-bg.mp4`, `poster.jpg`). It is rendered
offline with three.js in headless Chromium and checked in as video, so the
landing page ships no WebGL and no extra JavaScript, and the CSP is unchanged.

This folder is **not** an npm workspace. Nothing here runs in the app build or CI.

## What it shows

An after-hours ledger lies open on both sides of the headline. The gutter
behind the H1 stays dark on purpose, so nothing kinetic ever sits behind the copy.

| t (s) | Left page — intake | Right page — sculpture |
|---|---|---|
| 0 – 3 | The banner row `รายงานยอดขาย ร้านป้าศรี` hits the scan line, flushes red, gets struck through, tagged `SKIPPED — หัวรายงาน`, and collapses into a grey rule. | 96 ledger cells drift as a loose cloud, then settle into a 12 × 8 grid. The header `วันที่ · สินค้า · จำนวน · ยอดขาย` lands with `HEADER ✓`. |
| 4 – 8 | `14 ม.ค. 2569` burns away at the scan line and is reset as extruded `2569-01-14`. The year reels count down 543 to `2026-01-14` (พ.ศ.→ค.ศ.). | Nine red-flagged cells flip a full turn and come up repaired: red, then amber, then a green glint. The grid topples into a segmented bar chart, with week 9 as the red outlier. |
| 8 – 12 | `฿1,234.50` is set in 3D, then the ฿ and the comma squeeze out and the digits zip closed to `1234.50`. | The bars curl into a double-ruled seal, the 3D twin of the console's `2px double` grade border. A green **B+** stamps into it. |
| 12 – 15 | `(500)` is set, then `)` drops out and `(` rotates and flattens into the minus: `-500`. | The seal peels back into the cloud and the flags turn red again: a new messy file has arrived. |

A caption under the sculpture drum-rolls `01 PARSE → 02 CLEAN → 03 CHART → 04 GRADE`
with the Thai words `อ่านไฟล์ / แก้ค่า / วาดกราฟ / ให้เกรด`. Its under-rule follows the
page's severity colours: red, amber, warn, green.

The camera runs one unbroken closed move: a 10° orbit with a 2:1 vertical bob,
a 16 ± 1.4 u dolly with a dolly-zoom FOV of about 28–32°, and a gentle roll.
The two pages turn against it, and the far navy lamp halo and the dust carry
the parallax (the halo drifts about 370 px across the loop).

## Rules the loop keeps

- **Seamless.** `renderAt(t)` is a pure function of `t`. Everything is built
  from `sin/cos(2πt/15)` harmonics, from card phases `u = (t/3.75 + c) mod 4`,
  or from windows that close before 14.73 s. Frame 449 runs into frame 0 like
  any other pair of frames (`scripts/seam.py`).
- **Legible.** No mesh may project into the headline zones of the 1920×1080
  frame. The zones were measured from `landing.html` at 1280–2560 px through
  `object-fit: cover`. The grade also darkens and desaturates an ellipse
  behind the H1 (the "headline well"). `gate.mjs` checks every frame and exits
  non-zero on any intrusion.
- **Whole on every laptop.** Readable tokens stay inside frame x 60–1860.
  From 1440 px up, cover shows that range. At 1280–1439 px, `landing.html`
  width-fits exactly that range, top-anchored. `gate.mjs` fails if a token
  leaves it. Its headline zones were measured through cover. The 1280–1439
  width-fit was checked separately against the real EN/TH text boxes for all
  450 frames.
- **Light where it can't be seen.** Below 1280 px only the near-still centre
  glow would show, so each `<source>` carries a `media` query and phones,
  tablets and reduced-motion visitors never download the video. Below
  1280 px the page shows `poster.jpg` (frame 0). From 600 to 1279 px a CSS
  mask keeps it to the calm centre, because cropped tokens would read wrong
  ("B-" for B+). Reduced motion gets `poster-still.jpg`, a settled frame with
  the video's .66 opacity baked in.
- **On brand.** The scene is built from the page's own tokens (ink `#0B1220`,
  amber `#F5A00B`, red, warn, green, mute) and its self-hosted IBM Plex faces.
  The only additions are darkened amber and green shades for the extrusion
  walls and a navy `#2F4677` lamp. The scene renders on black and is
  screen-composited onto the ink, so the frame edge equals the page
  background exactly.
- **Small.** The frame is mostly flat ink with no animated grain, so VP9
  stays near 1 MB.

## Re-rendering

CHROMIUM is required: playwright-core does not find a browser on its own.
Point it at a Chromium binary, or run `npx playwright-core install chromium`
and use the path that prints. The shipped frames came from Chromium
141.0.7390.37 (Playwright build chromium-1194) with SwiftShader,
playwright-core 1.64.0 and three 0.186.1. The same build reproduces them bit
for bit. Other builds differ by a few anti-aliased pixels.

```bash
cd tools/hero-bg
npm ci                                   # three + playwright-core
export CHROMIUM=/path/to/chromium
node render.mjs --out frames             # 450 PNGs, ~1.5 s each on software WebGL (3 workers)
node gate.mjs                            # legibility + crop gate, expect "GATE OK" and no CROPPED
python3 scripts/seam.py frames           # loop seam, expect "SEAM OK"  (pip install numpy pillow)
FFMPEG=ffmpeg bash scripts/encode.sh frames out 0   # needs libvpx-vp9 + libx264
cp out/dab-bg.webm out/dab-bg.mp4 out/poster.jpg ../../frontend/public/
# reduced-motion still: a settled frame with the page's .66-over-ink video opacity baked in (ink #0B1220 × 0.34)
ffmpeg -i frames/f0375.png -vf "scale=1600:-2,lutrgb=r='0.66*val+3.74':g='0.66*val+6.12':b='0.66*val+10.88'" -q:v 4 ../../frontend/public/poster-still.jpg
node preview.mjs preview 0,5.6,11.7      # real landing page with the video paused at each t
```

Quick looks: `node render.mjs --out frames/quick --times 0,5.6,11.65`. Add
`--q "modules=intake"` to render one subsystem, or `--q "well=0"` to switch
off the headline well.

## Files

| File | What it is |
|---|---|
| `scene.js` | Renderer, camera, post chain (MSAA, half-res bloom, grade), ledger pages, gutter hairlines, lamp, dust, lights, module loader |
| `modules/intake.js` | Left page: conveyor cards, Thai typing, scan line and burn, extruded figures, odometer, squeeze, paren fold |
| `modules/sculpture.js` | Right page: 96 instanced cells through cloud → grid → bars → ring, header, tags, months |
| `modules/stamp.js` | B+ stamp, shock ring, act caption drum-roll |
| `lib.js` | Timing helpers, seeded RNG, brand colours, grade shader (vignette, faint edge chromatic aberration, headline well, ink composite, static dither) |
| `gate.mjs`, `preview.mjs` | Legibility/crop gate over every frame; real-page screenshots with the video paused at given times |
| `assets/*.typeface.json` | IBM Plex outlines for extruded type, generated from `frontend/public/fonts` by `scripts/woff2_to_typeface.py` (needs fonttools + brotli) |

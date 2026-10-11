# Hero background: "Night Audit — Line by Line"

Source for the 30-second loop behind the `/welcome` hero
(`frontend/public/dab-bg.webm`, `dab-bg.mp4`, `poster.jpg`, `poster-still.jpg`).
It is rendered offline with three.js in headless Chromium and checked in as
video, so the landing page ships no WebGL and no extra JavaScript, and the CSP
is unchanged.

This folder is **not** an npm workspace. Nothing here runs in the app build or CI.

## What it shows

An after-hours ledger lies open on both sides of the headline. Every
on-screen word is English. The four steps play one at a time, and a step rail
under the right page (`01 PARSE · 02 CLEAN · 03 CHART · 04 GRADE`) always
shows the whole pipeline: the active step is lit, finished steps roll their
number to a green check, and each segment fills on the event it reports.

| t (s) | Step | Left page: the raw file, read line by line | Right page: the answer |
|---|---|---|---|
| 0 – 8.6 | 01 PARSE | Four messy rows type in. The reading line crosses `Monthly sales report`, flushes red, strikes it, tags it `SKIPPED — banner row` and files it as a grey rule. | The loose cell cloud settles into a 12 × 8 grid. The header `Date · Item · Qty · Sales` lands with `HEADER ✓`. |
| 8.6 – 19.6 | 02 CLEAN | One row at a time: `14/01/2569` burns away and is set as 3D `2026-01-14`, its year counting down 543 on odometer reels (`B.E.→C.E.`). `฿1,234.50` squeezes to `1234.50`. `(500)` folds into `-500`. | Each fix is echoed under its own header word, `Date` then `Sales`: three red-flagged cells flip to amber, then glint green. |
| 19.6 – 23.8 | 03 CHART | A warm glint rakes the clean column, which then dims. | The grid topples into a bar chart, with week 9 as the red outlier, and `Jan · Feb · Mar` type in. |
| 23.8 – 28.0 | 04 GRADE | The column's margin rules turn green, row by row. | The bars curl into a double-ruled seal and a green **B+** stamps into it. All four steps are checked. |
| 28.0 – 30 | reset | Rows file away and the line makes a carriage return home. | B+ splits, the seal peels back into the cloud, the rail rewinds to `01 PARSE`. |

The camera runs one unbroken closed move per loop: a 10° orbit with a 2:1
vertical bob, a 16 ± 1.4 u dolly with a dolly-zoom FOV of about 28–32°, and a
gentle roll. It is phased so the far point lands on the banner rejection
(4 s), the left page is face-on for the year reels (11.5 s), the camera is
nearest for the bars (19 s), and the right page is face-on for the B+
(26.5 s). The navy lamp halo and the dust carry the parallax.

## Rules the loop keeps

- **Seamless.** `renderAt(t)` is a pure function of `t`. Every scheduled
  window lives in `schedule.js` and lies inside [0.25, 29.90] s. The seam
  holds only periodic motion: harmonics of `2πt/30`, the cloud drift on
  `2πt/15`, and pulses whose periods divide 30. Frame 899 runs into frame 0
  like any other pair of frames (`scripts/seam.py`).
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
  900 frames.
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
node render.mjs --out frames             # 900 PNGs, ~1.2 s each on software WebGL (3 workers), ~18 min
node gate.mjs                            # legibility + crop gate, expect "GATE OK" and no CROPPED
python3 scripts/seam.py frames           # loop seam, expect "SEAM OK"  (pip install numpy pillow)
FFMPEG=ffmpeg bash scripts/encode.sh frames out 0   # needs libvpx-vp9 + libx264
cp out/dab-bg.webm out/dab-bg.mp4 out/poster.jpg ../../frontend/public/
# reduced-motion still: a settled frame with the page's .66-over-ink video opacity baked in (ink #0B1220 × 0.34)
ffmpeg -i frames/f0839.png -vf "scale=1600:-2,lutrgb=r='0.66*val+3.74':g='0.66*val+6.12':b='0.66*val+10.88'" -q:v 4 ../../frontend/public/poster-still.jpg
node preview.mjs preview 3.3,10.8,14.3,17.4,22.9,26.3,27.97   # real landing page, one shot per step
```

Quick looks: `node render.mjs --out frames/quick --times 0,3.6,10.8,14.3,17.7,21.9,25.9,27.97,29.3`. Add
`--q "modules=intake"` to render one subsystem, or `--q "well=0"` to switch
off the headline well.

## Files

| File | What it is |
|---|---|
| `schedule.js` | The master schedule: every window of the four steps and the reset, read by every module |
| `scene.js` | Renderer, camera, post chain (MSAA, half-res bloom, grade), ledger pages, gutter hairlines, lamp, dust, lights, module loader |
| `modules/intake.js` | Left page: the four raw rows, typing, the reading line and its burn, extruded figures, odometer, squeeze, paren fold, the clean column |
| `modules/sculpture.js` | Right page: 96 instanced cells through cloud → grid → bars → ring, header, tags, months |
| `modules/stamp.js` | B+ stamp, shock ring, sweep light, and the step rail |
| `lib.js` | Timing helpers, seeded RNG, brand colours, grade shader (vignette, faint edge chromatic aberration, headline well, ink composite, static dither) |
| `gate.mjs`, `preview.mjs` | Legibility/crop gate over every frame; real-page screenshots with the video paused at given times |
| `assets/dab-render-*.typeface.json` | Outlines for the extruded type, generated from `frontend/public/fonts` by `scripts/woff2_to_typeface.py` (needs fonttools + brotli). They are Modified Versions of IBM Plex under the SIL OFL 1.1, so they are named "DAB Render Sans Thai" and "DAB Render Mono": a modified font may not use the Reserved Font Name "Plex". The page's own woff2 files are unmodified and keep their names |
| `assets/OFL.txt` | The OFL text and IBM's copyright notices for those outlines, written by `npm run licenses` at the repo root (`licenses:check` fails if it goes stale or a family name contains "Plex" again) |

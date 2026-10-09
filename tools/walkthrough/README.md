# "How it works" walkthrough

Source for the 23-second loop in the `#how` section of `/welcome`
(`frontend/public/dab-walk.webm`, `dab-walk.mp4`, `dab-walk-poster.jpg`,
`dab-walk-still.jpg`). It is a guided tour of the **real app**: real
screenshots of the production bundle, its real hover states and its real
tab-mount animations. The only added layers are a cursor, ripples, amber
brackets, an ink spotlight, a scrim and English captions.

This folder is **not** an npm workspace. Nothing here runs in the app build or CI.

What ships (23.0 s, 690 frames, 1600 × 900, 30 fps, seamless loop):

| File | Size | Budget | What |
|---|---|---|---|
| `dab-walk.webm` | 1.33 MB | ≤ 1.8 MB | VP9 two-pass, CRF 36, `+bitexact` (Chrome, Firefox, Edge) |
| `dab-walk.mp4` | 1.73 MB | ≤ 2.8 MB | H.264 high@4.1, CRF 24, `+faststart` (Safari) |
| `dab-walk-poster.jpg` | 95 KB | ≤ 110 KB | frame 0, the `<video>` poster |
| `dab-walk-still.jpg` | 104 KB | ≤ 150 KB | t = 16.8 s (graded A, captioned), for reduced motion and Save-Data |

Shipped from capture session `7e92c989-8db4-4176-8293-d67b832201cd` (app 21.3.0, commit 87e0f3ce, Chromium
141.0.7390.37): SERVER 60 ms, PERCEIVED 30 ms, toast cut on frame 283 (9.433 s), bars settled on B2 frame 19 (19.033 s).

**The capture session is not in git.** `capture/` is gitignored (about 14 MB per session), so a fresh clone cannot
re-render this exact film: `render.mjs` stops with "no capture". On a clone, any change that needs a re-render, even
a caption timing, starts with a re-capture, and that burns in new SERVER / PERCEIVED figures (they are real
measurements and vary from run to run).

## What it shows

The capture runs at 1440 × 900 CSS px, DPR 2, dark, EN, with the bundled
ยอดขายร้านโชห่วย ("corner-shop sales") sample. The app header (y < 56) is never
in frame.

| t (s) | Beat | On screen |
|---|---|---|
| 0 – 0.6 | seam hold | Empty state, cursor parked at P. Frame 0 is the poster. |
| 0.6 – 3.5 | 01 · the dropzone | The camera closes on the file card, the cursor reaches the dropzone (hand cursor), spotlight + brackets. No click: that would open the OS file picker. |
| 3.5 – 5.9 | 01 · tap the sample | The real card hover (2 px lift, amber glow, amber title), press, click at 5.900 s. The card's spotlight and brackets have faded out by the click. |
| 5.9 – 6.9 | 02 · power-on (burst B0) | 30 real frames: (at PERCEIVED ≥ 17 ms) the loading state, then the readout counts up, the four findings rise in, and the toast appears. No ripple: the layout swap is the click's feedback. The cursor parks at PR, in frame. |
| 6.9 – 9.9 | 02 · inspected | The real 1440-wide viewport. Brackets on SERVER. At ≈ 9.43 s the toast leaves with the app's own 3.5 s hard cut. |
| 9.9 – 13.5 | 03 · margin notes | INSIGHTS, with finding 1 bracketed: `"ยอดขาย" มี outliers 6 จุด (14.0%)`, WARNING. |
| 13.5 – 17.4 | 03 · the grade (burst B1) | The cursor runs PR → QUALITY along the gap. Caption 4 leaves before the click (14.50 s), and only the STEP 03 eyebrow stays. 30 real frames: the ring draws to 92 and `GRADE A · 92/100` stamps at ≈ 840 ms; caption 5 comes in with it (15.34 s) and the caption rule turns green. |
| 17.4 – 21.5 | 03 · a chart (burst B2) | PR → CHARTS; caption 5 leaves before the click (18.40 s). Loaded cold: 24 to 36 real frames of the lazy-chunk skeleton, then the Recharts bars grow. Caption 6 comes in once they settle. |
| 21.5 – 23 | reset | The last caption and its rule fade 21.32–21.62, then the scrim lifts 21.62–21.92. The camera whips back to S0 (21.70–22.70) while the cursor glides PR → P (21.95–22.35). At the whip's fastest frame, 22.20 s, the plate cuts from L04c to the empty state below y 380: f666 is pure L04c, f667 pure L01, and no frame blends the two. |

## Rules the loop keeps

- **Honest by construction.**
  - Every UI pixel is either a PASS A still or a PASS B burst frame.
  - Every burst must end on PASS A's exact pixels (the continuity gate).
  - A hover is shown only while the drawn cursor is inside that element's measured box, and only if the real hover changes pixels.
  - Every caption number comes from the capture's DOM.
- **Seamless.** `schedule.js` is the single source of truth, and its helpers are pure functions of `t`. Every window lies in [0.60, 22.70]. Frame 689 equals frame 0.
- **The cursor stays in frame.** It parks at P in the empty state and at PR (900, 648) in the results, in the gap above the tab bar that every results framing shows. P is clear in every state, but PR lies inside sample card 3 in L01, so the film-only `home` path takes the cursor back to P during the reset whip and is clear of card 3 before the cut.
- **One run, never mixed.** All assets live in `capture/<session>/`, and every PNG carries the session id in a `tEXt` chunk (`dab-walk-session`; read it with `png.mjs` `readSession`). A re-capture regenerates everything together.

## Capture (two passes)

```bash
cd tools/walkthrough
npm ci                                            # playwright-core only
(cd ../.. && npm run build -w frontend)           # capture.mjs refuses a dist older than frontend/src
CHROMIUM=/path/to/chromium node capture.mjs       # ~70–100 s; expect "CAPTURE OK — session <uuid>"
```

`app.mjs` boots the app with the following settings:

- `backend/src/server.js` serving `frontend/dist`;
- `AI_MOCK=1`, a throwaway `SQLITE_DIR`, port 3411 (`WALK_PORT=…` overrides it, so two captures can run side by side);
- one browser context: 1440 × 900 @2x, `colorScheme: dark`, `reducedMotion: no-preference`;
- `dab_landing_lang=en` and `dab_tour_done=1`, seeded by an init script.

**PASS A (truth)** runs on the real clock, and nothing is faked or intercepted.

- It drives the real mouse along the film's own cursor paths (`schedule.js` `PATHS`, all but the film-only `home`) and saves `L01, H1, L02, L02-down, L03, L03b, H3, H3-down, L04q, H4, H4-down, L04c`. L01 is shot with the mouse at P; L03b, L04q and L04c with it parked at PR.
- It records the analysis response (`response.json` and its sha256) and reads PERCEIVED from `window.__DAB_PERF__.spans.demo.ms`.
- It asserts:
  - the PERCEIVED cell matches that span;
  - the SERVER cell matches `durationMs`;
  - the toast text matches as well.
- It measures every state into `meta.json`:
  - boxes;
  - hoverable rects (a, button, tab, input, textarea, `hover:` classes);
  - pointer rects;
  - `innerText`;
  - the strings the captions need.

**PASS B (motion)** uses the same server and context, with a new page on `page.clock.install()`.

- The analysis request is held, then fulfilled with PASS A's bytes exactly at click + PERCEIVED. The app's own span therefore equals PASS A's.
- CSS animations and transitions are paused at birth, stamped with fake time, and seeked per output frame. The clock steps in sub-steps of at most 8 ms.
- Frame k samples click + (k + ½)/30 s.
- In B2, the lazy chart chunk requests are held until PASS A's measured mount offset (`meta.chartsA.surfaceMs`), so the skeleton lasts as long as it really did.

**Checks.** Any failure exits non-zero.

| Check | Rule |
|---|---|
| A9 locality | L01, L02 and L03 are identical above y 380. L01 ≡ L02 outside the card clip. L03b ≡ L04q outside the B1 clip. L04q ≡ L04c outside the B2 clip. L03 ≡ L03b outside the toast. L01 ≡ L04c above y 380. L01 ≡ L03 outside the B0 clip. |
| Hover confinement | Each hover plate differs from its state only inside the box the film crossfades in. |
| Continuity | The last frame of each burst vs the PASS A still at the same clip: mean \|Δ\| ≤ 0.5/255 and p99.9 ≤ 8/255. A miss marks the burst unusable, and the film falls back to a 150 ms dissolve. The reference runs are exact (0 px). |
| Burst locality | Full-page shots during each burst equal the PASS A still outside the clip. |
| Figures | B0's app-computed PERCEIVED and SERVER equal PASS A's. B0 never samples the loading state above its clip. B2's bars settle on PASS A's geometry (otherwise the burst extends to settle + 3 frames, cap 36). |
| Captions | All six fill from meta through the explicit TH→EN map and regexes. Every caption number appears in that state's `innerText`. |
| Paths | No cursor path enters a hoverable rect it is not meant to hover, sampled at 240 Hz in the state on screen at each sample (so `home` is checked against L04c, then L01 after the reset cut). |

Output: `capture/<session>/` holds `meta.json`, `response.json`, 12 stills and `B0/ B1/ B2/` (84 frames), about 14 MB, all gitignored. `capture/LATEST` names the newest passing session.

## Render → gate → seam → encode → install

```bash
cd tools/walkthrough
export CHROMIUM=/path/to/chromium                 # the shipped frames: Playwright chromium-1194 (141.0.7390.37)
node render.mjs --out frames                      # 690 PNGs, 1600x900, 3 workers, canvas 2D: ~70 s
node render.mjs --out frames/quick --times 0,2.6,5.4,6.4,8.5,9.45,12.5,15.4,16.8,20.5,22.3   # quick looks, ~3 s
node gate.mjs                                     # expect "GATE OK — 23 checks"  (~55 s)
python3 scripts/seam.py frames                    # expect SEAM OK, seam diff 0.000
FFMPEG=/path/to/ffmpeg bash scripts/encode.sh frames out           # needs libvpx-vp9 + libx264: ~3 min
FFMPEG=/path/to/ffmpeg python3 scripts/textcheck.py frames out/dab-walk.webm out/dab-walk.mp4   # expect TEXT OK twice
cp out/dab-walk.webm out/dab-walk.mp4 out/dab-walk-poster.jpg out/dab-walk-still.jpg ../../frontend/public/
```

`render.mjs` and `gate.mjs` composite `capture/LATEST` by default. Use `--session <uuid>` (or `WALK_SESSION`) to pick
another session. `scripts/seam.py` and `scripts/textcheck.py` need numpy and Pillow; the npm scripts (`npm run seam`,
`npm run textcheck`) use `$PYTHON` if set, else `python3`. Playwright's bundled ffmpeg is VP8-only; any ffmpeg with
libvpx-vp9 and libx264 works (the shipped encode used the static ffmpeg 7.0.2 from imageio-ffmpeg).

### The compositor (`index.html` + `compositor.js`)

`renderAt(t)` is a pure function of t. It computes everything from `schedule.js` and `meta.json`, awaits every bitmap
the frame needs, and only then draws the frame in one go. Frames can render in any order and in parallel. The gate
proves this by re-rendering a shuffled sample in one disturbed page and comparing pixels.

- **Plates are never resampled per layer.** The base plate, the hover crossfades and the burst frames are composited at
  the capture's own resolution (DPR 2, integer device px). Every layer is a 1:1 copy of captured pixels, blended only
  where `schedule.js` schedules a crossfade. Then the camera rect is resampled once to 1600 × 900 (canvas
  `imageSmoothingQuality: "high"`, which measures between PIL bilinear and bicubic). So every layer shares one camera
  mapping, a clip edge cannot show a seam, and the composite pads 8 px of real plate around the camera rect, so
  the filter's edge taps read true neighbours.
- **Overlays** (`<svg id=ov>`, frame px, recomputed from page boxes every frame):
  - the spotlight: `.42` ink with a σ 5 feathered rounded hole;
  - the amber L-brackets;
  - the click ripple (QUALITY and CHARTS; the card click has none, `CLICKS.card.ripple: false`);
  - the cursor: a 30 px arrow, or the pointing hand only over the state's pointer rects, with an 80 ms crossfade and the press scale `.86` about the tip.
- **Scrim and captions** are DOM over the canvas, with IBM Plex Sans 600 / Mono 400 and 500 served from
  `frontend/public/fonts`. The page has `*{transition:none;animation:none}`, so nothing tweens on its own. The margin
  rule comes in with the scrim but leaves with the last caption, so nothing of the caption hangs over the app
  content the lifting scrim uncovers.
- **Captions** are filled from `meta.json` only (`captionTexts`): an explicit TH→EN map plus regexes, and any miss
  throws. The compositor refuses to start if its fill differs from the capture's own (`meta.captions`), if a burst
  clip disagrees with `schedule.js`, or if the toast-cut frame disagrees with `meta.perceivedMs`. Caption 6 comes in
  at 18.94 s, or on the first frame the real bars have settled if that is later (`meta.bursts.B2.settleFrame`; 19.033 s
  in the shipped session).
- **Debug hooks:**
  - `window.__info(t)` returns the camera, layers, overlays, caption and state;
  - `window.__composite(t, rect)` returns the plate composite before resampling;
  - `window.__session`.

### What `gate.mjs` checks (all 690 frames)

| Check | Rule |
|---|---|
| header / upsampling | camera y0 ≥ 60 (the app header and its version chip never show); camera w ≥ 800 CSS px |
| coverage | every plate drawn with α > 0 covers the camera rect inside its clip |
| safe zone | brackets (box + gap + arms + stroke) end at frame y ≤ 650 and stay in frame. During holds, the toast's bottom is ≤ 655, or it sits wholly under the scrim's dense band (y ≥ 760). That happens on its first frames (f178–180 in the shipped session), at the S2 corner before the camera rises. |
| hover honesty | the tip is inside a hoverable rect only where a captured hover covers it: showing, fading in, or a captured hover that changes no pixels (H1). The B1/B2 frames show the real mouse resting on the tab it clicked, and their exact continuity proves the resting mouse leaves no hover styling. A hover plate shows only while the tip is inside or within its 150 ms fade-out. |
| pointer glyph | the hand appears only over pointer rects (or within its 80 ms crossfade), and over a pointer rect it is shown |
| figures | every caption number is in the `innerText` of the state the caption describes, and the fill equals the capture's |
| landing | `frontend/public/landing.js` `CHAPTERS` equals `schedule.js` `CHAPTERS`, and every figure in its `walkDesc` (EN and TH) and in `landing.html`'s TH `<figcaption>` appears in some captured state's `innerText`. Read only: the page files are never written |
| session | every asset carries `meta.session` (tEXt and meta) and still matches its recorded sha256 |
| continuity | each burst's last frame ≡ its PASS A still at the clip (re-checked from the PNGs) |
| loop | 22.70–23.00 ∪ 0.00–0.60 is one static state (0.93 s); `f0689` ≡ `f0000`, pixel- and byte-identical |
| plates | for about 100 frames (every 10th, each burst boundary, the toast cut, hover entries, both sides of the reset cut), an independent re-composite in Node from the PNGs equals the compositor's own plate composite. Plain pixels are exact; cross-faded pixels are within ±2 of the exact blend (8-bit canvas rounding). Every plate pixel on screen is a captured pixel. |
| purity | 24 frames re-rendered out of order in one fresh page, disturbed between frames, equal the full render |

The motion audit (consecutive-frame differences over the whole loop) shows only these single-frame spikes, and all are
real app events (frame numbers from the shipped session):

- f177: the click; with PERCEIVED 30 ms, B0's frame 0 samples the real loading state;
- f178: the results commit;
- f435 and f552: the QUALITY and CHARTS tab switches;
- f556: the chart surface mounting when the lazy chunk lands.

The toast's 3.5 s hard cut (f283) is a small step inside the SERVER overlays' fade-out. The reset cut (f666 → f667)
sits on the S6→S0 whip's fastest frame, where it adds little to the camera's own motion (mean |Δ| 12.5/255, against
12.0 for the whip step before it).

### Encode settings and why

`scripts/encode.sh` is a copy of the hero's script (the hero's own script is untouched). Its common flags are
`-pix_fmt yuv420p -g 300 -an`.

- **Keyframes at 0, 300 and 570.** A keyframe refreshes the coding noise on every edge, which a static hold shows as a
  faint shimmer. So beyond frame 0, the keyframes sit on camera moves: 10.0 s (S3→S4) and 19.0 s (S5→S6), instead of
  `-g 300`'s 600, which falls in the static chart hold. Decoded, the 599→600 step inside that hold went from a mean
  |Δ| of 0.53 to 0.002.
- **CRFs from the `scripts/textcheck.py` sweep.** The sweep ran VP9 32/34/36 and x264 22/24/26 and ships the highest
  CRF that passes.
  - VP9 CRF 36 passes, at 1.33 MB.
  - x264 CRF 26 passes luma but bleeds chroma past the 4:2:0 floor on two move frames, so H.264 stays at CRF 24.
  - `-tune-content screen` is a no-op with `-deadline good`: the output size is identical, so it is off.
- **Poster at `-q:v 4`.** At `-q:v 3` it is 113 KB, over the 110 KB budget. At `-q:v 4` it is 95 KB and indistinguishable
  at 100 %. The still is frame 504 at `-q:v 3`; 16.8 s × 30 is exactly 504, and the frame is byte-identical to
  `render.mjs --times 16.8`.
- **What `textcheck.py` measures.** It scores luma SSIM on the text crops (caption headline and sub, readout values,
  SERVER cell, the sample's meta line, finding row 1, stamp, sub-scores, chart ticks), at the six holds and every
  move midpoint. Holds must reach ≥ 0.97 and moves ≥ 0.92. The shipped worst cases (webm / mp4) are holds
  0.992 / 0.993 and moves 0.989 / 0.987.
- **Chroma.** yuv420p halves chroma, so the thin amber, red and green text (WARNING, the MISSING/DUPLICATES digits,
  the green stamp) can never match the RGB source, even losslessly. A lossless 4:2:0 round-trip of the stamp scores
  0.80 per channel. So the check is relative: each crop may lose at most 0.02 per-channel SSIM beyond that lossless
  4:2:0 floor. The shipped worst cases are −0.017 (webm) and −0.018 (mp4). At 100 % the stamp and the red digits
  look the same as the source.
- **The wrap.** The source frames are identical across the wrap. In the encodes, 689 → 0 is a P-frame to keyframe
  step: a one-frame refresh of edge noise (mean |Δ| 0.42 webm, 0.57 mp4). Playback in Chromium wraps 22.967 → 0.000
  with consecutive presented frames and no stall.
- **Reproducible bytes.** The WebM's second pass muxes with `-fflags +bitexact`, which drops the Matroska DateUTC and
  the version strings. So re-encoding the same frames with the same ffmpeg gives byte-identical files (the MP4,
  poster and still already were), and a no-op re-install leaves the tracked media unchanged.

## Re-capture when…

Re-capture after any change to:

- the app's UI (any pixel in the framed areas, fonts, the dark theme, tab order);
- the bundled sample or its analysis;
- the toast copy or its 3.5 s duration;
- the `schedule.js` keys the capture bakes in (table below).

Then re-render, re-gate and re-encode, and install all four files together (`npm run render && npm run gate &&
npm run seam && npm run encode && npm run textcheck && npm run install-media`). The SERVER figure varies from run to
run, because it is a real measurement. The burned-in caption, the toast-cut frame and caption 6's entry (after the
bars settle) all follow `meta.json` automatically. Never mix sessions: the gate fails if any drawn asset is from another
session or has changed.

After a re-capture, also update the page's hand-kept copies: `CHAPTERS` and `walkDesc` (EN and TH) in
`frontend/public/landing.js`, and the TH `<figcaption>` in `frontend/public/landing.html`. Then refresh the session id
and figures at the top of this README. `gate.mjs` fails if `CHAPTERS` differs from `schedule.js`, or if a figure in
those descriptions is not on screen in the capture.

Which `schedule.js` edits need what (remember that on a fresh clone every re-render needs a capture first):

| Change | Needs |
|---|---|
| `POINTS`, `PATHS` (all paths, `home` included: the capture drives the real mouse along them and checks each at 240 Hz), `CLICKS` `at` / `click` / `frame`, `BURSTS`, `STILLS`, `HOVERS`, `TOAST_MS`, `IDENTICAL_ABOVE_Y`, `CONTINUITY`, `VIEWPORT`, `DPR`, `PERIOD`, `FPS` | re-capture, then the full render → gate → seam → encode → textcheck → install |
| caption wording: the `CAPTIONS` eyebrow / headline / sub templates, `TRANSLATE`, `CHART_TYPES`, `captionValues` | re-capture: `meta.captions` holds the capture's own fill, and the compositor refuses a different one |
| `CAMERA` / `FRAMINGS` | re-render only, except a camera change during B0 (5.90–6.90 s), where the capture's full-page proof for the short loading document used the camera at that frame |
| caption `start` / `end`, `CAPTION_STYLE`, `SCRIM`, `SPOTLIGHTS`, `BRACKETS`, `SPOT`, `BRACKET`, `RIPPLE`, `CLICKS` `down` / `ripple`, `PRESS_SCALE`, `PRESS_RAMP`, `HOVER_FADE`, `RESET`, `OVERLAY_TARGETS` (from boxes the capture measured) | re-render only: render → gate → seam → encode → textcheck → install |
| `CHAPTERS` | no render: mirror it in `landing.js` (the gate checks the copy) |

## Findings from the capture (for the film)

- **The dropzone has no visible hover in dark mode.** In the built CSS, `.dark .dark:border-gray-700` comes after `.hover:border-brand-400:hover` at equal specificity, so the amber dashed border never shows. H1 is captured and checked, and it is pixel-identical to L01. `meta.hover.H1.differs` is `false`, so `plates()` never draws it. The cursor still turns into the hand (the dropzone is `cursor-pointer`).
- **The press plates `L02-down`, `H3-down` and `H4-down` are identical to their hover plates.** None of these elements has `:active` styles, so they are never drawn.
- **The B1 and B2 clips are 552 px high, not 470 / 530.** The QUALITY tab also mounts FixPanel's sign-in card at y 1125–1191, and the CHARTS card ends higher. Shorter clips would let those changes pop outside the bursts, and the A9 locality checks fail without the extension.
- **The B0 clip starts at y 300, not 380.** PERCEIVED is a real measurement, and on a busy machine it lands at 15–18 ms.
  - At 17 ms or more, frame 0 samples the real loading state. The busy analyze button at y 317–353 lies above 380.
  - Above 380 the frames are otherwise identical to L01/L03, so the taller clip changes nothing else.
  - During that loading frame the document is only 1058 px tall. The trimmed shot is padded with the canvas colour the browser paints past the document end, `#0B1220`, recorded in `meta.bursts.B0.frames[k].padded`.
- **Every burst is proven local.** At frames 0, mid and last, and at any frame that samples a transient state, a full-page shot must equal the PASS A still outside the clip. When the document height differs, the proof is limited to what the camera shows at that frame.

- **Some burst timings are real measurements of the capture machine, so they vary between runs.**
  - B2's skeleton lasts as long as PASS A took to mount the chart (132–169 ms across runs on this shared 4-CPU box: 4–5 frames). A faster machine shows it for less time.
  - In some runs the results first commit with the default ANALYSIS tab and switch to INSIGHTS in the same millisecond. The app's 150 ms `transition-colors` then moves the underline over B0's first frames. Both orders are the app's own React scheduling.

## Files

| File | What it is |
|---|---|
| `schedule.js` | Master schedule: PERIOD, FPS, framings, points, paths, clicks, bursts, stills, hovers, overlay windows, scrim, caption templates and the TH→EN map, `CHAPTERS` (mirrored in `frontend/public/landing.js`, checked by `gate.mjs`). Pure helpers `camera`, `cursor`, `hoverEntry`, `stateAt`, `plates`, `overlays`, `caption`, `captionTexts`, `targetBox` |
| `app.mjs` | Boots the real app (port 3411, or `WALK_PORT`), the browser and the session context. Includes the dist freshness guard |
| `capture.mjs` | The two-pass capture, the checks, and `meta.json` |
| `measure.js` | In-page measurement of one state: boxes, strings, hoverable/pointer rects, innerText |
| `png.mjs` | Dependency-free PNG decode, crop, compare and `readSession` |
| `index.html`, `compositor.js` | The compositor page: `renderAt(t)`, plus the `__info` / `__composite` hooks |
| `serve.mjs` | Static server (`/fonts/` → `frontend/public/fonts`, `/capture/` → the session) and the Chromium launcher |
| `render.mjs` | Renders `f0000–f0689.png` (or `--times`) with 3 workers, each on a contiguous run of frames |
| `gate.mjs` | The checks above; exits non-zero on any failure |
| `scripts/encode.sh` | VP9 + H.264 + poster + still |
| `scripts/seam.py` | Loop-seam check (a copy of the hero kit's, so this kit does not depend on `tools/hero-bg`) |
| `scripts/textcheck.py`, `scripts/textcrops.mjs` | Encode legibility: luma SSIM and chroma beyond 4:2:0 on the text crops (from the capture's measured boxes) |

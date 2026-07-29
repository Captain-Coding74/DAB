# The Ledger — DAB Design System

v21 · The single written reference for DAB's visual language. Values here are
the enforced ones: colour tokens live in `frontend/tailwind.config.js`,
runtime copies in `frontend/src/lib/ledger.js`, and the mirror between them is
held by `frontend/src/lib/ledger.test.js` (ADR-0007). If this document and the
config disagree, the config is right and this file has a bug.

## Idea

DAB renders analysis as a **paper ledger worked after hours**: paper surfaces,
one accounting-green family for "verified", one margin-red family for
"caught", one pencil-amber family for annotation, all sitting on navy ink in
dark mode ("After-Hours Console", v20.4). Every state colour is a mark a human
would make on a printed sheet — a stamp, a rule, a pencil note.

## Colour

| Token | Light | Role |
|---|---|---|
| `gray.50–950` | `#F2F4EC` → `#0B1220` | paper → navy ink; surfaces and text |
| `brand.300/400/500/900` | `#F0BE4E / #F5A00B / #D98B06 / #402902` | actions, focus, the mark |
| `stamp` / `.mid` / `.dark` | `#2F9E6E / #34B27B / #34D399` | verified, resolved, grade ≥80 |
| `rule` / `.deep` / `.soft` / `.line` / `.dark` | `#C13B27 / #A93321 / #F0D6D0 / #DFB0A6 / #D9573F` | caught values, errors, danger hover |
| `pencil` / `.soft` / `.line` / `.dark` | `#B7791F / #EFE2C6 / #DFC79A / #CE9A3C` | annotation, warnings, grade 60–79 |

Rules:
- **No raw hex in components.** Classes take tokens; JavaScript (Recharts,
  canvas) imports from `lib/ledger.js`. The test suite fails on drift.
- `stamp.mid` and the chart-series extensions `#3E5C76` (slate) and `#6B4E71`
  (plum) are **runtime-only** — no Tailwind class may use them, and slate/plum
  never mean state, only series.
- Chart series order is by **luminance interleave**, not hue — adjacent series
  hold ≥1.4:1 so charts survive greyscale printing (enforced).
- Measured floors (enforced): axis ≥3:1 on canvas, tooltip text ≥4.5:1,
  strong heatmap cells ≥4.5:1 (navy-on-stamp, white-on-rule).

## Typography

IBM Plex throughout, self-hosted (zero third-party requests is a tested
invariant). `IBM Plex Sans Thai` for UI text, `IBM Plex Sans Thai Looped` for
display on the landing, `IBM Plex Mono` for ledger furniture. Utility classes:
`.num` (mono, tabular numerals — every figure a user might compare), `.eyebrow`
(mono, 11px, tracked caps — section labels and entry numbers). Numbers in
charts format through `fmtNum` → `toLocaleString("th-TH")`.

## Language

UI copy is Thai. English survives only as data vernacular: chart-type *values*
(`Bar`, `Line`, …) for saved-config compatibility — their visible labels are
Thai — plus file names, stat abbreviations (min/max/avg/med/σ), and code.

## Components (`frontend/src/components/ui`)

`Wordmark` — the one logo (navy plate, amber stroke, red margin, amber bars);
never redraw it locally. `Button` — brand primary, `rule`/`rule-deep` danger,
`loading` prop gates double-submit. `Badge` — 5 variants, all tokenized;
`blue` renders neutral gray by design. `Card` + `Eyebrow` — the panel and its
label. `Input` — visible label required; placeholder is never the label.
`Modal` — focus trap, Escape, focus restore (keep it that way). `Toasts` —
keys on `t.id`, `aria-live="polite"`. `ColumnStatsPanel`
(`components/ColumnStats.jsx`) — **location is load-bearing**: it must not
live inside `components/charts`, or recharts joins the initial bundle
(v21 regression; budget enforced at 90 kB gzip initial).

## Motion

150–300ms, `transform`/`opacity` only. Named: `anim-rise` (entry),
`anim-stamp` (verdict), `anim-tab` (tab swap), `anim-drift` (landing
blueprint layer). `prefers-reduced-motion` zeroes everything **except**
`.animate-spin` — progress indication is essential motion; a frozen spinner
reads as a hang.

## Accessibility floor

Skip link + `<main id="main">` in the shell and on the landing. Focus ring:
2px `#B37204` outline, never removed. `aria-pressed` on toggles, `scope` on
data-table headers, captions on charts' tables, labels on every input,
`autoComplete` wired on auth (`current-password` / `new-password` by mode).
Touch targets ≥32px, 44px where layout allows. Colour never carries meaning
alone — pair with strike-through, icon, or label.

## Changing the system

Add a token → both `tailwind.config.js` and (if JS needs it) `ledger.js`, then
run `npm test -w frontend`: the mirror test tells you if you missed one. Then
`npm run quality` and `npm run perf:bundle` — the ratchets are the review.
Record anything expensive to reverse as an ADR (`docs/adr/`).

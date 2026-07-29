# 7. Colours needed in JavaScript live in one runtime palette

**Date:** 2026-07-26 · **Status:** Accepted

## Context

The Ledger is expressed as Tailwind tokens in `tailwind.config.js`, and almost
every surface in the app consumes them as class names. Two surfaces cannot:
Recharts takes literal colour strings as props, and the PNG export path paints
onto a `<canvas>` with `ctx.fillStyle`. Those values were typed inline in
`components/charts/index.jsx`.

Inline values do not participate in a rename. When v20.4 moved dark mode from
green-black to navy ink, the class-based surfaces migrated and the chart module
did not. It kept painting `#171C17` behind exported PNGs and behind the brush,
so in dark mode the charts sat on the previous release's palette while every
panel around them was navy.

The same file also carried stock Tailwind greys — `#374151`, `#e5e7eb`,
`#6b7280`, `#1f2937` — for tooltips, axes and gridlines. Those are the default
scale the config deliberately overrides. Twenty of the twenty-three hex values
in the module were outside the Ledger palette entirely.

This was not visible in review because each literal looked reasonable on its
own line. It was only visible by diffing the module against the config.

## Decision

Any colour needed as a JavaScript value is named in `frontend/src/lib/ledger.js`
and imported. Call sites do not contain hex literals.

The module exports:

- `LEDGER` — the raw scales, mirroring `theme.extend.colors`
- `chartTheme(dark)` — the surfaces a chart needs, keyed by mode
- `SERIES` — categorical series colours
- `corrCell(r, dark)` — correlation heatmap cells

Charts theme against their **container**, not the page: panels are white on
paper and `gray-900` on navy, so a chart's tooltip matches the panel it opens
over rather than the sheet behind it.

`SERIES` is ordered by luminance rather than hue. Six separable hues do not
exist inside four accent tokens, so `slate` and `plum` are defined here as
extensions, restricted to series and never used for state. Sorting by hue had
placed verdict green next to pencil amber at a luminance ratio of 1.08:1 —
indistinguishable in greyscale and for the common colour-vision deficiencies.
Interleaving light and dark values holds the worst adjacent pair at 1.47:1.

## Consequences

- A token rename now touches two files that sit beside each other, and a
  release cannot migrate one without the other going stale visibly.
- The duplication between `tailwind.config.js` and `ledger.js` is real and
  deliberate: Tailwind's config is not importable at runtime without pulling
  the resolver into the client bundle, which costs more than the copy does.
  The comment at the top of `ledger.js` marks it as a mirror.
- The mirror and the floors are enforced: `frontend/src/lib/ledger.test.js`
  fails if a `LEDGER` value drifts from `tailwind.config.js`, if adjacent
  series colours fall below the 1.4:1 luminance-separation floor, or if the
  chart theme drops under its contrast minimums (added v20.6).
- Contrast is now checkable, because the values are in one place. Current
  measurements: axis labels 5.74:1 on dark canvas and 4.86:1 on light,
  tooltip text 14.06:1 and 17.01:1.

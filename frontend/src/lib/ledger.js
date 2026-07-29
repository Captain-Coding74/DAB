/**
 * The Ledger — runtime palette (v20.5)
 *
 * Tailwind classes cover everything rendered as markup. Charts can't use them:
 * Recharts and canvas need literal colour values in JS. Before this module
 * those values were typed inline, and the v20.4 After-Hours migration missed
 * them — the charts kept painting the old green-black dark surface (#171C17)
 * and stock Tailwind slate for axes and tooltips, while every panel around
 * them had moved to navy ink.
 *
 * So: one file, mirroring tailwind.config.js. If a colour is needed in JS it
 * is named here, never inlined at the call site. Changing a token now means
 * changing it in two files that sit next to each other, instead of hunting
 * twenty literals across a chart module.
 */

/* Mirrors theme.extend.colors in tailwind.config.js — keep in sync. */
export const LEDGER = {
  gray: {
    50: "#F2F4EC", 100: "#E7EBE0", 200: "#D6DECE", 300: "#AEB8A9",
    400: "#82909F", 500: "#5E6B80", 600: "#465468", 700: "#2A3752",
    800: "#1F2B45", 900: "#121C30", 950: "#0B1220",
  },
  brand:  { 300: "#F0BE4E", 400: "#F5A00B", 500: "#D98B06", 900: "#402902" },
  stamp:  { DEFAULT: "#2F9E6E", mid: "#34B27B", dark: "#34D399" }, // mid: dual-mode readout green (runtime-only, no Tailwind class)
  rule:   { DEFAULT: "#C13B27", soft: "#F0D6D0", dark: "#D9573F" },
  pencil: { DEFAULT: "#B7791F", soft: "#EFE2C6", dark: "#CE9A3C" },
  white:  "#FFFFFF",
};

/**
 * Chart surfaces, keyed by mode. Panels in the app are white on paper and
 * gray-900 on navy, so charts match their container rather than the page.
 */
export const chartTheme = (dark) => (dark ? {
  surface:    LEDGER.gray[900],
  canvas:     LEDGER.gray[950],
  grid:       LEDGER.gray[800],
  axis:       LEDGER.gray[400],
  border:     LEDGER.gray[800],
  text:       LEDGER.gray[100],
  brushLine:  LEDGER.gray[700],
  brushFill:  LEDGER.gray[950],
} : {
  surface:    LEDGER.white,
  canvas:     LEDGER.gray[50],
  grid:       LEDGER.gray[200],
  axis:       LEDGER.gray[500],
  border:     LEDGER.gray[200],
  text:       LEDGER.gray[900],
  brushLine:  LEDGER.gray[300],
  brushFill:  LEDGER.gray[50],
});

/**
 * Categorical series colours.
 *
 * The first four are Ledger tokens. Categorical scales need hues that stay
 * separable, and four accents don't stretch to six series, so `slate` and
 * `plum` are defined here as extensions — used for series only, never for
 * state.
 *
 * Order is not decorative. Hue alone fails in greyscale and for the common
 * colour-vision deficiencies, so the sequence interleaves light and dark
 * values: adjacent series differ in luminance as well as hue. Sorting by hue
 * put stamp next to pencil at 1.08:1, effectively the same shade on a
 * monochrome printout. This ordering holds the worst adjacent pair at 1.47:1.
 */
export const SERIES = [
  LEDGER.brand[500],     // brand amber   L .332
  "#6B4E71",             // plum          L .098  — extension
  LEDGER.stamp.DEFAULT,  // verdict green L .262
  "#3E5C76",             // slate         L .100  — extension
  LEDGER.pencil.DEFAULT, // pencil amber  L .238
  LEDGER.rule.DEFAULT,   // margin red    L .146
];

/**
 * Correlation heatmap cells. Positive runs green, negative runs red, and the
 * diagonal stays neutral. Text colours are picked for contrast against their
 * own cell, not against the page.
 */
export const corrCell = (r, dark) => {
  const a = Math.abs(r);
  const t = chartTheme(dark);
  if (r === 1)  return { bg: dark ? LEDGER.gray[800] : LEDGER.gray[100], text: t.axis };
  if (a >= 0.7) return r > 0
    // navy ink on stamp (5.0:1) — white on this green is only 3.37:1
    ? { bg: LEDGER.stamp.DEFAULT, text: LEDGER.gray[950] }
    : { bg: LEDGER.rule.DEFAULT,  text: LEDGER.white };
  if (a >= 0.4) return r > 0
    ? { bg: "#BFE0CE", text: "#1B5138" }
    : { bg: LEDGER.rule.soft, text: "#8F2A1B" };
  return { bg: dark ? LEDGER.gray[900] : LEDGER.gray[50], text: t.axis };
};

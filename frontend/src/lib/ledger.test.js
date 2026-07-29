/**
 * ledger.test.js — v20.6: the design decisions in ledger.js, enforced.
 *
 * Three contracts, each of which has silently broken at least once in this
 * project's history:
 *
 *  1. MIRROR   ledger.js claims to mirror tailwind.config.js. The v20.4
 *              charts regression happened precisely because a JS copy of the
 *              palette drifted from the config. This test fails on drift.
 *  2. SERIES   adjacent series colours keep >=1.4:1 luminance separation, so
 *              multi-series charts survive greyscale printing and the common
 *              colour-vision deficiencies. (Hue-sorted ordering scored 1.08:1.)
 *  3. CONTRAST the chart theme keeps axis labels at >=3:1 against the canvas
 *              (WCAG non-text minimum) and tooltip text at >=4.5:1 (AA), and
 *              strong correlation cells keep their white text at >=4.5:1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEDGER, SERIES, chartTheme, corrCell } from "./ledger.js";

// ── WCAG relative luminance + contrast ratio ──────────────
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── 1. the mirror ─────────────────────────────────────────
test("every LEDGER value exists verbatim in tailwind.config.js (runtime-only shades exempt)", () => {
  const cfg = readFileSync(new URL("../../tailwind.config.js", import.meta.url), "utf-8");
  const configHexes = new Set([...cfg.matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0].toUpperCase()));
  // Documented runtime-only extensions: never rendered via a Tailwind class.
  const exempt = new Set([LEDGER.stamp.mid, LEDGER.white, "#3E5C76", "#6B4E71"].map(s => s.toUpperCase()));

  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && v.startsWith("#")) {
        if (exempt.has(v.toUpperCase())) continue;
        assert.ok(configHexes.has(v.toUpperCase()),
          `LEDGER.${path}${k} = ${v} is not in tailwind.config.js — the mirror has drifted`);
      } else if (typeof v === "object") walk(v, `${path}${k}.`);
    }
  };
  walk(LEDGER, "");
});

// ── 2. series separation ──────────────────────────────────
test("adjacent SERIES colours stay >=1.4:1 apart in luminance", () => {
  for (let i = 0; i < SERIES.length - 1; i++) {
    const r = ratio(SERIES[i], SERIES[i + 1]);
    assert.ok(r >= 1.4,
      `SERIES[${i}] ${SERIES[i]} vs SERIES[${i + 1}] ${SERIES[i + 1]} = ${r.toFixed(2)}:1 — `
      + "adjacent series must survive greyscale; reorder by luminance, don't just swap hues");
  }
});

test("SERIES has no duplicate colours", () => {
  assert.equal(new Set(SERIES.map(s => s.toUpperCase())).size, SERIES.length);
});

// ── 3. contrast floors ────────────────────────────────────
for (const dark of [false, true]) {
  const mode = dark ? "dark" : "light";
  test(`chartTheme(${mode}): axis >=3:1 on canvas, text >=4.5:1 on surface`, () => {
    const t = chartTheme(dark);
    assert.ok(ratio(t.axis, t.canvas) >= 3,
      `${mode} axis ${t.axis} on canvas ${t.canvas} = ${ratio(t.axis, t.canvas).toFixed(2)}:1`);
    assert.ok(ratio(t.text, t.surface) >= 4.5,
      `${mode} text ${t.text} on surface ${t.surface} = ${ratio(t.text, t.surface).toFixed(2)}:1`);
  });

  test(`corrCell(${mode}): strong cells keep white text at AA`, () => {
    for (const r of [0.8, -0.8]) {
      const { bg, text } = corrCell(r, dark);
      assert.ok(ratio(text, bg) >= 4.5,
        `r=${r} ${mode}: ${text} on ${bg} = ${ratio(text, bg).toFixed(2)}:1`);
    }
  });
}

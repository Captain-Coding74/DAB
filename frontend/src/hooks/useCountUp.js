/**
 * hooks/useCountUp.js — v20.4 motion rule 01 "Readout power-on"
 *
 * Animates the numeric part of a readout value 0 → target (400ms ease-out,
 * caller staggers via `delay`). Non-numeric values ("—", "utf-8") pass
 * through untouched, suffixes ("8 ms") and thousands separators survive.
 * Respects prefers-reduced-motion by jumping straight to the target.
 */
import { useEffect, useState } from "react";

// v21.9: the strings we animate come from toLocaleString() in the browser's
// default locale, so derive THAT locale's separators instead of assuming
// "," groups and "." is the decimal point. Comma-only parsing turned de-DE's
// "1.234" into a target of 1.234 — the readout counted 0 → 1 and snapped.
// (sample six digits: some locales, e.g. es-ES, leave 4-digit numbers ungrouped)
const localeParts = typeof Intl !== "undefined"
  ? new Intl.NumberFormat().formatToParts(123456.7)
  : [];
const GROUP   = localeParts.find(p => p.type === "group")?.value   || ",";
const DECIMAL = localeParts.find(p => p.type === "decimal")?.value || ".";
const escRe   = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMERIC = new RegExp(`^([\\d${escRe(GROUP)}]+(?:${escRe(DECIMAL)}\\d+)?)(.*)$`);

export function useReadoutValue(value, delay = 0) {
  const [display, setDisplay] = useState(() => String(value ?? ""));

  useEffect(() => {
    const raw = String(value ?? "");
    const m = raw.match(NUMERIC);
    const reduced = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!m || reduced) { setDisplay(raw); return; }

    const target = parseFloat(m[1].split(GROUP).join("").replace(DECIMAL, "."));
    const grouped = m[1].includes(GROUP);
    const suffix = m[2];
    if (!Number.isFinite(target)) { setDisplay(raw); return; }

    let raf, start;
    const fmt = (n) => (grouped ? Math.round(n).toLocaleString() : String(Math.round(n))) + suffix;
    const tick = (t) => {
      if (start === undefined) start = t;
      const p = Math.min(1, (t - start) / 400);
      const eased = 1 - Math.pow(1 - p, 3);           // ease-out cubic
      setDisplay(p < 1 ? fmt(target * eased) : raw);   // land on the exact original
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setDisplay(fmt(0));
    const id = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(id); if (raf) cancelAnimationFrame(raf); };
  }, [value, delay]);

  return display;
}

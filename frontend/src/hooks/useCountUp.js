/**
 * hooks/useCountUp.js — v20.4 motion rule 01 "Readout power-on"
 *
 * Animates the numeric part of a readout value 0 → target (400ms ease-out,
 * caller staggers via `delay`). Non-numeric values ("—", "utf-8") pass
 * through untouched, suffixes ("8 ms") and thousands separators survive.
 * Respects prefers-reduced-motion by jumping straight to the target.
 */
import { useEffect, useState } from "react";

const NUMERIC = /^([\d,]+(?:\.\d+)?)(.*)$/;

export function useReadoutValue(value, delay = 0) {
  const [display, setDisplay] = useState(() => String(value ?? ""));

  useEffect(() => {
    const raw = String(value ?? "");
    const m = raw.match(NUMERIC);
    const reduced = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!m || reduced) { setDisplay(raw); return; }

    const target = parseFloat(m[1].replace(/,/g, ""));
    const grouped = m[1].includes(",");
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

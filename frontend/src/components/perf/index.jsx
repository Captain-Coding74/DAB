/**
 * components/perf/index.jsx — v13 dev performance overlay
 *
 * Shows LCP, the analyze span, and live API p50/p95 against their budgets.
 * Numbers you never look at don't change behaviour, so the ones that matter
 * sit in the corner of the screen while you develop.
 *
 * Visible only in dev, or on any build with ?perf=1 — never for real users.
 */
import React, { useEffect, useState } from "react";
import { perfSnapshot } from "../../lib/perf";

const enabled = () => {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("perf")) return true;
    return !!import.meta.env?.DEV;
  } catch { return false; }
};

export default function PerfOverlay() {
  const [snap, setSnap] = useState(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!enabled()) return;
    const tick = () => setSnap(perfSnapshot());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!enabled() || !snap) return null;

  const { lcpMs, spans, budgets, apiStats } = snap;

  /**
   * v19: in `vite dev` the page is assembled from unbundled ES modules that are
   * compiled on demand, so LCP measures Vite's cold start — not the product.
   * It can read 4s on Linux and 25s+ on Windows (Defender scans every module).
   * The production build measures ~100ms.
   *
   * Showing that number next to a 2500ms budget, coloured red, is a lie the
   * tool tells its own developer. So in dev we drop the LCP budget, mark the
   * number as not-representative, and say where the real one comes from.
   */
  const isDev = !!import.meta.env?.DEV;

  const rows = [
    ["LCP",     lcpMs,                                isDev ? null : budgets.lcpMs, "ms"],
    ["analyze", spans.analyze?.ms ?? null,            budgets.analyzeMs,            "ms"],
    ["api p50", apiStats.count ? apiStats.p50 : null, null,                         "ms"],
    ["api p95", apiStats.count ? apiStats.p95 : null, budgets.apiP95Ms,             "ms"],
  ];

  return (
    <div className="fixed bottom-3 left-3 z-[80] font-mono text-[10px] select-none">
      {open ? (
        <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-200 dark:border-gray-800 rounded-lg shadow-paper px-3 py-2 min-w-[190px]">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="uppercase tracking-eyebrow text-gray-500 dark:text-gray-400">
              perf · {isDev ? "dev build" : "prod build"}
            </span>
            <button onClick={() => setOpen(false)} aria-label="ซ่อนแผงวัดประสิทธิภาพ"
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">×</button>
          </div>
          {rows.map(([label, value, budget, unit]) => {
            const over = budget != null && value != null && value > budget;
            return (
              <div key={label} className="flex items-center justify-between gap-4 leading-5">
                <span className="text-gray-500 dark:text-gray-400">{label}</span>
                <span className={over ? "text-rule dark:text-rule-dark font-semibold" : "text-gray-800 dark:text-gray-200"}>
                  {value == null ? "—" : `${value}${unit}`}
                  {budget != null && <span className="text-gray-300 dark:text-gray-600"> /{budget}</span>}
                </span>
              </div>
            );
          })}
          {apiStats.count > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800 text-gray-400 dark:text-gray-500">
              {apiStats.count} calls · {apiStats.errorPct}% err
            </div>
          )}
          {isDev && (
            <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800 text-[10px] leading-snug text-gray-400 dark:text-gray-500 max-w-[190px]">
              LCP here measures Vite compiling modules on demand — not the app.
              For the real number: <b>npm run preview</b> (prod build ≈ 100 ms).
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-800 rounded-lg px-2 py-1 text-gray-500 dark:text-gray-400">
          perf
        </button>
      )}
    </div>
  );
}

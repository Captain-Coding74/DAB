/**
 * lib/perf.js — v13 frontend performance instrumentation
 *
 * Measures what the user actually feels, not what the server reports:
 *   - TTFB / DOMContentLoaded / load  (navigation timing)
 *   - LCP                              (largest contentful paint)
 *   - "analyze" span                   (click → results painted)
 *
 * Everything lands in window.__DAB_PERF__ so it can be read from devtools or
 * a headless run. No third-party analytics, no network calls, ~1 KB.
 */

const store = {
  nav: {},
  lcpMs: null,
  spans: {},          // { analyze: { ms, at } }
  api: [],            // v13: { url, ms, ok } — every request, via lib/api.js
  budgets: { analyzeMs: 4000, lcpMs: 2500, apiP95Ms: 800 },  // targets
};

const MAX_API_SAMPLES = 200;   // ring buffer — bounded memory

if (typeof window !== "undefined") window.__DAB_PERF__ = store;

/** Start a named span (e.g. "analyze"). Returns an end() that records it. */
export function startSpan(name) {
  const t0 = performance.now();
  performance.mark?.(`${name}:start`);
  return function end() {
    const ms = Math.round(performance.now() - t0);
    performance.mark?.(`${name}:end`);
    try { performance.measure?.(name, `${name}:start`, `${name}:end`); } catch {}
    store.spans[name] = { ms, at: new Date().toISOString() };
    const budget = store.budgets[`${name}Ms`];
    if (budget && ms > budget) {
      console.warn(`[perf] ${name} took ${ms}ms — over the ${budget}ms budget`);
    } else {
      console.info(`[perf] ${name}: ${ms}ms`);
    }
    return ms;
  };
}

/** Wire navigation + LCP observers once at startup. */
export function initPerf() {
  if (typeof window === "undefined" || store._init) return;
  store._init = true;

  // Navigation timing — loadEventEnd is only populated AFTER the load event
  // dispatch completes, so inside a load handler it still reads 0. Defer the
  // read one tick; fall back to duration in case the entry is still settling.
  addEventListener("load", () => {
    setTimeout(() => {
      const [nav] = performance.getEntriesByType("navigation");
      if (!nav) return;
      store.nav = {
        ttfbMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd || nav.duration),
      };
    }, 0);
  }, { once: true });

  // LCP — keep the last reported entry, per the spec
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) store.lcpMs = Math.round(last.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch { /* unsupported browser — degrade quietly */ }
}

/**
 * v13: record one API call. Called from lib/api.js, which is the single
 * place every request passes through — so instrumenting it once covers the
 * whole app, including any endpoint added later.
 */
export function recordApi(url, ms, ok = true) {
  store.api.push({ url, ms: Math.round(ms), ok });
  if (store.api.length > MAX_API_SAMPLES) store.api.shift();
}

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  // Nearest-rank: the ceil(n*p/100)-th smallest value. floor() here sat one
  // rank too high whenever n*p/100 was an integer — p95 of 20 samples
  // returned the absolute maximum, so one outlier faked a budget breach.
  return sorted[Math.max(0, Math.ceil((sorted.length * p) / 100) - 1)];
};

/** Aggregate API latency — p95 is the number that reflects a bad experience. */
export function apiStats() {
  const times = store.api.map(a => a.ms);
  const slowest = store.api.slice().sort((a, b) => b.ms - a.ms)[0] || null;
  return {
    count:   times.length,
    p50:     percentile(times, 50),
    p95:     percentile(times, 95),
    slowest,
    errorPct: times.length
      ? +((store.api.filter(a => !a.ok).length / times.length) * 100).toFixed(1)
      : 0,
    overBudget: percentile(times, 95) > store.budgets.apiP95Ms,
  };
}

/** Test seam: clear recorded samples so suites don't leak into each other. */
export function resetPerf() {
  store.api.length = 0;
  store.spans = {};
  store.lcpMs = null;
}

/** Snapshot for display/debugging. */
export const perfSnapshot = () => ({
  ...JSON.parse(JSON.stringify(store)),
  apiStats: apiStats(),
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  // v19: pre-bundle the heavy dependencies up front. Without this, Vite
  // discovers them mid-load and re-optimises, which forces a full page reload
  // half-way through the first render — the single biggest cause of a slow
  // `npm run dev` cold start (worst on Windows, where Defender scans every one
  // of the hundreds of individual module files).
  optimizeDeps: {
    include: [
      "react", "react-dom", "react-router-dom",
      "recharts", "lucide-react", "zustand", "clsx",
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // v9: split heavy vendors into their own cacheable chunks —
        // recharts alone is ~400KB and rarely changes between deploys.
        // react is genuinely eager (every route needs it) → a stable vendor
        // chunk is a caching win.
        //
        // recharts is deliberately NOT listed here. v13 measurement: naming it
        // as a manual chunk pins it into the entry's module graph, so Vite
        // emits a <link rel="modulepreload"> for all 112 kB gzip even though
        // charts only render on two tabs. Leaving it unnamed lets Rollup place
        // it in a chunk reachable only through the dynamic imports of
        // tabs-charts / SharePage — so it downloads on demand.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});

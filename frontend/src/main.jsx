import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
// v17: fonts are self-hosted, not fetched from Google. Reasons, in order:
//  · our CSP can stay locked to 'self' (no third-party style/font origins)
//  · no request leaves the user's browser to a third party (privacy)
//  · the app works on locked-down networks and offline
//  · one fewer render-blocking round-trip to a domain we don't control
// Only the subsets this product actually renders: Thai + Latin. Importing the
// bare weight (e.g. "400.css") pulls in Cyrillic, Vietnamese and Latin-ext too
// — 27 font files and +10 kB gzip of @font-face rules that no user here needs.
import "@fontsource/ibm-plex-sans-thai/thai-400.css";
import "@fontsource/ibm-plex-sans-thai/thai-500.css";
import "@fontsource/ibm-plex-sans-thai/thai-600.css";
import "@fontsource/ibm-plex-sans-thai/thai-700.css";
import "@fontsource/ibm-plex-sans-thai/latin-400.css";
import "@fontsource/ibm-plex-sans-thai/latin-500.css";
import "@fontsource/ibm-plex-sans-thai/latin-600.css";
import "@fontsource/ibm-plex-sans-thai/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./index.css";
import { configureApi } from "./lib/api";
import { initPerf } from "./lib/perf";
import { useAppStore } from "./store";
configureApi(useAppStore);
initPerf();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

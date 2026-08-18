import { create } from "zustand";

// v12: HTTP lives in ../lib/api — re-exported here for back-compat
export { apiFetch } from "../lib/api";

// v21.9: one in-flight refresh shared by every concurrent 401. The server
// rotates + revokes the refresh token per call, so two parallel refreshes
// would race: the second presents an already-revoked token, gets 401, and
// spuriously logs the user out — wiping the freshly rotated tokens.
let refreshInFlight = null;

// ── Store ─────────────────────────────────────────────────
export const useAppStore = create((set, get) => ({
  // Auth
  accessToken:  localStorage.getItem("dab_at")  || null,
  refreshToken: localStorage.getItem("dab_rt")  || null,
  // v21.9: a corrupt dab_user (interrupted write, manual edit) must not throw
  // at module evaluation — that would white-screen the app on every visit.
  user: (() => {
    try { return JSON.parse(localStorage.getItem("dab_user") || "null"); }
    catch { localStorage.removeItem("dab_user"); return null; }
  })(),

  login: ({ accessToken, refreshToken, username }) => {
    localStorage.setItem("dab_at",   accessToken);
    localStorage.setItem("dab_rt",   refreshToken);
    localStorage.setItem("dab_user", JSON.stringify({ username }));
    set({ accessToken, refreshToken, user: { username } });
  },

  logout: () => {
    localStorage.removeItem("dab_at");
    localStorage.removeItem("dab_rt");
    localStorage.removeItem("dab_user");
    // v21.9: currentWorkspace is per-account too — leaving it set pins the
    // next sign-in to the previous user's workspace id (403s everywhere).
    set({ accessToken: null, refreshToken: null, user: null, currentAnalysis: null, currentWorkspace: null });
  },

  refreshTokens: () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      // Read dab_rt at call time: another tab may have rotated the token
      // since this tab's in-memory copy was stored.
      const rt = localStorage.getItem("dab_rt") || get().refreshToken;
      if (!rt) return false;
      try {
        const res  = await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
        const data = await res.json();
        if (res.ok) {
          // v21: the server rotates the refresh token on every refresh and
          // revokes the old one — persist the new one or the NEXT refresh 401s.
          localStorage.setItem("dab_at", data.accessToken);
          const next = { accessToken: data.accessToken };
          if (data.refreshToken) {
            localStorage.setItem("dab_rt", data.refreshToken);
            next.refreshToken = data.refreshToken;
          }
          set(next);
          return true;
        }
      } catch {}
      return false;
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  },

  // Current analysis
  currentAnalysis: null,
  setCurrentAnalysis: (a) => set({ currentAnalysis: a }),

  // Workspace
  currentWorkspace: null,
  setCurrentWorkspace: (w) => set({ currentWorkspace: w }),

  // Theme
  dark: localStorage.getItem("dab_dark") !== "0", // v20.4: console by default
  toggleDark: () => set(s => {
    localStorage.setItem("dab_dark", s.dark ? "0" : "1");
    document.documentElement.classList.toggle("dark", !s.dark);
    return { dark: !s.dark };
  }),

  // Toast — v11: optional action (e.g. undo) + custom duration
  toasts: [],
  toast: (message, type = "success", opts = {}) => {
    const id = Date.now() + Math.random();
    const duration = opts.duration ?? 3500;
    set(s => ({ toasts: [...s.toasts, { id, message, type, action: opts.action || null }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), duration);
    return id;
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  // Command palette (v11)
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),
}));

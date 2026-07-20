import { create } from "zustand";

// v12: HTTP lives in ../lib/api — re-exported here for back-compat
export { apiFetch } from "../lib/api";

// ── Store ─────────────────────────────────────────────────
export const useAppStore = create((set, get) => ({
  // Auth
  accessToken:  localStorage.getItem("dab_at")  || null,
  refreshToken: localStorage.getItem("dab_rt")  || null,
  user:         JSON.parse(localStorage.getItem("dab_user") || "null"),

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
    set({ accessToken: null, refreshToken: null, user: null, currentAnalysis: null });
  },

  refreshTokens: async () => {
    const rt = get().refreshToken;
    if (!rt) return false;
    try {
      const res  = await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("dab_at", data.accessToken);
        set({ accessToken: data.accessToken });
        return true;
      }
    } catch {}
    return false;
  },

  // Current analysis
  currentAnalysis: null,
  setCurrentAnalysis: (a) => set({ currentAnalysis: a }),

  // Workspace
  currentWorkspace: null,
  setCurrentWorkspace: (w) => set({ currentWorkspace: w }),

  // Theme
  dark: localStorage.getItem("dab_dark") === "1",
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

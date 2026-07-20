/**
 * lib/api.js — v12: THE single place HTTP happens.
 * Every request gets auth headers + refresh-on-401 retry.
 *
 * The auth store is injected via configureApi() rather than imported, so
 * this module has no hard dependency on zustand/localStorage and is unit-
 * testable under plain node. The app wires the real store once at startup.
 */
import { recordApi } from "./perf.js";   // explicit .js: this module is unit-tested under plain Node

let store = {
  getState: () => ({ accessToken: null, refreshTokens: async () => false, logout: () => {} }),
};

/** Called once at app startup (main.jsx) with the real zustand store. */
export function configureApi(realStore) { store = realStore; }

export async function apiFetch(url, opts = {}) {
  const token = store.getState().accessToken;
  const t0    = (typeof performance !== "undefined" ? performance : Date).now();

  // v14 FIX (caught by the render gate): never force a JSON Content-Type on
  // a FormData body. The browser must set multipart/form-data with its own
  // boundary; if we send "application/json" the server's json parser chokes
  // on the multipart bytes and every upload 400s. Callers used to pass
  // headers:{} to work around this, but that MERGES — it can't delete our
  // default. So we detect FormData and drop the header at the source.
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const baseHeaders = isForm ? {} : { "Content-Type": "application/json" };

  const res   = await fetch(url, {
    ...opts,
    headers: {
      ...baseHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  // v13: every request is timed here — one wrapper, whole-app coverage.
  recordApi(url, (typeof performance !== "undefined" ? performance : Date).now() - t0, res.ok);

  if (res.status === 401 && token) {
    const refreshed = await store.getState().refreshTokens();
    if (refreshed) {
      const newToken = store.getState().accessToken;
      return fetch(url, {
        ...opts,
        headers: { ...baseHeaders, Authorization: `Bearer ${newToken}`, ...opts.headers },
      });
    }
    store.getState().logout();
    throw new Error("Session expired");
  }
  return res;
}

async function toJSON(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
export const getJSON  = (url, opts)       => apiFetch(url, opts).then(toJSON);
export const postJSON = (url, body, opts) => apiFetch(url, { method: "POST", body: JSON.stringify(body), ...opts }).then(toJSON);
export const delJSON  = (url, opts)       => apiFetch(url, { method: "DELETE", ...opts }).then(toJSON);

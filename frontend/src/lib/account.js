/**
 * lib/account.js — the /account page's actions (v21.30): download everything
 * DAB holds about you, download each original file you saved, and delete the
 * account.
 *
 * Downloads go through apiFetch (bearer token, refresh on 401) and reach the
 * browser as a Blob on a temporary object-URL link. Nothing is written to
 * localStorage or anywhere else on the device but the downloaded file.
 *
 * Plain functions, no React: unit-tested under Node (account.test.js);
 * pages/AccountPage.jsx renders them.
 */
import { apiFetch } from "./api.js";   // explicit .js: this module is unit-tested under plain Node

/** Deletion is confirmed by typing, not clicking: the exact username, and a password. */
export function canDelete({ typed, username, password }) {
  return !!username && typeof typed === "string" && typed.trim() === username
    && typeof password === "string" && password.length > 0;
}

/** The accepted Terms/Privacy version when GET /api/auth/me reports one (`legal_version`); else null. */
export const acceptedLegalVersion = (profile) => profile?.legal_version || null;

/**
 * The file name the server chose (Content-Disposition), else the fallback.
 * filename* first: for a Thai name Express sends an ASCII stand-in in
 * filename="…" and the real name only in filename*=UTF-8''….
 */
export function fileNameFrom(disposition, fallback) {
  const text = disposition || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(text);
  if (encoded) { try { return decodeURIComponent(encoded[1]); } catch { /* fall through to the plain name */ } }
  return /filename="([^"]+)"/i.exec(text)?.[1] || fallback;
}

/**
 * GET a download as a Blob. Resolves { ok: true, blob, fileName } or
 * { ok: false, status, error } — never throws for an HTTP error.
 */
export async function fetchDownload(url, fallbackName, fetcher = apiFetch) {
  const res = await fetcher(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: data.error || `HTTP ${res.status}` };
  }
  const fileName = fileNameFrom(res.headers?.get?.("Content-Disposition"), fallbackName);
  return { ok: true, blob: await res.blob(), fileName };
}

export const exportUrl = "/api/auth/me/export";
export const exportFallbackName = (username, now = new Date()) =>
  `dab-export-${username}-${now.toISOString().slice(0, 10)}.json`;

/** Every saved original file the export lists, as { key, label, url, fileName }. */
export function filesIn(exported) {
  const out = [];
  for (const d of exported?.datasets || []) {
    for (const v of d.versions || []) {
      out.push({ key: v.id, label: `${d.name} · v${v.version_num}`, url: v.download, fileName: v.file_name });
    }
  }
  return out;
}

/** Hand a Blob to the browser as a file download. */
export function saveBlob(blob, fileName, { doc = document, urls = URL, revokeAfterMs = 1000 } = {}) {
  const href = urls.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = href;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later, not at once: some browsers start the download
  // asynchronously and would find the URL already gone.
  setTimeout(() => urls.revokeObjectURL(href), revokeAfterMs);
}

/** DELETE /api/auth/me. Resolves { ok: true } or { ok: false, status, code, error }. */
export async function deleteMyAccount(password, fetcher = apiFetch) {
  const res = await fetcher("/api/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  return { ok: false, status: res.status, code: data.code || null, error: data.error || `HTTP ${res.status}` };
}

/** The i18n key for a failed deletion. */
export function deleteErrorKey(result) {
  if (result?.code === "PASSWORD_REQUIRED") return "account.passwordRequired";
  if (result?.status === 401) return "account.wrongPassword";
  if (result?.status === 429) return "account.tooMany";
  return "account.deleteFailed";
}

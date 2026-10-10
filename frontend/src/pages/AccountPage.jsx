/**
 * AccountPage — /account (v21.30): who you are to DAB, a copy of everything
 * it holds about you, and the way out.
 *
 * "Download my data" fetches GET /api/auth/me/export with the bearer token
 * and hands the JSON to the browser as a file; the saved original files it
 * lists can then be downloaded one by one. "Delete my account" says what
 * goes at once and what is kept, and needs the username typed out AND the
 * password — then the local session is cleared and the user lands on /.
 * The decisions and requests live in lib/account.js (unit-tested).
 */
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, AlertTriangle } from "lucide-react";
import { useAppStore } from "../store";
import { getJSON } from "../lib/api";
import { Card, Button } from "../components/ui";
import { useLang } from "../lib/i18n";
import {
  canDelete, acceptedLegalVersion, fetchDownload, exportUrl, exportFallbackName,
  filesIn, saveBlob, deleteMyAccount, deleteErrorKey,
} from "../lib/account";

const LINK  = "text-sm underline underline-offset-2 text-gray-600 dark:text-gray-300 hover:text-brand-500 transition-colors";
const FIELD = "w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-400 transition";

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-sm text-gray-800 dark:text-gray-200 text-right break-all">{children}</dd>
    </div>
  );
}

function ProfileCard({ username, profile }) {
  const { t } = useLang();
  const legal = acceptedLegalVersion(profile);
  return (
    <Card title={t("account.profile")}>
      <dl>
        <Row label={t("auth.username")}>{username}</Row>
        <Row label={t("account.email")}>{profile ? (profile.email || t("account.noEmail")) : "…"}</Row>
        {legal && <Row label={t("account.legalVersion")}><span className="num">{legal}</span></Row>}
      </dl>
      <nav aria-label={t("account.links")} className="flex flex-wrap gap-x-5 gap-y-1 pt-4">
        <a href="/privacy" className={LINK}>{t("account.privacy")}</a>
        <a href="/terms" className={LINK}>{t("account.terms")}</a>
        <a href="/contact#requests" className={LINK}>{t("account.requests")}</a>
      </nav>
    </Card>
  );
}

function ExportCard({ username }) {
  const { t } = useLang();
  const toast = useAppStore(s => s.toast);
  const [busy, setBusy]   = useState(null);   // the url being fetched
  const [files, setFiles] = useState(null);   // null until the export has been downloaded

  async function download(url, fallback, onBlob) {
    setBusy(url);
    try {
      const r = await fetchDownload(url, fallback);
      if (!r.ok) throw new Error(r.error);
      saveBlob(r.blob, r.fileName);
      await onBlob?.(r.blob);
    } catch {
      toast(t("account.exportFailed"), "error");
    }
    setBusy(null);
  }
  const listFiles = async (blob) => setFiles(filesIn(JSON.parse(await blob.text())));

  return (
    <Card title={t("account.exportTitle")}>
      <p className="text-sm text-gray-700 dark:text-gray-300">{t("account.exportBody")}</p>
      <Button className="mt-4" variant="secondary" loading={busy === exportUrl} disabled={!!busy}
        onClick={() => download(exportUrl, exportFallbackName(username), listFiles)}>
        <Download size={14}/> {t("account.exportButton")}
      </Button>
      {files && (
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="eyebrow mb-1">{t("account.filesTitle")}</p>
          {files.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{t("account.filesNone")}</p> : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("account.filesHint")}</p>
              <ul className="space-y-1.5">
                {files.map(f => (
                  <li key={f.key} className="flex items-center justify-between gap-3 text-sm text-gray-800 dark:text-gray-200">
                    <span className="min-w-0 truncate">{f.label} · <span className="num text-xs">{f.fileName}</span></span>
                    <Button size="sm" variant="ghost" loading={busy === f.url} disabled={!!busy}
                      onClick={() => download(f.url, f.fileName)}>{t("account.download")}</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function DeleteCard({ username, onDeleted }) {
  const { t } = useLang();
  const [typed, setTyped]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const ready = canDelete({ typed, username, password });

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(null);
    let r;
    try { r = await deleteMyAccount(password); } catch { r = { ok: false }; }
    if (r.ok) { onDeleted(); return; }
    setBusy(false);
    setError(t(deleteErrorKey(r)));
  }

  return (
    <section aria-labelledby="delete-title" className="rounded-xl border border-rule-line dark:border-rule/40 bg-rule-soft/40 dark:bg-rule/10 p-5">
      <h2 id="delete-title" className="flex items-center gap-2 text-sm font-semibold text-rule dark:text-rule-dark">
        <AlertTriangle size={15}/> {t("account.deleteTitle")}
      </h2>
      <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
        <p>{t("account.deleteNow")}</p>
        <p>{t("account.deleteWorkspaces")}</p>
        <p>{t("account.deleteKept")}</p>
        <p className="font-medium">{t("account.deleteUndo")}</p>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block space-y-1">
          <span className="eyebrow block">{t("account.typeUsername")} · <span className="num normal-case">{username}</span></span>
          <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={FIELD}/>
        </label>
        <label className="block space-y-1">
          <span className="eyebrow block">{t("auth.password")}</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className={FIELD}/>
        </label>
        {error && <p role="alert" className="text-xs text-rule dark:text-rule-dark">{error}</p>}
        <Button type="submit" variant="danger" loading={busy} disabled={!ready}>{t("account.deleteButton")}</Button>
      </form>
    </section>
  );
}

export default function AccountPage() {
  const { t } = useLang();
  const user   = useAppStore(s => s.user);
  const logout = useAppStore(s => s.logout);
  const toast  = useAppStore(s => s.toast);
  const nav = useNavigate();
  const [profile, setProfile] = useState(null);
  // Set once the account is gone, so the signed-out redirect below does not
  // send the user to /auth instead of home.
  const leaving = useRef(false);

  useEffect(() => { if (!user && !leaving.current) nav("/auth"); }, [user]);
  useEffect(() => { if (user) getJSON("/api/auth/me").then(setProfile).catch(() => {}); }, [user]);

  function onDeleted() {
    leaving.current = true;
    logout();
    toast(t("account.deleted"));
    nav("/", { replace: true });
  }

  if (!user) return null;
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <div>
        <p className="eyebrow mb-1">{t("nav.account")}</p>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("account.title")}</h1>
      </div>
      <ProfileCard username={user.username} profile={profile}/>
      <ExportCard username={user.username}/>
      <DeleteCard username={user.username} onDeleted={onDeleted}/>
    </div>
  );
}

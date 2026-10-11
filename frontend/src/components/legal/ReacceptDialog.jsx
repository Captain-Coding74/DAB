/**
 * ReacceptDialog — "We've updated our Terms and Privacy Notice" (v21.30).
 *
 * Shown by LegalGate to a signed-in user whose accepted version is older
 * than the current one, or who never accepted (accounts from before
 * sign-up asked). It cannot be dismissed: the only ways on are Accept
 * (POST /api/auth/accept-terms with the version shown, which the server
 * records with the time and IP) or Sign out. Modal supplies role="dialog",
 * aria-modal, the focus trap and focus restore; first focus lands on the
 * first link, never on Accept, which stays disabled until the box is ticked.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Button } from "../ui";
import { useAppStore } from "../../store";
import { getJSON, postJSON } from "../../lib/api";
import { useLang } from "../../lib/i18n";
import { fetchLegal } from "../../lib/legal.js";
import { LegalText } from "./LegalText.jsx";

export default function ReacceptDialog({ legal }) {
  const { t } = useLang();
  const setLegal = useAppStore(s => s.setLegal);
  const logout   = useAppStore(s => s.logout);
  const navigate = useNavigate();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  async function accept(e) {
    e.preventDefault();
    if (!agree || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await postJSON("/api/auth/accept-terms", { version: legal.current });
      setLegal(r.legal);   // accepted === current: LegalGate unmounts this dialog
    } catch {
      setError(t("legal.acceptFailed"));
      setBusy(false);
      // A release can bump the version while this dialog is open; the server
      // then refuses the one shown, and retrying it would fail every time.
      // Take the status afresh: LegalGate shows the new version with the box
      // cleared (it keys this dialog by version), or closes if already accepted.
      fetchLegal(getJSON).then((l) => { if (l) setLegal(l); });
    }
  }

  async function signOut() {
    const rt = useAppStore.getState().refreshToken;
    if (rt) { try { await postJSON("/api/auth/logout", { refreshToken: rt }); } catch {} }
    logout();
    navigate("/");
  }

  return (
    <Modal open dismissible={false} title={t("legal.updatedTitle")}>
      <form onSubmit={accept} className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p id="legal-updated-body"><LegalText text={t("legal.updatedBody")}/></p>
        <p className="num text-xs text-gray-500 dark:text-gray-400">{t("legal.version").replace("{version}", legal.current)}</p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" name="acceptTerms" required checked={agree} onChange={(e) => setAgree(e.target.checked)}
            aria-describedby="legal-updated-body" className="mt-0.5 accent-brand-500"/>
          <span><LegalText text={t("legal.agree")}/></span>
        </label>

        {error && <p role="alert" className="text-xs text-rule dark:text-rule-dark">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={signOut} disabled={busy}>{t("nav.signOut")}</Button>
          <Button type="submit" size="sm" loading={busy} disabled={!agree}>{t("legal.accept")}</Button>
        </div>
      </form>
    </Modal>
  );
}

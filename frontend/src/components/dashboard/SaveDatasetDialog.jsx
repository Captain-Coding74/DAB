/**
 * SaveDatasetDialog — the confirmation before the original file is stored
 * (v21.30). Loaded lazily by the dashboard on the first "Save dataset".
 *
 * It says what is kept and for how long, with a link to the retention
 * section of the Privacy Notice. When the result has a class report (School
 * Edition) the file is a class roster, and Save stays disabled until the
 * user confirms the school's authority — the server applies the same test
 * and refuses without it (SCHOOL_AUTHORITY_REQUIRED); if it ever does, the
 * dialog shows the checkbox it was missing rather than a dead end.
 *
 * Modal supplies the dialog semantics (role="dialog", aria-modal, focus
 * trap, Esc to cancel, focus restored on close); first focus lands on the
 * close button, never on Save.
 */
import React, { useState } from "react";
import { Modal, Button } from "../ui";
import { useLang } from "../../lib/i18n";
import "../../lib/strings/save.js";   // v21.30: this dialog's strings load with it (lib/i18n.js addStrings)

const LINK = "inline-block text-xs underline underline-offset-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200";

/* Mounted only while open, so every opening starts unticked — an
   attestation is never carried over from an earlier save. */
export default function SaveDatasetDialog({ roster, onSave, onClose }) {
  const { t, lang } = useLang();
  const [askSchool, setAskSchool] = useState(!!roster);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy || (askSchool && !agree)) return;
    setBusy(true); setError(null);
    const r = await onSave({ schoolAuthority: askSchool && agree });
    setBusy(false);
    if (r?.ok) { onClose(); return; }
    if (r?.code === "SCHOOL_AUTHORITY_REQUIRED") setAskSchool(true);
    setError((lang === "en" && r?.errorEn) || r?.error || t("save.failed"));
  }

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={t("save.title")}>
      <form onSubmit={submit} className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p>{t("save.body")}</p>
        <a href="/privacy#retention" target="_blank" rel="noopener noreferrer" className={LINK}>{t("save.retention")}</a>

        {askSchool && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <p id="save-roster-note" className="text-xs text-pencil dark:text-pencil-dark">{t("save.rosterNote")}</p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)}
                aria-describedby="save-roster-note" className="mt-0.5 accent-brand-500"/>
              <span>{t("save.school")}</span>
            </label>
          </div>
        )}

        {error && <p role="alert" className="text-xs text-rule dark:text-rule-dark">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="submit" size="sm" loading={busy} disabled={askSchool && !agree}>{t("save.confirm")}</Button>
        </div>
      </form>
    </Modal>
  );
}

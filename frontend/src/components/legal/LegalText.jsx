/**
 * Click-wrap text (v21.30), shared by the sign-up form (pages/AuthPage.jsx)
 * and the re-accept dialog (ReacceptDialog.jsx).
 *
 *   LegalText     a translated sentence with the Terms of Service and Privacy
 *                 Notice links in it — each opens in a new tab, so a form in
 *                 progress is not lost, and says so to screen readers
 *   ConsentBoxes  the two sign-up boxes, both unticked, both required
 */
import React from "react";
import { useLang } from "../../lib/i18n";
import "../../lib/strings/auth.js";   // the click-wrap sentences load with the sign-up form and the re-accept dialog
import { fillSlots } from "../../lib/legal.js";

const LINK = "underline underline-offset-2 hover:text-brand-600 dark:hover:text-brand-300";

export function LegalText({ text }) {
  const { t } = useLang();
  const link = (href, label) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {label}<span className="sr-only"> {t("legal.newTab")}</span>
    </a>
  );
  const parts = fillSlots(text, { terms: link("/terms", t("legal.termsName")), privacy: link("/privacy", t("legal.privacyName")) });
  return parts.map((part, i) => <React.Fragment key={i}>{part}</React.Fragment>);
}

/** value: { acceptTerms, ageConfirmed }; onChange gets the next value. */
export function ConsentBoxes({ value, onChange }) {
  const { t } = useLang();
  const box = (name, label) => (
    <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
      <input type="checkbox" name={name} required checked={value[name]}
        onChange={(e) => onChange({ ...value, [name]: e.target.checked })} className="mt-0.5 accent-brand-500"/>
      <span>{label}</span>
    </label>
  );
  return (
    <div className="space-y-2">
      {box("acceptTerms", <LegalText text={t("legal.agree")}/>)}
      {box("ageConfirmed", t("legal.age"))}
    </div>
  );
}

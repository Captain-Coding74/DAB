/**
 * NeedsSavedDataset — what a feature that needs the stored copy of a file
 * (hypothesis tests, data fixes) shows instead of failing (v21.30): why, and
 * the opt-in "Save dataset" action — or, signed out, what signing in offers.
 * Nothing stores the original file unless the user asks; the confirmation
 * is SaveDatasetDialog.jsx, loaded on first use so first paint skips it.
 */
import React from "react";
import { Card, Button } from "../ui";
import { useLang } from "../../lib/i18n";

/** `need` is the i18n key that says why; `save` is { status: saveStatus(...) from lib/saveDataset, onSave }. */
export function NeedsSavedDataset({ need, save = {} }) {
  const { t } = useLang();
  const { status, onSave } = save;
  return (
    <Card>
      <p className="text-sm text-gray-500 dark:text-gray-400 margin-rule">{t(need)}</p>
      {status === "signed-out" && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t("save.signedOut")}</p>}
      {status === "no-file"    && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t("save.noFile")}</p>}
      {status === "ready" && onSave && <Button size="sm" className="mt-3" onClick={onSave}>{t("save.action")}</Button>}
    </Card>
  );
}

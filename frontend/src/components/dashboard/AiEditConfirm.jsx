/**
 * AiEditConfirm — the consent step before AI edit sends rows (v21.30).
 *
 * AI edit is the one feature that sends raw cell values to the AI provider,
 * so nothing goes until the user has seen exactly what will: how many rows,
 * which columns, which detected personal-data columns stay behind, and who
 * receives them. `scope` is GET /api/fixes/:id/ai-edit/scope — computed by
 * the same classification the server uses to build the payload, so the
 * dialog cannot promise something the request does not do. The server also
 * refuses a request without confirmSend (AI_EDIT_CONFIRM_REQUIRED), so an
 * old client cannot skip this step either.
 *
 * Modal supplies the dialog semantics (role="dialog", aria-modal, focus trap,
 * Esc to cancel, focus restored on close); first focus lands on the close
 * button, never on Send.
 */
import React from "react";
import { Modal, Button } from "../ui";
import { useLang } from "../../lib/i18n";

const CHIP = "num text-[11px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700";

export function AiEditConfirm({ scope, onSend, onCancel }) {
  const { t } = useLang();
  if (!scope) return null;
  return (
    <Modal open onClose={onCancel} title={t("aiEdit.confirmTitle")}>
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p>{t("aiEdit.confirmRows").replace("{rows}", scope.rowCount.toLocaleString())}</p>
        <ul className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {scope.sentColumns.map((c) => <li key={c} className={`${CHIP} text-gray-800 dark:text-gray-100`}>{c}</li>)}
        </ul>

        {scope.protectedColumns.length > 0 ? (
          <>
            <p>{t("aiEdit.leftOut")}</p>
            <ul className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {scope.protectedColumns.map((c) => (
                <li key={c.col} className={`${CHIP} text-gray-500 dark:text-gray-400`}>
                  🔒 {c.col}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-pencil dark:text-pencil-dark">{t("aiEdit.noneDetected")}</p>
        )}

        <a href="/privacy#ai" target="_blank" rel="noopener noreferrer"
          className="inline-block text-xs underline underline-offset-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
          {t("ai.howWeUse")}
        </a>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={onSend}>{t("aiEdit.send")}</Button>
        </div>
      </div>
    </Modal>
  );
}

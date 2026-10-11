/**
 * DatasetAiSwitch — the owner's AI switch for a saved dataset (v21.30).
 *
 * Off means nothing from this dataset reaches the AI provider: re-analysis
 * serves statistics only, fix suggestions come from the rule set, and chat,
 * the agent and AI edit refuse (services/aiGate.js). Only the owner may flip
 * it — the server enforces that; for everyone else the switch is shown,
 * disabled, with the reason, so an editor who finds AI unavailable knows why.
 *
 * `onChange(enabled)` lets the dashboard hide the AI features in step with
 * the switch instead of waiting for them to be refused.
 */
import React, { useEffect, useState } from "react";
import { Card } from "../ui";
import { getJSON, postJSON } from "../../lib/api";
import { useLang } from "../../lib/i18n";
import { useAppStore } from "../../store";

export function DatasetAiSwitch({ datasetId, onChange }) {
  const { t } = useLang();
  const toast = useAppStore((s) => s.toast);
  const [state, setState] = useState(null);   // { enabled, owner } once loaded
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    let live = true;
    setState(null);
    if (!datasetId) return undefined;
    getJSON(`/api/datasets/${datasetId}`)
      .then((ds) => {
        if (!live) return;
        const enabled = Number(ds.ai_enabled ?? 1) !== 0;
        setState({ enabled, owner: ds.myRole === "owner" });
        onChange?.(enabled);
      })
      .catch(() => { /* no switch is better than a wrong one */ });
    return () => { live = false; };
    // onChange is a parent callback; re-reading the dataset on its identity would loop
  }, [datasetId]);

  if (!datasetId || !state) return null;

  async function toggle() {
    const next = !state.enabled;
    setBusy(true);
    try {
      await postJSON(`/api/datasets/${datasetId}/ai`, { aiEnabled: next }, { method: "PATCH" });
      setState((s) => ({ ...s, enabled: next }));
      onChange?.(next);
    } catch (e) { toast(e.message || t("common.error"), "error"); }
    finally { setBusy(false); }
  }

  const id = `ai-switch-${datasetId}`;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-label`} className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("ai.switchTitle")}</span>
        <button type="button" role="switch" aria-checked={state.enabled}
          aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`}
          disabled={!state.owner || busy} onClick={toggle}
          className={`inline-flex items-center gap-2 font-mono text-[11px] px-2.5 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed ${state.enabled
            ? "border-brand-500 bg-brand-500 text-white"
            : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"}`}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${state.enabled ? "bg-white" : "bg-gray-400"}`}/>
          {state.enabled ? t("ai.on") : t("ai.off")}
        </button>
      </div>
      <p id={`${id}-help`} className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
        {t("ai.switchHelp")}
        {!state.owner && <> {t("ai.switchOwnerOnly")}</>}
      </p>
    </Card>
  );
}

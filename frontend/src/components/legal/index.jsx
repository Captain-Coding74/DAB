/**
 * LegalGate — click-wrap after sign-in (v21.30). Mounted once in the app
 * shell: when the signed-in user's accepted Terms/Privacy version is not the
 * current one (or was never given), it blocks the app with ReacceptDialog.
 *
 * Only this gate ships in the first paint. The dialog, and the sign-up boxes
 * in LegalText.jsx, load with the pages that need them — almost every visit
 * never does. The decisions live in lib/legal.js, unit-tested under Node.
 */
import React, { useEffect, useState, Suspense, lazy } from "react";
import { useLocation } from "react-router-dom";
import { useAppStore } from "../../store";
import { getJSON } from "../../lib/api";
import { gateShown, fetchLegal, legalRetryMs } from "../../lib/legal.js";

const ReacceptDialog = lazy(() => import("./ReacceptDialog"));

export default function LegalGate() {
  const user     = useAppStore(s => s.user);
  const legal    = useAppStore(s => s.legal);
  const setLegal = useAppStore(s => s.setLegal);

  // A session restored from storage has no legal status yet: ask. v21.30: a
  // failed fetch (an offline blip) asks again with backoff — it used to ask
  // once, and one lost request left the gate down for the whole session.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!user || legal) return undefined;
    let live = true, timer;
    fetchLegal(getJSON).then((l) => {
      if (!live) return;
      if (l) setLegal(l);
      else timer = setTimeout(() => setAttempt((n) => n + 1), legalRetryMs(attempt));
    });
    return () => { live = false; clearTimeout(timer); };
  }, [user, legal, setLegal, attempt]);

  const { pathname } = useLocation();
  if (!gateShown({ user, legal }, pathname)) return null;   // never on /account (lib/legal.js)
  // Keyed by version: a newer text arriving while the dialog is open starts
  // it afresh, so a tick given for the old text never carries over.
  return <Suspense fallback={null}><ReacceptDialog key={legal.current} legal={legal}/></Suspense>;
}

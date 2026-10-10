/**
 * LegalGate — click-wrap after sign-in (v21.30). Mounted once in the app
 * shell: when the signed-in user's accepted Terms/Privacy version is not the
 * current one (or was never given), it blocks the app with ReacceptDialog.
 *
 * Only this gate ships in the first paint. The dialog, and the sign-up boxes
 * in LegalText.jsx, load with the pages that need them — almost every visit
 * never does. The decisions live in lib/legal.js, unit-tested under Node.
 */
import React, { useEffect, Suspense, lazy } from "react";
import { useAppStore } from "../../store";
import { getJSON } from "../../lib/api";
import { needsAcceptance } from "../../lib/legal.js";

const ReacceptDialog = lazy(() => import("./ReacceptDialog"));

export default function LegalGate() {
  const user     = useAppStore(s => s.user);
  const legal    = useAppStore(s => s.legal);
  const setLegal = useAppStore(s => s.setLegal);

  // A session restored from storage has no legal status yet: ask once.
  useEffect(() => {
    if (!user || legal) return undefined;
    let live = true;
    getJSON("/api/auth/me").then((p) => { if (live && p?.legal) setLegal(p.legal); }).catch(() => {});
    return () => { live = false; };
  }, [user, legal, setLegal]);

  if (!user || !needsAcceptance(legal)) return null;
  return <Suspense fallback={null}><ReacceptDialog legal={legal}/></Suspense>;
}

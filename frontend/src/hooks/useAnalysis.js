/**
 * hooks/useAnalysis.js — v12
 * All dashboard business logic (upload validation, analyze, export, share)
 * lives here as a reusable hook, so the Dashboard component is presentation.
 * Uses the centralized api layer; multipart calls pass headers:{} so the
 * browser sets its own multipart boundary.
 */
import { useState, useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { apiFetch, getJSON, postJSON } from "../lib/api";
import { startSpan } from "../lib/perf";
import { saveDataset } from "../lib/saveDataset";
import { t } from "../lib/i18n";

const FILE_RE = /\.(csv|xlsx|xls)$/i;

/**
 * A download is only saved if the bytes really are the file we asked for.
 *
 * The server sets the right Content-Type, but nothing between it and the
 * browser is obliged to: a proxy, CDN or static host that answers /api/* with
 * its own page — an SPA index.html, a login redirect, an XML error such as
 * Azure's `<Error><Code>BlobNotFound</Code>` — can return 200 with a body that
 * is not a spreadsheet. That body used to be written straight to disk as
 * report.xlsx, and the user only found out when Excel refused to open it, with
 * nothing on screen suggesting the export had failed. xlsx is a ZIP container
 * (PK\x03\x04) and PDF starts with %PDF, so the first four bytes settle it —
 * the same magic-byte check routes/datasets.js already applies to uploads.
 */
const MAGIC = {
  pdf:   { bytes: [0x25, 0x50, 0x44, 0x46], label: "PDF" },            // %PDF
  excel: { bytes: [0x50, 0x4b, 0x03, 0x04], label: "Excel (xlsx)" },   // PK\x03\x04
};
async function assertRealFile(blob, format) {
  const spec = MAGIC[format];
  if (!spec) return;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (head.length === 4 && spec.bytes.every((b, i) => head[i] === b)) return;
  throw new Error(
    `เซิร์ฟเวอร์ไม่ได้ส่งไฟล์ ${spec.label} กลับมา — ไฟล์จึงเปิดไม่ได้ ` +
    `(ตรวจสอบว่า /api ถูกส่งต่อไปยัง backend จริง)`
  );
}

/**
 * A message worth showing a user.
 *
 * These handlers printed err.message straight into a toast. For a server error
 * that is a translated Thai string, but a dropped connection produces the
 * browser's own "Failed to fetch" / "NetworkError when attempting to fetch
 * resource" — English, technical, and exactly what a judge would see if the
 * wifi hiccups mid-demo. Network faults get a Thai message; everything else is
 * passed through unchanged, since the server already speaks Thai.
 */
function friendlyError(err) {
  const m = String(err?.message || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  }
  return m || "เกิดข้อผิดพลาด";
}

export function useAnalysis() {
  const toast              = useAppStore(s => s.toast);
  const currentAnalysis    = useAppStore(s => s.currentAnalysis);
  const setCurrentAnalysis = useAppStore(s => s.setCurrentAnalysis);
  const [file,      setFile]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [exporting, setExporting] = useState(null);

  // v21.9: two guards. inFlightRef is a synchronous re-entry lock — the
  // palette and Ctrl+Enter bypass the disabled button, and each duplicate
  // call re-uploads the file for a paid AI run. runRef is a generation
  // counter — a slow response from a previous run (or previous file) must
  // never clobber newer state, or Export pairs file B with analysis A.
  const inFlightRef = useRef(false);
  const runRef      = useRef(0);

  const selectFile = useCallback((f) => {
    if (!f || !FILE_RE.test(f.name)) { toast("กรุณาเลือก .csv, .xlsx หรือ .xls", "error"); return false; }
    runRef.current++;   // invalidate any in-flight run for the previous file
    setFile(f); setCurrentAnalysis(null);
    return true;
  }, [toast, setCurrentAnalysis]);

  /* v21.30: `noAi` is the per-upload "Statistics only" choice. Sent as a
     form field; the server skips the AI call and marks the saved analysis so
     chat and the agent refuse it. Kept on the in-memory analysis (never in
     storage) so a re-analysis of the saved copy honours it too. */
  const analyze = useCallback(async (question, { noAi = false } = {}) => {
    if (!file || inFlightRef.current) return;
    inFlightRef.current = true;
    const runId = ++runRef.current;
    // A result on screen is always this file's (selectFile clears it), so a
    // dataset it was saved as stays linked — offering Save again would store
    // a duplicate copy of the same file.
    const savedAs = useAppStore.getState().currentAnalysis?.datasetId ?? null;
    setLoading(true);
    const endSpan = startSpan("analyze");   // v13: measure what the USER waits for
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("question", question);
    if (noAi) fd.append("noAi", "1");
    try {
      const res  = await apiFetch("/api/analyze", { method: "POST", headers: {}, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const perceivedMs = endSpan();
      if (runId !== runRef.current) return;   // superseded — a newer file/run owns the state now
      /* v21.30: analyze stores the analysis record and nothing else. This
         used to POST the same File to /api/datasets straight after, for
         every signed-in user, so the hypothesis tests had a stored copy —
         keeping the original file indefinitely without asking. Storing it is
         now the user's explicit "Save dataset" (saveCurrentDataset below). */
      setCurrentAnalysis({ ...data, datasetId: data.datasetId ?? savedAs, fileName: file.name, perceivedMs, noAi });
      toast("วิเคราะห์เสร็จแล้ว! ✓");
      return data;
    } catch (err) { endSpan(); if (runId === runRef.current) toast(friendlyError(err), "error"); }
    finally { inFlightRef.current = false; setLoading(false); }
  }, [file, toast, setCurrentAnalysis]);

  // v20.1: the demo path — no file, no AI, no auth. The server returns the
  // same analysisResponse shape with analysis:null, so every tab downstream
  // renders with zero special plumbing.
  const runDemo = useCallback(async (id, displayName) => {
    if (inFlightRef.current) return;   // same re-entry + stale-response guards as analyze
    inFlightRef.current = true;
    const runId = ++runRef.current;
    setLoading(true);
    setFile(null);
    setCurrentAnalysis(null);
    const endSpan = startSpan("demo");
    try {
      const data = await getJSON(`/api/demo/samples/${id}/analysis`);
      const perceivedMs = endSpan();
      if (runId !== runRef.current) return;
      setCurrentAnalysis({ ...data, fileName: displayName || id, perceivedMs });
      toast(`ตรวจเสร็จใน ${data.durationMs} ms — สถิติล้วน ไม่ใช้ AI ⚡`);
      return data;
    } catch (err) { endSpan(); if (runId === runRef.current) toast(friendlyError(err), "error"); }
    finally { inFlightRef.current = false; setLoading(false); }
  }, [toast, setCurrentAnalysis]);

  /* Re-analyze the STORED dataset (its CURRENT version — i.e. the fix that
     was just applied). Clicking "วิเคราะห์ไฟล์" re-uploads the browser's
     original File object, so an applied fix was never visible: the analysis
     always showed the pre-fix bytes. This runs the no-upload server path. */
  const analyzeStored = useCallback(async (datasetId, question) => {
    if (!datasetId || inFlightRef.current) return;
    inFlightRef.current = true;
    const runId = ++runRef.current;
    setLoading(true);
    const endSpan = startSpan("analyze");
    try {
      const noAi = !!currentAnalysis?.noAi;   // a stats-only upload stays stats-only after a fix
      const data = await postJSON(`/api/datasets/${datasetId}/analyze`, { question: question || "", noAi });
      const perceivedMs = endSpan();
      if (runId !== runRef.current) return;
      setCurrentAnalysis({ ...data, datasetId, fileName: currentAnalysis?.fileName, perceivedMs, noAi });
      toast("วิเคราะห์เวอร์ชันล่าสุดแล้ว ✓");
      return data;
    } catch (err) { endSpan(); if (runId === runRef.current) toast(friendlyError(err), "error"); }
    finally { inFlightRef.current = false; setLoading(false); }
  }, [toast, setCurrentAnalysis, currentAnalysis]);

  /* v21.30: "Save dataset" — the only path that stores the original file,
     reached through components/dashboard/SaveDatasetDialog.jsx.
     Resolves the server's answer so the dialog can react to its code. The
     dataset id joins the result on screen only if the user has not moved on
     to another file meanwhile (same generation guard as analyze). */
  const saveCurrentDataset = useCallback(async ({ schoolAuthority = false } = {}) => {
    if (!file) return { ok: false };
    const runId = runRef.current;
    try {
      const r = await saveDataset(file, { schoolAuthority });
      const cur = useAppStore.getState().currentAnalysis;
      if (r.ok && cur && runId === runRef.current) {
        setCurrentAnalysis({ ...cur, datasetId: r.id });
        toast(t("save.done"));
      }
      return r;
    } catch (err) { return { ok: false, error: friendlyError(err) }; }
  }, [file, toast, setCurrentAnalysis]);

  const exportReport = useCallback(async (format, question) => {
    if (!file) return;
    setExporting(format);
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("analysis", currentAnalysis?.analysis || "");
    fd.append("prompt", question || "");
    try {
      const res  = await apiFetch(`/api/export/${format}`, { method: "POST", headers: {}, body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "export failed");
      const blob = await res.blob();
      await assertRealFile(blob, format);   // never save an error page as report.xlsx
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `report.${format === "pdf" ? "pdf" : "xlsx"}`; a.click();
      URL.revokeObjectURL(url);
      toast(`${format.toUpperCase()} ดาวน์โหลดแล้ว!`);
    } catch (err) { toast(friendlyError(err), "error"); }
    finally { setExporting(null); }
  }, [file, currentAnalysis, toast]);

  /* v21.30: called by ShareDialog (dashboard/tabs.jsx) only. The one-click
     version sent { title: file.name } with no expiry, so every link was
     public forever under the uploaded file's name. The dialog supplies a
     generic title, a required expiry and an optional password. Returns
     { url, copied } so the dialog can show the link when the clipboard is
     unavailable (plain-http origin, permission denied) instead of claiming
     it was copied. */
  const shareReport = useCallback(async ({ title, password, expiresInDays }) => {
    if (!currentAnalysis?.savedId) { toast("กรุณา login ก่อน share", "error"); return null; }
    try {
      const data = await postJSON(`/api/analyses/${currentAnalysis.savedId}/share`,
        { title, password: password || undefined, expiresInDays });
      let copied = false;
      try { await navigator.clipboard.writeText(data.shareUrl); copied = true; } catch { /* shown in the dialog */ }
      return { url: data.shareUrl, copied };
    } catch (err) { toast(friendlyError(err), "error"); return null; }
  }, [currentAnalysis, toast]);

  return { file, loading, exporting, analysis: currentAnalysis, selectFile, analyze, analyzeStored, runDemo, saveCurrentDataset, exportReport, shareReport };
}

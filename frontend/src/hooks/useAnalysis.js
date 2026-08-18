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

const FILE_RE = /\.(csv|xlsx|xls)$/i;

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

  const analyze = useCallback(async (question) => {
    if (!file || inFlightRef.current) return;
    inFlightRef.current = true;
    const runId = ++runRef.current;
    setLoading(true);
    const endSpan = startSpan("analyze");   // v13: measure what the USER waits for
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("question", question);
    try {
      const res  = await apiFetch("/api/analyze", { method: "POST", headers: {}, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const perceivedMs = endSpan();
      if (runId !== runRef.current) return;   // superseded — a newer file/run owns the state now
      setCurrentAnalysis({ ...data, fileName: file.name, perceivedMs });
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
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `report.${format === "pdf" ? "pdf" : "xlsx"}`; a.click();
      URL.revokeObjectURL(url);
      toast(`${format.toUpperCase()} ดาวน์โหลดแล้ว!`);
    } catch (err) { toast(friendlyError(err), "error"); }
    finally { setExporting(null); }
  }, [file, currentAnalysis, toast]);

  const shareReport = useCallback(async () => {
    if (!currentAnalysis?.savedId) { toast("กรุณา login ก่อน share", "error"); return; }
    try {
      const data = await postJSON(`/api/analyses/${currentAnalysis.savedId}/share`, { title: file?.name });
      await navigator.clipboard.writeText(data.shareUrl);
      toast("Copy link แล้ว! 🔗");
    } catch (err) { toast(friendlyError(err), "error"); }
  }, [currentAnalysis, file, toast]);

  return { file, loading, exporting, analysis: currentAnalysis, selectFile, analyze, runDemo, exportReport, shareReport };
}

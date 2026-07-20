/**
 * hooks/useAnalysis.js — v12
 * All dashboard business logic (upload validation, analyze, export, share)
 * lives here as a reusable hook, so the Dashboard component is presentation.
 * Uses the centralized api layer; multipart calls pass headers:{} so the
 * browser sets its own multipart boundary.
 */
import { useState, useCallback } from "react";
import { useAppStore } from "../store";
import { apiFetch, postJSON } from "../lib/api";
import { startSpan } from "../lib/perf";

const FILE_RE = /\.(csv|xlsx|xls)$/i;

export function useAnalysis() {
  const toast              = useAppStore(s => s.toast);
  const currentAnalysis    = useAppStore(s => s.currentAnalysis);
  const setCurrentAnalysis = useAppStore(s => s.setCurrentAnalysis);
  const [file,      setFile]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [exporting, setExporting] = useState(null);

  const selectFile = useCallback((f) => {
    if (!f || !FILE_RE.test(f.name)) { toast("กรุณาเลือก .csv หรือ .xlsx", "error"); return false; }
    setFile(f); setCurrentAnalysis(null);
    return true;
  }, [toast, setCurrentAnalysis]);

  const analyze = useCallback(async (question) => {
    if (!file) return;
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
      setCurrentAnalysis({ ...data, fileName: file.name, perceivedMs });
      toast("วิเคราะห์เสร็จแล้ว! ✓");
      return data;
    } catch (err) { endSpan(); toast(err.message, "error"); }
    finally { setLoading(false); }
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
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `report.${format === "pdf" ? "pdf" : "xlsx"}`; a.click();
      URL.revokeObjectURL(url);
      toast(`${format.toUpperCase()} ดาวน์โหลดแล้ว!`);
    } catch (err) { toast(err.message, "error"); }
    finally { setExporting(null); }
  }, [file, currentAnalysis, toast]);

  const shareReport = useCallback(async () => {
    if (!currentAnalysis?.savedId) { toast("กรุณา login ก่อน share", "error"); return; }
    try {
      const data = await postJSON(`/api/analyses/${currentAnalysis.savedId}/share`, { title: file?.name });
      await navigator.clipboard.writeText(data.shareUrl);
      toast("Copy link แล้ว! 🔗");
    } catch (err) { toast(err.message, "error"); }
  }, [currentAnalysis, file, toast]);

  return { file, loading, exporting, analysis: currentAnalysis, selectFile, analyze, exportReport, shareReport };
}

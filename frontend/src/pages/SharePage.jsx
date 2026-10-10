import React, { useState, useEffect } from "react";
import { LEDGER } from "../lib/ledger";
import { apiFetch } from "../lib/api";
import { useParams } from "react-router-dom";
import { AutoChart } from "../components/charts";
import { ColumnStatsPanel } from "../components/ColumnStats";
import { Spinner, Input, Button, AiLabel } from "../components/ui";
import { Lock, SearchX } from "lucide-react";
import { useLang } from "../lib/i18n";

/* v21.30: a share link is a bearer URL, not a public document. The server
   sends X-Robots-Tag on the page and the API; this tag covers a crawler that
   renders the page without honouring the header. Removed on unmount so the
   rest of the SPA stays indexable. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

const LINK = "underline underline-offset-2 hover:text-brand-600 dark:hover:text-brand-300";

export default function SharePage() {
  useNoIndex();
  const { t, lang } = useLang();
  const { token }   = useParams();
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [needsPass, setNeedsPass] = useState(false);
  const [password,  setPassword]  = useState("");
  const [error,     setError]     = useState("");

  const fetchReport = async (pass = "") => {
    setLoading(true); setError("");
    try {
      // v9: password travels in a header, not the query string — query-string
      // passwords leak into server logs, proxies, and browser history.
      const res = await apiFetch(`/api/public/share/${token}`, {
        headers: pass ? { "X-Share-Password": pass } : {},
      });
      const d   = await res.json();
      if (res.status === 401 && d.passwordProtected) {
        setNeedsPass(true);
        // A 401 after submitting a password means the guess was wrong — the
        // first load (no password yet) shows the form without an error.
        if (pass) setError("รหัสผ่านไม่ถูกต้อง · Wrong password");
        setLoading(false);
        return;
      }
      if (!res.ok) { setError(d.error || "ไม่พบรายงาน"); setLoading(false); return; }
      setData(d);
      setNeedsPass(false); // unlocked — leave the password form
    } catch { setError("โหลดรายงานไม่สำเร็จ"); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [token]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center"><Spinner size={32}/><p className="text-sm text-gray-400 mt-3">กำลังโหลดรายงาน…</p></div>
    </div>
  );

  if (needsPass) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 w-full max-w-sm text-center">
        <Lock size={28} className="mx-auto mb-3 text-gray-400" aria-hidden="true"/>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">รายงานนี้ถูกล็อกด้วยรหัสผ่าน</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">ใส่รหัสผ่านที่ได้รับจากผู้แชร์เพื่อเปิดรายงาน</p>
        <Input label="รหัสผ่าน" name="share-password" autoComplete="off" placeholder="••••••••" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key==="Enter" && fetchReport(password)} className="mb-3"/>
        {error && <p className="text-xs text-rule dark:text-rule-dark mb-3">{error}</p>}
        <Button className="w-full" onClick={() => fetchReport(password)}>ปลดล็อก</Button>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center"><SearchX size={32} className="mx-auto mb-3 text-gray-400" aria-hidden="true"/><p className="text-gray-600 dark:text-gray-400">{error}</p></div>
    </div>
  );

  if (!data) return null;

  // Custom branding from workspace
  const brandColor = data.brand_color || LEDGER.stamp.DEFAULT;
  const brandName  = data.brand_name  || "Data Analysis Bot";
  const statsJson  = data.stats_json  || {};
  const colAnalysis = statsJson.colAnalysis || [];
  const expiresOn   = data.expires_at
    ? new Date(data.expires_at).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Report cover — ruled, with the workspace's brand as the accent bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="h-1.5" style={{ background: brandColor }}/>
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {data.brand_logo && <img src={data.brand_logo} alt="logo" className="h-7 mb-2 object-contain"/>}
            <p className="eyebrow mb-1">Shared report · {brandName}</p>
            {/* v21.30: never the file name — the API no longer sends it */}
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">{data.title || t("share.defaultTitle")}</h1>
          </div>
          <div className="text-right shrink-0">
            <p className="num text-xs text-gray-500 dark:text-gray-400">{data.total_rows?.toLocaleString()} rows · {data.view_count} views</p>
            <p className="num text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{new Date(data.created_at).toLocaleDateString("th-TH")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Analysis — a statistics-only report has no AI text, and no label */}
        {data.analysis && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <h2 className="eyebrow mb-4">รายงานผู้ตรวจ · AI</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.analysis}</p>
            <AiLabel className="mt-3"/>
          </div>
        )}

        {/* Charts */}
        {colAnalysis.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <h2 className="eyebrow mb-4">แผนภูมิ · Chart</h2>
            <AutoChart colAnalysis={colAnalysis} sampleRows={[]} config={data.chart_config}/>
          </div>
        )}

        {/* Column stats */}
        {colAnalysis.length > 0 && <ColumnStatsPanel colAnalysis={colAnalysis} shared/>}

        <footer className="text-center text-xs text-gray-400 dark:text-gray-500 space-y-1.5">
          {expiresOn && <p>{t("share.expiresOn")} {expiresOn}</p>}
          <p>Shared report · Powered by {brandName}</p>
          {/* Plain <a>: these are server pages, not routes inside the SPA. */}
          <p className="flex justify-center gap-4 flex-wrap">
            <a href="/contact#report" className={LINK}>{t("share.reportPage")}</a>
            <a href="/privacy" className={LINK}>{t("legal.privacy")}</a>
            <a href="/terms" className={LINK}>{t("legal.terms")}</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

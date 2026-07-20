import React, { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import { useParams } from "react-router-dom";
import { AutoChart } from "../components/charts";
import { QualityRing, Spinner, Input, Button } from "../components/ui";

export default function SharePage() {
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
      if (res.status === 401 && d.passwordProtected) { setNeedsPass(true); setLoading(false); return; }
      if (!res.ok) { setError(d.error || "Report not found"); setLoading(false); return; }
      setData(d);
    } catch { setError("Failed to load report"); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [token]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center"><Spinner size={32}/><p className="text-sm text-gray-400 mt-3">Loading report...</p></div>
    </div>
  );

  if (needsPass) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 w-full max-w-sm text-center">
        <div className="text-3xl mb-3">🔒</div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">Password Required</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Report นี้ต้องใส่ password</p>
        <Input placeholder="Password..." type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key==="Enter" && fetchReport(password)} className="mb-3"/>
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <Button className="w-full" onClick={() => fetchReport(password)}>Unlock</Button>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center"><div className="text-4xl mb-3">😕</div><p className="text-gray-600 dark:text-gray-400">{error}</p></div>
    </div>
  );

  if (!data) return null;

  // Custom branding from workspace
  const brandColor = data.brand_color || "#2F6B4F";
  const brandName  = data.brand_name  || "Data Analysis Bot";
  const statsJson  = data.stats_json  || {};
  const colAnalysis = statsJson.colAnalysis || [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Report cover — ruled, with the workspace's brand as the accent bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="h-1.5" style={{ background: brandColor }}/>
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {data.brand_logo && <img src={data.brand_logo} alt="logo" className="h-7 mb-2 object-contain"/>}
            <p className="eyebrow mb-1">Shared report · {brandName}</p>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">{data.title || data.file_name}</h1>
          </div>
          <div className="text-right shrink-0">
            <p className="num text-xs text-gray-500 dark:text-gray-400">{data.total_rows?.toLocaleString()} rows · {data.view_count} views</p>
            <p className="num text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{new Date(data.created_at).toLocaleDateString("th-TH")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Analysis */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
          <h2 className="eyebrow mb-4">รายงานผู้ตรวจ · AI</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{data.analysis}</p>
        </div>

        {/* Charts */}
        {colAnalysis.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <h2 className="eyebrow mb-4">แผนภูมิ · Chart</h2>
            <AutoChart colAnalysis={colAnalysis} sampleRows={[]} config={data.chart_config}/>
          </div>
        )}

        {/* Column stats */}
        {colAnalysis.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">📐 Column Statistics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {colAnalysis.map((c, i) => (
                <div key={i} className="p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">{c.col}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.type==="numeric"?"bg-blue-50 dark:bg-blue-900/30 text-blue-600":"bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700"}`}>{c.type}</span>
                  </div>
                  {c.type === "numeric" ? (
                    <div className="grid grid-cols-3 gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>Min: <b className="text-gray-700 dark:text-gray-300">{c.min}</b></span>
                      <span>Max: <b className="text-gray-700 dark:text-gray-300">{c.max}</b></span>
                      <span>Avg: <b className="text-gray-700 dark:text-gray-300">{c.avg?.toFixed(1)}</b></span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{c.unique} unique values</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          Shared report · Powered by {brandName}
        </p>
      </div>
    </div>
  );
}

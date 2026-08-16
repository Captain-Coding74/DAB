/**
 * components/dashboard/index.jsx — v12
 * Thin shell: wiring, layout, and tab switching only. All business logic
 * lives in useAnalysis(); all panels live in tabs.jsx / AgentPanel.jsx.
 * Went from ~410 lines of mixed concerns to a readable orchestrator.
 */
import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Upload, MessageSquare } from "lucide-react";
import { useAppStore } from "../../store";
import { getJSON } from "../../lib/api";
import { useAnalysis } from "../../hooks/useAnalysis";
import { Button, Card, Readout, Skeleton, Kbd } from "../ui";
import Tour, { tourDone } from "../tour";
import { makeSampleFile } from "../../lib/sampleData";
import { ChatPanel } from "../chat";
import { AgentPanel } from "./AgentPanel";
import { AnalysisTab, InsightsTab, QualityTab, ForecastTab } from "./tabs";
import { ColumnStatsPanel } from "../ColumnStats";

/* Mirrors MAX_UPLOAD_MB in backend/src/config.js. One constant here so the
   UI cannot advertise a limit the server would reject; /api/health also
   publishes the live value if this ever needs to be read at runtime. */
const MAX_UPLOAD_MB = 25;

// v13: recharts (112 kB gzip) loads only when a chart tab is opened.
const ChartsTab      = lazy(() => import("./tabs-charts").then(m => ({ default: m.ChartsTab })));
const CorrelationTab = lazy(() => import("./tabs-charts").then(m => ({ default: m.CorrelationTab })));
const InferencePanel  = lazy(() => import("../inference").then(m => ({ default: m.InferencePanel })));

const ChartFallback = () => (
  <Card><div className="space-y-3" aria-busy="true">
    <Skeleton className="h-3 w-32"/><Skeleton className="h-[220px] w-full"/>
  </div></Card>
);

const QUICK_PROMPTS = [
  { label: "ภาพรวม",    prompt: "สรุปภาพรวมข้อมูลทั้งหมด" },
  { label: "Trend",     prompt: "วิเคราะห์ trend และ pattern ที่น่าสนใจ" },
  { label: "Business",  prompt: "แนะนำ insight สำหรับตัดสินใจทางธุรกิจ" },
  { label: "Anomaly",   prompt: "วิเคราะห์ความผิดปกติและ outliers" },
  { label: "Forecast",  prompt: "พยากรณ์ค่าใน 3 ช่วงถัดไป" },
  { label: "Executive", prompt: "สรุป executive summary 5 ประเด็นสำคัญ" },
];

const TABS = ["analysis", "insights", "charts", "quality", "correlation", "สถิติ", "forecast", "deep dive"];

export default function Dashboard() {
  const accessToken = useAppStore(s => s.accessToken);
  const { file, loading, exporting, analysis: a, selectFile, analyze, runDemo, exportReport, shareReport } = useAnalysis();

  // v20.1: first-10-seconds demo — sample catalogue for the empty state.
  const [samples, setSamples] = useState(null);
  useEffect(() => {
    getJSON("/api/demo/samples").then(d => setSamples(d.samples)).catch(() => setSamples([]));
  }, []);
  const runDemoCard = async (s) => {
    const d = await runDemo(s.id, `${s.title} (ตัวอย่าง)`);
    if (d) setActiveTab("insights");   // the wow tab — AI text is null on the demo path
  };

  const [dragging,  setDragging]  = useState(false);
  const [prompt,    setPrompt]    = useState(QUICK_PROMPTS[0].prompt);
  const [customPmt, setCustomPmt] = useState("");
  const [showChat,  setShowChat]  = useState(false);
  const [activeTab, setActiveTab] = useState("analysis");
  const [tourOpen,  setTourOpen]  = useState(false);

  const question = customPmt.trim() || prompt;

  // Command palette / shortcuts talk to the page over a tiny event bus.
  // Ref keeps the latest handlers without re-binding the listener each render.
  const busRef = useRef({});
  useEffect(() => { busRef.current = { analyze, exportReport, selectFile }; });
  useEffect(() => {
    const onAction = (e) => {
      const f = busRef.current;
      if (e.detail === "upload")       document.getElementById("fileIn")?.click();
      if (e.detail === "analyze")      f.analyze?.(question);
      if (e.detail === "sample")       f.selectFile?.(makeSampleFile());
      if (e.detail === "export-pdf")   f.exportReport?.("pdf", question);
      if (e.detail === "export-excel") f.exportReport?.("excel", question);
      if (e.detail === "tour")         setTourOpen(true);
    };
    window.addEventListener("dab:action", onAction);
    if (!tourDone()) setTimeout(() => setTourOpen(true), 600);
    return () => window.removeEventListener("dab:action", onAction);
    // question intentionally read via ref-free closure below
  }, [question]);

  const onPick = (f) => { if (selectFile(f)) { setShowChat(false); } };
  const runAnalyze = async () => { await analyze(question); setActiveTab("analysis"); };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">

        {/* Upload + prompt */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="ไฟล์ข้อมูล" meta={`.csv · .xlsx · .xls — ≤ ${MAX_UPLOAD_MB} MB`} data-tour="upload">
            <div
              className={`border border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-gray-300 dark:border-gray-700 hover:border-brand-400"}`}
              onClick={() => document.getElementById("fileIn").click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); onPick(e.dataTransfer.files[0]); }}
            >
              <Upload size={20} className="mx-auto mb-2 text-gray-400 dark:text-gray-500"/>
              <p className="text-sm text-gray-600 dark:text-gray-300">วางไฟล์ที่นี่ หรือคลิกเลือก</p>
              <p className="num text-[10px] text-gray-400 dark:text-gray-500 mt-1">CSV / EXCEL</p>
              <input id="fileIn" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => onPick(e.target.files[0])}/>
            </div>
            {file && (
              <div className="margin-rule mt-3 flex items-baseline justify-between gap-3">
                <span className="num text-xs text-gray-800 dark:text-gray-100 truncate">{file.name}</span>
                <span className="num text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{(file.size/1024).toFixed(1)} KB · พร้อมตรวจ</span>
              </div>
            )}
          </Card>

          <Card title="คำถามสำหรับ AI" meta={customPmt.trim() ? "custom" : "preset"} data-tour="prompt">
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {QUICK_PROMPTS.map(qp => (
                <button key={qp.label} onClick={() => { setPrompt(qp.prompt); setCustomPmt(""); }}
                  className={`font-mono text-[11px] px-2 py-2 rounded-lg border text-left transition-colors ${prompt===qp.prompt && !customPmt ? "border-brand-500 bg-brand-500 text-white" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100"}`}>
                  {qp.label}
                </button>
              ))}
            </div>
            <textarea value={customPmt} onChange={e => setCustomPmt(e.target.value)} placeholder="หรือพิมพ์คำถามเอง เช่น หาสินค้าขายดี 5 อันดับแรก..."
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none h-16 placeholder:text-gray-300 dark:placeholder:text-gray-600"/>
            <Button onClick={runAnalyze} loading={loading} disabled={!file} className="w-full mt-3" size="md">
              {loading ? "กำลังตรวจสอบข้อมูล…" : "วิเคราะห์ไฟล์"}
            </Button>
          </Card>
        </div>

        {/* Empty state → first-10-seconds demo (v20.1) */}
        {!a && !loading && (
          <Card padding={false}>
            <div className="px-6 py-8 text-center">
              <p className="eyebrow mb-2">ลองก่อน · ไม่ต้องสมัคร ไม่ต้องอัปโหลด</p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">เห็นผลตรวจจริงใน 10 วินาทีแรก</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 max-w-md mx-auto">
                แตะชุดข้อมูลตัวอย่าง — Insights Engine ตรวจสถิติให้ทันที แล้วค่อยอัปโหลดไฟล์ของคุณเองเมื่อพร้อม
              </p>

              {samples === null && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 max-w-2xl mx-auto" aria-busy="true">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full"/>)}
                </div>
              )}

              {samples?.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 max-w-2xl mx-auto">
                  {samples.map(s => (
                    <button key={s.id} onClick={() => runDemoCard(s)}
                      className="group text-left p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-brand-400 hover:-translate-y-0.5 hover:shadow-[0_4px_22px_rgba(245,160,11,0.22)] transition duration-150">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xl" aria-hidden="true">{s.emoji}</span>
                        <span className="font-mono text-[9px] uppercase tracking-eyebrow px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500">{s.badge}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors">{s.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{s.desc}</p>
                      <p className="num text-[10px] text-gray-400 dark:text-gray-500 mt-2">{s.rows?.toLocaleString()} แถว · คุณภาพ {s.quality}/100</p>
                    </button>
                  ))}
                </div>
              )}

              {samples?.length === 0 && (
                <div className="flex items-center justify-center gap-2 mt-5">
                  <Button size="sm" onClick={() => onPick(makeSampleFile())}>ใช้ข้อมูลตัวอย่าง</Button>
                </div>
              )}

              <div className="flex items-center justify-center gap-3 mt-5">
                <button onClick={() => setTourOpen(true)} className="text-xs text-gray-500 dark:text-gray-400 underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">ดูทัวร์แนะนำ</button>
                <p className="num text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                  <Kbd>Ctrl K</Kbd> palette · <Kbd>?</Kbd> ปุ่มลัด
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Analyzing skeleton */}
        {loading && (
          <div className="space-y-4" aria-busy="true" aria-label="กำลังวิเคราะห์">
            <Card padding={false}><div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-gray-100 dark:divide-gray-800">
              {[...Array(5)].map((_, i) => (<div key={i} className="px-4 py-3 space-y-2"><Skeleton className="h-2.5 w-14"/><Skeleton className="h-6 w-20"/></div>))}
            </div></Card>
            <Card><div className="space-y-3"><Skeleton className="h-3 w-40"/><Skeleton className="h-3 w-full"/><Skeleton className="h-3 w-full"/><Skeleton className="h-3 w-5/6"/><Skeleton className="h-3 w-3/4"/></div></Card>
          </div>
        )}

        {/* Readout strip */}
        {a && (
          <Card padding={false}>
            <div className="grid grid-cols-2 md:grid-cols-6 divide-x divide-y md:divide-y-0 divide-gray-100 dark:divide-gray-800">
              {[
                { label: "Rows",       value: a.rows?.toLocaleString() },
                { label: "Columns",    value: a.columns },
                { label: "Server",     value: `${a.durationMs} ms` },
                { label: "Perceived",  value: a.perceivedMs ? `${a.perceivedMs} ms` : "—", tone: a.perceivedMs > 4000 ? "alert" : undefined },
                { label: "Missing",    value: a.missing?.length || 0, tone: a.missing?.length ? "alert" : undefined },
                { label: "Duplicates", value: a.dupes?.count || 0,    tone: a.dupes?.count   ? "alert" : undefined },
              ].map((s, i) => <div key={s.label} className="px-4 py-3"><Readout label={s.label} value={s.value} tone={s.tone} index={i}/></div>)}
            </div>
          </Card>
        )}

        {/* Suggestions */}
        {a?.suggestions?.length > 0 && (
          <Card title="คำถามแนะนำจากข้อมูลชุดนี้" meta={`${a.suggestions.length} prompts`}>
            <div className="flex flex-wrap gap-1.5">
              {a.suggestions.map((s, i) => (
                <button key={i} onClick={() => { setCustomPmt(s.prompt); setPrompt(""); }}
                  className="font-mono text-[11px] px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors">
                  ▸ {s.label || (s.prompt.length > 30 ? s.prompt.slice(0, 29) + "…" : s.prompt)}
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Result tabs */}
        {a && (
          <div>
            <div data-tour="tabs" role="tablist" aria-label="ผลการวิเคราะห์" className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 border-b border-gray-200 dark:border-gray-800">
              {TABS.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} role="tab" aria-selected={activeTab===tab}
                  className={`shrink-0 font-mono text-[11px] uppercase tracking-eyebrow pb-2 -mb-px border-b-2 transition-colors ${activeTab===tab ? "text-gray-900 dark:text-gray-100 border-brand-500" : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-700"}`}>
                  {tab}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div key={activeTab} className="xl:col-span-2 space-y-4 anim-tab">
                {activeTab === "analysis"    && <AnalysisTab a={a} canShare={!!accessToken} exporting={exporting} onShare={shareReport} onExport={(fmt) => exportReport(fmt, question)}/>}
                {activeTab === "insights"    && <InsightsTab a={a}/>}
                {activeTab === "charts"      && <Suspense fallback={<ChartFallback/>}><ChartsTab a={a}/></Suspense>}
                {activeTab === "quality"     && <QualityTab a={a}/>}
                {activeTab === "correlation" && <Suspense fallback={<ChartFallback/>}><CorrelationTab a={a}/></Suspense>}
                {activeTab === "สถิติ"        && (a.datasetId
                  ? <Suspense fallback={<ChartFallback/>}><InferencePanel datasetId={a.datasetId}/></Suspense>
                  : <Card><p className="text-sm text-gray-500 dark:text-gray-400 margin-rule">บันทึกชุดข้อมูลก่อน จึงจะทดสอบทางสถิติได้ — การทดสอบต้องใช้ข้อมูลทุกแถว ไม่ใช่แค่ตัวอย่าง</p></Card>)}
                {activeTab === "forecast"    && <ForecastTab a={a}/>}
                {activeTab === "deep dive"   && (a.savedId
                  ? <AgentPanel analysisId={a.savedId}/>
                  : <Card><p className="text-sm text-gray-500 dark:text-gray-400 margin-rule">เข้าสู่ระบบและบันทึกการวิเคราะห์ก่อน จึงจะเจาะลึกด้วย agent ได้</p></Card>)}
              </div>

              <div className="space-y-4">
                <ColumnStatsPanel colAnalysis={a.colAnalysis}/>
                {a.savedId && (
                  <Button variant="secondary" className="w-full" onClick={() => setShowChat(s => !s)}>
                    <MessageSquare size={14}/>
                    {showChat ? "ปิดหน้าถาม-ตอบ" : "ถามต่อเกี่ยวกับข้อมูลชุดนี้"}
                  </Button>
                )}
              </div>
            </div>

            {showChat && a.savedId && <div className="mt-4"><ChatPanel analysisId={a.savedId}/></div>}
          </div>
        )}
      </div>
      <Tour open={tourOpen} onClose={() => setTourOpen(false)}/>
    </div>
  );
}

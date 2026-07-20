/**
 * components/dashboard/tabs.jsx — v12
 * The six result panels, split out of the old god-component. Each is a
 * small, focused, presentational piece driven by the analysis object.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Download, Share2, FileText, Upload } from "lucide-react";
import { Card, Badge, Button, QualityRing, GradeStamp, Eyebrow } from "../ui";

/* Findings as auditor's marginalia: mark · red rule · entry */
const SEVERITY = {
  critical: { mark: "✕", cls: "text-rule dark:text-rule-dark",      tag: "CRITICAL", badge: "red"    },
  warning:  { mark: "!", cls: "text-pencil dark:text-pencil-dark",  tag: "WARNING",  badge: "yellow" },
  info:     { mark: "·", cls: "text-gray-400 dark:text-gray-500",   tag: "NOTE",     badge: "gray"   },
  positive: { mark: "✓", cls: "text-brand-500 dark:text-brand-300", tag: "GOOD",     badge: "green"  },
};

export function InsightRow({ ins, index = 0 }) {
  const sv = SEVERITY[ins.severity] || SEVERITY.info;
  // v20.4: the margin rule now carries the verdict color per finding,
  // and rows rise in staggered (rule 02) — first six only, then instant.
  const ruleCls = ins.severity === "critical" ? "bg-rule dark:bg-rule-dark"
                : ins.severity === "warning"  ? "bg-pencil dark:bg-pencil-dark"
                : "bg-stamp dark:bg-stamp-dark";
  return (
    <div style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }} className="anim-rise grid grid-cols-[24px_2px_1fr] gap-x-3 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className={`font-mono text-sm font-semibold text-center leading-5 ${sv.cls}`} aria-hidden="true">{sv.mark}</div>
      <div className={`rounded-full ${ruleCls}`}/>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-5">{ins.title}</p>
          <Badge variant={sv.badge}>{sv.tag}</Badge>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{ins.detail}</p>
      </div>
    </div>
  );
}

export function AnalysisTab({ a, canShare, exporting, onShare, onExport }) {
  // No AI prose to show — three honest reasons, one shared shell:
  //   demo     → pitch uploading your own file (v20.1)
  //   aiGated  → anonymous upload: stats were free, AI is the signed-in tier (v20.3)
  //   aiBudget → global daily cap reached: degrade gracefully, never go down (v20.3)
  if (!a.analysis && (a.demo || a.aiGated || a.aiBudget)) {
    return (
      <Card>
        <div className="flex items-center gap-2.5 mb-4">
          <Eyebrow>รายงานผู้ตรวจ · AI</Eyebrow>
          {a.quality && <GradeStamp score={a.quality.score}/>}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
          {a.aiBudget ? (
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-7">
              วันนี้โควต้าบทวิเคราะห์ AI ของระบบเต็มแล้ว 🙏 ผลตรวจเชิงสถิติทั้งหมด —
              insights, คุณภาพ, กราฟ, correlation — ยังครบถ้วนตามปกติ พรุ่งนี้บทวิเคราะห์ AI จะกลับมาให้อัตโนมัติ
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-7">
                ทุกอย่างที่เห็นอยู่ — insights, คะแนนคุณภาพ, กราฟ, correlation — มาจาก{" "}
                <span className="font-medium">Insights Engine</span> ล้วน ๆ: คำนวณจากสถิติ ได้ผลทันที และฟรี
              </p>
              {a.demo ? (
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-7">
                  อัปโหลดไฟล์ของคุณเองเพื่อรับ<span className="font-medium">บทวิเคราะห์ AI ภาษาไทยฉบับเต็ม</span>{" "}
                  ตรงแท็บนี้ พร้อมถาม-ตอบเจาะลึกต่อได้
                </p>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-7">
                  เข้าสู่ระบบ (ฟรี) เพื่อรับ<span className="font-medium">บทวิเคราะห์ AI ภาษาไทยฉบับเต็ม</span>{" "}
                  ของไฟล์นี้ พร้อมเก็บประวัติ แชร์รายงาน และถาม-ตอบต่อได้
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {a.demo && (
              <Button size="sm" onClick={() => document.getElementById("fileIn")?.click()}>
                <Upload size={13}/> อัปโหลดไฟล์ของฉัน
              </Button>
            )}
            {!a.aiBudget && (
              <Link to="/auth" className="font-mono text-[11px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors">
                {a.demo ? "สมัครฟรี — เก็บประวัติ + แชร์รายงาน" : "เข้าสู่ระบบ / สมัครฟรี"}
              </Link>
            )}
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <Eyebrow>รายงานผู้ตรวจ · AI</Eyebrow>
          {a.quality && <GradeStamp score={a.quality.score}/>}
        </div>
        <div className="flex gap-2">
          {canShare && <Button variant="ghost" size="sm" onClick={onShare}><Share2 size={13}/> Share</Button>}
          <Button variant="secondary" size="sm" onClick={() => onExport("pdf")}   loading={exporting==="pdf"}><FileText size={13}/> PDF</Button>
          <Button variant="secondary" size="sm" onClick={() => onExport("excel")} loading={exporting==="excel"}><Download size={13}/> Excel</Button>
        </div>
      </div>
      <p className="text-sm text-gray-800 dark:text-gray-200 leading-7 whitespace-pre-wrap border-t border-gray-100 dark:border-gray-800 pt-4">{a.analysis}</p>
    </Card>
  );
}

export function InsightsTab({ a }) {
  return (
    <Card title="บันทึกข้างเล่ม · Insights" meta={`${a.insights?.length || 0} findings`}>
      {a.insights?.length
        ? <div className="-my-3">{a.insights.map((ins, i) => <InsightRow key={ins.id} ins={ins} index={i}/>)}</div>
        : <p className="text-sm text-gray-400 dark:text-gray-500">ไม่พบประเด็นเด่นจากสถิติ — ข้อมูลชุดนี้ดูปกติดี</p>}
      <p className="num text-[10px] text-gray-400 dark:text-gray-500 mt-4">คำนวณจากสถิติล้วน (ไม่ใช้ AI) — ได้ผลทันที ตรวจซ้ำได้เสมอ</p>
    </Card>
  );
}

export function QualityTab({ a }) {
  if (!a.quality) return null;
  return (
    <Card title="ผลตรวจคุณภาพ · Quality">
      <div className="flex items-center gap-4 mb-5">
        <QualityRing score={a.quality.score} size={80}/>
        <div className="space-y-1.5">
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{a.quality.label}</p>
          <GradeStamp score={a.quality.score} delay={700}/>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Object.entries(a.quality.breakdown).map(([key, val]) => (
          <div key={key} className="text-center">
            <div className="num text-base font-semibold text-gray-800 dark:text-gray-200">{val.score}<span className="text-xs text-gray-400">/{val.max}</span></div>
            <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{key}</div>
            <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full mt-1 overflow-hidden">
              <div className="h-1 bg-brand-500 rounded-full" style={{ width: `${(val.score/val.max)*100}%` }}/>
            </div>
          </div>
        ))}
      </div>
      {a.quality.issues?.length > 0 && (
        <div className="space-y-2">
          <Eyebrow>Issues found</Eyebrow>
          {a.quality.issues.map((iss, i) => (
            <div key={i} className="margin-rule flex items-start gap-2 py-1.5 text-xs">
              <span className={`font-mono font-semibold ${iss.severity==="high" ? "text-rule dark:text-rule-dark" : iss.severity==="medium" ? "text-pencil dark:text-pencil-dark" : "text-gray-400"}`}>{iss.severity==="high"?"✕":iss.severity==="medium"?"!":"·"}</span>
              <div className="text-gray-700 dark:text-gray-300">{iss.message}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ForecastTab({ a }) {
  return (
    <Card>
      <Eyebrow className="mb-4">พยากรณ์เชิงเส้น · Forecast</Eyebrow>
      {a.forecasts?.length > 0 ? (
        <div className="space-y-4">
          {a.forecasts.map((f, i) => (
            <div key={i} className="p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{f.col}</span>
                <Badge variant={f.r2>=0.8?"green":f.r2>=0.5?"yellow":"gray"}>R² = {f.r2}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {f.forecast.map(p => (
                  <div key={p.step} className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-100 dark:border-gray-800">
                    <div className="eyebrow !text-[9px]">+{p.step} step</div>
                    <div className="num text-sm font-semibold text-brand-600 dark:text-brand-300 mt-0.5">{p.predicted.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-gray-400">No columns with sufficient linear trend (R² ≥ 0.5)</p>}
    </Card>
  );
}

export function ColumnStatsPanel({ colAnalysis = [] }) {
  return (
    <Card>
      <Eyebrow className="mb-3">สถิติรายคอลัมน์</Eyebrow>
      <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-hide">
        {colAnalysis.map((c, i) => (
          <div key={i} className="p-2.5 bg-gray-50 dark:bg-gray-950 rounded-lg">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate flex-1">{c.col}</span>
              <Badge variant={c.type==="numeric"?"blue":"yellow"}>{c.type}</Badge>
              {c.missing > 0 && <Badge variant="red">{c.missingPct}% missing</Badge>}
            </div>
            {c.type === "numeric" ? (
              <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                <span>min <b className="num text-gray-700 dark:text-gray-200">{c.min}</b></span>
                <span>max <b className="num text-gray-700 dark:text-gray-200">{c.max}</b></span>
                <span>avg <b className="num text-gray-700 dark:text-gray-200">{c.avg?.toFixed(1)}</b></span>
                <span>med <b className="num text-gray-700 dark:text-gray-200">{c.median}</b></span>
                <span>σ <b className="num text-gray-700 dark:text-gray-200">{c.stdDev?.toFixed(1)}</b></span>
                {c.outlierCount > 0 && <span className="num text-pencil dark:text-pencil-dark">! {c.outlierCount} outliers</span>}
              </div>
            ) : (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <span>{c.unique} unique</span>
                {c.top?.slice(0,3).map((t, j) => (
                  <div key={j} className="flex items-center gap-1 mt-1">
                    <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden">
                      <div className="bg-brand-500 h-1 rounded-full" style={{ width: `${t.pct}%` }}/>
                    </div>
                    <span className="text-[10px] text-gray-400 w-12 truncate">{t.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

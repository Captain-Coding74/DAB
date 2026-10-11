/**
 * components/dashboard/tabs.jsx — v12
 * The six result panels, split out of the old god-component. Each is a
 * small, focused, presentational piece driven by the analysis object.
 */
import React, { useState, Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { Download, Share2, FileText, Upload } from "lucide-react";
import { Card, Badge, Button, QualityRing, GradeStamp, Eyebrow, AiLabel, Modal, Input } from "../ui";
import { useLang } from "../../lib/i18n";

/* v21.30: the fixes panel (with the AI-edit confirmation and its strings)
   loads when the Quality tab first opens, not with the first paint — the
   privacy release's dialogs had pushed perf:bundle's initial payload over
   its budget. */
const LazyFixPanel = lazy(() => import("./FixPanel").then((m) => ({ default: m.FixPanel })));
const FixPanel = (props) => <Suspense fallback={null}><LazyFixPanel {...props}/></Suspense>;

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

/* Share and the PDF / Excel exports. v21.30: in both shells — a "Statistics
   only" result, or one past the AI budget, used to lose all three, though
   the server shares and exports a report with no AI text just the same. */
function ReportActions({ canShare, exporting, onShareOpen, onExport }) {
  const { t } = useLang();
  return (
    <div className="flex gap-2">
      {canShare && <Button variant="ghost" size="sm" onClick={onShareOpen} aria-haspopup="dialog"><Share2 size={13}/> {t("share.button")}</Button>}
      <Button variant="secondary" size="sm" onClick={() => onExport("pdf")}   loading={exporting==="pdf"}><FileText size={13}/> PDF</Button>
      <Button variant="secondary" size="sm" onClick={() => onExport("excel")} loading={exporting==="excel"}><Download size={13}/> Excel</Button>
    </div>
  );
}

export function AnalysisTab({ a, canShare, exporting, onShare, onExport }) {
  const { t } = useLang();
  const [shareOpen, setShareOpen] = useState(false);   // v21.30: Share opens ShareDialog
  const actions = <ReportActions canShare={canShare} exporting={exporting} onShareOpen={() => setShareOpen(true)} onExport={onExport}/>;
  const shareDialog = canShare && shareOpen && <ShareDialog open onClose={() => setShareOpen(false)} onCreate={onShare}/>;
  // No AI prose to show — four honest reasons, one shared shell:
  //   demo       → pitch uploading your own file (v20.1)
  //   aiGated    → anonymous upload: stats were free, AI is the signed-in tier (v20.3)
  //   aiBudget   → global daily cap reached: degrade gracefully, never go down (v20.3)
  //   aiDisabled → the user chose statistics only, or the dataset's AI is off (v21.30)
  if (!a.analysis && (a.demo || a.aiGated || a.aiBudget || a.aiDisabled)) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Eyebrow>รายงานผู้ตรวจ · AI</Eyebrow>
            {a.quality && <GradeStamp score={a.quality.score}/>}
          </div>
          {(a.aiDisabled || a.aiBudget) && actions}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
          {a.aiDisabled ? (
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-7">{t("ai.offReport")}</p>
          ) : a.aiBudget ? (
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
            {!a.aiBudget && !a.aiDisabled && (
              <Link to="/auth" className="font-mono text-[11px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors">
                {a.demo ? "สมัครฟรี — เก็บประวัติ + แชร์รายงาน" : "เข้าสู่ระบบ / สมัครฟรี"}
              </Link>
            )}
          </div>
        </div>
        {shareDialog}
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
        {actions}
      </div>
      <p className="text-sm text-gray-800 dark:text-gray-200 leading-7 whitespace-pre-wrap border-t border-gray-100 dark:border-gray-800 pt-4">{a.analysis}</p>
      {a.analysis && <AiLabel className="mt-3"/>}
      {shareDialog}
    </Card>
  );
}

/**
 * ShareDialog — v21.30
 *
 * The only way to make a share link. The old Share button made one in a
 * single click: no warning, no expiry, no password, and the uploaded file's
 * name as the public title. Now the owner reads who can see the report,
 * picks how long the link lives (no "never"), may set a password, and gets
 * a generic title they can change. Built on the UI kit's Modal, which
 * already traps focus, closes on Esc and restores focus afterwards. It
 * lives here, beside its only caller, rather than in its own .jsx: no
 * component file can be loaded by the node --test suites yet, and the
 * uncounted-files budget (quality-budget.json) counts each new one.
 */
const EXPIRY_DAYS = [1, 7, 30, 90];   // mirrors SHARE_EXPIRY_DAYS (backend/src/services/shareView.js)
const DEFAULT_DAYS = 30;

/** onCreate({ title, password, expiresInDays }) → { url, copied } | null */
function ShareDialog({ open, onClose, onCreate }) {
  const { t } = useLang();
  // AnalysisTab mounts this per opening, so every link starts clean: the
  // generic title, the default expiry, no password.
  const [title,    setTitle]    = useState(() => t("share.defaultTitle"));
  const [days,     setDays]     = useState(DEFAULT_DAYS);
  const [password, setPassword] = useState("");
  const [busy,     setBusy]     = useState(false);
  const [created,  setCreated]  = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await onCreate({ title: title.trim() || t("share.defaultTitle"), password, expiresInDays: days });
      if (r) setCreated(r);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("share.dialogTitle")}>
      {created ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-gray-700 dark:text-gray-200">
            {t(created.copied ? "share.copied" : "share.copyManually")}
          </p>
          <Input id="share-url" label={t("share.linkLabel")} value={created.url} readOnly autoFocus onFocus={e => e.target.select()}/>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p id="share-warning" className="px-3 py-2 rounded-lg text-xs leading-relaxed bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
            {t("share.warning")}
          </p>
          <Input id="share-title" label={t("share.titleLabel")} value={title} maxLength={120}
            onChange={e => setTitle(e.target.value)}/>
          <div className="space-y-1">
            <label htmlFor="share-expiry" className="eyebrow block">{t("share.expiry")}</label>
            <select id="share-expiry" value={days} onChange={e => setDays(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-400">
              {EXPIRY_DAYS.map(n => <option key={n} value={n}>{n} {t(n === 1 ? "share.day" : "share.days")}</option>)}
            </select>
          </div>
          <div>
            <Input id="share-password" label={t("share.password")} type="password" autoComplete="new-password"
              value={password} onChange={e => setPassword(e.target.value)} aria-describedby="share-password-hint"/>
            <p id="share-password-hint" className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{t("share.passwordHint")}</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy} aria-describedby="share-warning">{t("share.create")}</Button>
          </div>
        </form>
      )}
    </Modal>
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

export function QualityTab({ a, onApplied, aiOff, save }) {
  /* v21.22: the quality tab is where problems are first SEEN, so it is also
     where they get FIXED — FixPanel (suggest → preview → apply + free-text AI
     edit) renders below the score card. The panel gates itself on a stored
     dataset (a.datasetId), same as the สถิติ tab, so the quality card no
     longer short-circuits the whole tab when quality is absent. v21.30:
     `save` lets the panel offer "Save dataset" when there is none yet. */
  if (!a.quality) return <FixPanel datasetId={a.datasetId} onApplied={onApplied} aiOff={aiOff} save={save}/>;
  return (
    <>
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
    <FixPanel datasetId={a.datasetId} onApplied={onApplied} aiOff={aiOff} save={save}/>
    </>
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
                    <div className="eyebrow">+{p.step} step</div>
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


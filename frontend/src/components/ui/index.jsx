/**
 * UI kit — "The Ledger" (v10)
 * Same exports + props as before, restyled as ledger forms:
 * feint rules, mono figures, stamp-green actions, red margin for alerts.
 * New: Eyebrow, Readout, GradeStamp.
 */
import React from "react";
import { clsx } from "clsx";
import { X, AlertCircle, CheckCircle, Info } from "lucide-react";
import { useAppStore } from "../../store";
import { clampScore, gradeFor, gradeHex, gradeStampClass } from "../../lib/grade";

// ── Button ────────────────────────────────────────────────
export function Button({ children, variant = "primary", size = "md", className, disabled, loading, ...props }) {
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900 disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary:  "bg-brand-500 hover:bg-brand-600 text-white",
    secondary:"bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700",
    danger:   "bg-rule hover:bg-[#A93321] dark:bg-rule-dark text-white",
    ghost:    "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400",
  };
  const sizes = { sm: "text-xs px-3 py-1.5", md: "text-sm px-4 py-2", lg: "text-base px-5 py-2.5" };
  return (
    <button className={clsx(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading && <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
      {children}
    </button>
  );
}

// ── Eyebrow (typewritten section label) ───────────────────
export function Eyebrow({ children, className }) {
  return <p className={clsx("eyebrow", className)}>{children}</p>;
}

// ── Card (ledger form) ────────────────────────────────────
// Optional `title` + `meta` render a ruled header row: EYEBROW ······ meta
export function Card({ children, className, padding = true, title, meta, ...rest }) {
  return (
    <div className={clsx("bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-paper", className)} {...rest}>
      {(title || meta) && (
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
          {title && <Eyebrow>{title}</Eyebrow>}
          {meta  && <span className="num text-[10px] text-gray-400 dark:text-gray-500">{meta}</span>}
        </div>
      )}
      <div className={clsx(padding && "p-5")}>{children}</div>
    </div>
  );
}

// ── Badge (mono ledger tag) ───────────────────────────────
export function Badge({ children, variant = "green" }) {
  const variants = {
    green:  "bg-brand-50 text-brand-600 border-brand-200 dark:bg-brand-900/40 dark:text-brand-300 dark:border-brand-800",
    blue:   "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    yellow: "bg-pencil-soft text-pencil border-[#DFC79A] dark:bg-pencil/15 dark:text-pencil-dark dark:border-pencil/40",
    red:    "bg-rule-soft text-rule border-[#DFB0A6] dark:bg-rule/15 dark:text-rule-dark dark:border-rule/40",
    gray:   "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  };
  return <span className={clsx("inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[10px] font-medium tracking-wide", variants[variant])}>{children}</span>;
}

// ── Input ─────────────────────────────────────────────────
export function Input({ label, error, className, ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="eyebrow block">{label}</label>}
      <input className={clsx("w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-400 transition", error ? "border-rule" : "border-gray-200 dark:border-gray-700", className)} {...props}/>
      {error && <p className="text-xs text-rule dark:text-rule-dark">{error}</p>}
    </div>
  );
}

// ── Textarea ──────────────────────────────────────────────
export function Textarea({ label, className, ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="eyebrow block">{label}</label>}
      <textarea className={clsx("w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-400 transition resize-none", className)} {...props}/>
    </div>
  );
}

// ── Modal — v11: focus trap, Esc to close, focus restore, dialog ARIA ──
export function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  const boxRef  = React.useRef(null);
  const prevRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    prevRef.current = document.activeElement;
    const box = boxRef.current;
    const focusables = () => box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (focusables()[0] || box).focus();

    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    box.addEventListener("keydown", onKey);
    return () => { box.removeEventListener("keydown", onKey); prevRef.current?.focus?.(); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm"/>
      <div ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className={clsx("relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full outline-none", width)} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="eyebrow !text-[11px]">{title}</h2>
          <button onClick={onClose} aria-label="ปิดหน้าต่าง" className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"><X size={16} className="text-gray-500 dark:text-gray-400"/></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Toasts (margin-rule entries) ──────────────────────────
export function Toasts() {
  const toasts = useAppStore(s => s.toasts);
  const icons  = { success: <CheckCircle size={15} className="text-brand-500 dark:text-brand-300"/>, error: <AlertCircle size={15} className="text-rule dark:text-rule-dark"/>, info: <Info size={15} className="text-gray-500"/> };
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className="margin-rule flex items-center gap-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-paper rounded-xl pr-3 py-3 text-sm text-gray-800 dark:text-gray-200 min-w-[240px]">
          {icons[t.type] || icons.info}
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button onClick={t.action.onClick}
              className="font-mono text-[11px] font-medium text-brand-600 dark:text-brand-300 border border-brand-300 dark:border-brand-700 rounded px-2 py-1 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors shrink-0">
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return <svg className="animate-spin text-brand-500" style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}

// ── Quality gauge (graded dial with tick marks) ───────────
export function QualityRing({ score, size = 80 }) {
  const r = 30, circ = 2 * Math.PI * r;
  const pct = clampScore(score);
  const off = circ * (1 - pct / 100);
  const color = gradeHex(pct);
  const grade = gradeFor(pct);
  // 10 tick marks, one per decile — the gauge reads like an instrument
  const ticks = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * 2 * Math.PI - Math.PI / 2;
    return { x1: 40 + Math.cos(a) * 36, y1: 40 + Math.sin(a) * 36, x2: 40 + Math.cos(a) * 38.5, y2: 40 + Math.sin(a) * 38.5 };
  });
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 80 80">
        {ticks.map((t, i) => <line key={i} {...t} strokeWidth="1.5" className="stroke-gray-300 dark:stroke-gray-700"/>)}
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" className="stroke-gray-200 dark:stroke-gray-800"/>
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="butt" transform="rotate(-90 40 40)" style={{ transition: "stroke-dashoffset 0.6s ease" }}/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-semibold leading-none" style={{ color }}>{grade}</span>
        <span className="num text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{pct}</span>
      </div>
    </div>
  );
}

// ── Readout (instrument stat: eyebrow label + mono figure) ─
export function Readout({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <div className={clsx("num text-xl font-medium mt-0.5 truncate", tone === "alert" ? "text-rule dark:text-rule-dark" : "text-gray-900 dark:text-gray-100")}>{value}</div>
    </div>
  );
}

// ── Grade stamp (inline chip: double-ruled, mono) ─────────
export function GradeStamp({ score }) {
  const pct = clampScore(score);
  const grade = gradeFor(pct);
  const cls = gradeStampClass(pct);
  return (
    <span className={clsx("inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold px-2 py-0.5 rounded border-2 border-double", cls)}>
      GRADE {grade} <span className="font-normal opacity-70">· {pct}/100</span>
    </span>
  );
}

// ── Skeleton (feint shimmer block) — v11 ─────────────────
export function Skeleton({ className }) {
  return <div aria-hidden="true" className={clsx("animate-pulse rounded bg-gray-100 dark:bg-gray-800", className)}/>;
}

// ── Kbd (keyboard hint chip) — v11 ───────────────────────
export function Kbd({ children }) {
  return <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 border-b-2 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{children}</kbd>;
}

// ── Wave loading bars ─────────────────────────────────────
export function WaveBars() {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {[0,.12,.24,.36,.48].map((d,i) => (
        <div key={i} className="w-1 rounded-full bg-brand-500 dark:bg-brand-300" style={{ height: 5, animation: `wave 0.7s ${d}s ease-in-out infinite` }}/>
      ))}
      <style>{`@keyframes wave{0%,100%{height:5px}50%{height:18px}}`}</style>
    </div>
  );
}

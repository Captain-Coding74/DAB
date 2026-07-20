/**
 * Tour — v11 first-run walkthrough
 * Spotlights real elements via data-tour attributes: a dimmed overlay with a
 * cut-out ring around the target and a positioned coach card. No library —
 * ~120 lines, respects reduced motion, ends into localStorage.
 */
import React, { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "../ui";

const STEPS = [
  { target: '[data-tour="upload"]',  title: "1 · วางไฟล์ของคุณ",     body: "ลาก CSV หรือ Excel มาวางตรงนี้ หรือคลิกเพื่อเลือกไฟล์ (ไม่เกิน 10 MB) ถ้ายังไม่มีไฟล์ ลองปุ่ม \u201cใช้ข้อมูลตัวอย่าง\u201d ได้เลย" },
  { target: '[data-tour="prompt"]',  title: "2 · ตั้งคำถาม",          body: "เลือกคำถามสำเร็จรูป หรือพิมพ์คำถามของคุณเอง แล้วกด \u201cวิเคราะห์ไฟล์\u201d — AI จะอ่านสถิติทั้งชุดก่อนตอบ" },
  { target: '[data-tour="tabs"]',    title: "3 · อ่านผลตรวจ",         body: "ผลแบ่งเป็นแท็บ: รายงาน AI, บันทึกข้างเล่ม (insights), แผนภูมิ, เกรดคุณภาพ, สหสัมพันธ์ และพยากรณ์" },
  { target: '[data-tour="palette"]', title: "4 · ทางลัดทุกอย่าง",     body: "กด Ctrl+K เปิด command palette — สั่งงานทุกอย่างจากคีย์บอร์ด กด ? เพื่อดูปุ่มลัดทั้งหมด" },
];

export function tourDone()  { return localStorage.getItem("dab_tour_done") === "1"; }
export function markTour()  { localStorage.setItem("dab_tour_done", "1"); }

export default function Tour({ open, onClose }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  const step = STEPS[i];
  const finish = () => { markTour(); onClose(); };

  /**
   * v16 BUG FIX (found by the browser suite): step 1 was ALWAYS skipped.
   *
   * `rect` starts null, and the old code checked `if (!rect) → advance` during
   * render — which happens BEFORE the layout effect gets a chance to measure.
   * So the very first step advanced itself instantly and every user landed on
   * "2 / 4", never seeing the step that explains how to upload a file.
   *
   * Skipping a genuinely-absent target is a *measurement* decision, so it now
   * lives in measure(). Render never mutates state. We also clear rect on step
   * change so the spotlight can't flash on the previous step's element.
   */
  const measure = () => {
    const el = document.querySelector(step?.target);
    if (!el) {
      // Target isn't on screen (e.g. the tabs, before any analysis) → skip it.
      if (i < STEPS.length - 1) setI(v => v + 1);
      else finish();
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  };

  useLayoutEffect(() => { if (open) setI(0); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    setRect(null);   // never show the previous step's spotlight
    measure();
  }, [open, i]);
  useEffect(() => {
    if (!open) return;
    const onR = () => measure();
    window.addEventListener("resize", onR);
    window.addEventListener("scroll", onR, true);
    const onKey = (e) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", onR); window.removeEventListener("scroll", onR, true); window.removeEventListener("keydown", onKey); };
  }, [open, i]);

  if (!open || !step) return null;
  if (!rect) return null;   // measuring — render nothing, mutate nothing

  const pad = 8;
  const below = rect.top + rect.height + 180 < window.innerHeight;
  const cardTop  = below ? rect.top + rect.height + pad + 8 : Math.max(12, rect.top - 178);
  const cardLeft = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 372));

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="ทัวร์แนะนำการใช้งาน">
      {/* Dim everything, cut a window over the target with a huge box-shadow */}
      <div className="absolute rounded-xl ring-2 ring-brand-400 transition-all duration-200"
        style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
                 boxShadow: "0 0 0 9999px rgba(16,20,16,0.62)" }}/>
      {/* Coach card */}
      <div className="absolute w-[360px] max-w-[calc(100vw-24px)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-4 transition-all duration-200"
        style={{ top: cardTop, left: cardLeft }}>
        <div className="margin-rule">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{step.title}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">{step.body}</p>
        </div>
        <div className="flex items-center justify-between mt-4">
          <span className="num text-[10px] text-gray-400">{i + 1} / {STEPS.length}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={finish}>ข้าม</Button>
            {i > 0 && <Button variant="secondary" size="sm" onClick={() => setI(i - 1)}>ก่อนหน้า</Button>}
            {i < STEPS.length - 1
              ? <Button size="sm" onClick={() => setI(i + 1)}>ถัดไป</Button>
              : <Button size="sm" onClick={finish}>เริ่มใช้งาน</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

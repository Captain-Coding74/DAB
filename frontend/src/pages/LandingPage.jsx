import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Upload, FileSearch, PenLine, X, Check } from "lucide-react";

/**
 * Landing — /welcome  (v20.5)
 *
 * Built entirely from the Ledger tokens already in tailwind.config.js. No new
 * colours, no new fonts, no third-party requests (backend/e2e/browser.test.mjs
 * asserts zero, and fonts stay self-hosted per main.jsx).
 *
 * The one composition decision: the hero panel renders as a NAVY console slab
 * (gray-950) in BOTH colour modes rather than following the page. v20.4 is
 * called the After-Hours Console, so the instrument reads as an instrument —
 * lit amber and stamp-green marks on navy ink — while the page around it stays
 * ledger paper. Light mode gets the contrast for free; dark mode reads as the
 * console taking over the whole desk.
 */

/* Five rows of a real messy Thai export. `bad` rows are what DAB caught. */
const ROWS = [
  { n: "001", raw: ["ร้านค้า A ", "12/3/68", '"1,234.00 บาท"'], fix: ["ร้านค้า A", "2025-03-12", "1234.00"], note: "แปลงชนิดข้อมูล" },
  { n: "002", raw: ["ร้านค้าA", "13 มี.ค. 2568", "988"], fix: ["ร้านค้า A", "2025-03-13", "988.00"], note: "รวมชื่อซ้ำ" },
  { n: "003", raw: ["—", "—", "—"], fix: ["—", "—", "—"], note: "ตัดแถวว่าง", drop: true },
  { n: "004", raw: ["ร้านค้า B", "2025-03-14", "n/a"], fix: ["ร้านค้า B", "2025-03-14", "ไม่มีค่า"], note: "ทำเป็นค่าว่าง" },
  { n: "005", raw: ["ร้านค้า B", "15/03/2025", "2.1k"], fix: ["ร้านค้า B", "2025-03-15", "2100.00"], note: "หน่วยไม่ตรงคอลัมน์" },
];

const CATCHES = [
  ["ตัวเลขที่ถูกเก็บเป็นข้อความ", '"1,234.00 บาท"', "1234.00"],
  ["ปี พ.ศ. ปนกับ ค.ศ. ในคอลัมน์เดียว", "12/3/68 · 13 มี.ค. 2568", "2025-03-12"],
  ["ชื่อเดียวกันที่สะกดต่างกัน", "ร้านค้า A · ร้านค้าA", "รวมเป็นกลุ่มเดียว"],
  ["ค่าที่หายไป แต่ซ่อนเป็นข้อความ", "n/a · - · ไม่ระบุ", "ค่าว่างจริง"],
  ["แถวว่างและหัวตารางซ้อนกลางไฟล์", "แถว 3, 88, 512", "ตัดออกและบันทึกไว้"],
  ["หน่วยไม่ตรงกันในคอลัมน์เดียว", "2.1k · 2100", "2100.00"],
];

const STEPS = [
  [Upload, "อัปโหลด", "ลากไฟล์ .csv หรือ .xlsx เข้ามา ตัวอ่านแบบ streaming ไล่ทีละแถว ไฟล์ใหญ่ไม่ต้องรอโหลดทั้งก้อน"],
  [FileSearch, "ตรวจและแปลง", "ชั้น normalization เดาชนิดข้อมูลของแต่ละคอลัมน์ แก้ค่าที่ผิดรูป แล้วเก็บบันทึกไว้ว่าแตะอะไรไปบ้าง"],
  [PenLine, "สรุปผล", "Insights Engine เขียนสรุปเป็นภาษาไทย ทุกประโยคมีตัวเลขอ้างอิงกลับไปที่แถวจริงในไฟล์ของคุณ"],
];

/* Reveal on scroll. Reduced motion is handled globally in index.css, but the
   observer still runs so nothing is left stuck at opacity 0. */
function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown];
}

function Section({ entry, title, lead, children }) {
  const [ref, shown] = useReveal();
  return (
    <section ref={ref} className="border-t border-gray-200 dark:border-gray-800 py-16 sm:py-24">
      <div className="max-w-screen-xl mx-auto px-4">
        <p className={`eyebrow flex items-center gap-3 ${shown ? "anim-rise" : "opacity-0"}`}>
          {entry}<span className="h-px flex-1 bg-gray-200 dark:bg-gray-800"/>
        </p>
        <h2 className={`mt-4 text-2xl sm:text-3xl font-semibold text-balance max-w-2xl ${shown ? "anim-rise" : "opacity-0"}`}>{title}</h2>
        {lead && <p className={`mt-4 max-w-2xl text-gray-600 dark:text-gray-400 ${shown ? "anim-rise" : "opacity-0"}`} style={{ animationDelay: "80ms" }}>{lead}</p>}
        <div className={shown ? "anim-rise" : "opacity-0"} style={{ animationDelay: "140ms" }}>{children}</div>
      </div>
    </section>
  );
}

/* The instrument. Rows resolve one at a time so the product argues for itself
   instead of being described. */
function Console() {
  const [done, setDone] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setDone(ROWS.length); return; }
    const timers = ROWS.map((_, i) => setTimeout(() => setDone(i + 1), 700 + i * 360));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="mt-14 rounded-xl overflow-hidden bg-gray-950 border border-gray-800 shadow-paper text-left">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <span className="num text-[11px] text-gray-100">yodyai_survey_ปี3.xlsx</span>
        <span className="num text-[11px] text-gray-400">ชีต 1 · 4,182 แถว</span>
        <span className="num text-[11px] text-gray-400 ml-auto">02:47</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left">
          <caption className="sr-only">ตัวอย่าง 5 แถวแรกระหว่างการตรวจ</caption>
          <thead>
            <tr className="border-b border-gray-800">
              {["#", "ร้านค้า", "วันที่", "ยอดขาย", "สถานะ"].map(h => (
                <th key={h} scope="col" className="eyebrow !text-gray-400 px-4 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => {
              const ok = i < done;
              const cells = ok ? r.fix : r.raw;
              return (
                <tr key={r.n} className={`border-b border-gray-800/70 ${ok && r.drop ? "opacity-40" : ""}`}>
                  <td className="num px-4 py-2.5 text-[12px] text-gray-500">{r.n}</td>
                  {cells.map((c, j) => (
                    <td key={j} className={`num px-4 py-2.5 text-[13px] whitespace-nowrap transition-colors duration-200
                      ${ok ? "text-gray-100" : "text-rule-dark line-through"}`}>{c}</td>
                  ))}
                  <td className="px-4 py-2.5">
                    <span className={`num inline-flex items-center gap-1.5 text-[10px] uppercase tracking-eyebrow px-2 py-0.5 rounded
                      ${ok ? (r.drop ? "text-gray-500 border border-gray-800" : "bg-stamp text-gray-950") : "text-rule-dark border border-rule-dark"}`}>
                      {ok ? <Check size={10}/> : <X size={10}/>}{r.note}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-800 bg-gray-900">
        <span className="num text-[12px] text-gray-400" aria-live="polite">
          {done < ROWS.length ? "กำลังตรวจ…" : "ตรวจแล้ว 4,182 แถว · แก้ 3 · ตัดออก 1"}
        </span>
        {done === ROWS.length && (
          <span className="anim-stamp num ml-auto text-[11px] uppercase tracking-eyebrow px-2.5 py-1 rounded border-2 border-stamp-dark text-stamp-dark">
            พร้อมวิเคราะห์
          </span>
        )}
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="pb-4">
      <div className="blueprint anim-drift" aria-hidden="true"/>
      {/* Hero — centred so it dominates the fold. Every section below stays
          left-aligned, which is what keeps the centring reading as emphasis. */}
      <div className="max-w-screen-xl mx-auto px-4 pt-16 sm:pt-28 text-center">
        <p className="eyebrow anim-rise inline-flex items-center gap-3.5">
          <span className="h-px w-8 sm:w-14 bg-gray-200 dark:bg-gray-800"/>
          Data Analysis Bot · v20.4 After-Hours Console
          <span className="h-px w-8 sm:w-14 bg-gray-200 dark:bg-gray-800"/>
        </p>

        <h1 className="anim-rise mt-5 mx-auto max-w-[14ch] text-4xl sm:text-6xl lg:text-7xl font-bold leading-[1.14] tracking-tight text-balance"
            style={{ animationDelay: "80ms" }}>
          ไฟล์เละแค่ไหน ก็อ่านออก
        </h1>

        <p className="anim-rise mx-auto mt-6 max-w-xl text-lg text-gray-600 dark:text-gray-400 text-pretty"
           style={{ animationDelay: "170ms" }}>
          อัปโหลดไฟล์ Excel หรือ CSV ที่ยังไม่ได้จัดระเบียบ DAB ไล่หาค่าที่ผิดรูป แปลงชนิดข้อมูลให้ถูก
          แล้วสรุปผลเป็นภาษาไทยที่คุณเอาไปตอบอาจารย์ได้จริง
        </p>

        <div className="anim-rise mt-9 flex flex-wrap justify-center gap-3" style={{ animationDelay: "260ms" }}>
          <NavLink to="/" className="px-6 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-colors">
            อัปโหลดไฟล์แรก
          </NavLink>
          <a href="#sample" className="px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 font-medium transition-colors">
            ดูตัวอย่างรายงาน
          </a>
        </div>

        <p className="anim-rise num mt-5 text-[12px] text-gray-500 dark:text-gray-400" style={{ animationDelay: "340ms" }}>
          รองรับ .csv .xlsx — หัวตารางไม่อยู่แถวแรกก็ได้
        </p>

        <Console/>
      </div>

      <Section entry="รายการ 001 — การตรวจ" title="สิ่งที่ DAB จับได้ ก่อนที่อาจารย์จะเห็น"
        lead="ข้อมูลจริงไม่เคยมาสะอาด ทุกอย่างข้างล่างนี้คือสิ่งที่เจอซ้ำ ๆ ในไฟล์ที่นักศึกษาส่งเข้ามา DAB ทำเครื่องหมายไว้ทุกจุด แล้วบอกว่าแก้อะไรไปบ้าง">
        <ul className="mt-9 grid sm:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {CATCHES.map(([title, before, after]) => (
            <li key={title} className="bg-gray-50 dark:bg-gray-950 p-5 flex gap-4">
              <X size={16} className="shrink-0 mt-1 text-rule dark:text-rule-dark" aria-hidden="true"/>
              <div>
                <h3 className="font-semibold text-[15px]">{title}</h3>
                <p className="num mt-1.5 text-[13px] text-gray-500 dark:text-gray-400 break-words">
                  <span className="text-rule dark:text-rule-dark">{before}</span>
                  {" → "}
                  <span className="text-stamp dark:text-stamp-dark">{after}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section entry="รายการ 002 — ลำดับการทำงาน" title="สามขั้น จากไฟล์ดิบถึงบทสรุป">
        <ol className="mt-9 grid md:grid-cols-3 gap-px bg-gray-200 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {STEPS.map(([Icon, title, body], i) => (
            <li key={title} className="bg-gray-50 dark:bg-gray-950 p-6">
              <Icon size={18} className="text-brand-500" aria-hidden="true"/>
              <p className="eyebrow mt-3">ขั้นที่ {i + 1}</p>
              <h3 className="mt-2 text-lg font-semibold">{title}</h3>
              <p className="mt-2.5 text-[15px] text-gray-600 dark:text-gray-400">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section entry="รายการ 003 — ผลลัพธ์" title="บทสรุปที่อ้างอิงกลับไปที่ข้อมูลได้"
        lead="ทุกข้อความที่ DAB เขียน ผูกกับแถวและคอลัมน์จริง เวลาอาจารย์ถามว่าเอาตัวเลขนี้มาจากไหน คุณตอบได้">
        <div id="sample" className="margin-rule mt-9 scroll-mt-20">
          <p className="eyebrow">ตัวอย่างผลจาก Insights Engine</p>
          <blockquote className="mt-3 text-xl leading-relaxed max-w-3xl">
            ยอดขายรวมของ <mark className="bg-pencil-soft dark:bg-pencil/25 dark:text-gray-100">ร้านค้า B</mark> สูงกว่าค่ามัธยฐานของทุกร้านอยู่{" "}
            <mark className="bg-pencil-soft dark:bg-pencil/25 dark:text-gray-100">34.2%</mark> แต่ข้อมูลช่วง 15–22 มีนาคมขาดไป 6 วัน
            ตัวเลขนี้จึงยังสรุปเป็นแนวโน้มไม่ได้ แนะนำให้เติมข้อมูลช่วงที่ขาดก่อน
          </blockquote>
          <p className="num mt-5 text-[12px] text-gray-500 dark:text-gray-400">
            อ้างอิง: แถว 1,204–1,661 · คอลัมน์ ยอดขาย, วันที่ · ตัดออก 41 แถว
          </p>
        </div>
      </Section>

      <Section entry="รายการ 004 — เริ่มใช้งาน" title="เอาไฟล์ที่คุณกลัวจะเปิดมาก่อนเลย"
        lead="ไฟล์แรกวิเคราะห์ฟรี ไม่ต้องจัดระเบียบมาก่อน ไม่ต้องผูกบัตร">
        <div className="mt-8 flex flex-wrap gap-3">
          <NavLink to="/" className="px-6 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-colors">
            อัปโหลดไฟล์แรก
          </NavLink>
          <NavLink to="/auth" className="px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 font-medium transition-colors">
            เข้าสู่ระบบ
          </NavLink>
        </div>
      </Section>
    </div>
  );
}

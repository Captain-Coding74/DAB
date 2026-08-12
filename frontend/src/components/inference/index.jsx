import React, { useState, useEffect } from "react";
import { Card, Eyebrow, Button, Skeleton } from "../ui";
import { postJSON, getJSON } from "../../lib/api";

/**
 * InferencePanel — the statistics a thesis defence actually asks for.
 *
 * DAB could describe a dataset but not answer "is this difference real?".
 * This runs t-tests, ANOVA, chi-square, correlation, regression and
 * Cronbach's alpha against a stored dataset.
 *
 * DESIGN NOTE (from the Figma exploration): the VERDICT is the hero, not the
 * statistic. A thesis student needs the sentence first — "แตกต่างอย่างมี
 * นัยสำคัญ" — and the t/df/p table underneath for the appendix. Leading with
 * "t = -3.42" is how statistics software loses people who were never taught
 * statistics, which is exactly this product's audience.
 *
 * ADR-0001: every number here comes from services/inference.js, computed
 * deterministically. The AI is not involved and the footer says so.
 */

const TESTS = [
  { id: "t-test",      th: "เปรียบเทียบ 2 กลุ่ม · t-test",   needs: ["value", "group"] },
  { id: "anova",       th: "3 กลุ่มขึ้นไป · ANOVA",          needs: ["value", "group"] },
  { id: "chi-square",  th: "หมวดหมู่ · Chi-square",          needs: ["cat2"] },
  { id: "correlation", th: "สหสัมพันธ์ · Pearson r",         needs: ["xy"] },
  { id: "regression",  th: "ถดถอย · Regression",             needs: ["xy"] },
  { id: "cronbach",    th: "ความเชื่อมั่น · Cronbach α",      needs: ["items"] },
];

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex-1 min-w-[160px]">
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">{label}</span>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg text-sm bg-gray-50 dark:bg-gray-950
                   border border-gray-200 dark:border-gray-800 focus:border-brand-400 outline-none"
      >
        <option value="">— เลือก —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/** The result card. Verdict first, numbers second, provenance last. */
function Result({ r }) {
  if (r.error) {
    return (
      <Card>
        <Eyebrow>ทำการทดสอบไม่ได้</Eyebrow>
        <p className="mt-2 text-sm text-rule dark:text-rule-dark">{r.error}</p>
        {r.errorEn && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{r.errorEn}</p>}
      </Card>
    );
  }

  // Cronbach reads differently from the hypothesis tests — one number and a band.
  if (r.test === "cronbach-alpha") {
    return (
      <Card>
        <Eyebrow>ความเชื่อมั่นแบบสอบถาม · CRONBACH'S ALPHA</Eyebrow>
        <div className="mt-3 flex items-center gap-5 flex-wrap">
          <span className={`num text-4xl font-semibold ${r.acceptable ? "text-stamp dark:text-stamp-dark" : "text-pencil dark:text-pencil-dark"}`}>
            α = {r.alpha.toFixed(3)}
          </span>
          <div className="flex-1 min-w-[220px]">
            <p className="text-lg font-semibold">ความเชื่อมั่นระดับ “{r.interpretationTh}”</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              แบบสอบถาม {r.nItems} ข้อ · ผู้ตอบ {r.nRespondents} คน
              {r.acceptable ? " · เกิน 0.70 ใช้อ้างอิงในวิทยานิพนธ์ได้" : ""}
            </p>
            {r.noteTh && <p className="mt-1 text-sm text-pencil dark:text-pencil-dark">{r.noteTh}</p>}
          </div>
        </div>
        <p className="num mt-4 text-[11px] text-gray-500 dark:text-gray-400">คำนวณแบบตายตัว ไม่ใช้ AI</p>
      </Card>
    );
  }

  const sig = r.significant;
  const cells = [
    r.t != null && ["t", Number.isFinite(r.t) ? r.t.toFixed(2) : "∞"],
    r.f != null && ["F", Number.isFinite(r.f) ? r.f.toFixed(2) : "∞"],
    r.chi2 != null && ["χ²", r.chi2.toFixed(2)],
    r.r != null && ["r", r.r.toFixed(3)],
    r.slope != null && ["slope", r.slope.toFixed(3)],
    r.r2 != null && ["R²", r.r2.toFixed(3)],
    r.df != null && ["df", typeof r.df === "number" ? r.df.toFixed(1) : r.df],
    r.p != null && ["p", r.p < 0.001 ? "< 0.001" : r.p.toFixed(3)],
    r.cohensD != null && ["Cohen's d", r.cohensD.toFixed(2)],
    r.cramersV != null && ["Cramér's V", r.cramersV.toFixed(3)],
    r.n != null && ["n", String(r.n)],
  ].filter(Boolean);

  return (
    <Card className={sig ? "!border-2 !border-stamp dark:!border-stamp-dark" : ""}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`num text-xs font-semibold px-3 py-1.5 rounded border
          ${sig ? "bg-stamp/10 border-stamp text-stamp dark:text-stamp-dark"
                : "bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400"}`}>
          {r.p < 0.001 ? "p < 0.001" : `p = ${r.p?.toFixed(3)}`} {r.stars}
        </span>
        <h3 className="text-xl font-bold">
          {sig ? "แตกต่างอย่างมีนัยสำคัญ" : "ไม่พบความแตกต่างที่มีนัยสำคัญ"}
        </h3>
      </div>

      <p className="mt-3 text-[15px] leading-relaxed">{plainThai(r)}</p>

      {r.warning && (
        <p className="mt-2 text-sm text-pencil dark:text-pencil-dark">⚠ {r.warning}</p>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 flex flex-wrap gap-y-3">
        {cells.map(([k, v]) => (
          <div key={k} className="flex-1 min-w-[90px]">
            <div className="eyebrow">{k}</div>
            <div className="num text-xl font-semibold text-brand-500 mt-1">{v}</div>
          </div>
        ))}
      </div>

      <p className="num mt-4 text-[11px] text-gray-500 dark:text-gray-400">
        คำนวณแบบตายตัว ไม่ใช้ AI{r.variant ? ` · ${r.variant}'s ${r.test}` : ` · ${r.test}`}
      </p>
    </Card>
  );
}

/** One sentence a thesis student can paste into a defence, in Thai. */
function plainThai(r) {
  const p = r.p < 0.001 ? "p < 0.001" : `p = ${r.p?.toFixed(3)}`;
  switch (r.test) {
    case "independent-t": {
      const [hi, lo] = r.meanA >= r.meanB ? [r.groupNames?.[0], r.groupNames?.[1]] : [r.groupNames?.[1], r.groupNames?.[0]];
      return r.significant
        ? `ค่าเฉลี่ยของกลุ่ม ${hi ?? "A"} สูงกว่ากลุ่ม ${lo ?? "B"} อย่างมีนัยสำคัญทางสถิติ (${p}) ขนาดของความต่างอยู่ในระดับ${r.effectSizeTh} — ความต่างนี้ไม่น่าเกิดจากความบังเอิญ`
        : `ค่าเฉลี่ยของสองกลุ่มไม่ต่างกันอย่างมีนัยสำคัญ (${p}) — ข้อมูลเท่าที่มียังสรุปไม่ได้ว่าต่างกันจริง`;
    }
    case "paired-t":
      return r.significant
        ? `ค่าเฉลี่ยเปลี่ยนไป ${r.meanDiff.toFixed(2)} อย่างมีนัยสำคัญ (${p}) จากผู้เข้าร่วม ${r.n} คน`
        : `ค่าเฉลี่ยเปลี่ยนไป ${r.meanDiff.toFixed(2)} แต่ยังไม่มีนัยสำคัญทางสถิติ (${p})`;
    case "one-way-anova":
      return r.significant
        ? `มีอย่างน้อยหนึ่งกลุ่มที่ต่างจากกลุ่มอื่นอย่างมีนัยสำคัญ (${p}) ความต่างระหว่างกลุ่มอธิบายความแปรปรวนได้ ${(r.etaSquared * 100).toFixed(1)}%`
        : `ทุกกลุ่มมีค่าเฉลี่ยใกล้เคียงกัน ไม่พบความต่างที่มีนัยสำคัญ (${p})`;
    case "chi-square":
      return r.significant
        ? `สองตัวแปรนี้มีความสัมพันธ์กันอย่างมีนัยสำคัญ (${p}) ไม่ได้เป็นอิสระต่อกัน`
        : `ไม่พบความสัมพันธ์ระหว่างสองตัวแปรนี้ (${p}) ถือว่าเป็นอิสระต่อกัน`;
    case "pearson":
      return r.significant
        ? `ตัวแปรทั้งสองสัมพันธ์กันใน${r.directionTh} ระดับ${r.strengthTh} (r = ${r.r.toFixed(3)}, ${p})`
        : `ไม่พบความสัมพันธ์ที่มีนัยสำคัญ (r = ${r.r?.toFixed(3)}, ${p})`;
    case "linear-regression":
      return r.significant
        ? `เมื่อ x เพิ่มขึ้น 1 หน่วย y เปลี่ยนไป ${r.slope.toFixed(3)} หน่วย โดยเฉลี่ย (${p}) สมการอธิบายข้อมูลได้ ${(r.r2 * 100).toFixed(1)}%`
        : `ความสัมพันธ์เชิงเส้นยังไม่มีนัยสำคัญ (${p})`;
    default:
      return "";
  }
}

export function InferencePanel({ datasetId }) {
  const [meta, setMeta] = useState(null);
  const [test, setTest] = useState("t-test");
  const [cols, setCols] = useState({});
  const [items, setItems] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!datasetId) return;
    getJSON(`/api/inference/${datasetId}/available`).then(setMeta).catch(() => setMeta(null));
  }, [datasetId]);

  const numeric = meta?.numericColumns ?? [];
  const categorical = meta?.categoricalColumns ?? [];
  const needs = TESTS.find((t) => t.id === test)?.needs ?? [];

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const body = { test, ...cols, ...(test === "cronbach" ? { itemColumns: items } : {}) };
      setResult(await postJSON(`/api/inference/${datasetId}`, body));
    } catch (e) {
      setErr(e.message || "ทำการทดสอบไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  if (!meta) return <Skeleton className="h-48"/>;

  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>สถิติเชิงอนุมาน · INFERENTIAL STATISTICS</Eyebrow>
        <h2 className="mt-1 text-2xl font-bold">ข้อมูลนี้ต่างกันจริงหรือบังเอิญ?</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          ทุกค่าคำนวณแบบตายตัว ไม่ได้ใช้ AI — รันกี่ครั้งก็ได้ผลเดิม
        </p>
      </div>

      <Card>
        <Eyebrow>เลือกการทดสอบ</Eyebrow>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {TESTS.map((t) => {
            const available = meta.tests?.find((m) => m.id === t.id)?.available ?? true;
            const on = test === t.id;
            return (
              <button
                key={t.id}
                disabled={!available}
                aria-pressed={on}
                onClick={() => { setTest(t.id); setResult(null); setCols({}); setItems([]); }}
                className={`text-[13px] px-3.5 py-2 rounded-lg border transition-colors
                  ${on ? "bg-brand-400 border-brand-400 text-gray-950 font-semibold"
                       : "bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800 hover:border-brand-300"}
                  ${available ? "" : "opacity-40 cursor-not-allowed"}`}
              >
                {t.th}
              </button>
            );
          })}
        </div>
        {meta.tests?.find((m) => m.id === test && !m.available) && (
          <p className="mt-3 text-sm text-pencil dark:text-pencil-dark">
            ชุดข้อมูลนี้ยังไม่มีคอลัมน์ที่เหมาะกับการทดสอบนี้ ({meta.tests.find((m) => m.id === test)?.needs})
          </p>
        )}
      </Card>

      <Card>
        <Eyebrow>เลือกคอลัมน์</Eyebrow>
        <div className="mt-3 flex flex-wrap gap-3.5">
          {needs.includes("value") && (
            <Select label="ค่าที่วัด (ตัวเลข)" value={cols.valueColumn}
                    onChange={(v) => setCols({ ...cols, valueColumn: v })} options={numeric}/>
          )}
          {needs.includes("group") && (
            <Select label={test === "t-test" ? "กลุ่ม (ต้องมี 2 ค่า)" : "กลุ่ม"} value={cols.groupColumn}
                    onChange={(v) => setCols({ ...cols, groupColumn: v })} options={categorical}/>
          )}
          {needs.includes("cat2") && (<>
            <Select label="ตัวแปรที่ 1" value={cols.xColumn}
                    onChange={(v) => setCols({ ...cols, xColumn: v })} options={categorical}/>
            <Select label="ตัวแปรที่ 2" value={cols.yColumn}
                    onChange={(v) => setCols({ ...cols, yColumn: v })} options={categorical}/>
          </>)}
          {needs.includes("xy") && (<>
            <Select label="ตัวแปร x" value={cols.xColumn}
                    onChange={(v) => setCols({ ...cols, xColumn: v })} options={numeric}/>
            <Select label="ตัวแปร y" value={cols.yColumn}
                    onChange={(v) => setCols({ ...cols, yColumn: v })} options={numeric}/>
          </>)}
          {needs.includes("items") && (
            <div className="w-full">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                ข้อคำถาม (เลือกอย่างน้อย 2 ข้อ) — เลือกแล้ว {items.length}
              </span>
              <div className="flex flex-wrap gap-2">
                {numeric.map((c) => {
                  const on = items.includes(c);
                  return (
                    <button key={c} aria-pressed={on}
                      onClick={() => setItems(on ? items.filter((i) => i !== c) : [...items, c])}
                      className={`text-xs px-2.5 py-1.5 rounded border transition-colors
                        ${on ? "bg-stamp/15 border-stamp text-stamp dark:text-stamp-dark"
                             : "bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800"}`}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Button className="w-full mt-4" onClick={run} loading={busy}
                disabled={busy || (needs.includes("items") ? items.length < 2 : Object.keys(cols).length === 0)}>
          รันการทดสอบ
        </Button>
      </Card>

      {err && (
        <Card><p className="text-sm text-rule dark:text-rule-dark">{err}</p></Card>
      )}
      {result && <Result r={result}/>}
    </div>
  );
}

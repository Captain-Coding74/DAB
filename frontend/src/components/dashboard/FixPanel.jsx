/**
 * FixPanel — แก้ไขข้อมูล (the fixes engine finally gets a UI).
 *
 * The backend has had a full fix pipeline since v21.3 (routes/fixes.js):
 * suggest → preview → apply, plus a free-text AI edit with a cell-level diff.
 * Nothing in the frontend ever called it. This panel is that missing half,
 * and it keeps the backend's contract visible in the UI:
 *
 *   • NOTHING auto-applies. Every path is  click → preview → explicit ยืนยัน.
 *   • Apply writes a NEW dataset version — the original stays selectable, so
 *     the toast tells the user to วิเคราะห์ใหม่ rather than mutating state here.
 *   • The model is only ever called on an explicit click (suggest / AI edit);
 *     no effect in this file talks to the network.
 *   • Protected (PDPA) columns never reach the model — the backend strips
 *     them; this panel just says so out loud (the 🔒 line).
 */
import React, { useState } from "react";
import { Card, Eyebrow, Badge, Button, Textarea } from "../ui";
import { postJSON } from "../../lib/api";
import { useAppStore } from "../../store";

/* Mirrors OPERATIONS in backend/src/services/dataFixes.js — Thai labels for
   the ops a suggestion can name, kept here so rendering costs no extra
   round-trip to /api/fixes/catalogue. An op this map doesn't know (a future
   catalogue addition) falls back to its raw id instead of breaking. */
const OP_TH = {
  "drop-missing":     "ลบแถวที่มีค่าว่างในคอลัมน์ที่เลือก",
  "drop-outliers":    "ลบค่าผิดปกติ (1.5 × IQR)",
  "drop-duplicates":  "ลบแถวที่ซ้ำกันทั้งหมด",
  "merge-categories": "รวมค่าที่สะกดต่างกันให้เป็นค่าเดียว",
  "trim-whitespace":  "ตัดช่องว่างหน้า-หลังในทุกช่อง",
};

/* Mirrors MAX_AI_EDIT_ROWS in backend/src/services/aiEdit.js — shown up
   front so users with a big file learn the limit before spending a click.
   The server still enforces the real value and its error names it. */
const MAX_AI_EDIT_ROWS = 300;

/* Diff table shows this many changes at most — a 300-row edit can touch
   thousands of cells and the point of the table is review, not scroll. */
const DIFF_LIMIT = 50;

const SEV_BADGE = { high: "red", medium: "yellow", low: "gray" };

/* Success toasts share one message shape: what happened + what to do next.
   The panel never refreshes the analysis itself — the new version only shows
   up after the user re-analyzes, and pretending otherwise would lie. */
const APPLIED_TOAST = 'สร้างเวอร์ชันใหม่แล้ว ✓ ไฟล์เดิมยังอยู่ครบ — กด "วิเคราะห์ไฟล์" อีกครั้งเพื่อเห็นผล';

/** Render a cell value; an empty string shows as a visible "ว่าง" chip. */
function CellVal({ v }) {
  return v === "" || v == null
    ? <span className="text-gray-300 dark:text-gray-600 italic">ว่าง</span>
    : <>{String(v)}</>;
}

export function FixPanel({ datasetId }) {
  const toast = useAppStore((s) => s.toast);

  // ── ข้อเสนอการแก้ไข (suggest → preview → apply) ─────────
  const [sug, setSug]         = useState(null);   // { list, source } after fetch
  const [sugBusy, setSugBusy] = useState(false);
  const [pv, setPv]           = useState({});     // idx -> { busy, data, applying, applied }
  const patchPv = (i, patch) => setPv((p) => ({ ...p, [i]: { ...p[i], ...patch } }));

  // ── สั่ง AI แก้ไขอิสระ (ai-edit → review diff → apply) ──
  const [inst, setInst]             = useState("");
  const [aiBusy, setAiBusy]         = useState(false);
  const [ai, setAi]                 = useState(null); // the /ai-edit preview response
  const [aiApplying, setAiApplying] = useState(false);

  /* Same gate as the สถิติ tab: fixes read/write the STORED dataset, and an
     anonymous analysis never stored one. One line, same phrasing family. */
  if (!datasetId) {
    return (
      <Card>
        <p className="text-sm text-gray-500 dark:text-gray-400 margin-rule">
          การแก้ไขข้อมูลต้องใช้ชุดข้อมูลที่บันทึกไว้ — เข้าสู่ระบบแล้ววิเคราะห์ไฟล์อีกครั้ง ระบบจะบันทึกชุดข้อมูลให้อัตโนมัติ
        </p>
      </Card>
    );
  }

  async function fetchSuggestions() {
    setSugBusy(true);
    try {
      const d = await postJSON(`/api/fixes/${datasetId}/suggest`, {});
      setSug({ list: d.suggestions || [], source: d.source });
      setPv({});
    } catch (e) { toast(e.message || "ขอข้อเสนอไม่สำเร็จ", "error"); }
    finally { setSugBusy(false); }
  }

  async function previewFix(i, s) {
    patchPv(i, { busy: true });
    try {
      const d = await postJSON(`/api/fixes/${datasetId}/preview`, { op: s.op, params: s.params });
      patchPv(i, { busy: false, data: d });
    } catch (e) {
      patchPv(i, { busy: false });
      toast(e.message || "ดูตัวอย่างไม่สำเร็จ", "error");
    }
  }

  async function applySuggestion(i, s) {
    patchPv(i, { applying: true });
    try {
      await postJSON(`/api/fixes/${datasetId}/apply`, { op: s.op, params: s.params });
      patchPv(i, { applying: false, applied: true });
      toast(APPLIED_TOAST, "success", { duration: 6000 });
    } catch (e) {
      patchPv(i, { applying: false });
      toast(e.message || "ยืนยันการแก้ไขไม่สำเร็จ", "error");
    }
  }

  async function runAiEdit() {
    setAiBusy(true);
    setAi(null);
    try {
      const d = await postJSON(`/api/fixes/${datasetId}/ai-edit`, { instruction: inst.trim() });
      setAi(d);
    } catch (e) { toast(e.message || "เรียก AI ไม่สำเร็จ", "error"); }
    finally { setAiBusy(false); }
  }

  async function applyAiEdit() {
    setAiApplying(true);
    try {
      const d = await postJSON(`/api/fixes/${datasetId}/ai-edit/apply`, {
        rows: ai.rows, instruction: ai.instruction,
      });
      setAi(null);
      setInst("");
      toast(`บันทึก ${d.changeCount} ช่องเป็นเวอร์ชันใหม่แล้ว ✓ กด "วิเคราะห์ไฟล์" อีกครั้งเพื่อเห็นผล`, "success", { duration: 6000 });
    } catch (e) { toast(e.message || "ยืนยันการแก้ไขไม่สำเร็จ", "error"); }
    finally { setAiApplying(false); }
  }

  /* /ai-edit succeeds with sensitiveColumns (header strings); its PDPA
     refusals carry protectedColumns ({col, kind}). Fold both to names. */
  const lockedCols = (ai?.sensitiveColumns || ai?.protectedColumns || [])
    .map((c) => (typeof c === "string" ? c : c?.col)).filter(Boolean);

  return (
    <>
      {/* ── 1 · ข้อเสนอการแก้ไข ─────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <Eyebrow>ข้อเสนอการแก้ไข · SUGGESTED FIXES</Eyebrow>
          {sug && (
            <Badge variant={sug.source === "ai" ? "green" : "gray"}>
              {sug.source === "ai" ? "เสนอโดย AI · ตรวจสอบแล้ว" : "จากกฎสถิติ · ไม่ใช้ AI"}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          ไม่มีอะไรถูกแก้อัตโนมัติ — ทุกรายการต้องดูตัวอย่างแล้วกดยืนยันเอง
          การยืนยันจะสร้างเวอร์ชันใหม่ ไฟล์เดิมยังอยู่ครบเสมอ
        </p>

        {sug === null && (
          <Button size="sm" onClick={fetchSuggestions} loading={sugBusy}>
            ขอข้อเสนอการแก้ไข
          </Button>
        )}

        {sug?.list.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            ไม่มีข้อเสนอ — ข้อมูลชุดนี้ดูสะอาดดีแล้ว ✓
          </p>
        )}

        {sug?.list.length > 0 && (
          <div className="-my-1.5">
            {sug.list.map((s, i) => {
              const p = pv[i] || {};
              const noop = p.data && p.data.removed === 0 && p.data.changed === 0;
              return (
                <div key={i} className="border-t border-gray-100 dark:border-gray-800 first:border-0 py-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={SEV_BADGE[s.severity] || "gray"}>{(s.severity || "medium").toUpperCase()}</Badge>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{OP_TH[s.op] || s.op}</span>
                        {s.params?.column && (
                          <span className="num text-[11px] text-gray-500 dark:text-gray-400">· “{s.params.column}”</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                        {s.reasonTh || s.reasonEn}
                      </p>
                    </div>
                    {p.applied
                      ? <Badge variant="green">สร้างเวอร์ชันใหม่แล้ว ✓</Badge>
                      : <Button variant="secondary" size="sm" onClick={() => previewFix(i, s)} loading={p.busy}>
                          ดูตัวอย่าง
                        </Button>}
                  </div>

                  {p.data && !p.applied && (
                    <div className="mt-2.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-950 space-y-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                        <span>แถว <b className="num">{p.data.rowsBefore?.toLocaleString()}</b> → <b className="num">{p.data.rowsAfter?.toLocaleString()}</b></span>
                        <span className={p.data.removed ? "text-rule dark:text-rule-dark" : "text-gray-400 dark:text-gray-500"}>
                          ลบ <b className="num">{p.data.removed}</b> แถว
                        </span>
                        <span className={p.data.changed ? "text-pencil dark:text-pencil-dark" : "text-gray-400 dark:text-gray-500"}>
                          แก้ <b className="num">{p.data.changed}</b> ช่อง
                        </span>
                      </div>
                      {p.data.logTh && <p className="text-[11px] text-gray-500 dark:text-gray-400">{p.data.logTh}</p>}
                      {noop
                        ? <p className="text-[11px] text-gray-400 dark:text-gray-500">ไม่มีอะไรเปลี่ยนแปลง — ไม่จำเป็นต้องแก้รายการนี้</p>
                        : <Button size="sm" onClick={() => applySuggestion(i, s)} loading={p.applying}>
                            ยืนยันการแก้ไข — สร้างเวอร์ชันใหม่
                          </Button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── 2 · สั่ง AI แก้ไขอิสระ ───────────────────────── */}
      <Card>
        <Eyebrow className="mb-1">สั่ง AI แก้ไขอิสระ · AI EDIT</Eyebrow>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          พิมพ์คำสั่ง แล้ว AI จะเสนอการแก้ทีละช่องให้ตรวจก่อนยืนยัน (สูงสุด {MAX_AI_EDIT_ROWS} แถว) —
          คอลัมน์ข้อมูลส่วนบุคคลไม่ถูกส่งเข้า AI
        </p>
        <Textarea
          value={inst}
          onChange={(e) => setInst(e.target.value)}
          placeholder={'เช่น แปลงคอลัมน์วันที่ให้เป็นรูปแบบ YYYY-MM-DD ทั้งหมด'}
          className="h-20"
        />
        <Button className="mt-3" size="sm" onClick={runAiEdit} loading={aiBusy} disabled={inst.trim().length < 3}>
          ให้ AI เสนอการแก้ไข
        </Button>

        {ai && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Eyebrow>รายการเปลี่ยนแปลงที่เสนอ</Eyebrow>
              <span className="num text-[10px] text-gray-400 dark:text-gray-500">
                {ai.changeCount} ช่อง{ai.changeCount > DIFF_LIMIT ? ` · แสดง ${DIFF_LIMIT} รายการแรก` : ""}
              </span>
            </div>

            {ai.warningTh && (
              <p className="text-[11px] text-pencil dark:text-pencil-dark">⚠ {ai.warningTh}</p>
            )}
            {lockedCols.length > 0 && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                🔒 คอลัมน์ที่ถูกป้องกัน ไม่ส่งเข้า AI: {lockedCols.join(", ")}
              </p>
            )}

            {ai.changeCount === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                AI ไม่พบช่องที่ต้องแก้ตามคำสั่งนี้ — ลองระบุให้เจาะจงขึ้น
              </p>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto scrollbar-hide">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-eyebrow text-gray-400 dark:text-gray-500 sticky top-0 bg-white dark:bg-gray-900">
                        <th className="py-1.5 pr-2">แถว</th>
                        <th className="py-1.5 pr-2">คอลัมน์</th>
                        <th className="py-1.5 pr-2">เดิม</th>
                        <th className="py-1.5 pr-1" aria-hidden="true"></th>
                        <th className="py-1.5 pr-2">ใหม่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ai.changes.slice(0, DIFF_LIMIT).map((c, i) => (
                        <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="num py-1 pr-2 text-gray-500 dark:text-gray-400">{c.row}</td>
                          <td className="py-1 pr-2 text-gray-700 dark:text-gray-300">{c.column}</td>
                          <td className="py-1 pr-2 text-rule dark:text-rule-dark"><CellVal v={c.before}/></td>
                          <td className="py-1 pr-1 text-gray-400 dark:text-gray-500" aria-hidden="true">→</td>
                          <td className="py-1 pr-2 font-medium text-stamp dark:text-stamp-dark"><CellVal v={c.after}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button size="sm" onClick={applyAiEdit} loading={aiApplying}>
                  ยืนยันการแก้ไข — สร้างเวอร์ชันใหม่
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

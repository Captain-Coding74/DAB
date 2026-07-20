/**
 * components/dashboard/AgentPanel.jsx — v12 Intelligence UI
 * A "deep dive" box: ask a hard question, watch which statistical checks
 * the agent ran (its trail), then read the grounded answer.
 */
import React, { useState } from "react";
import { Search } from "lucide-react";
import { Card, Button, Eyebrow, WaveBars } from "../ui";
import { postJSON } from "../../lib/api";

const TOOL_LABEL = {
  list_columns:      "สำรวจคอลัมน์ทั้งหมด",
  get_column_detail: "ดูสถิติคอลัมน์",
  get_correlations:  "ตรวจสหสัมพันธ์",
  get_forecasts:     "ตรวจแนวโน้ม/พยากรณ์",
};

const EXAMPLES = [
  "คอลัมน์ไหนน่ากังวลที่สุด เพราะอะไร",
  "ตัวแปรอะไรทำนายยอดขายได้ดีสุด",
  "มีสัญญาณผิดปกติอะไรที่ควรรีบดู",
];

export function AgentPanel({ analysisId }) {
  const [q, setQ]           = useState("");
  const [loading, setLoad]  = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState("");

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || loading) return;
    setLoad(true); setError(""); setResult(null); setQ(text);
    try {
      const data = await postJSON(`/api/analyses/${analysisId}/agent`, { question: text });
      setResult(data);
    } catch (err) { setError(err.message || "เกิดข้อผิดพลาด"); }
    finally { setLoad(false); }
  };

  return (
    <Card title="เจาะลึกด้วย AI Agent" meta="tool-verified">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
        ถามคำถามยาก ๆ — agent จะเรียกดูสถิติจริงก่อนตอบ แล้วแสดงให้เห็นว่าตรวจอะไรไปบ้าง
      </p>

      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && ask()}
          placeholder="เช่น คอลัมน์ไหนน่ากังวลที่สุด?"
          aria-label="คำถามเจาะลึก"
          className="flex-1 text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder:text-gray-300 dark:placeholder:text-gray-600"/>
        <Button onClick={() => ask()} loading={loading} disabled={!q.trim()}>
          <Search size={14}/> เจาะลึก
        </Button>
      </div>

      {!result && !loading && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => ask(ex)}
              className="font-mono text-[11px] px-2.5 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors">
              ▸ {ex}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <WaveBars/> กำลังตรวจสถิติ…
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rule dark:text-rule-dark margin-rule">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3">
          {result.steps?.length > 0 && (
            <div>
              <Eyebrow className="mb-1.5">ตรวจแล้ว {result.steps.length} ขั้น</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {result.steps.map((s, i) => (
                  <span key={i} className="num text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                    {i + 1}. {TOOL_LABEL[s.tool] || s.tool}{s.input?.column ? ` (${s.input.column})` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="text-sm text-gray-800 dark:text-gray-200 leading-7 whitespace-pre-wrap border-t border-gray-100 dark:border-gray-800 pt-3 margin-rule">
            {result.reply}
          </p>
        </div>
      )}
    </Card>
  );
}

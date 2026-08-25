/**
 * ClassReport — ทำเนียบห้องเรียน (School Edition, deterministic).
 *
 * The first questions a teacher asks are not hypothesis tests: ใครได้มากสุด
 * ใครยังตามไม่ทัน ใครได้เกียรติบัตร. The backend computes this from every row
 * (services/classReport.js) and it never touches the AI; this component only
 * renders it. Student ids and nicknames are visible by design — this is the
 * teacher's own view (PDPA non-strict tier); citizen ids never reach it.
 */
import React from "react";
import { Card, Eyebrow, Badge } from "../ui";

const num = (v) => (v == null ? "—" : Number(v).toLocaleString());

export function ClassReportCard({ report }) {
  if (!report?.students?.length) return null;
  const r = report;
  const medianRank = r.students.find((s) => s.total === r.median)?.rank;
  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <Eyebrow>ทำเนียบห้องเรียน · CLASS REPORT</Eyebrow>
        <Badge variant="green">คำนวณจากทุกแถว · ไม่ใช้ AI</Badge>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
        รวมจากคอลัมน์คะแนน: {r.scoreCols.join(" + ")} · คะแนนเต็มโดยประมาณ {r.fullMarks}
        {r.gradeCol ? ` · เกียรติบัตรตามคอลัมน์ "${r.gradeCol}" = 4.00` : " · เกียรติบัตรเมื่อได้ ≥ 80% (เทียบเท่าเกรด 4)"}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          ["สูงสุด",   num(r.max),    "🥇"],
          ["มัธยฐาน",  num(r.median), "⚖️"],
          ["ต่ำสุด",   num(r.min),    "🪫"],
          ["เกียรติบัตร", `${r.honorCount} คน`, "🏆"],
        ].map(([label, val, icon]) => (
          <div key={label} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-950 text-center">
            <div className="text-[10px] uppercase tracking-eyebrow text-gray-400 dark:text-gray-500">{icon} {label}</div>
            <div className="num text-lg font-semibold text-gray-800 dark:text-gray-100">{val}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto max-h-[420px] overflow-y-auto scrollbar-hide">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-eyebrow text-gray-400 dark:text-gray-500 sticky top-0 bg-white dark:bg-gray-900">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">{r.idCol}</th>
              {r.nameCols?.map((c) => <th key={c} className="py-1.5 pr-2">{c}</th>)}
              <th className="py-1.5 pr-2 text-right">รวม</th>
              <th className="py-1.5 pr-2 text-right">%</th>
              {r.checklist && <th className="py-1.5 pr-2 text-right">งานค้าง</th>}
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {r.students.map((s) => (
              <tr key={s.id}
                className={`border-t border-gray-100 dark:border-gray-800 ${
                  s.rank === 1 ? "bg-amber-50/60 dark:bg-amber-900/10" :
                  s.total === r.min ? "bg-red-50/50 dark:bg-red-900/10" :
                  s.rank === medianRank ? "bg-gray-50 dark:bg-gray-950" : ""}`}>
                <td className="num py-1 pr-2 text-gray-500 dark:text-gray-400">{s.rank}</td>
                <td className="num py-1 pr-2">{s.id}</td>
                {r.nameCols?.map((c, ni) => <td key={c} className="py-1 pr-2">{s.names?.[ni]}</td>)}
                <td className="num py-1 pr-2 text-right font-medium">{num(s.total)}{s.missing > 0 && <span className="text-amber-500" title={`ขาดคะแนน ${s.missing} ช่อง`}>*</span>}</td>
                <td className="num py-1 pr-2 text-right text-gray-500 dark:text-gray-400">{s.percent ?? "—"}</td>
                {r.checklist && <td className={`num py-1 pr-2 text-right ${s.missingWork > 0 ? "text-red-500 font-medium" : "text-gray-400 dark:text-gray-500"}`}>{s.missingWork > 0 ? s.missingWork : "✓"}</td>}
                <td className="py-1 text-right">{s.honor && <span title="ได้รับเกียรติบัตร">🏆</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* ช่องติ๊กส่งงาน: อัตราส่งต่อชิ้น + รายชื่อคนที่ยังไม่ส่ง — คำถามที่ครูถามบ่อยที่สุด */}
      {r.checklist && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex flex-wrap gap-2 mb-2">
            {r.checklist.rates.map((c) => (
              <span key={c.col} className={`text-[11px] px-2 py-1 rounded-lg ${c.pct >= 90 ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"}`}>
                📋 {c.col}: ส่งแล้ว <b className="num">{c.submitted}/{r.count}</b> ({c.pct}%)
              </span>
            ))}
          </div>
          {r.checklist.incomplete.length > 0 ? (
            <div className="text-[12px]">
              <span className="font-medium text-red-600 dark:text-red-400">ยังไม่ส่งงาน {r.checklist.incomplete.length} คน:</span>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto scrollbar-hide">
                {r.checklist.incomplete.map((s2) => (
                  <li key={s2.id} className="text-gray-600 dark:text-gray-300">
                    <span className="num">{s2.id}</span> {s2.names?.[0]} — ขาด: {s2.missingCols.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[12px] text-emerald-600 dark:text-emerald-400">🎉 ส่งครบทุกคนทุกชิ้น</p>
          )}
        </div>
      )}
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">* มีช่องคะแนนว่าง — นับเป็น 0 ในยอดรวม · มุมมองนี้แสดงเฉพาะบนเครื่องครู ไม่ส่งเข้า AI</p>
    </Card>
  );
}

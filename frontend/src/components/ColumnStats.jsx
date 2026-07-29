/**
 * ColumnStats — the per-column statistics list, shared by the dashboard's
 * insights tab and the public share page.
 *
 * Deliberately its OWN module: it renders Badge + Card markup and nothing
 * else. v20.6 briefly parked it inside components/charts, which welded it to
 * recharts — a static import chain then pulled the entire 143 kB (gzip)
 * chart library into the initial payload and tripped the 90 kB budget.
 * Location is load-bearing here; see frontend/perf-budget.json.
 */
import React from "react";
import { Badge, Card, Eyebrow } from "./ui";

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

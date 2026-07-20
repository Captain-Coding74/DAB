/**
 * components/dashboard/tabs-charts.jsx — v13
 *
 * The only two panels that touch recharts, split into their own chunk.
 * Measured reason: recharts was 112 kB gzip of a 195 kB initial payload
 * (56%) even though charts appear on two tabs the user may never open.
 * Loading it on demand is the single biggest first-paint win available.
 */
import React from "react";
import { Card, Badge, Eyebrow } from "../ui";
import { AutoChart, CorrelationHeatmap } from "../charts";

export function ChartsTab({ a }) {
  return (
    <Card>
      <Eyebrow className="mb-4">แผนภูมิ · Charts</Eyebrow>
      <AutoChart colAnalysis={a.colAnalysis} sampleRows={a.sampleRows || []} config={a.autoCharts?.[0]}/>
      {a.autoCharts?.length > 1 && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Recommended charts:</p>
          <div className="flex flex-wrap gap-2">
            {a.autoCharts.map((c, i) => <Badge key={i} variant={c.recommended ? "green" : "gray"}>{c.type} — {c.reason}</Badge>)}
          </div>
        </div>
      )}
    </Card>
  );
}

export function CorrelationTab({ a }) {
  return (
    <Card>
      <Eyebrow className="mb-4">ตารางสหสัมพันธ์ · Correlation</Eyebrow>
      {a.corr?.cols?.length >= 2 ? (
        <>
          <CorrelationHeatmap corr={a.corr}/>
          {a.corr.strong?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Strong correlations (|r| ≥ 0.7):</p>
              {a.corr.strong.map((s, i) => (
                <div key={i} className="text-xs text-gray-700 dark:text-gray-300 py-1">
                  <span className="num">{s.col1} ↔ {s.col2}:</span> <strong className={`num ${s.r>0?"text-brand-600 dark:text-brand-300":"text-rule dark:text-rule-dark"}`}>{s.r}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      ) : <p className="text-sm text-gray-400">Need ≥ 2 numeric columns</p>}
    </Card>
  );
}

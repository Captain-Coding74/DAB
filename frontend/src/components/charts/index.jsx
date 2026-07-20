import React, { useState } from "react";
import { useAppStore } from "../../store";
import { Download } from "lucide-react";

/* ── v11: chart export (SVG as-is; PNG via canvas at 2×) ── */
function exportChart(container, kind, dark) {
  const svg = container?.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("width", width); clone.setAttribute("height", height);
  const xml  = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });

  const save = (b, ext) => {
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url; a.download = `chart.${ext}`; a.click();
    URL.revokeObjectURL(url);
  };
  if (kind === "svg") return save(blob, "svg");

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * 2; canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = dark ? "#171C17" : "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(b => b && save(b, "png"), "image/png");
  };
  img.src = URL.createObjectURL(blob);
}

const brushProps = (dark, xKey) => ({
  dataKey: xKey, height: 18, travellerWidth: 8,
  stroke: dark ? "#4A5A4E" : "#8FB89A",
  fill: dark ? "#171C17" : "#F2F4EC",
});
import {
  Brush,
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ScatterChart, Scatter, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#2F6B4F","#B7791F","#3E5C76","#C13B27","#7A5C8F","#6E8B5E"];

function toChartData(headers, rows = []) {
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => { const v = parseFloat(r[i]); o[h] = isNaN(v) ? r[i] : v; });
    return o;
  });
}

const TYPES = ["Bar","Line","Area","Scatter","Pie"];

const tooltipStyle = (dark) => ({
  contentStyle: {
    borderRadius: 8, fontSize: 12,
    border: `1px solid ${dark ? "#374151" : "#e5e7eb"}`,
    background: dark ? "#111827" : "#fff",
    color: dark ? "#f3f4f6" : "#111827",
  },
  itemStyle: { padding: 0 },
});

export function AutoChart({ colAnalysis = [], sampleRows = [], config }) {
  const [chartType, setChartType] = useState(config?.type || "Bar");
  const dark = useAppStore(st => st.dark);
  const boxRef = React.useRef(null);

  const numCols = colAnalysis.filter(c => c.type === "numeric");
  const lblCol  = colAnalysis.find(c => c.type === "text") || colAnalysis[0];
  if (!numCols.length || !sampleRows.length) return (
    <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
      No numeric columns to chart
    </div>
  );

  const headers  = colAnalysis.map(c => c.col);
  const data     = toChartData(headers, sampleRows).slice(0, 12);
  const xKey     = lblCol?.col || headers[0];
  const yKeys    = numCols.slice(0, 3).map(c => c.col);

  const pieData  = data.map(d => ({ name: d[xKey], value: d[yKeys[0]] || 0 }));
  const axisProps = { tick: { fontSize: 10, fill: dark ? "#6b7280" : "#9ca3af" }, axisLine: false, tickLine: false };
  const gridProps = { strokeDasharray: "3 3", stroke: dark ? "#1f2937" : "#f3f4f6", vertical: false };

  const renderChart = () => {
    switch (chartType) {
      case "Line": return (
        <LineChart data={data}>
          <Brush {...brushProps(dark, xKey)}/>
          <CartesianGrid {...gridProps}/>
          <XAxis dataKey={xKey} {...axisProps}/>
          <YAxis {...axisProps} width={40}/>
          <Tooltip {...tooltipStyle(dark)}/>
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
          {yKeys.map((k,i)=><Line key={k} type="monotone" dataKey={k} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }}/>)}
        </LineChart>
      );
      case "Area": return (
        <AreaChart data={data}>
          <Brush {...brushProps(dark, xKey)}/>
          <defs>{yKeys.map((k,i)=><linearGradient key={k} id={`g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS[i]} stopOpacity={0.2}/><stop offset="95%" stopColor={COLORS[i]} stopOpacity={0}/></linearGradient>)}</defs>
          <CartesianGrid {...gridProps}/>
          <XAxis dataKey={xKey} {...axisProps}/>
          <YAxis {...axisProps} width={40}/>
          <Tooltip {...tooltipStyle(dark)}/>
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
          {yKeys.map((k,i)=><Area key={k} type="monotone" dataKey={k} stroke={COLORS[i]} strokeWidth={2} fill={`url(#g${i})`}/>)}
        </AreaChart>
      );
      case "Scatter": return (
        <ScatterChart>
          <CartesianGrid {...gridProps}/>
          <XAxis dataKey={yKeys[0]} name={yKeys[0]} {...axisProps}/>
          <YAxis dataKey={yKeys[1]||yKeys[0]} name={yKeys[1]||yKeys[0]} {...axisProps} width={40}/>
          <Tooltip {...tooltipStyle(dark)} cursor={{ strokeDasharray: "3 3" }}/>
          <Scatter data={data} fill={COLORS[0]} opacity={0.75}/>
        </ScatterChart>
      );
      case "Pie": return (
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
            {pieData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
          </Pie>
          <Tooltip {...tooltipStyle(dark)}/>
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
        </PieChart>
      );
      default: return (
        <BarChart data={data} barGap={2}>
          <Brush {...brushProps(dark, xKey)}/>
          <CartesianGrid {...gridProps}/>
          <XAxis dataKey={xKey} {...axisProps}/>
          <YAxis {...axisProps} width={40}/>
          <Tooltip {...tooltipStyle(dark)}/>
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }}/>
          {yKeys.map((k,i)=><Bar key={k} dataKey={k} fill={COLORS[i]} radius={[4,4,0,0]}/>)}
        </BarChart>
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Chart type:</span>
        {TYPES.map(t => (
          <button key={t} onClick={() => setChartType(t)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${chartType===t ? "bg-brand-50 dark:bg-brand-900/30 border-brand-300 text-brand-600 dark:text-brand-300" : "border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"}`}>
            {t}
          </button>
        ))}
        <span className="flex-1"/>
        <button onClick={() => exportChart(boxRef.current, "png", dark)} aria-label="ดาวน์โหลดกราฟเป็น PNG"
          className="font-mono text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition">
          <Download size={11}/> PNG
        </button>
        <button onClick={() => exportChart(boxRef.current, "svg", dark)} aria-label="ดาวน์โหลดกราฟเป็น SVG"
          className="font-mono text-[10px] flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 transition">
          <Download size={11}/> SVG
        </button>
      </div>
      <div ref={boxRef}>
        <ResponsiveContainer width="100%" height={220}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
      <p className="num text-[10px] text-gray-400 dark:text-gray-500">ลากแถบด้านล่างกราฟเพื่อซูมช่วงข้อมูล (Line / Area / Bar)</p>
    </div>
  );
}

// ── Correlation heatmap ───────────────────────────────────
export function CorrelationHeatmap({ corr }) {
  const dark = useAppStore(st => st.dark);
  if (!corr?.cols?.length) return null;
  const { cols, matrix } = corr;
  const color = r => {
    const a = Math.abs(r);
    if (r === 1)   return dark ? { bg: "#1f2937", text: "#9ca3af" } : { bg: "#f3f4f6", text: "#6b7280" };
    if (a >= 0.7)  return r > 0 ? { bg: "#2F6B4F", text: "#fff" } : { bg: "#C13B27", text: "#fff" };
    if (a >= 0.4)  return r > 0 ? { bg: "#C2D6BC", text: "#1F4834" } : { bg: "#EFC5BB", text: "#8F2A1B" };
    return dark ? { bg: "#111827", text: "#6b7280" } : { bg: "#f9fafb", text: "#9ca3af" };
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="w-20"/>
            {cols.map(c => <th key={c} className="p-1 text-gray-500 dark:text-gray-400 font-medium max-w-[60px] truncate" title={c}>{c.length > 8 ? c.slice(0,7)+"…" : c}</th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-gray-500 dark:text-gray-400 font-medium text-right max-w-[80px] truncate" title={cols[i]}>{cols[i].length > 10 ? cols[i].slice(0,9)+"…" : cols[i]}</td>
              {row.map((v, j) => {
                const { bg, text } = color(v);
                return <td key={j} className="p-1.5 text-center rounded font-medium" style={{ background: bg, color: text, minWidth: 44 }}>{i===j ? "1" : v.toFixed(2)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

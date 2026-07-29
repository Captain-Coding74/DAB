import React, { useState } from "react";
import { useAppStore } from "../../store";
import { Download } from "lucide-react";
import { chartTheme, SERIES, corrCell } from "../../lib/ledger";

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
    ctx.fillStyle = chartTheme(dark).canvas;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(b => b && save(b, "png"), "image/png");
  };
  img.src = URL.createObjectURL(blob);
}

const brushProps = (dark, xKey) => {
  const t = chartTheme(dark);
  return { dataKey: xKey, height: 18, travellerWidth: 8, stroke: t.brushLine, fill: t.brushFill };
};
import {
  Brush,
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ScatterChart, Scatter, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = SERIES;

function toChartData(headers, rows = []) {
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => { const v = parseFloat(r[i]); o[h] = isNaN(v) ? r[i] : v; });
    return o;
  });
}

const TYPES = ["Bar","Line","Area","Scatter","Pie"];

/* Raw values like 2100 read as codes; ๒,๑๐๐-style separators are what a Thai
   reader expects from a report. Non-numbers pass through untouched. */
const fmtNum = (v) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("th-TH", { maximumFractionDigits: 2 })
    : v;

const tooltipStyle = (dark) => {
  const t = chartTheme(dark);
  return {
    formatter: (v) => fmtNum(v),
    contentStyle: {
      borderRadius: 8, fontSize: 12,
      border: `1px solid ${t.border}`,
      background: t.surface,
      color: t.text,
    },
    itemStyle: { padding: 0 },
  };
};

export function AutoChart({ colAnalysis = [], sampleRows = [], config }) {
  const [chartType, setChartType] = useState(config?.type || "Bar");
  const dark = useAppStore(st => st.dark);
  const boxRef = React.useRef(null);

  // Shaped once per (colAnalysis, sampleRows) instead of every render —
  // parseFloat over every cell is the expensive part of this component.
  const { headers, data } = React.useMemo(() => {
    const hs = colAnalysis.map(c => c.col);
    return { headers: hs, data: toChartData(hs, sampleRows).slice(0, 12) };
  }, [colAnalysis, sampleRows]);

  const numCols = colAnalysis.filter(c => c.type === "numeric");
  const lblCol  = colAnalysis.find(c => c.type === "text") || colAnalysis[0];
  if (!numCols.length || !sampleRows.length) return (
    <div className="flex flex-col items-center justify-center h-40 gap-1.5 text-center px-6">
      <p className="text-sm text-gray-500 dark:text-gray-400">ไม่มีคอลัมน์ตัวเลขให้วาดกราฟ</p>
      <p className="eyebrow">ลองตรวจว่าคอลัมน์ตัวเลขถูกเก็บเป็นข้อความอยู่หรือเปล่า</p>
    </div>
  );


  const xKey     = lblCol?.col || headers[0];
  const yKeys    = numCols.slice(0, 3).map(c => c.col);

  // Pie holds meaning up to ~6 slices; past that, colours cycle and thin
  // slices become indistinguishable. Top 5 by value, remainder rolled up.
  const pieRows = data
    .map(d => ({ name: String(d[xKey]), value: Number(d[yKeys[0]]) || 0 }))
    .sort((a, b) => b.value - a.value);
  const pieData = pieRows.length <= 6
    ? pieRows
    : [...pieRows.slice(0, 5), { name: "อื่น ๆ", value: pieRows.slice(5).reduce((s, r) => s + r.value, 0) }];
  const theme     = chartTheme(dark);
  const axisProps = { tick: { fontSize: 10, fill: theme.axis }, axisLine: false, tickLine: false, tickFormatter: fmtNum };
  const gridProps = { strokeDasharray: "3 3", stroke: theme.grid, vertical: false };

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
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">ประเภทกราฟ:</span>
        {TYPES.map(t => (
          <button key={t} onClick={() => setChartType(t)} aria-pressed={chartType === t}
            className={`text-xs px-3 py-1.5 rounded-lg border transition ${chartType===t ? "bg-brand-50 dark:bg-brand-900/30 border-brand-300 text-brand-600 dark:text-brand-300" : "border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"}`}>
            {TYPE_LABELS[t]}
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
  const color = r => corrCell(r, dark);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <caption className="sr-only">ตารางค่าสหสัมพันธ์ระหว่างคอลัมน์</caption>
        <thead>
          <tr>
            <th scope="col" className="w-20"/>
            {cols.map(c => <th key={c} scope="col" className="p-1 text-gray-500 dark:text-gray-400 font-medium max-w-[60px] truncate" title={c}>{c.length > 8 ? c.slice(0,7)+"…" : c}</th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th scope="row" className="pr-2 text-gray-500 dark:text-gray-400 font-normal text-right max-w-[80px] truncate" title={cols[i]}>{cols[i].length > 10 ? cols[i].slice(0,9)+"…" : cols[i]}</th>
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

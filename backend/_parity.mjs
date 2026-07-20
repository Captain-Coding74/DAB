import ExcelJS from "exceljs";
import { parseFileStreaming } from "./src/services/streaming.js";

// Build an .xlsx in memory with mixed types: dates, numbers, a formula, blanks
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("S");
ws.addRow(["month","region","units","price","revenue"]);
const data = [
  ["2025-01","Bangkok",120,49,5880],
  ["2025-01","Chiangmai",40,49,1960],
  ["2025-02","Bangkok",135,49,6615],
  ["2025-02","Chiangmai",45,49,2205],
  ["2025-03","Bangkok",150,49,7350],
  ["2025-03","Chiangmai",null,49,null],   // missing
  ["2025-04","Bangkok",166,49,8134],
  ["2025-04","Bangkok",166,49,8134],       // duplicate
];
data.forEach(r => ws.addRow(r));
// a real date cell + a formula cell to exercise coercion
ws.getCell("A2").value = new Date("2025-01-15");
ws.getCell("F2").value = { formula: "C2*D2", result: 5880 };

const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

// Equivalent CSV (date normalized to YYYY-MM-DD, blanks empty)
const csv = "month,region,units,price,revenue\n" +
  "2025-01-15,Bangkok,120,49,5880\n2025-01,Chiangmai,40,49,1960\n2025-02,Bangkok,135,49,6615\n" +
  "2025-02,Chiangmai,45,49,2205\n2025-03,Bangkok,150,49,7350\n2025-03,Chiangmai,,49,\n" +
  "2025-04,Bangkok,166,49,8134\n2025-04,Bangkok,166,49,8134\n";

const xlsx = await parseFileStreaming(xlsxBuf, "t.xlsx");
const csvR = await parseFileStreaming(Buffer.from(csv), "t.csv");

const pick = (r) => ({ headers: r.headers, totalRows: r.totalRows, dupeCount: r.dupeCount,
  cols: r.colAnalysis.map(c => ({ col:c.col, type:c.type, missing:c.missing,
    ...(c.type==="numeric"?{avg:c.avg,min:c.min,max:c.max,median:c.median}:{unique:c.unique}) })) });

const a = JSON.stringify(pick(xlsx)); const b = JSON.stringify(pick(csvR));
console.log("XLSX rows:", xlsx.totalRows, "dupes:", xlsx.dupeCount, "cols:", xlsx.headers.join(","));
console.log("date coerced:", xlsx.sampleRows.flat().includes("2025-01-15") ? "YYYY-MM-DD ✓" : "?");
console.log("formula→result:", xlsx.colAnalysis.find(c=>c.col==="revenue")?.type === "numeric" ? "numeric ✓" : "?");
console.log(a === b ? "\n✅ PARITY: xlsx stats identical to csv" : "\n❌ MISMATCH:\n xlsx="+a+"\n csv ="+b);
process.exit(a === b ? 0 : 1);

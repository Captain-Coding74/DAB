/**
 * src/services/promptSuggestions.js — Smart prompt suggestions
 *
 * Analyses column types, names, and data patterns to suggest
 * the most useful questions for a given dataset.
 */

export function generatePromptSuggestions(colAnalysis, qualityScore) {
  const suggestions = [];
  const numeric = colAnalysis.filter(c => c.type === "numeric");
  const text    = colAnalysis.filter(c => c.type === "text");
  const cols    = colAnalysis.map(c => c.col.toLowerCase());

  // ── Always relevant ──────────────────────────────────
  suggestions.push({
    category: "overview",
    icon: "📊",
    prompt: "สรุปภาพรวมข้อมูลทั้งหมด และบอกว่าข้อมูลนี้เหมาะใช้วิเคราะห์อะไร",
    relevance: 100,
  });

  // ── Numeric specific ─────────────────────────────────
  if (numeric.length >= 1) {
    const topCol = numeric.sort((a,b)=>(b.sum||0)-(a.sum||0))[0].col;
    suggestions.push({
      category: "trend",
      icon: "📈",
      prompt: `วิเคราะห์ trend และการเปลี่ยนแปลงของ ${topCol} และคาดการณ์แนวโน้มในอนาคต`,
      relevance: 90,
    });
  }

  if (numeric.length >= 2) {
    const [c1, c2] = numeric.slice(0,2);
    suggestions.push({
      category: "correlation",
      icon: "🔗",
      prompt: `มีความสัมพันธ์ระหว่าง ${c1.col} กับ ${c2.col} หรือไม่ และมีนัยสำคัญแค่ไหน`,
      relevance: 85,
    });
  }

  // ── Outlier analysis ─────────────────────────────────
  const hasOutliers = numeric.some(c => (c.outlierCount||0) > 0);
  if (hasOutliers) {
    suggestions.push({
      category: "anomaly",
      icon: "⚠️",
      prompt: "วิเคราะห์ความผิดปกติและ outliers ในข้อมูล สิ่งเหล่านี้เกิดจากอะไรและควรจัดการอย่างไร",
      relevance: 88,
    });
  }

  // ── Category / group analysis ─────────────────────────
  if (text.length >= 1 && numeric.length >= 1) {
    const catCol = text.find(c => c.unique <= 20)?.col || text[0].col;
    const numCol = numeric[0].col;
    suggestions.push({
      category: "comparison",
      icon: "⚖️",
      prompt: `เปรียบเทียบ ${numCol} ระหว่างกลุ่ม ${catCol} ต่างๆ กลุ่มไหนทำได้ดีที่สุดและแย่ที่สุด`,
      relevance: 82,
    });
  }

  // ── Revenue / financial ───────────────────────────────
  const hasRevenue = cols.some(c => c.match(/revenue|sales|profit|income|amount|price|cost/));
  if (hasRevenue) {
    suggestions.push({
      category: "business",
      icon: "💰",
      prompt: "วิเคราะห์ประสิทธิภาพทางการเงิน และแนะนำกลยุทธ์เพิ่มรายได้หรือลดต้นทุน",
      relevance: 92,
    });
  }

  // ── Date / time series ────────────────────────────────
  const hasDate = cols.some(c => c.match(/date|time|month|year|week|day|period/));
  if (hasDate) {
    suggestions.push({
      category: "timeseries",
      icon: "🗓️",
      prompt: "วิเคราะห์ pattern ตามช่วงเวลา มีฤดูกาล (seasonality) หรือ trend ที่ชัดเจนมั้ย",
      relevance: 91,
    });
  }

  // ── Customer / user ───────────────────────────────────
  const hasCustomer = cols.some(c => c.match(/customer|user|client|member|buyer/));
  if (hasCustomer) {
    suggestions.push({
      category: "customer",
      icon: "👥",
      prompt: "วิเคราะห์พฤติกรรมลูกค้า กลุ่มลูกค้าที่สำคัญที่สุดคือใคร และควรโฟกัสกลุ่มไหน",
      relevance: 89,
    });
  }

  // ── Product ───────────────────────────────────────────
  const hasProduct = cols.some(c => c.match(/product|item|sku|category|brand/));
  if (hasProduct) {
    suggestions.push({
      category: "product",
      icon: "📦",
      prompt: "สินค้าหรือหมวดหมู่ไหนทำผลงานได้ดีที่สุด และไหนควรปรับปรุงหรือยกเลิก",
      relevance: 87,
    });
  }

  // ── Quality issues ────────────────────────────────────
  if (qualityScore && qualityScore.score < 80) {
    suggestions.push({
      category: "quality",
      icon: "🔍",
      prompt: `ข้อมูลมีปัญหาคุณภาพ (score: ${qualityScore.score}/100) วิเคราะห์ว่าปัญหาใดส่งผลต่อความน่าเชื่อถือของการวิเคราะห์มากที่สุด`,
      relevance: 85,
    });
  }

  // ── Forecast ─────────────────────────────────────────
  if (numeric.length >= 1) {
    suggestions.push({
      category: "forecast",
      icon: "🔮",
      prompt: `พยากรณ์ค่า ${numeric[0].col} ใน 3 ช่วงเวลาถัดไป และบอก confidence level ของการพยากรณ์`,
      relevance: 78,
    });
  }

  // ── Executive summary ─────────────────────────────────
  suggestions.push({
    category: "executive",
    icon: "📋",
    prompt: "สรุป executive summary สำหรับผู้บริหาร 5 ประเด็นสำคัญที่ต้องตัดสินใจทันที",
    relevance: 75,
  });

  return suggestions
    .sort((a,b) => b.relevance - a.relevance)
    .slice(0, 8);
}

/**
 * Auto chart config — picks the best chart type and axes for the data
 */
export function autoChartConfig(colAnalysis) {
  const numeric = colAnalysis.filter(c => c.type === "numeric");
  const text    = colAnalysis.filter(c => c.type === "text");
  const cols    = colAnalysis.map(c => c.col.toLowerCase());

  const charts = [];

  // Line chart — if date column present
  const dateCol = colAnalysis.find(c => c.col.toLowerCase().match(/date|month|week|year|period|time/));
  if (dateCol && numeric.length >= 1) {
    charts.push({
      recommended: true,
      type: "line",
      title: `${numeric[0].col} over time`,
      xAxis: dateCol.col,
      yAxis: numeric.slice(0,3).map(c=>c.col),
      reason: "Time series data — line chart shows trend clearly",
    });
  }

  // Bar chart — category vs numeric
  const catCol = text.find(c => c.unique >= 2 && c.unique <= 15);
  if (catCol && numeric.length >= 1) {
    charts.push({
      recommended: !dateCol,
      type: "bar",
      title: `${numeric[0].col} by ${catCol.col}`,
      xAxis: catCol.col,
      yAxis: [numeric[0].col],
      reason: "Categorical comparison — bar chart is most intuitive",
    });
  }

  // Scatter — 2 numeric columns
  if (numeric.length >= 2) {
    charts.push({
      recommended: false,
      type: "scatter",
      title: `${numeric[0].col} vs ${numeric[1].col}`,
      xAxis: numeric[0].col,
      yAxis: [numeric[1].col],
      reason: "Correlation analysis between two numeric variables",
    });
  }

  // Pie — category with small unique count
  const pieCol = text.find(c => c.unique >= 2 && c.unique <= 8);
  if (pieCol && numeric.length >= 1) {
    charts.push({
      recommended: false,
      type: "pie",
      title: `Distribution by ${pieCol.col}`,
      xAxis: pieCol.col,
      yAxis: [numeric[0].col],
      reason: "Part-to-whole relationship for small category sets",
    });
  }

  // Area — multiple numeric columns over time
  if (dateCol && numeric.length >= 2) {
    charts.push({
      recommended: false,
      type: "area",
      title: "Stacked area over time",
      xAxis: dateCol.col,
      yAxis: numeric.slice(0,3).map(c=>c.col),
      reason: "Volume and composition over time",
    });
  }

  // Fallback
  if (charts.length === 0 && numeric.length >= 1) {
    charts.push({
      recommended: true,
      type: "bar",
      title: numeric[0].col,
      xAxis: colAnalysis[0].col,
      yAxis: [numeric[0].col],
      reason: "Default bar chart",
    });
  }

  return charts;
}

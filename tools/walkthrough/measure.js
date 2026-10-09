// Runs IN THE PAGE (passed to page.evaluate): measures one captured state of the real app.
// Boxes are page CSS px { x, y, w, h } (the capture never scrolls, but scrollY is added anyway).
// Returns { boxes, strings, hoverables, pointers, innerText, page }.
export function measureState() {
  const sy = window.scrollY, sx = window.scrollX;
  const R = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: +(r.x + sx).toFixed(2), y: +(r.y + sy).toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  };
  const txt = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
  const all = (sel, root = document) => [...root.querySelectorAll(sel)];
  // match on textContent: innerText is CSS-uppercased for .eyebrow titles ("บันทึกข้างเล่ม · INSIGHTS")
  const byText = (sel, re, root = document) => all(sel, root).find(e => re.test((e.textContent || "").replace(/\s+/g, " ").trim()));
  const card = (el) => el && el.closest(".rounded-xl");
  const boxes = {}, strings = {};
  const put = (k, el) => { const b = R(el); if (b) boxes[k] = b; return el; };

  // ── always there: header, the two upload cards ──
  put("nav", document.querySelector("nav"));
  const fileCard = put("fileCard", document.querySelector('[data-tour="upload"]'));
  if (fileCard) {
    const meta = fileCard.querySelector(":scope > div:first-child span.num");
    put("fileMeta", meta); strings.fileMeta = txt(meta);
    strings.fileTitle = txt(fileCard.querySelector(":scope > div:first-child .eyebrow"));
    put("dropzone", fileCard.querySelector(".border-dashed"));
  }
  put("promptCard", document.querySelector('[data-tour="prompt"]'));

  // ── empty state: demo panel and sample cards ──
  const demoH = byText("h2", /10 วินาทีแรก/);
  if (demoH) {
    put("demoHeading", demoH); put("demoPanel", card(demoH));
    const grid = demoH.parentElement.querySelector(".grid");
    put("sampleGrid", grid);
    strings.samples = [];
    all("button", grid || document.createElement("div")).forEach((b, i) => {
      const title = b.querySelector("p.font-medium"), metaLine = b.querySelector("p.num");
      put(`sample${i + 1}`, b);
      strings.samples.push({ title: txt(title), badge: txt(b.querySelector("span.font-mono")), meta: txt(metaLine) });
      if (/ยอดขายร้านโชห่วย/.test(txt(title) || "")) {
        put("sampleCard", b); put("sampleTitle", title); put("sampleMetaLine", metaLine);
        strings.sampleTitle = txt(title); strings.sampleMeta = txt(metaLine);
      }
    });
  }

  // ── results: readout, toast, prompts, tabs ──
  const ro = document.querySelector('div[class*="md:grid-cols-6"]');
  if (ro) {
    put("readoutGrid", ro);
    strings.readout = [];
    [...ro.children].forEach(cell => {
      const label = txt(cell.querySelector(".eyebrow")), value = txt(cell.querySelector(".num"));
      put(`readoutCell_${(label || "").toLowerCase()}`, cell);
      put(`readoutValue_${(label || "").toLowerCase()}`, cell.querySelector(".num"));
      strings.readout.push([label, value]);
    });
  }
  const toastBox = document.querySelector('[role="status"][aria-live="polite"]');
  const toasts = toastBox ? [...toastBox.children] : [];
  if (toasts.length) { put("toast", toasts[0]); put("toastStack", toastBox); strings.toast = txt(toasts[0]); strings.toasts = toasts.map(txt); }
  const pc = byText(".eyebrow", /คำถามแนะนำจากข้อมูลชุดนี้/);
  if (pc) { put("promptsCard", card(pc)); strings.promptsMeta = txt(card(pc).querySelector("span.num")); strings.prompts = all("button", card(pc)).map(txt); }
  const tl = document.querySelector('[role="tablist"]');
  if (tl) {
    put("tablist", tl);
    strings.tabs = [];
    all('[role="tab"]', tl).forEach(t => {
      const name = (t.textContent || "").trim().toLowerCase().replace(/\s+/g, "_");   // innerText is CSS-uppercased
      put(`tab_${name}`, t); strings.tabs.push(txt(t));
      if (t.getAttribute("aria-selected") === "true") strings.activeTab = txt(t);
    });
  }
  const cs = byText(".eyebrow", /รายคอลัมน์|Column/i);
  if (cs && ro) put("colStats", card(cs));

  // ── INSIGHTS ──
  const ins = byText(".eyebrow", /บันทึกข้างเล่ม · Insights/);
  if (ins) {
    const c = card(ins); put("insightsCard", c); put("insightsTitle", ins);
    strings.insightsTitle = txt(ins); strings.insightsMeta = txt(c.querySelector(":scope > div:first-child span.num"));
    strings.findings = [];
    all(".anim-rise", c).forEach((row, i) => {
      const n = i + 1, title = row.querySelector("p.font-medium"), badge = row.querySelector("span.font-mono.rounded");
      put(`finding${n}`, row); put(`finding${n}_mark`, row.children[0]); put(`finding${n}_rule`, row.children[1]);
      put(`finding${n}_title`, title); put(`finding${n}_badge`, badge);
      strings.findings.push({ title: txt(title), badge: txt(badge), detail: txt(row.querySelector("p.text-xs")) });
    });
    if (strings.findings[0]) { strings.finding1Title = strings.findings[0].title; strings.finding1Badge = strings.findings[0].badge; }
  }

  // ── QUALITY ──
  const q = byText(".eyebrow", /ผลตรวจคุณภาพ · Quality/);
  if (q) {
    const c = card(q); put("qualityCard", c);
    const svg = c.querySelector("svg"); const ring = svg && svg.closest(".relative");
    put("q_ring", ring); put("q_excellent", c.querySelector("p.text-lg"));
    const stamp = c.querySelector(".anim-stamp"); put("q_stamp", stamp);
    strings.stamp = txt(stamp); strings.qualityLabel = txt(c.querySelector("p.text-lg"));
    strings.ringText = txt(ring);
    const sub = c.querySelector('div[class*="md:grid-cols-5"]'); put("q_subscores", sub);
    strings.subscores = sub ? [...sub.children].map(d => ({ value: txt(d.querySelector(".num")), label: txt(d.querySelector(".text-xs.capitalize")) })) : [];
    strings.subscoreLabels = strings.subscores.map(s => s.label);
    const iss = byText(".eyebrow", /Issues found/i, c); put("q_issues", iss && iss.parentElement);
    strings.issues = iss ? all(".margin-rule", iss.parentElement).map(txt) : [];
    put("fixPanel", c.nextElementSibling);
  }

  // ── CHARTS ──
  const ch = byText(".eyebrow", /แผนภูมิ · Charts/);
  if (ch) {
    const c = card(ch); put("chartCard", c); put("c_eyebrow", ch);
    const typeLabel = byText("span", /^ประเภทกราฟ:?$/, c); const row = typeLabel && typeLabel.parentElement;
    put("c_typeRow", row);
    const pressed = row ? all("button[aria-pressed]", row) : [];
    pressed.forEach(b => { if (b.getAttribute("aria-pressed") === "true") { put("c_typeActive", b); strings.chartType = txt(b); } });
    strings.chartTypes = pressed.map(txt);
    put("c_png", c.querySelector('button[aria-label*="PNG"]')); put("c_svg", c.querySelector('button[aria-label*="SVG"]'));
    put("c_plot", c.querySelector(".recharts-wrapper")); put("c_surface", c.querySelector("svg.recharts-surface"));
    put("c_grid", c.querySelector(".recharts-cartesian-grid")); put("c_xAxis", c.querySelector(".recharts-xAxis"));
    put("c_yAxis", c.querySelector(".recharts-yAxis")); put("c_legend", c.querySelector(".recharts-legend-wrapper"));
    put("c_brush", c.querySelector(".recharts-brush"));
    strings.legend = txt(c.querySelector(".recharts-legend-item-text"));
    strings.xTicks = all(".recharts-xAxis .recharts-cartesian-axis-tick-value", c).map(e => e.textContent.trim());
    strings.yTicks = all(".recharts-yAxis .recharts-cartesian-axis-tick-value", c).map(e => e.textContent.trim());
    strings.bars = all(".recharts-bar-rectangle path", c).map(p => p.getAttribute("d"));
    const rec = byText("p", /^Recommended charts:?$/, c);
    if (rec) {
      put("c_recommended", rec.parentElement);
      const chips = all("span", rec.nextElementSibling || rec.parentElement).filter(s => s.parentElement === rec.nextElementSibling);
      chips.forEach((s, i) => put(`c_chip${i + 1}`, s));
      strings.chips = chips.map(txt); strings.firstChip = strings.chips[0] || null;
    }
  }

  // ── what a cursor could change: hoverable rects, and where the hand glyph applies ──
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""} "${(txt(el) || "").slice(0, 40)}"`;
  const hoverables = [];
  for (const el of all("a, button, [role=tab], input, textarea, [class*='hover:']")) {
    const b = R(el); if (!b || !vis(el)) continue;
    hoverables.push({ ...b, what: desc(el) });
  }
  const pointers = [];
  for (const el of all("body *")) {
    if (getComputedStyle(el).cursor !== "pointer") continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;   // inherited: keep the root
    const b = R(el); if (!b || !vis(el)) continue;
    pointers.push({ ...b, what: desc(el) });
  }
  return {
    boxes, strings, hoverables, pointers, innerText: document.body.innerText,
    page: { scrollX: sx, scrollY: sy, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
  };
}

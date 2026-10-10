/* landing.js — extracted from landing.html in v21.
 *
 * It used to be an inline <script>. helmet's CSP sets script-src 'self'
 * (backend/src/app.js), so the browser refused to execute it: no i18n, no
 * TH/EN toggle, no live-parse console, and — worst — the 17 elements with
 * .rv stayed at opacity:0 forever, because only this file adds .in. Every
 * section below the hero was invisible to anyone not using reduced motion.
 *
 * Keep this external. Do NOT add 'unsafe-inline' to scriptSrc to make an
 * inline block work; that weakens the CSP for the whole app to fix one page.
 */
(function () {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── i18n ── */
  const I18N = {
    th: {
      skip: "ข้ามไปเนื้อหาหลัก",
      navCta: "ลองเลย — ฟรี",
      heroEyebrow: "เครื่องตรวจข้อมูลภาษาไทย · ไม่ต้องสมัครก็ลองได้",
      heroH1: 'ไฟล์จากหน้าร้านเละแค่ไหน<br><span class="hl">เครื่องนี้ก็อ่านออก</span>',
      heroSub: "วันที่ พ.ศ. · ราคา ฿1,234.50 · หัวรายงานคั่นตาราง — อัปโหลดมาทั้งอย่างนั้น แล้วรับ insights คุณภาพข้อมูล และกราฟ ภายใน 10 วินาที",
      heroCta1: "แตะข้อมูลตัวอย่าง ↗", heroCta2: "ทำงานยังไง",
      trust: "ไม่ต้องล็อกอิน · ไฟล์ตัวอย่างมีในระบบอยู่แล้ว · ไฟล์ที่อัปโหลดในโหมดลองใช้ไม่ถูกเก็บไว้ · สถิติล้วน ไม่เผาโควต้า AI",
      consoleLabel: "ภาพประกอบ",
      consoleNote: 'ภาพเคลื่อนไหวประกอบเพื่ออธิบายเท่านั้น ผลจริงของไฟล์ตัวอย่างอยู่ในส่วน<a href="#findings-sec">บันทึกข้างเล่ม</a>ด้านล่าง',
      messyH2: "อ่านไฟล์ที่เครื่องมืออื่นอ่านไม่ออก",
      messySub: "ไฟล์จริงจาก Excel ภาษาไทยไม่เคยสะอาด — เราสร้างชั้นแปลภาษาไฟล์เละโดยเฉพาะ",
      c1Eyebrow: "พ.ศ. → ค.ศ.", c1H: "วันที่แบบไทย เข้าใจหมด",
      c1P: '2569, "14 ม.ค. 69", ปี พ.ศ. สองหลัก — แปลงเป็นมาตรฐานให้อัตโนมัติ พร้อมบอกช่วงเวลาของข้อมูล',
      c2Eyebrow: "ตัวเลขปนสัญลักษณ์", c2H: "฿ , % ( ) ไม่ใช่ปัญหา",
      c2P: '"฿1,234.50" ที่เครื่องมืออื่นอ่านเป็น 1 — ที่นี่อ่านถูก รวมถึงยอดติดลบแบบบัญชี (500)',
      c3Eyebrow: "หัวรายงานคั่น", c3H: "ข้ามขยะ หาหัวตารางเอง",
      c3P: 'บรรทัด "รายงานยอดขายประจำเดือน…" เหนือหัวตาราง? ระบบตรวจเจอและข้ามให้ พร้อม TIS-620/UTF-16',
      howEyebrow: "10 วินาทีแรก", howH2: "ทำงานยังไง",
      s1H: "วางไฟล์ หรือแตะตัวอย่าง", s1P: "CSV / Excel สูงสุด {mb} MB — หรือลองชุดข้อมูลตัวอย่างโดยไม่ต้องสมัครอะไรเลย",
      s2H: "Insights Engine ตรวจทันที", s2P: "สถิติล้วน ไม่รอ AI: ค่าผิดปกติ แถวซ้ำ ค่าว่าง แนวโน้ม correlation — เสร็จในระดับมิลลิวินาที",
      s3H: "อ่านผลเป็นภาษาไทย", s3P: "บันทึกข้างเล่มบอกว่าเจออะไร สำคัญแค่ไหน ควรทำอะไรต่อ — เข้าสู่ระบบเมื่ออยากได้บทวิเคราะห์ AI ฉบับเต็ม",
      walkLabel: "สาธิตจากหน้าจอจริง · ข้อมูลตัวอย่าง · ตัวเลขไม่ได้แต่ง",
      walkPause: "หยุด", walkPlay: "เล่น",
      walkDesc: "สาธิตจากหน้าจอจริงของแอป ตัวเลขไม่ได้แต่ง: ช่องอัปโหลดรับ CSV หรือ Excel ไม่เกิน {mb} MB — แตะชุดตัวอย่าง “ยอดขายร้านโชห่วย” ระบบตรวจ 45 แถว × 5 คอลัมน์ด้วยสถิติล้วน ไม่ใช้ AI บันทึกข้างเล่มพบ 4 ประเด็น: “ยอดขาย” มี outliers 6 จุด (14.0%) · พบแถวซ้ำ 2 แถว · “วันที่” เป็นคอลัมน์วันที่ · “จำนวน” กับ “ยอดขาย” สัมพันธ์กันแรง (r=0.941) — ได้เกรดคุณภาพ A 92/100 พร้อมกราฟแท่งจำนวนตามสินค้า ส่งออกเป็น PNG หรือ SVG ได้",
      fEyebrow: "บันทึกข้างเล่ม · Insights", fH2: "เส้นข้างกระดาษบอกความสำคัญ",
      fSub: "มรดกจากสมุดผู้ตรวจสอบ — ทุกประเด็นมีเส้นสีบอกระดับ อ่านปราดเดียวรู้ว่าอะไรด่วน",
      f1H: '"ยอดขาย" มีค่าว่าง 4.4%', f1P: "พบเซลล์ว่าง 2 จุด — ตรวจสอบการกรอกข้อมูลต้นทาง หรือระบุวิธีจัดการก่อนสรุปผล",
      f2H: "พบข้อมูลซ้ำ 2 แถว (4.4%)", f2P: "อาจเกิดจากการกดส่งซ้ำ — เก็บไว้พร้อมระบุในรายงาน หรือลบออกก่อนวิเคราะห์",
      f3H: '"วันที่" เป็นคอลัมน์วันที่', f3P: "ครอบคลุม 2026-01-05 ถึง 2026-03-28 — พบปีแบบ พ.ศ. และแปลงเป็น ค.ศ. ให้อัตโนมัติ",
      h1B: "ข้อมูลตัวอย่าง ไม่ใช่ของปลอมสวย ๆ", h1T: 'ตัวเลขทุกตัวในส่วน<a href="#findings-sec">บันทึกข้างเล่ม</a>มาจาก engine จริง รันกับไฟล์เละจริง',
      h2B: "โหมดลองใช้ ไม่แตะ AI", h2T: "ผลตรวจฟรีคำนวณจากสถิติล้วน — เร็ว ตรวจซ้ำได้ และไม่เผางบใคร",
      h3B: "ความเป็นส่วนตัวเป็นค่าเริ่มต้น",
      h3T: 'โหมดลองใช้อ่านไฟล์ในหน่วยความจำและไม่เก็บเนื้อหาไว้เลย — บันทึกเพียงรูปทรงของไฟล์ ' +
        "เมื่อเข้าสู่ระบบ ผลวิเคราะห์จะอยู่ในประวัติของคุณ ไฟล์ต้นฉบับจะถูกเก็บก็ต่อเมื่อคุณกดบันทึกเท่านั้น " +
        "และ AI เห็นคำถาม ชื่อคอลัมน์ และค่าสถิติ — ไม่เห็นแถวข้อมูล เว้นแต่คุณยืนยันคำสั่งให้ AI แก้ไขข้อมูล และไม่เห็นข้อมูลส่วนบุคคลที่ระบบตรวจพบ " +
        'ดาวน์โหลดข้อมูลหรือลบบัญชีได้ทุกเมื่อ · <a href="/privacy">ประกาศความเป็นส่วนตัว</a>',
      ctaEyebrow: "พร้อมเมื่อคุณพร้อม", ctaH2: "เอาไฟล์ที่เละที่สุดของคุณมา",
      ctaSub: 'เจอไฟล์ที่เครื่องนี้อ่านไม่ออก? บอกเราได้ที่<a href="/contact">หน้าติดต่อ</a> — เล่าลักษณะไฟล์ให้ฟัง และโปรดอย่าส่งข้อมูลส่วนบุคคลจริงมา', ctaBtn: "เปิดเครื่องตรวจ ↗",
      footer: "DATA ANALYSIS BOT · AFTER-HOURS CONSOLE · {v} — สถิติล้วนตรวจซ้ำได้เสมอ · สร้างโดย Phatcharaphong Siriphatcharakul · 2 March 2025",
      tSkip: "SKIPPED — หัวรายงาน", tHeader: "HEADER ✓", tFix1: "พ.ศ.→ค.ศ. · ฿→number", tFix2: "เดือนไทย · ติดลบบัญชี",
    },
    en: {
      skip: "Skip to main content",
      navCta: "Try it — free",
      heroEyebrow: "Thai-first data inspector · no signup needed",
      heroH1: 'However messy your shop file is,<br><span class="hl">this machine reads it.</span>',
      heroSub: "Buddhist-Era dates · ฿1,234.50 prices · report banners above the table — upload it exactly as it is, and get insights, a data-quality grade, and charts within 10 seconds.",
      heroCta1: "Tap a sample dataset ↗", heroCta2: "How it works",
      trust: "No login · sample files are built in · try-mode uploads are never stored · pure statistics, zero AI quota burned",
      consoleLabel: "ILLUSTRATION",
      consoleNote: 'Illustrative animation. Real results for the sample file are in <a href="#findings-sec">Findings</a> below.',
      messyH2: "Reads files other tools can't",
      messySub: "Real Thai Excel exports are never clean — so we built a translation layer for messy files.",
      c1Eyebrow: "B.E. → C.E.", c1H: "Thai dates, fully understood",
      c1P: '2569, "14 ม.ค. 69", two-digit Buddhist-Era years — normalized automatically, with the data\'s date range reported back.',
      c2Eyebrow: "Numbers with symbols", c2H: "฿ , % ( ) — no problem",
      c2P: '"฿1,234.50" reads as 1 in most tools — here it parses correctly, including accounting negatives like (500).',
      c3Eyebrow: "Banner rows", c3H: "Skips junk, finds the real header",
      c3P: 'A "Monthly sales report…" line sitting above your table? Detected and skipped — TIS-620 and UTF-16 handled too.',
      howEyebrow: "The first 10 seconds", howH2: "How it works",
      s1H: "Drop a file, or tap a sample", s1P: "CSV / Excel up to {mb} MB — or try a sample dataset with zero signup.",
      s2H: "Insights Engine inspects instantly", s2P: "Pure statistics, no AI wait: outliers, duplicates, missing values, trends, correlations — back in milliseconds.",
      s3H: "Read the findings in plain language", s3P: "Margin notes tell you what was found, how serious it is, and what to do — sign in when you want the full AI report.",
      walkLabel: "walkthrough · real screens · sample data · figures unedited",
      walkPause: "Pause", walkPlay: "Play",
      walkDesc: "A walkthrough built from real screens of the app, figures unedited. The upload box takes CSV or Excel files up to {mb} MB. Tapping the sample “ยอดขายร้านโชห่วย” (corner-shop sales) inspects 45 rows × 5 columns with pure statistics, no AI. Its margin notes, in Thai, list 4 findings: 6 outliers in Sales (14.0%), 2 duplicate rows, a date column, and Quantity strongly correlated with Sales (r = 0.941). The data is graded A, 92/100, and a bar chart of quantity by product is ready to export as PNG or SVG.",
      fEyebrow: "Margin notes · Insights", fH2: "The margin rule tells you what matters",
      fSub: "Inherited from the auditor's ledger — every finding carries a colored rule, so urgency reads at a glance.",
      f1H: '"Sales" has 4.4% missing values', f1P: "2 empty cells found — check the source entry, or state your handling method before concluding.",
      f2H: "2 duplicate rows found (4.4%)", f2P: "Likely double-submits — keep them with a note in the report, or remove before analysis.",
      f3H: '"Date" is a date column', f3P: "Spans 2026-01-05 to 2026-03-28 — Buddhist-Era years detected and converted automatically.",
      h1B: "Sample numbers aren't decorative", h1T: 'Every figure in <a href="#findings-sec">Findings</a> comes from the real engine, run on a genuinely messy file.',
      h2B: "Try-mode never touches AI", h2T: "Free inspection is pure statistics — fast, reproducible, and burns nobody's budget.",
      h3B: "Privacy by default",
      h3T: "Try mode reads your file in memory and keeps none of its contents — only its shape is recorded. " +
        "Signed in, results go to your History, the original file is kept only if you press Save, " +
        "and the AI sees your question, column names and statistics — not your rows unless you confirm an AI Edit, and never detected personal data. " +
        'Download your data or delete your account any time · <a href="/privacy">Privacy Notice</a>',
      ctaEyebrow: "Ready when you are", ctaH2: "Bring us your messiest file",
      ctaSub: 'Got a file it can\'t read? Tell us on the <a href="/contact">contact page</a> — describe the layout, and please don\'t send real personal data.', ctaBtn: "Open the inspector ↗",
      footer: "DATA ANALYSIS BOT · AFTER-HOURS CONSOLE · {v} — pure statistics, always reproducible · Made by Phatcharaphong Siriphatcharakul · 2 March 2025",
      tSkip: "SKIPPED — banner row", tHeader: "HEADER ✓", tFix1: "B.E.→C.E. · ฿→number", tFix2: "Thai month · acct negative",
    },
  };
  let lang = localStorage.getItem("dab_landing_lang") || "th";  // Thai-first: matches the app default in lib/i18n.js

  let appVersion = "";   // set by the /api/health fetch at the end of this IIFE
  let maxUploadMb = "25"; // mirrors MAX_UPLOAD_MB (backend/src/config.js); replaced from /api/health

  function applyLang() {
    const d = I18N[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = d[el.dataset.i18n]; });
    /* The footer carries a {v} token rather than a literal version — it was
       hardcoded to v20.4 and three releases stale. It cannot be a child
       element: applyLang assigns textContent, which wipes anything inside a
       [data-i18n] node. appVersion is filled by the /api/health fetch below.
       {mb} is the upload limit, the same way: the copy said 10MB while the
       backend accepted 25, so it now comes from /api/health maxUploadMb. */
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const t = el.textContent;
      if (t.includes("{v}") || t.includes("{mb}")) el.textContent = t.replace("{v}", appVersion || "").replaceAll("{mb}", maxUploadMb);
    });
    document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = d[el.dataset.i18nHtml]; });
    document.getElementById("langTh").classList.toggle("on", lang === "th");
    document.getElementById("langEn").classList.toggle("on", lang === "en");
    document.querySelectorAll(".tag[data-tkey]").forEach(el => { el.textContent = d[el.dataset.tkey]; });
  }
  document.getElementById("langTh").onclick = () => { lang = "th"; localStorage.setItem("dab_landing_lang", lang); applyLang(); };
  document.getElementById("langEn").onclick = () => { lang = "en"; localStorage.setItem("dab_landing_lang", lang); applyLang(); };
  applyLang();

  /* ── scroll reveals ── */
  const io = new IntersectionObserver((es) => {
    es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.18 });
  document.querySelectorAll(".rv").forEach(el => io.observe(el));

  /* ── "How it works" walkthrough ──
     The markup ships with no <source>, no poster and no autoplay, so nothing
     is fetched at page load. It is armed (poster + sources) once #walk is
     within 300 px of the viewport. It plays at >= 50% visible and pauses
     below 25% (hysteresis, so it does not stutter at one edge). It never
     plays while the hero video plays: the hero is paused first, which also
     cancels its autoplay, and resumes once the walkthrough stops and the hero
     is back in view. Both pause while the tab is hidden. The three step cards
     are its chapter rail. Below 900 px the CSS hides the figure and nothing
     is fetched. Under reduced motion or with Save-Data, arm() adds
     .walk--still instead, so the still also waits until #walk is near; no
     video is ever requested. Reduced motion is live (rm), not read once:
     switching it off on the page arms the video, switching it on shows the
     still. An explicit Play (kick) may start the film from 25% visible; the
     50% entry threshold is only for autoplay. */
  const walk = document.getElementById("walk");
  if (walk) {
    const vid = walk.querySelector("video"), btn = document.getElementById("walkBtn");
    const hero = document.querySelector(".hero-bg video");
    const steps = document.querySelectorAll("#how .step");
    const wide = matchMedia("(min-width: 900px)");
    const rm = matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = !!(navigator.connection && navigator.connection.saveData);
    /* [start, end) seconds of steps 01-03 in the film, aligned to its caption
       eyebrows: STEP 01 is up by 1.5, STEP 02 takes over at 6.62, STEP 03 at
       10.42, and the last caption is gone by 21.62. A copy of CHAPTERS in
       tools/walkthrough/schedule.js: this static page cannot import it, so
       keep the two in step after a re-capture. */
    const CHAPTERS = [[1.5, 6.62], [6.62, 10.42], [10.42, 21.62]];
    let armed = false, userPaused = false, ratio = 0, heroRatio = 0, near = false, kick = false;
    const arm = () => {
      if (!wide.matches) return;                                 // the CSS hides the figure
      const still = rm.matches || saveData;
      walk.classList.toggle("walk--still", still);               // so the still loads only once #walk is near
      if (armed || still) return;
      armed = true;
      vid.poster = vid.dataset.poster;
      [["webm", "video/webm"], ["mp4", "video/mp4"]].forEach(([k, type]) => {
        const s = document.createElement("source"); s.type = type; s.src = vid.dataset[k]; vid.appendChild(s);
      });
      vid.preload = "auto"; vid.load();
    };
    const chapter = () => {
      const on = armed && !vid.paused, t = vid.currentTime;
      steps.forEach((s, i) => s.classList.toggle("now", on && i < CHAPTERS.length && t >= CHAPTERS[i][0] && t < CHAPTERS[i][1]));
    };
    const sync = () => {
      const want = armed && !userPaused && !document.hidden && wide.matches && !rm.matches &&
        ratio >= (vid.paused && !kick ? 0.5 : 0.25);
      if (want) {
        if (hero && !hero.paused) hero.pause();                  // never two videos playing at once
        if (vid.paused) vid.play().catch(() => {});
      } else {
        if (!vid.paused) vid.pause();
        if (hero && document.hidden) { if (!hero.paused) hero.pause(); }
        else if (hero && hero.currentSrc && hero.paused && heroRatio > 0) hero.play().catch(() => {});
      }
      chapter();
    };
    new IntersectionObserver(es => {
      near = es[es.length - 1].isIntersecting;                   // one target: the last entry is current
      if (near) { arm(); sync(); }
    }, { rootMargin: "300px 0px" }).observe(walk);
    const vis = new IntersectionObserver(es => {
      es.forEach(e => { if (e.target === vid) ratio = e.intersectionRatio; else heroRatio = e.isIntersecting ? e.intersectionRatio : 0; });
      if (ratio < 0.25) kick = false;                            // an explicit Play lasts until it drops below 25%
      sync();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    vis.observe(vid); if (hero) vis.observe(hero);
    document.addEventListener("visibilitychange", sync);
    wide.addEventListener("change", sync);
    rm.addEventListener("change", () => { if (near) arm(); sync(); });
    ["timeupdate", "play", "pause"].forEach(ev => vid.addEventListener(ev, chapter));
    btn.addEventListener("click", () => {
      userPaused = !userPaused;
      kick = !userPaused;                                        // Play overrides the 50% entry threshold
      btn.dataset.i18n = userPaused ? "walkPlay" : "walkPause";   // applyLang relabels it on a TH/EN toggle
      btn.textContent = I18N[lang][btn.dataset.i18n];
      sync();
    });
  }

  /* ── the signature console loop ── */
  const body = document.getElementById("cbody");
  const lines = [
    { src: "รายงานยอดขาย ร้านป้าศรี ประจำเดือน ม.ค.–มี.ค. 2569", fix: null, tkey: "tSkip", cls: "t-skip", skip: true },
    { src: "วันที่,สินค้า,จำนวน,ยอดขาย", fix: null, tkey: "tHeader", cls: "t-ok" },
    { src: '14/01/2569,น้ำปลา,12,"฿1,234.50"', fix: "2026-01-14,น้ำปลา,12,1234.50", tkey: "tFix1", cls: "t-fix" },
    { src: '15 ม.ค. 69,ข้าวสาร,5,"(500)"', fix: "2026-01-15,ข้าวสาร,5,-500", tkey: "tFix2", cls: "t-fix" },
  ];
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, reduced ? 0 : ms));

  function countUp(el, target, dur = 420) {
    if (reduced) { el.textContent = target; return; }
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * e);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  async function typeInto(el, text) {
    if (reduced) { el.textContent = text; return; }
    for (let i = 1; i <= text.length; i++) {
      el.textContent = text.slice(0, i);
      await sleep(text.length > 40 ? 9 : 16);
    }
  }

  async function runLoop() {
    body.innerHTML = "";
    ["roRows","roFixed","roSkip"].forEach(id => $(id).textContent = "0");
    $("roMs").textContent = "— ms";
    const g = $("grade"); g.classList.remove("stamped");

    const rows = lines.map((l, i) => {
      const ln = document.createElement("div");
      ln.className = "ln";
      ln.innerHTML = `<span class="no">${String(i + 1).padStart(2, "0")}</span><span class="src"></span><span class="tag ${l.cls}" data-tkey="${l.tkey}">${I18N[lang][l.tkey]}</span>`;
      body.appendChild(ln);
      return ln;
    });
    const caret = document.createElement("span");
    caret.className = "caret";

    for (let i = 0; i < lines.length; i++) {
      const srcEl = rows[i].querySelector(".src");
      srcEl.appendChild(caret);
      await typeInto(srcEl, lines[i].src);
      srcEl.appendChild(caret);
      await sleep(120);
    }
    caret.remove();
    await sleep(450);

    let fixed = 0, skipped = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], row = rows[i], srcEl = row.querySelector(".src");
      if (l.skip) { row.classList.add("skipped"); skipped++; }
      if (l.fix) { srcEl.textContent = l.fix; srcEl.classList.add("fix"); fixed++; }
      row.querySelector(".tag").classList.add("show");
      await sleep(430);
    }
    await sleep(300);

    countUp($("roRows"), 45);
    setTimeout(() => countUp($("roFixed"), fixed + 41), 60);
    setTimeout(() => countUp($("roSkip"), skipped), 120);
    setTimeout(() => { $("roMs").textContent = "8 ms"; }, 200);
    await sleep(reduced ? 0 : 760);
    g.classList.add("stamped");

    await sleep(4200);
    runLoop();
  }
  runLoop();

  /* Real version, from the backend. This page is static, so Vite's define does
     not reach it. Must live INSIDE this IIFE: applyLang is scoped here, so a
     call from outside throws a ReferenceError the .catch would swallow — which
     is why the footer kept showing the literal {v}. */
  fetch("/api/health")
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d) return;
      if (d.version) {
        appVersion = "v" + d.version;
        const chip = document.getElementById("ver");
        if (chip) chip.textContent = appVersion;
        document.querySelectorAll(".ver-txt").forEach(el => { el.textContent = appVersion; });
      }
      if (d.maxUploadMb) maxUploadMb = String(d.maxUploadMb);
      applyLang();
    })
    .catch(() => {});

})();

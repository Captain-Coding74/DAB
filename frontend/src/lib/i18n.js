/**
 * i18n — English by default, Thai on toggle.
 *
 * DAB is a Thai-first product with an English-first door. The landing page
 * already works this way (`routes.test.js` asserts English is the default),
 * and the app used to switch to Thai the moment you clicked through, which
 * made the site feel like two different products.
 *
 * The language key is shared with the landing page — `dab_landing_lang` —
 * deliberately: a visitor who picks Thai on /welcome stays in Thai when they
 * enter the app. One choice, one key, no second toggle to find.
 *
 * ADDING STRINGS
 * --------------
 * Every entry needs both languages. A missing Thai value falls back to
 * English rather than rendering `undefined`, but that is a safety net, not a
 * workflow — an untranslated string is a bug, and `i18n.test.js` fails on
 * any key that exists in one language and not the other.
 */
import { useSyncExternalStore } from "react";

const KEY = "dab_landing_lang";          // shared with frontend/public/landing.js

export const STRINGS = {
  // ── nav + shell ──
  "nav.analyze":        { en: "Analyze",            th: "วิเคราะห์" },
  "nav.history":        { en: "History",            th: "ประวัติ" },
  "nav.workspace":      { en: "Workspace",          th: "พื้นที่ทำงาน" },
  "nav.account":        { en: "Account",            th: "บัญชี" },
  "nav.signIn":         { en: "Sign in",            th: "เข้าสู่ระบบ" },
  "nav.signOut":        { en: "Sign out",           th: "ออกจากระบบ" },
  "nav.whyDab":         { en: "Why DAB ↗",          th: "ทำไมต้อง DAB ↗" },

  // ── upload ──
  "upload.title":       { en: "Data file",          th: "ไฟล์ข้อมูล" },
  "upload.drop":        { en: "Drop a file here, or click to choose",
                          th: "วางไฟล์ที่นี่ หรือคลิกเลือก" },
  // Format names, not words — identical in both languages by design.
  "upload.hint":        { en: "CSV / Excel",        th: "CSV / Excel", sameInBoth: true },
  "upload.trySample":   { en: "Try a sample file",  th: "ลองไฟล์ตัวอย่าง" },
  "upload.howWeHandle": { en: "How we handle your file", th: "เราจัดการไฟล์ของคุณอย่างไร" },

  // ── the readout strip ──
  "stat.rows":          { en: "ROWS",               th: "แถว" },
  "stat.columns":       { en: "COLUMNS",            th: "คอลัมน์" },
  "stat.missing":       { en: "MISSING",            th: "ค่าที่หายไป" },
  "stat.duplicates":    { en: "DUPLICATES",         th: "แถวซ้ำ" },
  "stat.server":        { en: "SERVER",             th: "เซิร์ฟเวอร์" },
  "stat.perceived":     { en: "PERCEIVED",          th: "ที่ผู้ใช้รู้สึก" },

  // ── analysis ──
  "analyze.button":     { en: "Analyze file",       th: "วิเคราะห์ไฟล์" },
  "analyze.question":   { en: "Question for the AI", th: "คำถามสำหรับ AI" },
  "analyze.placeholder":{ en: "Or type your own, e.g. which product sold best?",
                          th: "หรือพิมพ์คำถามเอง เช่น หาสินค้าขายดี 5 อันดับแรก" },
  "analyze.working":    { en: "Analyzing…",         th: "กำลังวิเคราะห์…" },

  // ── AI privacy switches (v21.30) ──
  "ai.noAi":            { en: "Statistics only — don't send to AI", th: "สถิติล้วน — ไม่ส่งข้อมูลให้ AI" },
  "ai.noAiHint":        { en: "Nothing from this file goes to the AI provider. You still get every statistic.",
                          th: "ไม่มีข้อมูลจากไฟล์นี้ถูกส่งไปยังผู้ให้บริการ AI และยังได้ผลสถิติครบทุกอย่าง" },
  "ai.offReport":       { en: "Statistics only: nothing from this data was sent to the AI provider, so there is no AI report. Insights, quality, charts and correlations are all complete.",
                          th: "โหมดสถิติล้วน: ไม่มีข้อมูลชุดนี้ถูกส่งไปยังผู้ให้บริการ AI จึงไม่มีบทวิเคราะห์ AI — insights คุณภาพ กราฟ และ correlation ยังครบถ้วน" },
  "ai.offFeature":      { en: "AI is off for this data, so chat and the deep-dive agent are unavailable.",
                          th: "ปิด AI สำหรับข้อมูลชุดนี้ จึงใช้แชทถาม-ตอบและ agent เจาะลึกไม่ได้" },
  "ai.switchTitle":     { en: "AI for this dataset", th: "AI สำหรับชุดข้อมูลนี้" },
  "ai.switchHelp":      { en: "When off, nothing from this dataset is sent to the AI provider.",
                          th: "เมื่อปิด จะไม่มีข้อมูลใดจากชุดข้อมูลนี้ถูกส่งไปยังผู้ให้บริการ AI" },
  "ai.switchOwnerOnly": { en: "Only the dataset owner can change this.", th: "เฉพาะเจ้าของชุดข้อมูลเท่านั้นที่เปลี่ยนได้" },
  "ai.on":              { en: "On",                 th: "เปิด" },
  "ai.off":             { en: "Off",                th: "ปิด" },
  "ai.howWeUse":        { en: "How DAB uses AI",    th: "DAB ใช้ AI อย่างไร" },

  // ── AI edit: the claim, and the confirmation before rows are sent ──
  "aiEdit.intro":       { en: "Type an instruction and the AI proposes cell-by-cell edits for you to check before confirming (up to {max} rows).",
                          th: "พิมพ์คำสั่ง แล้ว AI จะเสนอการแก้ทีละช่องให้ตรวจก่อนยืนยัน (สูงสุด {max} แถว)" },
  "aiEdit.notSent":     { en: "Columns detected as personal data (such as names, phone numbers, emails, addresses and health data) are not sent to the AI.",
                          th: "คอลัมน์ที่ตรวจพบว่าเป็นข้อมูลส่วนบุคคล (เช่น ชื่อ เบอร์โทร อีเมล ที่อยู่ ข้อมูลสุขภาพ) จะไม่ถูกส่งให้ AI" },
  "aiEdit.confirmTitle":{ en: "Send these rows to the AI?", th: "ส่งข้อมูลเหล่านี้ให้ AI หรือไม่" },
  "aiEdit.confirmRows": { en: "{rows} rows of these columns will be sent to Anthropic (USA) to carry out your instruction:",
                          th: "ข้อมูล {rows} แถวจากคอลัมน์ต่อไปนี้จะถูกส่งไปยัง Anthropic (สหรัฐอเมริกา) เพื่อแก้ไขตามคำสั่งของคุณ:" },
  "aiEdit.leftOut":     { en: "Detected personal-data columns that stay on the server:",
                          th: "คอลัมน์ข้อมูลส่วนบุคคลที่ตรวจพบ ซึ่งจะไม่ถูกส่งออกจากเซิร์ฟเวอร์:" },
  "aiEdit.noneDetected":{ en: "No personal-data columns were detected. Check the columns above before you send.",
                          th: "ไม่พบคอลัมน์ข้อมูลส่วนบุคคล โปรดตรวจรายชื่อคอลัมน์ด้านบนก่อนส่ง" },
  "aiEdit.send":        { en: "Send",               th: "ส่ง" },
  "aiEdit.off":         { en: "AI is off for this data, so AI edit is unavailable.",
                          th: "ปิด AI สำหรับข้อมูลชุดนี้ จึงใช้การแก้ไขด้วย AI ไม่ได้" },
  "aiEdit.tooMany":     { en: "This dataset has {rows} rows; AI edit works on up to {max}. Use the suggested fixes instead.",
                          th: "ชุดข้อมูลนี้มี {rows} แถว แต่การแก้ไขด้วย AI รองรับสูงสุด {max} แถว — ใช้ข้อเสนอการแก้ไขแทน" },
  "aiEdit.nothingToSend":{ en: "Every column was detected as personal data, so there is nothing the AI may edit.",
                          th: "ทุกคอลัมน์ถูกตรวจพบว่าเป็นข้อมูลส่วนบุคคล จึงไม่มีคอลัมน์ใดที่ AI แก้ไขได้" },

  // ── inference panel ──
  "inf.eyebrow":        { en: "Inferential statistics", th: "การทดสอบสมมติฐาน" },
  "inf.title":          { en: "Is this difference real?", th: "ข้อมูลนี้ต่างกันจริงหรือไม่" },
  "inf.sub":            { en: "Every statistic is computed deterministically — the AI does not calculate them.",
                          th: "สถิติทั้งหมดคำนวณแบบตายตัว — AI ไม่ได้คำนวณ" },
  "inf.run":            { en: "Run the test",       th: "รันการทดสอบ" },
  "inf.needSaved":      { en: "Save the dataset first — these tests need every row, not a sample.",
                          th: "บันทึกชุดข้อมูลก่อน จึงจะทดสอบทางสถิติได้ — การทดสอบต้องใช้ข้อมูลทุกแถว ไม่ใช่แค่ตัวอย่าง" },
  "inf.significant":    { en: "Statistically significant", th: "มีนัยสำคัญทางสถิติ" },
  "inf.notSignificant": { en: "Not statistically significant", th: "ไม่มีนัยสำคัญทางสถิติ" },
  "inf.pickColumn":     { en: "Choose a column…",   th: "เลือกคอลัมน์…" },
  "inf.statistic":      { en: "Statistic",          th: "สถิติ" },
  "inf.value":          { en: "Value",              th: "ค่า" },
  "inf.meaning":        { en: "Meaning",            th: "ความหมาย" },

  // ── saving a dataset — opt-in (v21.30) ──
  "save.action":        { en: "Save dataset",       th: "บันทึกชุดข้อมูล" },
  "save.title":         { en: "Save this dataset?", th: "บันทึกชุดข้อมูลนี้หรือไม่" },
  "save.body":          { en: "Save the original file to DAB so you can run hypothesis tests and re-analyse later. It is kept until you delete it, or after 365 days without use.",
                          th: "บันทึกไฟล์ต้นฉบับไว้ใน DAB เพื่อใช้ทดสอบสมมติฐานและวิเคราะห์ซ้ำภายหลัง ไฟล์จะถูกเก็บไว้จนกว่าคุณจะลบเอง หรือจนกว่าจะไม่มีการใช้งานครบ 365 วัน" },
  "save.retention":     { en: "How long DAB keeps data", th: "DAB เก็บข้อมูลไว้นานเท่าใด" },
  "save.confirm":       { en: "Save",               th: "บันทึก" },
  "save.rosterNote":    { en: "This file looks like a class roster, so saving it needs your confirmation.",
                          th: "ไฟล์นี้มีลักษณะเป็นรายชื่อนักเรียน จึงต้องยืนยันก่อนบันทึก" },
  "save.school":        { en: "I am authorised by my school to process these students' data, and I will delete it when it is no longer needed",
                          th: "ข้าพเจ้าได้รับอนุญาตจากโรงเรียนให้ประมวลผลข้อมูลของนักเรียนเหล่านี้ และจะลบข้อมูลเมื่อไม่มีความจำเป็นต้องใช้แล้ว" },
  "save.done":          { en: "Dataset saved",      th: "บันทึกชุดข้อมูลแล้ว" },
  "save.failed":        { en: "Could not save the dataset", th: "บันทึกชุดข้อมูลไม่สำเร็จ" },
  "save.needFixes":     { en: "Fixes are saved as new versions of a saved dataset — save it first.",
                          th: "การแก้ไขจะบันทึกเป็นเวอร์ชันใหม่ของชุดข้อมูล จึงต้องบันทึกชุดข้อมูลก่อน" },
  "save.signedOut":     { en: "Sign in for the AI report, history, and the option to save.",
                          th: "เข้าสู่ระบบเพื่อรับรายงานจาก AI ดูประวัติ และเลือกบันทึกข้อมูลได้" },
  "save.noFile":        { en: "Analyse your own file to save it.",
                          th: "วิเคราะห์ไฟล์ของคุณเองก่อน จึงจะบันทึกได้" },

  // ── /account: your data, and deleting the account (v21.30) ──
  "account.title":      { en: "Your account",       th: "บัญชีของคุณ" },
  "account.profile":    { en: "Profile",            th: "ข้อมูลบัญชี" },
  "account.email":      { en: "Email",              th: "อีเมล" },
  "account.noEmail":    { en: "Not given",          th: "ไม่ได้ระบุ" },
  "account.legalVersion": { en: "Terms & Privacy Notice version you accepted", th: "ฉบับของข้อกำหนดและประกาศความเป็นส่วนตัวที่คุณยอมรับ" },
  "account.links":      { en: "Your privacy",       th: "ความเป็นส่วนตัวของคุณ" },
  "account.privacy":    { en: "Privacy Notice",     th: "ประกาศความเป็นส่วนตัว" },
  "account.terms":      { en: "Terms of Service",   th: "ข้อกำหนดการใช้งาน" },
  "account.requests":   { en: "Other requests (by email or post)", th: "คำขออื่น ๆ (ทางอีเมลหรือไปรษณีย์)" },
  "account.exportTitle":{ en: "Download my data",   th: "ดาวน์โหลดข้อมูลของฉัน" },
  "account.exportBody": { en: "One JSON file with everything DAB holds about you: your profile, workspaces and roles, saved datasets (the details of every version), analyses, chat, share links, comments, notifications, activity, the sign-in log and upload statistics.",
                          th: "ไฟล์ JSON ไฟล์เดียวที่รวมทุกอย่างที่ DAB เก็บเกี่ยวกับคุณ ได้แก่ ข้อมูลบัญชี พื้นที่ทำงานและบทบาท ชุดข้อมูลที่บันทึกไว้ (รายละเอียดทุกเวอร์ชัน) ผลการวิเคราะห์ แชท ลิงก์แชร์ ความคิดเห็น การแจ้งเตือน กิจกรรม บันทึกการเข้าสู่ระบบ และสถิติการอัปโหลด" },
  "account.exportButton":{ en: "Download my data (JSON)", th: "ดาวน์โหลดข้อมูลของฉัน (JSON)" },
  "account.exportFailed":{ en: "Could not prepare your data. Try again.", th: "เตรียมข้อมูลไม่สำเร็จ โปรดลองใหม่" },
  "account.filesTitle": { en: "Original files you saved", th: "ไฟล์ต้นฉบับที่คุณบันทึกไว้" },
  "account.filesHint":  { en: "Your download lists these files; get each original here.", th: "ไฟล์ที่ดาวน์โหลดมีรายการไฟล์เหล่านี้ ดาวน์โหลดไฟล์ต้นฉบับแต่ละไฟล์ได้ที่นี่" },
  "account.filesNone":  { en: "You have no saved files.", th: "คุณยังไม่มีไฟล์ที่บันทึกไว้" },
  "account.download":   { en: "Download",           th: "ดาวน์โหลด" },
  "account.deleteTitle":{ en: "Delete my account",  th: "ลบบัญชีของฉัน" },
  "account.deleteNow":  { en: "Deleted immediately: your account and everything it owns — saved files and datasets, analyses, chat, share links, comments, notifications and workspace memberships.",
                          th: "ลบทันที: บัญชีของคุณและทุกอย่างที่เป็นของบัญชีนี้ ได้แก่ ไฟล์และชุดข้อมูลที่บันทึกไว้ ผลการวิเคราะห์ แชท ลิงก์แชร์ ความคิดเห็น การแจ้งเตือน และการเป็นสมาชิกพื้นที่ทำงาน" },
  "account.deleteWorkspaces": { en: "Workspaces you own pass to the earliest-joined remaining admin, otherwise to the earliest-joined member; a workspace with no admin or member left is deleted.",
                          th: "พื้นที่ทำงานที่คุณเป็นเจ้าของจะโอนให้ผู้ดูแล (admin) ที่เข้าร่วมก่อนสุดซึ่งยังอยู่ หากไม่มีจะโอนให้สมาชิกที่เข้าร่วมก่อนสุด และหากไม่เหลือผู้ดูแลหรือสมาชิกเลย พื้นที่ทำงานนั้นจะถูกลบ" },
  "account.deleteKept": { en: "Kept after deletion: traffic-log entries until their 90-day retention ends (a legal duty), and a privacy-request log entry holding only a one-way hash of your user ID, kept for 3 years to show your request was handled. Upload statistics with no names or values stay, no longer linked to you.",
                          th: "สิ่งที่ยังเก็บไว้หลังลบ: บันทึกการใช้งาน (traffic log) จนครบระยะเก็บ 90 วัน (ตามที่กฎหมายกำหนด) และรายการในบันทึกคำขอเกี่ยวกับข้อมูลส่วนบุคคลซึ่งมีเพียงค่าแฮชทางเดียวของรหัสผู้ใช้ เก็บไว้ 3 ปีเพื่อแสดงว่าคำขอของคุณได้รับการดำเนินการแล้ว ส่วนสถิติการอัปโหลดที่ไม่มีชื่อหรือค่าข้อมูลจะยังอยู่ แต่ไม่เชื่อมโยงกับคุณอีกต่อไป" },
  "account.deleteUndo": { en: "This cannot be undone. Download your data first if you want a copy.",
                          th: "การลบนี้ย้อนกลับไม่ได้ หากต้องการเก็บสำเนา โปรดดาวน์โหลดข้อมูลของคุณก่อน" },
  "account.typeUsername":{ en: "Type your username to confirm", th: "พิมพ์ชื่อผู้ใช้ของคุณเพื่อยืนยัน" },
  "account.deleteButton":{ en: "Delete my account permanently", th: "ลบบัญชีของฉันถาวร" },
  "account.deleted":    { en: "Your account has been deleted", th: "ลบบัญชีของคุณแล้ว" },
  "account.passwordRequired": { en: "Enter your password", th: "กรุณากรอกรหัสผ่าน" },
  "account.wrongPassword": { en: "Wrong password",  th: "รหัสผ่านไม่ถูกต้อง" },
  "account.tooMany":    { en: "Too many attempts. Wait 15 minutes.", th: "ลองหลายครั้งเกินไป โปรดรอ 15 นาที" },
  "account.deleteFailed": { en: "Could not delete your account. Try again, or contact us.", th: "ลบบัญชีไม่สำเร็จ โปรดลองใหม่ หรือติดต่อเรา" },

  // ── auth ──
  "auth.username":      { en: "Username",           th: "ชื่อผู้ใช้" },
  "auth.password":      { en: "Password",           th: "รหัสผ่าน" },
  "auth.email":         { en: "Email (optional)",   th: "อีเมล (ไม่บังคับ)" },
  "auth.signIn":        { en: "Sign in",            th: "เข้าสู่ระบบ" },
  "auth.register":      { en: "Create account",     th: "สมัครสมาชิก" },
  "auth.toRegister":    { en: "No account yet? Create one", th: "ยังไม่มีบัญชี? สมัครเลย" },
  "auth.toSignIn":      { en: "Already have an account? Sign in", th: "มีบัญชีแล้ว? เข้าสู่ระบบ" },
  "auth.tagline":       { en: "Upload · Check · Share reports", th: "อัปโหลด · ตรวจสอบ · แชร์รายงาน" },
  "auth.min3":          { en: "At least 3 characters", th: "อย่างน้อย 3 ตัวอักษร" },
  "auth.min6":          { en: "At least 6 characters", th: "อย่างน้อย 6 ตัวอักษร" },
  "auth.welcome":       { en: "Welcome, {name}!",   th: "ยินดีต้อนรับ {name}!" },
  "auth.created":       { en: "Account created!",   th: "สร้างบัญชีแล้ว!" },
  "auth.guestHint":     { en: "You can use DAB without signing in · History and workspaces need an account",
                          th: "ใช้งานได้โดยไม่ต้องเข้าสู่ระบบ · ประวัติและพื้นที่ทำงานต้องมีบัญชี" },

  // ── click-wrap: sign-up boxes and the re-accept dialog (v21.30) ──
  // {terms} and {privacy} become links (lib/legal.js fillSlots).
  "legal.agree":        { en: "I agree to the {terms} and have read the {privacy}",
                          th: "ฉันยอมรับ{terms}และได้อ่าน{privacy}แล้ว" },
  "legal.age":          { en: "I am at least 18 years old, and if I am under 20 my parent or guardian agrees",
                          th: "ฉันมีอายุ 18 ปีขึ้นไป และหากอายุยังไม่ถึง 20 ปี บิดามารดาหรือผู้ปกครองของฉันยินยอมแล้ว" },
  // The documents' full names, as their pages title them; the footer's short
  // link labels (legal.terms / legal.privacy) are further down.
  "legal.termsName":    { en: "Terms of Service",   th: "ข้อกำหนดการใช้งาน" },
  "legal.privacyName":  { en: "Privacy Notice",     th: "ประกาศความเป็นส่วนตัว" },
  "legal.newTab":       { en: "(opens in a new tab)", th: "(เปิดในแท็บใหม่)" },
  "legal.tickBoth":     { en: "Tick both boxes to create your account.", th: "โปรดทำเครื่องหมายทั้งสองช่องเพื่อสร้างบัญชี" },
  "legal.updatedTitle": { en: "We've updated our Terms and Privacy Notice", th: "เราได้ปรับปรุงข้อกำหนดการใช้งานและประกาศความเป็นส่วนตัว" },
  "legal.updatedBody":  { en: "Please read the {terms} and the {privacy}. To keep using your account, accept them below, or sign out.",
                          th: "โปรดอ่าน{terms}และ{privacy} หากต้องการใช้บัญชีต่อ โปรดกดยอมรับด้านล่าง หรือออกจากระบบ" },
  "legal.version":      { en: "Version {version}",  th: "ฉบับวันที่ {version}" },
  "legal.accept":       { en: "Accept and continue", th: "ยอมรับและใช้งานต่อ" },
  "legal.acceptFailed": { en: "Could not save your acceptance. Try again.", th: "บันทึกการยอมรับไม่สำเร็จ โปรดลองอีกครั้ง" },

  // ── privacy notes (v21.30) — public claims: each must stay literally true ──
  /* Kinds are listed, not "all personal data": student IDs are detected but
     deliberately left readable for the teacher (sensitive.js maskValue). */
  "columns.pdpaNotice": {
    en: "Detected Thai IDs, phone numbers, names, birth dates, emails and card or bank numbers are masked here, and the values of every column detected as personal data are left out of what the AI sees. Your original file is not changed — it is stored only if you save the dataset.",
    th: "เลขบัตรประชาชน เบอร์โทร ชื่อ วันเกิด อีเมล และเลขบัตรเครดิต/เดบิตหรือเลขบัญชีธนาคารที่ระบบตรวจพบจะถูกปิดบังในหน้านี้ และค่าในทุกคอลัมน์ที่ตรวจพบว่าเป็นข้อมูลส่วนบุคคลจะไม่ถูกส่งให้ AI ไฟล์ต้นฉบับของคุณไม่ถูกแก้ไข — และจะถูกเก็บไว้ก็ต่อเมื่อคุณบันทึกชุดข้อมูลเท่านั้น" },
  // The share page shows the same panel to someone who is not the owner.
  "columns.pdpaNoticeShared": {
    en: "Detected personal data (e.g. Thai ID, phone, name, birth date, email, card or bank number) is masked or hidden in this shared report.",
    th: "ข้อมูลส่วนบุคคลที่ระบบตรวจพบ (เช่น เลขบัตรประชาชน เบอร์โทร ชื่อ วันเกิด อีเมล เลขบัตรเครดิต/เดบิต หรือเลขบัญชีธนาคาร) ถูกปิดบังหรือซ่อนไว้ในรายงานที่แชร์นี้" },
  "classReport.privacy": {
    en: "Computed on DAB's server from your file, for you only — not sent to the AI and not included in share links.",
    th: "คำนวณบนเซิร์ฟเวอร์ของ DAB จากไฟล์ของคุณ แสดงให้คุณเห็นเท่านั้น — ไม่ส่งให้ AI และไม่รวมอยู่ในลิงก์แชร์" },
  "workspace.schedulesSoon": { en: "Scheduled reports — coming soon", th: "รายงานตามกำหนดเวลา — เปิดให้ใช้เร็ว ๆ นี้" },

  // ── AI label (v21.30) — must equal backend/src/services/aiLabel.js (i18n.test.js checks) ──
  "ai.label": {
    en: "AI-generated — may be wrong. Check it before you rely on it.",
    th: "สร้างโดย AI — อาจผิดพลาดได้ โปรดตรวจสอบก่อนนำไปใช้" },

  // ── share links (v21.30) — the dialog is the only way to make one ──
  "share.button":       { en: "Share",              th: "แชร์" },
  "share.dialogTitle":  { en: "Share this report",  th: "แชร์รายงานนี้" },
  /* Load-bearing: "anyone with the link" and "until it expires". Only the
     VALUES of detected personal-data columns are withheld — their names stay
     on the page, so the sentence says values, not columns. */
  "share.warning": {
    en: "Anyone with the link can see this report — the AI text, column names, statistics and chart — until it expires. Values in columns detected as personal data are hidden.",
    th: "ทุกคนที่มีลิงก์จะเห็นรายงานนี้ได้ ทั้งข้อความจาก AI ชื่อคอลัมน์ สถิติ และกราฟ จนกว่าลิงก์จะหมดอายุ ค่าในคอลัมน์ที่ระบบตรวจพบว่าเป็นข้อมูลส่วนบุคคลจะถูกซ่อนไว้" },
  "share.titleLabel":   { en: "Title shown on the page", th: "ชื่อที่แสดงบนหน้ารายงาน" },
  "share.defaultTitle": { en: "Analysis report",    th: "รายงานผลการวิเคราะห์" },
  "share.expiry":       { en: "Link expires after", th: "ลิงก์หมดอายุหลังจาก" },
  "share.day":          { en: "day",                th: "วัน" },
  "share.days":         { en: "days",               th: "วัน" },
  "share.password":     { en: "Password (optional)", th: "รหัสผ่าน (ไม่บังคับ)" },
  "share.passwordHint": { en: "Viewers must enter it before the report opens.",
                          th: "ผู้ชมต้องใส่รหัสผ่านนี้ก่อนจึงจะเปิดรายงานได้" },
  "share.create":       { en: "Create link and copy", th: "สร้างลิงก์และคัดลอก" },
  "share.copied":       { en: "Link created and copied to the clipboard.", th: "สร้างลิงก์และคัดลอกไปยังคลิปบอร์ดแล้ว" },
  "share.copyManually": { en: "Link created. Copy it from the box below.", th: "สร้างลิงก์แล้ว คัดลอกจากช่องด้านล่างได้เลย" },
  "share.linkLabel":    { en: "Share link",         th: "ลิงก์สำหรับแชร์" },
  "share.expiresOn":    { en: "This link expires on", th: "ลิงก์นี้จะหมดอายุในวันที่" },
  "share.reportPage":   { en: "Report this page",   th: "แจ้งปัญหาหน้านี้" },

  // ── legal links — shared by every page that links the notices ──
  "legal.privacy":      { en: "Privacy",            th: "ความเป็นส่วนตัว" },
  "legal.terms":        { en: "Terms",              th: "ข้อกำหนดการใช้งาน" },
  "legal.storage":      { en: "Storage",            th: "การจัดเก็บในเบราว์เซอร์" },
  "legal.contact":      { en: "Contact",            th: "ติดต่อ" },
  "legal.licences":     { en: "Licences",           th: "สัญญาอนุญาต" },
  "legal.nav":          { en: "Legal",              th: "ข้อมูลทางกฎหมาย" },

  // ── common ──
  "common.cancel":      { en: "Cancel",             th: "ยกเลิก" },
  "common.close":       { en: "Close",              th: "ปิด" },
  "common.loading":     { en: "Loading…",           th: "กำลังโหลด…" },
  "common.error":       { en: "Something went wrong", th: "เกิดข้อผิดพลาด" },
  "common.retry":       { en: "Try again",          th: "ลองใหม่" },
};

/* ── the tiny store ───────────────────────────────────────
   useSyncExternalStore rather than context: language is read by leaf
   components all over the tree, and a context provider would re-render the
   whole app on every toggle. */
/* Guarded because this module is imported by tests running in plain Node,
   where localStorage does not exist. Reading it at import time without this
   throws before a single test runs. */
const hasStorage = typeof localStorage !== "undefined";
/* Default is Thai: the product is Thai-first and every body string exists in
   Thai, while English coverage is partial (nav + shared labels). Defaulting to
   "en" painted an EN-highlighted toggle over a Thai page on first visit. */
const read = () => (hasStorage && localStorage.getItem(KEY) === "en" ? "en" : "th");
let current = read();
const listeners = new Set();

export function setLang(next) {
  const lang = next === "th" ? "th" : "en";
  if (lang === current) return;
  current = lang;
  if (hasStorage) localStorage.setItem(KEY, lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

/* Sync the document language on load, not only on toggle. index.html ships
   lang="en"; without this a returning Thai visitor gets Thai text under an
   English lang attribute, which affects screen-reader pronunciation and font
   fallback. */
if (typeof document !== "undefined") document.documentElement.lang = current;

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => current;

/** Translate one key. Falls back to English, then to the key itself. */
export function t(key, lang = current) {
  const entry = STRINGS[key];
  if (!entry) return key;                       // visible in the UI, so it gets noticed
  return entry[lang] ?? entry.en ?? key;
}

/** `const { t, lang, setLang } = useLang();` */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { lang, setLang, t: (key) => t(key, lang) };
}

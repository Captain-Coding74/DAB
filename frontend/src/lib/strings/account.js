/**
 * lib/strings/account.js — the /account page (v21.30): your data, and
 * deleting the account. A string pack (lib/i18n.js addStrings): imported by
 * pages/AccountPage.jsx, a lazy route, so these strings load with it.
 * lib/account.js returns the account.* error keys this pack defines.
 */
import { addStrings } from "../i18n.js";   // explicit .js: packs are loaded by tests under plain Node

export const ACCOUNT_STRINGS = addStrings({
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
  /* v21.30: "everything" except the traffic log — kept for officials under the
     Computer-Related Crime Act, and sent to the user on request (Privacy Notice §12). */
  "account.exportBody": { en: "One JSON file with what DAB holds about you: your profile, workspaces and roles, stored datasets (the details of every version) and the versions you added to other people's, analyses, chat, share links, comments, notifications, activity, the sign-in log and upload statistics. Not included: your traffic-log entries, which we send you if you ask by email or post.",
                          th: "ไฟล์ JSON ไฟล์เดียวที่รวมข้อมูลที่ DAB เก็บเกี่ยวกับคุณ ได้แก่ ข้อมูลบัญชี พื้นที่ทำงานและบทบาท ชุดข้อมูลที่จัดเก็บไว้ (รายละเอียดทุกเวอร์ชัน) และเวอร์ชันที่คุณเพิ่มให้ชุดข้อมูลของผู้อื่น ผลการวิเคราะห์ แชท ลิงก์แชร์ ความคิดเห็น การแจ้งเตือน กิจกรรม บันทึกการเข้าสู่ระบบ และสถิติการอัปโหลด ที่ไม่รวมอยู่: รายการในบันทึกข้อมูลจราจรทางคอมพิวเตอร์ของคุณ ซึ่งเราจะส่งให้เมื่อคุณขอทางอีเมลหรือไปรษณีย์" },
  "account.exportButton":{ en: "Download my data (JSON)", th: "ดาวน์โหลดข้อมูลของฉัน (JSON)" },
  "account.exportFailed":{ en: "Could not prepare your data. Try again.", th: "เตรียมข้อมูลไม่สำเร็จ โปรดลองใหม่" },
  "account.filesTitle": { en: "Original files stored for you", th: "ไฟล์ต้นฉบับที่จัดเก็บไว้ให้คุณ" },
  "account.filesHint":  { en: "Your download lists these files; get each original here.", th: "ไฟล์ที่ดาวน์โหลดมีรายการไฟล์เหล่านี้ ดาวน์โหลดไฟล์ต้นฉบับแต่ละไฟล์ได้ที่นี่" },
  "account.filesNone":  { en: "No original files are stored.", th: "ไม่มีไฟล์ต้นฉบับที่จัดเก็บไว้" },
  /* v21.30: each stored file and share link, with its own delete. */
  "account.storedTitle":{ en: "Stored files",       th: "ไฟล์ที่จัดเก็บไว้" },
  "account.storedBody": { en: "The original files DAB keeps for you. Each stays until you delete it here, or until it has gone 365 days without use. Deleting one also deletes its analyses, chat and share links.",
                          th: "ไฟล์ต้นฉบับที่ DAB เก็บไว้ให้คุณ แต่ละไฟล์จะอยู่จนกว่าคุณจะลบที่นี่ หรือจนกว่าจะไม่มีการใช้งานครบ 365 วัน การลบไฟล์จะลบผลวิเคราะห์ แชท และลิงก์แชร์ของไฟล์นั้นด้วย" },
  "account.storedAuto": { en: "Stored automatically by an earlier version of DAB, without asking you", th: "DAB รุ่นก่อนจัดเก็บไว้โดยอัตโนมัติ โดยไม่ได้ถามคุณ" },
  "account.storedTrash":{ en: "In Trash: deleted for good 30 days after it went there", th: "อยู่ในถังขยะ: จะถูกลบถาวรเมื่อครบ 30 วันนับจากวันที่ย้ายไป" },
  "account.rows":       { en: "rows",               th: "แถว" },
  "account.analyseAgain": { en: "Analyse again",    th: "วิเคราะห์อีกครั้ง" },
  "account.delete":     { en: "Delete",             th: "ลบ" },
  "account.confirmDelete": { en: "Delete for good", th: "ยืนยันลบถาวร" },
  "account.fileDeleted":{ en: "Deleted, with its analyses, chat and share links", th: "ลบแล้ว พร้อมผลวิเคราะห์ แชท และลิงก์แชร์ของไฟล์นี้" },
  "account.linksTitle": { en: "Share links",        th: "ลิงก์แชร์" },
  "account.linksBody":  { en: "Anyone with one of these links can see its report until it expires. Revoking a link deletes it at once.",
                          th: "ทุกคนที่มีลิงก์เหล่านี้ดูรายงานได้จนกว่าลิงก์จะหมดอายุ การยกเลิกลิงก์จะลบลิงก์นั้นทันที" },
  "account.linksNone":  { en: "You have no share links.", th: "คุณยังไม่มีลิงก์แชร์" },
  "account.expires":    { en: "expires",            th: "หมดอายุ" },
  "account.expired":    { en: "expired",            th: "หมดอายุแล้ว" },
  "account.views":      { en: "views",              th: "ครั้งที่เปิดดู" },
  "account.revoke":     { en: "Revoke",             th: "ยกเลิกลิงก์" },
  "account.revoked":    { en: "Link revoked and deleted", th: "ยกเลิกและลบลิงก์แล้ว" },
  "account.listFailed": { en: "Could not load this list. Reload the page to try again.", th: "โหลดรายการไม่สำเร็จ โปรดโหลดหน้านี้ใหม่" },
  "account.actionFailed": { en: "That did not work. Try again.", th: "ทำรายการไม่สำเร็จ โปรดลองใหม่" },
  "account.download":   { en: "Download",           th: "ดาวน์โหลด" },
  "account.deleteTitle":{ en: "Delete my account",  th: "ลบบัญชีของฉัน" },
  "account.deleteNow":  { en: "Deleted immediately: your account and everything it owns — saved files and datasets, analyses, chat, share links, comments (with the replies under them), notifications and workspace memberships.",
                          th: "ลบทันที: บัญชีของคุณและทุกอย่างที่เป็นของบัญชีนี้ ได้แก่ ไฟล์และชุดข้อมูลที่บันทึกไว้ ผลการวิเคราะห์ แชท ลิงก์แชร์ ความคิดเห็น (รวมถึงคำตอบใต้ความคิดเห็นนั้น) การแจ้งเตือน และการเป็นสมาชิกพื้นที่ทำงาน" },
  /* Literally what db/accountErase.js does — keep the two in step. */
  "account.deleteWorkspaces": { en: "A workspace you own stays with its other owner, if any; otherwise it passes to the earliest-joined remaining admin, then the earliest-joined member. Viewers never inherit: a workspace with no one else in those roles is deleted, and other people's datasets in it move to their own space. A version you added to someone else's dataset stays with its owner.",
                          th: "พื้นที่ทำงานที่คุณเป็นเจ้าของจะอยู่กับเจ้าของอีกคนหากมี หากไม่มีจะโอนให้ผู้ดูแล (admin) ที่เข้าร่วมก่อนสุดซึ่งยังอยู่ แล้วจึงเป็นสมาชิก (member) ที่เข้าร่วมก่อนสุด ผู้ดู (viewer) ไม่ได้รับโอน พื้นที่ทำงานที่ไม่เหลือผู้มีบทบาทเหล่านี้จะถูกลบ และชุดข้อมูลของผู้อื่นในพื้นที่นั้นจะย้ายไปอยู่ในพื้นที่ของเจ้าของชุดข้อมูล เวอร์ชันที่คุณเพิ่มให้ชุดข้อมูลของผู้อื่นจะยังอยู่กับเจ้าของชุดข้อมูลนั้น" },
  "account.deleteKept": { en: "Kept after deletion: traffic-log entries until their 90-day retention ends (a legal duty), and a privacy-request log entry holding only a one-way hash of your user ID, kept for 3 years to show your request was handled. Upload statistics with no names or values stay, no longer linked to you.",
                          th: "สิ่งที่ยังเก็บไว้หลังลบ: บันทึกข้อมูลจราจรทางคอมพิวเตอร์ (traffic log) จนครบระยะเก็บ 90 วัน (ตามที่กฎหมายกำหนด) และรายการในบันทึกคำขอด้านความเป็นส่วนตัวซึ่งมีเพียงค่าแฮชทางเดียวของรหัสผู้ใช้ เก็บไว้ 3 ปีเพื่อแสดงว่าคำขอของคุณได้รับการดำเนินการแล้ว ส่วนสถิติการอัปโหลดที่ไม่มีชื่อหรือค่าข้อมูลจะยังอยู่ แต่ไม่เชื่อมโยงกับคุณอีกต่อไป" },
  "account.deleteUndo": { en: "This cannot be undone. Download your data first if you want a copy.",
                          th: "การลบนี้ย้อนกลับไม่ได้ หากต้องการเก็บสำเนา โปรดดาวน์โหลดข้อมูลของคุณก่อน" },
  "account.typeUsername":{ en: "Type your username to confirm", th: "พิมพ์ชื่อผู้ใช้ของคุณเพื่อยืนยัน" },
  "account.deleteButton":{ en: "Delete my account permanently", th: "ลบบัญชีของฉันถาวร" },
  "account.deleted":    { en: "Your account has been deleted", th: "ลบบัญชีของคุณแล้ว" },
  "account.passwordRequired": { en: "Enter your password", th: "กรุณากรอกรหัสผ่าน" },
  "account.wrongPassword": { en: "Wrong password",  th: "รหัสผ่านไม่ถูกต้อง" },
  "account.tooMany":    { en: "Too many attempts. Wait 15 minutes.", th: "ลองหลายครั้งเกินไป โปรดรอ 15 นาที" },
  "account.deleteFailed": { en: "Could not delete your account. Try again, or contact us.", th: "ลบบัญชีไม่สำเร็จ โปรดลองใหม่ หรือติดต่อเรา" },
});

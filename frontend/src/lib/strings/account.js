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
});

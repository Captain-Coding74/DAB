/**
 * lib/strings/auth.js — sign-in, sign-up and the click-wrap (v21.30). A
 * string pack (lib/i18n.js addStrings): imported by components/legal/
 * LegalText.jsx, which the sign-up page and the re-accept dialog both
 * render. (auth.username and auth.password stay in lib/i18n.js: the account
 * page shows them too, and two importers would split this pack into a chunk
 * of its own.)
 *
 * {terms} and {privacy} become links (lib/legal.js fillSlots). legal.termsName
 * and legal.privacyName are the documents' full names, as their pages title
 * them; the footer's short link labels (legal.terms / legal.privacy) stay in
 * lib/i18n.js, because the app shell renders them on first paint.
 */
import { addStrings } from "../i18n.js";   // explicit .js: packs are loaded by tests under plain Node

export const AUTH_STRINGS = addStrings({
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
  "legal.agree":        { en: "I agree to the {terms} and have read the {privacy}",
                          th: "ฉันยอมรับ{terms}และได้อ่าน{privacy}แล้ว" },
  "legal.age":          { en: "I am at least 18 years old, and if I am under 20 my parent or guardian agrees",
                          th: "ฉันมีอายุ 18 ปีขึ้นไป และหากอายุยังไม่ถึง 20 ปี บิดามารดาหรือผู้ปกครองของฉันยินยอมแล้ว" },
  "legal.termsName":    { en: "Terms of Service",   th: "ข้อกำหนดการใช้งาน" },
  "legal.privacyName":  { en: "Privacy Notice",     th: "ประกาศความเป็นส่วนตัว" },
  "legal.newTab":       { en: "(opens in a new tab)", th: "(เปิดในแท็บใหม่)" },
  "legal.tickBoth":     { en: "Tick both boxes to create your account.", th: "โปรดทำเครื่องหมายทั้งสองช่องเพื่อสร้างบัญชี" },
  "legal.updatedTitle": { en: "We've updated our Terms and Privacy Notice", th: "เราได้ปรับปรุงข้อกำหนดการใช้งานและประกาศความเป็นส่วนตัว" },
  "legal.updatedBody":  { en: "Please read the {terms} and the {privacy}. To keep using your account, accept them below, or sign out.",
                          th: "โปรดอ่าน{terms}และ{privacy} หากต้องการใช้บัญชีต่อ โปรดกดยอมรับด้านล่าง หรือออกจากระบบ" },
  /* v21.30: declining stays possible — /account is open behind the gate. */
  "legal.decline":      { en: "Rather not accept? {account} stays open: download your data or delete your account there.",
                          th: "ไม่ต้องการยอมรับใช่หรือไม่ {account}ยังเปิดให้ใช้ได้ คุณดาวน์โหลดข้อมูลหรือลบบัญชีได้ที่นั่น" },
  "legal.accountName":  { en: "Your Account page", th: "หน้าบัญชีของคุณ" },
  "legal.version":      { en: "Version {version}",  th: "ฉบับวันที่ {version}" },
  "legal.accept":       { en: "Accept and continue", th: "ยอมรับและใช้งานต่อ" },
  "legal.acceptFailed": { en: "Could not save your acceptance. Try again.", th: "บันทึกการยอมรับไม่สำเร็จ โปรดลองอีกครั้ง" },
});

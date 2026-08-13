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

  // ── auth ──
  "auth.username":      { en: "Username",           th: "ชื่อผู้ใช้" },
  "auth.password":      { en: "Password",           th: "รหัสผ่าน" },
  "auth.email":         { en: "Email (optional)",   th: "อีเมล (ไม่บังคับ)" },
  "auth.signIn":        { en: "Sign in",            th: "เข้าสู่ระบบ" },
  "auth.register":      { en: "Create account",     th: "สมัครสมาชิก" },
  "auth.toRegister":    { en: "No account yet? Create one", th: "ยังไม่มีบัญชี? สมัครเลย" },
  "auth.toSignIn":      { en: "Already have an account? Sign in", th: "มีบัญชีแล้ว? เข้าสู่ระบบ" },

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
const read = () => (hasStorage && localStorage.getItem(KEY) === "th" ? "th" : "en");
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

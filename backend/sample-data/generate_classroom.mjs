/**
 * sample-data/generate_classroom.mjs — สร้างชุดข้อมูลตัวอย่าง "วิจัยในชั้นเรียน"
 *
 * Generates classroom.csv — the School Edition demo sample. Run once, commit
 * the CSV; the server only ever reads the static file (no Math.random at
 * request time). Kept next to the CSV so anyone can see the data is SYNTHETIC
 * and regenerate it:   node sample-data/generate_classroom.mjs
 *
 * Design targets (ทำไมตัวเลขถึงหน้าตาแบบนี้):
 *   · คะแนนก่อนเรียน  out of 30, mean ≈ 16
 *   · คะแนนหลังเรียน  = ก่อนเรียน + gain(mean ≈ 5) → paired t-test มีนัยสำคัญ
 *   · งาน1/งาน2 mean ≈ 8, งาน3 mean ≈ 5 → งาน3 ยากที่สุดอย่างเห็นได้ชัด
 *   · q1..q5 Likert 1-5 share a common base value → Cronbach's alpha ≈ 0.7-0.85
 *   · เว้นว่างบางช่องคะแนน เพื่อโชว์การจัดการ missing data
 *   · บัตรประชาชน: เลขสังเคราะห์ 13 หลัก checksum mod-11 ถูกต้อง (ไม่ใช่เลขจริง)
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Seeded PRNG (mulberry32) — same seed, same file, forever ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260824);            // seed = date of School Edition v1
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// Box-Muller — standard normal from two uniforms
function randNorm() {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clampRound = (x, lo, hi) => Math.round(Math.min(hi, Math.max(lo, x)));

/**
 * เลขบัตรประชาชนสังเคราะห์ — 12 หลักสุ่ม + หลักตรวจสอบ mod-11 ที่คำนวณจริง
 * (synthetic 13-digit Thai citizen id with a VALID mod-11 check digit, so the
 * app's PII guard has something realistic to catch — no real ids anywhere)
 */
function syntheticCitizenId() {
  const d = [randInt(1, 8)];                       // หลักแรก 1-8 เหมือนเลขจริง
  for (let i = 1; i < 12; i++) d.push(randInt(0, 9));
  const sum = d.reduce((s, digit, i) => s + digit * (13 - i), 0);
  d.push((11 - (sum % 11)) % 10);                  // หลักที่ 13 = check digit
  return d.join("");
}

const FIRST = [
  "ภูมิพัฒน์","ณัฐธิดา","ธนกฤต","พิมพ์ชนก","ศุภกร","ขวัญข้าว","กฤตภาส","นิชาภา","อชิตพล","พิชญา",
  "จิรายุ","สุธิมา","ธีรเดช","ปาณิสรา","วรินทร","กมลชนก","ศิวกร","อริสา","ธนภัทร","นภัสรา",
  "พงศกร","จิดาภา","วีรภัทร","ชาลิสา","ฐานภัทร","มนัสนันท์","ศุภวิชญ์","ปริญาภรณ์","อภิวิชญ์","พรปวีณา",
  "กิตติธัช","สุพิชญา","เตชินท์","นันท์นภัส","ธนวัฒน์","พิมพ์มาดา","ศรัณย์ภัทร","ณัฐณิชา","ภคิน","อัญชลี",
];
const LAST = [
  "ใจดี","รักษาธรรม","ทองสุข","ศรีสุวรรณ","พงษ์พัฒน์","แสงทอง","บุญมาก","วงศ์วิเศษ","สุขสวัสดิ์","กล้าหาญ",
  "ชูเกียรติ","พูนสุข","เจริญยศ","ศรีบุญเรือง","ทองอินทร์","มั่นคง","พิทักษ์ธรรม","สุวรรณศรี","นพเก้า","บุญโชติ",
  "วัฒนธรรม","ศรีเมือง","คำดี","ทองดี","พัฒนากิจ","แก้วมณี","ธนะเจริญ","สิงห์โต","เพชรสุวรรณ","อินทร์จันทร์",
  "ประเสริฐกุล","ศุภชีพ","เลิศล้ำ","กิตติชัย","สายบุญ","นิลวรรณ","จันทรเที่ยง","อุดมสุข","เขียวขจี","มณีรัตน์",
];
/* คำนำหน้า ม.3 (อายุ 14-15): เด็กชาย/เด็กหญิง สลับตาม index — deterministic,
   ไม่ดึง rng เพิ่ม เพื่อให้ค่า seeded เดิมทุกตัวคงเดิม */
const fullName = (i) => `${i % 2 === 0 ? "เด็กชาย" : "เด็กหญิง"}${FIRST[i]} ${LAST[i]}`;

const NICKNAMES = [
  "มายด์","บีม","กาย","ปลื้ม","เฟิร์น","แพรว","ภูมิ","เนย","ออม","ต้น",
  "ไอซ์","ฟ้า","น้ำ","ขวัญ","เจเจ","บอส","กัน","พลอย","มิ้นท์","แบม",
  "เอิร์ธ","โฟกัส","ตังเม","ข้าวหอม","ปั้น","กิ๊ฟ","นุ่น","เตย","บุ๋ม","แม็ค",
  "โอ๊ต","จูน","แพท","เมย์","ไนซ์","ดรีม","พีช","ก้อง","มุก","เบล",
];
const N = NICKNAMES.length;                        // 40 นักเรียน

// เว้นว่างเป็นบางช่อง (row index → column) เพื่อให้เห็น missing-data handling
const BLANKS = {
  4:  ["คะแนนก่อนเรียน"],
  12: ["งาน2"],
  21: ["คะแนนหลังเรียน"],
  30: ["งาน3"],
  35: ["งาน1"],
};

const HEADERS = ["เลขประจำตัว","บัตรประชาชน","ชื่อ-สกุล","ชื่อเล่น","วันเกิด",
  "คะแนนก่อนเรียน","คะแนนหลังเรียน","งาน1","งาน2","งาน3","q1","q2","q3","q4","q5"];

const rows = [];
for (let i = 0; i < N; i++) {
  const pre  = clampRound(16 + 4 * randNorm(), 5, 27);           // เต็ม 30
  const post = Math.min(30, pre + clampRound(5 + 2 * randNorm(), 0, 11));
  const row = {
    "เลขประจำตัว":   String(26501 + i),                          // เลข 5 หลักตามทะเบียน
    "บัตรประชาชน":   syntheticCitizenId(),
    "ชื่อ-สกุล":      fullName(i),
    "ชื่อเล่น":       NICKNAMES[i],
    "วันเกิด":        `${randInt(2010, 2011)}-${String(randInt(1, 12)).padStart(2, "0")}-${String(randInt(1, 28)).padStart(2, "0")}`,
    "คะแนนก่อนเรียน": pre,
    "คะแนนหลังเรียน": post,
    "งาน1": clampRound(8   + 1.2 * randNorm(), 4, 10),           // เต็ม 10
    "งาน2": clampRound(7.8 + 1.3 * randNorm(), 3, 10),
    "งาน3": clampRound(5   + 1.5 * randNorm(), 1, 9),            // ชิ้นที่ยากที่สุด
  };
  // q1..q5 — ทัศนคติร่วมฐานเดียวกัน + noise เล็กน้อย → items intercorrelated
  const base = 3.7 + 0.65 * randNorm();
  for (let q = 1; q <= 5; q++) row[`q${q}`] = clampRound(base + 0.60 * randNorm(), 1, 5);
  for (const col of BLANKS[i] || []) row[col] = "";
  rows.push(row);
}

// ── Sanity report — พิมพ์สถิติเพื่อยืนยันว่าได้ตามเป้าก่อน commit ──
const num = (col) => rows.map(r => r[col]).filter(v => v !== "").map(Number);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const variance = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };

const paired = rows.filter(r => r["คะแนนก่อนเรียน"] !== "" && r["คะแนนหลังเรียน"] !== "")
                   .map(r => r["คะแนนหลังเรียน"] - r["คะแนนก่อนเรียน"]);
const t = mean(paired) / Math.sqrt(variance(paired) / paired.length);

const items = [1, 2, 3, 4, 5].map(q => num(`q${q}`));
const totals = items[0].map((_, i) => items.reduce((s, it) => s + it[i], 0));
const alpha = (5 / 4) * (1 - items.reduce((s, it) => s + variance(it), 0) / variance(totals));

console.log({
  preMean: +mean(num("คะแนนก่อนเรียน")).toFixed(2),
  postMean: +mean(num("คะแนนหลังเรียน")).toFixed(2),
  gainMean: +mean(paired).toFixed(2), pairedT: +t.toFixed(2),
  งาน1: +mean(num("งาน1")).toFixed(2), งาน2: +mean(num("งาน2")).toFixed(2), งาน3: +mean(num("งาน3")).toFixed(2),
  cronbachAlpha: +alpha.toFixed(3),
});

const csv = [HEADERS.join(","), ...rows.map(r => HEADERS.map(h => r[h]).join(","))].join("\n") + "\n";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "classroom.csv");
writeFileSync(out, "﻿" + csv, "utf8");        // BOM เพื่อให้ Excel ไทยเปิดอ่านได้
console.log(`wrote ${out} (${rows.length} rows)`);

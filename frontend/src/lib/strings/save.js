/**
 * lib/strings/save.js — the Save-dataset dialog (v21.30). A string pack
 * (lib/i18n.js addStrings): imported by components/dashboard/
 * SaveDatasetDialog.jsx, which loads on the first "Save dataset". The button
 * and the hints around it render on first paint and stay in lib/i18n.js.
 */
import { addStrings } from "../i18n.js";   // explicit .js: packs are loaded by tests under plain Node

export const SAVE_STRINGS = addStrings({
  "save.title":         { en: "Save this dataset?", th: "บันทึกชุดข้อมูลนี้หรือไม่" },
  "save.body":          { en: "Save the original file to DAB so you can run hypothesis tests and re-analyse it later from your Account page. It is kept until you delete it there, or after 365 days without use.",
                          th: "บันทึกไฟล์ต้นฉบับไว้ใน DAB เพื่อใช้ทดสอบสมมติฐานและวิเคราะห์ซ้ำภายหลังจากหน้าบัญชีของคุณ ไฟล์จะถูกเก็บไว้จนกว่าคุณจะลบที่หน้านั้น หรือจนกว่าจะไม่มีการใช้งานครบ 365 วัน" },
  "save.retention":     { en: "How long DAB keeps data", th: "DAB เก็บข้อมูลไว้นานเท่าใด" },
  "save.confirm":       { en: "Save",               th: "บันทึก" },
  "save.rosterNote":    { en: "This file looks like a class roster, so saving it needs your confirmation.",
                          th: "ไฟล์นี้มีลักษณะเป็นรายชื่อนักเรียน จึงต้องยืนยันก่อนบันทึก" },
  "save.school":        { en: "I am authorised by my school to process these students' data, and I will delete it when it is no longer needed",
                          th: "ข้าพเจ้าได้รับอนุญาตจากโรงเรียนให้ประมวลผลข้อมูลของนักเรียนเหล่านี้ และจะลบข้อมูลเมื่อไม่มีความจำเป็นต้องใช้แล้ว" },
  "save.failed":        { en: "Could not save the dataset", th: "บันทึกชุดข้อมูลไม่สำเร็จ" },
});

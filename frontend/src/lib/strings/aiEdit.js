/**
 * lib/strings/aiEdit.js — the confirmation before AI edit sends rows
 * (v21.30). A string pack (lib/i18n.js addStrings): imported by
 * components/dashboard/AiEditConfirm.jsx, which loads when the dialog opens.
 */
import { addStrings } from "../i18n.js";   // explicit .js: packs are loaded by tests under plain Node

export const AI_EDIT_STRINGS = addStrings({
  "aiEdit.confirmTitle":{ en: "Send these rows to the AI?", th: "ส่งข้อมูลเหล่านี้ให้ AI หรือไม่" },
  "aiEdit.confirmRows": { en: "{rows} rows of these columns will be sent to Anthropic (USA) to carry out your instruction:",
                          th: "ข้อมูล {rows} แถวจากคอลัมน์ต่อไปนี้จะถูกส่งไปยัง Anthropic (สหรัฐอเมริกา) เพื่อแก้ไขตามคำสั่งของคุณ:" },
  "aiEdit.leftOut":     { en: "Detected personal-data columns that stay on the server:",
                          th: "คอลัมน์ข้อมูลส่วนบุคคลที่ตรวจพบ ซึ่งจะไม่ถูกส่งออกจากเซิร์ฟเวอร์:" },
  "aiEdit.noneDetected":{ en: "No personal-data columns were detected. Check the columns above before you send.",
                          th: "ไม่พบคอลัมน์ข้อมูลส่วนบุคคล โปรดตรวจรายชื่อคอลัมน์ด้านบนก่อนส่ง" },
  "aiEdit.send":        { en: "Send",               th: "ส่ง" },
  "ai.howWeUse":        { en: "How DAB uses AI",    th: "DAB ใช้ AI อย่างไร" },
});

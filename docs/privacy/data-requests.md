Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Handling data-subject requests

How to handle a request to access, copy, correct, delete, restrict or object to the use of personal data (PDPA ss.30–36), whichever way it arrives. Section 8 covers reports about shared pages, which arrive at the same address.

What the public pages promise (`/privacy#rights`, `/contact#requests`): requests by email or post; self-service download and account deletion at `/account`; an answer within 30 days of receiving the request, free of charge; a reason whenever we cannot do what is asked; a record of each request kept for 3 years.

## 1. Channels

| Channel | What it covers | Verified by |
|---|---|---|
| `/account` (self-service, signed in) | Download all my data (JSON); delete my account (password required) | The password. These requests log themselves in `privacy_requests` |
| Email to `LEGAL_CONTACT_EMAIL` | Everything | Section 4 |
| Post (registered mail accepted) to `LEGAL_POSTAL_ADDRESS` | Everything | Section 4 |

The PDPC access-request Notification (in force 14 September 2026) asks for at least two channels, including submission in person at the business location and registered mail. Whether an online-only individual meets it with email plus post is lawyer question 3 in `README.md`. Until it is answered, accept any request that reaches you some other way, too.

## 2. Deadlines

| When | What |
|---|---|
| Day 0 (the day it arrives) | Log it (section 3, step 1) |
| Within 3 business days | Acknowledge it (template A) |
| Within 15 days | Finish checking identity; if information is missing, ask for it and give at least 15 days to provide it (the sources say 10 or 15; 15 meets both — lawyer question 3) |
| Within 30 days of receipt | Answer: done, partly done, or refused with the reason (templates B–E) |
| Within 90 days | Erasure reaches every copy, including any backups the host keeps (PDPC deletion Notification) |

The Notification counts 30 days from verification and allows a further 30 for complex cases; the public pages promise 30 days from receipt. Keep the public promise. If you cannot, write before day 30 saying why and when, and ask counsel whether the clock may pause while you wait for identity information.

## 3. Step by step

1. **Log it.** `node backend/src/scripts/privacy-request.mjs …` — see the script header for usage. It records the type of request, the channel and a one-way hash of the user id (or of whatever identifier a person without an account gave). Keep personal data out of the note. Write the request id at the top of the case file (the email thread or the letter).
2. **Work out whose data it is.** About the requester's own account → DAB is the controller: carry on. About them inside a file someone else uploaded → DAB is that user's processor: section 6.
3. **Check identity** (section 4).
4. **Act** (section 5).
5. **Reply** (section 9). Answer in the language the request was written in.
6. **Close the log entry** with the same script, as completed or refused, with the reason (no personal data) in the note.

## 4. Checking identity

- **Best:** ask the requester to sign in and use `/account`. The password proves the account is theirs, and both download and deletion happen at once.
- **When they cannot sign in** (DAB has no password reset): ask for the username, the email address on the account if they added one, roughly when they created it, and the name of one dataset, workspace or analysis in it. Compare with the database. An email address on file is a weak check on its own: DAB never verified it.
- **Someone acting for another person** (a parent, a lawyer): ask for proof of authority as well.
- Ask for a copy of an ID document only when nothing else will do. Delete it as soon as identity is confirmed, and note that you did.
- Never reveal whether an account exists to someone you have not verified.

## 5. What to do for each right

| Right | What to do | Tool |
|---|---|---|
| Access and a copy (s.30); portability (s.31) | Give the JSON export, and the original files of any saved datasets (the export lists each one's download path). Add, in the reply, the purposes, recipients and retention periods — link the Privacy Notice | `/account`, or the script's export command |
| Correction (s.35) | DAB has no screen to edit a profile. Email address: change or remove it on the database. Content of analyses and datasets is the user's own: they can delete it and upload a corrected file | `UPDATE users SET email = '<new address>' WHERE username = '<username>';` (or `email = NULL`) |
| Erasure (s.33) | Delete the account. Everything it owns goes at once. What stays, and why, is in template C | `/account`, or the script's delete command |
| Restriction (s.34) | Suspend the account: sign-in and token renewal stop at once; an access token already issued works until it expires (up to 15 minutes). The daily deletion jobs keep running; if the person needs data kept for a legal claim, export it as a legal hold (`retention-schedule.md` section 5). Undo with `is_active = 1` | `UPDATE users SET is_active = 0 WHERE username = '<username>';` |
| Objection (s.32) | Telemetry: unlink the user's rows at once (`legitimate-interests.md`, LIA 2). Security logs: continue only where there are compelling grounds, and record them (LIA 1). DAB does no direct marketing | `UPDATE upload_metadata SET user_id = NULL WHERE user_id = '<user id>';` |
| Withdrawing consent | DAB does not rely on consent; say so, and offer the other rights | — |

The SQL above works on both SQLite and Postgres. Find a user id with `SELECT id FROM users WHERE username = '<username>';`. Cached copies of the profile and History expire within two minutes, so a change made on the database shows in the app after that.

**Not in the export:** traffic-log entries. No API exposes them. Whether a requester may have a copy of their own entries is a question for counsel (`README.md`, further questions). Until it is answered, tell the requester the log exists, what it holds (event, time, IP address, user id) and that it is kept 90 days.

## 6. Data inside someone else's upload

The people in a customer list or a gradebook may write to DAB directly. DAB is the processor for that data; the user who uploaded it, or their organisation, is the controller.

1. Do not search other users' files on the requester's behalf, and do not hand over another user's data.
2. Reply with template E: the controller decides, and the controller can correct or delete the data in DAB themselves.
3. If the requester identifies the upload (a share link, for example) and agrees, pass their message to the account holder. The owner of a share link is in `shared_reports.user_id`. DAB sends no email, so this works only if the account holder has written to you before.
4. If the content is unlawful or exposes the person on a public share link, treat it as a report (section 8) as well.

## 7. Refusals

Refuse, wholly or in part, only on a ground you can name:

- the law requires the data to be kept (traffic log for 90 days; the privacy-request log entry itself);
- the identity or authority of the requester could not be confirmed;
- the data is held only as a processor (section 6);
- giving it would reveal another person's personal data or harm their rights;
- a court order or the law forbids it;
- the request is manifestly unfounded or excessive (for example, repeated identical requests).

Always say which ground, what you did do, and that the person may complain to the PDPC (template D). Log the refusal with its reason. Even small businesses exempt from keeping records of processing must record refusals.

## 8. Reports about shared pages (`/contact#report`)

Every share page has a "Report this page" link to the contact page. The contact page says DAB aims to acknowledge reports within 3 business days and acts promptly on unlawful content (possibly disabling the link at once), and promises to record every notice and what was done. A working notice-and-takedown procedure is DAB's defence under the Computer-Related Crime Act s.15.

1. **Record** the report in the takedown register the day it arrives.
2. **Assess.** Clearly unlawful, or exposes someone's personal data: disable now. A formal notice under the Act (with a police report), an official request or a court order: disable at once — target within 24 hours of receipt — and keep a copy of the notice. Unclear: ask counsel, and disable meanwhile if the harm could be serious.
3. **Disable.** There is no operator screen. On the database, with the token (the part of the link after `/share/`), first note the owner and then delete the link:

   ```sql
   SELECT user_id, analysis_id, created_at, expires_at FROM shared_reports WHERE token = '<token>';
   DELETE FROM shared_reports WHERE token = '<token>';
   ```

   The link answers 404 from then on. Nothing else the owner holds is touched. Request logs do not show tokens (they are redacted), so take the token from the report.
4. **The owner.** DAB has no way to tell a link's owner: it sends no email and shows no notifications. If the owner asks, explain. The Terms (section 9) tell users links may be disabled without warning in urgent cases.
5. **Reply** to the reporter if they asked for a reply. Do not give them the owner's identity unless the law requires it.
6. **Close** the register entry.

| Ref | Received (date, time, channel) | Link token | Reason | Formal notice? (police report no., order) | Decision and reason | Disabled at | Reporter answered | Closed |
|---|---|---|---|---|---|---|---|---|

## 9. Reply templates

Replace everything in [brackets]. Send the English or the Thai version, matching the request.

**A — Received, and checking identity**

> Dear [name or username],
>
> Thank you for your request of [date] about your personal data at Data Analysis Bot (DAB) (reference [request id]). We will reply by [date 30 days after we received it], free of charge.
>
> The quickest way is to sign in at [site]/account, where you can download all your data or delete your account yourself, straight away. If you cannot sign in, or would rather we do it, please reply with your username, the email address on the account if you added one, roughly when you created the account, and the name of one dataset, workspace or analysis in it, so we can check the request comes from the account holder. Please do not send a copy of an ID card unless we ask for one. If we do not hear back within 15 days we will close the request; you can make it again at any time.

> เรียน คุณ[ชื่อ หรือชื่อผู้ใช้]
>
> ขอบคุณสำหรับคำขอเกี่ยวกับข้อมูลส่วนบุคคลของคุณที่ Data Analysis Bot (DAB) เมื่อวันที่ [วันที่] (เลขอ้างอิง [รหัสคำขอ]) เราจะตอบกลับภายในวันที่ [วันที่ครบ 30 วันนับจากวันที่ได้รับคำขอ] โดยไม่มีค่าใช้จ่าย
>
> วิธีที่เร็วที่สุดคือเข้าสู่ระบบที่ [เว็บไซต์]/account ซึ่งคุณดาวน์โหลดข้อมูลทั้งหมดหรือลบบัญชีได้ด้วยตนเองทันที หากเข้าสู่ระบบไม่ได้ หรือต้องการให้เราดำเนินการให้ โปรดตอบกลับพร้อมแจ้งชื่อผู้ใช้ อีเมลที่ผูกกับบัญชี (หากเคยระบุไว้) ช่วงเวลาโดยประมาณที่สร้างบัญชี และชื่อชุดข้อมูล พื้นที่ทำงาน หรือผลวิเคราะห์ในบัญชีอย่างน้อยหนึ่งรายการ เพื่อให้เรายืนยันได้ว่าคำขอนี้มาจากเจ้าของบัญชีจริง โปรดอย่าส่งสำเนาบัตรประชาชนมา เว้นแต่เราจะขอ หากเราไม่ได้รับคำตอบภายใน 15 วัน เราจะปิดคำขอนี้ไว้ก่อน และคุณยื่นคำขอใหม่ได้ทุกเมื่อ

**B — Your copy**

> Attached is a copy of the personal data DAB holds about your account, as of [date], in JSON — a machine-readable format you can open in a text editor or give to another service. It contains your account details and the data stored with your account; the file names each part. [Your saved files are attached separately. / Your saved files are listed in it; sign in to download them.] Why we use this data, who receives it and how long we keep it are set out in our Privacy Notice: [site]/privacy.

> แนบมาพร้อมนี้คือสำเนาข้อมูลส่วนบุคคลที่ DAB เก็บไว้เกี่ยวกับบัญชีของคุณ ณ วันที่ [วันที่] ในรูปแบบไฟล์ JSON ซึ่งเป็นรูปแบบที่เครื่องอ่านได้ คุณเปิดด้วยโปรแกรมแก้ไขข้อความ หรือส่งต่อให้บริการอื่นได้ ไฟล์นี้มีรายละเอียดบัญชีของคุณและข้อมูลที่จัดเก็บไว้กับบัญชี โดยระบุแต่ละส่วนไว้ในไฟล์ [ไฟล์ต้นฉบับที่คุณบันทึกไว้แนบมาแยกต่างหาก / ไฟล์ต้นฉบับที่คุณบันทึกไว้มีรายการอยู่ในไฟล์นี้ เข้าสู่ระบบเพื่อดาวน์โหลดได้] วัตถุประสงค์ในการใช้ข้อมูล ผู้ที่ได้รับข้อมูล และระยะเวลาการเก็บรักษา อธิบายไว้ในประกาศความเป็นส่วนตัวของเรา: [เว็บไซต์]/privacy

**C — Account deleted**

> We deleted your DAB account on [date], as you asked: the account and everything it owned — files, datasets, analyses, chat, share links, comments (with the replies under them), notifications and memberships. [Workspace "[name]" stayed with its other owner. / Workspace "[name]" passed to its earliest-joined remaining [admin / member]. / Workspace "[name]" had no owner, admin or member left and was deleted; datasets other people kept in it moved to their personal space.] [A version you added to someone else's dataset stays with that dataset's owner, no longer linked to you.] Upload statistics that hold no names or values stay, no longer linked to you. As our Privacy Notice explains, two things remain for a limited time: traffic-log entries, which the Computer-Related Crime Act requires us to keep for 90 days (the last goes by [date]), and one entry in our privacy-request log holding only a one-way hash of your former user id, kept for 3 years to show we handled this request. Request logs held by our hosting provider expire on the provider's own schedule.

> เราได้ลบบัญชี DAB ของคุณแล้วเมื่อวันที่ [วันที่] ตามคำขอ โดยลบบัญชีและทุกอย่างที่บัญชีเป็นเจ้าของ ได้แก่ ไฟล์ ชุดข้อมูล ผลวิเคราะห์ แชท ลิงก์แชร์ ความคิดเห็น (รวมถึงคำตอบใต้ความคิดเห็นนั้น) การแจ้งเตือน และการเป็นสมาชิก [พื้นที่ทำงาน “[ชื่อ]” ยังอยู่กับเจ้าของอีกคน / พื้นที่ทำงาน “[ชื่อ]” ได้โอนให้[ผู้ดูแล (admin) / สมาชิก (member)]ที่เข้าร่วมเร็วที่สุดซึ่งยังอยู่ / พื้นที่ทำงาน “[ชื่อ]” ไม่เหลือเจ้าของ ผู้ดูแล หรือสมาชิกจึงถูกลบ และชุดข้อมูลของผู้อื่นในพื้นที่นั้นได้ย้ายไปอยู่ในพื้นที่ส่วนตัวของเจ้าของชุดข้อมูลแล้ว] [เวอร์ชันที่คุณเพิ่มให้ชุดข้อมูลของผู้อื่นยังอยู่กับเจ้าของชุดข้อมูลนั้น โดยไม่เชื่อมโยงกับคุณอีกต่อไป] สถิติการอัปโหลดที่ไม่มีชื่อหรือค่าข้อมูลยังอยู่ แต่ไม่เชื่อมโยงกับคุณอีกต่อไป ตามที่ประกาศความเป็นส่วนตัวของเราระบุไว้ ยังมีข้อมูลสองอย่างที่เก็บต่อในระยะเวลาจำกัด คือ รายการในบันทึกข้อมูลจราจรทางคอมพิวเตอร์ ซึ่งพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์กำหนดให้เก็บไว้ 90 วัน (รายการสุดท้ายจะถูกลบภายในวันที่ [วันที่]) และรายการหนึ่งรายการในบันทึกคำขอด้านความเป็นส่วนตัว ซึ่งมีเพียงค่าแฮชทางเดียวของรหัสผู้ใช้เดิมของคุณ เก็บไว้ 3 ปีเพื่อแสดงว่าเราได้ดำเนินการตามคำขอนี้แล้ว ส่วนบันทึกคำขอ (request log) ที่ผู้ให้บริการโฮสติ้งเก็บไว้จะหมดอายุตามกำหนดของผู้ให้บริการนั้น

**D — We cannot do (all of) it**

> We cannot [do what you asked / do all of what you asked] because [the law requires us to keep this data — for example, the Computer-Related Crime Act requires traffic-log entries to be kept for 90 days / we could not confirm that the request comes from the account holder / the data is in a file another user uploaded, and that user decides how it is used]. [What we did do.] If you disagree, reply to this message, or complain to the Office of the Personal Data Protection Committee (PDPC), www.pdpc.or.th.

> เราไม่สามารถ[ดำเนินการตามคำขอ / ดำเนินการตามคำขอได้ทั้งหมด] เนื่องจาก[กฎหมายกำหนดให้เราต้องเก็บข้อมูลนี้ไว้ เช่น พระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์กำหนดให้เก็บบันทึกข้อมูลจราจรไว้ 90 วัน / เราไม่สามารถยืนยันได้ว่าคำขอนี้มาจากเจ้าของบัญชี / ข้อมูลนี้อยู่ในไฟล์ที่ผู้ใช้รายอื่นอัปโหลด และผู้ใช้รายนั้นเป็นผู้ตัดสินใจว่าจะใช้ข้อมูลอย่างไร] [สิ่งที่เราดำเนินการให้แล้ว] หากคุณไม่เห็นด้วย โปรดตอบกลับข้อความนี้ หรือร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.) ที่ www.pdpc.or.th

**E — Your data is in someone else's file**

> DAB processes the data in uploaded files on behalf of the person or organisation who uploaded them — for example your school, your employer or a shop — and they decide how it is used. Please send your request to them; they can correct or delete the data in DAB themselves. If you can tell us which upload it is (a share link, for example) and agree that we pass your message on, we will forward it to the account holder and help them respond.

> DAB ประมวลผลข้อมูลในไฟล์ที่อัปโหลดแทนบุคคลหรือองค์กรที่อัปโหลดไฟล์นั้น เช่น โรงเรียน นายจ้าง หรือร้านค้า ซึ่งเป็นผู้ตัดสินใจว่าจะใช้ข้อมูลอย่างไร โปรดส่งคำขอของคุณไปยังบุคคลหรือองค์กรนั้น ซึ่งสามารถแก้ไขหรือลบข้อมูลใน DAB ได้เอง หากคุณแจ้งได้ว่าเป็นไฟล์ใด (เช่น ลิงก์แชร์) และยินยอมให้เราส่งต่อข้อความของคุณ เราจะส่งต่อให้เจ้าของบัญชีและช่วยเจ้าของบัญชีตอบคำขอของคุณ

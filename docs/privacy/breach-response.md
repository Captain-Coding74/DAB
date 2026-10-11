Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Personal-data breach response

A personal-data breach is any security incident that leads to personal data being lost, destroyed, changed, disclosed or accessed without authority — a leaked database, a share link exposing data it should not, a stolen laptop with a copy of the database, a mis-sent file.

**The clock.** The PDPC Notification on breach notification (B.E. 2565) requires notice to the Office of the Personal Data Protection Committee (PDPC) without delay and **within 72 hours of becoming aware**, unless the breach is unlikely to put anyone's rights and freedoms at risk. The PDPC's February 2025 clarification starts the clock when you reasonably believe, after a preliminary check, that a breach has occurred or is likely. If the risk to people is high, tell them too, without delay. Record the assessment even when you decide not to notify.

What the public pages promise (`/privacy` section 11, `/terms` section 6): PDPC notice within 72 hours unless the breach is unlikely to put anyone at risk; affected users told without undue delay when the risk to them is high, "in the app and on this website"; users whose uploaded files are affected told without undue delay so they can meet their own duties.

Roles: the operator leads every incident. Contacts are at the end.

## Step 1 — Detect and open the register (hour 0)

Signals: an alert or notice from the hosting provider or Anthropic; a report through the contact page; a burst of errors, rate-limit warnings or `retention job failed` in the server log; many refused sign-ins or token refreshes (replaying an old refresh token makes the server revoke all of that user's sessions); data from DAB seen somewhere it should not be; a lost device or a leaked secret.

As soon as you suspect a breach:

1. Open an entry in the breach register (template below) and write down the time you became aware.
2. Do a preliminary check (an hour or two, not days): is personal data involved, and is the cause real?
3. From now on, note every action with its time.

## Step 2 — Contain (first hours)

Choose what fits; do not wait for the full picture.

- **Stop the exposure.** Stop the service on the host, or block the affected route. Delete an exposed share link: `DELETE FROM shared_reports WHERE token = '<token>';` (works on SQLite and Postgres).
- **Sign everyone out.** Set new random values for `JWT_SECRET` and `JWT_REFRESH_SECRET` and redeploy: every access and refresh token stops working at once (`backend/src/auth.js` verifies both against these secrets).
- **Rotate other secrets that may be exposed:** `ANTHROPIC_API_KEY` (in the Anthropic console), database credentials in `DATABASE_URL`, `REDIS_URL`, the S3 keys, `METRICS_TOKEN`, the hosting account's own password and tokens.
- **Stored-file encryption key.** If `STORAGE_ENCRYPTION_KEY` may have leaked, treat stored files as unencrypted for the assessment. Before changing the key, check how `backend/src/services/storage.js` uses it: files encrypted with the old key cannot be read without it.
- **Stop AI calls** if the AI path is involved: `AI_DAILY_BUDGET=0` blocks every call at once and the app keeps serving statistics.
- **Preserve evidence.** Host logs expire on the host's schedule, and the daily jobs delete traffic-log rows after 90 days and audit rows after 365. Export what you need now — the host's logs for the period, the relevant `traffic_log` and `audit_log` rows, a database snapshot — to an access-controlled store, and record it in the register (`retention-schedule.md` section 5).
- **Do not** delete evidence, contact the attacker, pay anyone, or announce anything before you know what happened.

## Step 3 — Assess (aim for within 24 hours)

| Question | Where to look |
|---|---|
| Which data? | `ropa-controller.md` (accounts, logs, telemetry) and `ropa-processor.md` (content of uploads) |
| Whose? | Account holders → DAB is the controller and notifies. People inside uploaded files → DAB is the processor: tell the users who uploaded them (step 6), who decide about their own notices |
| How many people and records? | Count with SQL on the affected tables; for upload content, `datasets.total_rows` is an upper bound |
| Especially harmful? | Thai citizen IDs and phone numbers (leaks used by scam call centres lie behind most published PDPA fines); records of minors (School Edition); PDPA s.26 data; password hashes; session tokens |
| Was it protected? | Stored files encrypted at rest only if `STORAGE_ENCRYPTION_KEY` was set and the key did not leak; passwords are bcrypt hashes; share pages omit file names and the values of detected personal-data columns |
| Contained? | Is the cause closed, and is the data still reachable? |

Then decide, and write the reasoning in the register:

| Risk | Meaning | Action |
|---|---|---|
| Unlikely to result in risk | For example: encrypted data whose key is safe; data recovered before anyone could see it | Register only |
| Risk | Personal data seen or taken by someone who should not have it | Notify the PDPC within 72 hours (step 4) |
| High risk | Identity numbers, contact details exposed to likely misuse; minors; s.26 data; large numbers | PDPC (step 4) and the people affected (step 5) |

In every case where uploaded content is affected, tell the users who uploaded it (step 6), whatever the risk level.

## Step 4 — Notify the PDPC (within 72 hours of awareness)

Use the reporting channel the PDPC Office publishes on www.pdpc.or.th; check it and write it into the contacts table at each review of this plan. Send what you know by the deadline and follow up with the rest; if you are late, say why. Ask counsel to read it first if time allows.

| Field | หัวข้อ | Content |
|---|---|---|
| Controller | ผู้ควบคุมข้อมูลส่วนบุคคล | `LEGAL_OPERATOR_NAME`, an individual operating Data Analysis Bot |
| Contact | ช่องทางติดต่อ | `LEGAL_CONTACT_EMAIL`, `LEGAL_POSTAL_ADDRESS`, phone. No DPO is appointed |
| When it happened; when we became aware | วันและเวลาที่เกิดเหตุ / ที่ทราบเหตุ | |
| How it was discovered | วิธีที่ตรวจพบ | |
| What happened | ลักษณะของการละเมิดข้อมูล | Confidentiality, integrity or availability; cause if known |
| Kinds of personal data | ประเภทข้อมูลส่วนบุคคลที่เกี่ยวข้อง | Mark s.26 data and identity numbers |
| People and records affected (approximate) | จำนวนเจ้าของข้อมูลและจำนวนรายการ (โดยประมาณ) | Separate account holders from people inside uploaded files; mark minors |
| Likely consequences | ผลกระทบที่อาจเกิดขึ้น | |
| Measures taken and planned | มาตรการที่ดำเนินการแล้วและที่จะดำเนินการ | Containment, fixes, steps to reduce harm |
| People told? | การแจ้งเจ้าของข้อมูลส่วนบุคคล | When, how, or why not |
| Processors and transfers involved | ผู้ประมวลผลข้อมูลและการโอนข้อมูลไปต่างประเทศ | Hosting provider, Anthropic, region |
| Reason for any delay | เหตุผลที่แจ้งล่าช้า (ถ้ามี) | |

Where DAB is only the processor (upload content), the users who uploaded the data are the controllers and decide on PDPC notice for that data. DAB still notifies for its own data, and helps them.

## Step 5 — Tell the people affected (high risk)

The Privacy Notice promises to tell users "in the app and on this website". **DAB has no announcement feature yet**: publish a release that shows a banner in the web app and a notice on `/welcome`, plus a page with the details. **Do not email users**: the Privacy Notice says the email address on an account is never used to send anything. If counsel advises email, update the notice first.

> **What happened.** On [date] we found that [plain description]. It affected [what data] of [which users / about N accounts].
>
> **What we have done.** [Contained how; signed everyone out; reported it to the PDPC on [date].]
>
> **What you can do.** Be careful with calls, text or LINE messages that mention your data — we will never ask for your password by phone, text message or LINE. If you use the same password on other sites, change it there. [Specific advice.]
>
> **Questions:** [contact]. You can also complain to the PDPC, www.pdpc.or.th.

> **เกิดอะไรขึ้น** เมื่อวันที่ [วันที่] เราพบว่า [คำอธิบายอย่างเข้าใจง่าย] ซึ่งกระทบต่อ[ข้อมูลใด]ของ[ผู้ใช้กลุ่มใด / ประมาณ N บัญชี]
>
> **สิ่งที่เราได้ดำเนินการแล้ว** [วิธีหยุดเหตุ ให้ทุกคนออกจากระบบ และได้แจ้งสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลแล้วเมื่อวันที่ [วันที่]]
>
> **สิ่งที่คุณทำได้** โปรดระวังสายโทรศัพท์ ข้อความ SMS หรือข้อความ LINE ที่อ้างถึงข้อมูลของคุณ เราจะไม่ขอรหัสผ่านของคุณทางโทรศัพท์ SMS หรือ LINE เด็ดขาด หากคุณใช้รหัสผ่านเดียวกันนี้กับเว็บไซต์อื่น โปรดเปลี่ยนรหัสผ่านที่เว็บไซต์นั้น [คำแนะนำเพิ่มเติม]
>
> **สอบถามเพิ่มเติม:** [ช่องทางติดต่อ] และคุณสามารถร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.) ได้ที่ www.pdpc.or.th

## Step 6 — Tell business and school customers (upload content affected)

Terms section 6 promises users whose uploaded files are affected notice without undue delay. Internal target: **within 48 hours of becoming aware that their data is affected**, so they can meet their own 72-hour duty. List each affected account's datasets and analyses before writing. Use the same banner and page as step 5, and reply directly to any customer who has written to you before.

> **To users whose uploaded files were affected.** On [date] we found [what happened]. It affected your [datasets / analyses]: [names], about [N] rows, including [kinds of personal data — for example student names and citizen IDs]. For this data you (or your organisation) are the controller and DAB is your processor. You may need to assess whether to notify the PDPC within 72 hours of learning of this, and whether to tell the people in your files. We have [containment] [and reported our part to the PDPC on [date]]. We will help with anything you need: [contact].

> **ถึงผู้ใช้ที่ไฟล์ที่อัปโหลดได้รับผลกระทบ** เมื่อวันที่ [วันที่] เราพบว่า [เกิดอะไรขึ้น] ซึ่งกระทบต่อ[ชุดข้อมูล / ผลวิเคราะห์]ของคุณ ได้แก่ [ชื่อ] ประมาณ [N] แถว ซึ่งมี[ประเภทข้อมูลส่วนบุคคล เช่น ชื่อและเลขประจำตัวประชาชนของนักเรียน] สำหรับข้อมูลนี้ คุณ (หรือองค์กรของคุณ) เป็นผู้ควบคุมข้อมูลส่วนบุคคล และ DAB เป็นผู้ประมวลผลข้อมูลส่วนบุคคลให้คุณ คุณอาจต้องประเมินว่าจะต้องแจ้งสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลภายใน 72 ชั่วโมงนับจากที่ทราบเรื่องนี้หรือไม่ และต้องแจ้งบุคคลที่มีข้อมูลอยู่ในไฟล์ของคุณหรือไม่ เราได้[วิธีหยุดเหตุ] [และได้แจ้งเหตุในส่วนของเราต่อสำนักงานฯ แล้วเมื่อวันที่ [วันที่]] หากต้องการความช่วยเหลือใด ๆ โปรดติดต่อ [ช่องทางติดต่อ]

## Step 7 — Recover

Fix the cause; restore from a clean backup if data was changed; bring the service back; watch the logs closely for two weeks; send follow-up reports to the PDPC with anything new.

## Step 8 — Review (within 2 weeks of closing)

Write a short review in the register entry: timeline; root cause; what worked and what did not; what changes, with an owner and a date. Then update `ropa-controller.md`, `ropa-processor.md`, `legitimate-interests.md` and `vendors.md` if anything changed. If the public notices no longer match what DAB does, update them, and bump `LEGAL_VERSION` for a material change.

## Breach register

Record **every** incident involving personal data, including those not notified.

| Field | |
|---|---|
| Ref | |
| Became aware (date, time) and how | |
| What happened; cause | |
| Data, people and records affected (DAB as controller / as processor) | |
| Containment actions with times | |
| Risk assessment and reasoning | |
| PDPC notified (date, time, reference) or why not | |
| People notified (date, channel) or why not | |
| Customers (controllers) notified (date, who) | |
| Evidence kept (what, where, until when) | |
| Review done (date) and actions | |
| Closed (date) | |

## Contacts

Fill in and check at each review.

| Who | How |
|---|---|
| PDPC Office | www.pdpc.or.th — current breach-reporting channel: [fill in] |
| Counsel | [name, phone, email] |
| Hosting provider support and security | [fill in] |
| Anthropic support | [fill in] |
| Police (cybercrime), if a crime is suspected | [fill in] |

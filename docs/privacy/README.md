Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# DAB privacy back office

The operator's internal records under Thailand's Personal Data Protection Act B.E. 2562 (PDPA) and the Computer-Related Crime Act B.E. 2550 (CCA). The public side is served by the app itself: `/privacy`, `/terms`, `/storage`, `/contact` and `/licenses` (`frontend/public/*.html`, filled in from the `LEGAL_*` settings by `backend/src/legalPages.js`). These drafts and the public pages must say the same thing. When one changes, change the other.

## Documents

| File | What it is | Law |
|---|---|---|
| [ropa-controller.md](ropa-controller.md) | Record of processing for DAB's own data: accounts, acceptance records, audit and request logs, the traffic log, telemetry, privacy requests, mail | PDPA s.39 |
| [ropa-processor.md](ropa-processor.md) | Record of processing for personal data inside users' uploads, and DAB's duties to those users as their processor | PDPA s.40 |
| [legitimate-interests.md](legitimate-interests.md) | Assessments for security and audit logs, telemetry, abuse handling, and the IP address on acceptance records | PDPA s.24(5) |
| [retention-schedule.md](retention-schedule.md) | Every retention period, its setting and its deletion job | PDPA s.37(3); CCA s.26 |
| [breach-response.md](breach-response.md) | Breach runbook: contain, assess, notify the PDPC within 72 hours, notify people and customers, register, review | PDPC breach Notification B.E. 2565 |
| [data-requests.md](data-requests.md) | How to handle access, copy, correction, erasure, restriction and objection requests, with reply templates in English and Thai; reports about shared pages | PDPA ss.30–36; PDPC access-request and deletion Notifications; CCA s.15 |
| [vendors.md](vendors.md) | Sub-processors and what each receives: Anthropic, the hosting provider, optional database, cache and storage providers | PDPA ss.28–29, 40 |
| [dpo-assessment.md](dpo-assessment.md) | Whether a data protection officer is required | PDPA s.41 |
| [claims-evidence.md](claims-evidence.md) | Each claim on the landing page and in the app's privacy notes, with the code and tests behind it | Consumer Protection Act ss.22, 28 |

## Records you keep

| Record | Where |
|---|---|
| Privacy requests | `privacy_requests` table (self-service requests log themselves; log email and post with `node backend/src/scripts/privacy-request.mjs …` — see the script header for usage), plus the mailbox and paper file |
| Reports about shared pages | Takedown register (`data-requests.md` section 8) |
| Breaches, including those not notified | Breach register (`breach-response.md`) |
| Vendor terms | Copies filed next to `vendors.md` |
| DPO assessment | The measurement table in `dpo-assessment.md`, every six months |

## Owner's to-do checklist

### Configure production

- [ ] `LEGAL_OPERATOR_NAME` — the controller's name as it should appear (default "Phatcharaphong Siriphatcharakul").
- [ ] `LEGAL_CONTACT_EMAIL` and `LEGAL_POSTAL_ADDRESS` — PDPA s.23 requires them, and so do the two request channels. Production logs a warning at boot while either is empty, and the pages show a "being set up" line instead.
- [ ] `LEGAL_HOSTING_PROVIDER` and `LEGAL_HOSTING_REGION` — printed in the Privacy Notice and the Terms' sub-processor list.
- [ ] `STORAGE_ENCRYPTION_KEY` — encrypts stored files at rest (AES-256-GCM); production warns while it is unset. Keep a copy of the key somewhere other than the server: files encrypted with it cannot be read without it. The Privacy Notice describes encryption as "when the operator has enabled it", so this is what makes that sentence true for your deployment.
- [ ] `DATABASE_SSL_CA` (your provider's CA certificate, PEM text or a file path) or `DATABASE_SSL_VERIFY=1` (system CAs) — if you use Postgres, turn on certificate verification; production warns at boot while neither is set.
- [ ] Run `npm run storage-encrypt -w backend` once after setting `STORAGE_ENCRYPTION_KEY`, to encrypt files saved before it was set (`-- --dry-run` counts them first).
- [ ] Docker Compose: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` have no defaults — set them in `.env` (see README, Docker).
- [ ] `TRUST_PROXY` — must match the number of proxies in front of the server, or the traffic log and audit log record the wrong IP address.
- [ ] `TELEMETRY_ADMINS` — only your own username, or unset. `METRICS_TOKEN` if a monitor reads `/api/metrics`.
- [ ] Leave the `*_RETENTION_DAYS` settings at their defaults unless you first change the Privacy Notice (`retention-schedule.md` section 6).
- [ ] Set up the contact mailbox with two-factor sign-in, and a way to receive registered post at the postal address.

### Confirm with vendors (details in `vendors.md`)

- [ ] Anthropic: the account is on the Commercial Terms; obtain and file the data-processing terms; check retention for the account and for the model in `AI_MODEL`; confirm no training use and no data-sharing programme; note the processing region; re-read the Usage Policy that takes effect on 12 November 2026.
- [ ] Hosting: confirm the provider (Railway, per `railway.json`) and its region; accept and file its DPA and transfer clauses; check disk encryption, backups (an erasure must reach them within 90 days), log retention, and two-factor sign-in on the hosting account.
- [ ] The contact mailbox's provider: record it in `vendors.md`.

### Gaps in the public pages found while writing these drafts

- [x] The Privacy Notice states no retention period for correspondence (requests, reports, feedback). Done in v21.30: the periods in `retention-schedule.md` section 4 are in the notice's retention table and on `/contact`.
- [ ] The Privacy Notice's list of recipients does not name an email provider for the contact mailbox; ask counsel whether it should.
- [x] The Privacy Notice (section 3, "Saved datasets") does not say that the time a teacher confirmed the school's authority is kept with a saved class roster (`datasets.school_attested_at`). Done in v21.30.
- [x] The notices promised announcements "in the app" (material changes, breaches, closing the service), but DAB has no announcement feature. Done in v21.30: they now promise a notice on the legal pages (linked from every page of the app), posted with its effective date in advance, and signed-in users must accept a material change before carrying on.
- [ ] DAB cannot tell a share link's owner that their link was disabled, and has no password change or reset; both matter in a breach.

### Take to counsel

The research report's open questions, copied as they stand:

| Question | Why it is still open |
|---|---|
| Is DAB a CCA "service provider", and which traffic-data fields apply to it? | The annex of the 2021 MDES notification was not read |
| Must transfer clauses be filed with the PDPC? Does Anthropic's DPA qualify? Can contract necessity cover the AI transfer? | Sources conflict; the vendor DPA was not checked |
| Can an online-only individual meet the two-channel access rule with a home or virtual address? Is the cure period 10 or 15 days? | The Notification text was not read; extracts conflict |
| Should the minimum account age be 18 or 20? Is the teacher or the school the controller for uploaded gradebooks? | Civil and Commercial Code capacity rules were not verified |
| Will the liability cap and forum clause survive UCTA s.4 and the Consumer Case Procedure Act's venue rule? | No SaaS case law found; s.17 not verified |
| What are the current advertising penalties, and does the OCPB notification on AI and software-made imagery reach the hero animation? | The consolidated Consumer Protection Act text was not obtained |
| Is DAB exempt from the ROPA requirement? Is a DPO needed? Does telemetry make DAB a controller of upload content? | Size thresholds conflict; there is no SaaS guidance |
| Should DAB operate through a company rather than as an individual, given personal exposure to fines and damages? | Not researched; it depends on the owner's plans |
| Have the PDPA amendment bill, the PDPC AI and lawful-basis guidance, the Thai AI Act and the Electronic Transactions Act redraft been finalised? | Status after August 2026 is unknown |
| Before paid plans: direct-marketing registration, VAT and e-commerce registration for an individual | The scope of the Direct Sales Act is contested |

Further questions raised by these drafts:

| Question | Where it comes up |
|---|---|
| For personal data inside uploads, the people concerned are not party to DAB's contract. Can the s.28 contract exception still cover sending it to Anthropic, or is a s.29 safeguard needed? | `ropa-processor.md`, transfers |
| May a requester have a copy of their own traffic-log entries, given that no feature of DAB shows the log to anyone? | `data-requests.md` section 5 |
| Does the 30-day answer period run from receipt (as the public pages promise) or from identity verification (as the Notification counts), and may it pause while identity information is awaited? | `data-requests.md` section 2 |
| In a high-risk breach, may DAB email affected users, although the Privacy Notice says the email address is never used to send anything? | `breach-response.md` step 5 |
| Should a hashed acceptance record outlive a deleted account for the limitation period, and how long should the breach register and correspondence be kept? | `legitimate-interests.md` LIA 4; `retention-schedule.md` section 4 |
| Is 365 days a defensible period for the security audit log, or should it be shorter? | `legitimate-interests.md` LIA 1 |

### Keep running

- Every week: read the contact mailbox; log new requests on the day they arrive.
- Every month: the checks in `retention-schedule.md` section 7; list open privacy requests with the script.
- Every six months: the DPO measurement.
- Every year, and whenever `LEGAL_VERSION` changes: review every file here against the code and the public pages, and update the "Reflects DAB v…" line.

Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Record of processing activities — DAB as controller (PDPA s.39)

This record covers the personal data DAB processes for its own purposes. Personal data inside the files users upload is processed for those users, and is recorded separately in `ropa-processor.md`.

Keep it in writing (this file is enough), make it available to the Office of the Personal Data Protection Committee (PDPC) on request, and review it at least once a year and whenever `LEGAL_VERSION` changes.

## Controller

| | |
|---|---|
| Controller | The individual who runs DAB, named by `LEGAL_OPERATOR_NAME` (default "Phatcharaphong Siriphatcharakul") |
| Contact | `LEGAL_CONTACT_EMAIL`, `LEGAL_POSTAL_ADDRESS` — printed on `/privacy`, `/terms` and `/contact` |
| Data protection officer | None appointed; see `dpo-assessment.md` |
| Service | Data Analysis Bot (DAB), a free web app that checks and analyses CSV and Excel files |
| Systems | One Node.js server (`backend/`) serving the API and the web app. Database: SQLite, or Postgres when `DATABASE_URL` is set. Stored files: local disk, or S3-compatible storage when `STORAGE_DRIVER=s3`. Cache: in memory, or Redis when `REDIS_URL` is set. All run at the hosting provider (`vendors.md`) |
| Notices | Privacy Notice `/privacy`, Terms `/terms`, Storage notice `/storage`, Contact `/contact` |

Table and column names below are as of v21.30. Check them against `backend/src/db/migrate.js` when the schema changes.

Lawful bases use the PDPA s.24 numbering: contract (s.24(3)), legal obligation (s.24(6)), legitimate interests (s.24(5)). Consent is not relied on for any activity.

## C1. Accounts and sign-in

| | |
|---|---|
| Data subjects | Account holders (18 or over; under 20 only with a parent's or guardian's agreement) |
| Personal data | Username; password as a bcrypt hash; optional email address (never verified, never used to send anything, shown only to the account holder); role; time created; time of last sign-in; active flag; a SHA-256 hash of each session's refresh token with its expiry |
| Where | `users`, `refresh_tokens`; profile cached for 60 seconds |
| Purpose | Provide the signed-in service and keep users signed in |
| Lawful basis | Contract |
| Recipients | Hosting provider (processor). Other users see a username where the account holder works with them (workspaces, shared datasets, comments); they never see the email address |
| Transfers abroad | Only if the hosting region is outside Thailand (`LEGAL_HOSTING_REGION`). Not sent to the AI |
| Retention | Until the account is deleted. Refresh-token hashes until the token expires (7 days) or the user signs out |
| Security | bcrypt (cost 12); 15-minute access tokens and 7-day refresh tokens that rotate on every use, with reuse detection; production refuses to start without `JWT_SECRET` and `JWT_REFRESH_SECRET`; sign-in rate limit per IP |

## C2. The signed-in service record

| | |
|---|---|
| Data subjects | Account holders |
| Personal data | What the account holder did and made: analyses in History (file name, question, AI report, statistics), saved datasets and their names (for a class roster, also the time the account holder confirmed the school's authority: `datasets.school_attested_at`), chat, share links (token, title, expiry, optional password hash, view count), workspaces (name, branding, members and roles), dataset permissions, comments and @mentions, notifications, activity feed entries |
| Where | `analyses`, `chat_messages`, `datasets`, `dataset_versions`, `shared_reports`, `workspaces`, `workspace_members`, `dataset_permissions`, `comments`, `mentions`, `notifications`, `activity_feed`; stored files in object storage |
| Purpose | Provide the features the account holder uses |
| Lawful basis | Contract |
| Recipients | Hosting provider; people the account holder chooses (workspace members, users a dataset is shared with, anyone holding a share link); Anthropic for AI features (C2 overlaps with the processor record: the content of files and results is recorded in `ropa-processor.md`) |
| Transfers abroad | Anthropic PBC, USA, for AI features (see `ropa-processor.md`); the hosting region if outside Thailand |
| Retention | See `retention-schedule.md`: analyses 365 days; saved datasets until deleted or 365 days without activity; Trash 30 days; activity feed and notifications 365 days; share links until revoked or their analysis is deleted |
| Security | Owner or explicit per-dataset permission needed to reach a dataset; share pages show an allowlisted view without the file name; stored files encrypted at rest (AES-256-GCM) once `STORAGE_ENCRYPTION_KEY` is set — new files on write, older ones when `storage-encrypt` seals them; the server checks at boot and daily (`services/encryptionStatus.js`) and logs "stored files are not all encrypted yet" with counts while any remain |

## C3. Acceptance of the Terms and the Privacy Notice

| | |
|---|---|
| Data subjects | Account holders |
| Personal data | The `LEGAL_VERSION` accepted, the time, and the IP address (on the `users` row). Sign-up also asks the user to confirm the age line "I am at least 18 years old, and if I am under 20 my parent or guardian agrees" |
| Purpose | Show that the user accepted the Terms and was given the Privacy Notice, and which version |
| Lawful basis | Contract; legitimate interests in being able to show what was accepted (`legitimate-interests.md`, LIA 4) |
| Recipients | Hosting provider |
| Transfers abroad | Hosting region only |
| Retention | Until the account is deleted. Signed-in users on an older version are asked to accept again |
| Security | As C1 |

## C4. Security audit log and abuse protection

| | |
|---|---|
| Data subjects | Account holders; anyone who sends requests (rate limiting) |
| Personal data | `audit_log`: user id, event (sign-up, sign-in, sign-out everywhere), IP address, time. Rate-limit counters keyed by IP address, user id, or IP address and share token; rate-limit warnings in the server log name that key |
| Purpose | Detect and investigate account misuse and brute-force attempts; keep the service available |
| Lawful basis | Legitimate interests (`legitimate-interests.md`, LIA 1) |
| Recipients | Hosting provider; officials entitled to it by law. An account holder sees their own audit rows in their data export |
| Transfers abroad | Hosting region only |
| Retention | Audit log 365 days, and the account holder's rows are deleted with the account; rate-limit counters up to 15 minutes |
| Security | No feature shows the audit log to anyone else; database access is the operator's only |

## C5. Traffic log (Computer-Related Crime Act B.E. 2550, s.26)

| | |
|---|---|
| Data subjects | Anyone who signs up, signs in or out, analyses a file (try mode included), uploads a dataset, exports, creates or opens a share link, downloads their data or deletes their account |
| Personal data | Event, user id (if signed in), IP address, time, and an optional reference: the dataset id (dataset analyse and upload of a new version), the share link's id (create and view) or the export format — never file content or a share token. Events: `register`, `login`, `logout`, `logout_all`, `analyze` (`POST /api/analyze` and `POST /api/datasets/:id/analyze`), `dataset_upload`, `export`, `share_create`, `share_view`, `data_export`, `account_delete` (`backend/src/services/trafficLog.js`) |
| Where | `traffic_log` |
| Purpose | Keep the computer traffic data the Act and the MDES traffic-data notification (B.E. 2564) require of service providers |
| Lawful basis | Legal obligation |
| Recipients | Competent officials, on a lawful request only. No API or screen exposes it |
| Transfers abroad | Hosting region only |
| Retention | 90 days, then deleted by the daily job (`TRAFFIC_LOG_RETENTION_DAYS`; a lower setting is raised to 90, the s.26 minimum). Kept after an account is deleted until its 90 days end |
| Security | Only the database holds it; no API exposes it, so only someone with database access can read it |
| Open question | Whether these fields meet the notification's annex (lawyer question 1 in `README.md`) |

The IP address in the traffic log and the audit log is derived through `TRUST_PROXY` (`backend/src/config.js`). If that setting does not match the real number of proxies in front of the server, the log records the wrong address — check it when the hosting changes.

## C6. Request logs

| | |
|---|---|
| Data subjects | Everyone who uses the site |
| Personal data | For each request: a request id, the method, the URL with share-link tokens, `…token=` values and the dataset search box (`search=`, `q=`) replaced by `[redacted]` (`backend/src/logger.js`), the remote address, the status code. Records about analyses (rows, duration, quality score, saved id; `backend/src/routes/analysis.js`) and error records add the user id. Service logs carry no file names, column names or cell values (`logRedaction.test.js` checks every logger call) |
| Where | The server's standard output, collected by the hosting provider |
| Purpose | Run and debug the service; investigate security problems |
| Lawful basis | Legitimate interests (LIA 1) |
| Recipients | Hosting provider |
| Transfers abroad | Hosting region only |
| Retention | The host's log retention — **to confirm** (`retention-schedule.md` section 4) |
| Security | Authorization headers, passwords, password hashes and token fields are redacted before writing |

## C7. Telemetry

| | |
|---|---|
| Data subjects | Everyone who analyses a file, uploads a dataset or taps a sample file; the row carries the user id when the person is signed in |
| Personal data | File type, size, numbers of rows and columns, column types, encoding, separator, Buddhist-Era flag, skipped rows, category tags from a fixed list, a guessed kind of file and its score, the sample id for sample taps, the user id when signed in, the time. Never the file name, column names or any value (`backend/src/services/telemetry.js`) |
| Where | `upload_metadata` |
| Purpose | Learn what kinds of files people bring, to improve how DAB reads them |
| Lawful basis | Legitimate interests (LIA 2) |
| Recipients | Only operators listed in `TELEMETRY_ADMINS` can read the aggregate summary |
| Transfers abroad | Hosting region only |
| Retention | 395 days. On account deletion the user id on these rows is removed |
| Security | No file name, column name or value is ever written (`backend/src/telemetry.test.js`). The summary endpoint (`/api/telemetry/summary`) is closed to everyone unless `TELEMETRY_ADMINS` names the reader. Deleted daily after 395 days (`telemetry` job) |

## C8. Privacy requests

| | |
|---|---|
| Data subjects | People who use their PDPA rights (account holders, and people without an account) |
| Personal data | Log row: a one-way hash of the user id (or of the identifier a person without an account gave), the type of request, the channel, the status, times, and a note that holds no personal data. Correspondence: the request itself, contact details, and whatever was needed to confirm identity |
| Where | `privacy_requests` (written by the app for `/account` exports and deletions, and by the operator script for email and post); the operator's mailbox and paper file |
| Purpose | Handle requests and show that each was handled |
| Lawful basis | Legal obligation (PDPA ss.30–36 and the PDPC access-request Notification's record-keeping duty) |
| Recipients | Hosting provider (log); email provider (mailbox, see `vendors.md`) |
| Transfers abroad | Hosting region only for the log. The mailbox provider's location — **to confirm** (`vendors.md` section 4) |
| Retention | Log: 3 years. Correspondence: proposed 3 years after closing; ID copies deleted once identity is confirmed (`retention-schedule.md` section 4) |
| Security | The log holds a SHA-256 hash, not the user id. It is still pseudonymous personal data: anyone who holds the id, or guesses the identifier, can match it. Notes are kept free of personal data. Correspondence: the mailbox behind two-factor sign-in and the paper file under lock — **to put in place** (`README.md` checklist) |
| Procedure | `data-requests.md` |

## C9. Contact, reports about shared pages, security reports

| | |
|---|---|
| Data subjects | People who write to DAB; people named or shown in a reported page |
| Personal data | Name and contact details the sender gives, the message, a reported link and the reason, the action taken |
| Where | Operator's mailbox; the takedown register (`data-requests.md` section 8) |
| Purpose | Answer messages; remove unlawful content under the Computer-Related Crime Act's notice-and-takedown procedure (s.15); fix security problems |
| Lawful basis | Legitimate interests (LIA 3); legal obligation where a formal notice or a court order under the Act applies |
| Recipients | Email provider; officials or a court where the law requires |
| Transfers abroad | The mailbox provider's location — **to confirm** (`vendors.md` section 4) |
| Retention | Proposed: takedown reports 3 years after closing; other mail 12 months (`retention-schedule.md` section 4) |
| Security | The mailbox behind two-factor sign-in — **to put in place** (`README.md` checklist). The register holds only the fields in its template. A reporter's details are not passed to the link owner without the reporter's agreement, unless the law requires it |

## C10. Browser storage

DAB sets no cookies. The web app keeps six localStorage entries on the user's device: `dab_at` (access token, 15 minutes), `dab_rt` (refresh token, 7 days), `dab_user` (username), `dab_dark` (theme), `dab_landing_lang` (language), `dab_tour_done` (tour seen). Only the two tokens are ever sent to the server, as the sign-in itself (C1). The rest never leave the device. Lawful basis: contract for the tokens and username; the other three only remember choices the user made. Listed in the Storage notice.

## Security measures (all activities)

In place in v21.30:

- HTTPS, provided by the hosting provider.
- Strict security headers and content security policy (`backend/src/app.js`). No third-party scripts, fonts or other resources are loaded.
- Passwords and share-link passwords stored as bcrypt hashes. Short-lived, rotating session tokens.
- Rate limits on the API, on sign-in, and on share links (`backend/src/middleware/rateLimiter.js`).
- Upload checks by content as well as extension, a size limit (`MAX_UPLOAD_MB`), and a ZIP-bomb guard.
- Metrics endpoint closed in production unless `METRICS_TOKEN` or an operator account is used. Production error responses carry no internal detail.
- Logs redact credentials and share tokens.
- Stored files encrypted at rest (AES-256-GCM) once `STORAGE_ENCRYPTION_KEY` is set — new files on write, older ones when `storage-encrypt` seals them; the server checks at boot and daily (`services/encryptionStatus.js`) and logs "stored files are not all encrypted yet" with counts while any remain; new storage keys no longer contain the file name. Postgres certificate verification is available through `DATABASE_SSL_CA` (a CA certificate, as PEM text or a file path) or `DATABASE_SSL_VERIFY=1` (the system CAs); without either, the connection is encrypted but the certificate is not checked, and production warns at boot.
- Automatic deletion (`retention-schedule.md`).

Known limits, to weigh in a breach assessment:

- Session tokens live in localStorage, so a script injected into the page could read them. The content security policy is the main defence.
- An access token stays valid for up to 15 minutes after sign-out.
- DAB has no password change or reset, and no two-factor sign-in.
- Sign-in protection is per IP address only.
- One person has full database access, and nothing records that person's own access.
- Disk encryption and backups depend on the hosting provider.

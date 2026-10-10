Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Retention schedule

How long DAB keeps each kind of data, what deletes it, and which setting changes the period.

The public version is the table in the Privacy Notice (`/privacy#retention`, `frontend/public/privacy.html` section 9). The two must always agree. If you change a period, update the notice first (see "Changing a period" below).

Why this matters: PDPA s.37(3) requires a system that deletes personal data when its retention period ends. The PDPC Notification on deletion, destruction and de-identification (in force 11 November 2024) asks for erasure requests to be carried out within 90 days, "including any copies or backups".

## 1. Deleted automatically every day

`backend/src/services/retention.js` runs each job below every day at 03:17 Bangkok time, and once about a minute after the server starts. Each period is a whole number of days, read from the environment variable named in the table and documented in `.env.example`. A missing or invalid value falls back to the default, and an invalid one also logs a warning. The log line for a run carries job names and counts only, never an id or any content.

| Data | Table | Default | Setting | Job | Counted from |
|---|---|---|---|---|---|
| Items in Trash | `datasets` (in Trash) | 30 days | `TRASH_RETENTION_DAYS` | `trash` | when the item was moved to Trash |
| Saved datasets with no activity | `datasets` | 365 days | `DATASET_RETENTION_DAYS` | `datasets` | the last activity: opened, analysed, tested, edited or given a new version |
| Analyses (History), with their chat and share links | `analyses` | 365 days | `ANALYSIS_RETENTION_DAYS` | `analyses` | when the analysis was created |
| Telemetry | `upload_metadata` | 395 days | `TELEMETRY_RETENTION_DAYS` | `telemetry` | when the row was written |
| Security audit log | `audit_log` | 365 days | `AUDIT_RETENTION_DAYS` | `audit` | when the row was written |
| Activity feed | `activity_feed` | 365 days | `ACTIVITY_RETENTION_DAYS` | `activity` | when the row was written |
| Notifications | `notifications` | 365 days | `ACTIVITY_RETENTION_DAYS` | `notifications` | when the row was written |
| Traffic log (Computer-Related Crime Act s.26) | `traffic_log` | 90 days | `TRAFFIC_LOG_RETENTION_DAYS` | `traffic-log` | when the row was written |
| Privacy-request log | `privacy_requests` | 3 years (1,095 days) | `PRIVACY_REQUEST_RETENTION_DAYS` | `privacy-requests` | when the request was logged |

Notes:

- **Traffic log.** The Act makes 90 days a minimum, so never set a lower value. An official may order a longer period for particular data, up to 2 years. Handle such an order as a legal hold (section 5) rather than by raising the setting for everyone.
- **Datasets and analyses** are deleted through the same cascades as a user's own deletion (`backend/src/db/cascade.js`), so expiry removes as much as erasure does.
- **Share links** stop working when they expire. The row itself is deleted when the owner revokes it, or when its analysis is deleted, which happens at the latest 365 days after the analysis was created.

## 2. What a deletion takes with it

| The user deletes… | Also deleted |
|---|---|
| a dataset (or it expires from Trash or for inactivity) | its stored files and versions, its analyses, their chat, its share links, comments and activity rows |
| an analysis (or it expires) | its chat and share links |
| their account (at `/account`, password required; or the operator does it for an email or postal request with `node backend/src/scripts/privacy-request.mjs …` — see the script header for usage) | everything the account owns, immediately: files, datasets, analyses, chat, share links, comments, notifications, memberships. A workspace the user owned passes to its earliest-joined remaining admin, otherwise member; with nobody left it is deleted |

Kept after an account is deleted, as the Privacy Notice says:

- traffic-log rows, until their 90 days end (legal duty);
- one privacy-request log row holding only a one-way hash of the user id, for 3 years, to prove the request was handled;
- request logs held by the host, until the host's own log retention ends.

## 3. Kept for a fixed time without a daily job

| Data | Kept for | What removes it |
|---|---|---|
| A file in try mode, or analysed while signed in without pressing "Save dataset" | not kept: parsed in memory and discarded after the response | — |
| Account: username, password hash, optional email, acceptance record (version, time, IP) | until the account is deleted | account deletion |
| Workspaces, members and roles | until the workspace is deleted with its last member's account, or passed on as above | account deletion |
| Refresh-token hashes | until the token expires (7 days) or the user signs out | hourly prune in `backend/src/services/scheduler.js`, and once at start |
| Rate-limit counters (keyed by IP address, user id, or IP and share token) | up to 15 minutes | cache expiry (`backend/src/middleware/rateLimiter.js`) |
| Cached copies: profile 60 s, History list 30 s, one analysis 120 s | seconds | cache expiry (in memory, or Redis when `REDIS_URL` is set) |
| Scheduled reports | none are kept: the feature is off and the stored schedules, recipient emails included, were deleted by the v21.30 migration (`backend/src/db/migrate.js`, `DATA_FIXES`) | — |

## 4. Kept by someone else, or by hand — confirm and record

These are outside the code. Fill in the period and keep the evidence (a screenshot of the setting or the contract clause) with these drafts.

| Data | Who holds it | Period | Status |
|---|---|---|---|
| Request logs (stdout): IP address, method, URL with share tokens removed, status | hosting provider | the host's log retention | **To confirm.** Choose the shortest setting that still lets you investigate a problem |
| Backups or snapshots of the database and stored files | hosting provider (or database provider) | the host's backup policy | **To confirm.** It must let an erasure reach backups within 90 days |
| Content sent to the AI | Anthropic PBC | Anthropic's retention policy | **To confirm** in the Anthropic account and its data-processing terms (`vendors.md`) |
| Requests by email or post, and the replies | operator's mailbox and paper file | proposed: 3 years after the request is closed, matching the privacy-request log; copies of ID documents deleted as soon as identity is confirmed | **Proposed** — not yet stated in the Privacy Notice |
| Reports about shared pages and the takedown register | operator's mailbox and register | proposed: 3 years after the report is closed | **Proposed** — not yet stated in the Privacy Notice |
| Other email (feedback, files DAB cannot read) | operator's mailbox | proposed: 12 months | **Proposed** — not yet stated in the Privacy Notice |
| Breach register and evidence copies | operator | evidence: until the incident and any claim about it are closed; register: ask counsel | **Open question** |

If the proposed periods are adopted, add a line for correspondence to the Privacy Notice's retention table, because PDPA s.23 asks for a retention period for each kind of data collected.

## 5. Legal holds

When data must be kept beyond its period (an official order, a court case, a breach investigation):

1. Export only the rows concerned (for example the `traffic_log` rows for one IP address and date range) to an access-controlled evidence store.
2. Record what was exported, why, under whose request, and until when, in the breach register or the request's case file.
3. Delete the copy when the hold ends, and record that too.

Do not raise a retention setting for everyone to keep a few rows.

## 6. Changing a period

1. Decide the new period, and check it against any legal minimum (90 days for the traffic log).
2. Update the Privacy Notice table (`frontend/public/privacy.html`, both languages). For a material change, bump `LEGAL_VERSION` in `backend/src/services/legal.js` so signed-in users are asked to accept the new version.
3. Set the environment variable on the host and redeploy.
4. Update this file, `ropa-controller.md` and `ropa-processor.md`.

## 7. Monthly check

Run these on the production database; they work on both SQLite and Postgres. Each oldest date should be no older than its period plus a day.

```sql
SELECT MIN(created_at) FROM traffic_log;        -- about 90 days ago at most
SELECT MIN(created_at) FROM audit_log;          -- about 365 days
SELECT MIN(created_at) FROM upload_metadata;    -- about 395 days
SELECT MIN(created_at) FROM analyses;           -- about 365 days
SELECT MIN(created_at) FROM privacy_requests;   -- about 3 years
SELECT COUNT(*) FROM datasets WHERE is_trashed = 1 AND trashed_at < '<date 31 days ago, ISO>';  -- 0
```

Also search the server log for `retention run complete` (once a day) and `retention job failed`.

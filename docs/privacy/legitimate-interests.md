Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Legitimate-interest assessments

PDPA s.24(5) allows processing that is necessary for the legitimate interests of the controller or someone else, unless those interests are outweighed by the fundamental rights of the data subject. The PDPC's draft guidance on lawful bases (July 2026) asks controllers that rely on it to write down an assessment. Each one below follows the usual three tests: purpose, necessity, balancing.

The Privacy Notice (section 5) names legitimate interests for: security and abuse prevention (audit log, request log, rate-limit counters, reports about shared pages), shape-only telemetry, and, alongside the contract, the acceptance record. The traffic log is **not** here: it rests on a legal obligation (Computer-Related Crime Act s.26).

Review each assessment once a year, and whenever the data, the period or the purpose changes.

---

## LIA 1. Security audit log, request logs and rate limiting

**Processing.** `audit_log` (user id, event — sign-up, sign-in, sign-out everywhere — IP address, time; 365 days). Request logs on standard output (request id, method, URL with share tokens redacted, remote address, status code; error records may add the user id; kept by the host). Rate-limit counters keyed by IP address, user id, or IP address and share token (up to 15 minutes), and the warnings that name those keys.

**1. Purpose.** Keep accounts and the service safe: notice brute-force and credential-stuffing attempts, investigate a suspected account takeover or breach, find the cause of errors, and keep the service available to everyone. These interests belong to DAB and equally to its users, whose accounts and files the logs protect. They are lawful and specific.

**2. Necessity.**

- Without the sign-in audit trail there is no way to tell a user when and from where their account was used, or to scope a breach (`breach-response.md`).
- Rate limiting cannot work without a key; an IP address is the only key available before sign-in.
- Request logs are the only record of what the server did when something goes wrong.
- Less intrusive options considered: no user-agent is stored (the column exists but is always empty); share tokens are removed from URLs; no request bodies or file contents are logged; counters expire within 15 minutes.
- The 365-day audit period was chosen so that a compromise reported late, or noticed at the yearly review, can still be traced. A shorter period (for example 180 days) would also be defensible; ask counsel.
- Request-log retention is set by the host. Choose the shortest period that still supports investigation (`retention-schedule.md` section 4).

**3. Balancing.**

- Expectations: users expect a service with accounts to record sign-ins and to throttle abuse, and the Privacy Notice says so (sections 3, 5 and 9).
- Nature of the data: identifiers and times only, no file contents. An IP address can locate a person roughly.
- Impact: low. The data is not used to profile anyone, make decisions about them, or market to them.
- Vulnerable people: account holders are adults, or under-20s with a guardian's agreement. The logs hold nothing about the people inside uploaded files.

**Safeguards.** Database access is the operator's only. No API shows the audit log except to the account holder in their own export. Credentials and tokens are redacted from logs (`backend/src/logger.js`). Fixed retention, enforced daily (`audit` job).

**Outcome.** Legitimate interests apply. On an objection, consider whether there are compelling grounds to continue. For security logs there usually are, while the period runs, but record the reasoning in the request's case file.

---

## LIA 2. Shape-only telemetry

**Processing.** One `upload_metadata` row for each analysis, dataset upload and sample tap: file type, size, numbers of rows and columns, column types, encoding, separator, Buddhist-Era flag, skipped rows, category tags from a fixed dictionary (such as "date", "customer", "salary", "patient"), a guessed kind of file (such as "restaurant", "pharmacy", "hr_payroll") and its score, the sample id, the user id when signed in, the time. Never the file name, column names or values (`backend/src/services/telemetry.js`, `backend/src/telemetry.test.js`). Kept 395 days.

**1. Purpose.** Improve how DAB reads the messy files people actually bring (Thai dates, encodings, banner rows) and decide which kinds of files to support next. This is DAB's own purpose, so DAB is the controller for it, even though the tags are derived from upload content.

**2. Necessity.**

- Counts of shapes, encodings and kinds of files need a row per upload; aggregate counters alone would lose the combinations that matter (for example, TIS-620 files with banner rows).
- 395 days lets the operator compare the same season a year apart.
- **The user-id link is not needed for this purpose.** The operator summary (`getTelemetrySummary` in `backend/src/db/repository.js`) never reads `user_id`. Today it is used only to include a user's own rows in their data export and to unlink them on account deletion. This part fails the necessity test as the purpose stands.

**3. Balancing.**

- Expectations: the Privacy Notice describes the record and the link to the user id (section 3).
- Nature of the data: no content. But on a small deployment a tag set such as "pharmacy" with "patient" next to a user id says something about the user's work, and could hint that the user handles health data. The code itself warns that the summary is "close to identifying on a small deployment" (`.env.example`, `TELEMETRY_ADMINS`).
- Impact: low; not used for decisions, marketing or sharing.

**Safeguards.** Only operators listed in `TELEMETRY_ADMINS` can read the aggregate summary; unset, nobody can. No names or values. Fixed 395-day retention (`telemetry` job). The user id is removed when the account is deleted.

**Outcome.** Legitimate interests apply to the shape record. The user-id link should go: stop writing `user_id` to `upload_metadata` in a future release, then update the Privacy Notice (section 3). Until then, honour any objection at once by unlinking that user's rows:

```sql
UPDATE upload_metadata SET user_id = NULL WHERE user_id = '<user id>';
```

---

## LIA 3. Handling abuse: reports about shared pages, takedown, security reports

**Processing.** Reports sent through `/contact#report` (every share page links there) or by post: the reporter's contact details if they give them, the link, the reason and any description, which may mention the person shown. To act, the operator looks up the share link and its owner in the database. A takedown register records each report and the action taken (`data-requests.md` section 8). Security reports: the sender's details and the report.

**1. Purpose.** Stop unlawful content and exposed personal data spreading through public share links; keep the defence the Computer-Related Crime Act s.15 gives a provider that follows the notice-and-takedown procedure; protect the people shown in a page; fix vulnerabilities. These serve DAB, the people affected and the public. Where a formal notice or court order under the Act applies, the basis is a legal obligation instead.

**2. Necessity.** A report cannot be checked without the link, and the reporter cannot be answered without a contact. The register is what proves the procedure was followed. Nothing beyond that is asked for: the contact page asks for the link, the reason and, only if a reply is wanted, a contact.

**3. Balancing.**

- Reporters expect their report to be read and acted on, and the contact page says every notice is recorded.
- Link owners: the Terms (section 9) say a link may be disabled when it is reported as unlawful, without warning in urgent cases. Disabling a link deletes nothing else the owner holds.
- People shown in a reported page benefit directly.
- Risk: a false report could remove a lawful page. The owner can create a new link, and the register shows the reasons.

**Safeguards.** The register holds no more than the fields in its template. Access is the operator's only. Proposed retention: 3 years after the report is closed (`retention-schedule.md` section 4). Reporters' details are not passed to the link owner without the reporter's agreement, unless the law requires it.

**Outcome.** Legitimate interests (or legal obligation for formal notices) apply.

---

## LIA 4. Recording the IP address with acceptance of the Terms

**Processing.** On sign-up, and on each re-acceptance after `LEGAL_VERSION` changes: the version, the time and the IP address, on the user's row. Kept until the account is deleted.

**Purpose and necessity.** The contract needs a record of which version was accepted and when. The IP address adds evidence that the acceptance came from the account holder's session, which matters if acceptance is ever disputed (the Electronic Transactions Act gives electronic records evidential weight). It is one value per acceptance.

**Balancing.** Expected (the Privacy Notice lists it in sections 3 and 5), minimal and not reused for anything else.

**Outcome.** Contract, with legitimate interests for the IP address. Open point for counsel: once the account is deleted the evidence goes too; decide whether a hashed acceptance record should outlive the account for the limitation period.

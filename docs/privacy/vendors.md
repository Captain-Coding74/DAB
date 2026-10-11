Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Vendor and sub-processor register

Every outside company that receives personal data from DAB, what it receives, under which terms, and what is still to be confirmed. The Terms of Service (section 6) promise users that DAB uses only the listed sub-processors and updates the list before adding another; the Privacy Notice (section 8) says personal data is received only by Anthropic, the hosting provider, the provider that hosts the contact mailbox, people the user chooses, and authorities when the law requires. Keep all three consistent.

File a copy (PDF or a dated screenshot) of each vendor's terms next to this register when you confirm them, and note the date.

## 1. Anthropic PBC — AI features

| | |
|---|---|
| Role | Sub-processor for personal data inside uploads; the only third party that receives user content |
| Location | United States |
| Service | Claude API, Messages endpoint only (`messages.create` and `messages.stream`; DAB uses no batch or file-storage endpoints), through `@anthropic-ai/sdk` |
| Endpoint and account | `api.anthropic.com` unless `ANTHROPIC_BASE_URL` points elsewhere; the account is the one that owns `ANTHROPIC_API_KEY`; the model is set by `AI_MODEL` (default in `backend/src/config.js`) |
| When data is sent | Only for signed-in users, only when AI is not switched off for that upload or dataset, and only while the global daily budget (`AI_DAILY_BUDGET`, default 300 calls) lasts |
| What is sent | The user's question; row and column counts; column names; summary statistics; the most frequent values of columns not detected as personal data; correlations and forecasts; insight sentences; chat history for chat. AI Edit, after an explicit confirmation, sends up to 300 rows of the columns not detected as personal data |
| What is not sent | Raw rows from Analyze, Chat, the agent or fix suggestions; anything from a detected personal-data column except its name and kind |
| Terms that apply | Anthropic Commercial Terms of Service: Anthropic "may not train models on Customer Content from Services"; customer content is treated as confidential; Anthropic's data-processing terms are incorporated by reference. DAB must tell users that factual statements in AI output should be checked before they are relied on — done by the AI label in the app, on share pages and in exports. DAB's users must follow Anthropic's Usage Policy — passed on in the Terms (section 7) |
| Usage Policy change | A revised Usage Policy takes effect on **12 November 2026**: AI disclosure in consumer-facing chat and agents, human review for high-risk uses (finance, credit, employment, education and others), extra rules for products used by under-18s. Re-read it before that date and check the Terms still match |

**To confirm (owner):**

- [ ] The account is on the commercial (API) terms, not consumer terms, and who the contracting party is.
- [ ] Retention. Anthropic's documentation says API prompts and outputs are not retained by default, except for named "Covered Models" that require 30-day retention. Secondary sources cite 7 or 30 days for the standard API. Check the account's actual setting, and whether the model in `AI_MODEL` is a Covered Model. Record the answer here; the Privacy Notice says only "a limited time under its own retention policy" until it is confirmed.
- [ ] Training: no training on API content, and no feedback or data-sharing programme switched on in the account.
- [ ] Data-processing terms: obtain a copy; check for standard contractual clauses (EU SCCs or ASEAN model clauses) and breach-notification terms; list Anthropic's own sub-processors.
- [ ] Region: where the data is processed; whether any regional option exists.
- [ ] If `ANTHROPIC_BASE_URL` is ever pointed at another platform (a cloud provider's hosted Claude, for example), that platform becomes the sub-processor instead: update this register, the Terms and the Privacy Notice first.

## 2. Hosting provider

| | |
|---|---|
| Role | Processor (DAB's own data) and sub-processor (upload data) |
| Who | `railway.json` builds `backend/Dockerfile` and starts `node src/server.js`, which points to Railway. The repository does not prove where production runs. Set `LEGAL_HOSTING_PROVIDER` to the real provider |
| Location | **Unknown in the repository**: `railway.json` names no region. Set `LEGAL_HOSTING_REGION` |
| What it holds | Everything server-side: the database (SQLite file on a volume, or Postgres), stored files (local driver: under the data directory, which needs a persistent volume), the request logs written to standard output, environment secrets |

**To confirm (owner):**

- [ ] Provider and region (and whether the region is in Thailand). Then set `LEGAL_HOSTING_PROVIDER` and `LEGAL_HOSTING_REGION`; the legal pages print them.
- [ ] The provider's DPA and its transfer clauses; accept it in the account if it must be accepted; file a copy. Then set `LEGAL_HOSTING_TRANSFER_BASIS` to the safeguard it gives (for example "the provider's data-processing agreement, with standard contractual clauses"), as counsel confirms: the Privacy Notice (section 8) and the Terms print it as the transfer safeguard, and say "being set up" until it is set. Production warns at boot while it is empty.
- [ ] Disk or volume encryption at rest.
- [ ] Backups and snapshots: whether they exist, how long they are kept, and whether an erased account can be removed from them within 90 days.
- [ ] Log retention for standard output (the request logs).
- [ ] Account security: two-factor sign-in for the hosting account, who else has access, and that environment secrets are visible only to them.
- [ ] HTTPS enforced at the edge.

## 3. Optional providers — only if configured

Each becomes a sub-processor the day it is used. Before that day: add it here, add it to the Terms list and, if it changes what the Privacy Notice says, update the notice (bump `LEGAL_VERSION` for a material change).

| Setting | What it would hold | Notes |
|---|---|---|
| `DATABASE_URL` (Postgres) | Every table: accounts, analyses, logs, the traffic log | Use certificate verification: `DATABASE_SSL_CA` or `DATABASE_SSL_VERIFY=1` (`.env.example`) |
| `REDIS_URL` | Short-lived cache: profile including email (60 s), History rows (30–120 s), rate-limit counters keyed by IP address or user id (up to 15 minutes), the AI budget counter | If the provider persists to disk, its retention and encryption apply |
| `STORAGE_DRIVER=s3` with `S3_ENDPOINT` | Uploaded files that users chose to save | Any S3-compatible service (AWS, Cloudflare R2, MinIO). Needs `@aws-sdk/client-s3` installed, which is not in the lockfile today |

## 4. Email provider for the contact address

| | |
|---|---|
| Role | Processor for DAB's own data (controller record C8 and C9) |
| What it holds | Privacy requests, reports about shared pages, security reports and other mail sent to `LEGAL_CONTACT_EMAIL`, and the replies |
| Who and where | **To fill** (the provider behind `LEGAL_CONTACT_EMAIL`) |

The Privacy Notice's list of recipients (section 8) includes "the provider that hosts our contact mailbox" without naming it. Fill in the row above, and ask counsel whether the notice should name the provider.

DAB itself sends no email: there is no mail library in the backend, and the email address on an account is never used to send anything.

## 5. Not sub-processors — no user data

| Vendor | Use | Why no user data |
|---|---|---|
| Docker Hub | CI can push the server image when `DEPLOY_ENABLED=true` (`.github/workflows/ci.yml`) | The image holds code and the built web app. `.dockerignore` excludes `backend/data`; it does not exclude `.env` files, so build from a checkout that has no `backend/.env` |
| GitHub | Source code and CI | Tests use synthetic sample files (`backend/sample-data/`) |
| Font and library authors | Self-hosted fonts and open-source packages | Bundled with the app; the browser loads nothing from third parties. Licences on `/licenses` |

Not used at all: analytics, advertising, error-tracking services, content delivery networks, third-party fonts or scripts, outbound email.

## 6. Adding or changing a vendor

1. Check what personal data it would receive and where.
2. Get and file its terms and DPA; check transfer clauses if the data leaves Thailand.
3. Update this register, `ropa-controller.md` and `ropa-processor.md`.
4. Update the Terms' sub-processor list (`frontend/public/terms.html`, section 6) **before** it starts, and the Privacy Notice where it names recipients. For a material change, bump `LEGAL_VERSION`.
5. Only then switch it on.

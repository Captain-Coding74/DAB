# Changelog

Refinement releases. Feature history before v20.5 lives in the ADRs and the
metrics ledger (`metrics/history.jsonl`).

## [21.31] — 2026-10-11 "Notice wording"
Wording slips in the Privacy Notice, the Storage notice and the Contact
page, found while checking the notice line by line for counsel. None
changes what DAB does with data, so `LEGAL_VERSION` stays 2026-10-10 and
nobody is asked to accept again; each changed page prints "Wording revised
2026-10-11" beside its version, at the top (and, for the Privacy Notice, in
§15 too), in both languages.
- **Sensitive data:** the English list of PDPA s.26 categories said "sexual
  orientation"; the Act and the Thai text say sexual behaviour.
- **Analytics:** "no analytics" (Privacy §2 and §14, Storage notice) now
  says no *third-party* analytics; Privacy §14 points to DAB's own upload
  statistics in §3. Advertising and tracking stay ruled out without
  qualification. The Thai said "no user-behaviour analytics", which the
  telemetry linked to signed-in users made doubtful; it now names
  third-party usage analytics, as the English does.
- **Download and deletion:** Privacy §2 said you can download or delete
  "all of it" at `/account`, and the Contact page that you can download "all
  your data". Traffic-log entries are not in the download (they are sent on
  request) and survive deletion for their 90 days, as does the
  privacy-request-log entry, so §2 now says "almost all of it" and links §9,
  and the Contact page names the traffic-log exception like §12 does.
- **Encryption:** §3 and §10 said stored files are encrypted "when the
  operator has enabled it", which no reader can check. They now print
  `{{STORAGE_ENCRYPTION}}`, filled from a check rather than from the key
  alone (`services/encryptionStatus.js`): no key → DAB does not yet encrypt
  stored files; key set but anything still in the clear (objects saved
  before the key, pre-v21.1 copies in `dataset_versions.file_content`), not
  checked yet, or the check failed → files saved since encryption was
  switched on are encrypted and some older ones may not be yet; key set and
  the check finds nothing in the clear → stored files are encrypted at rest
  (AES-256-GCM).
  The check runs at boot and daily, reads only each object's first bytes,
  and logs counts (never keys) while plaintext remains.
- **CI, about half the wait:** the 3.5-minute "Browser Suite + Perf Budgets +
  Quality Gates" job ran the browser suite, coverage (70 s) and the audit
  (35 s) in series, and the Docker build waited for it before Deploy rebuilt
  the image without a cache. Browser + perf, coverage and the audit are now
  separate jobs that run side by side; the gate job keeps its name, reads
  their metrics and passes only when all three did. The image builds
  alongside the tests, Deploy reuses its cached layers, the two jobs without
  an npm cache got one, and a newer push to a branch or PR cancels the run
  it replaces (never on `main`).

## [21.30] — 2026-10-11 "Privacy"
A legal review of DAB against Thailand's PDPA, the Computer-Related Crime
Act and consumer law found gaps that carried legal risk: what the app did
with data, what its pages claimed, and what it never told anyone. This
release closes them in ten parts, built in two streams and merged, and
publishes the notices that describe the result. The notices are interim:
they and the back-office drafts await review by a Thai data-protection
lawyer (open questions in `docs/privacy/README.md`).
- **AI minimisation.** Analyze, chat, the deep-dive agent and fix
  suggestions send statistics only — no raw rows. Personal-data detection
  now also covers email, payment-card and bank-account numbers, passports,
  postal addresses, LINE/social IDs and the PDPA s.26 kinds (by header), and
  a detected column reaches the AI as its name and kind only. AI Edit sends
  rows only after a confirmation dialog (`AI_EDIT_CONFIRM_REQUIRED`).
  "Statistics only" per upload and an owner-only AI switch per dataset:
  chat, the agent and AI Edit refuse (`AI_DISABLED`); analysis and fix
  suggestions fall back to statistics and rules.
- **Data lifecycle.** Analyze stores the analysis record only; the file is
  stored on an explicit "Save dataset" (a class roster also needs the
  school-authority confirmation, `SCHOOL_AUTHORITY_REQUIRED`). No IP with
  analyses. A daily job enforces the retention periods (Trash 30 days,
  inactive datasets 365, analyses 365, telemetry 395, audit log 365, feed
  and notifications 365, traffic log 90, privacy requests 3 years), and
  deletes cascade.
- **Account rights.** `/account`: download everything as JSON, delete the
  account (password-confirmed, immediate). A privacy-request log keeps only
  a hash of the user id; `privacy-request.mjs` logs email and post requests.
- **Click-wrap and the traffic log.** Sign-up needs the Terms/Privacy box
  and the age line; the accepted version, time and IP are kept, and a
  version change asks signed-in users to accept again. The Computer-Related
  Crime Act s.26 traffic log records the listed events for 90 days (never
  less), with a dataset id, share id or export format as its only reference.
- **Security hardening.** Stored files are encrypted at rest (AES-256-GCM)
  when `STORAGE_ENCRYPTION_KEY` is set; new object keys hold no file name;
  Postgres certificate verification (`DATABASE_SSL_CA` /
  `DATABASE_SSL_VERIFY`); no default secrets in `docker-compose.yml`; the
  workspace and collaborator lists show no one's email.
- **Honest claims.** Landing copy scoped to what the engine really does, the
  hero console labelled an illustration, in-app privacy notes. Scheduled
  Reports is off ("coming soon", `FEATURE_UNAVAILABLE`); the stub runner and
  the stored schedules, recipient emails included, are gone.
- **Share links and AI labels.** Links come only from a dialog that warns
  who can see the report, with a generic title, a required expiry (1, 7, 30
  or 90 days — old links got 30) and an optional password. Public pages are
  noindex, omit the file name and the values of personal-data columns, and
  link "Report this page"; revoking deletes. AI text is labelled in the app,
  on share pages and in PDF/Excel exports (`ai_generated`). Share tokens are
  redacted from request logs.
- **Legal pages.** `/privacy`, `/terms`, `/storage`, `/contact` and
  `/licenses`, in English and Thai, served before the SPA; `GET /api/legal`;
  footer links on every page.
- **Licences.** Third-party notices are generated and gated
  (`npm run licenses:check`, in CI); the IBM Plex OFL ships with the fonts.
- **Back office.** `docs/privacy/`: records of processing, retention
  schedule, breach plan, request procedure, vendor register, DPO assessment
  and the evidence behind every public claim.
- **Integration fixes.** "Save dataset" links the analysis on screen and
  keeps a statistics-only choice (the dataset starts with AI off). Share
  pages re-classify analyses saved before the wider detection.
  `POST /api/analyze` checks the `datasetId`/`workspaceId` it is given, and
  a legacy analysis with no owner is no longer open to every signed-in user.
  Service logs carry no file names, column names or values. The first paint
  is back under its 101 kB budget (string packs for lazy screens, the fixes
  panel loads with its tab). The History preview carries the AI label, the
  phone nav fits again, and `docker-compose.yml` passes the `LEGAL_*` and
  `*_RETENTION_DAYS` settings through.
- **Review fixes.** Four reviews of the merged tree found gaps, now closed.
  `/account` lists every stored file (copies earlier versions stored
  without asking are marked so, and the notices disclose them) and every
  share link, each with a delete, and "Analyse again" reopens a file;
  `/account` stays open behind the re-accept dialog, which nothing can act
  behind any more (shortcuts, palette, Tab). Listing or filing datasets in
  a workspace needs membership. A storage delete that fails now fails the
  erasure instead of reporting it done, sessions are revoked first, and an
  erased id cannot refresh. A wrong password at deletion is
  `403 WRONG_PASSWORD`, not a 401 the SPA re-sent. `storage-encrypt` also
  seals pre-v21.1 file copies left in the database, and reads check the
  stored sha256. Legal templates are unreachable under any spelling of
  their file names. A CSV quote error is a 400 and never puts a cell in the
  error log. Old analyses: numeric card columns are re-detected, and their
  pre-v21.30 AI report and chat are neither re-sent to the AI nor shown on
  share pages; Thai file names are kept out of old share titles, and new
  uploads store them as UTF-8. Re-analysing after Save keeps the dataset's
  AI switch; "Statistics only" keeps Share and the exports; recent comments
  and restores count as dataset activity. The notices name the contact
  mailbox's provider among recipients, print the hosting transfer
  safeguard (`LEGAL_HOSTING_TRANSFER_BASIS`), describe how a new version
  takes effect, and say the traffic log is sent on request rather than in
  the download.
- **Tests and budgets.** 594 backend unit, 399 integration, 81 frontend,
  25 HTTP e2e and 39 browser/geometry tests pass; the browser suites now
  drive sign-up, Save dataset, the share dialog, the AI-edit confirmation,
  the `/account` file and link deletes, a Statistics-only result, the
  re-accept dialog (and its keyboard guards) and the legal pages. They run
  on the bundled Chromium again (without its `--single-process` flag).
  Initial payload 100.9 / 101 kB; total code 246.5 / 247 kB (raised from
  244 for the `/account` lists, reason in `frontend/perf-budget.json`). The coverage run reads its
  suite lists from `backend/package.json`; `maxFilesUncounted` 29 → 38 for
  eight lazily loaded privacy components and two operator CLIs (reason in
  `quality-budget.json`).
- **Dependencies.** `npm run audit:gate` was red on 21.29 too: advisories
  published since the last dependency pass. `npm audit fix` (lockfile only)
  brings proxy-addr 2.0.8 (IP spoofing through an IPv4-mapped IPv6 trust
  subnet; `req.ip` feeds the traffic log and the rate limiter) and
  shell-quote 1.12.0, both CRITICAL. The rest clear only with the
  tailwindcss 4 rewrite; all five are frontend devDependencies, so they
  join postcss and vite in the gate's reviewed allowlist. The gate passes.

**Before deploying**, configure:
- `LEGAL_CONTACT_EMAIL` and `LEGAL_POSTAL_ADDRESS` (PDPA s.23),
  `LEGAL_HOSTING_PROVIDER`, `LEGAL_HOSTING_REGION` and
  `LEGAL_HOSTING_TRANSFER_BASIS` (ss.28–29: the safeguard for keeping data
  with a host outside Thailand, as confirmed with the host and counsel), and
  `LEGAL_OPERATOR_NAME` if the operator is not the default. Production
  warns at boot while any of the five is empty, and the pages say "being
  set up".
- `STORAGE_ENCRYPTION_KEY` (keep a copy: nothing can read a file without
  it), then run `npm run storage-encrypt -w backend` once to encrypt files
  stored before it was set (`-- --dry-run` counts them first). It also
  moves pre-v21.1 copies still in `dataset_versions.file_content` into
  sealed storage and clears the column.
- The first retention run, about a minute after the first boot, deletes
  every saved dataset with no recorded activity (edit, version, analysis,
  comment, activity-feed entry) in 365 days — including copies earlier
  versions stored automatically. Take a backup first if you need one.
- On a managed Postgres, `DATABASE_SSL_CA` or `DATABASE_SSL_VERIFY=1`.
- Docker Compose: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`,
  `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` have no defaults any more; an
  existing `pg-data` volume needs its password changed once (README).
- `*_RETENTION_DAYS`: leave the defaults unless the Privacy Notice changes
  first — it states those periods. `TRAFFIC_LOG_RETENTION_DAYS` cannot go
  below 90.
- `LEGAL_VERSION` is `2026-10-10`. If the lawyer's review changes the
  notices materially, bump it: signed-in users then accept the new text.

## [21.29] — 2026-10-09 "Walkthrough"
A 23 s looping walkthrough of the real app now opens the "How it works"
section on `/welcome`. It shows tapping the corner-shop sample, the readout
powering on, the margin-note findings, the Quality grade (A · 92/100), and
the recommended bar chart. A guided cursor, framed close-ups and short
English captions carry it, and the three step cards below light up as live
chapter markers.

It is built from real screens and real figures only. A truth pass on the
real clock captures every still and number. A fake-clock pass replays the
same API response to capture the app's real micro-animations: the count-up,
the findings rising in, the grade ring drawing, and the bars growing. A gate
proves every plate pixel is a captured pixel. The app's own UI is mostly Thai
even in EN mode, and the video shows it as it is. The chrome bar says
"walkthrough · real screens · sample data · figures unedited".
- **Assets**: dab-walk.webm 1.33 MB / dab-walk.mp4 1.73 MB (23.000 s,
  1600×900), plus a poster and a still. Nothing is fetched until the figure
  is within 300 px of the viewport.
- **Behaviour**:
  - Plays when at least 50% visible and pauses below 25%.
  - The hero video pauses while it plays, so two videos never run at once.
  - It has a Pause/Play button, reachable by keyboard.
  - Reduced motion and Save-Data get the still, also lazy. Below 900 px the
    figure is hidden and nothing is downloaded.
  - A screen-reader transcript is provided in EN and TH.
- **Copy fixes** the video would otherwise contradict. "Up to 10MB" now
  reads the real limit from `/api/health` (25 MB). "~10ms" became "back in
  milliseconds".
- **Source**: `tools/walkthrough/` holds the capture, compositor, render,
  gate, seam, text-sharpness check and encode. The gate also fails if the
  page's chapter times or transcript figures drift from the capture. It
  re-encodes byte for byte. `.dockerignore` now excludes `tools/`.
- **Tests**: four new browser tests cover lazy arming, the narrow-screen and
  reduced-motion paths, and the hero/walkthrough hand-off.

## [21.28] — 2026-10-09 "Night Audit"
New hero background for `/welcome`: a 30 s seamless loop, all English,
replacing the 8 s extruded DATA ANALYSIS clip. An after-hours ledger lies open
on both sides of the headline. Its four steps play one at a time, and a step
rail under the right page keeps the whole pipeline in view: the active step
is lit, and each finished step rolls its number to a green check.
- **01 PARSE.** Four messy rows type in. A reading line crosses
  `Monthly sales report`, strikes it, tags it `SKIPPED — banner row` and files
  it as a grey rule. On the right, the cell cloud settles into a grid under
  `Date · Item · Qty · Sales` with `HEADER ✓`.
- **02 CLEAN.** One row at a time:
  - `14/01/2569` burns away and is set as 3D `2026-01-14`, its year counting
    down 543 on odometer reels.
  - `฿1,234.50` squeezes to `1234.50`.
  - `(500)` folds into `-500`.
  Each fix is echoed under its header word as three red-flagged cells flip to
  green.
- **03 CHART.** The grid topples into a bar chart over `Jan · Feb · Mar`.
- **04 GRADE.** The bars curl into a double-ruled seal and a green B+
  stamps into it. The clean column's margin rules turn green.

The camera is one unbroken 10° orbit with a dolly-zoom, timed to each step's
key moment. The scene uses the page's tokens and self-hosted IBM Plex faces,
plus darkened amber and green shades for the extrusion walls and a navy lamp.
The gutter behind the H1 stays dark by construction. A gate projects every
mesh in all 900 frames and fails on any intrusion into the measured headline
zones, any crop, or any token sliding under the console. Measured over every
frame at 1024–2560 px, EN and TH, headline contrast stays above 15:1 (white)
and 8:1 (amber).
- **Assets**: dab-bg.webm 1.04 MB / dab-bg.mp4 1.84 MB, both 30.000 s
  (were 260 / 787 KB at 8 s). The frame edge composites to exactly #0B1220.
- **The poster no longer sits under the video.** At .66 opacity a 34% ghost
  of the still showed through the moving camera.
- **Shorter bottom fade.** The hero's fade into the next section now covers
  only its last 150 px. It used to start at 60% of the stage, which dimmed the
  step rail on wide screens.
- **Narrow screens.** At 1280–1439 px the video width-fits frame x 60–1860,
  top-anchored, instead of cover-cropping the outer digits. At 600–1279 px a
  mask keeps only the calm centre, since cropped tokens read wrong ("B-" for
  B+, "500" for -500).
- **Bandwidth.** Each `<source>` now carries
  `media="(min-width: 1280px) and (prefers-reduced-motion: no-preference)"`.
  Below 1280 px only the near-still centre glow would show, so phones,
  tablets and reduced-motion visitors never download the video. They see
  poster.jpg. Reduced motion gets the new poster-still.jpg, the finished
  frame: B+ in its seal, all four steps checked, and the video's .66 opacity
  baked in.
- **Source**: `tools/hero-bg/`, an offline three.js renderer (headless
  Chromium, SwiftShader). Every window lives in one schedule. The kit has the
  legibility, crop and console gate, a loop-seam check, and encode and
  preview scripts. It is not an npm workspace, so the build, CI and quality
  gates are untouched. It reproduces the shipped frames bit for bit on the
  recorded Chromium build.
- **Verified**: 246/246 integration tests, 27/27 browser tests (including
  the /welcome CSP, font and reveal checks) and 32/32 frontend tests pass.

## [21.27] — 2026-09-26 "Router"
react-router-dom 6.30 → 7.18, the last moderate advisory from the audit
(open redirect via backslash in `<Link>`/`useNavigate`, GHSA-wrjc-x8rr-h8h6,
and a constructor injection in SSR hydration DAB does not use). The app
touches seven router symbols — BrowserRouter, Routes, Route, Link, NavLink,
useNavigate, useParams — all unchanged in 7, and it never opted into the v6
`future` flags, so there was nothing to migrate. Verified: 32 frontend unit
tests, the 17-test Playwright browser suite (real navigation in Chromium)
and the phone-viewport geometry checks all pass; bundle budgets hold (React
vendor chunk +5.4 kB gzip, initial payload 97 ≤ 101 kB). `npm audit` on
production deps is now down to `uuid` under exceljs alone (ADR-0008).

## [21.26] — 2026-09-26 "Inflate"
The rest of the security audit that produced 21.25. Four fixes:
- **XLSX decompression bomb** (was: anonymous DoS). MAX_UPLOAD_MB bounds
  compressed bytes; a workbook is a ZIP and ExcelJS inflates all of it into
  memory before parsing. A crafted sharedStrings.xml deflates 1000:1, so 25
  MB in meant gigabytes out — from `/api/analyze`, no login needed. New
  `services/zipGuard.js` runs before both ExcelJS entry points (streaming and
  full-row parse) and MEASURES inflation through a streaming inflater that
  counts and discards output, so a central directory that lies about its
  sizes gains nothing; past MAX_XLSX_INFLATED_MB (default 10× the upload
  limit — a real workbook inflates ~8×) the upload is refused with 413.
  ZIP64 honoured. +10 unit tests with hand-rolled archives (src/testZip.js),
  +2 integration tests (32 MB bomb in 40 KB → 413 on datasets and analyze).
- **`/api/metrics` was public** — every route with error rate and latency,
  process memory, DB backend. Now open outside production (the perf harness
  and test suites read it) and, in production, needs a signed-in operator
  (TELEMETRY_ADMINS, the allowlist now shared via `services/operators.js`)
  or a scraper's `METRICS_TOKEN` bearer; neither set → closed. +9 tests.
- **docker-compose trusted X-Forwarded-For with no proxy in front**: the
  file publishes port 3000 straight from Node, but the app's back-compat
  default is `trust proxy` 1 hop, so any client could forge its IP and walk
  past the login brute-force limiter. Compose now sets `TRUST_PROXY=0`;
  `.env.example` documents when to use 1.
- **Moderate advisories**: express 4.22.3 / body-parser 1.20.8 / qs 6.16.0
  (array-limit bypass, DoS), csv-parse 5 → 7.0.3 (prototype pollution via
  the columns path — the parser DAB is built on; 403 unit tests pass
  unchanged), node-cron 3 → 4.6.0 (drops the vulnerable uuid; the
  scheduler's `cron.schedule(expr, fn, { timezone })` is unchanged in 4).
  Left alone, deliberately: react-router (fix is the 6 → 7 major of the
  frontend router — its own change), and uuid under exceljs (ADR-0008).

## [21.25] — 2026-09-26 "MZ"
Security, from a source audit of the upload paths. The CSV magic-byte gate
was a blacklist (ZIP, OLE, ELF) and nobody had listed the Windows "MZ"
signature, so `malware.exe` renamed to `report.csv` passed the check and
landed in object storage. Nothing ever executed or re-served it, so the
exposure was low — but it was one "download original" feature away from
DAB handing a real executable to collaborators under a friendly name.
Now: one shared gate (`services/fileMagic.js`) with a positive rule — known
binary signatures (ZIP, OLE, ELF, **PE/MZ**) are refused outright, and
beyond that a `.csv` must READ as text (no NULs outside BOM'd UTF-16, no
control-byte density text never has). "Text" still means everything the
decoder accepts: UTF-8, UTF-16 with BOM, and TIS-620, whose Thai letters
are high bytes. The gate is Express middleware mounted right after multer
on every upload route — including `/api/analyze` and `/api/export/*`,
which only had the spoofable extension filter and are reachable
anonymously. +18 unit tests, +6 integration tests (renamed .exe rejected on
single, multi and version uploads and on the anonymous routes; TIS-620 and
UTF-16 CSVs still accepted).
Also from the same audit: `multer` 2.2.0 → 2.4.0, closing four HIGH
advisories in the multipart parser itself (DoS via crafted field names and
oversized array indexes, a file-descriptor leak on aborted uploads, and a
size-limit bypass through an async fileFilter race) — reachable anonymously
via `/api/analyze`. Transitive `browserslist` bumped to 4.29.1 for the
build pipeline's two HIGHs. The CI audit gate had never actually run on
these: the quality-budget step ahead of it had been red since v21.24.

## [21.24] — 2026-08-26 "ลำดับ"
Real Thai gradebooks are keyed by ลำดับ/เลขที่ (roll number), often with no
formal student id — and that shape got NO class report at all, while the
1..N column, being numeric, would have been SUMMED into every student's
score total. Now: a ลำดับ/เลขที่/ที่/No. header whose values form a 1..N
sequence classifies as student identity (header AND values must agree — a
score column merely named ลำดับ stays a score), inheriting every identity
rule: out of the score set, readable for the teacher, strict-masked from
the AI, aggregates/trend nulled. When both ลำดับ and เลขประจำตัว exist the
formal id keys the report and เลขที่ rides along as its own column. The
report is now labelled with the class from the file name (ห้อง 5-13.xlsx →
ทำเนียบห้องเรียน · ห้อง 5-13). +5 regression tests.

## [21.23] — 2026-08-26 "Hunt III"
A third adversarial hunt over the school-edition stack: 3 finders, every
candidate verified by a skeptic — 19 confirmed (16 unique), 0 refuted, all
fixed. The serious ones:
- **PDPA sampling window**: detection sampled the first 50 ROWS, so a
  citizen-ID column blank early and filled late classified as unprotected
  and its raw IDs went to the model. Now the first 50 NON-EMPTY values.
- **PDPA egress**: fixes /preview and /ai-edit returned raw rows (masked on
  every other surface) — now masked at the response boundary, with /apply
  restoring protected columns server-side so the masked echo round-trips;
  inference refuses identifier columns as test variables (group labels
  echoed raw values); identifier trend sums nulled so forecasts cannot
  carry the citizen-ID column's slope into the prompt.
- **Ragged CSV dead-end**: short rows (Excel drops trailing blanks) made
  every AI edit preview-then-fail; rows now align to header width.
- **Fixes were invisible**: re-analyzing re-uploaded the ORIGINAL browser
  file — applied fixes never showed. FixPanel now re-analyzes the STORED
  dataset (its fixed current version) after apply.
- Also: FixPanel's 🔒 line now uses the authoritative protected list (it
  overclaimed AND underclaimed); ai-edit max_tokens scales with the table
  (8000 truncated near-cap edits); suggest draws from the AI budget with
  rule-based degrade; demo threads pairwise again (5-row correlations were
  back); class report: proper even-class median, "-"-only columns are not
  checkboxes, blank เกรด falls back to the percent rule; checkbox-only
  sheets no longer paint every row red. +5 regression tests.

## [21.22] — 2026-08-25 "AI แก้ไขไฟล์ Excel"
"Teacher uploads messy Excel → AI fixes it → confirm → ranked class report"
now works end to end. Three pieces, all previously missing:
- **.xlsx full rows** (parseAllRowsAny): fixes, hypothesis tests and the
  class report now run on Excel uploads (cell flattening mirrors the
  streaming parser: dates, cached formula results, rich text). Fixed
  versions re-serialise as CSV and are now STORED as .csv — the old code
  would have stored CSV bytes under an .xlsx name, corrupting every later
  parse of that version. Class report for xlsx comes from headRows with an
  exact-parity guard (>500 rows → null, same as CSV).
- **PDPA-strict AI edit**: identifier columns (บัตรประชาชน, ชื่อ, วันเกิด,
  เลขประจำตัว, เบอร์) are absent from what the model sees — values AND
  headers — and spliced back byte-identical; instructions naming a
  protected column are refused without calling the model; /ai-edit/apply
  gets a server-side backstop rejecting any tampered identifier cell with
  the exact violations listed. 24 unit tests incl. a capturing fake client
  proving nothing sensitive is in the prompt.
- **แก้ไขข้อมูล UI** (FixPanel in the quality tab): the fixes engine had
  ZERO frontend callers — suggested fixes now flow suggest → preview →
  confirm, and free-text AI edit shows a cell-level diff before apply.
  Nothing auto-applies.
- AI model centralised to config.js AI_MODEL (default claude-opus-5,
  env-overridable) — was hardcoded in six files.

## [21.21] — 2026-08-24 "ช่องติ๊กส่งงาน"
- Class report understands CHECKBOX assignments, not just scored ones: a
  column of ✓/blank, ส่ง/ไม่ส่ง, TRUE/FALSE or 1/0 (Sheets/Excel checkbox
  exports) is detected by its values, pulled out of the score set (a 1/0
  column would otherwise rank the class on a "score" out of 1), and feeds a
  checklist: per-งาน submit rates, per-student งานค้าง, and the list a
  teacher actually wants — ยังไม่ส่งงาน, worst offender first. A pure
  checkbox sheet still reports, ranked by fewest missing; blank = not
  submitted, as in every real tick sheet. Demo gains ส่งใบงาน4 (✓/blank)
  and ส่งการบ้าน5 (TRUE/FALSE) on an independent RNG stream — every
  existing score byte-identical.

## [21.20] — 2026-08-24 "ชื่อ-สกุล"
- Class report shows the REAL name (ชื่อ-สกุล) alongside the nickname: every
  detected name column rides along (capped at 3), the demo file gains a
  deterministic ชื่อ-สกุล column (same seed — every score identical), and the
  strict AI boundary re-verified: no full name, surname fragment, or 13-digit
  run reaches the prompt.

## [21.19] — 2026-08-24 "ทำเนียบห้องเรียน"
The สถิติ tab, reported unreachable — and it truly was: a.datasetId was
read in exactly one place and set in zero, and the UI never called
POST /api/datasets, so the entire inference panel (t-test, ANOVA, Cronbach)
was dead code from the user's side.
- **Reachable now:** a signed-in analyze stores the file as a dataset
  automatically (non-fatal on failure) and lights the tab up; the anonymous
  gate message explains what signing in unlocks.
- **Class report** (`services/classReport.js`, deterministic, ADR-0001): the
  ranking a teacher actually asks for first — สูงสุด/มัธยฐาน/ต่ำสุด, competition
  ranking over every row, and เกียรติบัตร: a real เกรด column decides at
  4.00; without one, ≥ 80% of estimated full marks (observed max rounded up
  to a gradebook ceiling — labelled as an estimate). UI-bound only: not in
  the prompt, not in summaryStr, not in saved stats_json; identity limited
  to student id + one name column, citizen ids never selected. Renders in
  the สถิติ tab above the hypothesis tests; missing scores flagged, not
  hidden. Routes now thread `sensitive` through to the bundle (it was
  dropped in the hand-built parsed objects, which also left
  sensitiveColumns empty in responses).

## [21.18] — 2026-08-24 "School Edition v1"
First vertical: Thai schools (teachers' วิจัยในชั้นเรียน / classroom research).
The general edition is frozen and shippable from tag `general-stable-v21.17`.
- **PDPA guard** (`services/sensitive.js`, 28 tests): detects บัตรประชาชน
  columns by the real mod-11 checksum (a lying header cannot hide one),
  plus student ids, names, birthdates, phones. Applied at the ONE place a
  file becomes data (parseFileStreaming), so the UI, saved stats_json,
  chat/agent context, exports and previews all receive the same protected
  view: citizen ids/phones x'd, identifier aggregates nulled (including the
  derived IQR — the IQR of an id column is itself a 13-digit number),
  birthdate ranges reduced to years. The AI boundary applies a STRICT pass
  on top: no identifier of any kind — not even a student id — leaves for
  the model, and the prompt summary names masked columns in one honest line
  instead of narrating null statistics. Charts and suggestions skip
  identifier columns. The uploaded file itself is never modified.
- **Classroom demo** (ผลการเรียนห้อง ม.3/1): 40 students, deterministic,
  with synthetic checksum-valid citizen ids so the guard demos itself;
  pre/post scores tuned so the paired t-test is genuinely significant,
  งาน3 clearly hardest, q1-q5 at Cronbach's α ≈ 0.79.
- **School prompt suggestions** (paired t-test, hardest assignment, students
  needing help, questionnaire reliability) trigger on classroom-shaped
  columns; ColumnStats shows a PDPA banner and per-column 🔒 chips.

## [21.11] — 2026-08-23 "Backend hunt II"
A second backend sweep — auth/security deep-dive, a routes second pass, and a
regression audit of the v21.10 diff — with adversarial verification of every
finding. 14 fixed; one candidate (Excel formula injection) refuted as already
handled. Suites green: 314 unit + 238 integration + 17 browser; quality gate
passing.
- **Auth lifecycle (routes/auth.js).** Register/login accepted non-string
  credentials — a numeric password's `.length` is `undefined`, slipped the
  `< 6` gate, then threw 500 in bcrypt; a missing username threw 500 on libsql
  but 401 on Postgres. Both now type-gate first. Refresh resolved the user with
  no `is_active` check, so a banned user could rotate tokens forever
  (`findActiveUserById` now). Rotation was a non-atomic check-then-revoke:
  concurrent refreshes of one token both succeeded — now a conditional
  `UPDATE ... WHERE revoked=0 RETURNING id` is the serialization point, and a
  re-presented (already-rotated) token burns the whole chain (reuse detection).
- **Workspace branding IDOR (routes/workspaces.js).** The PATCH spread
  `req.body` *after* the path id, so `{ id: "<other-ws>" }` overrode it — any
  member could rewrite any workspace's branding. Fields are now passed
  explicitly; the id can only come from the path.
- **Chi-square DoS (routes/inference.js).** The contingency table ran
  `rows.filter()` once per cell — O(distinctX·distinctY·N), an event-loop stall
  on two free-text columns. Rebuilt as one O(N) Map pass with a 50-category cap.
- **AI budget bypass (routes/chat.js, fixes.js).** The daily budget was enforced
  only on /api/analyze; chat, streaming chat, the agent, and ai-edit called the
  model with no accounting. All now reserve via `tryConsumeAI()` and 429 on
  exhaustion.
- **trust proxy (config.js, app.js).** Was hardcoded `1`; on the shipped
  direct-to-Node compose that lets a client forge `X-Forwarded-For` and spoof
  `req.ip`, defeating the IP-keyed auth limiter. Now `TRUST_PROXY` env, default
  1 (unchanged for single-proxy deploys), set 0 for direct exposure.
- **Version-number race (db/datasetRepository.js, migrate.js).** The
  compute-in-INSERT is atomic on SQLite but not on Postgres READ COMMITTED; a
  `UNIQUE(dataset_id, version_num)` index now backstops it and the insert
  retries on conflict.
- **Lower severity.** `refresh_tokens` grew unbounded → hourly prune in the
  scheduler; "shared with me" reported the page size as `X-Total-Count` → real
  count query; `POST /comments/:id/resolve` had no access check → same gate as
  the other comment routes; timeliness date detection missed camelCase/Thai
  names → now trusts the parser's `semantic:"date"`; multi-upload orphaned the
  first stored object if the first file failed to parse → parse before store.

## [21.10] — 2026-08-19 "Bug hunt"
71 bugs found by a six-area sweep with adversarial verification of every
finding (83 candidates; 5 refuted, e.g. the pg-pool "leak" the installed
version already handles). All fixed; suites green afterward: 314 unit +
238 integration + e2e + 27 browser + 32 frontend + build.
- **Postgres was unusable:** `INSERT OR IGNORE` (refresh tokens, workspace
  members, tags) and `GROUP_CONCAT` (dataset list) are SQLite-only — every
  register/login/refresh and the dataset page 500'd under `DATABASE_URL`.
  Now `ON CONFLICT` + a batched tag query (which also un-corrupts tags
  containing commas). The SQLite `$N→?` rewrite bound repeated/out-of-order
  placeholders wrong (libsql binds NULL to leftovers, silently) — args now
  bind by name.
- **IDOR:** the `analysis:<id>` cache key served one user's analysis to any
  authenticated caller (now user-scoped); dashboards/widgets, comments,
  activity, and folders had no ownership/membership checks at all — all now
  guard with the same `isMember`/`getUserDatasetRole` idiom as workspaces.
- **Wrong numbers:** per-column null filtering destroyed row pairing for
  paired-t/correlation/regression/Cronbach (listwise deletion now); PLS-SEM
  coerced blank cells to 0 (now refuses, naming the indicator); constant-y
  regression claimed r²=1 p=0; the quantile "reservoir" was a first-10k
  capture (real Algorithm R, deterministically seeded); one-pass correlation
  cancelled catastrophically on large offsets (Welford co-moments); scatter
  plotted the y column against itself.
- **Behavior:** scheduled reports fired every minute forever (`next_run` now
  computed by a dependency-free cron evaluator and persisted); the rate
  limiter re-armed its TTL on every hit (window never reset); multi-upload's
  magic-byte rejection returned from an inner IIFE (double-send, orphaned
  storage object, single-file bypass); legacy `.xls` hit the ZIP loader's
  opaque error (clear bilingual message now); permanent delete left the
  stored bytes on disk; share unlock never cleared `needsPass`; the modal
  focus trap re-armed per keystroke; pie labels clipped at the container top.
- One stale assertion updated: `agent.test.js` required the budget-exhausted
  final call to omit `tools` — the real API 400s that request shape when
  messages carry `tool_use` blocks (`tool_choice: none` is the fix it now
  asserts).

## [Unreleased] — v21 "Production Polish"
40% UX polish · 30% performance · 20% documentation · 10% bug fixes
- **Perf:** `ColumnStatsPanel` moved to its own module (`components/ColumnStats.jsx`).
  Parking it inside `components/charts` in v20.6 statically welded it to
  recharts and pulled ~143 kB (gzip) into the initial payload — the bundle
  ratchet caught it the first time it ran. Initial payload is back under the
  90 kB budget; the charts chunk is lazy again.
- **UX:** chart-type switcher labelled in Thai (values stay `Bar`/`Line`/… for
  saved-config compatibility); spinners stay animated under
  `prefers-reduced-motion` (progress indication is essential motion —
  a frozen spinner reads as a hang).
- **Bug:** dead `QualityRing` import removed from SharePage (pre-dated v20.5).
- **Docs:** this changelog; ADR index updated.

## [20.6] — 2026-07-26
- `ColumnStatsPanel` shared between the dashboard and the public share page —
  the share page's hand-rolled copy (stock-blue chips, no median/σ/missing%)
  deleted; public reports now show the full statistics.
- Twin `ai.messages.create` blocks in `routes/analysis.js` collapsed into
  `generateAnalysis()`; the model string is named once.
- `ledger.test.js` added: enforces the tailwind↔ledger mirror, the 1.4:1
  series-separation floor, and the chart-theme contrast minimums. It
  immediately caught two v20.5 regressions (extensionless ESM import that
  broke `npm test`; heatmap white-on-stamp at 3.37:1 — now navy-on-stamp 5.0:1).
- Heatmap: caption + `scope` row/column headers. Chart-type buttons:
  `aria-pressed`. Share password field: labelled.
- Tests 220 → 225 · duplication 1.58% → 1.48%.

## [20.5] — 2026-07-26
- Every stale green removed from source: `#2F6B4F` (pre-v20.4 brand) in the
  AuthPage logo, favicon, share fallback, `theme-color`, Swagger topbar;
  `#1D9E75` (workspace default) in the form, repository ×2, schema default;
  unlabelled `#34B27B` in `grade.js`; green-black tour scrim → navy.
- One `Wordmark` (exported from `ui/`), consumed by App and AuthPage; favicon
  rebuilt on the v20.4 plate.
- `lib/ledger.js` runtime palette (ADR-0007); charts fully tokenized; series
  reordered for greyscale separation (worst pair 1.08:1 → 1.47:1).
- Orphan `_parity.mjs` → `backend/scripts/parity-check.mjs`.
- ui arbitrary values → tokens: `rule-deep`, `rule-line`, `pencil-line`.

## [Unreleased] — v21 security pass
Four backend hardening fixes from an api-security-testing / secure-api-design review, each with a test:
- **Refresh-token rotation** (`routes/auth.js`): `/api/auth/refresh` now issues a
  new refresh token and revokes the presented one. A leaked refresh token is
  usable for a single call instead of its full 7-day life.
- **Share brute-force limiter** (`middleware/rateLimiter.js`, `routes/shares.js`):
  the public share route mounted outside the `/api` limiter; a password-protected
  link could be brute-forced unthrottled. New `shareLimiter()` keyed by IP+token.
- **Magic-byte upload check** (`routes/datasets.js`): the filename-extension filter
  was spoofable. Uploads now verify leading bytes (xlsx=ZIP, xls=OLE, CSV=not a
  known binary) before the streaming parser runs. Rejects a renamed binary.
- **Query-string password removed** (`routes/shares.js`): the share endpoint no
  longer falls back to `?password=`; header-only, so secrets stay out of logs.
- Tests +2 (magic-byte reject + genuine-CSV accept); refresh test asserts rotation.
  Backend 143 unit + 68 integration, frontend 26 — all green.
- **API docs (openapi.yaml)**: refresh 200 response documents the rotated `refreshToken` + 429; share endpoint no longer advertises the removed `?password=` query param. Found by tracing every consumer of the v21 contract change.
- **Client refresh rotation** (`store/index.js`): `refreshTokens()` now persists
  the rotated refresh token the server returns. Without this, the client kept the
  old (now-revoked) token and the next refresh 401'd — a self-inflicted logout two
  cycles after the v21 server rotation. Found by a vercel-composition-patterns pass
  reviewing state handling.

## [Unreleased] — v21 dependency audit
- `npm audit` baseline 16 vulns (3 critical) → safe `npm audit fix` (×2, never
  `--force`) → 11 remaining, 0 critical. All eleven accepted and bounded in
  ADR-0008 (ExcelJS-transitive DoS chain behind the authenticated, size-capped,
  magic-byte-gated upload path; react-router pending the v7 major).
- CI: `npm ci` moved to the repo root (workspaces — per-directory lockfiles
  don't exist, so both test jobs failed before evaluating any code); scripts
  run with `-w`; dependency gate added (`--audit-level=critical` hard,
  `high` informational per ADR-0008).
- **Rate-limiter double-count** (`middleware/rateLimiter.js`): `apiLimiter`'s
  `keyByUserOrIp` emits `ip:<addr>` for anonymous requests — byte-identical to
  `authLimiter`'s key. Since `/api/auth/*` passes through both, one request
  incremented the same counter twice (`ERR_ERL_DOUBLE_COUNT`), halving the real
  auth budget to ~5 attempts instead of 10. `authLimiter` now keys on
  `auth:<addr>`. Pre-existing; surfaced by reading the integration-suite log.
- **Duplicate `onKeyDown`** (`pages/SharePage.jsx`): the v21 share-form edit
  added a second handler to an Input that already had one. Vite flagged it;
  removed.

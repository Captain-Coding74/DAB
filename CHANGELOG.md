# Changelog

Refinement releases. Feature history before v20.5 lives in the ADRs and the
metrics ledger (`metrics/history.jsonl`).

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

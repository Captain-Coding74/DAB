# 8. Accepted dependency risks (post-audit, v21)

**Date:** 2026-07-29 · **Status:** Accepted

## Context

`npm audit` ran for the first time in v21. The first pass reported 16
vulnerabilities including 3 critical; plain `npm audit fix` (never `--force`)
cleared every critical — the unmaintained `yamljs` chain carrying `underscore`
(arbitrary code execution), plus `fast-csv`, `tmp`, and `argparse`.

**Counts are not the unit of measurement here.** The exact total shifts with
lockfile state and npm's resolution, so this ADR classifies by *root and
reachability* rather than pinning a number that will not reproduce.

### Dev-only — not shipped, not exposed

- `vite` → `esbuild` (GHSA-67mh-4wv8-2f99). The advisory is that a website can
  send requests to the **dev server**. Not present in build output; affects
  `npm run dev` on a developer machine only.
- `autocannon` → `hyperid` → `uuid`. Load-testing tool, `devDependencies`,
  never in a deployed artifact.

Neither reaches production. Both are accepted without mitigation.

### Runtime — accepted with mitigations

- **ExcelJS chain** (high): `brace-expansion` (GHSA-mh99-v99m-4gvg, DoS) and
  its dependents `minimatch` / `glob` / `archiver` / `archiver-utils` /
  `zip-stream` / `readdir-glob`, plus `uuid`. ExcelJS's current release still
  pins old `archiver`; the only fix npm offers is `--force`, which
  **downgrades ExcelJS to an older major** — the engine under the entire
  streaming parser (ADR-0003).
  *Mitigation:* reachable only via dataset upload, which requires
  authentication, is capped at 10 MB by multer before parsing, and passes the
  v21 magic-byte gate. Worst case is a crashed worker on a hostile file from a
  logged-in user.
- **react-router** (moderate): open redirect via backslash
  (GHSA-wrjc-x8rr-h8h6) and SSR-hydration constructor injection
  (GHSA-337j-9hxr-rhxg). Four internal routes, no SSR. Clearing them fully
  needs the React Router 7 major.
- **node-cron**, **yamljs** (transitive `uuid` / `glob`): same upstream roots
  as above; no independent fix available in range.

## Decision

Accept the eleven, with bounds, and gate against growth:

1. **ExcelJS chain: accepted.** All DoS-class. The vulnerable code is
   reachable only through the dataset upload path, which requires
   authentication, is capped at 10 MB by multer before parsing, and sits
   behind the v21 magic-byte gate. Worst case is a crashed worker on a
   hostile file from a logged-in user — bounded, recoverable, logged.
2. **react-router: accepted until the v7 major.** The app has four internal
   routes and no SSR; neither advisory has a realistic path here. Revisit as
   part of a deliberate React Router 7 upgrade, not an audit auto-fix.
3. **`npm audit fix --force` is prohibited** in this repo. It resolves the
   above by downgrading the parser. A broken ExcelJS is a worse outcome than
   every vulnerability on this list combined.
4. **CI gates at `--audit-level=critical`** (hard fail) and prints the full
   high-level report informationally. The gate rises to `high` the day the
   ExcelJS chain clears.

## Consequences

- `npm audit` will keep reporting findings until upstream moves. The set is a
  recorded decision, not neglect; this ADR is the record. Do not chase the
  number — check that every finding still maps to a root listed above.
- A fresh `npm ci` from a different lockfile state may report a different
  total. That is resolution drift, not regression. The test is whether a new
  root appears, or a finding stops being DoS-class.
- Revisit triggers: an ExcelJS release that bumps `archiver`/`uuid`
  (check `npm view exceljs dependencies` quarterly), the React Router 7
  upgrade, or any new advisory that is not DoS-class on this chain — RCE or
  data exposure on these paths voids the acceptance immediately.
- Install scripts remain off in CI (`ignore-scripts`): the audit log flagged
  two packages with postinstall hooks, and a compromised transitive must not
  execute code at install time.

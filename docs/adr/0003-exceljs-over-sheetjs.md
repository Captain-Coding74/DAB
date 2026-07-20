# 3. exceljs over SheetJS for spreadsheet parsing

**Date:** 2026-07-14 · **Status:** Accepted

## Context

`xlsx` (SheetJS) carried two HIGH-severity advisories — prototype pollution
(GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) — marked **"no fix
available"**, because the maintained builds moved off the npm registry. It sat
in the path that parses **untrusted user uploads**: the worst possible place to
hold an unpatchable vulnerability.

## Decision

Replace it with **exceljs** across all three consumers (streaming parser,
report writer, legacy parser). Guard the outcome with `scripts/audit-gate.mjs`,
which fails CI on *fixable* HIGH/CRITICAL advisories reachable from production
code — with a documented allowlist for reviewed dev-only exceptions.

## Consequences

- Zero HIGH/CRITICAL advisories in shipped code.
- exceljs is async and has an explicit cell model, so coercion is now
  deliberate and documented: dates → `YYYY-MM-DD`, formulas → their computed
  *result*, hyperlinks → visible text, error cells → missing.
- The migration was only safe because parity was provable: an in-memory `.xlsx`
  must produce **byte-identical stats** to the equivalent CSV. That test
  immediately caught exceljs manufacturing a phantom column from a stray cell
  below the header (its `columnCount` runs past the header row).
- `generateExcel` became async, rippling into two callers. Accepted.

# 9. AI row editing sends raw data, and says so

**Date:** 2026-08-12 · **Status:** Accepted, with limits

## Context

ADR-0006 states that the agent queries computed statistics and never sees raw
rows. That constraint has held everywhere: the insights engine, the deep-dive
agent, and the v21.3 fix catalogue, where the model may only name an operation
from a closed list and deterministic code performs it.

The request was for the model to edit cell values directly — a free-text
instruction like *"merge the branch names that are spelled differently"*
applied to the actual data. That cannot be done within ADR-0006.

Three ways it could go wrong, in order of how much they matter here:

1. **Privacy.** Raw cells leave the server. A thesis survey may carry
   participant names, phone numbers or student IDs, often collected under a
   consent form that says where the data goes.
2. **Defensibility.** A committee asking *"why is this value different?"*
   deserves a better answer than "the AI changed it".
3. **Silent corruption.** A model can return the wrong row count, drop a
   column, or rewrite cells the instruction never mentioned, and a wrong
   dataset looks exactly like a right one.

## Decision

Allow it, as an explicitly separate path, with the guarantees that make the
first two survivable and the third detectable.

- `POST /api/fixes/:id/ai-edit` **previews only.** It returns the rewritten
  rows plus a cell-level diff — row, column, before, after — and stores
  nothing. Applying is a second, separate call.
- **Shape is validated before the output is trusted.** Row count, column
  count per row. Any mismatch rejects the whole response rather than
  accepting a partial rewrite.
- **Row-affecting instructions are refused.** The model is told to answer
  `NEEDS_ROW_OPERATION` rather than delete rows; those belong to the
  deterministic catalogue, where the operation is named and bounded.
- **Applying writes a new dataset version**, as every other fix does. The
  original is untouched and still selectable.
- **Sensitive-looking columns are named in the response** so the interface can
  warn before the user commits.
- **Capped at 300 rows.** Not a style choice — a 25 MB upload holds hundreds
  of thousands of rows. Beyond the cap the caller is redirected to the
  deterministic fixes, which have no limit because nothing leaves the server.

## Consequences

- ADR-0006 now has one documented exception rather than being quietly untrue.
  Anything reading it should read this too.
- The cell diff is the artifact that makes this usable in a thesis. Without
  it, an AI edit is an unexplainable change; with it, every edit has a before,
  an after, and the instruction that caused it. The change note on the new
  version records the instruction and the count.
- Deterministic fixes remain the default and the recommendation. They work
  offline, cost nothing, transmit nothing, and their behaviour is pinned by
  tests. This path exists for instructions the catalogue cannot express.
- If DAB ever handles data under a consent form that forbids third-party
  processing, this endpoint must be disabled rather than explained away.

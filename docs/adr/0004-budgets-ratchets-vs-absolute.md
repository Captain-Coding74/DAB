# 4. Two kinds of budget: ratchets and absolute targets

**Date:** 2026-07-14 · **Status:** Accepted

## Context

We gate bundle size, API latency, render time, complexity, duplication and
coverage. A single budgeting strategy fails these differently:

- Absolute limits on *machine-dependent* numbers (API p95, complexity) either
  flap on a noisy CI runner or are set so loose they never fire.
- Ratchets on *user-facing* numbers are worse: they quietly bless whatever the
  code currently does. A ratcheted LCP would happily accept 4 seconds because
  yesterday it was 4.1.

## Decision

**Ratchets** — bundle size, complexity, duplication, coverage, test count.
Calibrated from the current tree with headroom (`--update`), they may only be
relaxed deliberately, and they tighten automatically as the code improves.
They answer: *"is this worse than we were?"*

**Absolute targets** — LCP ≤ 2500 ms (the Web Vitals "good" threshold),
analyze ≤ 4000 ms, client API p95 ≤ 800 ms. Set from what a human being will
tolerate, not from what the machine happened to do. They answer: *"is this
bad for a user?"* — a question the previous release's numbers cannot answer.

## Consequences

- A generous absolute target that passes on a slow runner is still meaningful;
  a ratchet on a noisy one is just flake. We accept looser render gates in
  exchange for gates that mean something.
- Ratchets can drift upward over many small, individually-justified `--update`
  calls. Mitigation: every update is a diff in `quality-budget.json`, and
  `metrics/history.jsonl` records the trend, so drift is visible in review.
- Coverage is a ratchet with an escape hatch, but `maxFilesUncounted` is a
  hard companion metric — a file with no test at all cannot hide behind a
  healthy percentage.

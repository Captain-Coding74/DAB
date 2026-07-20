# 5. No real-time collaboration (yet)

**Date:** 2026-07-14 · **Status:** Accepted · **Decision-maker:** engineering, with the product owner's brief

## Context

Real-time collaboration — live cursors, presence, simultaneous editing —
was proposed for v16. The release brief that accompanied it was explicit:

> "At this point, I don't want you to build more. I want you to build better."

The two are in direct tension, and the brief itself hedged the feature with
"*if it fits your product*". So the honest engineering answer is to test
whether it fits, not to assume that shipping it would be a favour.

## What real-time actually costs here

It is not a feature; it is a new architecture:

- **Transport.** WebSockets (or SSE + a write channel), which means sticky
  sessions or a pub/sub bus. Today the API is stateless and horizontally
  scalable behind a plain load balancer. That property would be lost.
- **Conflict resolution.** Two people editing the same annotation is a
  correctness problem — last-write-wins silently destroys work, so it needs
  CRDTs or OT, both of which are notoriously subtle.
- **Presence + lifecycle.** Heartbeats, reconnects, tab-sleep, offline
  buffering. This is where real-time systems actually break.
- **A large untestable surface.** Our confidence comes from 168 checks and
  gated budgets. Multi-client timing races are exactly the code that resists
  that kind of testing hardest, so it would arrive with the *lowest* assurance
  of anything in the codebase — in the same release whose stated goal is
  engineering excellence.

## What the product actually needs

The collaboration model here is **asynchronous by nature**: someone uploads a
dataset, the AI analyses it, and colleagues comment, @mention, and share a
report. Nobody is co-typing a cell. Threaded comments, mentions, notifications,
an activity feed, and password-protected share links already exist and cover
the real workflow. The gap real-time closes is small; the gap it opens is not.

## Decision

**Do not build real-time collaboration in v16.** Invest the release in the
things that make the existing product trustworthy: one app factory (no test
double), browser tests over every critical flow, enforced budgets, and these
records.

## Consequences

- Two people commenting simultaneously will not see each other's comment until
  a refresh. Accepted: comments are asynchronous by nature.
- If demand appears, the cheapest honest step is **polling or SSE for the
  notification badge and comment list** — a fraction of the cost, most of the
  perceived benefit, and it preserves statelessness. That is the first thing to
  try, and this ADR should be revisited then.
- We keep the ability to scale horizontally without sticky sessions.

## Revisit when

Users are demonstrably colliding — e.g. comment threads routinely edited by
two people within the same minute, or paying customers ask for live presence
by name. Not before.

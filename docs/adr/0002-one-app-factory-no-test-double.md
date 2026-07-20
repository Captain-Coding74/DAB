# 2. One app factory; tests must not re-implement routes

**Date:** 2026-07-14 · **Status:** Accepted · **Supersedes:** the `testApp.js` pattern (v8–v15)

## Context

The Express app was constructed at module scope in `server.js`, which also
listened on a port and ran migrations. Importing it from a test therefore
booted a server — so the tests couldn't. To get something importable,
`testApp.js` **re-implemented 14 routes**.

That made the integration suite a fiction. 35 tests that read like proof of
correctness were exercising a *parallel implementation*. Production code paths
— `routes/auth.js`, `routes/export.js`, `routes/datasets.js`,
`routes/collaboration.js`, and both dataset repositories — were never loaded by
a single in-process test.

The cost was not theoretical. Three real bugs walked straight through the gap:

| Bug | What users got | Why the tests missed it |
|---|---|---|
| Upload rejections (v13) | 500 instead of 400 | testApp mapped the error itself |
| Every upload 400'd (v14) | broken uploads in the app | HTTP tests bypassed the client's fetch wrapper |
| Duplicate username (v16) | **500 Internal Server Error** | testApp had its own duplicate check |

The last one had been in production the whole time: the route tried to detect
it with `err.message.includes("already")`, but SQLite says
`UNIQUE constraint failed`, so it never matched and fell through to a 500.

## Decision

Extract **`createApp()`** into `src/app.js`. It builds routes and middleware
and returns the app — nothing else. `server.js` becomes boot-only (pool,
migrate, cache, scheduler, listen). `testApp.js` shrinks to a ~25-line harness
that calls the *same* `createApp()` with `AI_MOCK=1`.

**A test double for the application itself is banned.** Stubs stop at real
boundaries — the LLM client, the clock, the network — never at our own routes.

## Consequences

- Test/prod drift is now structurally impossible: there is exactly one app.
- Backend coverage *appeared* to drop 86% → 71%. It didn't: the denominator
  became real. 10 previously-invisible modules entered the report. Writing
  tests for the newly-visible routers brought it to **80.8%**, and that number
  now means something.
- Integration tests grew 35 → 50 and exercise real routers, real repositories,
  real ownership checks, and the real error handler.
- Migrations and `listen()` are the caller's responsibility. That's a feature:
  it's what makes the app importable.

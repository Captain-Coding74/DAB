/**
 * testApp.js — v16: a 25-line harness, not a second application.
 *
 * BEFORE (v8–v15): this file RE-IMPLEMENTED 14 routes so the integration
 * tests had something importable to hit. That made the tests a fiction —
 * they exercised a parallel implementation while production ran different
 * code. Two real bugs walked straight through the gap:
 *   · v13 — upload rejections returned 500 in prod, 400 in testApp
 *   · v14 — every upload 400'd in the browser; the tests never saw it
 *
 * NOW: it boots the REAL app via createApp(). Same routes, same middleware,
 * same repositories, same error handling as production. Test/prod drift is
 * structurally impossible, and the route/repository modules that were never
 * loaded by a test are now covered.
 *
 * AI is stubbed at the client boundary (AI_MOCK=1, refused in production).
 */
import { initPool, closePool } from "./db/pool.js";
import { migrate }             from "./db/migrate.js";
import { initCache, cache }    from "./services/cache.js";

export async function buildApp() {
  // In-process tests use SQLite, never a real Postgres URL.
  delete process.env.DATABASE_URL;
  process.env.AI_MOCK = "1";              // stub the LLM, keep every other layer real

  await initPool();
  await migrate();
  await initCache();

  // Imported lazily: createApp() reads env (AI_MOCK, secrets) at construction.
  const { createApp } = await import("./app.js");
  return createApp();
}

export async function closeApp() {
  await cache.close?.();
  await closePool();
}

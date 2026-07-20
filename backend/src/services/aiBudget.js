/**
 * services/aiBudget.js — v20.3 launch safety
 *
 * A global daily cap on Anthropic calls, so a public deploy can never run
 * an unbounded bill. Per-user rate limits already exist (rateLimiter.js);
 * this is the backstop against many-accounts abuse and viral days.
 *
 * SOFT by design: get→set on the shared cache (Redis in prod, memory in
 * dev). A lost increment under race costs one API call — this is a cost
 * guardrail, not accounting. Budget is read per call, so ops can tune
 * AI_DAILY_BUDGET without a restart and tests can flip it per case.
 *
 * When the budget runs out the product does NOT go down: every caller
 * still gets the full deterministic bundle — only the AI prose waits
 * for tomorrow.
 */
import { cache } from "./cache.js";

const DEFAULT_BUDGET = 300;

export function dailyBudget(env = process.env) {
  const n = parseInt(env.AI_DAILY_BUDGET, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUDGET;
}

const keyFor = (d = new Date()) => `ai:budget:${d.toISOString().slice(0, 10)}`;

/** Reserve one AI call. → { allowed, used, budget } */
export async function tryConsumeAI() {
  const budget = dailyBudget();
  const key    = keyFor();
  const used   = (await cache.get(key)) || 0;
  if (used >= budget) return { allowed: false, used, budget };
  await cache.set(key, used + 1, 26 * 60 * 60);   // 26h TTL outlives the day boundary
  return { allowed: true, used: used + 1, budget };
}

/** Read-only view for ops/tests. */
export async function aiBudgetStatus() {
  const budget = dailyBudget();
  const used   = (await cache.get(keyFor())) || 0;
  return { used, budget, remaining: Math.max(0, budget - used) };
}

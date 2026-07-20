/**
 * aiBudget.test.js — v20.3 launch safety
 * The daily cap: correct defaults, env override, consume-until-exhausted,
 * and the property that matters most — running out never throws.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { initCache, cache } from "./services/cache.js";
import { dailyBudget, tryConsumeAI, aiBudgetStatus } from "./services/aiBudget.js";

before(async () => { await initCache(); });

describe("dailyBudget", () => {
  test("defaults to 300", () => assert.equal(dailyBudget({}), 300));
  test("reads AI_DAILY_BUDGET", () => assert.equal(dailyBudget({ AI_DAILY_BUDGET: "42" }), 42));
  test("zero is a valid budget (AI fully off)", () => assert.equal(dailyBudget({ AI_DAILY_BUDGET: "0" }), 0));
  test("garbage falls back to default", () => {
    assert.equal(dailyBudget({ AI_DAILY_BUDGET: "many" }), 300);
    assert.equal(dailyBudget({ AI_DAILY_BUDGET: "-5" }), 300);
  });
});

describe("tryConsumeAI", () => {
  test("consumes up to the budget, then degrades — never throws", async () => {
    await cache.flush();
    process.env.AI_DAILY_BUDGET = "2";
    try {
      const a = await tryConsumeAI();
      const b = await tryConsumeAI();
      const c = await tryConsumeAI();
      assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
      assert.equal(c.used, 2);
      assert.equal(c.budget, 2);
      const st = await aiBudgetStatus();
      assert.deepEqual(st, { used: 2, budget: 2, remaining: 0 });
    } finally {
      delete process.env.AI_DAILY_BUDGET;
      await cache.flush();
    }
  });
  test("budget 0 blocks immediately", async () => {
    process.env.AI_DAILY_BUDGET = "0";
    try {
      assert.equal((await tryConsumeAI()).allowed, false);
    } finally { delete process.env.AI_DAILY_BUDGET; }
  });
});

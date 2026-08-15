/**
 * routeGuards.test.js — every route makes an explicit auth decision.
 *
 * There are 87 routes. Eight take no auth middleware, and seven of those are
 * correct: register, login, refresh, the two demo endpoints, and the
 * token-protected public share. The eighth pair — the export routes — were
 * missing `optionalAuth`, which meant the rate limiter could not key by user:
 * every signed-in caller was capped at the ANONYMOUS allowance of 20, and
 * everyone behind one office NAT shared a single bucket.
 *
 * This test does not police which routes are public. It fails when a route
 * appears that nobody has classified, so the decision is deliberate rather
 * than inherited.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Routes that intentionally serve callers with no token. */
const PUBLIC_BY_DESIGN = new Set([
  "POST /api/auth/register",
  "POST /api/auth/login",
  "POST /api/auth/refresh",
  "GET /api/demo/samples",
  "GET /api/demo/samples/:id/analysis",
  "GET /api/public/share/:token",   // the token IS the credential
  "POST /api/export/pdf",           // optionalAuth: open, but keyed per user
  "POST /api/export/excel",
]);

function allRoutes() {
  const dir = "src/routes";
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(dir, f), "utf-8");
    for (const m of src.matchAll(/(?:app|router)\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']([^\n]*)/g)) {
      const [, method, path, rest] = m;
      out.push({
        file: f,
        key: `${method.toUpperCase()} ${path.startsWith("/api") ? path : "/api/datasets" + path}`,
        guarded: rest.includes("requireAuth"),
        optional: rest.includes("optionalAuth"),
      });
    }
  }
  return out;
}

describe("route guards", () => {
  test("every route either requires auth or is declared public", () => {
    const unclassified = allRoutes()
      .filter((r) => !r.guarded && !r.optional && !PUBLIC_BY_DESIGN.has(r.key))
      .map((r) => `${r.key}  (${r.file})`);
    assert.deepEqual(unclassified, [],
      `these routes have no auth decision — add requireAuth, or list them in PUBLIC_BY_DESIGN:\n  ${unclassified.join("\n  ")}`);
  });

  test("the export routes carry optionalAuth so the limiter can key by user", () => {
    // Without it maxByAuth(20, 50) always sees req.user === undefined and
    // hands every caller the anonymous budget.
    const exports_ = allRoutes().filter((r) => r.key.startsWith("POST /api/export/"));
    assert.equal(exports_.length, 2);
    for (const r of exports_) assert.ok(r.optional, `${r.key} lost optionalAuth`);
  });

  test("the public-by-design list has not silently grown", () => {
    // A route added to that set is a deliberate act; this pins the count so
    // enlarging it shows up in review.
    assert.equal(PUBLIC_BY_DESIGN.size, 8);
  });
});

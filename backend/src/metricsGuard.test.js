/**
 * metricsGuard.test.js — who may read /api/metrics.
 *
 * The endpoint was open to the world: every route with its error rate and
 * latency, process memory, the DB backend. Outside production it stays open
 * (perf harness, E2E and integration suites all read it); in production it
 * takes an operator (TELEMETRY_ADMINS) or the scraper's METRICS_TOKEN, and
 * with neither configured it is closed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { metricsAccess, requireMetricsAccess } from "./middleware/monitoring.js";
import { isOperator, operatorUsernames } from "./services/operators.js";

const req = ({ user, bearer } = {}) => ({ user, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
const PROD = { NODE_ENV: "production" };

describe("metricsAccess", () => {
  test("outside production the endpoint is open — the perf and E2E tooling depend on it", () => {
    assert.deepEqual(metricsAccess(req(), { NODE_ENV: "test" }),        { allowed: true, via: "non-production" });
    assert.deepEqual(metricsAccess(req(), { NODE_ENV: "development" }), { allowed: true, via: "non-production" });
    assert.deepEqual(metricsAccess(req(), {}),                          { allowed: true, via: "non-production" });
  });

  test("production with nothing configured is closed to everyone, signed-in or not", () => {
    assert.equal(metricsAccess(req(), PROD).allowed, false);
    assert.equal(metricsAccess(req({ user: { username: "someone" } }), PROD).allowed, false);
  });

  test("a scraper presents METRICS_TOKEN as a bearer", () => {
    const env = { ...PROD, METRICS_TOKEN: "s3cret-scrape-token" };
    assert.deepEqual(metricsAccess(req({ bearer: "s3cret-scrape-token" }), env), { allowed: true, via: "token" });
    assert.equal(metricsAccess(req({ bearer: "s3cret-scrape-tokeN" }), env).allowed, false, "one byte off");
    assert.equal(metricsAccess(req({ bearer: "s3cret" }), env).allowed, false, "prefix / different length");
    assert.equal(metricsAccess(req(), env).allowed, false, "no header");
    assert.equal(metricsAccess({ headers: { authorization: "Basic abc" } }, env).allowed, false, "wrong scheme");
  });

  test("an empty METRICS_TOKEN does not open the door", () => {
    assert.equal(metricsAccess(req({ bearer: "" }), { ...PROD, METRICS_TOKEN: "" }).allowed, false);
  });

  test("a signed-in operator is admitted; a signed-in stranger is not", () => {
    const env = { ...PROD, TELEMETRY_ADMINS: "captain, Ops" };
    assert.deepEqual(metricsAccess(req({ user: { username: "Captain" } }), env), { allowed: true, via: "operator" });
    assert.deepEqual(metricsAccess(req({ user: { username: "ops" } }), env),     { allowed: true, via: "operator" });
    assert.equal(metricsAccess(req({ user: { username: "student42" } }), env).allowed, false);
  });
});

describe("requireMetricsAccess middleware", () => {
  const run = (env) => new Promise((resolve) => {
    const prev = process.env.NODE_ENV;
    const prevTok = process.env.METRICS_TOKEN;
    Object.assign(process.env, env);
    const res = { status(c) { this.code = c; return this; }, json(b) { restore(); resolve({ code: this.code, body: b }); } };
    const restore = () => { process.env.NODE_ENV = prev; if (prevTok === undefined) delete process.env.METRICS_TOKEN; else process.env.METRICS_TOKEN = prevTok; };
    requireMetricsAccess(req(), res, () => { restore(); resolve({ next: true }); });
  });

  test("calls next outside production, answers 403 JSON in a bare production", async () => {
    assert.deepEqual(await run({ NODE_ENV: "test" }), { next: true });
    const r = await run({ NODE_ENV: "production" });
    assert.equal(r.code, 403);
    assert.match(r.body.errorEn, /METRICS_TOKEN|TELEMETRY_ADMINS/);
  });
});

describe("operators", () => {
  test("allowlist is comma-separated, trimmed and case-insensitive; unset means nobody", () => {
    assert.deepEqual(operatorUsernames({ TELEMETRY_ADMINS: " Captain ,ops,, " }), ["captain", "ops"]);
    assert.deepEqual(operatorUsernames({}), []);
    assert.equal(isOperator({ user: { username: "CAPTAIN" } }, { TELEMETRY_ADMINS: "captain" }), true);
    assert.equal(isOperator({ user: { username: "captain" } }, {}), false);
    assert.equal(isOperator({}, { TELEMETRY_ADMINS: "captain" }), false);
  });
});

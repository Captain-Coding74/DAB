/**
 * pgSsl.test.js — v21.30: Postgres certificate verification is opt-in.
 *
 * pool.js hardcoded `{ rejectUnauthorized: false }`: encrypted, but anyone on
 * the path could pose as the database. The default stays for compatibility;
 * DATABASE_SSL_CA / DATABASE_SSL_VERIFY=1 turn verification on, and
 * production says when it is off. The last tests feed the result through pg's
 * own ConnectionParameters, because pg lets a URL's `sslmode=` override the
 * `ssl` option — the CA has to survive that, not just be returned.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ConnectionParameters from "pg/lib/connection-parameters.js";
import { pgSslOptions, warnDbTlsUnverified } from "./db/pgSsl.js";

const REMOTE = "postgresql://dab:p%40ss@db.example.com:5432/dab";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";

describe("pgSslOptions — today's behaviour unchanged without the new settings", () => {
  test("a remote database keeps TLS without certificate checks (Railway / Supabase)", () => {
    const o = pgSslOptions({ DATABASE_URL: REMOTE });
    assert.deepEqual(o.ssl, { rejectUnauthorized: false });
    assert.equal(o.verify, "none");
    assert.equal(o.connectionString, REMOTE);
  });

  test("localhost connects without TLS", () => {
    const o = pgSslOptions({ DATABASE_URL: "postgresql://dab:dab@localhost:5432/dab" });
    assert.equal(o.ssl, false);
    assert.equal(o.verify, "off");
  });

  test("TLS parameters in the URL still decide, and the URL is passed on untouched", () => {
    const off = pgSslOptions({ DATABASE_URL: "postgresql://dab:x@postgres:5432/dab?sslmode=disable" });
    assert.equal(off.verify, "off");
    assert.equal(off.connectionString, "postgresql://dab:x@postgres:5432/dab?sslmode=disable");
    assert.equal(pgSslOptions({ DATABASE_URL: `${REMOTE}?sslmode=no-verify` }).verify, "none");
    assert.equal(pgSslOptions({ DATABASE_URL: `${REMOTE}?uselibpqcompat=true&sslmode=require` }).verify, "none");
    const req = pgSslOptions({ DATABASE_URL: `${REMOTE}?sslmode=verify-full` });
    assert.equal(req.verify, "url");
    assert.equal(req.ssl, undefined);
  });
});

describe("pgSslOptions — verification on request", () => {
  test("DATABASE_SSL_VERIFY=1 verifies against the system CAs", () => {
    const o = pgSslOptions({ DATABASE_URL: REMOTE, DATABASE_SSL_VERIFY: "1" });
    assert.deepEqual(o.ssl, { rejectUnauthorized: true });
    assert.equal(o.verify, "system");
  });

  test("DATABASE_SSL_CA as PEM text — including newlines flattened to a literal \\n by a dashboard", () => {
    for (const ca of [PEM, PEM.replace(/\n/g, "\\n")]) {
      const o = pgSslOptions({ DATABASE_URL: REMOTE, DATABASE_SSL_CA: ca });
      assert.deepEqual(o.ssl, { ca: PEM, rejectUnauthorized: true });
      assert.equal(o.verify, "ca");
    }
  });

  test("DATABASE_SSL_CA as a path to a PEM file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dab-ca-"));
    try {
      const file = path.join(dir, "ca.pem");
      writeFileSync(file, PEM + "\n");
      assert.equal(pgSslOptions({ DATABASE_URL: REMOTE, DATABASE_SSL_CA: file }).ssl.ca, PEM + "\n");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a DATABASE_SSL_CA that is neither PEM nor a readable file stops the connection with a clear error", () => {
    assert.throws(() => pgSslOptions({ DATABASE_URL: REMOTE, DATABASE_SSL_CA: "/nope/ca.pem" }),
      /DATABASE_SSL_CA is neither a PEM certificate nor a readable file/);
  });

  test("an explicit setting replaces the URL's TLS parameters and keeps the rest of the URL as written", () => {
    const o = pgSslOptions({ DATABASE_URL: `${REMOTE}?sslmode=require&application_name=dab`, DATABASE_SSL_CA: PEM });
    assert.equal(o.connectionString, `${REMOTE}?application_name=dab`);
    assert.equal(pgSslOptions({ DATABASE_URL: `${REMOTE}?sslmode=require`, DATABASE_SSL_VERIFY: "1" }).connectionString, REMOTE);
  });

  test("what pg itself ends up using: the CA survives a provider URL that says sslmode=require", () => {
    const o = pgSslOptions({ DATABASE_URL: `${REMOTE}?sslmode=require`, DATABASE_SSL_CA: PEM });
    const effective = new ConnectionParameters({ connectionString: o.connectionString, ssl: o.ssl });
    assert.equal(effective.ssl.ca, PEM);
    assert.equal(effective.ssl.rejectUnauthorized, true);
    assert.equal(effective.password, "p@ss", "password mangled on the way through");
  });

  test("…and the compatibility default reaches pg as an unverified TLS connection", () => {
    const o = pgSslOptions({ DATABASE_URL: REMOTE });
    assert.equal(new ConnectionParameters({ connectionString: o.connectionString, ssl: o.ssl }).ssl.rejectUnauthorized, false);
  });
});

describe("production boot warning", () => {
  const sink = () => { const lines = []; return { lines, warn: (m) => lines.push(m) }; };

  test("warns in production when the certificate is not verified", () => {
    const log = sink();
    assert.equal(warnDbTlsUnverified({ NODE_ENV: "production", DATABASE_URL: REMOTE }, log), true);
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0], /DATABASE_SSL_CA or DATABASE_SSL_VERIFY=1/);
  });

  test("silent when verified, without TLS on a private network, on SQLite, and outside production", () => {
    const log = sink();
    assert.equal(warnDbTlsUnverified({ NODE_ENV: "production", DATABASE_URL: REMOTE, DATABASE_SSL_VERIFY: "1" }, log), false);
    assert.equal(warnDbTlsUnverified({ NODE_ENV: "production", DATABASE_URL: "postgresql://dab:x@postgres:5432/dab?sslmode=disable" }, log), false);
    assert.equal(warnDbTlsUnverified({ NODE_ENV: "production" }, log), false);
    assert.equal(warnDbTlsUnverified({ NODE_ENV: "test", DATABASE_URL: REMOTE }, log), false);
    assert.equal(log.lines.length, 0);
  });
});

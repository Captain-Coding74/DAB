/**
 * Postgres TLS options (v21.30).
 *
 * pool.js used to hardcode `{ rejectUnauthorized: false }` for every remote
 * database: the link is encrypted, but the server's certificate is never
 * checked, so anything on the path can pose as the database and read every
 * row — users, analyses, datasets — as it goes by. That default stays (Railway
 * and Supabase hand out certificates Node's CA list does not know, and a
 * deploy that connects today must still connect tomorrow), but an operator
 * can now turn verification on:
 *
 *   DATABASE_SSL_CA=<PEM text, or a path to a PEM file>  verify against that CA
 *   DATABASE_SSL_VERIFY=1                                 verify against the system CAs
 *
 * Either one wins over TLS parameters written into DATABASE_URL (sslmode=…,
 * ssl=…, sslrootcert=…). pg lets the URL's parameters override the `ssl`
 * option, so a provider URL ending in `?sslmode=require` would otherwise
 * silently discard the CA the operator configured; those parameters are
 * dropped from the URL instead. With neither set, the URL's own parameters
 * still decide, exactly as before — `sslmode=disable` (the shipped
 * docker-compose, whose database sits on the private compose network) means
 * no TLS at all.
 *
 * Production with an unverified certificate gets one warning at boot
 * (warnDbTlsUnverified, called by server.js).
 */
import fs from "node:fs";
import { serviceLogger } from "../logger.js";

/* The URL parameters pg-connection-string turns into an `ssl` setting. */
const URL_TLS_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslnegotiation", "uselibpqcompat"];

/* PaaS dashboards often flatten a pasted PEM's newlines into a literal "\n". */
function readCa(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");
  try {
    return fs.readFileSync(v, "utf8");
  } catch {
    // The value is a path here, never a certificate — safe to repeat.
    throw new Error(`DATABASE_SSL_CA is neither a PEM certificate nor a readable file: ${v}`);
  }
}

/* Split on the query string only: re-serialising the whole URL could re-encode a password. */
function splitUrl(url) {
  const q = url.indexOf("?");
  return q < 0 ? [url, new URLSearchParams()] : [url.slice(0, q), new URLSearchParams(url.slice(q + 1))];
}

function withoutTlsParams(base, params) {
  for (const p of URL_TLS_PARAMS) params.delete(p);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

/* What pg will do with a URL that carries its own TLS parameters. */
function urlVerdict(params) {
  const mode = params.get("sslmode");
  if (mode === "disable" || params.get("ssl") === "0") return "off";
  const libpq = params.get("uselibpqcompat") === "true";
  if (mode === "no-verify" || (libpq && (mode === "prefer" || (mode === "require" && !params.has("sslrootcert"))))) return "none";
  return "url";
}

/**
 * { connectionString, ssl, verify } for pg.Pool. `verify` names what is checked:
 *   "off"  — no TLS (localhost, or sslmode=disable)
 *   "ca" / "system" — the certificate is verified (DATABASE_SSL_CA / DATABASE_SSL_VERIFY)
 *   "url"  — DATABASE_URL's own TLS parameters decide, and they verify
 *   "none" — encrypted, certificate NOT verified (the compatibility default)
 */
export function pgSslOptions(env = process.env) {
  const url = String(env.DATABASE_URL || "");
  const [base, params] = splitUrl(url);
  const ca = readCa(env.DATABASE_SSL_CA);
  if (ca) return { connectionString: withoutTlsParams(base, params), ssl: { ca, rejectUnauthorized: true }, verify: "ca" };
  if (env.DATABASE_SSL_VERIFY === "1") {
    return { connectionString: withoutTlsParams(base, params), ssl: { rejectUnauthorized: true }, verify: "system" };
  }
  if (URL_TLS_PARAMS.some(p => params.has(p))) return { connectionString: url, ssl: undefined, verify: urlVerdict(params) };
  if (url.includes("localhost")) return { connectionString: url, ssl: false, verify: "off" };
  return { connectionString: url, ssl: { rejectUnauthorized: false }, verify: "none" };   // Railway / Supabase
}

export function warnDbTlsUnverified(env = process.env, log = serviceLogger("db")) {
  if (env.NODE_ENV !== "production" || !env.DATABASE_URL) return false;
  if (pgSslOptions(env).verify !== "none") return false;
  log.warn("Postgres TLS certificate is not verified — set DATABASE_SSL_CA or DATABASE_SSL_VERIFY=1 (see .env.example)");
  return true;
}

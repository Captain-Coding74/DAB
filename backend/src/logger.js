/**
 * src/logger.js — Pino structured logger
 *
 * - JSON in production, pretty-printed in development
 * - Every log line carries { requestId, userId, durationMs }
 * - Log levels: trace | debug | info | warn | error | fatal
 * - Redacts sensitive fields automatically
 */

import pino     from "pino";
import pinoHttp from "pino-http";
import crypto   from "crypto";

// v18: the version was hardcoded to "6.0.0" and had been wrong for eight
// releases — every log line in production reported a version that didn't exist.
// Read it from package.json so it can never drift again.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  } catch { return "unknown"; }
})();

const isDev = process.env.NODE_ENV !== "production";

// ── Root logger ───────────────────────────────────────────
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  redact: {
    paths: ["req.headers.authorization", "*.password", "*.password_hash", "*.token"],
    censor: "[REDACTED]",
  },
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
    : undefined,
  base: { service: "data-analysis-bot", version: VERSION },
});

// ── URL redaction (v21.30) ────────────────────────────────
/* A share token IS the access to a report: anyone who reads it in a log line
   can open the report. The `*.token` redact path above covers JSON fields,
   but share tokens travel in the URL path (/api/public/share/<token>, the
   /share/<token> page), which reached every request line verbatim. Same for
   any `…token=` query parameter. Anchored at the start of the path so
   /api/datasets/<id>/share (an owner-only route) keeps its id. Express
   matches routes case-insensitively, so this does too. */
const SHARE_PATH  = /^((?:\/api\/public)?\/share\/)[^/?#]+/i;
const TOKEN_QUERY = /([?&][^=&#]*token=)[^&#]*/gi;
export function redactUrl(url) {
  if (typeof url !== "string") return url;
  return url.replace(SHARE_PATH, "$1[redacted]").replace(TOKEN_QUERY, "$1[redacted]");
}

// ── HTTP request logger middleware ────────────────────────
/** Built by a factory so a test can point the same options at its own
 *  stream (the app's logger is silent under test). */
export function createHttpLogger(base = logger) {
  return pinoHttp({
    logger: base,
    genReqId: () => crypto.randomUUID(),
    customLogLevel: (req, res) => {
      if (res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${redactUrl(req.originalUrl || req.url)} → ${res.statusCode}`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${redactUrl(req.originalUrl || req.url)} → ${res.statusCode} — ${err.message}`,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: redactUrl(req.url), remoteAddress: req.remoteAddress }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
export const httpLogger = createHttpLogger();

// ── Child loggers (attach context) ───────────────────────
export function requestLogger(req) {
  return logger.child({ requestId: req.id, userId: req.user?.userId });
}

export function serviceLogger(name) {
  return logger.child({ service: name });
}

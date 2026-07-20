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

// ── HTTP request logger middleware ────────────────────────
export const httpLogger = pinoHttp({
  logger,
  genReqId: () => crypto.randomUUID(),
  customLogLevel: (req, res) => {
    if (res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} → ${res.statusCode} — ${err.message}`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

// ── Child loggers (attach context) ───────────────────────
export function requestLogger(req) {
  return logger.child({ requestId: req.id, userId: req.user?.userId });
}

export function serviceLogger(name) {
  return logger.child({ service: name });
}

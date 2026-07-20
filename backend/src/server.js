/**
 * server.js — Data Analysis Bot v18 — boot only.
 * All route/middleware construction lives in app.js (one factory, shared with
 * the integration tests). This file's only job is side effects: connect the DB,
 * migrate, warm the cache, start the scheduler, listen — and shut all of that
 * down cleanly again.
 */
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { initPool, closePool } from "./db/pool.js";
import { migrate }             from "./db/migrate.js";
import { initCache, cache }    from "./services/cache.js";
import { startScheduler }      from "./services/scheduler.js";
import { logger, serviceLogger } from "./logger.js";

/** Plain, un-decorated output: this is guidance for a human, not a log record. */
const say = (...lines) => lines.forEach(l => process.stderr.write(l + "\n"));

dotenv.config();
const svcLog = serviceLogger("server");
const app    = createApp();
const PORT   = Number(process.env.PORT) || 3000;

/**
 * v18: boot failures used to print a raw library stack trace (a libsql dump for
 * a locked database, for instance). A developer needs to know what broke and
 * what to do about it, not read our dependency's internals.
 */
try {
  await initPool();
  await migrate();
  await initCache();
  startScheduler();
} catch (err) {
  if (err.code === "SQLITE_BUSY") {
    say("", "✗ The SQLite database is locked — another instance is already using it.",
        "  Stop that process, or give this one its own data directory:",
        process.platform === "win32"
          ? "    $env:SQLITE_DIR='.\\data2'; npm run dev"
          : "    SQLITE_DIR=./data2 npm run dev", "");
  } else if (/JWT_SECRET/.test(err.message)) {
    say("", "✗ " + err.message, "");
  } else {
    logger.error({ err }, "Failed to start: database, cache or scheduler could not be initialised");
  }
  process.exit(1);
}

const server = app.listen(PORT, () => {
  svcLog.info({ port: PORT }, "started");
  logger.info(`App:     http://localhost:${PORT}`);
  logger.info(`Swagger: http://localhost:${PORT}/api/docs`);
  logger.info(`Metrics: http://localhost:${PORT}/api/metrics`);
});

/**
 * v18: listen() failures used to surface as an unhandled 'error' event — a
 * 20-line stack trace with no guidance. The overwhelmingly common case is
 * "you already have it running in another terminal", so say that, tell the
 * developer exactly how to fix it on their platform, and exit cleanly.
 */
server.on("error", (err) => {
  const win = process.platform === "win32";
  if (err.code === "EADDRINUSE") {
    say(
      "",
      `✗ Port ${PORT} is already in use — the server cannot start.`,
      "  Most likely this app is already running in another terminal.",
      "",
      "  Free the port:",
      win ? `    netstat -ano | findstr :${PORT}     ← PID is the last column`
          : `    lsof -ti:${PORT} | xargs kill`,
      win ? `    taskkill /PID <PID> /F` : "",
      "",
      "  …or just run on a different one:",
      win ? `    $env:PORT=3001; npm run dev` : `    PORT=3001 npm run dev`,
      "",
    );
  } else if (err.code === "EACCES") {
    say("", `✗ Not allowed to bind port ${PORT}.`,
        "  Ports below 1024 need elevated privileges — try PORT=3000 or higher.", "");
  } else {
    logger.error({ err }, "Server failed to start");
  }
  process.exit(1);
});

/**
 * v18 BUG FIX: this handler called cache.close() and closePool(), neither of
 * which was imported — so every graceful shutdown threw ReferenceError and the
 * DB/cache were never closed properly. That's exactly how Docker and K8s stop a
 * container (SIGTERM), so it fired in production and nowhere else. Now both are
 * imported, SIGINT (Ctrl+C) is handled too, and shutdown is idempotent.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  svcLog.info({ signal }, "Shutting down");

  const timer = setTimeout(() => {
    svcLog.error("Shutdown took too long — forcing exit");
    process.exit(1);
  }, 10_000);
  timer.unref();

  try {
    await new Promise((resolve) => server.close(resolve));  // stop accepting connections
    await cache.close?.();
    await closePool();
    svcLog.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    svcLog.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

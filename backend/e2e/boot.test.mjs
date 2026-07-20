/**
 * e2e/boot.test.mjs — v18
 *
 * Boot and shutdown are the two moments a server is least tested and most
 * likely to be wrong, because they only misbehave outside a normal dev loop:
 *
 *   · A port clash used to dump a 20-line unhandled 'error' stack trace.
 *   · SIGTERM — how Docker and Kubernetes stop a container — called
 *     cache.close() and closePool() without importing either, so every
 *     graceful shutdown threw ReferenceError and the DB was never closed.
 *     It fired in production and nowhere else.
 *
 * These tests drive the real server binary as a child process, because that is
 * the only way to observe exit codes and signal handling honestly.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "src", "server.js");
const CWD    = join(__dirname, "..");

const baseEnv = (port, dir) => ({
  ...process.env,
  NODE_ENV: "development",
  AI_MOCK: "1",
  PORT: String(port),
  SQLITE_DIR: dir,
  JWT_SECRET: "boot-secret-32-chars-xxxxxxxxxxx",
  JWT_REFRESH_SECRET: "boot-refresh-32-chars-xxxxxxxxx",
  LOG_LEVEL: "info",
});

function start(port, dir) {
  const proc = spawn(process.execPath, [SERVER], { cwd: CWD, env: baseEnv(port, dir) });
  let out = "";
  proc.stdout.on("data", d => (out += d));
  proc.stderr.on("data", d => (out += d));
  return { proc, output: () => out };
}

const waitHealthy = async (port) => {
  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
};

const exitOf = (proc) => new Promise(res => proc.on("exit", (code, signal) => res({ code, signal })));

describe("Boot failures are actionable, not stack traces", () => {
  test("a port clash explains itself and exits 1", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "dab-boot-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "dab-boot-b-"));
    const PORT = 3591;

    const a = start(PORT, dirA);
    assert.ok(await waitHealthy(PORT), "first server should come up");

    const b = start(PORT, dirB);                 // same port → must fail cleanly
    const { code } = await exitOf(b.proc);

    assert.equal(code, 1, "the second instance exits 1, not by unhandled crash");
    const text = b.output();
    assert.match(text, /already in use/i, "says the port is taken");
    assert.match(text, /another terminal/i, "names the likely cause");
    assert.match(text, /PORT=3001|\$env:PORT/, "shows how to use a different port");
    assert.doesNotMatch(text, /Unhandled 'error' event/, "no raw unhandled error event");
    assert.doesNotMatch(text, /at Server\.setupListenHandle/, "no library stack trace");

    a.proc.kill("SIGKILL");
    await exitOf(a.proc);
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });
});

describe("Graceful shutdown", () => {
  test("SIGTERM closes the DB and cache, then exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dab-boot-t-"));
    const PORT = 3592;
    const s = start(PORT, dir);
    assert.ok(await waitHealthy(PORT), "server should come up");

    s.proc.kill("SIGTERM");                      // exactly how Docker/K8s stop it
    const { code } = await exitOf(s.proc);

    assert.equal(code, 0, "clean exit — a non-zero code makes orchestrators report a crash");
    const text = s.output();
    assert.match(text, /Shutting down/i);
    assert.match(text, /Shutdown complete/i, "the DB and cache were actually closed");
    assert.doesNotMatch(text, /ReferenceError/, "shutdown must not throw (v18 regression guard)");
    assert.doesNotMatch(text, /is not defined/, "shutdown must not reference missing imports");

    rmSync(dir, { recursive: true, force: true });
  });

  test("SIGINT (Ctrl+C) shuts down the same way", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dab-boot-i-"));
    const PORT = 3593;
    const s = start(PORT, dir);
    assert.ok(await waitHealthy(PORT), "server should come up");

    s.proc.kill("SIGINT");
    const { code } = await exitOf(s.proc);

    assert.equal(code, 0);
    assert.match(s.output(), /Shutdown complete/i);
    rmSync(dir, { recursive: true, force: true });
  });
});

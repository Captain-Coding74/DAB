#!/usr/bin/env node
/**
 * scripts/privacy-request.mjs — v21.30
 *
 * The operator's side of the privacy-request log (services/privacyRequests.js).
 * Signed-in users export and delete their own data at /account, and those
 * requests log themselves. Requests that arrive by email or post — the
 * contact page offers both — are handled and logged here, so every request,
 * whatever the channel, leaves the same trace: a type, a channel, a status,
 * and a one-way hash of the user id. Nothing else about the person.
 *
 * Usage (from backend/, with the same .env as the server):
 *
 *   npm run privacy-request -w backend -- <command> ...
 *   node src/scripts/privacy-request.mjs <command> ...
 *
 *   log --type <export|delete|access|rectify|object|other> --channel <email|post>
 *       [--username <name> | --subject <identifier>] [--status received|completed|refused] [--note <text>]
 *       Record a request handled by hand (a correction, an objection, a
 *       request from someone with no account). --username hashes that user's
 *       id; --subject hashes whatever identifier the requester gave instead.
 *       Default status: received. Keep notes free of personal data.
 *
 *   complete <request-id> [--status completed|refused] [--note <text>]
 *       Close a request logged as received.
 *
 *   export <username> --channel <email|post> [--out <file>]
 *       Write everything DAB holds about the user to dab-export-<username>-<date>.json
 *       (or --out) — the same JSON as the in-app download — and log it.
 *       Send the original files too: the export lists each one's download path.
 *
 *   delete <username> --channel <email|post> --confirm <username>
 *       Erase the account exactly as the in-app deletion does, and log it.
 *       --confirm must repeat the username. Check who is asking first.
 *       This process cannot reach the running server's memory, so a session
 *       the user still has open keeps its access token for up to 15 minutes
 *       (the in-app deletion refuses it at once — see auth.js markErased).
 *
 *   list [--limit 50]
 *       The newest requests.
 *
 * The traffic log is never touched; like the in-app deletion this keeps it
 * until its own 90-day retention ends.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { initPool, closePool, query } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { initCache, cache } from "../services/cache.js";
import { collectAccountData, exportFileName } from "../db/accountData.js";
import { eraseAccount } from "../db/accountErase.js";
import * as PR from "../services/privacyRequests.js";

const OPTIONS = {
  type: { type: "string" }, channel: { type: "string" }, username: { type: "string" },
  subject: { type: "string" }, status: { type: "string" }, note: { type: "string" },
  out: { type: "string" }, confirm: { type: "string" }, limit: { type: "string" },
};

function fail(message) {
  console.error(`\n  ${message}\n  (usage: see the header of src/scripts/privacy-request.mjs)\n`);
  process.exitCode = 1;
}

/* Requests handled here come by email or post; self-service logs itself. */
function manualChannel(channel) {
  if (channel === "email" || channel === "post") return channel;
  fail("--channel must be email or post");
  return null;
}

async function userIdFor(username) {
  const [row] = await query(`SELECT id FROM users WHERE username=$1`, [username]);
  if (!row) fail(`no user named "${username}"`);
  return row?.id ?? null;
}

const COMMANDS = {
  async log(_args, opts) {
    const channel = manualChannel(opts.channel);
    if (!channel) return;
    let subject = opts.subject;
    if (opts.username && !(subject = await userIdFor(opts.username))) return;
    if (!subject) return fail("give --username or --subject");
    const { id } = await PR.logPrivacyRequest({ subject, type: opts.type, channel, status: opts.status || "received", note: opts.note });
    console.log(`\n  logged ${opts.type} request ${id}\n`);
  },

  async complete([id], opts) {
    if (!id) return fail("complete needs a request id");
    const ok = await PR.completePrivacyRequest(id, { status: opts.status || "completed", note: opts.note });
    if (ok) console.log(`\n  ${id} → ${opts.status || "completed"}\n`); else fail(`no request ${id}`);
  },

  async export([username], opts) {
    if (!username) return fail("export needs a username");
    const channel = manualChannel(opts.channel);
    const userId = channel && await userIdFor(username);
    if (!userId) return;
    const data = await collectAccountData(userId);
    const file = opts.out || exportFileName(username);
    writeFileSync(file, JSON.stringify(data, null, 2));
    const { id } = await PR.logPrivacyRequest({ subject: userId, type: "export", channel, note: opts.note });
    console.log(`\n  wrote ${file} — request ${id}`);
    console.log(`  ${data.datasets.length} saved dataset(s); their original files are at the download paths listed inside\n`);
  },

  async delete([username], opts) {
    const channel = manualChannel(opts.channel);
    if (!channel) return;
    if (!username || opts.confirm !== username) return fail("delete needs the username, repeated with --confirm");
    const userId = await userIdFor(username);
    if (!userId) return;
    const request = await PR.logPrivacyRequest({ subject: userId, type: "delete", channel, status: "received", note: opts.note });
    const summary = await eraseAccount(userId);
    await PR.completePrivacyRequest(request.id);
    console.log(`\n  erased — request ${request.id}`);
    console.log(`  ${summary.datasets} dataset(s), ${summary.analyses} analysis/analyses; workspaces passed on: ${summary.workspaces.passed}, deleted: ${summary.workspaces.deleted}\n`);
  },

  async list(_args, opts) {
    const rows = await PR.listPrivacyRequests({ limit: Number(opts.limit) || 50 });
    if (!rows.length) return console.log("\n  (no requests logged)\n");
    console.log("");
    for (const r of rows) {
      console.log(`  ${r.created_at.slice(0, 10)}  ${r.type.padEnd(8)} ${r.channel.padEnd(13)} ${r.status.padEnd(10)} ${r.id}  ${r.subject_hash.slice(0, 12)}…${r.note ? `  ${r.note}` : ""}`);
    }
    console.log("");
  },
};

const { positionals, values } = parseArgs({ options: OPTIONS, allowPositionals: true });
const [command, ...rest] = positionals;

if (!COMMANDS[command]) {
  fail(`unknown command "${command ?? ""}" — one of: ${Object.keys(COMMANDS).join(", ")}`);
} else {
  await initPool();
  await migrate();
  await initCache();
  try {
    await COMMANDS[command](rest, values);
  } catch (err) {
    fail(err.message);   // a bad --type or --status is refused by the log itself
  } finally {
    await cache.close?.();
    await closePool();
  }
}

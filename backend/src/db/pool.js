/**
 * src/db/pool.js — Database abstraction
 *
 * Uses PostgreSQL when DATABASE_URL is set, falls back to
 * SQLite (@libsql/client) for local dev with zero config.
 *
 * Exposes a unified query() interface so the rest of the app
 * doesn't need to know which backend is active.
 */

import { serviceLogger } from "../logger.js";
import { createClient }  from "@libsql/client";
import pg                from "pg";
import fs                from "fs";
import path              from "path";
import { fileURLToPath } from "url";

const log       = serviceLogger("db");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = process.env.SQLITE_DIR || path.join(__dirname, "../../data");

let _pool    = null;   // pg.Pool when using Postgres
let _sqlite  = null;   // @libsql/client when using SQLite
let _backend = null;   // "postgres" | "sqlite"

// ── Initialise connection ─────────────────────────────────
export async function initPool() {
  if (process.env.DATABASE_URL) {
    _backend = "postgres";
    _pool    = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max:              10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },   // Railway / Supabase
    });

    // Verify connection
    const client = await _pool.connect();
    const r      = await client.query("SELECT version()");
    client.release();
    log.info({ backend: "postgres", version: r.rows[0].version.split(" ")[1] }, "Connected to PostgreSQL");

  } else {
    _backend = "sqlite";
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _sqlite = createClient({ url: `file:${path.join(DATA_DIR, "app.db")}` });
    log.info({ backend: "sqlite", path: DATA_DIR }, "Connected to SQLite");
  }
}

// ── Unified query interface ───────────────────────────────
/**
 * query(sql, args) — runs a query and returns rows[]
 *
 * Postgres: uses $1 $2 placeholders
 * SQLite:   uses ? placeholders (converted automatically)
 */
export async function query(sql, args = []) {
  if (_backend === "postgres") {
    const result = await _pool.query(sql, args);
    return result.rows;
  } else {
    // Convert $1 $2 → ? for SQLite
    const sqliteSql = sql.replace(/\$(\d+)/g, "?");
    const result    = await _sqlite.execute({ sql: sqliteSql, args });
    return result.rows;
  }
}

/** Run multiple statements (migrations, schema setup) */
export async function execMultiple(statements) {
  if (_backend === "postgres") {
    const client = await _pool.connect();
    try {
      await client.query("BEGIN");
      for (const s of statements) await client.query(s);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    await _sqlite.executeMultiple(statements.join(";\n") + ";");
  }
}

/** Transaction helper */
export async function withTransaction(fn) {
  if (_backend === "postgres") {
    const client = await _pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn({ query: (sql, args) => client.query(sql, args).then(r => r.rows) });
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    return fn({ query });
  }
}

export function getBackend() { return _backend; }

export async function closePool() {
  if (_pool) await _pool.end();
}

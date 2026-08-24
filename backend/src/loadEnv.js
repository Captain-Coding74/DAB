/**
 * src/loadEnv.js — read .env BEFORE anything that depends on it.
 *
 * dotenv.config() used to sit in the body of server.js and app.js, which in ESM
 * is far too late: every `import` in a module is evaluated before a single line
 * of that module's body runs, and auth.js checks JWT_SECRET at import time. So
 * `NODE_ENV=production npm start` died with "JWT_SECRET ... must be set" while
 * the variables sat unread in .env. Importing this module FIRST — before any
 * import that reads process.env — is what makes the load order correct.
 *
 * Two locations, most specific first (dotenv never overwrites a variable that
 * is already set): the current working directory, then the repo root. The root
 * lookup is what lets `cd backend && npm start`, the documented production
 * command, find the .env that .env.example sits next to.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

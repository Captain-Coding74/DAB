/**
 * services/trafficLog.js — the computer traffic log (v21.30).
 *
 * Thailand's Computer-Related Crime Act s.26 has a service provider keep
 * computer traffic data for at least 90 days. DAB stores files and results
 * for its users, so it keeps the minimum that serves that duty and nothing
 * more: what happened (event), who (the user id, when signed in), from where
 * (req.ip, which honours TRUST_PROXY) and when, plus an optional reference to
 * the thing acted on — a dataset id, a share link's id, an export format.
 * Never a filename, a query string, a share token or any content.
 *
 * ONE middleware, mounted once in app.js, matches each request against
 * TRAFFIC_EVENTS and, when the response has gone out ('finish') with a status
 * below 400, writes one row — a refused login is not a login. Routes that
 * learn the user id themselves (register, login: req.user is not set there)
 * or hold a cheap reference (the share routes) leave it on
 * res.locals.trafficUserId / res.locals.trafficRef. For account deletion the
 * id is req.user's, set by requireAuth before the erasure ran, so the row
 * records who was deleted; the erasure itself leaves this table alone.
 *
 * A failed write is logged with the event name and an error code only, and
 * never touches the response. Rows expire after TRAFFIC_LOG_RETENTION_DAYS
 * (services/retention.js). No route reads this table: it is for the operator
 * answering a lawful request.
 */
import { randomUUID } from "node:crypto";
import { query } from "../db/pool.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("traffic");

/* [method, path, event]. Paths are matched without the query string; Express
   routing ignores case and a trailing slash, so these do too. A capture
   group is the default ref. The share-view pattern deliberately has none:
   that path segment IS the share token. */
export const TRAFFIC_EVENTS = Object.freeze([
  ["POST",   /^\/api\/auth\/register\/?$/i,              "register"],
  ["POST",   /^\/api\/auth\/login\/?$/i,                 "login"],
  ["POST",   /^\/api\/auth\/logout\/?$/i,                "logout"],
  ["POST",   /^\/api\/auth\/logout-all\/?$/i,            "logout_all"],
  ["POST",   /^\/api\/analyze\/?$/i,                     "analyze"],
  ["POST",   /^\/api\/datasets\/([^/]+)\/analyze\/?$/i,  "analyze"],
  ["POST",   /^\/api\/datasets(?:\/multi)?\/?$/i,        "dataset_upload"],
  ["POST",   /^\/api\/datasets\/([^/]+)\/versions\/?$/i, "dataset_upload"],
  ["POST",   /^\/api\/export\/([^/]+)\/?$/i,             "export"],
  ["POST",   /^\/api\/analyses\/[^/]+\/share\/?$/i,      "share_create"],
  ["GET",    /^\/api\/public\/share\/[^/]+\/?$/i,        "share_view"],
  ["GET",    /^\/api\/auth\/me\/export\/?$/i,            "data_export"],
  ["DELETE", /^\/api\/auth\/me\/?$/i,                    "account_delete"],
]);

/** The event a request would record, or null. HEAD runs the GET handler, so it counts as one. */
export function trafficEventFor(method, url) {
  const verb = method === "HEAD" ? "GET" : method;
  const path = String(url).split("?")[0];
  for (const [m, re, event] of TRAFFIC_EVENTS) {
    if (m !== verb) continue;
    const hit = re.exec(path);
    if (hit) return { event, ref: hit[1] ?? null };
  }
  return null;
}

export async function recordTraffic({ event, userId = null, ip = null, ref = null, now = new Date() }) {
  await query(`INSERT INTO traffic_log (id,event,user_id,ip,ref,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), event, userId || null, ip || null, ref || null, now.toISOString()]);
}

/* Writes still in flight. The write starts after the response is sent, so a
   caller that must see the row (a test, a graceful shutdown) awaits these. */
const pending = new Set();
export const trafficSettled = () => Promise.allSettled([...pending]);

export function trafficLog() {
  return (req, res, next) => {
    const hit = trafficEventFor(req.method, req.originalUrl);
    if (hit) {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        const write = recordTraffic({
          event: hit.event,
          userId: res.locals.trafficUserId ?? req.user?.userId,
          ip: req.ip,
          ref: res.locals.trafficRef ?? hit.ref,
        }).catch((err) => log.error({ event: hit.event, code: err.code || err.name }, "traffic log write failed"))
          .finally(() => pending.delete(write));
        pending.add(write);
      });
    }
    next();
  };
}

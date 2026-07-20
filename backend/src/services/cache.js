/**
 * src/services/cache.js — Redis cache with in-memory fallback
 *
 * When REDIS_URL is set → uses ioredis
 * Otherwise            → uses node-cache (in-memory, single process)
 *
 * API:
 *   cache.get(key)           → value | null
 *   cache.set(key, value, ttlSec)
 *   cache.del(key)
 *   cache.delPattern(prefix) → delete all keys matching prefix*
 *   cache.flush()            → clear everything
 */

import Redis     from "ioredis";
import NodeCache from "node-cache";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("cache");
let _redis  = null;
let _local  = null;
let _backend = "none";

export async function initCache() {
  if (process.env.REDIS_URL) {
    _redis   = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck:     true,
      lazyConnect:          true,
    });
    await _redis.connect();
    _backend = "redis";
    log.info({ backend: "redis" }, "Cache connected");
  } else {
    _local   = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });
    _backend = "memory";
    log.info({ backend: "memory" }, "Cache using in-memory (node-cache)");
  }
}

export const cache = {
  get: async (key) => {
    try {
      if (_backend === "redis") {
        const val = await _redis.get(key);
        return val ? JSON.parse(val) : null;
      }
      return _local.get(key) ?? null;
    } catch (err) {
      log.warn({ err, key }, "Cache GET failed");
      return null;
    }
  },

  set: async (key, value, ttlSec = 300) => {
    try {
      if (_backend === "redis") {
        await _redis.set(key, JSON.stringify(value), "EX", ttlSec);
      } else {
        _local.set(key, value, ttlSec);
      }
    } catch (err) {
      log.warn({ err, key }, "Cache SET failed");
    }
  },

  del: async (key) => {
    try {
      if (_backend === "redis") await _redis.del(key);
      else _local.del(key);
    } catch (err) {
      log.warn({ err, key }, "Cache DEL failed");
    }
  },

  /** Delete all keys with given prefix (Redis SCAN; local: filter) */
  delPattern: async (prefix) => {
    try {
      if (_backend === "redis") {
        let cursor = "0";
        do {
          const [next, keys] = await _redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
          cursor = next;
          if (keys.length) await _redis.del(...keys);
        } while (cursor !== "0");
      } else {
        const keys = _local.keys().filter(k => k.startsWith(prefix));
        keys.forEach(k => _local.del(k));
      }
    } catch (err) {
      log.warn({ err, prefix }, "Cache delPattern failed");
    }
  },

  flush: async () => {
    try {
      if (_backend === "redis") await _redis.flushdb();
      else _local.flushAll();
    } catch (err) {
      log.warn({ err }, "Cache flush failed");
    }
  },

  stats: async () => {
    if (_backend === "redis") {
      const info = await _redis.info("stats");
      return { backend: "redis", info };
    }
    return { backend: "memory", keys: _local.keys().length, stats: _local.getStats() };
  },

  getBackend: () => _backend,

  close: async () => {
    if (_redis) await _redis.quit();
  },
};

/** Cache key builders */
export const cacheKey = {
  userProfile:  (userId)            => `user:${userId}:profile`,
  userHistory:  (userId, page)      => `user:${userId}:history:${page}`,
  analysis:     (id)                => `analysis:${id}`,
  rateLimit:    (userId, window)    => `rl:user:${userId}:${window}`,
  healthCheck:  ()                  => `health:status`,
};

/**
 * Bounded pagination.
 *
 * Three routes each wrote `Math.min(parseInt(req.query.limit) || 30, 100)`,
 * which caps the top but not the bottom. `?limit=-1` therefore passed straight
 * through to SQL, and SQLite reads `LIMIT -1` as NO LIMIT — one request dumped
 * a user's entire list regardless of the 100-row cap. `?limit=1e9` was a second
 * surprise: parseInt stops at the "e" and yields 1.
 *
 * Shared so the three copies cannot drift apart again.
 */

/** Clamp a query param to a whole number within [min, max], else fall back. */
function clampInt(raw, { fallback, min, max }) {
  // Number() rather than parseInt: parseInt("1e9") is 1 and parseInt("1.9") is
  // 1 — both silently wrong rather than refused.
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function pageParams(query = {}, { defaultLimit = 30, maxLimit = 100 } = {}) {
  return {
    limit:  clampInt(query.limit,  { fallback: defaultLimit, min: 1, max: maxLimit }),
    offset: clampInt(query.offset, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
}

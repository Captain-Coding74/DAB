/**
 * Values that must agree in more than one place.
 *
 * The upload limit lived as `10 * 1024 * 1024` in four middleware configs and
 * as the literal "10 MB" in four pieces of UI copy — two of them Thai. Raising
 * it meant editing eight files, and missing one meant the interface lied to
 * users about what it would accept. Now it is declared once and everything
 * else derives from it, including the string the landing page displays.
 */

/**
 * Maximum upload size, in megabytes.
 *
 * Uploads use multer.memoryStorage(), so a file of this size occupies that
 * much RAM per concurrent request, plus the parsed rows on top. 25 MB is
 * roughly 200,000 CSV rows — beyond any thesis dataset — while staying safe
 * on a small VPS. Going meaningfully higher means moving to diskStorage
 * first; do not simply raise this number to 500.
 */
export const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 25);

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * Express `trust proxy` setting — controls how req.ip is derived and therefore
 * whether X-Forwarded-For can be trusted.
 *
 * This was hardcoded to 1, which is correct behind exactly one reverse proxy
 * but WRONG for a direct-to-Node deployment (the shipped docker-compose
 * exposes port 3000 directly): there, a client can forge X-Forwarded-For and
 * spoof req.ip, defeating the IP-keyed auth brute-force limiter. Since the
 * value must match the real topology, it is configurable — set TRUST_PROXY to
 * the number of proxy hops (0 when Node faces clients directly). Numeric only;
 * we never enable the blanket `true`, which trusts any client's XFF.
 */
export const TRUST_PROXY = (() => {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return 1;   // back-compat default: single proxy
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
})();

/**
 * The Claude model every AI call uses. One name, env-overridable — it was
 * hardcoded in six files, so changing models meant a grep-and-hope sweep.
 * Default is claude-opus-5 (current recommended model); set AI_MODEL to pick
 * another, e.g. AI_MODEL=claude-sonnet-4-6 for lower cost per token.
 */
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5";

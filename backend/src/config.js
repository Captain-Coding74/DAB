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

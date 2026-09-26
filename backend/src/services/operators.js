/**
 * services/operators.js — who counts as an operator of this deployment.
 *
 * DAB has no admin role: every account is a user. Two endpoints nonetheless
 * expose deployment-level information that a stranger who merely registered
 * should not see — the telemetry summary (which vertical uploaded what) and
 * /api/metrics (every route, its error rate, memory, the DB backend). Both
 * gate on the same env allowlist, TELEMETRY_ADMINS, a comma-separated list
 * of usernames. Unset means nobody. Case-insensitive so a typo in the .env
 * does not silently lock the operator out.
 */
export function operatorUsernames(env = process.env) {
  return String(env.TELEMETRY_ADMINS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** True when the request carries a verified user (req.user, set by
 *  requireAuth/optionalAuth) whose username is on the allowlist. */
export function isOperator(req, env = process.env) {
  const allow = operatorUsernames(env);
  if (!allow.length) return false;
  return allow.includes(String(req?.user?.username || "").toLowerCase());
}

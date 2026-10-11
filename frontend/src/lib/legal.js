/**
 * lib/legal.js — the click-wrap decisions (v21.30), kept out of the
 * components so they run under plain Node (legal.test.js).
 *
 * The server reports `legal: { accepted, current }` on register, login and
 * GET /api/auth/me. `current` is LEGAL_VERSION, which versions the Terms of
 * Service and the Privacy Notice together; `accepted` is what this user
 * agreed to, or null for an account made before sign-up asked. Anything but
 * an exact match means the user is asked again.
 */

/** True when the signed-in user must accept the current version first (never-accepted included). */
export const needsAcceptance = (legal) => Boolean(legal?.current) && legal.accepted !== legal.current;

/**
 * The signed-in user's { accepted, current } from GET /api/auth/me, or null
 * when it cannot be had (offline, signed out). `getJSON` is lib/api's, passed
 * in so this runs under Node.
 */
export async function fetchLegal(getJSON) {
  try { return (await getJSON("/api/auth/me"))?.legal || null; } catch { return null; }
}

/** Sign-up goes ahead only with both boxes ticked — the server answers TERMS_REQUIRED otherwise. */
export const consentGiven = (c) => c?.acceptTerms === true && c?.ageConfirmed === true;

/**
 * Split a translated sentence around its {slots} so a link can sit inside
 * it in either language's word order:
 *   fillSlots("I agree to the {terms}.", { terms: X }) → ["I agree to the ", X, "."]
 * A slot with no value stays as written, so a typo shows up on screen.
 */
export function fillSlots(template, slots = {}) {
  return String(template).split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && Object.prototype.hasOwnProperty.call(slots, m[1]) ? slots[m[1]] : part;
  });
}

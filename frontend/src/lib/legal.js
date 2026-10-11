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
 * Is the re-accept gate up? It is the only control: the API does not refuse
 * a user who has not re-accepted, so while it is up nothing else may act —
 * the global shortcuts and the command palette check this too (App.jsx,
 * components/palette), and the app behind the dialog is inert.
 */
export const gateActive = (state) => !!state?.user && needsAcceptance(state?.legal);

/**
 * Is the dialog up on this page? Everywhere the gate is active except
 * /account: a user who would rather not accept new terms must still be able
 * to download their data and delete their account (the Terms and the
 * Privacy Notice say /account stays open to them). The shortcuts and the
 * palette stay off there too — they act on the dashboard.
 */
export const gateShown = (state, pathname) => gateActive(state) && pathname !== "/account";

/** Wait before asking for the legal status again after a failed fetch: 5 s, doubling, at most a minute. */
export const legalRetryMs = (attempt) => Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt));

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

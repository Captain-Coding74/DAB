/**
 * Legal document version and operator identity (v21.30).
 *
 * LEGAL_VERSION versions BOTH the Terms of Service and the Privacy Notice.
 * Bump it whenever either changes materially: a signed-in user who accepted
 * an older version is asked to accept again before carrying on.
 *
 * Contact details come from the environment so the published notices name a
 * real person and address without committing them to the repo. Production
 * warns at boot when they are missing — PDPA s.23 requires them.
 */
export const LEGAL_VERSION = "2026-10-10";

export function legalInfo(env = process.env) {
  return {
    version: LEGAL_VERSION,
    operatorName: env.LEGAL_OPERATOR_NAME || "Phatcharaphong Siriphatcharakul",
    contactEmail: env.LEGAL_CONTACT_EMAIL || "",
    postalAddress: env.LEGAL_POSTAL_ADDRESS || "",
    hostingProvider: env.LEGAL_HOSTING_PROVIDER || "",
    hostingRegion: env.LEGAL_HOSTING_REGION || "",
  };
}

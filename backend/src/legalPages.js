/**
 * legalPages.js — the public legal pages and GET /api/legal (v21.30).
 *
 * The notices are static, bilingual files in frontend/public, copied to dist
 * by Vite exactly like landing.html. They carry {{PLACEHOLDERS}} for the
 * operator's identity and contact details, which come from the environment
 * (services/legal.js) so a real name and address never live in the repo.
 * Each template is read once per process and filled in per request, so a
 * changed env needs only a restart — and every value is HTML-escaped: an
 * address containing "<" must print, not inject.
 *
 * An empty value never renders as an empty mailto: or a blank line. PDPA
 * s.23 requires the controller's contact details, so a missing one shows a
 * visible "being set up" sentence in both languages, and production warns
 * at boot (warnMissingLegalContacts, called by server.js).
 *
 * Mounted BEFORE express.static, which would otherwise serve /privacy.html
 * raw, placeholders and all.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { legalInfo } from "./services/legal.js";
import { serviceLogger } from "./logger.js";

export const LEGAL_PAGES = ["privacy", "terms", "storage", "contact", "licenses"];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/* Both languages in one span; legal.css shows the one the page is in. */
const pending = (en, th) =>
  `<span class="unset"><span lang="en">${en}</span><span lang="th">${th}</span></span>`;
const NO_EMAIL   = pending("Contact details are being set up — please check back soon.",
                           "กำลังตั้งค่าข้อมูลติดต่อ โปรดกลับมาตรวจสอบอีกครั้งเร็ว ๆ นี้");
const NO_ADDRESS = pending("The postal address is being set up — please check back soon.",
                           "กำลังตั้งค่าที่อยู่ทางไปรษณีย์ โปรดกลับมาตรวจสอบอีกครั้งเร็ว ๆ นี้");
const NO_HOSTING = pending("Not published yet — the details are being set up.",
                           "ยังไม่ได้เผยแพร่ — กำลังตั้งค่ารายละเอียด");

const clean = (v) => String(v ?? "").trim();
/** A plain value, escaped, or its fallback. An address may span lines. */
const textOr = (v, fallback) => (clean(v) ? escapeHtml(clean(v)).replace(/\r?\n/g, "<br>") : fallback);

/** Placeholder name → HTML to put in its place. */
export function legalValues(info = legalInfo()) {
  const email = clean(info.contactEmail);
  return {
    OPERATOR_NAME:    textOr(info.operatorName, NO_EMAIL),
    CONTACT_EMAIL:    email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : NO_EMAIL,
    POSTAL_ADDRESS:   textOr(info.postalAddress, NO_ADDRESS),
    HOSTING_PROVIDER: textOr(info.hostingProvider, NO_HOSTING),
    HOSTING_REGION:   textOr(info.hostingRegion, NO_HOSTING),
    LEGAL_VERSION:    escapeHtml(info.version),
  };
}

/**
 * Fill a template. Unknown placeholders are left as they are, so a typo
 * shows up (routes.test.js fails on any "{{" in a served page). ?lang=th
 * is honoured here, not only in legal.js, so the Thai text — the version
 * that prevails — is reachable without JavaScript.
 */
export function renderLegal(template, values, lang = "en") {
  const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => values[key] ?? m);
  return lang === "th"
    ? html.replace('<html lang="en">', '<html lang="th">').replace('<body data-lang="en">', '<body data-lang="th">')
    : html;
}

export function mountLegalPages(app, distPath) {
  const templates = new Map();   // read once per process; a failed read is retried
  const load = async (name) => {
    if (!templates.has(name)) templates.set(name, await readFile(path.join(distPath, `${name}.html`), "utf8"));
    return templates.get(name);
  };

  app.get("/api/legal", (_req, res) => res.json(legalInfo()));

  for (const name of LEGAL_PAGES) {
    app.get(`/${name}.html`, (_req, res) => res.redirect(301, `/${name}`));
    app.get(`/${name}`, async (req, res, next) => {
      let template;
      try { template = await load(name); }
      catch { return next(); }   // no build: the SPA fallback says so
      res.type("html").send(renderLegal(template, legalValues(), req.query.lang === "th" ? "th" : "en"));
    });
  }
}

/**
 * Production boot warning: the notices are live but cannot say how to reach
 * the controller. Silent outside production (tests, dev). Returns the
 * missing variable names so a test can check the decision without a log.
 */
export function warnMissingLegalContacts(env = process.env, log = serviceLogger("legal")) {
  if (env.NODE_ENV !== "production") return [];
  const missing = ["LEGAL_CONTACT_EMAIL", "LEGAL_POSTAL_ADDRESS"].filter((k) => !clean(env[k]));
  if (missing.length) {
    log.warn({ missing }, "Legal contact details are not set — /privacy and /contact show \"being set up\" instead (PDPA s.23 requires them)");
  }
  return missing;
}

/* legal.js — language toggle for the legal pages (v21.30).
 *
 * Each page ships both languages; body[data-lang] decides which one shows
 * (legal.css). The server already set it from ?lang=, so /privacy?lang=th
 * works without JavaScript. This file adds the visitor's saved choice and
 * makes the EN/TH links switch in place.
 *
 * The key is dab_landing_lang, shared with the landing page and the app, so
 * one choice follows the visitor everywhere. The Storage notice lists every
 * key DAB writes; this file must not add one.
 *
 * External, not inline: the CSP is script-src 'self' (see landing.js).
 */
(function () {
  const KEY = "dab_landing_lang";
  const links = document.querySelectorAll("[data-set-lang]");

  // Storage can throw (blocked site data, some private modes): the page
  // must still work, just without remembering the choice.
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save  = (v) => { try { localStorage.setItem(KEY, v); } catch { /* not remembered */ } };

  function apply(lang) {
    document.body.dataset.lang = lang;
    document.documentElement.lang = lang;
    links.forEach(a => a.setAttribute("aria-current", String(a.dataset.setLang === lang)));
  }

  // An explicit ?lang= in the link wins; otherwise the saved choice; else English.
  const served = document.body.dataset.lang;
  let param = new URLSearchParams(location.search).get("lang");
  apply(param === "th" || param === "en" ? param : (saved() === "th" ? "th" : "en"));

  // Switching language here changes the page height above a deep link
  // (/privacy#ai), so put the target back in view.
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target && document.body.dataset.lang !== served) target.scrollIntoView();

  links.forEach(a => a.addEventListener("click", (e) => {
    e.preventDefault();
    const lang = a.dataset.setLang;
    save(lang);
    apply(lang);
    // Drop a stale ?lang= so a reload shows the language just chosen.
    if (param) { history.replaceState(null, "", location.pathname + location.hash); param = null; }
  }));
})();

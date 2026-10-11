/**
 * legalPages.test.js — v21.30 legal pages: placeholder filling, escaping,
 * the "being set up" fallbacks, the production boot warning, and the page
 * sources themselves (CSP-safe, the anchors other units link to, no unknown
 * placeholders). Served-page behaviour is in routes.test.js.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { LEGAL_VERSION, legalInfo } from "./services/legal.js";
import { LEGAL_PAGES, escapeHtml, legalValues, renderLegal, warnMissingLegalContacts, templateFor } from "./legalPages.js";

const PUBLIC = new URL("../../frontend/public/", import.meta.url);
const source = (name) => readFileSync(new URL(`${name}.html`, PUBLIC), "utf8");
const KNOWN = ["OPERATOR_NAME", "CONTACT_EMAIL", "POSTAL_ADDRESS", "HOSTING_PROVIDER", "HOSTING_REGION", "HOSTING_TRANSFER_BASIS", "LEGAL_VERSION"];

describe("legalInfo (services/legal.js)", () => {
  test("names the default operator and leaves contact details empty until configured", () => {
    const info = legalInfo({});
    assert.equal(info.version, LEGAL_VERSION);
    assert.equal(info.operatorName, "Phatcharaphong Siriphatcharakul");
    assert.deepEqual([info.contactEmail, info.postalAddress, info.hostingProvider, info.hostingRegion], ["", "", "", ""]);
  });

  test("reads every value from the environment", () => {
    const info = legalInfo({ LEGAL_OPERATOR_NAME: "A", LEGAL_CONTACT_EMAIL: "b@c.th", LEGAL_POSTAL_ADDRESS: "D",
                             LEGAL_HOSTING_PROVIDER: "E", LEGAL_HOSTING_REGION: "F" });
    assert.deepEqual(info, { version: LEGAL_VERSION, operatorName: "A", contactEmail: "b@c.th",
                             postalAddress: "D", hostingProvider: "E", hostingRegion: "F" });
  });
});

describe("legalValues", () => {
  test("escapes every value: configuration text must print, never inject", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const v = legalValues(legalInfo({ LEGAL_OPERATOR_NAME: "<script>alert(1)</script>",
                                      LEGAL_POSTAL_ADDRESS: '9 "Soi" <b>5</b> & Co', LEGAL_HOSTING_REGION: "ap-<x>" }));
    assert.equal(v.OPERATOR_NAME, "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(v.POSTAL_ADDRESS, "9 &quot;Soi&quot; &lt;b&gt;5&lt;/b&gt; &amp; Co");
    assert.equal(v.HOSTING_REGION, "ap-&lt;x&gt;");
  });

  test("the email becomes a mailto link, escaped in both places", () => {
    const v = legalValues(legalInfo({ LEGAL_CONTACT_EMAIL: ' privacy@example.com"><x ' }));
    assert.equal(v.CONTACT_EMAIL,
      '<a href="mailto:privacy@example.com&quot;&gt;&lt;x">privacy@example.com&quot;&gt;&lt;x</a>');
  });

  test("an empty or blank value shows a visible bilingual sentence, never an empty mailto", () => {
    const v = legalValues(legalInfo({ LEGAL_CONTACT_EMAIL: "   ", LEGAL_POSTAL_ADDRESS: "" }));
    assert.ok(!v.CONTACT_EMAIL.includes("mailto"), "no mailto without an address");
    for (const key of ["CONTACT_EMAIL", "POSTAL_ADDRESS", "HOSTING_PROVIDER", "HOSTING_REGION"]) {
      assert.match(v[key], /class="unset"/, `${key} falls back visibly`);
      assert.match(v[key], /<span lang="en">[^<]+<\/span><span lang="th">[^<]+<\/span>/, `${key} fallback is bilingual`);
    }
    assert.match(v.CONTACT_EMAIL, /Contact details are being set up/);
    assert.match(v.CONTACT_EMAIL, /กำลังตั้งค่าข้อมูลติดต่อ/);
  });

  test("a blank operator name says the name is being set up, not the contact details", () => {
    const v = legalValues(legalInfo({ LEGAL_OPERATOR_NAME: "  " }));
    assert.match(v.OPERATOR_NAME, /class="unset"/);
    assert.match(v.OPERATOR_NAME, /operator's name is being set up/);
    assert.match(v.OPERATOR_NAME, /กำลังตั้งค่าชื่อผู้ให้บริการ/);
  });

  test("a multi-line postal address keeps its lines", () => {
    assert.equal(legalValues(legalInfo({ LEGAL_POSTAL_ADDRESS: "1 Road\nBangkok 10110" })).POSTAL_ADDRESS,
      "1 Road<br>Bangkok 10110");
  });
});

describe("renderLegal", () => {
  const tpl = '<html lang="en"><body data-lang="en"><p>{{OPERATOR_NAME}} · {{LEGAL_VERSION}} · {{NOT_A_KEY}}</p>';

  test("fills known placeholders and leaves unknown ones visible", () => {
    const html = renderLegal(tpl, { OPERATOR_NAME: "Op", LEGAL_VERSION: "v1" });
    assert.equal(html, '<html lang="en"><body data-lang="en"><p>Op · v1 · {{NOT_A_KEY}}</p>');
  });

  test("?lang=th switches the document language server-side", () => {
    const html = renderLegal(tpl, {}, "th");
    assert.ok(html.startsWith('<html lang="th"><body data-lang="th">'));
  });
});

describe("warnMissingLegalContacts", () => {
  const spy = () => { const calls = []; return { calls, warn: (...a) => calls.push(a) }; };

  const ALL = ["LEGAL_CONTACT_EMAIL", "LEGAL_POSTAL_ADDRESS", "LEGAL_HOSTING_PROVIDER", "LEGAL_HOSTING_REGION", "LEGAL_HOSTING_TRANSFER_BASIS"];

  test("production with nothing set warns, naming the contact details and the hosting facts", () => {
    const log = spy();
    assert.deepEqual(warnMissingLegalContacts({ NODE_ENV: "production", LEGAL_CONTACT_EMAIL: " " }, log), ALL);
    assert.equal(log.calls.length, 1);
    assert.deepEqual(log.calls[0][0], { missing: ALL });
  });

  // v21.30: where data is hosted, and the safeguard for taking it out of Thailand, are release prerequisites too.
  test("contact details alone are not enough: the hosting facts are still named", () => {
    const log = spy();
    assert.deepEqual(warnMissingLegalContacts({ NODE_ENV: "production", LEGAL_CONTACT_EMAIL: "a@b.th", LEGAL_POSTAL_ADDRESS: "1 Road" }, log),
      ["LEGAL_HOSTING_PROVIDER", "LEGAL_HOSTING_REGION", "LEGAL_HOSTING_TRANSFER_BASIS"]);
  });

  test("production with everything set is silent", () => {
    const log = spy();
    assert.deepEqual(warnMissingLegalContacts({ NODE_ENV: "production", LEGAL_CONTACT_EMAIL: "a@b.th", LEGAL_POSTAL_ADDRESS: "1 Road",
      LEGAL_HOSTING_PROVIDER: "Railway", LEGAL_HOSTING_REGION: "Singapore", LEGAL_HOSTING_TRANSFER_BASIS: "DPA with SCCs" }, log), []);
    assert.equal(log.calls.length, 0);
  });

  test("the transfer safeguard fills its placeholder, escaped, or says it is being set up", () => {
    assert.equal(legalValues(legalInfo({}), { LEGAL_HOSTING_TRANSFER_BASIS: "DPA <SCC>" }).HOSTING_TRANSFER_BASIS, "DPA &lt;SCC&gt;");
    assert.match(legalValues(legalInfo({}), {}).HOSTING_TRANSFER_BASIS, /being set up/);
  });

  test("silent outside production, so tests and dev never see it", () => {
    const log = spy();
    for (const NODE_ENV of ["test", "development", undefined]) {
      assert.deepEqual(warnMissingLegalContacts({ NODE_ENV }, log), []);
    }
    assert.equal(log.calls.length, 0);
  });
});

describe("page sources (frontend/public)", () => {
  test("CSP-safe: no inline scripts or inline event handlers, only legal.js and legal.css", () => {
    for (const name of LEGAL_PAGES) {
      const html = source(name);
      const scripts = html.match(/<script\b[^>]*>/g) || [];
      assert.deepEqual(scripts, ['<script src="/legal.js">'], `${name}: scripts`);
      assert.ok(!/<script\b[^>]*>[^<]+<\/script>/.test(html), `${name}: inline script body`);
      assert.ok(!/\son[a-z]+\s*=/i.test(html), `${name}: inline event handler`);
      assert.ok(html.includes('<link rel="stylesheet" href="/legal.css">'), `${name}: stylesheet`);
      assert.ok(!/https?:\/\/[^"]+\.(css|js|woff2?)\b/.test(html), `${name}: third-party resource`);
    }
  });

  test("only known placeholders, and the language switch the server relies on", () => {
    for (const name of LEGAL_PAGES) {
      const html = source(name);
      for (const [, key] of html.matchAll(/\{\{([^}]*)\}\}/g)) assert.ok(KNOWN.includes(key), `${name}: unknown {{${key}}}`);
      assert.ok(html.includes('<html lang="en">') && html.includes('<body data-lang="en">'), `${name}: EN default markers`);
    }
  });

  test("the anchors other pages link to exist exactly once", () => {
    const ids = { privacy: ["ai", "uploads", "retention", "rights", "processor", "security", "collect"],
                  terms: ["processor"], contact: ["report", "requests"], licenses: ["licenses-body"] };
    for (const [name, list] of Object.entries(ids)) {
      const html = source(name);
      for (const id of list) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `${name}#${id}`);
      }
    }
  });

  test("every page links to the others, the landing page and the app", () => {
    for (const name of LEGAL_PAGES) {
      const html = source(name);
      for (const href of ["/privacy", "/terms", "/storage", "/contact", "/licenses", "/welcome", "/"]) {
        assert.ok(html.includes(`href="${href}"`), `${name} links ${href}`);
      }
    }
  });

  test("the storage notice lists exactly the six keys DAB writes", () => {
    const keys = [...new Set(source("storage").match(/\bdab_[a-z_]+/g))].sort();
    assert.deepEqual(keys, ["dab_at", "dab_dark", "dab_landing_lang", "dab_rt", "dab_tour_done", "dab_user"]);
  });
});

describe("legal.js (the language toggle)", () => {
  /** Run legal.js against a minimal DOM: two EN/TH links, a hash, a store. */
  function runToggle({ hash = "", search = "", stored = null } = {}) {
    const store = new Map(stored ? [["dab_landing_lang", stored]] : []);
    const link = (lang) => ({ dataset: { setLang: lang }, handlers: {}, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { this.handlers[t] = fn; } });
    const links = [link("en"), link("th")];
    const document = { body: { dataset: { lang: "en" } }, documentElement: {},
      querySelectorAll: () => links, getElementById: () => null };
    const ctx = { document, links, URLSearchParams,
      location: { hash, search, pathname: "/privacy" }, history: { replaceState() {} },
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
    vm.runInNewContext(readFileSync(new URL("legal.js", PUBLIC), "utf8"), ctx);
    return { ...ctx, store };
  }

  test("a saved Thai choice applies, and a click switches and saves under dab_landing_lang", () => {
    const { document, links, store } = runToggle({ stored: "th" });
    assert.equal(document.body.dataset.lang, "th");
    links[0].handlers.click({ preventDefault() {} });
    assert.equal(document.body.dataset.lang, "en");
    assert.deepEqual([...store], [["dab_landing_lang", "en"]], "no other key is written");
  });

  test("a malformed #hash does not stop the toggle from working", () => {
    const { document, links } = runToggle({ hash: "#%E0" });
    assert.equal(typeof links[1].handlers.click, "function", "click handler attached");
    links[1].handlers.click({ preventDefault() {} });
    assert.equal(document.body.dataset.lang, "th");
  });
});

describe("templateFor", () => {
  test("every spelling of a template's file name, decoded and normalised", () => {
    for (const [p, page] of [["/privacy.html", "privacy"], ["/privacy%2Ehtml", "privacy"], ["//contact.html", "contact"],
                             ["/a/../terms.html", "terms"], ["/./Storage.HTML", "storage"], ["/%6Cicenses.html", "licenses"]]) {
      assert.equal(templateFor(p), page, p);
    }
  });

  test("anything else is left to static and the SPA", () => {
    for (const p of ["/privacy", "/landing.html", "/index.html", "/assets/privacy.html", "/privacy.html/", "/%E0%A4%A", "/privacy.htm"]) {
      assert.equal(templateFor(p), null, p);
    }
  });
});

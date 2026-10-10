/**
 * legalPages.test.js — v21.30 legal pages: placeholder filling, escaping,
 * the "being set up" fallbacks, the production boot warning, and the page
 * sources themselves (CSP-safe, the anchors other units link to, no unknown
 * placeholders). Served-page behaviour is in routes.test.js.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGAL_VERSION, legalInfo } from "./services/legal.js";
import { LEGAL_PAGES, escapeHtml, legalValues, renderLegal, warnMissingLegalContacts } from "./legalPages.js";

const PUBLIC = new URL("../../frontend/public/", import.meta.url);
const source = (name) => readFileSync(new URL(`${name}.html`, PUBLIC), "utf8");
const KNOWN = ["OPERATOR_NAME", "CONTACT_EMAIL", "POSTAL_ADDRESS", "HOSTING_PROVIDER", "HOSTING_REGION", "LEGAL_VERSION"];

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

  test("production with no email or address warns, naming both", () => {
    const log = spy();
    assert.deepEqual(warnMissingLegalContacts({ NODE_ENV: "production", LEGAL_CONTACT_EMAIL: " " }, log),
      ["LEGAL_CONTACT_EMAIL", "LEGAL_POSTAL_ADDRESS"]);
    assert.equal(log.calls.length, 1);
    assert.deepEqual(log.calls[0][0], { missing: ["LEGAL_CONTACT_EMAIL", "LEGAL_POSTAL_ADDRESS"] });
  });

  test("production with both set is silent", () => {
    const log = spy();
    assert.deepEqual(warnMissingLegalContacts({ NODE_ENV: "production", LEGAL_CONTACT_EMAIL: "a@b.th",
                                                LEGAL_POSTAL_ADDRESS: "1 Road" }, log), []);
    assert.equal(log.calls.length, 0);
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

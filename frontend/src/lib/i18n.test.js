/**
 * i18n.test.js — an untranslated string is a bug, so the suite fails on one.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STRINGS, t } from "./i18n.js";

/* v21.30: string packs (lib/strings/*.js) add their keys to STRINGS when a
   lazy screen imports them. Capture the core table first, then load every
   pack, so the checks below cover all of them and collisions can be seen. */
const CORE = { ...STRINGS };
const PACK_DIR = new URL("./strings/", import.meta.url);
const PACKS = {};
for (const f of readdirSync(PACK_DIR).filter((f) => f.endsWith(".js"))) {
  PACKS[f] = Object.values(await import(new URL(f, PACK_DIR).href)).find((v) => v && typeof v === "object");
}

describe("i18n", () => {
  test("every key has both English and Thai", () => {
    const missing = [];
    for (const [key, v] of Object.entries(STRINGS)) {
      if (!v.en?.trim()) missing.push(`${key}: no English`);
      if (!v.th?.trim()) missing.push(`${key}: no Thai`);
    }
    assert.deepEqual(missing, [], `untranslated strings:\n${missing.join("\n")}`);
  });

  test("Thai values actually contain Thai characters", () => {
    // Catches the copy-paste failure where the English string is pasted into
    // both slots and nobody notices until a Thai user sees it.
    // `sameInBoth` opts out a string that is genuinely identical in both
    // languages — file formats, product names. Everything else must differ.
    const suspect = Object.entries(STRINGS)
      .filter(([, v]) => !v.sameInBoth && !/[\u0E00-\u0E7F]/.test(v.th))
      .map(([k]) => k);
    assert.deepEqual(suspect, [], `these "Thai" values have no Thai characters: ${suspect.join(", ")}`);
  });

  test("Thai is the default, matching the landing page", () => {
    // Deliberate flip (visual bug hunt): the product is Thai-first — body copy
    // exists fully in Thai while English coverage is partial, so defaulting to
    // "en" painted an EN-highlighted toggle over a Thai page on first visit.
    assert.equal(t("nav.analyze"), "วิเคราะห์");
  });

  test("v21.30 privacy notes keep the conditions that make them true", () => {
    // Public claims. "Stored only if you save" and "not sent to the AI" are
    // the load-bearing parts; a shortened rewrite must not drop them.
    assert.match(t("columns.pdpaNotice", "en"), /left out of what the AI sees/);
    assert.match(t("columns.pdpaNotice", "en"), /stored only if you save/);
    assert.match(t("columns.pdpaNotice", "th"), /ก็ต่อเมื่อคุณบันทึกชุดข้อมูล/);
    assert.match(t("classReport.privacy", "en"), /none of this is sent to the AI or included in share links/);
    // v21.30: the masking note is scoped to the column panel — the class
    // report on the same page shows names in full, and says so.
    assert.match(t("columns.pdpaNotice", "en"), /masked in these column statistics/);
    assert.match(t("columns.pdpaNotice", "th"), /ในสถิติรายคอลัมน์นี้/);
    assert.doesNotMatch(t("columns.pdpaNotice", "th"), /ในหน้านี้/);
    assert.match(t("classReport.privacy", "en"), /names are shown in full/);
    assert.match(t("classReport.privacy", "th"), /แสดงชื่อนักเรียนเต็ม/);
    assert.match(t("workspace.schedulesSoon", "en"), /coming soon/);
  });

  test("v21.30: the AI label is the exact text the PDF/Excel exports print", async () => {
    // Two copies (SPA bundle, backend exports) of one public sentence; this
    // keeps them from drifting apart.
    const { AI_LABEL } = await import("../../../backend/src/services/aiLabel.js");
    assert.equal(t("ai.label", "en"), AI_LABEL.en);
    assert.equal(t("ai.label", "th"), AI_LABEL.th);
  });

  test("v21.30: the share warning says who can see the report and for how long", () => {
    const en = t("share.warning", "en");
    assert.match(en, /^Anyone with the link can see this report/);
    assert.match(en, /until it expires/);
    assert.match(en, /detected as personal data are hidden/);
    assert.match(t("share.warning", "th"), /ทุกคนที่มีลิงก์/);
    assert.match(t("share.warning", "th"), /จนกว่าลิงก์จะหมดอายุ/);
    // The generic title — never the file name — in both languages.
    assert.equal(t("share.defaultTitle", "en"), "Analysis report");
  });

  test("v21.30: no key is defined twice — not in one table, not across packs", () => {
    // A JS object literal silently keeps the LAST of two equal keys, and
    // addStrings would silently replace a core string, so both are errors.
    const dupes = [];
    for (const file of ["i18n.js", ...Object.keys(PACKS).map((f) => `strings/${f}`)]) {
      const seen = new Set();
      for (const [, key] of readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/^\s*"([\w.]+)"\s*:\s*\{/gm)) {
        if (seen.has(key)) dupes.push(`${file}: ${key}`);
        seen.add(key);
      }
    }
    const owner = new Map(Object.keys(CORE).map((k) => [k, "i18n.js"]));
    for (const [file, pack] of Object.entries(PACKS)) {
      for (const key of Object.keys(pack)) {
        if (owner.has(key)) dupes.push(`${key}: ${owner.get(key)} and strings/${file}`);
        owner.set(key, `strings/${file}`);
      }
    }
    assert.deepEqual(dupes, []);
    assert.ok(Object.keys(PACKS).length >= 4, "the packs were found");
  });

  test("v21.30: every component that renders AI text carries the AI label", () => {
    const files = ["../components/dashboard/tabs.jsx", "../components/chat/index.jsx",
      "../components/dashboard/AgentPanel.jsx", "../pages/SharePage.jsx", "../pages/HistoryPage.jsx"];
    for (const f of files) assert.match(readFileSync(new URL(f, import.meta.url), "utf8"), /<AiLabel\b/, f);
  });

  test("an explicit language is honoured", () => {
    assert.equal(t("nav.analyze", "th"), "วิเคราะห์");
  });

  test("an unknown key returns itself rather than undefined", () => {
    assert.equal(t("nope.missing"), "nope.missing");
  });

  test("a language with no entry falls back to English", () => {
    assert.equal(t("nav.analyze", "fr"), "Analyze");
  });
});

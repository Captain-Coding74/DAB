/**
 * i18n.test.js — an untranslated string is a bug, so the suite fails on one.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, t } from "./i18n.js";

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
    assert.match(t("classReport.privacy", "en"), /not sent to the AI and not included in share links/);
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

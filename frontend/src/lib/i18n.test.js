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

  test("English is the default, matching the landing page", () => {
    assert.equal(t("nav.analyze"), "Analyze");
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

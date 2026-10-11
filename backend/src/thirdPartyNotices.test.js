/**
 * thirdPartyNotices.test.js — v21.30 licence notices (scripts/third-party-notices.mjs).
 *
 * The generator decides what DAB tells people about the software it ships, and
 * the CI gate decides which licences may ship without a person looking. Both
 * are tested here on small synthetic inputs; `npm run licenses:check` then
 * runs the same code against the real lockfile. Serving /licenses/*.txt is in
 * routes.test.js.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { licenceVerdict, licenceOf, sourceOf, productionKeys, review, derivedFonts }
  from "../../scripts/third-party-notices.mjs";
import { groupTexts, renderMarkdown, renderText, wrap } from "../../scripts/lib/notices-render.mjs";

const ROOT = new URL("../../", import.meta.url);

describe("licence allow-list", () => {
  test("allow-listed SPDX ids pass, with or without parentheses", () => {
    for (const id of ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1", "CC0-1.0",
                      "Unlicense", "BlueOak-1.0.0", "Python-2.0", "CC-BY-4.0", "(MIT)"]) {
      assert.equal(licenceVerdict(id), "allowed", id);
    }
  });

  test("an OR choice passes when one alternative is allowed", () => {
    assert.equal(licenceVerdict("(MIT OR GPL-3.0-or-later)"), "allowed");
    assert.equal(licenceVerdict("GPL-2.0 OR Apache-2.0"), "allowed");
    assert.equal(licenceVerdict("GPL-2.0 OR LGPL-3.0"), "review");
  });

  test("everything else goes to a person: AND, WITH, nesting, non-SPDX, nothing", () => {
    for (const expr of ["(MIT AND Zlib)", "MIT AND ISC", "Apache-2.0 WITH LLVM-exception", "(MIT OR (GPL-3.0 AND X))",
                        "MIT/X11", "GPL-3.0", "SEE LICENSE IN LICENSE.txt", "", undefined, null]) {
      assert.equal(licenceVerdict(expr), "review", String(expr));
    }
  });

  test("a reviewed entry covers only the exact licence string it was reviewed for", () => {
    const rows = [{ name: "a", licence: "MIT" }, { name: "b", licence: "MIT/X11" }, { name: "c", licence: "GPL-3.0" },
                  { name: "d", licence: "" }];
    const out = review(rows, { b: { licence: "MIT/X11", note: "old name for MIT" }, c: { licence: "GPL-2.0", note: "x" } });
    assert.deepEqual(out.reviewed.map((r) => [r.name, r.note]), [["b", "old name for MIT"]]);
    assert.deepEqual(out.unreviewed.map((r) => r.name), ["c", "d"], "c changed licence since its review; d has none");
  });
});

describe("package metadata", () => {
  test("licenceOf reads the modern field, the {type} form and the legacy array", () => {
    assert.equal(licenceOf({ license: " MIT " }), "MIT");
    assert.equal(licenceOf({ license: { type: "ISC" } }), "ISC");
    assert.equal(licenceOf({ licenses: [{ type: "MIT", url: "x" }] }), "MIT");
    assert.equal(licenceOf({ licenses: [{ type: "MIT" }, "Apache-2.0"] }), "(MIT OR Apache-2.0)");
    assert.equal(licenceOf({}, { license: "BSD-3-Clause" }), "BSD-3-Clause", "falls back to the lockfile");
    assert.equal(licenceOf({}), "");
  });

  test("sourceOf turns repository shorthands into browsable https links", () => {
    const cases = [
      [{ repository: { url: "git+https://github.com/a/b.git" } }, "https://github.com/a/b"],
      [{ repository: "github:a/b" }, "https://github.com/a/b"],
      [{ repository: "a/b" }, "https://github.com/a/b"],
      [{ repository: "git://github.com/a/b.git" }, "https://github.com/a/b"],
      [{ repository: "git@github.com:a/b.git" }, "https://github.com/a/b"],
      [{ repository: { url: "http://github.com/a/b.git#main" } }, "https://github.com/a/b"],
      [{ homepage: "https://example.org/docs" }, "https://example.org/docs"],
      [{}, ""],
    ];
    for (const [pkg, want] of cases) assert.equal(sourceOf(pkg), want, JSON.stringify(pkg));
  });
});

describe("production dependency walk", () => {
  // backend → a@1 → b (a has its own nested b@2; the root b@1 belongs to c); frontend → c;
  // tool is only a devDependency; d is an optional peer nobody installed.
  const packages = {
    "": { devDependencies: { tool: "^1" } },
    backend: { dependencies: { a: "^1" }, devDependencies: { tool: "^1" } },
    frontend: { dependencies: { c: "^1" } },
    "node_modules/a": { version: "1.0.0", dependencies: { b: "^2" }, peerDependencies: { d: "*" } },
    "node_modules/a/node_modules/b": { version: "2.0.0" },
    "node_modules/b": { version: "1.0.0" },
    "node_modules/c": { version: "1.0.0", dependencies: { b: "^1" } },
    "node_modules/tool": { version: "1.0.0", dev: true },
  };

  test("follows Node's resolution and leaves development tools out", () => {
    const found = productionKeys(packages);
    assert.deepEqual([...found.keys()].sort(),
      ["node_modules/a", "node_modules/a/node_modules/b", "node_modules/b", "node_modules/c"]);
    assert.equal(found.get("node_modules/a/node_modules/b"), "node_modules/a", "nested copy resolved from its parent");
    assert.equal(found.get("node_modules/b"), "node_modules/c");
  });

  test("the real lockfile agrees with npm's own dev flags", () => {
    const lock = JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8")).packages;
    const found = productionKeys(lock);
    assert.ok(found.size > 100, "the walk reached the dependency tree");
    assert.deepEqual([...found.keys()].filter((k) => lock[k].dev), [], "no dev-only package listed as production");
    for (const name of ["vite", "tailwindcss", "supertest", "playwright-core"]) {
      assert.ok(!found.has(`node_modules/${name}`), `${name} is a development tool`);
    }
  });
});

describe("rendering", () => {
  const rows = [
    { name: "alpha", version: "1.0.0", licence: "MIT", source: "https://github.com/x/alpha", texts: "MIT text ~~~ inside" },
    { name: "beta", version: "2.0.0", licence: "MIT", source: "", texts: "MIT text ~~~ inside" },
    { name: "gamma", version: "3.0.0", licence: "ISC", source: "https://github.com/x/gamma", author: "G", texts: "" },
    { name: "@x/bin-linux", version: "1.0.0", licence: "MIT", source: "", via: "alpha", texts: null },
  ];

  test("each licence text is printed once, with every package that ships it", () => {
    const groups = groupTexts(rows);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].members.map((m) => m.name), ["alpha", "beta"]);
    const md = renderMarkdown(rows, []);
    assert.equal(md.split("MIT text ~~~ inside").length - 1, 1);
    assert.ok(md.includes("Used by: alpha 1.0.0, beta 2.0.0"));
    assert.ok(md.includes("~~~~text\nMIT text ~~~ inside\n~~~~"), "the fence is longer than any run inside the text");
    assert.ok(md.includes("gamma 3.0.0 - ISC - G - https://github.com/x/gamma"), "a package without a licence file is still listed");
    assert.ok(md.includes("| @x/bin-linux | 1.0.0 | MIT | prebuilt binary for alpha |"));
  });

  test("output is a pure function of its input: no dates, same bytes every run", () => {
    assert.equal(renderMarkdown(rows, []), renderMarkdown(rows, []));
    assert.equal(renderText(rows, []), renderText(rows, []));
    assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(renderText(rows, [])), "no timestamp");
  });

  test("reviewed exceptions are published with their reason", () => {
    const text = renderText(rows, [{ name: "gamma", version: "3.0.0", licence: "", note: "checked by hand" }]);
    assert.ok(text.includes("Licences reviewed by hand"));
    assert.ok(text.includes("gamma 3.0.0 - (none declared): checked by hand"));
  });

  test("plain text wraps at 78 columns with a hanging indent", () => {
    const out = wrap("word ".repeat(40), 78, "    ", "  - ");
    assert.ok(out.split("\n").every((l) => l.length <= 78));
    assert.ok(out.startsWith("  - word") && out.split("\n")[1].startsWith("    word"));
  });
});

describe("fonts", () => {
  test("the hero video's modified outlines do not use the Reserved Font Name", () => {
    const { list, problems } = derivedFonts(fileURLToPath(ROOT));
    assert.deepEqual(problems, []);
    assert.deepEqual(list.map((d) => d.family).sort(),
      ["DAB Render Mono Medium", "DAB Render Sans Thai", "DAB Render Sans Thai SemiBold"]);
    const scene = readFileSync(new URL("tools/hero-bg/scene.js", ROOT), "utf8");
    for (const d of list) assert.ok(scene.includes(`"${d.file.replace(".typeface.json", "")}"`), `scene.js loads ${d.file}`);
  });

  test("a family name or file name containing \"Plex\" is reported", () => {
    const root = mkdtempSync(join(tmpdir(), "dab-ofl-"));
    try {
      const dir = join(root, "tools/hero-bg/assets");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "ok.typeface.json"), JSON.stringify({ familyName: "IBM Plex Mono" }));
      writeFileSync(join(dir, "plex-x.typeface.json"), JSON.stringify({ familyName: "Fine" }));
      assert.equal(derivedFonts(root).problems.length, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("the OFL file quotes the font packages' licence verbatim", () => {
    const ofl = readFileSync(new URL("LICENSES/OFL-1.1-IBM-Plex.txt", ROOT), "utf8");
    for (const pkg of ["ibm-plex-sans-thai", "ibm-plex-mono"]) {
      const lic = readFileSync(new URL(`node_modules/@fontsource/${pkg}/LICENSE`, ROOT), "utf8").replace(/\r\n?/g, "\n");
      const [copyright] = lic.split("\n");
      assert.ok(ofl.includes(copyright.trim()), `${pkg}: IBM's copyright line`);
      const body = lic.slice(lic.indexOf("This Font Software is licensed")).split("\n").map((l) => l.trimEnd()).join("\n").trim();
      assert.ok(ofl.includes(body), `${pkg}: OFL body`);
    }
    assert.equal(readFileSync(new URL("frontend/public/licenses/OFL-1.1-IBM-Plex.txt", ROOT), "utf8"), ofl, "the served copy is identical");
  });
});

describe("/licenses page", () => {
  test("every library in its table ships in production, with the licence package-lock.json names", () => {
    const html = readFileSync(new URL("frontend/public/licenses.html", ROOT), "utf8");
    const lock = JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8")).packages;
    // the same walk as the notices: a build or test tool is not a "runtime library", even if it is in the lockfile
    const production = productionKeys(lock);
    const named = [...html.matchAll(/<td><code>([^<]+)<\/code><\/td><td>([^<]+)<\/td>/g)];
    assert.ok(named.length >= 10, "the main runtime libraries are listed");
    for (const [, pkg, licence] of named) {
      assert.ok(production.has(`node_modules/${pkg}`), `${pkg} is a production dependency`);
      assert.equal(licence, licenceOf({}, lock[`node_modules/${pkg}`]), pkg);
    }
    for (const href of ["/licenses/third-party.txt", "/licenses/OFL-1.1-IBM-Plex.txt"]) {
      assert.equal(html.split(`href="${href}"`).length - 1, 2, `${href} linked in both languages`);
    }
  });
});

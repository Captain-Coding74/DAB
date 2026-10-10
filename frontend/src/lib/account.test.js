/**
 * account.test.js — the /account page's decisions and requests (v21.30).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canDelete, acceptedLegalVersion, fileNameFrom, fetchDownload, exportUrl, exportFallbackName,
  filesIn, saveBlob, deleteMyAccount, deleteErrorKey,
} from "./account.js";
import { STRINGS } from "./i18n.js";

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body,
  blob: async () => ({ size: JSON.stringify(body).length }),
});

describe("delete confirmation", () => {
  test("needs the exact username typed and a password", () => {
    assert.equal(canDelete({ typed: "alice", username: "alice", password: "pw" }), true);
    assert.equal(canDelete({ typed: " alice ", username: "alice", password: "pw" }), true, "surrounding spaces are forgiven");
    assert.equal(canDelete({ typed: "Alice", username: "alice", password: "pw" }), false, "case matters");
    assert.equal(canDelete({ typed: "alice", username: "alice", password: "" }), false);
    assert.equal(canDelete({ typed: "", username: "", password: "pw" }), false);
  });

  test("DELETE /api/auth/me with the password in the body", async () => {
    let call;
    const r = await deleteMyAccount("pw", async (url, opts) => { call = { url, ...opts }; return response(200, { success: true }); });
    assert.deepEqual(r, { ok: true });
    assert.equal(call.url, "/api/auth/me");
    assert.equal(call.method, "DELETE");
    assert.deepEqual(JSON.parse(call.body), { password: "pw" });
  });

  test("failures map to a message: missing password, wrong password, rate limit, anything else", async () => {
    const fail = (status, body) => deleteMyAccount("pw", async () => response(status, body));
    const missing = await fail(400, { error: "x", code: "PASSWORD_REQUIRED" });
    assert.equal(missing.code, "PASSWORD_REQUIRED");
    assert.equal(deleteErrorKey(missing), "account.passwordRequired");
    assert.equal(deleteErrorKey(await fail(401, { error: "Wrong password" })), "account.wrongPassword");
    assert.equal(deleteErrorKey(await fail(429, {})), "account.tooMany");
    assert.equal(deleteErrorKey(await fail(500, {})), "account.deleteFailed");
    for (const k of ["account.passwordRequired", "account.wrongPassword", "account.tooMany", "account.deleteFailed"]) {
      assert.ok(STRINGS[k], `${k} is translated`);
    }
  });
});

describe("downloads", () => {
  test("the server's file name wins; the fallback covers a missing header", () => {
    assert.equal(fileNameFrom('attachment; filename="dab-export-a-2026-10-10.json"', "x"), "dab-export-a-2026-10-10.json");
    assert.equal(fileNameFrom("attachment; filename=\"???.csv\"; filename*=UTF-8''%E0%B8%84%E0%B8%A3%E0%B8%B9.csv", "x"), "ครู.csv",
      "the UTF-8 name, not Express's ASCII stand-in");
    assert.equal(fileNameFrom(null, "fallback.json"), "fallback.json");
    assert.equal(exportFallbackName("alice", new Date("2026-10-10T05:00:00Z")), "dab-export-alice-2026-10-10.json");
  });

  test("the export is fetched with the app's authenticated fetch and comes back as a Blob", async () => {
    let asked;
    const r = await fetchDownload(exportUrl, "f.json", async (url) => {
      asked = url;
      return response(200, { format: "x" }, { "content-disposition": 'attachment; filename="dab-export-a-2026-10-10.json"' });
    });
    assert.equal(asked, "/api/auth/me/export");
    assert.equal(r.ok, true);
    assert.equal(r.fileName, "dab-export-a-2026-10-10.json");
    assert.ok(r.blob.size > 0);
    const denied = await fetchDownload("/x", "f", async () => response(403, { error: "Only the dataset owner can download the original file" }));
    assert.deepEqual(denied, { ok: false, status: 403, error: "Only the dataset owner can download the original file" });
  });

  test("every saved version in the export becomes a download", () => {
    const files = filesIn({ datasets: [
      { name: "Sales", versions: [{ id: "v1", version_num: 1, file_name: "s.csv", download: "/api/datasets/d/versions/v1/download" },
                                  { id: "v2", version_num: 2, file_name: "s2.csv", download: "/api/datasets/d/versions/v2/download" }] },
    ] });
    assert.deepEqual(files.map((f) => [f.label, f.url, f.fileName]), [
      ["Sales · v1", "/api/datasets/d/versions/v1/download", "s.csv"],
      ["Sales · v2", "/api/datasets/d/versions/v2/download", "s2.csv"],
    ]);
    assert.deepEqual(filesIn(null), []);
  });

  test("saveBlob clicks a temporary link and revokes its URL afterwards — nothing stored", async () => {
    const events = [];
    const link = { click: () => events.push("click"), remove: () => events.push("remove") };
    const doc = { createElement: (tag) => { events.push(`create ${tag}`); return link; }, body: { appendChild: () => events.push("append") } };
    const urls = { createObjectURL: () => "blob:1", revokeObjectURL: (u) => events.push(`revoke ${u}`) };
    saveBlob({}, "a.json", { doc, urls, revokeAfterMs: 0 });
    assert.equal(link.download, "a.json");
    assert.equal(link.href, "blob:1");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(events, ["create a", "append", "click", "remove", "revoke blob:1"]);
  });

  test("the accepted legal version shows only when the profile carries one", () => {
    assert.equal(acceptedLegalVersion({ legal: { accepted: "2026-10-10", current: "2026-10-10" } }), "2026-10-10");
    assert.equal(acceptedLegalVersion({ legal: { accepted: null, current: "2026-10-10" } }), null);
    assert.equal(acceptedLegalVersion({}), null);
    assert.equal(acceptedLegalVersion(null), null);
  });
});

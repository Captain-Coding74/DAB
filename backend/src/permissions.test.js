/**
 * permissions.test.js — every dataset-scoped route × every role, in one table.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two permission bugs were found by hand-probing routes one at a time: a
 * viewer could POST /api/fixes/:id/apply and permanently write a new dataset
 * version, and an admin could take over a workspace. Both existed because a
 * route checked *that* the caller had a role without checking *which* role.
 *
 * Hand-probing does not scale. There are 35 dataset-scoped routes; the manual
 * hunt covered eleven. This table covers all of them, and — more importantly —
 * the last test fails when a NEW route appears that nobody has classified. A
 * route that forgets its guard now breaks the build instead of waiting to be
 * hunted.
 *
 * HOW TO USE IT
 * -------------
 * Add a route, add a line to ROUTES. The `min` field is the least privileged
 * role that may succeed:
 *   "public"  — no authentication at all
 *   "any"     — any logged-in user, even with no relation to the dataset
 *   "viewer"  — read access to this dataset
 *   "editor"  — write access
 *   "owner"   — owner only
 * Everything below `min` must be refused with 401, 403 or 404.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildApp, closeApp } from "./testApp.js";

const RANK = { public: 0, any: 1, viewer: 2, editor: 3, owner: 4 };

/**
 * Every route that resolves a dataset, with the minimum role that may use it.
 * `body`/`file` are only what the route needs to get past validation — this
 * asserts authorisation, not behaviour.
 */
const ROUTES = [
  // ── read ──
  { m: "get",    path: "/api/datasets/:id",                    min: "viewer" },
  { m: "get",    path: "/api/datasets/:id/preview",            min: "viewer" },
  { m: "get",    path: "/api/datasets/:id/versions",           min: "viewer" },
  { m: "get",    path: "/api/datasets/:id/collaborators",      min: "viewer" },
  { m: "get",    path: "/api/inference/:id/available",         min: "viewer" },
  { m: "post",   path: "/api/inference/:id",                   min: "viewer", body: { test: "t-test", valueColumn: "b", groupColumn: "a" } },
  { m: "post",   path: "/api/fixes/:id/preview",               min: "viewer", body: { op: "drop-duplicates" } },
  { m: "post",   path: "/api/fixes/:id/suggest",               min: "viewer", body: {} },
  { m: "post",   path: "/api/datasets/:id/analyze",            min: "viewer", body: {} },

  // ── write ──
  { m: "patch",  path: "/api/datasets/:id/rename",             min: "editor", body: { name: "x" } },
  { m: "patch",  path: "/api/datasets/:id/description",        min: "editor", body: { description: "x" } },
  { m: "patch",  path: "/api/datasets/:id/move",               min: "editor", body: { folderId: null } },
  { m: "post",   path: "/api/datasets/:id/tags",               min: "editor", body: { tag: "x" } },
  { m: "post",   path: "/api/fixes/:id/apply",                 min: "editor", body: { op: "drop-duplicates" } },
  /* ai-edit is a PREVIEW — it returns a diff and writes nothing, so read
     access is enough. Only /ai-edit/apply stores a new version. */
  { m: "post",   path: "/api/fixes/:id/ai-edit",               min: "viewer", body: { instruction: "trim" } },
  { m: "post",   path: "/api/fixes/:id/ai-edit/apply",         min: "editor", body: { rows: [["1", "2"]], instruction: "x" } },

  // ── owner only ──
  { m: "delete", path: "/api/datasets/:id",                    min: "owner" },
  { m: "post",   path: "/api/datasets/:id/share",              min: "owner", body: { username: "__other__", role: "viewer" } },
  { m: "delete", path: "/api/datasets/:id/permanent",          min: "owner" },
  { m: "delete", path: "/api/datasets/:id/collaborators/:userId", min: "owner" },

  // ── the rest, classified after the coverage check flagged them ──
  { m: "patch",  path: "/api/datasets/:id/star",               min: "editor", body: { starred: true } },
  { m: "post",   path: "/api/datasets/:id/restore",            min: "editor" },
  { m: "delete", path: "/api/datasets/:id/tags/:tag",          min: "editor" },
  { m: "get",    path: "/api/datasets/:id/versions/:versionId", min: "viewer" },
  { m: "post",   path: "/api/datasets/:id/versions",           min: "editor" },
  { m: "post",   path: "/api/datasets/:id/versions/:versionId/restore", min: "editor" },
];

describe("permission matrix", () => {
  let app, tokens = {}, makeDataset, names;

  before(async () => {
    process.env.RATE_LIMIT_MAX = "1000";
    process.env.AI_MOCK = "1";
    app = await buildApp();

    const reg = async (u) =>
      (await request(app).post("/api/auth/register").send({ username: u, password: "password123" })).body;

    /* Unique per run. Fixed names made the suite pass once and fail forever
       after: the second run found pm_owner already registered, got no token
       back, and every authenticated case failed with "No token provided". It
       only looked green here because the sandbox wiped backend/data between
       runs — a real checkout keeps it. routes.test.js already does this. */
    const u = Date.now().toString(36);
    const NAME = { owner: `pm_o_${u}`, editor: `pm_e_${u}`, viewer: `pm_v_${u}`, any: `pm_s_${u}` };

    const owner   = await reg(NAME.owner);
    const editor  = await reg(NAME.editor);
    const viewer  = await reg(NAME.viewer);
    const any     = await reg(NAME.any);
    for (const [k, v] of Object.entries({ owner, editor, viewer, any })) {
      assert.ok(v.accessToken, `could not register ${k} — ${JSON.stringify(v).slice(0, 80)}`);
    }
    names = NAME;
    tokens = { owner: owner.accessToken, editor: editor.accessToken, viewer: viewer.accessToken, any: any.accessToken, public: null };

    /* One dataset PER (route, role) pair. Sharing a single dataset across the
       whole matrix looked cheaper, but DELETE and /permanent are themselves in
       the table — the owner's allowed-delete trashed the dataset and every
       later route then 403'd on a file that no longer existed. Isolation costs
       a few seconds and removes a whole class of false failure. */
    makeDataset = async (label) => {
      const up = await request(app).post("/api/datasets")
        .set("Authorization", `Bearer ${tokens.owner}`)
        .attach("file", Buffer.from("a,b\nx,1\nx,2\ny,3\ny,4\n"), `${label}.csv`);
      const id = up.body.id;
      for (const [user, role] of [[names.editor, "editor"], [names.viewer, "viewer"]]) {
        await request(app).post(`/api/datasets/${id}/share`)
          .set("Authorization", `Bearer ${tokens.owner}`).send({ username: user, role });
      }
      // a tag and a second version, so routes that need one find it
      await request(app).post(`/api/datasets/${id}/tags`)
        .set("Authorization", `Bearer ${tokens.owner}`).send({ tag: "t" });
      return id;
    };
  });

  after(async () => { await closeApp(); });

  for (const route of ROUTES) {
    for (const role of ["public", "any", "viewer", "editor", "owner"]) {
      const shouldAllow = RANK[role] >= RANK[route.min];
      test(`${route.m.toUpperCase()} ${route.path} — ${role} ${shouldAllow ? "allowed" : "refused"}`, async () => {
        const id = await makeDataset(`${route.m}_${role}`);
        const versions = await request(app).get(`/api/datasets/${id}/versions`)
          .set("Authorization", `Bearer ${tokens.owner}`);
        const versionId = versions.body?.[0]?.id ?? "none";
        const url = route.path.replace(":id", id).replace(":versionId", versionId)
          .replace(":userId", names.viewer).replace(":tag", "t");
        let req = request(app)[route.m](url);
        if (tokens[role]) req = req.set("Authorization", `Bearer ${tokens[role]}`);
        const body = JSON.parse(JSON.stringify(route.body ?? {}).replace("__other__", names.any));
        const res = await req.send(body);

        if (shouldAllow) {
          // 4xx that is NOT an authorisation refusal is fine — the route may
          // reject the payload. What must never happen is 401/403.
          assert.ok(![401, 403].includes(res.status),
            `${role} should reach this route, got ${res.status} ${JSON.stringify(res.body).slice(0, 90)}`);
        } else {
          assert.ok([401, 403, 404].includes(res.status),
            `${role} must be refused, got ${res.status} ${JSON.stringify(res.body).slice(0, 90)}`);
        }
      });
    }
  }

  test("every dataset-scoped route in the codebase is classified above", async () => {
    // The point of the whole file: a new route that nobody classified fails
    // here, rather than waiting for someone to notice it has no guard.
    const { readFileSync } = await import("node:fs");
    const declared = new Set(ROUTES.map(r => `${r.m} ${r.path}`));
    const missing = [];

    const scan = (file, prefix, pattern) => {
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(pattern)) {
        const path = prefix + m[2];
        if (!path.includes(":id")) continue;                 // collection routes need no per-dataset role
        if (path.includes("/folders/")) continue;            // :id there is a FOLDER, not a dataset
        const key = `${m[1]} ${path}`;
        if (!declared.has(key)) missing.push(key);
      }
    };
    scan("src/routes/datasets.js", "/api/datasets", /router\.(get|post|patch|delete)\(\s*["']([^"']+)/g);
    for (const f of ["inference", "fixes"]) {
      scan(`src/routes/${f}.js`, "", /app\.(get|post|patch|delete)\(\s*["']([^"']+)/g);
    }

    assert.deepEqual(missing, [],
      `these routes resolve a dataset but are not in the permission matrix:\n  ${missing.join("\n  ")}`);
  });
});

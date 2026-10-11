/**
 * dataLifecycle.test.js — v21.30: what DAB keeps, and for how long, through
 * the REAL app.
 *
 *   • Analyze stores an analysis record and nothing else — no dataset, no IP.
 *     Saving the file is the explicit POST /api/datasets.
 *   • A class roster (the classroom sample) is saved only with the school's
 *     authority: 400 SCHOOL_AUTHORITY_REQUIRED otherwise, on every upload path.
 *   • Deleting a dataset or an analysis leaves no row anywhere that points at
 *     it, and no stored object.
 *   • The retention jobs delete exactly what is past its period.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { buildApp, closeApp, TERMS } from "./testApp.js";
import { query } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import * as storage from "./services/storage.js";
import { runRetention, registerRetentionJob } from "./services/retention.js";

const sample = (name) => fs.readFileSync(new URL(`../sample-data/${name}`, import.meta.url));
const CLASSROOM = sample("classroom.csv");
const CLASSROOM_XLSX = sample("classroom.xlsx");
const SALES = sample("sales.csv");

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

let agent, tok = {}, ids = {};
const u = Date.now().toString(36);
const as = (req, who = "owner") => req.set("Authorization", `Bearer ${tok[who]}`);
const count = async (sql, args) => Number((await query(sql, args))[0].n);

async function register(who) {
  const username = `dl_${who}_${u}`;
  const res = await agent.post("/api/auth/register").send({ username, password: "Test1234!", ...TERMS });
  assert.ok(res.body.accessToken, `could not register ${who}: ${JSON.stringify(res.body).slice(0, 120)}`);
  tok[who] = res.body.accessToken;
  ids[who] = (await query(`SELECT id FROM users WHERE username=$1`, [username]))[0].id;
  return username;
}

async function saveDataset(buf, name, fields = {}, who = "owner") {
  let req = as(agent.post("/api/datasets"), who).attach("file", buf, name);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
}

/* Rows the cascade must reach but no stable route creates (or a later
   release reshapes): written directly, with the columns migrate.js defines. */
const insertChat  = (analysisId, userId) => query(`INSERT INTO chat_messages (id,analysis_id,user_id,role,content,created_at) VALUES ($1,$2,$3,'user','q',$4)`, [randomUUID(), analysisId, userId, daysAgo(0)]);
const insertShare = (analysisId, userId) => query(`INSERT INTO shared_reports (id,analysis_id,user_id,token,created_at) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), analysisId, userId, randomUUID(), daysAgo(0)]);

before(async () => {
  agent = request(await buildApp());
  for (const who of ["owner", "other"]) await register(who);
  ids.otherName = `dl_other_${u}`;
});
after(async () => { await closeApp(); });

describe("opt-in save", () => {
  let savedId;

  test("a signed-in analyze stores the analysis but no dataset and no IP", async () => {
    const before = await count(`SELECT COUNT(*) AS n FROM datasets WHERE owner_id=$1`, [ids.owner]);
    const res = await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv");
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    savedId = res.body.savedId;
    assert.ok(savedId);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM datasets WHERE owner_id=$1`, [ids.owner]), before);
    const [row] = await query(`SELECT ip_address, dataset_id FROM analyses WHERE id=$1`, [savedId]);
    assert.equal(row.ip_address, null);
    assert.equal(row.dataset_id, null);
  });

  test("history list and view never carry ip_address — not even an old row's", async () => {
    await query(`UPDATE analyses SET ip_address='203.0.113.7' WHERE id=$1`, [savedId]);
    const one = await as(agent.get(`/api/history/${savedId}`));
    assert.equal(one.status, 200);
    assert.ok(!("ip_address" in one.body), "view strips it");
    const list = await as(agent.get("/api/history"));
    assert.ok(list.body.length > 0);
    assert.ok(list.body.every((r) => !("ip_address" in r)), "list strips it");
  });

  test("the migration's data fix clears stored IPs, and is safe to re-run", async () => {
    await migrate();
    await migrate();
    assert.equal((await query(`SELECT ip_address FROM analyses WHERE id=$1`, [savedId]))[0].ip_address, null);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM analyses WHERE ip_address IS NOT NULL`), 0);
  });

  test("the explicit save stores the file as a dataset", async () => {
    const res = await saveDataset(SALES, "sales.csv");
    assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
    const [ds] = await query(`SELECT owner_id, school_attested_at FROM datasets WHERE id=$1`, [res.body.id]);
    assert.equal(ds.owner_id, ids.owner);
    assert.equal(ds.school_attested_at, null, "not a roster, nothing attested");
  });
});

/* v21.30 integration of A1's switches with A2's save: the dataset a result
   is saved as covers that analysis, and "Statistics only" survives the save. */
describe("Save dataset links the analysis and keeps a Statistics-only choice", () => {
  const analyze = (fields = {}, who = "owner") => {
    let req = as(agent.post("/api/analyze"), who).attach("file", SALES, "sales.csv");
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  };
  const aiEnabledOf = async (id) => Number((await query(`SELECT ai_enabled FROM datasets WHERE id=$1`, [id]))[0].ai_enabled);
  const linkOf = async (id) => (await query(`SELECT dataset_id FROM analyses WHERE id=$1`, [id]))[0].dataset_id;

  test("an ordinary save links the analysis and leaves AI on", async () => {
    const an = await analyze();
    const res = await saveDataset(SALES, "sales.csv", { analysisId: an.body.savedId });
    assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
    assert.equal(res.body.aiEnabled, true);
    assert.equal(await aiEnabledOf(res.body.id), 1);
    assert.equal(await linkOf(an.body.savedId), res.body.id);
  });

  test("a Statistics-only upload saves a dataset with AI off, and the server enforces it everywhere", async () => {
    const an = await analyze({ noAi: "1" });
    assert.equal(an.body.aiDisabled, true);
    const res = await saveDataset(SALES, "sales.csv", { analysisId: an.body.savedId, noAi: "1" });
    assert.equal(res.status, 201);
    assert.equal(res.body.aiEnabled, false);
    const ds = res.body.id;
    assert.equal(await aiEnabledOf(ds), 0);
    assert.equal(await linkOf(an.body.savedId), ds);

    const chat = await as(agent.post(`/api/analyses/${an.body.savedId}/chat`)).send({ message: "x" });
    assert.equal(chat.body.code, "AI_DISABLED");
    const agentRun = await as(agent.post(`/api/analyses/${an.body.savedId}/agent`)).send({ question: "x" });
    assert.equal(agentRun.body.code, "AI_DISABLED");
    const edit = await as(agent.post(`/api/fixes/${ds}/ai-edit`)).send({ instruction: "trim", confirmSend: true });
    assert.equal(edit.status, 403);
    assert.equal(edit.body.code, "AI_DISABLED");
    const sug = await as(agent.post(`/api/fixes/${ds}/suggest`)).send({});
    assert.equal(sug.status, 200);
    assert.equal(sug.body.source, "rules", "rule-based suggestions, no AI call");
    const re = await as(agent.post(`/api/datasets/${ds}/analyze`)).send({});
    assert.equal(re.body.aiDisabled, true, "re-analysing the saved copy stays statistics-only");
    assert.equal(re.body.analysis, null);
  });

  test("the server reads the choice off the analysis even when the client omits noAi", async () => {
    const an = await analyze({ noAi: "1" });
    const res = await saveDataset(SALES, "sales.csv", { analysisId: an.body.savedId });
    assert.equal(res.status, 201);
    assert.equal(await aiEnabledOf(res.body.id), 0);
  });

  test("someone else's analysis cannot be named: 404, and nothing is stored", async () => {
    const theirs = await analyze({}, "other");
    const before = await count(`SELECT COUNT(*) AS n FROM datasets WHERE owner_id=$1`, [ids.owner]);
    const res = await saveDataset(SALES, "sales.csv", { analysisId: theirs.body.savedId });
    assert.equal(res.status, 404);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM datasets WHERE owner_id=$1`, [ids.owner]), before);
    assert.equal(await linkOf(theirs.body.savedId), null);
  });
});

/* v21.30: two ids the client chooses, and a legacy row nobody owns. */
describe("access checks on linked records", () => {
  test("POST /api/analyze refuses a datasetId or workspaceId the caller cannot reach", async () => {
    const theirs = (await saveDataset(SALES, "sales.csv", {}, "other")).body.id;
    const ws = (await as(agent.post("/api/workspaces"), "other").send({ name: `dl_ws_${u}` })).body.id;
    assert.ok(theirs && ws);
    const before = await count(`SELECT COUNT(*) AS n FROM analyses WHERE user_id=$1`, [ids.owner]);
    const byDs = await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv").field("datasetId", theirs);
    assert.equal(byDs.status, 403);
    const byWs = await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv").field("workspaceId", ws);
    assert.equal(byWs.status, 403);
    const anon = await agent.post("/api/analyze").attach("file", SALES, "sales.csv").field("datasetId", theirs);
    assert.equal(anon.status, 403, "signed out, no dataset is reachable");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM analyses WHERE user_id=$1`, [ids.owner]), before, "nothing saved");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM analyses WHERE dataset_id=$1`, [theirs]), 0);

    const mine = (await saveDataset(SALES, "sales.csv")).body.id;
    const ok = await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv").field("datasetId", mine);
    assert.equal(ok.status, 200);
    assert.equal((await query(`SELECT dataset_id FROM analyses WHERE id=$1`, [ok.body.savedId]))[0].dataset_id, mine);
  });

  test("a legacy analysis with no owner is not open to every signed-in user", async () => {
    const id = randomUUID();
    await query(`INSERT INTO analyses (id,user_id,file_name,file_type,total_rows,total_cols,prompt,analysis,stats_json,created_at) VALUES ($1,NULL,'legacy.csv','csv',1,1,'q','legacy text','{}',$2)`, [id, daysAgo(1)]);
    assert.equal((await as(agent.get(`/api/history/${id}`))).status, 404);
    assert.equal((await as(agent.post(`/api/analyses/${id}/share`)).send({})).status, 404);
    assert.equal((await as(agent.post(`/api/analyses/${id}/chat`)).send({ message: "x" })).status, 404);
    assert.equal((await as(agent.get(`/api/analyses/${id}/chat`))).status, 404);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM shared_reports WHERE analysis_id=$1`, [id]), 0);
    await query(`DELETE FROM analyses WHERE id=$1`, [id]);
  });
});

describe("school attestation (SCHOOL_AUTHORITY_REQUIRED)", () => {
  test("analyze shows a class report for the classroom sample — the dialog's cue", async () => {
    const res = await as(agent.post("/api/analyze")).attach("file", CLASSROOM, "classroom.csv");
    assert.equal(res.status, 200);
    assert.ok(res.body.classReport, "classroom.csv has a class report");
  });

  test("saving a roster without the attestation is refused, and nothing is kept", async () => {
    const before = await count(`SELECT COUNT(*) AS n FROM datasets WHERE owner_id=$1`, [ids.owner]);
    for (const [buf, name] of [[CLASSROOM, "classroom.csv"], [CLASSROOM_XLSX, "classroom.xlsx"]]) {
      const res = await saveDataset(buf, name);
      assert.equal(res.status, 400, name);
      assert.equal(res.body.code, "SCHOOL_AUTHORITY_REQUIRED", name);
    }
    const no = await saveDataset(CLASSROOM, "classroom.csv", { schoolAuthority: "0" });
    assert.equal(no.body.code, "SCHOOL_AUTHORITY_REQUIRED");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM datasets WHERE owner_id=$1`, [ids.owner]), before);
  });

  test("with schoolAuthority=1 it is saved and the time recorded", async () => {
    const res = await saveDataset(CLASSROOM, "classroom.csv", { schoolAuthority: "1" });
    assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
    const [ds] = await query(`SELECT school_attested_at FROM datasets WHERE id=$1`, [res.body.id]);
    assert.match(ds.school_attested_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("multi-file upload: one roster among the files needs it too", async () => {
    const multi = (fields = {}) => {
      let req = as(agent.post("/api/datasets/multi"))
        .attach("files", SALES, "sales.csv").attach("files", CLASSROOM, "classroom.csv");
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    };
    const refused = await multi();
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "SCHOOL_AUTHORITY_REQUIRED");
    const ok = await multi({ schoolAuthority: "true" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 200));
    assert.equal(ok.body.fileCount, 2);
  });

  test("a roster added as a new version needs it, and refreshes the attestation", async () => {
    const ds = (await saveDataset(SALES, "sales.csv")).body.id;
    const add = (fields = {}) => {
      let req = as(agent.post(`/api/datasets/${ds}/versions`)).attach("file", CLASSROOM, "classroom.csv");
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    };
    const refused = await add();
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "SCHOOL_AUTHORITY_REQUIRED");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM dataset_versions WHERE dataset_id=$1`, [ds]), 1, "no version written");
    const ok = await add({ schoolAuthority: "1" });
    assert.equal(ok.status, 201);
    const [row] = await query(`SELECT school_attested_at FROM datasets WHERE id=$1`, [ds]);
    assert.ok(row.school_attested_at);
  });
});

/** Every row, in every table, that could still point at this dataset or these analyses. */
async function leftovers(datasetId, analysisIds, commentIds, keys) {
  const found = {};
  const add = (k, n) => { if (n) found[k] = n; };
  add("datasets", await count(`SELECT COUNT(*) AS n FROM datasets WHERE id=$1`, [datasetId]));
  for (const t of ["dataset_versions", "dataset_tags", "dataset_permissions", "comments", "scheduled_reports", "dashboard_widgets", "analyses"]) {
    add(t, await count(`SELECT COUNT(*) AS n FROM ${t} WHERE dataset_id=$1`, [datasetId]));
  }
  add("activity_feed", await count(`SELECT COUNT(*) AS n FROM activity_feed WHERE dataset_id=$1 OR target_id=$1`, [datasetId]));
  add("notifications", await count(`SELECT COUNT(*) AS n FROM notifications WHERE link=$1`, [`/datasets/${datasetId}`]));
  for (const a of analysisIds) {
    add("analyses", await count(`SELECT COUNT(*) AS n FROM analyses WHERE id=$1`, [a]));
    for (const t of ["chat_messages", "shared_reports", "comments", "dashboard_widgets"]) {
      add(t, await count(`SELECT COUNT(*) AS n FROM ${t} WHERE analysis_id=$1`, [a]));
    }
    add("notifications", await count(`SELECT COUNT(*) AS n FROM notifications WHERE link=$1`, [`/analysis/${a}`]));
  }
  for (const c of commentIds) {
    add("comments", await count(`SELECT COUNT(*) AS n FROM comments WHERE id=$1`, [c]));
    add("mentions", await count(`SELECT COUNT(*) AS n FROM mentions WHERE comment_id=$1`, [c]));
  }
  for (const k of keys) if (await storage.exists(k)) found.storage = (found.storage || 0) + 1;
  return found;
}

/** A dataset with something in every table that references it. */
async function richDataset() {
  const ds = (await saveDataset(SALES, "sales.csv")).body.id;
  await as(agent.post(`/api/datasets/${ds}/share`)).send({ username: ids.otherName, role: "viewer" });
  await as(agent.post(`/api/datasets/${ds}/tags`)).send({ tag: "lifecycle" });
  await as(agent.post(`/api/datasets/${ds}/versions`)).attach("file", SALES, "sales-v2.csv");
  const analysis = (await as(agent.post(`/api/datasets/${ds}/analyze`)).send({ question: "x" })).body.savedId;
  assert.ok(analysis, "dataset analyze saved an analysis");
  await insertChat(analysis, ids.owner);
  await insertShare(analysis, ids.owner);
  const c1 = (await as(agent.post("/api/collab/comments")).send({ datasetId: ds, content: `hi @${ids.otherName}` })).body.id;
  const c2 = (await as(agent.post("/api/collab/comments"), "other").send({ datasetId: ds, parentId: c1, content: "reply" })).body.id;
  const c3 = (await as(agent.post("/api/collab/comments")).send({ analysisId: analysis, content: `see @${ids.otherName}` })).body.id;
  await query(`INSERT INTO scheduled_reports (id,user_id,name,dataset_id,prompt,cron_expr,recipients,created_at) VALUES ($1,$2,'s',$3,'p','0 8 * * 1','[]',$4)`, [randomUUID(), ids.owner, ds, daysAgo(0)]);
  for (const [dsId, aId] of [[ds, null], [null, analysis]]) {
    await query(`INSERT INTO dashboard_widgets (id,dashboard_id,analysis_id,dataset_id,widget_type,config,position,created_at) VALUES ($1,$2,$3,$4,'chart','{}','{}',$5)`, [randomUUID(), randomUUID(), aId, dsId, daysAgo(0)]);
  }
  const keys = (await query(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1`, [ds])).map((r) => r.storage_key);
  assert.equal(keys.length, 2);
  for (const k of keys) assert.ok(await storage.exists(k));
  const before = await leftovers(ds, [analysis], [c1, c2, c3], keys);
  for (const t of ["dataset_versions", "dataset_tags", "dataset_permissions", "comments", "mentions", "activity_feed", "notifications", "chat_messages", "shared_reports", "scheduled_reports", "dashboard_widgets", "analyses", "storage"]) {
    assert.ok(before[t], `fixture has ${t}`);
  }
  return { ds, analysis, comments: [c1, c2, c3], keys };
}

describe("cascade deletion leaves no orphans", () => {
  test("permanent delete removes the dataset and everything tied to it", async () => {
    const f = await richDataset();
    assert.equal((await as(agent.delete(`/api/datasets/${f.ds}`))).status, 200);
    assert.equal((await as(agent.delete(`/api/datasets/${f.ds}/permanent`))).status, 200);
    assert.deepEqual(await leftovers(f.ds, [f.analysis], f.comments, f.keys), {});
    assert.equal((await as(agent.get(`/api/history/${f.analysis}`))).status, 404);
  });

  test("empty trash runs the same cascade", async () => {
    const f = await richDataset();
    await as(agent.delete(`/api/datasets/${f.ds}`));
    const res = await as(agent.post("/api/datasets/trash/empty"));
    assert.equal(res.status, 200);
    assert.ok(res.body.deletedCount >= 1);
    assert.deepEqual(await leftovers(f.ds, [f.analysis], f.comments, f.keys), {});
  });

  test("history delete takes the analysis's chat, share links and comments with it", async () => {
    const a = (await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv")).body.savedId;
    await insertChat(a, ids.owner);
    await insertShare(a, ids.owner);
    const c = (await as(agent.post("/api/collab/comments")).send({ analysisId: a, content: `@${ids.otherName} look` })).body.id;
    assert.equal((await as(agent.get(`/api/history/${a}`))).status, 200);   // cached now
    assert.equal((await as(agent.delete(`/api/history/${a}`))).status, 200);
    assert.deepEqual(await leftovers(randomUUID(), [a], [c], []), {});
    assert.equal((await as(agent.get(`/api/history/${a}`))).status, 404, "not served from cache");
  });

  test("history delete of someone else's analysis does nothing", async () => {
    const a = (await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv")).body.savedId;
    await insertChat(a, ids.owner);
    await as(agent.delete(`/api/history/${a}`), "other");
    assert.equal(await count(`SELECT COUNT(*) AS n FROM analyses WHERE id=$1`, [a]), 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM chat_messages WHERE analysis_id=$1`, [a]), 1);
  });
});

describe("retention jobs delete exactly what is past its period", () => {
  const OLD = daysAgo(400);
  const backdate = async (ds, when, { lastUsed = when } = {}) => {
    await query(`UPDATE datasets SET created_at=$1, updated_at=$1, last_used_at=$2 WHERE id=$3`, [when, lastUsed, ds]);
    await query(`UPDATE dataset_versions SET created_at=$1 WHERE dataset_id=$2`, [when, ds]);
    await query(`UPDATE activity_feed SET created_at=$1 WHERE dataset_id=$2`, [when, ds]);
  };
  const exists = async (table, id) => (await count(`SELECT COUNT(*) AS n FROM ${table} WHERE id=$1`, [id])) === 1;
  const fx = {};

  before(async () => {
    // Trash: 40 days in Trash → purged; 5 days → kept.
    fx.trashOld = (await saveDataset(SALES, "t1.csv")).body.id;
    fx.trashNew = (await saveDataset(SALES, "t2.csv")).body.id;
    for (const d of [fx.trashOld, fx.trashNew]) await as(agent.delete(`/api/datasets/${d}`));
    await query(`UPDATE datasets SET trashed_at=$1 WHERE id=$2`, [daysAgo(40), fx.trashOld]);
    await query(`UPDATE datasets SET trashed_at=$1 WHERE id=$2`, [daysAgo(5), fx.trashNew]);
    fx.trashKeys = (await query(`SELECT storage_key FROM dataset_versions WHERE dataset_id=$1`, [fx.trashOld])).map((r) => r.storage_key);

    // Inactive datasets: everything 400 days old → deleted; the same but
    // opened last month, or analysed last month → kept.
    fx.idle = (await saveDataset(SALES, "idle.csv")).body.id;
    fx.opened = (await saveDataset(SALES, "opened.csv")).body.id;
    fx.analysed = (await saveDataset(SALES, "analysed.csv")).body.id;
    await backdate(fx.idle, OLD);
    await backdate(fx.opened, OLD, { lastUsed: daysAgo(30) });
    await backdate(fx.analysed, OLD);
    fx.recentAnalysis = (await as(agent.post(`/api/datasets/${fx.analysed}/analyze`)).send({})).body.savedId;
    await backdate(fx.analysed, OLD);   // analyze touched last_used_at; the recent ANALYSIS alone must keep it
    fx.idleAnalysis = (await query(`INSERT INTO analyses (id,user_id,dataset_id,file_name,file_type,total_rows,total_cols,prompt,analysis,created_at) VALUES ($1,$2,$3,'f','csv',1,1,'p','a',$4) RETURNING id`, [randomUUID(), ids.owner, fx.idle, OLD]))[0].id;

    // Analyses: 400 days old (with chat + share) → deleted; 300 days → kept.
    fx.oldAnalysis = (await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv")).body.savedId;
    fx.newAnalysis = (await as(agent.post("/api/analyze")).attach("file", SALES, "sales.csv")).body.savedId;
    await insertChat(fx.oldAnalysis, ids.owner);
    await insertShare(fx.oldAnalysis, ids.owner);
    await query(`UPDATE analyses SET created_at=$1 WHERE id=$2`, [OLD, fx.oldAnalysis]);
    await query(`UPDATE analyses SET created_at=$1 WHERE id=$2`, [daysAgo(300), fx.newAnalysis]);

    // Row-age tables, one row either side of each limit.
    const row = async (sql, when) => { const id = randomUUID(); await query(sql, [id, when]); return id; };
    const tele = `INSERT INTO upload_metadata (id,source,created_at) VALUES ($1,'analyze',$2)`;
    fx.teleOld = await row(tele, daysAgo(400)); fx.teleNew = await row(tele, daysAgo(380));
    const audit = `INSERT INTO audit_log (id,action,created_at) VALUES ($1,'login',$2)`;
    fx.auditOld = await row(audit, daysAgo(370)); fx.auditNew = await row(audit, daysAgo(300));
    const act = `INSERT INTO activity_feed (id,user_id,action,created_at) VALUES ($1,'u','x',$2)`;
    fx.actOld = await row(act, daysAgo(370)); fx.actNew = await row(act, daysAgo(300));
    const note = `INSERT INTO notifications (id,user_id,type,title,created_at) VALUES ($1,'u','t','t',$2)`;
    fx.noteOld = await row(note, daysAgo(370)); fx.noteNew = await row(note, daysAgo(300));

    fx.result = await runRetention();
  });

  test("Trash: purged after 30 days, with its stored file", async () => {
    assert.equal(await exists("datasets", fx.trashOld), false);
    assert.equal(await exists("datasets", fx.trashNew), true);
    for (const k of fx.trashKeys) assert.equal(await storage.exists(k), false);
    assert.ok(fx.result.trash >= 1);
  });

  test("saved datasets: deleted after 365 days without activity, with their analyses", async () => {
    assert.equal(await exists("datasets", fx.idle), false);
    assert.equal(await exists("analyses", fx.idleAnalysis), false);
    assert.equal(await exists("datasets", fx.opened), true, "opened recently");
    assert.equal(await exists("datasets", fx.analysed), true, "analysed recently");
    assert.equal(await exists("analyses", fx.recentAnalysis), true);
  });

  test("analyses: deleted 365 days after creation, with chat and share links", async () => {
    assert.equal(await exists("analyses", fx.oldAnalysis), false);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM chat_messages WHERE analysis_id=$1`, [fx.oldAnalysis]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM shared_reports WHERE analysis_id=$1`, [fx.oldAnalysis]), 0);
    assert.equal(await exists("analyses", fx.newAnalysis), true);
  });

  test("telemetry 395 days, audit log, activity feed and notifications 365 days", async () => {
    assert.equal(await exists("upload_metadata", fx.teleOld), false);
    assert.equal(await exists("upload_metadata", fx.teleNew), true);
    assert.equal(await exists("audit_log", fx.auditOld), false);
    assert.equal(await exists("audit_log", fx.auditNew), true);
    assert.equal(await exists("activity_feed", fx.actOld), false);
    assert.equal(await exists("activity_feed", fx.actNew), true);
    assert.equal(await exists("notifications", fx.noteOld), false);
    assert.equal(await exists("notifications", fx.noteNew), true);
  });

  test("the periods come from the environment", async () => {
    const d = (await saveDataset(SALES, "env.csv")).body.id;
    await as(agent.delete(`/api/datasets/${d}`));
    await query(`UPDATE datasets SET trashed_at=$1 WHERE id=$2`, [daysAgo(10), d]);
    await runRetention({ env: { TRASH_RETENTION_DAYS: "abc" } });   // invalid → the 30-day default
    assert.equal(await exists("datasets", d), true);
    await runRetention({ env: { TRASH_RETENTION_DAYS: "7" } });
    assert.equal(await exists("datasets", d), false);
  });

  test("a failing job is reported and the others still run", async () => {
    registerRetentionJob("broken-for-test", async () => { throw new Error("boom"); });
    const id = randomUUID();
    await query(`INSERT INTO audit_log (id,action,created_at) VALUES ($1,'login',$2)`, [id, daysAgo(370)]);
    const out = await runRetention();
    assert.equal(out["broken-for-test"], null);
    assert.equal(await exists("audit_log", id), false);
    registerRetentionJob("broken-for-test", async () => 0);
  });
});

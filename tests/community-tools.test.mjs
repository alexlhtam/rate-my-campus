import {loadFreebie} from './freebies/load.mjs';
const {publicFreebie}=await loadFreebie('lib/freebies/publication.ts');
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import * as validation from "../lib/community-validation.ts";

async function loadTs(name, rewrites = []) {
  const source = await fs.readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  for (const [pattern, replacement] of rewrites) code = code.replace(pattern, replacement);
  const url = new URL(`.community-tools-${name}.mjs`, import.meta.url);
  await fs.writeFile(url, code);
  try { return await import(url.href); } finally { await fs.unlink(url); }
}
const { createDatabase, isUniqueViolation } = await loadTs("db");
const features = await loadTs("community-features");
const pg = new PGlite();
for (const file of (await fs.readdir(new URL("../supabase/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort()) {
  await pg.exec((await fs.readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).split("-- Private bucket")[0]);
}
const runner = (on) => async (query, params) => (await on.query(query, params)).rows;
const db = createDatabase(runner(pg), (work) => pg.transaction((tx) => work(runner(tx))));
let user = { userId: "alice", email: "alice@ucl.ac.uk" };
let verdict = { approved: true, reasons: [] };
let serviceFailure = null;
let moderationHook = null;
let photoVerdict = { approved: true, reasons: [] };
let photoChecks = 0;
globalThis.__communityTools = { publicFreebie, db, isUniqueViolation, validation, features,
  currentUser: async () => user, runtimeEnv: async () => ({ ADMIN_USER_IDS: "moderator", ANTHROPIC_API_KEY: "test" }),
  moderateContent: async () => { if (moderationHook) await moderationHook(); if (serviceFailure) throw serviceFailure; return verdict; }, moderatePhoto: async () => { photoChecks++; return photoVerdict; },
  photoStorage: () => ({ download: async () => ({ data: new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])]) }), remove: async () => ({ error: null }) }),
  places: [{ id: "ucl-test", category: "building" }, { id: "study-test", category: "study" }],
};
const { communityRoute } = await loadTs("community-server", [
  [/import .*publicFreebie.*from .*freebies\/publication.*;/, "const {publicFreebie}=globalThis.__communityTools;"],
  [/import \{[^}]+\} from "\.\/db";/, "const {db, isUniqueViolation} = globalThis.__communityTools; const getDatabase = () => db;"],
  [/import \{[^}]+\} from "\.\/integrations";/, "const {moderateContent, moderatePhoto, runtimeEnv} = globalThis.__communityTools;"],
  [/import \{([^}]+)\} from "\.\/community-validation";/, "const {$1} = globalThis.__communityTools.validation;"],
  [/export \{ HttpError \} from "\.\/community-validation";/, ""],
  [/import \{([^}]+)\} from "\.\/community-features";/, "const {$1} = globalThis.__communityTools.features;"],
  [/import \{ places \} from "\.\/data";/, "const {places} = globalThis.__communityTools;"],
  [/import \{[^}]+\} from "\.\/supabase";/, "const { currentUser, photoStorage } = globalThis.__communityTools; const authConfigured = () => true; const authClient = async () => null; const adminClient = () => null;"],
]);

async function call(path, data, method = data ? "POST" : "GET") {
  const request = new Request(`https://campus.example/api/community/${path}`, { method, headers: { origin: "https://campus.example", "content-type": "application/json", "x-real-ip": "192.0.2.10" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const response = await communityRoute(request, path.split("?")[0].split("/"));
  return { status: response.status, body: await response.json() };
}
async function review(id, owner, place = "ucl-test", score = 4, status = "approved") {
  await db.prepare("INSERT INTO reviews (id,user_id,place_id,rating,criteria,tags,text,term,recommend,status,created_at) VALUES (?,?,?,?,'{\"wifi\":4}','[\"Great Wi-Fi\"]','Useful','Autumn 2026',1,?,?)").bind(id, owner, place, score, status, Date.now()).run();
}
async function post(id, owner, expires = Date.now() + 60000, status = "approved") {
  await db.prepare("INSERT INTO posts (id,user_id,type,title,description,location,lat,lng,expires_at,dietary,status,created_at) VALUES (?,?,'food','Sandwiches','Sealed','Quad',51.52,-0.13,?,'[]',?,?)").bind(id, owner, expires, status, Date.now()).run();
}
async function due() {
  await db.prepare("UPDATE moderation_retries SET next_attempt_at = 0, lease_until = NULL").run();
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'moderation-drain:%'").run();
}

test("community tools enforce ownership, moderation, private requests and complete aggregates", async (t) => {
  await t.test("all approved ratings contribute beyond the feed limit; pending scores stay private", async () => {
    await pg.exec("INSERT INTO reviews (id,user_id,place_id,rating,criteria,tags,text,term,recommend,status,created_at) SELECT 'seed-' || n,'seed-' || n,'ucl-test',4,'{\"wifi\":4}','[\"Great Wi-Fi\"]','','Autumn 2026',1,'approved',n FROM generate_series(1,505) AS n");
    await review("private-review", "bob", "ucl-test", 1, "pending");
    const state = await call("state");
    assert.equal(state.status, 200);
    assert.equal(state.body.reviews.length, 500);
    assert.equal(state.body.placeSummaries[0].count, 505);
    assert.equal(state.body.placeSummaries[0].rating, 4);
    assert.equal(state.body.placeSummaries[0].tags[0].count, 505);
    const page = await call("place?placeId=ucl-test&kind=reviews&offset=490");
    assert.equal(page.body.rows.length, 15);
    assert.equal(page.body.total, 505);
    assert.equal(page.body.nextOffset, null);
    assert.ok(page.body.rows.every((row) => !row.user_id));
  });
  await t.test("review update preserves the review reference and its votes", async () => {
    await review("alice-review", "alice", "study-test");
    await db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES ('vote','bob','alice-review','helpful',1)").run();
    const result = await call("action", { action: "review", placeId: "study-test", rating: 5, criteria: { wifi: 5 }, text: "Still useful", tags: ["Quiet"], recommend: true, term: "Autumn 2026" });
    assert.equal(result.status, 201); assert.equal(result.body.review.id, "alice-review");
    assert.equal((await db.prepare("SELECT count(*) AS count FROM votes WHERE target_id = 'alice-review'").first()).count, 1);
  });
  await t.test("case variants of a tag count once per review", async () => {
    await db.prepare("UPDATE reviews SET tags = ? WHERE id = 'seed-1'").bind(JSON.stringify(["Great Wi-Fi", "great wi-fi", "GREAT WI-FI"])).run();
    const summaries = await features.placeSummaries(db);
    const place = summaries.find((row) => row.placeId === "ucl-test");
    assert.equal(place.tags.find((item) => item.tag.toLowerCase() === "great wi-fi").count, 505);
    assert.equal(place.count, 505);
  });
  await t.test("owners can see expired and pending content but cannot delete another student's contribution", async () => {
    await post("expired", "alice", 1); await post("pending", "alice", Date.now() + 60000, "pending");
    assert.equal((await call("action", { action: "delete-own", kind: "review", targetId: "private-review" })).status, 404);
    const own = await call("contributions");
    assert.equal(own.body.posts.length, 2);
    assert.ok(own.body.posts.some((item) => item.status === "pending"));
    assert.ok(own.body.posts.some((item) => Date.parse(item.expiresAt) < Date.now()));
  });
  await t.test("collection text is moderated and zero portions closes an alert", async () => {
    await post("active", "alice");
    verdict = { approved: false, reasons: ["Please reword this."] };
    const result = await call("action", { action: "update-post", targetId: "active", collectionInstructions: "Ask the committee at the desk", portionsRemaining: 4 });
    assert.equal(result.body.post.status, "pending"); assert.equal(result.body.post.portionsRemaining, 4);
    verdict = { approved: true, reasons: [] };
    const closed = await call("action", { action: "update-post", targetId: "active", collectionInstructions: "All collected", portionsRemaining: 0 });
    assert.ok(Date.parse(closed.body.post.expiresAt) <= Date.now());
  });
  await t.test("active title and location duplicates are caught across accounts", async () => {
    await post("existing-active", "bob");
    const result = await call("action", { action: "post", type: "food", title: "sandwiches", description: "Sealed", location: "quad", lat: 51.52, lng: -0.13, expiresAt: Date.now() + 60000, dietary: [] });
    assert.equal(result.status, 409);
  });
  await t.test("discussion pagination counts approved replies, and old uploads cannot race retention", async () => {
    await db.prepare("INSERT INTO threads (id,user_id,place_id,title,text,status,created_at) VALUES ('thread','alice','ucl-test','A useful question','Where is the entrance','approved',1)").run();
    await db.prepare("INSERT INTO replies (id,user_id,thread_id,text,status,created_at) VALUES ('reply-public','bob','thread','Public answer','approved',1), ('reply-private','carol','thread','Unreviewed answer','pending',1)").run();
    const page = await call("place?placeId=ucl-test&kind=threads");
    assert.equal(page.body.rows[0].replies, 1);
    await db.prepare("INSERT INTO photos (key,user_id,mime,bytes,created_at) VALUES ('photos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg','alice','image/jpeg',100,?)").bind(Date.now() - 6.5 * 86400000).run();
    const submission = await call("action", { action: "post", type: "deal", title: "A different deal", description: "Shop offer", location: "Other shop", lat: 51.52, lng: -0.13, expiresAt: Date.now() + 60000, dietary: [], photoKey: "photos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg" });
    assert.equal(submission.status, 400);
    assert.match(submission.body.error, /recent photo/);
  });
  await t.test("public takedown is available without UCL sign-in; correction and private queue remain protected", async () => {
    user = null;
    const result = await call("request", { kind: "takedown", targetId: "private-review", contact: "person@example.com", reason: "This contribution contains private information." });
    assert.equal(result.status, 201); assert.ok(result.body.reference);
    assert.equal((await call("request", { kind: "correction", targetId: "ucl-test", reason: "The entrance has moved." })).status, 403);
    assert.equal((await call("moderation")).status, 403);
    assert.equal(JSON.stringify((await call("state")).body).includes("person@example.com"), false);
    user = { userId: "moderator", email: "moderator@ucl.ac.uk" };
    const queue = await call("moderation");
    assert.equal(queue.body.requests[0].contact, "person@example.com");
    assert.equal((await call("moderation", { decision: "resolve-request", requestId: result.body.reference, reason: "Reviewed and handled privately." })).status, 200);
    assert.equal((await call("moderation")).body.requests.length, 0);
  });
  await t.test("partial preferences updates do not clear collections or follows", async () => {
    user = { userId: "alice", email: "alice@ucl.ac.uk" };
    await call("preferences", { collections: [{ id: "saved", name: "Revision", placeIds: ["study-test"] }] });
    const followed = await call("preferences", { follows: ["ucl-test"] });
    assert.equal(followed.body.collections[0].name, "Revision");
    const saved = await call("preferences", { collections: [] });
    assert.deepEqual(saved.body.follows, ["ucl-test"]);
    assert.equal((await call("preferences", { follows: ["invented-place"] })).status, 404);
  });
  await t.test("newly approved drafts and revisions stay unread after mark-all-read, with bounded private history", async () => {
    await call("preferences", { follows: ["study-test"] });
    await review("late-approval", "inbox-author", "study-test", 4, "pending");
    await db.prepare("UPDATE reviews SET created_at=1 WHERE id='late-approval'").run();
    assert.equal((await call("inbox")).body.entries.some((item) => item.id === "late-approval"), false);
    assert.equal((await call("inbox/read", {})).status, 200);
    await db.prepare("UPDATE reviews SET status='approved' WHERE id='late-approval'").run();
    assert.equal((await call("inbox")).body.entries.find((item) => item.id === "late-approval").read, false);
    await call("inbox/read", {});
    assert.equal((await call("inbox")).body.entries.find((item) => item.id === "late-approval").read, true);
    await db.prepare("UPDATE reviews SET status='pending', moderation_revision=moderation_revision+1 WHERE id='late-approval'").run();
    await call("inbox/read", {});
    await db.prepare("UPDATE reviews SET status='approved' WHERE id='late-approval'").run();
    assert.equal((await call("inbox")).body.entries.find((item) => item.id === "late-approval").read, false);
    await db.prepare("UPDATE community_preferences SET inbox_seen_ids=? WHERE user_id='alice'").bind(JSON.stringify(Array.from({ length: 600 }, (_, i) => `review:old-${i}:0`))).run();
    await call("inbox/read", {});
    const preference = await db.prepare("SELECT follows, inbox_seen_ids FROM community_preferences WHERE user_id='alice'").first();
    assert.ok(JSON.parse(preference.inbox_seen_ids).length <= 500);
    assert.ok(JSON.parse(preference.inbox_seen_ids).includes("review:late-approval:1"));
    assert.deepEqual(JSON.parse(preference.follows), ["study-test"]);
    assert.equal(JSON.stringify((await call("state")).body).includes("inbox_seen_ids"), false);
    const exported = await call("account/export");
    assert.ok(exported.body.account.community_preferences[0].inbox_seen_ids);
  });
  await t.test("provider interruption creates a durable retry that recovers without publishing on failure", async () => {
    serviceFailure = { status: 502 };
    const submitted = await call("action", { action: "review", placeId: "ucl-test", rating: 4, criteria: { wifi: 4 }, text: "Useful building", tags: [], recommend: true, term: "Autumn 2026" });
    assert.equal(submitted.body.review.status, "pending");
    const id = submitted.body.review.id;
    assert.ok(await db.prepare("SELECT target_id FROM moderation_retries WHERE target_id = ?").bind(id).first());
    serviceFailure = null; await due();
    assert.equal((await call("state")).status, 200);
    assert.equal((await db.prepare("SELECT status FROM reviews WHERE id = ?").bind(id).first()).status, "approved");
    assert.equal(await db.prepare("SELECT target_id FROM moderation_retries WHERE target_id = ?").bind(id).first(), null);
  });
  await t.test("a concurrent edit or moderator hide cannot be overwritten by a retry", async () => {
    await review("race", "race-user", "ucl-test", 4, "pending");
    await db.prepare("INSERT INTO moderation_retries (target_id,kind,revision,next_attempt_at) VALUES ('race','review',0,0)").run();
    moderationHook = async () => { moderationHook = null; await db.prepare("UPDATE reviews SET status='hidden', moderation_revision=moderation_revision+1, moderation_reason='Moderator decision' WHERE id='race'").run(); };
    await due(); await call("state");
    const row = await db.prepare("SELECT status, moderation_reason FROM reviews WHERE id='race'").first();
    assert.equal(row.status, "hidden"); assert.equal(row.moderation_reason, "Moderator decision");
    await db.prepare("UPDATE reviews SET status='pending', moderation_revision=2 WHERE id='race'").run();
    await db.prepare("INSERT INTO moderation_retries (target_id,kind,revision,next_attempt_at) VALUES ('race','review',2,0)").run();
    moderationHook = async () => { moderationHook = null; await db.prepare("UPDATE reviews SET text='New text', moderation_revision=3 WHERE id='race'").run(); };
    await due(); await call("state");
    assert.equal((await db.prepare("SELECT status FROM reviews WHERE id='race'").first()).status, "pending");
  });
  await t.test("photo checks run again during recovery and negative verdicts are not retried", async () => {
    await post("photo-retry", "alice", Date.now() + 60000, "pending");
    await db.prepare("UPDATE posts SET photo_key='photos/a.jpg' WHERE id='photo-retry'").run();
    await db.prepare("INSERT INTO moderation_retries (target_id,kind,revision,next_attempt_at) VALUES ('photo-retry','post',0,0)").run();
    photoVerdict = { approved: false, reasons: ["Private details in photo"] }; photoChecks = 0;
    await due(); await call("state");
    assert.equal(photoChecks, 1);
    assert.equal((await db.prepare("SELECT status FROM posts WHERE id='photo-retry'").first()).status, "pending");
    assert.equal(await db.prepare("SELECT target_id FROM moderation_retries WHERE target_id='photo-retry'").first(), null);
    photoVerdict = { approved: true, reasons: [] };
  });
  await t.test("durable retries stop after three failures and leave content private", async () => {
    await review("retry-limit", "retry-user", "ucl-test", 4, "pending");
    await db.prepare("INSERT INTO moderation_retries (target_id,kind,revision,next_attempt_at) VALUES ('retry-limit','review',0,0)").run();
    serviceFailure = { status: 502 };
    for (let i = 1; i <= 3; i++) { await due(); await call("state"); const job = await db.prepare("SELECT attempts FROM moderation_retries WHERE target_id='retry-limit'").first(); if (i < 3) assert.equal(job.attempts, i); else assert.equal(job, null); }
    assert.equal((await db.prepare("SELECT status FROM reviews WHERE id='retry-limit'").first()).status, "pending");
    serviceFailure = null;
  });
  await t.test("retention preserves reported and pending pins and clears eligible old content", async () => {
    const old = Date.now() - 40 * 86400000;
    await post("old-clean", "alice", old); await post("old-held", "alice", old); await post("old-pending", "alice", old, "pending");
    await db.prepare("INSERT INTO reports (id,user_id,target_id,reason,created_at) VALUES ('hold','bob','old-held','Needs review',1)").run();
    await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'maintenance:%'").run();
    await call("action", { action: "close-post", targetId: "pending" });
    assert.equal(await db.prepare("SELECT id FROM posts WHERE id='old-clean'").first(), null);
    assert.ok(await db.prepare("SELECT id FROM posts WHERE id='old-held'").first());
    assert.ok(await db.prepare("SELECT id FROM posts WHERE id='old-pending'").first());
  });
  await t.test("shared pins work beyond the feed cap without exposing hidden or pending content", async () => {
    await post("shared-outside-feed", "bob", Date.now() + 3600000);
    await db.prepare("UPDATE posts SET created_at=0 WHERE id='shared-outside-feed'").run();
    await pg.query("INSERT INTO posts (id,user_id,type,title,description,location,lat,lng,expires_at,dietary,status,created_at) SELECT 'bulk-pin-' || n,'bob','food','Bulk alert','','Campus',51.52,-0.13,$1,'[]','approved',$2 FROM generate_series(1,301) AS n", [Date.now() + 3600000, Date.now()]);
    const state = await call("state");
    assert.equal(state.body.posts.some((item) => item.id === "shared-outside-feed"), false);
    const shared = await call("pin?id=shared-outside-feed");
    assert.equal(shared.status, 200); assert.equal(shared.body.post.id, "shared-outside-feed"); assert.equal(shared.body.post.expired, false);
    await post("shared-hidden", "alice", Date.now() + 60000, "hidden");
    await post("shared-pending", "alice", Date.now() + 60000, "pending");
    for (const id of ["shared-hidden", "shared-pending", "does-not-exist"]) assert.equal((await call(`pin?id=${id}`)).status, 404);
    await post("shared-expired", "alice", Date.now() - 60000);
    await db.prepare("UPDATE posts SET photo_key='photos/a.jpg' WHERE id='shared-expired'").run();
    const expired = await call("pin?id=shared-expired");
    assert.equal(expired.status, 200); assert.equal(expired.body.post.expired, true);
    assert.ok(Date.parse(expired.body.post.expiresAt) < Date.now());
    assert.equal(expired.body.post.photoUrl, null); assert.equal(expired.body.post.photoKey, null);
    assert.equal("user_id" in expired.body.post, false);
  });
  await pg.close(); delete globalThis.__communityTools;
});

test("transient moderation failures retry once; negative verdicts and configuration errors do not", async () => {
  let attempts = 0;
  assert.equal(await features.retryModeration(async () => { attempts++; if (attempts === 1) throw { status: 502 }; return "ok"; }, async () => {}), "ok");
  assert.equal(attempts, 2);
  attempts = 0;
  assert.deepEqual(await features.retryModeration(async () => { attempts++; return { approved: false }; }, async () => {}), { approved: false });
  assert.equal(attempts, 1);
  await assert.rejects(features.retryModeration(async () => { throw { status: 503 }; }, async () => {}));
});

test("request and collection validators reject unsafe links, excessive portions and private details", () => {
  assert.throws(() => validation.communityRequestInput({ kind: "takedown", reason: "Please review this", evidenceUrl: "javascript:alert(1)" }));
  assert.throws(() => validation.communityRequestInput({ kind: "takedown", reason: "Please review this", contact: "not-an-email" }));
  assert.throws(() => validation.collectionUpdateInput({ portionsRemaining: 1.5 }));
  assert.throws(() => validation.collectionUpdateInput({ collectionInstructions: "Call 07123 456789" }));
});

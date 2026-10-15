import {loadFreebie} from './freebies/load.mjs';
const {publicFreebie,publishFreebie}=await loadFreebie('lib/freebies/publication.ts');
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import * as food from "../lib/food.ts";

async function loadTs(name, rewrites = []) {
  const source = await fs.readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  for (const [pattern, replacement] of rewrites) code = code.replace(pattern, replacement);
  const url = new URL(`.community-tools-${name}.mjs`, import.meta.url);
  await fs.writeFile(url, code);
  try { return await import(url.href); } finally { await fs.unlink(url); }
}
const { createDatabase, isUniqueViolation } = await loadTs("db");
const validation = await loadTs("community-validation", [[/from "\.\/food";/, 'from "../lib/food.ts";']]);
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
let moderationTexts = [];
let authStub = null, adminStub = null;
globalThis.__communityTools = { publicFreebie, db, isUniqueViolation, validation, features, food,
  currentUser: async () => user, runtimeEnv: async () => ({ ADMIN_USER_IDS: "moderator", ANTHROPIC_API_KEY: "test" }),
  authClient: async () => authStub, adminClient: () => adminStub,
  moderateContent: async (text) => { moderationTexts.push(text); if (moderationHook) await moderationHook(); if (serviceFailure) throw serviceFailure; return verdict; }, moderatePhoto: async () => { photoChecks++; return photoVerdict; },
  photoStorage: () => ({ download: async () => ({ data: new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])]) }), remove: async () => ({ error: null }) }),
  places: [{ id: "ucl-test", category: "building" }, { id: "study-test", category: "study" }, { id: "rental-test", category: "rental" }],
};
const { communityRoute } = await loadTs("community-server", [
  [/import .*publicFreebie.*from .*freebies\/publication.*;/, "const {publicFreebie}=globalThis.__communityTools;"],
  [/import \{[^}]+\} from "\.\/db";/, "const {db, isUniqueViolation} = globalThis.__communityTools; const getDatabase = () => db;"],
  [/import \{[^}]+\} from "\.\/integrations";/, "const {moderateContent, moderatePhoto, runtimeEnv} = globalThis.__communityTools;"],
  [/import \{([^}]+)\} from "\.\/community-validation";/, "const {$1} = globalThis.__communityTools.validation;"],
  [/export \{ HttpError \} from "\.\/community-validation";/, ""],
  [/import \{([^}]+)\} from "\.\/community-features";/, "const {$1} = globalThis.__communityTools.features;"],
  [/import \{([^}]+)\} from "\.\/food";/, "const {$1} = globalThis.__communityTools.food;"],
  [/import \{ places \} from "\.\/data";/, "const {places} = globalThis.__communityTools;"],
  [/import \{[^}]+\} from "\.\/supabase";/, "const { currentUser, photoStorage, authClient, adminClient } = globalThis.__communityTools; const authConfigured = () => true;"],
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
const foodBody = (title = "Remaining food") => ({ action: "post", type: "food", title, description: "Left over from our event", location: "Public foyer", lat: 51.524, lng: -0.134, expiresAt: Date.now() + 3600000, dietary: [], collectionInstructions: "Ask the committee at the table", portionsRemaining: 10, locationConfirmed: true, foodSafetyAcknowledged: true, foodDetails: { allergenStatus: "provided", allergens: ["milk", "cereals-gluten"], ingredients: "See the package ingredient list", handling: "Kept in the original packaging", sourceLabel: "Example society", pickupAccess: "ucl", bringContainer: true } });
const asUser = (userId) => { user = { userId, email: `${userId}@ucl.ac.uk` }; };

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
    const result = await call("action", { action: "update-post", targetId: "active", revision: 0, collectionInstructions: "Ask the committee at the desk", portionsRemaining: 4 });
    assert.equal(result.body.post.status, "pending"); assert.equal(result.body.post.portionsRemaining, 4);
    verdict = { approved: true, reasons: [] };
    const closed = await call("action", { action: "update-post", targetId: "active", revision: 1, collectionInstructions: "All collected", portionsRemaining: 0 });
    assert.ok(Date.parse(closed.body.post.expiresAt) <= Date.now());
  });
  await t.test("active title and location duplicates are caught across accounts", async () => {
    await post("existing-active", "bob");
    const result = await call("action", { action: "post", type: "food", title: "sandwiches", description: "Sealed", location: "quad", lat: 51.52, lng: -0.13, expiresAt: Date.now() + 60000, dietary: [], collectionInstructions: "Collect from the table", locationConfirmed: true, foodSafetyAcknowledged: true });
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
  await t.test("food creation stores all supplied details and sends every free-text field through moderation", async () => {
    asUser("food-owner"); moderationTexts = [];
    const body = foodBody("Food system lifecycle");
    const submitted = await call("action", body);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.post.portionsRemaining, 10);
    assert.deepEqual(submitted.body.post.foodDetails, body.foodDetails);
    assert.equal(submitted.body.post.collectionInstructions, body.collectionInstructions);
    assert.equal(submitted.body.post.revision, 0); assert.equal(submitted.body.post.own, true);
    for (const value of [body.collectionInstructions, body.foodDetails.ingredients, body.foodDetails.handling, body.foodDetails.sourceLabel]) assert.ok(moderationTexts[0].includes(value));
    const pin = await call(`pin?id=${submitted.body.post.id}`);
    assert.deepEqual(pin.body.post.foodDetails, body.foodDetails);
    assert.ok(pin.body.post.availabilityUpdatedAt);
  });
  await t.test("food numeric availability is owner-only, versioned, immediate and cannot reopen a collection", async () => {
    const own = (await call("contributions")).body.posts.find((item) => item.title === "Food system lifecycle");
    const targetId = own.id;
    asUser("food-stranger");
    assert.equal((await call("action", { action: "food-availability", targetId, revision: 0, portionsRemaining: 5 })).status, 404);
    asUser("food-owner"); serviceFailure = { status: 502 }; const checks = moderationTexts.length;
    const update = await call("action", { action: "food-availability", targetId, revision: 0, portionsRemaining: 5 });
    assert.equal(update.status, 200, JSON.stringify(update.body));
    assert.equal(update.body.post.portionsRemaining, 5); assert.equal(update.body.post.revision, 1);
    assert.equal(moderationTexts.length, checks);
    assert.equal((await call("action", { action: "food-availability", targetId, revision: 0, portionsRemaining: 20 })).status, 409);
    const close = await call("action", { action: "food-availability", targetId, revision: 1, portionsRemaining: 0 });
    assert.equal(close.status, 200); assert.equal(close.body.post.closureReason, "collected"); assert.ok(close.body.post.closedAt);
    assert.equal((await call("action", { action: "food-availability", targetId, revision: 2, portionsRemaining: 5 })).status, 409);
    serviceFailure = null;
  });
  await t.test("food feedback is unique, fresh and reset by the owner's latest availability update", async () => {
    asUser("feedback-owner");
    const created = await call("action", foodBody("Feedback food"));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const targetId = created.body.post.id;
    assert.equal((await call("action", { action: "vote", targetId, kind: "still" })).status, 400);
    await db.prepare("UPDATE posts SET availability_updated_at=? WHERE id=?").bind(Date.now() - 1000, targetId).run();
    asUser("feedback-one");
    let voted = await call("action", { action: "vote", targetId, kind: "gone" });
    assert.equal(voted.status, 200, JSON.stringify(voted.body)); assert.equal(voted.body.post.freshGoneCount, 1);
    voted = await call("action", { action: "vote", targetId, kind: "gone" });
    assert.equal(voted.body.post.freshGoneCount, 1);
    asUser("feedback-owner");
    const renewed = await call("action", { action: "food-availability", targetId, revision: 0, portionsRemaining: 8 });
    assert.equal(renewed.status, 200); assert.equal(renewed.body.post.freshGoneCount, 0);
    assert.equal((await call(`pin?id=${targetId}`)).body.post.freshGoneCount, 0);
    await db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES ('stale-feedback','stale-user',?,'gone',?)").bind(targetId, Date.now() - 31 * 60000).run();
    for (const person of ["feedback-two", "feedback-three", "feedback-four"]) {
      asUser(person); voted = await call("action", { action: "vote", targetId, kind: "gone" });
      assert.equal(voted.status, 200, JSON.stringify(voted.body));
    }
    assert.equal(voted.body.post.freshGoneCount, 3); assert.equal(voted.body.post.closureReason, "community-gone");
    assert.ok(voted.body.post.lastAvailabilityFeedbackAt); assert.ok(voted.body.post.closedAt);
    asUser("feedback-five"); assert.equal((await call("action", { action: "vote", targetId, kind: "still" })).status, 400);
  });
  await t.test("food details edits are moderated and cannot overwrite a newer availability or closure", async () => {
    asUser("food-edit-owner");
    const created = await call("action", foodBody("Editable food"));
    const targetId = created.body.post.id;
    const replacement = { ...created.body.post.foodDetails, ingredients: "Updated package ingredients", handling: "Ask the sharer for handling details" };
    verdict = { approved: false, reasons: ["Please clarify the label"] };
    let changed = await call("action", { action: "update-post", targetId, revision: 0, collectionInstructions: "Please meet the organiser at the table", foodDetails: replacement });
    assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.equal(changed.body.post.status, "pending"); assert.equal(changed.body.post.portionsRemaining, 10);
    assert.deepEqual(changed.body.post.foodDetails, replacement);
    assert.equal((await call("action", { action: "food-availability", targetId, revision: 1, portionsRemaining: 2 })).status, 409);
    verdict = { approved: true, reasons: [] };
    changed = await call("action", { action: "update-post", targetId, revision: 1, collectionInstructions: "Meet at the signposted foyer table", foodDetails: replacement });
    assert.equal(changed.body.post.status, "approved"); assert.equal(changed.body.post.revision, 2);
    moderationHook = async () => { moderationHook = null; await db.prepare("UPDATE posts SET portions_remaining=3, availability_updated_at=?, moderation_revision=moderation_revision+1 WHERE id=?").bind(Date.now(), targetId).run(); };
    const raced = await call("action", { action: "update-post", targetId, revision: 2, collectionInstructions: "This stale edit must not overwrite", foodDetails: replacement });
    assert.equal(raced.status, 409);
    assert.equal((await call(`pin?id=${targetId}`)).body.post.portionsRemaining, 3);
    moderationHook = async () => { moderationHook = null; await db.prepare("UPDATE posts SET expires_at=?, closed_at=?, closure_reason='withdrawn', moderation_revision=moderation_revision+1 WHERE id=?").bind(Date.now(), Date.now(), targetId).run(); };
    const closedDuringCheck = await call("action", { action: "update-post", targetId, revision: 3, collectionInstructions: "Another stale edit must stay closed", foodDetails: replacement });
    assert.equal(closedDuringCheck.status, 409);
    assert.equal((await call(`pin?id=${targetId}`)).body.post.closureReason, "withdrawn");
  });
  await t.test("food owner closure is immediate during provider failure and never reopens pending, hidden or expired food", async () => {
    asUser("food-close-owner");
    for (const [name, status, expiry] of [["pending-food", "pending", Date.now() + 60000], ["hidden-food", "hidden", Date.now() + 60000], ["expired-food", "approved", Date.now() - 1]]) {
      await post(name, "food-close-owner", expiry, status);
      assert.equal((await call("action", { action: "food-availability", targetId: name, revision: 0, portionsRemaining: 2 })).status, 409);
    }
    serviceFailure = { status: 502 }; const checks = moderationTexts.length;
    const closed = await call("action", { action: "close-post", targetId: "pending-food", reason: "withdrawn" });
    assert.equal(closed.status, 200); assert.equal(closed.body.post.closureReason, "withdrawn"); assert.ok(closed.body.post.closedAt);
    assert.equal(moderationTexts.length, checks);
    const repeated = await call("action", { action: "close-post", targetId: "pending-food", reason: "collected" });
    assert.equal(repeated.body.post.closureReason, "withdrawn");
    serviceFailure = null;
  });
  await t.test("concurrent closure reasons preserve the first closure, quantity and revision", async () => {
    asUser("concurrent-close-owner");
    await post("concurrent-close-food", "concurrent-close-owner");
    await db.prepare("UPDATE posts SET portions_remaining=7 WHERE id='concurrent-close-food'").run();
    const prepare = db.prepare;
    let reads = 0, release;
    const bothRead = new Promise(resolve => { release = resolve; });
    // Pause both requests immediately after reading the open row. Their writes
    // then contend on real Postgres transactions using that same stale snapshot.
    db.prepare = query => {
      const statement = prepare(query);
      if (query !== "SELECT * FROM posts WHERE id = ? AND user_id = ?") return statement;
      return { ...statement, bind: (...params) => {
        const bound = statement.bind(...params);
        return { ...bound, first: async () => {
          const row = await bound.first();
          if (params[0] === "concurrent-close-food" && reads < 2) { reads++; if (reads === 2) release(); await bothRead; }
          return row;
        } };
      } };
    };
    let responses;
    try {
      responses = await Promise.all(["withdrawn", "collected"].map(reason => call("action", { action: "close-post", targetId: "concurrent-close-food", reason })));
    } finally { db.prepare = prepare; release(); }
    assert.equal(reads, 2);
    assert.ok(responses.every(response => response.status === 200), JSON.stringify(responses));
    const saved = await db.prepare("SELECT * FROM posts WHERE id='concurrent-close-food'").first();
    assert.equal(saved.moderation_revision, 1);
    assert.equal(saved.portions_remaining, saved.closure_reason === "collected" ? 0 : 7);
    for (const response of responses) {
      assert.equal(response.body.post.closureReason, saved.closure_reason);
      assert.equal(response.body.post.portionsRemaining, saved.portions_remaining);
      assert.equal(response.body.post.revision, 1);
      assert.equal(response.body.post.closedAt, new Date(Number(saved.closed_at)).toISOString());
    }
  });
  await t.test("food feed paginates beyond the global cap and excludes unavailable and future items", async () => {
    asUser("food-feed-owner");
    await post("future-food", "food-feed-owner"); await db.prepare("UPDATE posts SET starts_at=? WHERE id='future-food'").bind(Date.now() + 30000).run();
    await post("not-food", "food-feed-owner"); await db.prepare("UPDATE posts SET type='freebie' WHERE id='not-food'").run();
    let offset = 0; const all = []; let expectedTotal;
    do {
      const response = await call(`food?offset=${offset}`);
      assert.equal(response.status, 200, JSON.stringify(response.body)); assert.ok(response.body.posts.length <= 40);
      expectedTotal ??= response.body.total;
      assert.equal(response.body.total, expectedTotal);
      all.push(...response.body.posts); offset = response.body.nextOffset;
    } while (offset !== null);
    assert.ok(expectedTotal > 300); assert.equal(all.length, expectedTotal);
    assert.equal(new Set(all.map((item) => item.id)).size, all.length);
    assert.ok(all.some((item) => item.id === "shared-outside-feed"));
    for (const id of ["future-food", "not-food", "pending-food", "hidden-food", "expired-food", "shared-hidden", "shared-pending"]) assert.equal(all.some((item) => item.id === id), false);
    assert.ok(all.every((item) => item.type === "food" && item.status === "approved" && !item.closedAt && Date.parse(item.expiresAt) > Date.now()));
    asUser("future-voter"); assert.equal((await call("action", { action: "vote", targetId: "future-food", kind: "gone" })).status, 400);
  });
  await t.test("food retry includes all details and cannot publish a collection closed during the check", async () => {
    await post("food-retry-details", "retry-food-owner", Date.now() + 60000, "pending");
    await db.prepare("UPDATE posts SET collection_instructions=?, food_details=? WHERE id='food-retry-details'").bind("Follow the collection signs", JSON.stringify({ ...food.emptyFoodDetails(), ingredients: "Retry ingredients", handling: "Retry handling", sourceLabel: "Retry society" })).run();
    await db.prepare("INSERT INTO moderation_retries(target_id,kind,revision,next_attempt_at) VALUES ('food-retry-details','post',0,0)").run();
    moderationTexts = [];
    moderationHook = async () => { moderationHook = null; await db.prepare("UPDATE posts SET expires_at=?, closed_at=?, closure_reason='withdrawn', moderation_revision=moderation_revision+1 WHERE id='food-retry-details'").bind(Date.now(), Date.now()).run(); };
    await due(); await call("state");
    for (const value of ["Follow the collection signs", "Retry ingredients", "Retry handling", "Retry society"]) assert.ok(moderationTexts[0].includes(value));
    const row = await db.prepare("SELECT status,closure_reason FROM posts WHERE id='food-retry-details'").first();
    assert.equal(row.status, "pending"); assert.equal(row.closure_reason, "withdrawn");
  });
  await t.test("source events keep their type through state and shared links, without exposing private fields", async () => {
    const now=Date.now(), metadata={hasFreebies:false,freebies:[],summary:'Student society discussion',admission:'free',dietary:[]};
    for(const [id,status,expiry] of [['union-event','approved',now+600000],['union-held','pending',now+600000],['union-expired','approved',now-1]]){
      await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,starts_at,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES (?,'system:union','event','Society discussion','Discussion','Venue to be confirmed',?,?,?,?,'[]',?,?)")
        .bind(id,now-60000,expiry,id,JSON.stringify(metadata),status,now).run();
    }
    user=null;
    const state=await call('state');assert.equal(state.status,200);
    const event=state.body.posts.find(row=>row.id==='union-event');
    assert.equal(event.type,'event');assert.equal(event.lat,null);assert.equal(event.lng,null);
    assert.equal(event.freebie.hasFreebies,false);assert.equal(event.own,false);
    assert.ok(!state.body.posts.some(row=>['union-held','union-expired'].includes(row.id)));
    assert.equal(JSON.stringify(event).includes('system:union'),false);
    const shared=await call('pin?id=union-event');assert.equal(shared.status,200);
    assert.equal(shared.body.post.type,'event');assert.equal(shared.body.post.expired,false);
    assert.equal((await call('pin?id=union-held')).status,404);
    assert.equal((await call('pin?id=union-expired')).body.post.expired,true);
  });
  await t.test("student and moderator action requests cannot forge general source events", async () => {
    const body={...foodBody('Forged event'),type:'event',sourceEventKey:'invented',userId:'system:union',unionImport:true};
    asUser('event-poster');assert.equal((await call('action',body)).status,400);
    const sourced={...body,sourceUrl:'https://studentsunionucl.org/whats-on/clubs-societies/forged'};
    assert.equal((await call('action',sourced)).status,403);
    asUser('moderator');assert.equal((await call('action',sourced)).status,400);
    assert.equal(Number((await db.prepare("SELECT count(*) as count FROM posts WHERE title='Forged event'").first()).count),0);
  });
  await t.test("upcoming events and freebies cannot receive availability votes but can be reported", async () => {
    asUser('upcoming-reader');
    for(const type of ['event','freebie']){
      const id='future-'+type,now=Date.now();
      await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,starts_at,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES (?,'system:union',?,'Future fixture','Fixture','TBC',?,?,?,'{}','[]','approved',?)")
        .bind(id,type,now+60000,now+120000,id,now).run();
      for(const kind of ['still','gone']){
        const response=await call('action',{action:'vote',targetId:id,kind});
        assert.equal(response.status,400);assert.match(response.body.error,/not started/);
      }
      assert.equal(Number((await db.prepare('SELECT count(*) as count FROM votes WHERE target_id=?').bind(id).first()).count),0);
      assert.equal((await call('action',{action:'report',targetId:id,reason:'The organiser has changed this listing'})).status,200);
      assert.equal((await db.prepare('SELECT status FROM posts WHERE id=?').bind(id).first()).status,'approved');
    }
  });
  await t.test("independent gone votes close a source event durably and a rescan cannot reopen it", async () => {
    asUser('event-reader');
    assert.equal((await call('action',{action:'close-post',targetId:'union-event',reason:'ended'})).status,404);
    for(const name of ['event-reader','event-reader','event-second']){
      asUser(name);assert.equal((await call('action',{action:'vote',targetId:'union-event',kind:'gone'})).status,200);
    }
    let row=await db.prepare("SELECT * FROM posts WHERE id='union-event'").first();
    assert.equal(row.closed_at,null,'duplicate voter must not count twice');
    asUser('event-third');assert.equal((await call('action',{action:'vote',targetId:'union-event',kind:'gone'})).status,200);
    row=await db.prepare("SELECT * FROM posts WHERE id='union-event'").first();
    assert.equal(row.closure_reason,'community-gone');assert.ok(row.closed_at);assert.equal(row.moderation_revision,1);
    const source={id:'union-event',title:'Society discussion',url:'https://studentsunionucl.org/whats-on/clubs-societies/discussion',start:new Date(Date.now()-1000).toISOString(),end:new Date(Date.now()+600000).toISOString(),sourceLocation:null,imageUrl:null};
    const extraction={hasFreebies:false,freebies:[],summary:'Student society discussion',admission:'free',venue:null,address:null,locationEvidence:null,priceDetails:null,bookingRequired:null,bookingUrl:null,eligibility:null,conditions:[]};
    const result=await publishFreebie(db,source,extraction,{places:[],privacy:()=>null,moderate:async()=>{throw Error('Closed events must not trigger paid moderation');}});
    assert.equal(result.state,'held_by_moderator');assert.equal(result.id,'union-event');
    assert.equal((await call('pin?id=union-event')).body.post.expired,true);
  });
  await t.test("general source events retain community reporting and hidden-link protection", async () => {
    await db.prepare("UPDATE posts SET expires_at=?,status='approved' WHERE id='union-expired'").bind(Date.now()+600000).run();
    for(const name of ['event-reporter-one','event-reporter-two','event-reporter-three']){
      asUser(name);assert.equal((await call('action',{action:'report',targetId:'union-expired',reason:'The source says this event is cancelled'})).status,200);
    }
    assert.equal((await db.prepare("SELECT status FROM posts WHERE id='union-expired'").first()).status,'hidden');
    assert.equal((await call('pin?id=union-expired')).status,404);
  });
  await t.test("a discussion hidden or deleted during moderation cannot accept an orphan reply", async () => {
    asUser('discussion-writer');
    for(const status of ['hidden','deleted']){
      const threadId='reply-race-'+status;
      await db.prepare("INSERT INTO threads(id,user_id,place_id,title,text,status,created_at) VALUES (?,'discussion-host','ucl-test','Discussion fixture','Question','approved',?)").bind(threadId,Date.now()).run();
      moderationHook=async()=>{
        moderationHook=null;
        if(status==='deleted')await db.prepare('DELETE FROM threads WHERE id=?').bind(threadId).run();
        else await db.prepare("UPDATE threads SET status='hidden',moderation_revision=moderation_revision+1 WHERE id=?").bind(threadId).run();
      };
      const response=await call('action',{action:'reply',threadId,text:'A useful answer'});
      assert.equal(response.status,409);
      assert.equal(Number((await db.prepare('SELECT count(*) AS count FROM replies WHERE thread_id=?').bind(threadId).first()).count),0);
    }
  });
  await t.test("manual approval checks private details in review terms and complete imported event metadata", async () => {
    asUser('moderator');
    await review('private-term-review','private-term-author','ucl-test',4,'pending');
    await db.prepare("UPDATE reviews SET term='Contact private@example.com' WHERE id='private-term-review'").run();
    await review('private-room-review','private-room-author','rental-test',4,'pending');
    await db.prepare("UPDATE reviews SET text='My room 12 has damp' WHERE id='private-room-review'").run();
    await db.prepare("INSERT INTO posts(id,user_id,type,title,description,location,expires_at,source_event_key,freebie_json,dietary,status,created_at) VALUES ('private-source-event','system:union','event','Society event','Public description','Campus',?,'private-source','{\"hasFreebies\":false,\"freebies\":[],\"conditions\":[\"Contact private@example.com\"]}','[]','pending',?)").bind(Date.now()+60000,Date.now()).run();
    for(const targetId of ['private-term-review','private-source-event','private-room-review']){
      const response=await call('moderation',{targetId,decision:'approve'});
      assert.equal(response.status,400);assert.match(response.body.error,/contact details|flat or room/);
    }
    assert.equal((await db.prepare("SELECT status FROM reviews WHERE id='private-term-review'").first()).status,'pending');
    assert.equal((await db.prepare("SELECT status FROM posts WHERE id='private-source-event'").first()).status,'pending');
  });
  await t.test("old hidden content cannot starve pending or newly reported contributions out of moderation", async () => {
    asUser('moderator');
    await pg.exec("INSERT INTO reviews(id,user_id,place_id,rating,criteria,tags,text,term,recommend,status,created_at) SELECT 'old-hidden-' || n,'old-hidden-' || n,'ucl-test',4,'{}','[]','Old hidden content','Autumn 2026',1,'hidden',1 FROM generate_series(1,201) AS n");
    await review('fresh-pending','fresh-pending-author','ucl-test',4,'pending');
    await review('fresh-reported','fresh-reported-author');
    await db.prepare("INSERT INTO reports(id,user_id,target_id,reason,created_at) VALUES ('fresh-report','reporter','fresh-reported','Needs checking',?)").bind(Date.now()).run();
    const response=await call('moderation');assert.equal(response.status,200);
    assert.ok(response.body.queue.some(item=>item.id==='fresh-pending'));
    assert.ok(response.body.queue.some(item=>item.id==='fresh-reported'));
  });
  await t.test("sign-out does not report success when Auth cannot end the session", async () => {
    authStub={auth:{signOut:async()=>({error:{name:'AuthApiError',message:'private provider response'}})}};
    let response=await call('auth/signout',{});
    assert.equal(response.status,503);assert.match(response.body.error,/sign out/i);
    assert.equal(JSON.stringify(response.body).includes('private provider response'),false);
    authStub={auth:{signOut:async()=>({error:null})}};
    response=await call('auth/signout',{});assert.equal(response.status,200);assert.equal(response.body.ok,true);
    authStub=null;
  });
  await t.test("deleting an account during provider moderation cancels delayed writes without recreating its profile", async () => {
    await db.prepare("INSERT INTO threads(id,user_id,place_id,title,text,status,created_at) VALUES ('account-race-parent','other-person','study-test','Open discussion','A public conversation','approved',1)").run();
    const cases=[
      {action:'review',placeId:'study-test',rating:4,criteria:{wifi:4},text:'Useful place',tags:[],recommend:true,term:'Autumn 2026'},
      {action:'thread',placeId:'study-test',title:'A study question',text:'When is this place quiet?'},
      {action:'reply',threadId:'account-race-parent',text:'It was quiet during my visit.'},
      foodBody('Delayed approved food'),
      foodBody('Delayed pending food'),
      {action:'update-post',targetId:'account-race-food',revision:0,collectionInstructions:'An updated collection note'},
    ];
    adminStub={storage:{from:()=>({remove:async()=>({error:null})})},auth:{admin:{deleteUser:async()=>{user=null;return {error:null}}}}};
    authStub={auth:{signOut:async()=>({error:null})}};
    try {
      for(const [index,body] of cases.entries()){
        const userId=`deleted-during-check-${index}`;asUser(userId);
        verdict={approved:index!==4,reasons:index===4?['Needs review']:[]};
        if(body.action==='update-post')await post('account-race-food',userId,Date.now()+60000,'pending');
        moderationHook=async()=>{moderationHook=null;assert.equal((await call('account',undefined,'DELETE')).status,200)};
        const response=await call('action',body);
        assert.equal(response.status,403,`${body.action} must stop after deletion`);
        assert.match(response.body.error,/account changed/i);
        for(const table of ['profiles','reviews','threads','replies','posts'])assert.equal(Number((await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE user_id=?`).bind(userId).first()).count),0,`${table} must not be recreated`);
      }
    } finally {verdict={approved:true,reasons:[]};moderationHook=null;authStub=null;adminStub=null;asUser('alice');}
  });
  await t.test("account deletion preserves retry access and reports partial Auth failure honestly", async () => {
    asUser('account-delete-fixture');
    await review('account-delete-review',user.userId);
    await db.prepare("INSERT INTO photos(key,user_id,mime,bytes,created_at) VALUES ('photos/account-delete.jpg',?,'image/jpeg',20,?)").bind(user.userId,Date.now()).run();
    let storageError={message:'private storage error'},authError={name:'AuthApiError',message:'private delete error'},deletions=0,signouts=0;
    adminStub={storage:{from:()=>({remove:async()=>({error:storageError})})},auth:{admin:{deleteUser:async(id)=>{assert.equal(id,'account-delete-fixture');deletions++;return {error:authError}}}}};
    authStub={auth:{signOut:async()=>{signouts++;return {error:null}}}};
    let response=await call('account',undefined,'DELETE');
    assert.equal(response.status,503);assert.equal(deletions,0);assert.equal(signouts,0);
    assert.ok(await db.prepare("SELECT id FROM reviews WHERE id='account-delete-review'").first());
    storageError=null;
    response=await call('account',undefined,'DELETE');
    assert.equal(response.status,503);assert.match(response.body.error,/community data.*deleted.*sign-in account/i);
    assert.equal(deletions,1);assert.equal(signouts,0,'keep the session available so failed Auth deletion can be retried');
    assert.equal(JSON.stringify(response.body).includes('private delete error'),false);
    assert.equal(await db.prepare("SELECT id FROM reviews WHERE id='account-delete-review'").first(),null);
    authError=null;
    response=await call('account',undefined,'DELETE');
    assert.equal(response.status,200);assert.equal(deletions,2);assert.equal(signouts,1);
    authStub=null;adminStub=null;
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

test("food intake requires confirmation, honest unknowns, supported allergens and available-now bounded quantities", () => {
  const valid = foodBody();
  assert.equal(validation.postInput(valid).foodDetails.allergenStatus, "provided");
  for (const patch of [{ foodSafetyAcknowledged: false }, { locationConfirmed: false }, { collectionInstructions: "" }, { portionsRemaining: 0 }, { portionsRemaining: 1.5 }, { portionsRemaining: "5" }, { portionsRemaining: 10001 }, { startsAt: Date.now() + 10000 }, { foodDetails: { allergenStatus: "unknown", allergens: ["milk"] } }, { foodDetails: { allergenStatus: "provided", allergens: ["safe"] } }, { foodDetails: { sourceLabel: "person@example.com" } }]) assert.throws(() => validation.postInput({ ...valid, ...patch }));
  const unknown = validation.postInput({ ...valid, portionsRemaining: null, foodDetails: undefined });
  assert.equal(unknown.portionsRemaining, null); assert.deepEqual(unknown.foodDetails, food.emptyFoodDetails());
  for (const ingredients of [undefined, "", "   "]) assert.throws(() => validation.foodDetailsInput({ allergenStatus: "provided", allergens: [], ingredients }), /List the declared allergens/);
  assert.equal(validation.foodDetailsInput({ allergenStatus: "provided", allergens: [], ingredients: "Flour, butter and sugar" }).allergenStatus, "provided");
  assert.deepEqual(validation.foodDetailsInput({ allergenStatus: "provided", allergens: ["milk"], ingredients: "" }).allergens, ["milk"]);
});

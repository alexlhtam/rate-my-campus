import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

function database() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, directory), "utf8"));
  return db;
}

test("migration applies and one UCL email cannot verify two accounts", () => {
  const db = database();
  db.prepare("INSERT INTO profiles (user_id,email,verified_at,created_at) VALUES (?,?,?,?)").run("one", "student@ucl.ac.uk", 1000, 1000);
  assert.throws(() => db.prepare("INSERT INTO profiles (user_id,email,verified_at,created_at) VALUES (?,?,?,?)").run("two", "student@ucl.ac.uk", 1000, 1000), /UNIQUE/);
  db.close();
});

test("unique database constraints prevent duplicate reviews and votes", () => {
  const db = database();
  const insert = db.prepare("INSERT INTO reviews (id,user_id,place_id,rating,criteria,tags,text,term,recommend,created_at) VALUES (?,?,?,4,'{}','[]','Good','Autumn 2026',1,1000)");
  insert.run("review-1", "one", "student-centre");
  assert.throws(() => insert.run("review-2", "one", "student-centre"), /UNIQUE/);
  insert.run("review-3", "two", "student-centre");
  db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES ('v1','one','review-3','helpful',1000)").run();
  assert.throws(() => db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES ('v2','one','review-3','unhelpful',1000)").run(), /UNIQUE/);
  assert.equal(db.prepare("SELECT status FROM reviews WHERE id='review-1'").get().status, "pending");
  db.close();
});

test("verification attempts are capped atomically and successful codes are single-use", () => {
  const db = database();
  db.prepare("INSERT INTO email_codes (user_id,email,code_hash,salt,expires_at) VALUES ('one','student@ucl.ac.uk','hash','salt',10000)").run();
  const attempt = db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ? AND email = ? AND expires_at > ? AND attempts < 5 RETURNING code_hash, salt");
  for (let i = 0; i < 5; i++) assert.equal(attempt.get("one", "student@ucl.ac.uk", 1000).code_hash, "hash");
  assert.equal(attempt.get("one", "student@ucl.ac.uk", 1000), undefined);
  assert.equal(attempt.get("one", "student@ucl.ac.uk", 10001), undefined);
  const consume = db.prepare("DELETE FROM email_codes WHERE user_id = ? AND code_hash = ? RETURNING user_id");
  assert.equal(consume.get("one", "hash").user_id, "one");
  assert.equal(consume.get("one", "hash"), undefined);
  db.close();
});

test("rate limit counters increment through a single atomic statement", () => {
  const db = database();
  const consume = db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count");
  for (let expected = 1; expected <= 10; expected++) assert.equal(consume.get("review:one:1", 10000).count, expected);
  assert.equal(consume.get("review:two:1", 10000).count, 1);
  db.close();
});

test("the same imported event cannot be posted twice by different moderators", () => {
  const db = database();
  const insert = db.prepare("INSERT INTO posts (id,user_id,type,title,description,location,lat,lng,expires_at,dietary,source_url,created_at) VALUES (?,?,'freebie','Welcome','Snacks','Campus',51.524,-0.133,10000,'[]',?,1000)");
  insert.run("event-1", "moderator-1", "https://studentsunionucl.org/whats-on/welcome");
  assert.throws(() => insert.run("event-2", "moderator-2", "https://studentsunionucl.org/whats-on/welcome"), /UNIQUE/);
  insert.run("normal-1", "student-1", null);
  insert.run("normal-2", "student-2", null);
  db.close();
});

test("general privacy requests resolve individually without clearing content reports", () => {
  const db = database();
  const insert = db.prepare("INSERT INTO reports (id,user_id,target_id,reason,created_at) VALUES (?,?,?,?,1000)");
  insert.run("general-1", "one", "takedown", "Please review my privacy request");
  insert.run("general-2", "two", "takedown", "Please review a separate request");
  insert.run("content-1", "one", "review-1", "A private name appears here");
  const resolve = db.prepare("DELETE FROM reports WHERE id = ? AND target_id = 'takedown' RETURNING id");
  assert.equal(resolve.get("general-1").id, "general-1");
  assert.equal(resolve.get("content-1"), undefined);
  assert.equal(db.prepare("SELECT count(*) AS total FROM reports").get().total, 2);
  assert.equal(db.prepare("SELECT reason FROM reports WHERE id='general-2'").get().reason, "Please review a separate request");
  db.close();
});

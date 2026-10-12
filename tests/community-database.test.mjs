import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// Load the server adapter without a bundler, as the integration tests do.
const source = await fs.readFile(new URL("../lib/db.ts", import.meta.url), "utf8");
const temporaryModule = new URL(".db-under-test.mjs", import.meta.url);
await fs.writeFile(temporaryModule, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const { createDatabase, isUniqueViolation, numberedPlaceholders, connectionUrl } = await import(temporaryModule.href);
await fs.unlink(temporaryModule);

// Apply the Supabase migrations to an in-process Postgres. The storage bucket
// insert needs Supabase's storage schema, which plain Postgres lacks.
async function database() {
  const pg = new PGlite();
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(new URL(file, directory), "utf8").split("-- Private bucket")[0]);
  }
  const runner = (on) => async (query, params) => (await on.query(query, params)).rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])));
  return { pg, db: createDatabase(runner(pg), (work) => pg.transaction((tx) => work(runner(tx)))) };
}

test("placeholders are numbered in order and pooler-only URL options are dropped", () => {
  assert.equal(numberedPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"), "SELECT * FROM t WHERE a = $1 AND b = $2");
  assert.equal(connectionUrl("postgres://u:p@host:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true"), "postgres://u:p@host:6543/postgres?sslmode=require");
});

test("migration applies and one UCL email cannot verify two accounts", async () => {
  const { pg, db } = await database();
  const insert = db.prepare("INSERT INTO profiles (user_id,email,verified_at,created_at) VALUES (?,?,?,?)");
  await insert.bind("one", "student@ucl.ac.uk", 1000, 1000).run();
  await assert.rejects(insert.bind("two", "student@ucl.ac.uk", 1000, 1000).run(), (error) => isUniqueViolation(error));
  await pg.close();
});

test("unique database constraints prevent duplicate reviews and votes", async () => {
  const { pg, db } = await database();
  const insert = db.prepare("INSERT INTO reviews (id,user_id,place_id,rating,criteria,tags,text,term,recommend,created_at) VALUES (?,?,?,4,'{}','[]','Good','Autumn 2026',1,1000)");
  await insert.bind("review-1", "one", "student-centre").run();
  await assert.rejects(insert.bind("review-2", "one", "student-centre").run(), (error) => isUniqueViolation(error));
  await insert.bind("review-3", "two", "student-centre").run();
  await db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES ('v1','one','review-3','helpful',1000)").run();
  await assert.rejects(db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES ('v2','one','review-3','unhelpful',1000)").run(), (error) => isUniqueViolation(error));
  assert.equal((await db.prepare("SELECT status FROM reviews WHERE id='review-1'").first()).status, "pending");
  await pg.close();
});

test("rate limit counters increment through a single atomic statement", async () => {
  const { pg, db } = await database();
  const consume = db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count");
  for (let expected = 1; expected <= 10; expected++) assert.equal((await consume.bind("review:one:1", Date.now() + 10000).first()).count, expected);
  assert.equal((await consume.bind("review:two:1", Date.now() + 10000).first()).count, 1);
  await pg.close();
});

test("the same imported event cannot be posted twice by different moderators", async () => {
  const { pg, db } = await database();
  const insert = db.prepare("INSERT INTO posts (id,user_id,type,title,description,location,lat,lng,expires_at,dietary,source_url,created_at) VALUES (?,?,'freebie','Welcome','Snacks','Campus',51.524,-0.133,10000,'[]',?,1000)");
  await insert.bind("event-1", "moderator-1", "https://studentsunionucl.org/whats-on/welcome").run();
  await assert.rejects(insert.bind("event-2", "moderator-2", "https://studentsunionucl.org/whats-on/welcome").run(), (error) => isUniqueViolation(error));
  await insert.bind("normal-1", "student-1", null).run();
  await insert.bind("normal-2", "student-2", null).run();
  await pg.close();
});

test("three gone votes outnumbering confirmations expire a pin", async () => {
  const { pg, db } = await database();
  await db.prepare("INSERT INTO posts (id,user_id,type,title,description,location,lat,lng,expires_at,dietary,created_at) VALUES ('pin','one','food','Pizza','Spare','Quad',51.5,-0.13,?,'[]',1000)").bind(Date.now() + 3600000).run();
  for (const user of ["a", "b", "c"]) await db.prepare("INSERT INTO votes (id,user_id,target_id,kind,created_at) VALUES (?,?,'pin','gone',1000)").bind(`v-${user}`, user).run();
  const now = Date.now();
  await db.prepare("UPDATE posts SET expires_at = LEAST(expires_at, ?) WHERE id = ? AND (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'gone') >= 3 AND (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'gone') > (SELECT count(*) FROM votes WHERE target_id = ? AND kind = 'still')")
    .bind(now, "pin", "pin", "pin", "pin").run();
  assert.equal(Number((await db.prepare("SELECT expires_at FROM posts WHERE id = 'pin'").first()).expires_at), now);
  await pg.close();
});

test("batches are atomic and general privacy requests resolve individually", async () => {
  const { pg, db } = await database();
  const insert = db.prepare("INSERT INTO reports (id,user_id,target_id,reason,created_at) VALUES (?,?,?,?,1000)");
  await db.batch([
    insert.bind("general-1", "one", "takedown", "Please review my privacy request"),
    insert.bind("general-2", "two", "takedown", "Please review a separate request"),
    insert.bind("content-1", "one", "review-1", "A private name appears here"),
  ]);
  await assert.rejects(db.batch([insert.bind("general-3", "three", "takedown", "New"), insert.bind("general-1", "one", "takedown", "Duplicate id")]));
  assert.equal((await db.prepare("SELECT id FROM reports WHERE id = 'general-3'").first()), null);
  const resolve = db.prepare("DELETE FROM reports WHERE id = ? AND target_id = 'takedown' RETURNING id");
  assert.equal((await resolve.bind("general-1").first()).id, "general-1");
  assert.equal(await resolve.bind("content-1").first(), null);
  assert.equal(Number((await db.prepare("SELECT count(*) AS total FROM reports").first()).total), 2);
  await pg.close();
});

test("community tables are closed to the public Data API", async () => {
  const { pg } = await database();
  const { rows } = await pg.query("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity");
  assert.deepEqual(rows, []);
  await pg.close();
});

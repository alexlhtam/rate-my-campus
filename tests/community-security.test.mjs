import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
const source = await fs.readFile(new URL("../lib/community-validation.ts", import.meta.url), "utf8");
const temporary = new URL(".community-security-validation.mjs", import.meta.url);
await fs.writeFile(temporary, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace('from "./food";', 'from "../lib/food.ts";'));
const {
  HttpError, assertSameOrigin, imageType, postInput, privateInformationReason,
  readLimitedBody, reviewInput, safeId, stripImageMetadata, uclEmail,
} = await import(temporary.href);
await fs.unlink(temporary);

test("only the exact UCL email domain is eligible", () => {
  assert.equal(uclEmail(" Student@UCL.AC.UK "), "student@ucl.ac.uk");
  for (const value of ["student@ucl.ac.uk.attacker.test", "student@ucl-ac.uk", "student@alumni.ucl.ac.uk", "student@gmail.com", "a\r\nb@ucl.ac.uk"]) {
    assert.throws(() => uclEmail(value), HttpError);
  }
});

test("writes reject cross-origin, opaque-origin and missing-origin requests", () => {
  const request = (origin, fetchSite) => new Request("https://campus.example/api/community/action", { method: "POST", headers: { ...(origin ? { origin } : {}), ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}) } });
  assert.doesNotThrow(() => assertSameOrigin(request("https://campus.example", "same-origin")));
  for (const value of [null, "null", "https://evil.example", "https://campus.example.evil.test", "http://campus.example"]) assert.throws(() => assertSameOrigin(request(value)), HttpError);
  assert.throws(() => assertSameOrigin(request("https://campus.example", "cross-site")), HttpError);
});

test("identifiers cannot inject SQL or object paths", () => {
  assert.equal(safeId("student-centre"), "student-centre");
  for (const id of ["../../private", "x' OR 1=1", "", "a/b", "photo.png"]) assert.throws(() => safeId(id), HttpError);
});

test("review scores and category criteria are bounded", () => {
  const valid = { placeId: "student-centre", rating: 4, criteria: { wifi: 4, noise: 3 }, tags: ["Quiet"], text: "Useful study desks.", term: "Autumn 2026", recommend: true };
  assert.equal(reviewInput(valid, "study").rating, 4);
  for (const rating of [NaN, Infinity, -1, 0, 6, 4.1, "5"]) assert.throws(() => reviewInput({ ...valid, rating }, "study"), HttpError);
  assert.throws(() => reviewInput({ ...valid, criteria: { landlord: 2 } }, "study"), HttpError);
  assert.throws(() => reviewInput({ ...valid, recommend: "true" }, "study"), HttpError);
  assert.throws(() => reviewInput({ ...valid, criteria: { wifi: 9 } }, "study"), HttpError);
});

test("food alerts cannot live longer than six hours or leave the campus area", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const food = { type: "food", title: "Sandwiches", description: "Labelled ingredients on the table.", location: "Wilkins foyer", lat: 51.524, lng: -0.133, expiresAt: now + 60000, dietary: ["vegetarian"], collectionInstructions: "Collect from the table", locationConfirmed: true, foodSafetyAcknowledged: true };
  assert.equal(postInput(food, now).type, "food");
  for (const expiresAt of [now, now - 1, now + 6 * 3600000 + 1, "invalid", Infinity]) assert.throws(() => postInput({ ...food, expiresAt }, now), HttpError);
  assert.throws(() => postInput({ ...food, lat: 40.7 }, now), HttpError);
  assert.throws(() => postInput({ ...food, dietary: ["guaranteed allergen-free"] }, now), HttpError);
});

test("deals require an uploaded photo and mathematically valid prices", () => {
  const now = Date.now();
  const deal = { type: "deal", title: "Reduced sandwiches", location: "Goodge Street", lat: 51.522, lng: -0.134, expiresAt: now + 60000, dietary: [], price: 1, originalPrice: 3 };
  assert.throws(() => postInput(deal, now), HttpError);
  assert.throws(() => postInput({ ...deal, photoKey: "https://evil.example/image" }, now), HttpError);
  const photoKey = "photos/7c0f6927-9cb6-41ba-aa8f-3dd8b7fa75b2.jpg";
  assert.equal(postInput({ ...deal, photoKey }, now).price, 1);
  assert.throws(() => postInput({ ...deal, photoKey, price: 4 }, now), HttpError);
});

test("event sources use the public Union event allowlist and normalize duplicates", () => {
  const now = Date.now();
  const event = { type: "freebie", title: "Society welcome", location: "Wilkins foyer", lat: 51.524, lng: -0.133, startsAt: now + 30000, expiresAt: now + 60000, dietary: [] };
  const good = postInput({ ...event, sourceUrl: "https://studentsunionucl.org/whats-on/clubs-societies/welcome/", sourceName: "Fake source" }, now);
  assert.equal(good.sourceUrl, "https://studentsunionucl.org/whats-on/clubs-societies/welcome");
  assert.equal(good.sourceName, "Students’ Union UCL");
  for (const sourceUrl of ["http://studentsunionucl.org/whats-on/welcome", "https://studentsunionucl.org.evil.test/whats-on/welcome", "https://studentsunionucl.org/whats-on/welcome?redirect=evil", "https://user:password@studentsunionucl.org/whats-on/welcome", "https://studentsunionucl.org/admin"]) assert.throws(() => postInput({ ...event, sourceUrl }, now), HttpError);
  assert.throws(() => postInput({ ...event, startsAt: event.expiresAt }, now), HttpError);
});

test("ordinary post intake cannot manufacture the imported event type or provenance", () => {
  const now = Date.now();
  const event = { type: "event", title: "Society event", location: "Wilkins foyer", lat: 51.524, lng: -0.133,
    expiresAt: now + 60000, sourceUrl: "https://studentsunionucl.org/whats-on/clubs-societies/welcome", unionImport: true,
    sourceEventKey: "123:456", userId: "system:union" };
  assert.throws(() => postInput(event, now), HttpError);
  assert.throws(() => postInput(event, now, { unionImport: true }), HttpError);
});

test("private contact details and flat numbers are rejected while public room labels work", () => {
  assert.ok(privateInformationReason("Contact landlord@example.com"));
  assert.ok(privateInformationReason("Call 07123 456789"));
  assert.ok(privateInformationReason("I live in Flat 4B"));
  assert.ok(privateInformationReason("My room 12 has damp", true));
  assert.equal(privateInformationReason("Event in room 101"), null);
  assert.equal(privateInformationReason("My deposit took three months to return.", true), null);
});

test("streamed bodies are capped even when Content-Length is absent", async () => {
  const request = new Request("https://campus.example", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(7)); controller.enqueue(new Uint8Array(7)); controller.close(); } }), duplex: "half" });
  await assert.rejects(() => readLimitedBody(request, 10), (error) => error.status === 413);
  const okay = new Request("https://campus.example", { method: "POST", body: "abc" });
  assert.equal(new TextDecoder().decode(await readLimitedBody(okay, 10)), "abc");
});

test("image validation rejects HTML disguised as a photo", () => {
  assert.throws(() => imageType(new TextEncoder().encode("<html><script>alert(1)</script></html>")), HttpError);
  assert.throws(() => imageType(new Uint8Array(2)), HttpError);
});

test("JPEG EXIF and comment metadata are removed", () => {
  const source = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4, 0xff, 0xfe, 0x00, 0x04, 5, 6, 0xff, 0xda, 0, 2, 10, 20, 0xff, 0xd9]);
  assert.equal(imageType(source).mime, "image/jpeg");
  assert.deepEqual([...stripImageMetadata(source, "image/jpeg")], [0xff, 0xd8, 0xff, 0xda, 0, 2, 10, 20, 0xff, 0xd9]);
});

test("PNG text metadata is removed without altering image chunks", () => {
  const chunk = (type, data) => { const result = new Uint8Array(12 + data.length); new DataView(result.buffer).setUint32(0, data.length); result.set(new TextEncoder().encode(type), 4); result.set(data, 8); return result; };
  const source = new Uint8Array([137,80,78,71,13,10,26,10,...chunk("IHDR", new Uint8Array(13)),...chunk("tEXt", new TextEncoder().encode("GPS location")),...chunk("IDAT", new Uint8Array([1,2])),...chunk("IEND", new Uint8Array())]);
  const result = stripImageMetadata(source, "image/png");
  assert.equal(new TextDecoder().decode(result).includes("GPS location"), false);
  assert.equal(new TextDecoder().decode(result).includes("IDAT"), true);
});

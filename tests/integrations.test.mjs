import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";

// Exercise service contracts without external requests or real credentials.
const source = (await fs.readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8")).replace('import { env } from "cloudflare:workers";', "const env = {};");
const temporaryModule = new URL(".integration-under-test.mjs", import.meta.url);
await fs.writeFile(temporaryModule, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const api = await import(temporaryModule.href);
await fs.unlink(temporaryModule);
const originalFetch = globalThis.fetch;
const originalEnvironment = { ...process.env };
function fakeClaude(data) {
  globalThis.fetch = async () => Response.json({ content: [{ type: "text", text: JSON.stringify(data) }], stop_reason: "end_turn" });
}
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ["ANTHROPIC_API_KEY", "GOOGLE_MAPS_API_KEY", "UNION_IMPORT_ENABLED"]) {
    if (originalEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = originalEnvironment[key];
  }
});

test("missing Claude configuration fails closed without a network call", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = () => { throw new Error("must not call external services"); };
  await assert.rejects(api.moderateContent("My deposit took three months"), error => error.status === 503);
});

test("plain-English search validates filters and calls the versioned Messages API", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  const expected = { query: "", category: "study", dietary: [], openNow: true, tags: ["quiet", "plugs"], layer: "rated" };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(options.body);
    assert.equal(body.model, process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6");
    assert.equal(options.headers["anthropic-version"], "2023-06-01");
    assert.equal(body.max_tokens, 1600);
    return Response.json({ content: [{ type: "text", text: JSON.stringify(expected) }], stop_reason: "end_turn" });
  };
  assert.deepEqual(await api.searchWithClaude("quiet study with plugs open now"), expected);
});

test("malformed or truncated model output never becomes a valid moderation verdict", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  fakeClaude({ approved: "yes", reasons: [] });
  await assert.rejects(api.moderateContent("hello"), error => error.status === 502);
  globalThis.fetch = async () => Response.json({ content: [], stop_reason: "max_tokens" });
  await assert.rejects(api.moderateContent("hello"), error => error.status === 502);
});

test("photo extraction is a draft and calculates the discount from validated prices", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  fakeClaude({ title: "Sandwich", description: "Reduced", location: "Goodge Street", startsAt: null, expiresAt: null, dietary: [], layer: "deal", price: 1.5, originalPrice: 3, confidence: "medium", warnings: ["Confirm expiry"] });
  const result = await api.extractPin("label", { mediaType: "image/png", data: "dGVzdA==" });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.expiresAt, null);
});

test("provider failures do not leak response bodies or secrets", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-placeholder";
  globalThis.fetch = async () => new Response("sensitive upstream details", { status: 403 });
  await assert.rejects(api.locatePlace("Wilkins"), error => error.status === 502 && !error.message.includes("sensitive"));
});

test("Google roadmap styling is sent to the supported session API on the server", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-placeholder";
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/tile\.googleapis\.com\/v1\/createSession\?/);
    const body = JSON.parse(options.body);
    assert.equal(body.mapType, "roadmap");
    assert.ok(body.styles.some(style => style.featureType === "road" && style.elementType === "geometry" && style.stylers[0].color === "#ffffff"));
    return Response.json({ session: "test-map-session", expiry: String(Math.floor(Date.now() / 1000) + 3600), tileWidth: 256, tileHeight: 256, imageFormat: "png" });
  };
  const session = await api.googleMapSession();
  assert.equal(session.session, "test-map-session");
  assert.equal(session.tileWidth, 256);
});

test("photo moderation inspects the image alongside the pin text", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[0].content[0].type, "image");
    assert.equal(body.messages[0].content[0].source.data, "dGVzdA==");
    return Response.json({ content: [{ type: "text", text: '{"approved":false,"reasons":["Remove the personal phone number"]}' }], stop_reason: "end_turn" });
  };
  const result = await api.moderatePhoto({ mediaType: "image/png", data: "dGVzdA==" }, "food left over");
  assert.equal(result.approved, false);
});

test("Union importer rejects non-allowlisted source URLs before a request", async () => {
  process.env.UNION_IMPORT_ENABLED = "true";
  globalThis.fetch = () => { throw new Error("must not make a network request"); };
  for (const url of ["https://example.com/whats-on/test", "http://studentsunionucl.org/whats-on/test", "https://studentsunionucl.org/user/login", "https://studentsunionucl.org:444/whats-on/test", "https://studentsunionucl.org/whats-on/test?redirect=1"]) {
    await assert.rejects(api.importUnionEvent(url), error => error.status === 400);
  }
});

test("Union importer obeys current robots restrictions", async () => {
  process.env.UNION_IMPORT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("User-agent: *\nDisallow: /whats-on/\n"); };
  await assert.rejects(api.importUnionEvent("https://studentsunionucl.org/whats-on/test"), error => error.status === 403);
  assert.equal(calls, 1);
});

test("Union importer rejects free admission without a food or merchandise offer", async () => {
  process.env.UNION_IMPORT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  globalThis.fetch = async url => {
    if (url.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /\n");
    if (url.startsWith("https://studentsunionucl.org")) return new Response("<main>Free entry to a lecture. No refreshments.</main>", { headers: { "Content-Type": "text/html" } });
    return Response.json({ content: [{ type: "text", text: JSON.stringify({ includesFreeFoodOrMerch: false, evidence: "", title: "Lecture", description: "Free entry", location: "UCL", startsAt: null, expiresAt: null, dietary: [], layer: "freebie", price: null, originalPrice: null, confidence: "high", warnings: [] }) }], stop_reason: "end_turn" });
  };
  await assert.rejects(api.importUnionEvent("https://studentsunionucl.org/whats-on/test"), error => error.status === 422);
});

test("Union import returns source credit and a confirmation-required draft", async () => {
  process.env.UNION_IMPORT_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  globalThis.fetch = async url => {
    if (url.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /\n");
    if (url.startsWith("https://studentsunionucl.org")) return new Response("<main>Society social with free pizza.</main>", { headers: { "Content-Type": "text/html" } });
    return Response.json({ content: [{ type: "text", text: JSON.stringify({ includesFreeFoodOrMerch: true, evidence: "The listing offers free pizza at the society social.", title: "Society social", description: "Pizza at the social", location: "UCL", startsAt: null, expiresAt: null, dietary: [], layer: "freebie", price: null, originalPrice: null, confidence: "medium", warnings: ["Confirm the event times"] }) }], stop_reason: "end_turn" });
  };
  const result = await api.importUnionEvent("https://studentsunionucl.org/whats-on/test");
  assert.equal(result.sourceUrl, "https://studentsunionucl.org/whats-on/test");
  assert.equal(result.sourceName, "Students’ Union UCL");
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.pin.expiresAt, null);
  assert.equal(result.pin.layer, "freebie");
});

test("upload limit is checked even if the sender omits content-length", async () => {
  await assert.rejects(api.readLimitedText(new Response("123456"), 5), error => error.status === 413);
  assert.equal(await api.readLimitedText(new Response("12345"), 5), "12345");
});

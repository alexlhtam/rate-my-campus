import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";

// Exercise service contracts without external requests or real credentials.
const foodSource = await fs.readFile(new URL("../lib/food.ts", import.meta.url), "utf8");
const foodModule = ts.transpileModule(foodSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const foodImport = `data:text/javascript;base64,${Buffer.from(foodModule).toString("base64")}`;
const source = (await fs.readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8")).replace('from "./food"', `from "${foodImport}"`);
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
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_WORKSPACE_ID", "GOOGLE_MAPS_API_KEY", "UNION_IMPORT_ENABLED"]) {
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

test("search carries a named origin and bounded radius without inventing coordinates", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  const filters = { query: "", category: "building", layer: "rated", dietary: [], openNow: false, tags: [], near: "Garden Halls", radiusKm: 1.5 };
  fakeClaude(filters);
  assert.deepEqual(await api.searchWithClaude("campus buildings within 1.5 km near Garden Halls"), filters);
  fakeClaude({ ...filters, radiusKm: -1 });
  await assert.rejects(api.searchWithClaude("near campus"), error => error.status === 502);
});

test("blank optional Claude settings use the default model and omit the workspace header", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  process.env.ANTHROPIC_MODEL = " ";
  process.env.ANTHROPIC_WORKSPACE_ID = " ";
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, "claude-sonnet-4-6");
    assert.equal("anthropic-workspace-id" in options.headers, false);
    return Response.json({ content: [{ type: "text", text: '{"approved":true,"reasons":[]}' }], stop_reason: "end_turn" });
  };
  assert.equal((await api.moderateContent("The study room has useful sockets.")).approved, true);
});

test("photo extraction is a draft and calculates the discount from validated prices", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  fakeClaude({ title: "Sandwich", description: "Reduced", location: "Goodge Street", startsAt: null, expiresAt: null, dietary: [], layer: "deal", price: 1.5, originalPrice: 3, confidence: "medium", warnings: ["Confirm expiry"] });
  const result = await api.extractPin("label", { mediaType: "image/png", data: "dGVzdA==" });
  assert.equal(result.discountPercent, 50);
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.expiresAt, null);
});

test("food extraction defaults missing facts to unknown and adds mandatory confirmation warnings", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  fakeClaude({ title: "Food to share" });
  const pin = await api.extractFood("Food left over after our event");
  assert.equal(pin.layer, "food");
  assert.equal(pin.requiresConfirmation, true);
  assert.equal(pin.portionsRemaining, null);
  assert.equal(pin.location, null);
  assert.equal(pin.expiresAt, null);
  assert.equal(pin.collectionInstructions, null);
  assert.deepEqual(pin.dietary, []);
  assert.deepEqual(pin.foodDetails, { allergenStatus: "unknown", allergens: [], ingredients: "", handling: "", sourceLabel: "", pickupAccess: "ask", bringContainer: false });
  assert.match(pin.warnings.join(" "), /location.*deadline.*instructions.*Allergen/);
  assert.equal("evidence" in pin, false);
});

test("food extraction retains explicit text facts but does not add dietary claims or safety guarantees", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  const text = "UCL Chess Society: 12 portions of vegetarian pasta. Ingredients: wheat, milk. Kept chilled. Collect from Wilkins foyer before 16:00 on 12 October 2026. UCL ID required. Bring a container. Ask at the welcome desk.";
  const evidence = quote => ({ source: "text", quote });
  fakeClaude({ title: "Vegetarian pasta", description: "Pasta from UCL Chess Society", location: "Wilkins foyer", expiresAt: "2026-10-12T16:00:00+01:00", dietary: ["vegetarian"], portionsRemaining: 12, collectionInstructions: "Ask at the welcome desk.", confidence: "high", foodDetails: { allergenStatus: "provided", allergens: ["cereals-gluten", "milk", "milk"], ingredients: "wheat, milk", handling: "Kept chilled", sourceLabel: "UCL Chess Society", pickupAccess: "ucl", bringContainer: true }, evidence: { location: evidence("Wilkins foyer"), expiresAt: evidence("before 16:00 on 12 October 2026"), dietary: evidence("vegetarian pasta"), portionsRemaining: evidence("12 portions"), collectionInstructions: evidence("Ask at the welcome desk."), allergens: evidence("Ingredients: wheat, milk."), ingredients: evidence("Ingredients: wheat, milk."), handling: evidence("Kept chilled."), sourceLabel: evidence("UCL Chess Society"), pickupAccess: evidence("UCL ID required."), bringContainer: evidence("Bring a container.") } });
  const pin = await api.extractFood(text);
  assert.equal(pin.portionsRemaining, 12);
  assert.equal(pin.location, "Wilkins foyer");
  assert.equal(pin.expiresAt, "2026-10-12T16:00:00+01:00");
  assert.deepEqual(pin.dietary, ["vegetarian"]);
  assert.deepEqual(pin.foodDetails.allergens, ["cereals-gluten", "milk"]);
  assert.equal(pin.foodDetails.pickupAccess, "ucl");
  assert.equal(pin.foodDetails.bringContainer, true);
  assert.equal("safe" in pin, false);
});

test("food extraction discards invented, unsupported and contradictory allergen facts", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  fakeClaude({ title: "Food to share", location: "Somewhere invented", dietary: ["vegan"], portionsRemaining: 20, confidence: "high", foodDetails: { allergenStatus: "unknown", allergens: ["milk"], ingredients: "milk", handling: "Fresh and safe", pickupAccess: "public", bringContainer: true }, evidence: { location: { source: "text", quote: "Somewhere invented" }, dietary: { source: "label", quote: "vegan" }, portionsRemaining: { source: "text", quote: "20 portions" } } });
  const pin = await api.extractFood("Leftover food");
  assert.equal(pin.location, null);
  assert.equal(pin.portionsRemaining, null);
  assert.deepEqual(pin.dietary, []);
  assert.equal(pin.foodDetails.allergenStatus, "unknown");
  assert.deepEqual(pin.foodDetails.allergens, []);
  assert.equal(pin.foodDetails.ingredients, "");
  assert.equal(pin.foodDetails.handling, "");
  assert.equal(pin.foodDetails.pickupAccess, "ask");
  assert.equal(pin.foodDetails.bringContainer, false);
  assert.equal(pin.confidence, "low");
  fakeClaude({ title: "Food to share", foodDetails: { allergenStatus: "provided", allergens: [] } });
  assert.equal((await api.extractFood("A plate of food")).foodDetails.allergenStatus, "unknown");
});

test("photo food extraction sends the supplied image and only accepts explicit label evidence as a draft", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages[0].content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: "dGVzdA==" } });
    assert.match(body.system, /Never infer allergens, ingredients, dietary suitability, freshness, safety, quantity/);
    assert.match(body.system, /Never count pictured items as portions/);
    assert.match(body.system, /vegan does not imply dairy-free/);
    assert.match(body.system, /never a food-safety estimate/);
    return Response.json({ content: [{ type: "text", text: JSON.stringify({ title: "Food to share", dietary: ["vegan"], foodDetails: { allergenStatus: "provided", allergens: ["soybeans"], ingredients: "May contain soya" }, evidence: { dietary: { source: "label", quote: "Vegan" }, allergens: { source: "label", quote: "May contain soya" }, ingredients: { source: "label", quote: "May contain soya" } } }) }], stop_reason: "end_turn" });
  };
  const pin = await api.extractFood("", { mediaType: "image/png", data: "dGVzdA==" });
  assert.deepEqual(pin.dietary, ["vegan"]);
  assert.deepEqual(pin.foodDetails.allergens, ["soybeans"]);
  assert.equal(pin.foodDetails.ingredients, "May contain soya");
  assert.equal(pin.portionsRemaining, null);
  assert.equal(pin.requiresConfirmation, true);
  assert.ok(pin.warnings.some(warning => warning.includes("original label")));
});

test("food output schema rejects invalid quantities, allergen IDs, layers and extra inferred fields", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  const invalid = [
    { portionsRemaining: 0 }, { portionsRemaining: -1 }, { portionsRemaining: 2.5 }, { portionsRemaining: 10_001 },
    { layer: "deal" }, { foodDetails: { allergens: ["shellfish"] } }, { dietary: ["allergen-free"] },
    { foodDetails: { safeToEat: true } }, { lat: 51.5 }, { expiresAt: "sometime soon" },
  ];
  for (const fields of invalid) {
    fakeClaude({ title: "Food to share", ...fields });
    await assert.rejects(api.extractFood("food"), error => error.status === 502);
  }
});

test("food collection time conflicts do not become an automatic expiry", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  fakeClaude({ title: "Food to share", startsAt: "2026-10-12T17:00:00+01:00", expiresAt: "2026-10-12T16:00:00+01:00", evidence: { startsAt: { source: "text", quote: "from 17:00" }, expiresAt: { source: "text", quote: "until 16:00" } } });
  const pin = await api.extractFood("Available from 17:00 until 16:00 on 12 October");
  assert.equal(pin.expiresAt, null);
  assert.equal(pin.confidence, "low");
  assert.ok(pin.warnings.some(warning => warning.includes("conflict")));
});

test("food input rejects empty descriptions and invalid images before calling a provider", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error("not expected"); };
  await assert.rejects(api.extractFood(" "), error => error.status === 400);
  for (const image of [{ mediaType: "image/svg+xml", data: "dGVzdA==" }, { mediaType: "image/png", data: "%%%" }, { mediaType: "image/png", data: "a".repeat(2_800_001) }]) {
    await assert.rejects(api.extractFood("label", image));
  }
  assert.equal(calls, 0);
});

test("food provider failures fail closed without inventing food facts or exposing upstream details", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(api.extractFood("food"), error => error.status === 503);
  process.env.ANTHROPIC_API_KEY = "test-placeholder";
  for (const status of [429, 403, 500]) {
    globalThis.fetch = async () => new Response("sensitive provider body", { status });
    await assert.rejects(api.extractFood("food"), error => error.status === (status === 429 ? 429 : 502) && !error.message.includes("sensitive"));
  }
  globalThis.fetch = async () => { throw new Error("network failed"); };
  await assert.rejects(api.extractFood("food"), error => error.status === 504);
  globalThis.fetch = async () => new Response("not JSON", { headers: { "Content-Type": "application/json" } });
  await assert.rejects(api.extractFood("food"), error => error.status === 502);
  for (const malformed of [null, [], { content: "not content blocks" }, { content: [{ type: "text", text: 4 }] }]) {
    globalThis.fetch = async () => Response.json(malformed);
    await assert.rejects(api.extractFood("food"), error => error.status === 502);
  }
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

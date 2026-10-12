import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";

// Execute the real route's branching/validation while keeping identity, storage
// and providers isolated. Integration tests exercise the actual Claude adapter.
let identity, accountError, originError, limitError, calls;
class IntegrationError extends Error { constructor(status, message) { super(message); this.status = status; } }
globalThis.__foodAssistRoute = {
  z, IntegrationError,
  currentUser: async () => identity,
  requireVerified: async () => { calls.push("account"); if (accountError) throw accountError; return identity; },
  consumeRateLimit: async (...args) => { calls.push(["rate", ...args]); if (limitError) throw limitError; },
  assertSameOrigin: () => { calls.push("origin"); if (originError) throw originError; },
  readLimitedText: async request => request.text(),
  extractFood: async (...args) => { calls.push(["food", ...args]); return { layer: "food", title: "Food to share", requiresConfirmation: true }; },
  extractPin: async (...args) => { calls.push(["generic", ...args]); return { layer: "deal", requiresConfirmation: true }; },
  importUnionEvent: async () => { throw new Error("Must not enter source importer"); },
  runtimeEnv: async () => { throw new Error("Food does not need moderator import configuration"); },
  integrationErrorResponse: error => Response.json({ error: error.message }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : error.status || 500 }),
};
const source = (await fs.readFile(new URL("../app/api/assist/route.ts", import.meta.url), "utf8"))
  .replace(/^import\s+\{([^}]+)\}\s+from\s+"[^"]+";/gm, (_match, names) => `const {${names}} = globalThis.__foodAssistRoute;`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
delete globalThis.__foodAssistRoute;
const request = (body, type = "application/json") => new Request("https://campus.example/api/assist", { method: "POST", headers: { "Content-Type": type, Origin: "https://campus.example" }, body: JSON.stringify(body) });
test.beforeEach(() => { identity = { userId: "own-account" }; accountError = null; originError = null; limitError = null; calls = []; });

test("extract-food returns a private confirmation draft behind account and shared rate checks", async () => {
  const image = { mediaType: "image/png", data: "dGVzdA==" };
  const response = await route.POST(request({ action: "extract-food", text: "Read the label", image }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { provider: "anthropic", pin: { layer: "food", title: "Food to share", requiresConfirmation: true } });
  assert.deepEqual(calls, ["origin", ["rate", "own-account", "assist", 30, 3600], "account", ["food", "Read the label", image]]);
});

test("food route rejects unauthenticated, account-ineligible, cross-origin and rate-limited requests before extraction", async () => {
  identity = null;
  assert.equal((await route.POST(request({ action: "extract-food", text: "food" }))).status, 401);
  identity = { userId: "own-account" };
  accountError = new IntegrationError(403, "A UCL account is required");
  assert.equal((await route.POST(request({ action: "extract-food", text: "food" }))).status, 403);
  accountError = null;
  originError = new IntegrationError(403, "Origin rejected");
  assert.equal((await route.POST(request({ action: "extract-food", text: "food" }))).status, 403);
  originError = null;
  limitError = new IntegrationError(429, "Try later");
  assert.equal((await route.POST(request({ action: "extract-food", text: "food" }))).status, 429);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "food"), false);
});

test("food route rejects empty, oversized and unsupported input while accepting an image-only draft", async () => {
  for (const body of [{ action: "extract-food" }, { action: "extract-food", text: "  " }, { action: "extract-food", text: "x".repeat(8001) }, { action: "extract-food", image: { mediaType: "image/svg+xml", data: "dGVzdA==" } }, { action: "extract-food", image: { mediaType: "image/png", data: "x".repeat(2_800_001) } }]) {
    assert.equal((await route.POST(request(body))).status, 400);
  }
  assert.equal((await route.POST(request({ action: "extract-food", text: "food" }, "text/plain"))).status, 415);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "food"), false);
  assert.equal((await route.POST(request({ action: "extract-food", image: { mediaType: "image/png", data: "dGVzdA==" } }))).status, 200);
  assert.equal(calls.at(-1)[1], "");
});

test("generic extract remains separately routed for deals and freebies", async () => {
  const response = await route.POST(request({ action: "extract", text: "Reduced sticker" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pin.layer, "deal");
  assert.deepEqual(calls.at(-1), ["generic", "Reduced sticker", undefined]);
});

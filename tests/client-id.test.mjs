import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createClientId } from "../lib/client-id.ts";

test("uses native UUID generation when the secure-context API exists", () => {
  const id = "c9d933b4-14b0-44b2-b174-2870d094a5b0";
  assert.equal(createClientId({ randomUUID: () => id, getRandomValues: () => { throw new Error("Fallback should not run"); } }), id);
});

test("HTTP LAN fallback sets the UUIDv4 version and variant without randomUUID", () => {
  const source = { getRandomValues: (bytes) => bytes.fill(255) };
  assert.equal(source.randomUUID, undefined);
  assert.equal(createClientId(source), "ffffffff-ffff-4fff-bfff-ffffffffffff");
  const browserWithoutRandomUUID = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  assert.match(createClientId(browserWithoutRandomUUID), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

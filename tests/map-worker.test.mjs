import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyMapWorker } from "../scripts/copy-map-worker.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const packagePath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(await readFile(packagePath, "utf8"));

test("the published MapLibre worker and its notices are copied byte for byte under a versioned name", async () => {
  // Copy into a scratch project that resolves the real installed package.
  const fixture = await mkdtemp(path.join(os.tmpdir(), "map-worker-"));
  try {
    await writeFile(path.join(fixture, "package.json"), "{}");
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
    const [worker, license] = await copyMapWorker(fixture);
    assert.equal(worker, path.join(fixture, "public", "vendor", `maplibre-worker-${version}.mjs`));
    assert.deepEqual(await readFile(worker), await readFile(path.join(path.dirname(packagePath), "dist/maplibre-gl-worker.mjs")));
    assert.deepEqual(await readFile(license), await readFile(path.join(path.dirname(packagePath), "LICENSE.txt")));
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("the map loads the worker from the copied public path", async () => {
  const source = await readFile(path.join(root, "components/campus-map.tsx"), "utf8");
  assert.match(source, /setWorkerUrl\(`\/vendor\/maplibre-worker-\$\{gl\.getVersion\(\)\}\.mjs`\)/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mapWorker } from '../build/map-worker-plugin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const packagePath = require.resolve('maplibre-gl/package.json');
const { version } = JSON.parse(await readFile(packagePath, 'utf8'));
const original = await readFile(path.join(path.dirname(packagePath), 'dist/maplibre-gl-worker.mjs'));
const license = await readFile(path.join(path.dirname(packagePath), 'LICENSE.txt'));
const assetPath = `_next/static/maplibre-worker-${version}.mjs`;

async function plugin() {
  const result = mapWorker();
  await result.configResolved({ root, base: '/', build: { ssr: false } });
  return result;
}

test('development worker bypasses Vite transforms and returns the exact published bytes', async () => {
  const worker = await plugin();
  let handler;
  worker.configureServer({ middlewares: { use(callback) { handler = callback; } } });
  const headers = {}, response = { setHeader(key, value) { headers[key] = value; }, end(body) { this.body = body; } };
  handler({ method: 'GET', url: `/${assetPath}?v=cache-bust` }, response, () => assert.fail('worker fell through to transform middleware'));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, original);
  assert.equal(headers['Content-Type'], 'text/javascript; charset=utf-8');
  assert.doesNotMatch(response.body.toString(), /from\s*["']\/@vite\/client/);
  let next = 0;
  handler({ method: 'GET', url: '/unrelated.mjs' }, response, () => next++);
  assert.equal(next, 1);
});

test('production emits the same versioned worker and complete notices in the client bundle only', async () => {
  const worker = await plugin();
  const emitted = [];
  worker.generateBundle.call({ environment: { name: 'client' }, emitFile(asset) { emitted.push(asset); } });
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].fileName, assetPath);
  assert.deepEqual(emitted[0].source, original);
  assert.deepEqual(emitted[1].source, license);
  assert.match(emitted[1].fileName, /LICENSE\.txt$/);
  for (const name of ['rsc', 'ssr']) {
    worker.generateBundle.call({ environment: { name }, emitFile() { assert.fail(`worker emitted into ${name}`); } });
  }
});

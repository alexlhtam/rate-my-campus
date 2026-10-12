import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../lib/client-photo.ts', import.meta.url), 'utf8');
const temporaryModule = new URL('.client-photo-under-test.mjs', import.meta.url);
await fs.writeFile(temporaryModule, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const { validatePhotoFile, identifyPhotoType, fitPhotoDimensions, preparePhoto } = await import(temporaryModule.href);
await fs.unlink(temporaryModule);

test('photo validation rejects empty, oversized and unsupported files before decoding', () => {
  assert.throws(() => validatePhotoFile({ size: 0, type: 'image/jpeg' }), /empty/);
  assert.throws(() => validatePhotoFile({ size: 5 * 1024 * 1024 + 1, type: 'image/jpeg' }), /5 MB/);
  assert.throws(() => validatePhotoFile({ size: 1000, type: 'image/svg+xml' }), /JPEG/);
  assert.doesNotThrow(() => validatePhotoFile({ size: 5 * 1024 * 1024, type: 'image/png' }));
});

test('photo signatures identify supported raster formats rather than trusting filenames', () => {
  assert.equal(identifyPhotoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1])), 'image/jpeg');
  assert.equal(identifyPhotoType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(identifyPhotoType(new TextEncoder().encode('RIFF1234WEBP')), 'image/webp');
  assert.equal(identifyPhotoType(new TextEncoder().encode('<svg>bad</svg>')), null);
});

test('portrait and landscape photos retain their aspect ratio within 1600 pixels', () => {
  assert.deepEqual(fitPhotoDimensions(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(fitPhotoDimensions(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitPhotoDimensions(800, 600), { width: 800, height: 600 });
  assert.throws(() => fitPhotoDimensions(0, 600), /invalid/);
});

test('a spoofed image MIME type cannot reach the browser decoder', async () => {
  const fake = { size: 12, type: 'image/jpeg', slice() { return new Blob(['<svg></svg>']); } };
  await assert.rejects(preparePhoto(fake), /not a valid/);
});

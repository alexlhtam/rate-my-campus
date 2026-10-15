import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = (await fs.readFile(new URL('../components/source-import-panel.tsx', import.meta.url), 'utf8'))
  .replace(/^import CampusMap,.*$/m, 'const CampusMap = () => null;')
  .replace("import { places } from '@/lib/data';", 'const places = [];')
  .replace("import { hasCoordinates } from '@/lib/place-search';", 'const hasCoordinates = place => Number.isFinite(place.lat) && Number.isFinite(place.lng);');
const temporaryModule = new URL('.source-import-under-test.mjs', import.meta.url);
await fs.writeFile(temporaryModule, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
const { default: SourceImportPanel, londonDateTime, londonDateTimeToISO } = await import(temporaryModule.href);
await fs.unlink(temporaryModule);

test('import controls start disabled until server permission is known', () => {
  const markup = renderToStaticMarkup(React.createElement(SourceImportPanel));
  assert.match(markup, /Checking the import service/);
  assert.match(markup, /type="submit"[^>]*disabled=""/);
  assert.match(markup, /Nothing is published until you confirm/);
});

test('October London event times preserve BST when sent to the server', () => {
  assert.equal(londonDateTime('2026-10-12T15:30:00Z'), '2026-10-12T16:30');
  assert.equal(londonDateTimeToISO('2026-10-12T16:30'), '2026-10-12T15:30:00.000Z');
});

test('winter London event times use GMT without relying on the host timezone', () => {
  assert.equal(londonDateTimeToISO('2026-12-01T16:30'), '2026-12-01T16:30:00.000Z');
});

test('nonexistent spring-clock-change times cannot silently become another time', () => {
  assert.throws(() => londonDateTimeToISO('2026-03-29T01:30'), /does not exist/);
});

test('unchanged source times preserve either occurrence of the repeated autumn hour', () => {
  assert.equal(londonDateTimeToISO('2026-10-25T01:30', '2026-10-25T00:30:00Z'), '2026-10-25T00:30:00.000Z');
  assert.equal(londonDateTimeToISO('2026-10-25T01:30', '2026-10-25T01:30:00Z'), '2026-10-25T01:30:00.000Z');
  assert.throws(() => londonDateTimeToISO('2026-10-25T01:30'), /occurs twice/);
  assert.equal(londonDateTimeToISO('2026-10-25T01:30', null, 'earlier'), '2026-10-25T00:30:00.000Z');
  assert.equal(londonDateTimeToISO('2026-10-25T01:30', '2026-10-25T00:30:00Z', 'later'), '2026-10-25T01:30:00.000Z');
});

test('invalid calendar dates are rejected rather than normalized into another month', () => {
  assert.throws(() => londonDateTimeToISO('2026-02-30T12:00'), /valid event date/);
});

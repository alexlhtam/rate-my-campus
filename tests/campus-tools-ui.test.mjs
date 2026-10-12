import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../components/campus-tools.tsx', import.meta.url), 'utf8');
const helper = await readFile(new URL('../lib/campus-tools.ts', import.meta.url), 'utf8');
const temp = await mkdtemp(fileURLToPath(new URL('.campus-tools-', import.meta.url)));
const compile = (text, jsx = false) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined } }).outputText;
await writeFile(join(temp, 'helper.mjs'), compile(helper));
async function component(variant, edits = value => value) {
  // State fixtures are confined to the test copy. No test-only production props.
  const code = edits(source).replace("'../lib/campus-tools'", "'./helper.mjs'").replace("import './campus-tools.css';", '');
  await writeFile(join(temp, `${variant}.mjs`), compile(code, true));
  return (await import(pathToFileURL(join(temp, `${variant}.mjs`)).href)).default;
}
const places = [{ id: 'library', name: 'Known library', address: 'Gower Street', lat: 51.5246, lng: -0.134 }, { id: 'unknown', name: 'Unmapped hall', address: 'Official address' }];
const props = { mode: 'live', places, reviews: [], onSelect() {} };

test('tools remain server-renderable and expose named navigation without account access', async () => {
  try {
    const Tools = await component('default');
    const html = renderToStaticMarkup(React.createElement(Tools, props));
    for (const label of ['Compare', 'Collections', 'Timetable', 'Study resources']) assert.ok(html.includes(label));
    assert.match(html, /Choose two or three places/); assert.match(html, /Community mode/);
  } finally { /* shared fixtures are removed by the final test hook */ }
});

test('comparison displays authoritative totals, honest missing data and criterion sample limitations', async () => {
  const Tools = await component('compare', text => text.replace('useState<string[]>([])', "useState<string[]>(['library', 'unknown'])"));
  const html = renderToStaticMarkup(React.createElement(Tools, { ...props, reviews: [{ placeId: 'library', rating: 1 }], summaries: { library: { count: 876, rating: 4.2, recommend: 91, criteria: { wifi: 4.1 } } } }));
  assert.match(html, /876 reviews/); assert.match(html, /4\.2 \/ 5/); assert.match(html, /No reviews yet/);
  assert.match(html, /Criterion response count unavailable/); assert.match(html, /Location not verified/); assert.match(html, /Straight-line distance/);
  assert.ok(!html.includes('0.0 / 5'), 'Unknown ratings must not become zero scores');
});

test('study links use official UCL destinations without invented availability', async () => {
  const Tools = await component('study', text => text.replace("useState<'compare' | 'collections' | 'timetable' | 'study'>('compare')", "useState<'compare' | 'collections' | 'timetable' | 'study'>('study')"));
  const html = renderToStaticMarkup(React.createElement(Tools, props));
  assert.match(html, /https:\/\/www\.ucl\.ac\.uk\/library\/using-library/);
  assert.match(html, /does not estimate empty seats/);
  assert.equal((html.match(/target="_blank"/g) || []).length, 3);
});

test('calendar UI states local-only handling and explicit manual room confirmation', async () => {
  const Tools = await component('timetable', text => text.replace("useState<'compare' | 'collections' | 'timetable' | 'study'>('compare')", "useState<'compare' | 'collections' | 'timetable' | 'study'>('timetable')"));
  const html = renderToStaticMarkup(React.createElement(Tools, props));
  assert.match(html, /never uploaded or saved/); assert.match(html, /512 KB/); assert.match(html, /Europe\/London/);
  assert.match(html, /edited recurrence series are skipped/);
});

test('collection account access is explicit and sample mode never offers account saving', async () => {
  const Tools = await component('collections', text => text.replace("useState<'compare' | 'collections' | 'timetable' | 'study'>('compare')", "useState<'compare' | 'collections' | 'timetable' | 'study'>('collections')"));
  const live = renderToStaticMarkup(React.createElement(Tools, { ...props, signedIn: true }));
  assert.match(live, /Load from account/); assert.match(live, /Save to account/);
  const demo = renderToStaticMarkup(React.createElement(Tools, { ...props, mode: 'demo', signedIn: true }));
  assert.ok(!demo.includes('Load from account')); assert.match(demo, /sample mode/);
  assert.match(live, /Calendar events, account details and your device location are excluded/);
});

test.after(async () => {
  assert.equal(dirname(temp), fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, ''));
  assert.ok(basename(temp).startsWith('.campus-tools-'));
  await rm(temp, { recursive: true, force: true });
});

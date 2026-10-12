import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const buildingsModule = new URL(`.map-buildings-under-test-${process.pid}.mjs`, import.meta.url);
const temporaryModule = new URL(`.map-under-test-${process.pid}.mjs`, import.meta.url);
const source = (await fs.readFile(new URL('../components/campus-map.tsx', import.meta.url), 'utf8'))
  .replace("from './campus-buildings'", `from './.map-buildings-under-test-${process.pid}.mjs'`);
const buildingsSource = await fs.readFile(new URL('../components/campus-buildings.tsx', import.meta.url), 'utf8');
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let CampusMap;
try {
  await fs.writeFile(buildingsModule, compile(buildingsSource));
  await fs.writeFile(temporaryModule, compile(source));
  CampusMap = (await import(temporaryModule.href)).default;
} finally {
  await Promise.all([temporaryModule, buildingsModule].map(file => fs.unlink(file).catch(() => {})));
}

test('a Google-derived location never initially renders on the fallback map', () => {
  const markup = renderToStaticMarkup(React.createElement(CampusMap, { items: [], onSelect() {}, confirm: true, requireGoogle: true, initialPosition: { lat: 51.525, lng: -0.135 } }));
  assert.doesNotMatch(markup, /OpenStreetMap|tile\.openstreetmap|\/api\/map\/tile/);
  assert.match(markup, /Loading the map/);
  assert.doesNotMatch(markup, /class="confirm-cross"/);
});

test('map controls inside the posting form cannot submit it', () => {
  const markup = renderToStaticMarkup(React.createElement(CampusMap, { items: [], onSelect() {}, confirm: true }));
  const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every(button => button.includes('type="button"')));
});

test('the fallback attribution and selected map-pin state are explicit', () => {
  const markup = renderToStaticMarkup(React.createElement(CampusMap, { items: [{ id: 'library', name: 'Library', lat: 51.525, lng: -0.134 }], selected: 'library', onSelect() {} }));
  assert.match(markup, /OpenStreetMap contributors/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-label="View Library"/);
  assert.doesNotMatch(markup, /<b aria-label="Google Maps"/);
});

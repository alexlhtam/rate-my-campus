import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Server rendering does not run effects, so neither the GPU renderer nor its
// worker is loaded. Compile the real local dependencies, not a component stub.
const names = ['model', 'buildings', 'flat', 'main'];
const modules = Object.fromEntries(names.map(name => [name, new URL(`.map-${name}-under-test-${process.pid}.mjs`, import.meta.url)]));
const paths = { model: '../lib/campus-map-model.ts', buildings: '../components/campus-buildings.tsx', flat: '../components/campus-flat-map.tsx', main: '../components/campus-map.tsx' };
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let CampusMap, FlatCampusMap;
try {
  for (const name of names) {
    const source = (await fs.readFile(new URL(paths[name], import.meta.url), 'utf8'))
      .replace(/from\s+(['"])\.\/campus-buildings\1/g, `from '${modules.buildings.href}'`)
      .replace(/from\s+(['"])\.\/campus-flat-map\1/g, `from '${modules.flat.href}'`)
      .replace(/from\s+(['"])@\/lib\/campus-map-model\1/g, `from '${modules.model.href}'`);
    await fs.writeFile(modules[name], compile(source));
  }
  CampusMap = (await import(modules.main.href)).default;
  FlatCampusMap = (await import(modules.flat.href)).default;
} finally { await Promise.all(Object.values(modules).map(file => fs.unlink(file).catch(() => {}))); }

test('Google-derived location stays hidden until its attributed Google map is ready', () => {
  for (const Component of [CampusMap, FlatCampusMap]) {
    const markup = renderToStaticMarkup(React.createElement(Component, { items: [], onSelect() {}, confirm: true, requireGoogle: true, initialPosition: { lat: 51.525, lng: -0.135 } }));
    assert.doesNotMatch(markup, /OpenStreetMap|tile\.openstreetmap|\/api\/map\/tile/);
    assert.match(markup, /Loading the map/);
    assert.doesNotMatch(markup, /class="confirm-cross"/);
  }
});

test('both confirmation renderers have three controls which cannot submit the posting form', () => {
  for (const Component of [CampusMap, FlatCampusMap]) {
    const markup = renderToStaticMarkup(React.createElement(Component, { items: [], onSelect() {}, confirm: true }));
    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every(button => button.includes('type="button"')));
    for (const label of ['Zoom in', 'Zoom out', 'Back to UCL']) assert.ok(markup.includes(`aria-label="${label}"`));
  }
});

test('MapLibre initial HTML exposes map controls without fabricating canvas placement or Google attribution', () => {
  const markup = renderToStaticMarkup(React.createElement(CampusMap, { items: [{ id: 'library', name: 'Library', lat: 51.525, lng: -0.134 }], selected: 'library', onSelect() {} }));
  assert.match(markup, /data-map-engine="maplibre"/);
  for (const label of ['Campus area', 'Find a UCL building', 'Raised campus buildings', 'Building labels', 'Point map north']) assert.ok(markup.includes(`aria-label="${label}"`));
  assert.match(markup, /OpenStreetMap contributors/);
  assert.doesNotMatch(markup, />Google Maps</);
  assert.doesNotMatch(markup, /aria-label="View Library"/, 'Screen pins need a ready map projection');
  const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  assert.ok(buttons.every(button => button.includes('type="button"')));
});

test('flat fallback preserves selectable pins and explicit attribution without a false 3D control', () => {
  const markup = renderToStaticMarkup(React.createElement(FlatCampusMap, { items: [{ id: 'library', name: 'Library', lat: 51.525, lng: -0.134 }], selected: 'library', onSelect() {} }));
  assert.match(markup, /OpenStreetMap contributors/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-label="View Library"/);
  assert.doesNotMatch(markup, /Raised campus buildings|Campus 3D|estimated heights|>3D<|>Google Maps</);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../components/campus-buildings.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
const { buildCampusScene } = module.exports;
const project = (lng, lat, zoom) => {
  const scale = 256 * 2 ** zoom, sine = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
};
function viewport(zoom = 17, lng = -0.1324, lat = 51.5244) {
  const center = project(lng, lat, zoom);
  return { zoom, left: center.x - 1000, top: center.y - 800, width: 2000, height: 1600 };
}
const exterior = [[-0.133, 51.524], [-0.132, 51.524], [-0.132, 51.525], [-0.133, 51.525], [-0.133, 51.524]];
const courtyard = [[-0.1328, 51.5242], [-0.1328, 51.5248], [-0.1322, 51.5248], [-0.1322, 51.5242], [-0.1328, 51.5242]];
const feature = { id: 'verified-courtyard', properties: { name: 'Fixture building', affiliationVerified: true, heightMeters: 25 }, geometry: { type: 'Polygon', coordinates: [exterior, courtyard] } };
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('flat footprints follow tile projection at every close zoom without height offsets', () => {
  for (const zoom of [15, 16, 17, 18, 19]) {
    const view = viewport(zoom), scene = buildCampusScene(collection(feature), view);
    assert.equal(scene.length, 1);
    const expected = project(...exterior[0], zoom);
    const [, x, y] = scene[0].path.match(/^M([-\d.]+),([-\d.]+)/);
    assert.ok(Math.abs(Number(x) - (expected.x - view.left)) < 0.011);
    assert.ok(Math.abs(Number(y) - (expected.y - view.top)) < 0.011);
    assert.doesNotMatch(scene[0].path, /NaN|Infinity/);
    const taller = { ...feature, properties: { ...feature.properties, heightMeters: 200 } };
    assert.deepEqual(buildCampusScene(collection(taller), view), scene);
    assert.equal('walls' in scene[0], false);
  }
});

test('verified membership replaces the old geographic clipping box', () => {
  const westRing = exterior.map(([lng, lat]) => [lng - 0.005, lat]);
  const westFeature = { ...feature, id: 'western-campus', geometry: { type: 'Polygon', coordinates: [westRing] } };
  assert.equal(buildCampusScene(collection(westFeature), viewport(17, -0.1374)).length, 1);
  for (const affiliationVerified of [undefined, false, 'true', 1]) {
    const unverified = { ...feature, properties: { name: 'UCL in name is insufficient', affiliationVerified } };
    assert.deepEqual(buildCampusScene(collection(unverified), viewport()), []);
  }
});

test('multipolygon parts retain every courtyard ring regardless of winding', () => {
  const secondPolygon = [exterior.map(([lng, lat]) => [lng + 0.002, lat])];
  const multipart = { ...feature, properties: { ...feature.properties, buildingPart: true }, geometry: { type: 'MultiPolygon', coordinates: [[exterior, courtyard], secondPolygon] } };
  const scene = buildCampusScene(collection(multipart), viewport());
  assert.equal(scene.length, 2);
  assert.equal((scene[0].path.match(/M/g) || []).length, 2);
  assert.equal((scene[0].path.match(/Z/g) || []).length, 2);
  const reversed = { ...feature, geometry: { type: 'Polygon', coordinates: [exterior.slice().reverse(), courtyard.slice().reverse()] } };
  assert.equal((buildCampusScene(collection(reversed), viewport())[0].path.match(/M/g) || []).length, 2);
  assert.match(source, /fillRule="evenodd"/);
});

test('invalid holes, degenerate geometry and invisible viewports fail closed', () => {
  assert.deepEqual(buildCampusScene(collection(feature), viewport(14)), []);
  assert.deepEqual(buildCampusScene(collection(feature), { ...viewport(), left: viewport().left + 100_000 }), []);
  assert.deepEqual(buildCampusScene(collection(feature), { ...viewport(), left: NaN }), []);
  for (const ring of [courtyard.slice(0, -1), [[NaN, 51], ...courtyard.slice(1)], [[0, 90], [1, 90], [1, 91], [0, 90]], Array(4).fill(exterior[0])]) {
    const invalid = { ...feature, geometry: { type: 'Polygon', coordinates: [exterior, ring] } };
    assert.deepEqual(buildCampusScene(collection(invalid), viewport()), []);
  }
});

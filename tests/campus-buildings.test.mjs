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
const footprints = JSON.parse(await readFile(new URL('../public/data/campus-buildings.geojson', import.meta.url), 'utf8'));
const project = (lng, lat, zoom) => {
  const scale = 256 * 2 ** zoom, sine = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
};
function viewport(zoom = 17) {
  const center = project(-0.1324, 51.5244, zoom);
  return { zoom, left: center.x - 1000, top: center.y - 800, width: 2000, height: 1600 };
}

test('real footprint bases stay aligned to the tile projection at every close zoom', () => {
  for (const zoom of [15, 16, 17, 18, 19]) {
    const view = viewport(zoom), scene = buildCampusScene(footprints, view);
    assert.ok(scene.length > 0);
    const feature = footprints.features.find(item => item.properties.name === 'Wilkins Building');
    const building = scene.find(item => item.id === `${feature.id}-0`);
    assert.ok(building);
    const [lng, lat] = feature.geometry.coordinates[0][0];
    const expected = project(lng, lat, zoom);
    const [, x, y] = building.base.match(/^M([-\d.]+),([-\d.]+)/);
    assert.ok(Math.abs(Number(x) - (expected.x - view.left)) < 0.011);
    assert.ok(Math.abs(Number(y) - (expected.y - view.top)) < 0.011);
    for (const item of scene) {
      assert.doesNotMatch(item.roof + item.base + item.walls.map(wall => wall.points).join(), /NaN|Infinity/);
      assert.ok(item.walls.length > 0);
    }
  }
});

test('campus-only overlay stays absent when zoomed out, off screen or outside campus', () => {
  assert.deepEqual(buildCampusScene(footprints, viewport(14)), []);
  assert.deepEqual(buildCampusScene(footprints, { ...viewport(), left: viewport().left + 100_000 }), []);
  const unrelated = { type: 'FeatureCollection', features: [{ id: 'outside-campus', geometry: { type: 'Polygon', coordinates: [[[-0.14, 51.52], [-0.139, 51.52], [-0.139, 51.521], [-0.14, 51.52]]] } }] };
  assert.deepEqual(buildCampusScene(unrelated, viewport()), []);
});

test('courtyard holes and reversed footprint winding remain valid', () => {
  const exterior = [[-0.133, 51.524], [-0.132, 51.524], [-0.132, 51.525], [-0.133, 51.525], [-0.133, 51.524]];
  const courtyard = [[-0.1328, 51.5242], [-0.1328, 51.5248], [-0.1322, 51.5248], [-0.1322, 51.5242], [-0.1328, 51.5242]];
  const feature = { id: 'courtyard', properties: { heightMeters: 12 }, geometry: { type: 'Polygon', coordinates: [exterior, courtyard] } };
  const normal = buildCampusScene({ features: [feature] }, viewport())[0];
  const reversed = buildCampusScene({ features: [{ ...feature, geometry: { type: 'Polygon', coordinates: [exterior.slice().reverse(), courtyard.slice().reverse()] } }] }, viewport())[0];
  assert.equal((normal.roof.match(/M/g) || []).length, 2, 'Keep both rings for even-odd courtyard fill');
  assert.equal(normal.walls.length, 4);
  assert.equal(reversed.walls.length, normal.walls.length);
});

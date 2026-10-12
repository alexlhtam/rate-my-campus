import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const [directory, data, index, quality] = await Promise.all(['public/data/campus-directory.json', 'public/data/campus-buildings.geojson', 'public/data/campus-footprint-index.json', 'public/data/campus-building-quality.json'].map(read));
const modelSource = await readFile(new URL('../lib/campus-map-model.ts', import.meta.url), 'utf8');
const modelJS = ts.transpileModule(modelSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { prepareCampusGeometry, mapBuildings, geometryBounds, searchBuildings } = await import(`data:text/javascript;base64,${Buffer.from(modelJS).toString('base64')}`);
const flatSource = await readFile(new URL('../components/campus-buildings.tsx', import.meta.url), 'utf8');
const flatJS = ts.transpileModule(flatSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const flatModule = { exports: {} };
new Function('require', 'module', 'exports', flatJS)(createRequire(import.meta.url), flatModule, flatModule.exports);
const { buildCampusScene } = flatModule.exports;
const prepared = prepareCampusGeometry(data);
const buildings = mapBuildings(directory, prepared, index);
const byId = new Map(buildings.map(building => [building.id, building]));
const projected = ([lng, lat], zoom) => {
  const scale = 256 * 2 ** zoom, sine = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
};

test('every reviewed footprint survives the render pipeline and joins exactly one catalogue/index entry', () => {
  assert.equal(prepared.features.length, data.features.length, 'No verified source feature may silently disappear in preparation');
  assert.equal(byId.size, directory.buildings.length, 'Rendering must not invent or lose directory entries');
  const indexById = new Map(index.buildings.map(building => [building.buildingId, building]));
  assert.equal(indexById.size, index.buildings.length, 'Footprint index IDs must be unique');
  const mappedIds = new Set(prepared.features.map(feature => feature.properties.buildingId));
  assert.deepEqual([...mappedIds].sort(), [...indexById.keys()].sort(), 'Every mapped building needs exactly one index record');
  for (const buildingId of mappedIds) {
    const record = byId.get(buildingId), indexed = indexById.get(buildingId);
    assert.ok(record, buildingId);
    const features = data.features.filter(feature => feature.properties.buildingId === buildingId);
    assert.deepEqual(features.map(feature => feature.id).sort(), indexed.geometryMatch.featureIds.slice().sort(), buildingId);
    assert.ok(prepared.features.some(feature => feature.properties.buildingId === buildingId && !feature.properties.isOutline), `${buildingId} needs massing, not just a non-extruded enclosing outline`);
    assert.ok(record.coordinates && Number.isFinite(record.coordinates.lat) && Number.isFinite(record.coordinates.lng), `${buildingId} needs a usable label point`);
    const bounds = geometryBounds(prepared, buildingId);
    assert.ok(bounds, buildingId);
    assert.ok(record.coordinates.lng >= bounds[0][0] && record.coordinates.lng <= bounds[1][0] && record.coordinates.lat >= bounds[0][1] && record.coordinates.lat <= bounds[1][1], `${buildingId} label must stay within its source extent`);
  }
});

test('the coverage report accounts for every unmapped address without assigning fabricated positions', () => {
  assert.equal(quality.statistics.directoryBuildings, directory.buildings.length);
  assert.equal(quality.statistics.matchedBuildings, index.buildings.length);
  const mapped = new Set(index.buildings.map(building => building.buildingId));
  const unmatched = directory.buildings.filter(building => !mapped.has(building.id));
  assert.deepEqual(quality.unmatchedBuildings.map(building => building.buildingId).sort(), unmatched.map(building => building.id).sort());
  for (const record of unmatched) {
    assert.ok(quality.unmatchedBuildings.find(building => building.buildingId === record.id).reason?.trim(), `${record.id} needs an explanation`);
    if (!record.coordinates) assert.equal(byId.get(record.id).coordinates, record.coordinates, `${record.id}: an address is not a confirmed map position`);
    assert.ok(searchBuildings(buildings, record.name).some(building => building.id === record.id), `${record.id} must remain searchable while unmapped`);
  }
});

test('all 34 published 2026/27 halls remain searchable with explicit operating arrangements', () => {
  const audit = directory.accommodationAudit;
  assert.equal(audit.academicYear, '2026/27');
  assert.equal(audit.expectedHallCount, 34);
  assert.equal(audit.cataloguedHallCount, 34);
  assert.deepEqual(audit.missingNames, []);
  const halls = directory.buildings.filter(building => building.accommodation?.current);
  assert.equal(halls.length, 34);
  assert.equal(new Set(audit.buildingIds).size, 34);
  assert.deepEqual(audit.buildingIds.slice().sort(), halls.map(building => building.id).sort());
  for (const hall of halls) {
    const arrangement = hall.accommodation;
    assert.equal(arrangement.academicYear, audit.academicYear);
    for (const field of ['listingName', 'operator', 'contractProvider', 'relationship']) assert.ok(arrangement[field]?.trim(), `${hall.id}: ${field}`);
    assert.ok(arrangement.sourceUrls.length);
    for (const url of arrangement.sourceUrls) assert.equal(new URL(url).hostname, 'www.ucl.ac.uk');
    assert.ok(searchBuildings(buildings, arrangement.listingName).some(building => building.id === hall.id), `${hall.id} must match its published hall name`);
  }
});

test('Garden Halls resolves singular/plural searches and has renderable hall geometry', () => {
  const id = 'ucl-garden-halls', garden = byId.get(id);
  assert.ok(garden, 'Keep the canonical Garden Halls entry');
  assert.equal(garden.membership.status, 'ucl-partner');
  assert.equal(garden.membership.scope, 'shared-site');
  for (const query of ['Garden Halls', 'garden hall', 'gardens halls', 'Cartwright Gardens']) {
    assert.ok(searchBuildings(buildings, query).some(building => building.id === id), query);
  }
  const features = data.features.filter(feature => feature.properties.buildingId === id);
  assert.ok(features.length > 0, 'Garden Halls must have a reviewed building footprint, not only a directory address');
  assert.ok(index.buildings.some(building => building.buildingId === id));
  assert.ok(garden.coordinates);
  for (const feature of features) {
    assert.equal(feature.properties.affiliationVerified, true);
    assert.equal(feature.properties.occupationScope, 'shared-site');
    const tags = feature.properties.osmTags;
    assert.ok(tags.building || tags['building:part'], 'A residential campus landuse boundary is not a hall building');
  }
  const bounds = geometryBounds(prepared, id);
  for (const zoom of [15, 16, 17, 18, 19]) {
    const a = projected([bounds[0][0], bounds[1][1]], zoom), b = projected([bounds[1][0], bounds[0][1]], zoom);
    const viewport = { zoom, left: a.x - 50, top: a.y - 50, width: b.x - a.x + 100, height: b.y - a.y + 100 };
    const scene = buildCampusScene({ type: 'FeatureCollection', features }, viewport);
    const polygonCount = features.reduce((count, feature) => count + (feature.geometry.type === 'Polygon' ? 1 : feature.geometry.coordinates.length), 0);
    assert.equal(scene.length, polygonCount, `Every Garden Halls footprint/part must survive flat projection at zoom ${zoom}`);
  }
});

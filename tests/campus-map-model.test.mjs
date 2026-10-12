import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/campus-map-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { prepareCampusGeometry, geometryBounds, mapBuildings, searchBuildings, groupScreenPins, isSafeSource } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const outer = [[-0.135, 51.523], [-0.133, 51.523], [-0.133, 51.525], [-0.135, 51.525], [-0.135, 51.523]];
const hole = [[-0.1345, 51.5235], [-0.1345, 51.5245], [-0.1335, 51.5245], [-0.1335, 51.5235], [-0.1345, 51.5235]];
const feature = (id, properties = {}, geometry = { type: 'Polygon', coordinates: [outer, hole] }) => ({ type: 'Feature', id, properties: { buildingId: id, name: id, affiliationVerified: true, ...properties }, geometry });
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('only verified polygon membership enters the rendered model; holes and parts are unchanged', () => {
  const multipart = { type: 'MultiPolygon', coordinates: [[outer, hole], [outer.map(([lng, lat]) => [lng + 0.01, lat])]] };
  const input = collection(feature('outline', { role: 'outline' }), feature('part', { role: 'part' }, multipart), feature('unknown', { affiliationVerified: false }), feature('string', { affiliationVerified: 'true' }), feature('point', {}, { type: 'Point', coordinates: [-0.134, 51.524] }));
  const before = structuredClone(input);
  const prepared = prepareCampusGeometry(input);
  assert.deepEqual(prepared.features.map(row => row.properties.buildingId), ['outline', 'part']);
  assert.equal(prepared.features[0].properties.isOutline, true);
  assert.equal(prepared.features[1].properties.isOutline, false);
  assert.deepEqual(prepared.features[1].geometry, multipart);
  assert.deepEqual(prepared.features[0].geometry.coordinates[1], hole);
  assert.deepEqual(input, before, 'Preparation must not rewrite source geometry or factual heights');
});

test('mapped heights win, estimates stay labelled and bases remain below the rendered roof', () => {
  const cases = [
    [{ height: 23, visualHeight: 99, minHeight: 4 }, [23, 4]],
    [{ height: null, heightMeters: 18, visualHeight: 99, min_height: 3 }, [18, 3]],
    [{ height: null, visualHeight: 21, visualMinHeight: 6, heightStatus: 'unknown' }, [21, 6]],
    [{ height: null, levels: 5 }, [15, 0]],
    [{ height: 400, minHeight: 300 }, [180, 179]],
    [{ height: 0.5, minHeight: -4 }, [2, 0]],
    [{ visualHeight: NaN, minHeight: Infinity }, [12, 0]],
    [{ height: -1, visualHeight: -5, levels: -4 }, [12, 0]],
    [{ height: null, visualHeight: 'broken', visualMinHeight: 'broken' }, [12, 0]],
  ];
  for (const [properties, expected] of cases) {
    const result = prepareCampusGeometry(collection(feature('fixture', properties))).features[0].properties;
    assert.deepEqual([result.renderHeight, result.renderBase], expected);
    assert.ok(Number.isFinite(result.renderHeight) && Number.isFinite(result.renderBase));
    assert.ok(result.renderBase >= 0 && result.renderBase < result.renderHeight);
    assert.equal(result.height, properties.height);
    assert.equal(result.heightStatus, properties.heightStatus);
  }
});

test('bounds include all building parts and keep other buildings out', () => {
  const east = outer.map(([lng, lat]) => [lng + 0.01, lat]);
  const data = collection(feature('one'), feature('one', {}, { type: 'Polygon', coordinates: [east] }), feature('two', {}, { type: 'Polygon', coordinates: [outer.map(([lng, lat]) => [lng + 1, lat])] }));
  assert.deepEqual(geometryBounds(data, 'one'), [[-0.135, 51.523], [-0.12300000000000001, 51.525]]);
  assert.equal(geometryBounds(data, 'missing'), null);
});

test('directory uses reviewed footprint label points before bounding-box centres and preserves official coordinates', () => {
  const official = { lat: 51.526, lng: -0.136, sourceUrl: 'https://www.ucl.ac.uk/example' };
  const directory = { datasetDate: 'fixture', buildings: [{ id: 'labelled', name: 'Labelled', campus: 'bloomsbury' }, { id: 'official', name: 'Official', campus: 'east', coordinates: official }, { id: 'unmapped', name: 'Unmapped address', campus: 'other' }] };
  const inputBefore = structuredClone(directory);
  const index = { buildings: [{ buildingId: 'labelled', coordinates: { lat: 51.5232, lng: -0.1348, sourceUrl: 'https://www.openstreetmap.org/way/1', kind: 'footprint-label-point' } }, { buildingId: 'official', coordinates: { lat: 1, lng: 2 } }, { buildingId: 'fallback', coordinates: { lat: NaN, lng: 0 } }] };
  const buildings = mapBuildings(directory, collection(feature('labelled'), feature('official'), feature('fallback'), feature('unverified', { affiliationVerified: false })), index);
  assert.deepEqual(buildings.find(row => row.id === 'labelled').coordinates, index.buildings[0].coordinates);
  assert.deepEqual(buildings.find(row => row.id === 'official').coordinates, official);
  assert.deepEqual(buildings.find(row => row.id === 'fallback').coordinates, { lat: 51.524, lng: -0.134, sourceUrl: undefined });
  assert.equal(buildings.find(row => row.id === 'unmapped').coordinates, undefined);
  assert.equal(buildings.some(row => row.id === 'unverified'), false);
  assert.deepEqual(directory, inputBefore);
});

test('directory search matches all query words across names, aliases and address with campus filtering', () => {
  const buildings = [
    { id: 'unmapped', name: 'Cruciform Annexe', campus: 'bloomsbury', address: 'Gower Street' },
    { id: 'mapped', name: 'Cruciform Building', officialName: 'Clinical Sciences', aliases: ['Medical library'], address: 'Gower Street', campus: 'bloomsbury', coordinates: { lat: 51.52, lng: -0.13 } },
    { id: 'east', name: 'Marshgate', campus: 'east', aliases: ['UCL East'] },
  ];
  assert.deepEqual(searchBuildings(buildings, '  MEDICAL gOwEr  ').map(row => row.id), ['mapped']);
  assert.deepEqual(searchBuildings(buildings, 'Cruciform').map(row => row.id), ['mapped', 'unmapped']);
  assert.deepEqual(searchBuildings(buildings, '', 'east').map(row => row.id), ['east']);
  assert.deepEqual(searchBuildings(buildings, 'library', 'east'), []);
  assert.deepEqual(searchBuildings(buildings, 'no such building'), []);
});

test('collision groups preserve every distinct pin and its selectable object exactly once', () => {
  const pins = [{ x: 50, y: 50, item: { id: 'library', type: 'rated' } }, { x: 50, y: 50, item: { id: 'food', type: 'food' } }, { x: 65, y: 50, item: { id: 'deal', type: 'deal' } }, { x: 150, y: 150, item: { id: 'other', type: 'rated' } }];
  const groups = groupScreenPins(pins);
  assert.deepEqual(groups.map(group => group.items.map(item => item.id)), [['library', 'food', 'deal'], ['other']]);
  const flattened = groups.flatMap(group => group.items);
  assert.equal(flattened.length, pins.length);
  for (const pin of pins) assert.equal(flattened.filter(item => item === pin.item).length, 1);
  assert.deepEqual(groupScreenPins([]), []);
});

test('source links allow only HTTPS UCL and OpenStreetMap domains', () => {
  for (const url of ['https://www.ucl.ac.uk/estates', 'https://ucl.ac.uk/', 'https://www.openstreetmap.org/way/1']) assert.equal(isSafeSource(url), true);
  for (const url of [undefined, 'javascript:alert(1)', 'http://ucl.ac.uk/', 'https://ucl.ac.uk.evil.test', 'https://fakeucl.ac.uk/', 'https://openstreetmap.org.evil.test', '/relative']) assert.equal(isSafeSource(url), false);
});
